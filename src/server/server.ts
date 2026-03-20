import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  InitializeResult,
  FileChangeType,
  CodeActionKind,
  Diagnostic,
  CompletionItem,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SymbolIndex } from "./analyzer/index";
import { WorkspaceScanner } from "./analyzer/scanner";
import { validateDocument } from "./features/diagnostics";
import { onCompletion, onCompletionResolve } from "./features/completion";
import { onHover } from "./features/hover";
import { onDefinition, invalidateAstCache } from "./features/definition";
import { onReferences } from "./features/references";
import { onDocumentSymbol, onWorkspaceSymbol } from "./features/symbols";
import { onCodeAction } from "./features/codeActions";
import { onSignatureHelp } from "./features/signatureHelp";
import { onPrepareRename, onRename } from "./features/rename";
import { onInlayHint } from "./features/inlayHints";
import {
  onSemanticTokens,
  SEMANTIC_TOKENS_LEGEND,
} from "./features/semanticTokens";
import { typeResolver } from "./features/definition";
import * as fs from "fs";
import * as path from "path";
import {
  detectOdooRoot,
  detectAddons,
  buildAliasMap,
  findOwlLibraryFiles,
} from "./resolver/addonDetector";
import { OwlAliasResolver } from "./resolver/owlAliasResolver";
import { AddonInfo, CompletionItemData, ISymbolStore } from "../shared/types";
import { buildAddImportEdits } from "./utils/importUtils";

// Create the LSP connection
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// In-memory symbol index
const index: ISymbolStore = new SymbolIndex();

// Workspace scanner
let scanner: WorkspaceScanner;

// Alias map for import resolution
let aliasMap: Map<string, string> = new Map();

// PERF-02: Whether the LSP client supports completionItem/resolve
let supportsResolve = false;

// Default excludes
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/.git/**",
  "**/static/src/lib/**",
  "**/static/src/libs/**",
  "**/static/lib/**",
];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  // PERF-02: Check if client advertises completionItem.resolveSupport
  supportsResolve =
    params.capabilities.textDocument?.completion?.completionItem
      ?.resolveSupport !== undefined;

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: [".", " ", "{"],
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
        retriggerCharacters: [')'],
      },
      renameProvider: {
        prepareProvider: true,
      },
      inlayHintProvider: {
        resolveProvider: false,
      },
      semanticTokensProvider: {
        legend: SEMANTIC_TOKENS_LEGEND,
        full: true,
        range: false,
      },
    },
  };

  return result;
});

connection.onInitialized(async () => {
  // Register for configuration change notifications
  connection.client.register(
    DidChangeConfigurationNotification.type,
    undefined,
  );

  // Read configuration
  let excludeGlobs = DEFAULT_EXCLUDES;
  let configuredOdooRoot: string | undefined;
  try {
    const config =
      await connection.workspace.getConfiguration("owlIntelliSense");
    if (config?.scanExcludes && Array.isArray(config.scanExcludes)) {
      excludeGlobs = config.scanExcludes;
    }
    if (
      config?.odooRoot &&
      typeof config.odooRoot === "string" &&
      config.odooRoot.trim()
    ) {
      configuredOdooRoot = config.odooRoot.trim();
    }
  } catch {
    // Config not available yet
  }

  // Initialize scanner
  scanner = new WorkspaceScanner(
    index,
    excludeGlobs,
    (uri, diags) => {
      connection.sendDiagnostics({ uri, diagnostics: diags as Diagnostic[] });
    },
    (method, params) => {
      connection.sendNotification(method, params);
    },
  );

  // Start background workspace scan
  const folders = await connection.workspace.getWorkspaceFolders();
  if (folders && folders.length > 0) {
    const folderPaths = folders.map((f) => {
      try {
        return new URL(f.uri).pathname;
      } catch {
        return f.uri.replace("file://", "");
      }
    });

    // Detect Odoo root and addons for alias resolution
    const odooRoot = configuredOdooRoot ?? detectOdooRoot(folderPaths);
    const addons: AddonInfo[] = detectAddons(odooRoot, folderPaths);
    aliasMap = buildAliasMap(addons);

    // Map @odoo/owl → web/static/lib/owl/owl.js using cascade of 4 strategies
    new OwlAliasResolver(odooRoot).resolve(folderPaths, addons, aliasMap);

    // Also add aliases for any workspace folder that IS itself an addon with static/src
    for (const folder of folderPaths) {
      const staticSrc = path.join(folder, "static", "src");
      if (fs.existsSync(staticSrc)) {
        const addonName = path.basename(folder);
        if (!aliasMap.has(`@${addonName}`)) {
          aliasMap.set(`@${addonName}`, staticSrc);
        }
      }
    }

    if (odooRoot) {
      process.stderr.write(`[owl-server] Detected Odoo root: ${odooRoot}\n`);
    }
    if (addons.length > 0) {
      process.stderr.write(`[owl-server] Detected ${addons.length} addon(s)\n`);
    }
    connection.console.log(
      `[OWL] Alias map built: ${aliasMap.size} aliases — ${[...aliasMap.keys()].join(", ")}`,
    );

    // Collect OWL library files (owl_module.js and owl.js) to index explicitly,
    // bypassing the **/static/lib/** exclusion rule.
    const owlFiles = findOwlLibraryFiles(addons);
    const owlExtraFiles: string[] = [];
    // owl_module.js is preferred (contains real OWL symbols); register it first
    if (owlFiles.owlModuleJs) {
      owlExtraFiles.push(owlFiles.owlModuleJs);
      const uri = "file://" + owlFiles.owlModuleJs.replace(/\\/g, "/");
      index.registerSourceAlias("@odoo/owl", uri);
      process.stderr.write(
        `[owl-server] Will index owl_module.js: ${owlFiles.owlModuleJs}\n`,
      );
    }
    if (owlFiles.owlJs) {
      owlExtraFiles.push(owlFiles.owlJs);
      const uri = "file://" + owlFiles.owlJs.replace(/\\/g, "/");
      index.registerSourceAlias("@odoo/owl", uri);
      // Strategy 5: ensure aliasMap always has @odoo/owl when we found the file via addons,
      // in case all four path-walking strategies above missed it.
      if (!aliasMap.has("@odoo/owl")) {
        aliasMap.set("@odoo/owl", owlFiles.owlJs);
        process.stderr.write(
          `[owl-server] Mapped @odoo/owl → ${owlFiles.owlJs} (strategy 5 — addons list)\n`,
        );
      }
      process.stderr.write(
        `[owl-server] Will index owl.js: ${owlFiles.owlJs}\n`,
      );
    }

    // Load .d.ts type definitions into TypeResolver for definition fallback
    // (e.g. owl.d.ts provides member definitions for @odoo/owl types)
    const dtsCandidates: string[] = [];
    for (const addon of addons) {
      if (!addon.staticSrcPath) {continue;}
      const owlDts = path.join(addon.root, "static", "lib", "owl", "owl.d.ts");
      if (fs.existsSync(owlDts)) {dtsCandidates.push(owlDts);}
    }
    for (const dts of dtsCandidates) {
      typeResolver.loadTypeDefinitions(dts).catch(() => {/* ignore */});
    }

    scanner
      .scanWorkspaceFolders(folderPaths, addons, owlExtraFiles)
      .catch((err) => {
        process.stderr.write(`[owl-server] Scan error: ${err}\n`);
      });
  }
});

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    if (change.type === FileChangeType.Deleted) {
      // PERF-08: Use scanner.removeFile to also cancel any pending debounce timer
      if (scanner) {
        scanner.removeFile(change.uri);
      } else {
        index.removeFile(change.uri);
      }
      connection.sendDiagnostics({ uri: change.uri, diagnostics: [] });
    } else if (
      change.type === FileChangeType.Changed ||
      change.type === FileChangeType.Created
    ) {
      const doc = documents.get(change.uri);
      if (doc) {
        scanner?.scheduleReparse(change.uri, doc.getText());
      }
    }
  }
});

