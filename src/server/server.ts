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
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolIndex } from './analyzer/index';
import { WorkspaceScanner } from './analyzer/scanner';
import { validateDocument } from './features/diagnostics';
import { onCompletion, onCompletionResolve } from './features/completion';
import { onHover } from './features/hover';
import { onDefinition, invalidateAstCache } from './features/definition';
import { onReferences } from './features/references';
import { onDocumentSymbol, onWorkspaceSymbol } from './features/symbols';
import { onCodeAction } from './features/codeActions';
import * as fs from 'fs';
import * as path from 'path';
import { detectOdooRoot, detectAddons, buildAliasMap } from './resolver/addonDetector';
import { AddonInfo } from '../shared/types';

// Create the LSP connection
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// In-memory symbol index
const index = new SymbolIndex();

// Workspace scanner
let scanner: WorkspaceScanner;

// Alias map for import resolution
let aliasMap: Map<string, string> = new Map();

// Default excludes
const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '**/.git/**',
  '**/static/src/lib/**',
  '**/static/src/libs/**',
  '**/static/lib/**',
];

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['.', ' ', '{'],
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
    },
  };

  return result;
});

connection.onInitialized(async () => {
  // Register for configuration change notifications
  connection.client.register(
    DidChangeConfigurationNotification.type,
    undefined
  );

  // Read configuration
  let excludeGlobs = DEFAULT_EXCLUDES;
  let configuredOdooRoot: string | undefined;
  try {
    const config = await connection.workspace.getConfiguration('owlIntelliSense');
    if (config?.scanExcludes && Array.isArray(config.scanExcludes)) {
      excludeGlobs = config.scanExcludes;
    }
    if (config?.odooRoot && typeof config.odooRoot === 'string' && config.odooRoot.trim()) {
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
    }
  );

  // Start background workspace scan
  const folders = await connection.workspace.getWorkspaceFolders();
  if (folders && folders.length > 0) {
    const folderPaths = folders.map((f) => {
      try {
        return new URL(f.uri).pathname;
      } catch {
        return f.uri.replace('file://', '');
      }
    });

    // Detect Odoo root and addons for alias resolution
    const odooRoot = configuredOdooRoot ?? detectOdooRoot(folderPaths);
    const addons: AddonInfo[] = detectAddons(odooRoot, folderPaths);
    aliasMap = buildAliasMap(addons);

    // Also add aliases for any workspace folder that IS itself an addon with static/src
    for (const folder of folderPaths) {
      const staticSrc = path.join(folder, 'static', 'src');
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
    connection.console.log(`[OWL] Alias map built: ${aliasMap.size} aliases — ${[...aliasMap.keys()].join(', ')}`);

    scanner.scanWorkspaceFolders(folderPaths, addons).catch((err) => {
      process.stderr.write(`[owl-server] Scan error: ${err}\n`);
    });
  }
});

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    if (change.type === FileChangeType.Deleted) {
      index.removeFile(change.uri);
      connection.sendDiagnostics({ uri: change.uri, diagnostics: [] });
    } else if (change.type === FileChangeType.Changed || change.type === FileChangeType.Created) {
      const doc = documents.get(change.uri);
      if (doc) {
        scanner?.scheduleReparse(change.uri, doc.getText());
      }
    }
  }
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
  if (!doc) {return [];}
  return onCompletion(params, doc, index, aliasMap);
});

connection.onCompletionResolve((item) => {
  return onCompletionResolve(item);
});

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {return null;}
  return onHover(params, doc, index);
});

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {return null;}
  return onDefinition(params, doc, index, aliasMap);
});

connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {return [];}
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
  if (!doc) {return [];}
  return onCodeAction(params, doc, index, aliasMap);
});

// Start listening
documents.listen(connection);
connection.listen();