documents.onDidOpen((event) => {
  const { document } = event;
  const content = document.getText();
  const diags = validateDocument(document.uri, content, index);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: diags });
});

documents.onDidSave((event) => {
  const { document } = event;
  const content = document.getText();
  invalidateAstCache(document.uri);
  scanner?.reparseDocument(document.uri, content);
  const diags = validateDocument(document.uri, content, index);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: diags });
});

documents.onDidClose((event) => {
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  // PERF-02: Pass supportsResolve so completion defers import edits when possible
  return onCompletion(params, doc, index, aliasMap, supportsResolve);
});

connection.onCompletionResolve(
  async (item: CompletionItem): Promise<CompletionItem> => {
    // PERF-02: If the item carries CompletionItemData, compute import edits for this single item
    const data = item.data as
      | CompletionItemData
      | { type?: string }
      | undefined;
    if (data && "specifierName" in data) {
      const itemData = data as CompletionItemData;
      const doc = documents.get(itemData.documentUri);
      if (doc) {
        const text = doc.getText();
        // Parse AST once here for this single item (not once per item in onCompletion)
        item.additionalTextEdits = buildAddImportEdits(
          text,
          itemData.specifierName,
          itemData.modulePath,
        );
      }
      return item;
    }
    // Fallback to existing resolve logic for non-import items
    return onCompletionResolve(item);
  },
);

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }
  return onHover(params, doc, index);
});

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }
  return onDefinition(params, doc, index, aliasMap);
});

connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  return onReferences(params, doc, index);
});

connection.onDocumentSymbol((params) => {
  return onDocumentSymbol(params, index);
});

connection.onWorkspaceSymbol((params) => {
  return onWorkspaceSymbol(params, index);
});

connection.onCodeAction((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  return onCodeAction(params, doc, index, aliasMap);
});

connection.onSignatureHelp((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }
  return onSignatureHelp(params, doc, index);
});

connection.onPrepareRename((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }
  return onPrepareRename(params, doc, index);
});

connection.onRenameRequest(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }
  return onRename(params, doc, index);
});

connection.languages.inlayHint.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  return onInlayHint(params, doc, index);
});

connection.languages.semanticTokens.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return { data: [] };
  }
  return onSemanticTokens(params, doc);
});

// Start listening
documents.listen(connection);
connection.listen();
