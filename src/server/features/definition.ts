import {
  Definition,
  Location,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { getCursorContext } from "../owl/patterns";
import { resolveAlias } from "../resolver/addonDetector";
import { getHookByName, getClassByName } from "../owl/catalog";
import { fileURLToPath, pathToFileURL } from "url";
import * as fs from "fs";
import * as path from "path";
import { TypeResolver } from "./typeResolver";
import { getWordAtPosition, type RequestContext } from "../shared";
import { IComponentReader, IFunctionReader, AliasMap } from "../../shared/types";

// Singleton TypeResolver — populated by server.ts when .d.ts files are discovered
export const typeResolver = new TypeResolver();

// Simple per-URI AST cache (cleared on document change)
const astCache = new Map<string, { version: number; ast: TSESTree.Program }>();

export function invalidateAstCache(uri: string): void {
  astCache.delete(uri);
}

export function onDefinition(
  params: TextDocumentPositionParams,
  ctx: RequestContext,
): Definition | null {
  const doc = ctx.doc;
  if (!doc) { return null; }
  const content = doc.getText();
  const uri = doc.uri;
  const aliasMap = ctx.aliasMap;
  const index = ctx.index;

  // Get or parse AST
  let ast: TSESTree.Program;
  const cached = astCache.get(uri);
  if (cached && cached.version === doc.version) {
    ast = cached.ast;
  } else {
    try {
      ast = parse(content, {
        jsx: true,
        tolerant: true,
        loc: true,
      }) as TSESTree.Program;
      astCache.set(uri, { version: doc.version, ast });
    } catch {
      return fallbackWordLookup(params, ctx);
    }
  }

  const cursorCtx = getCursorContext(
    ast,
    params.position.line,
    params.position.character,
  );

  if (cursorCtx.type === "import-path" && cursorCtx.source) {
    // For @odoo/owl: navigate to owl_module.js (the Odoo module declaration) if it exists.
    // Symbols use owl_module.js (handled in import-specifier branch below).
    if (cursorCtx.source === "@odoo/owl") {
      const owlFile = resolveImportToFile(cursorCtx.source, uri, aliasMap);
      if (owlFile) {
        const moduleFile = path.join(path.dirname(owlFile), "owl_module.js");
        const target = fs.existsSync(moduleFile) ? moduleFile : owlFile;
        const fileUri = pathToFileURL(target).toString();
        return Location.create(fileUri, {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        });
      }
    }
    return resolveImportPathToLocation(cursorCtx.source, uri, aliasMap);
  }

  if (cursorCtx.type === "import-specifier" && cursorCtx.source && cursorCtx.name) {
    return resolveSpecifierDefinition(
      cursorCtx.source,
      cursorCtx.name,
      uri,
      index,
      aliasMap,
    );
  }

  // Cursor is on a usage site (not an import line): find which import the name comes from
  const word = getWordAtPosition(doc, params.position);
  if (word) {
    const importSource = findImportSourceForName(ast, word);
    if (importSource !== undefined) {
      return resolveSpecifierDefinition(
        importSource,
        word,
        uri,
        index,
        aliasMap,
      );
    }
  }

  // Fallback: word-at-cursor component lookup
  return fallbackWordLookup(params, ctx);
}

/**
 * Given an import source and specifier name, resolve to the definition location.
 * Uses a multi-level fallback strategy so that @odoo/owl symbols always resolve
 * to something meaningful rather than falling back to VS Code's reference list.
 */
function resolveSpecifierDefinition(
  source: string,
  name: string,
  currentUri: string,
  index: IComponentReader & IFunctionReader,
  aliasMap: Map<string, string> | undefined,
): Location | null {
  const resolvedFile = resolveImportToFile(source, currentUri, aliasMap);

  // Check source alias index first (covers owl_module.js / owl.js registered via registerSourceAlias)
  const sourceAliasSymbol = index.getFunctionBySource(source, name);
  if (sourceAliasSymbol) {
    return Location.create(sourceAliasSymbol.uri, sourceAliasSymbol.range);
  }

  if (resolvedFile) {
    const fileUri = pathToFileURL(resolvedFile).toString();
    // Try symbol index first (works for indexed TS/JS files)
    const comp = index
      .getComponentsInFile(fileUri)
      .find((c) => c.name === name);
    if (comp) {
      return Location.create(comp.uri, comp.range);
    }
    // PERF-07: Array.from on iterator for find semantics
    const fn = Array.from(index.getAllFunctions()).find(
      (f: { name: string; uri: string }) =>
        f.name === name && f.uri === fileUri,
    );
    if (fn) {
      return Location.create(fn.uri, fn.range);
    }
    // File found but not indexed (e.g. owl.js bundle): scan file text for symbol position
    const pos = findSymbolPositionInFile(resolvedFile, name);
    return Location.create(fileUri, { start: pos, end: pos });
  }

  // For @odoo/owl: the file may not be resolvable via aliasMap (e.g. workspace outside Odoo tree).
  // Try to use any registered source-alias URI for owl.js to scan for the symbol directly,
  // rather than falling back to a workspace-wide search that would find the wrong symbol.
  if (source === "@odoo/owl") {
    const aliasUris = index.getSourceAliasUris(source);
    // Scan each registered OWL file for the symbol, preferring a precise location.
    let fallbackUri: string | undefined;
    for (const aliasUri of aliasUris) {
      try {
        const aliasFile = fileURLToPath(aliasUri);
        const pos = findSymbolPositionInFile(aliasFile, name);
        if (pos.line !== 0 || pos.character !== 0) {
          // Symbol found at a meaningful location in the bundle — return precise position.
          return Location.create(aliasUri, { start: pos, end: pos });
        }
        fallbackUri = fallbackUri ?? aliasUri;
      } catch {
        /* skip invalid URIs */
      }
    }
    // Symbol not found by text scan. Validate against the OWL catalog before navigating to
    // line 0 of the file, to avoid false positives for unrecognised names.
    if (fallbackUri && (getHookByName(name) || getClassByName(name))) {
      return Location.create(fallbackUri, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      });
    }
    // Last resort: search for owl.js from the current file's directory upward.
    // This handles workspaces where aliasMap/@odoo/owl was not set at startup
    // (e.g. server.ts walk-up strategies start from workspace parent, missing
    // cases where owl.js lives *inside* the workspace tree).
    const owlJsOnDemand = findOwlJsFromFile(currentUri);
    if (owlJsOnDemand) {
      const pos = findSymbolPositionInFile(owlJsOnDemand, name);
      const owlUri = pathToFileURL(owlJsOnDemand).toString();
      return Location.create(owlUri, { start: pos, end: pos });
    }
    // owl.js not registered and not resolvable — return null (no false reference list)
    return null;
  }

  // Non-OWL unresolved source — search workspace index for any export of this symbol
  // (OWL symbols are often re-exported from @web files that ARE indexed)
  // PERF-07: Array.from on iterator for find semantics
  const fnAnywhere = Array.from(index.getAllFunctions()).find(
    (f: { name: string }) => f.name === name,
  );
  if (fnAnywhere) {
    return Location.create(fnAnywhere.uri, fnAnywhere.range);
  }
  const compAnywhere = Array.from(index.getAllComponents()).find(
    (c: { name: string }) => c.name === name,
  );
  if (compAnywhere) {
    return Location.create(compAnywhere.uri, compAnywhere.range);
  }

  // TypeResolver fallback: search loaded .d.ts definitions for the symbol.
  // This handles cases like @odoo/owl where owl.d.ts provides type members.
  if (typeResolver.hasDefinitions()) {
    const typeDef = typeResolver.getTypeDefinition(name);
    if (typeDef) {
      const fileUri = pathToFileURL(typeDef.filePath).toString();
      return Location.create(fileUri, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      });
    }
  }

  // Truly not found anywhere
  return null;
}

/**
 * Scan a file line-by-line for the first declaration of a symbol.
 * Handles: `function foo(`, `const foo =`, `foo = function`, `exports.foo =`, `foo:`.
 * Falls back to {line:0, character:0} if not found.
 */
function findSymbolPositionInFile(
  filePath: string,
  symbol: string,
): { line: number; character: number } {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`\\bclass\\s+${escaped}[\\s{(]`), // class Foo { / class Foo(
      new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`), // function foo(
      new RegExp(`\\bconst\\s+${escaped}\\s*=\\s*(?!void\\s|undefined)`), // const foo = <not void/undefined>
      new RegExp(`\\blet\\s+${escaped}\\s*=\\s*(?!void\\s|undefined)`),
      new RegExp(`\\bvar\\s+${escaped}\\s*=\\s*(?!void\\s|undefined)`),
      new RegExp(`\\b${escaped}\\s*=\\s*function`),
      new RegExp(`exports\\.${escaped}\\s*=\\s*(?!void\\s|undefined)`), // exports.foo = <real value>
      new RegExp(`Object\\.defineProperty[^)]*"${escaped}"`),
      new RegExp(`exports\\["${escaped}"\\]\\s*=\\s*(?!void\\s|undefined)`), // exports["foo"] = <real value>
    ];
    for (let i = 0; i < lines.length; i++) {
      for (const re of patterns) {
        const m = re.exec(lines[i]);
        if (m) {
          return { line: i, character: m.index };
        }
      }
    }
  } catch {
    /* ignore read errors */
  }
  return { line: 0, character: 0 };
}

/**
 * Scan the AST's import declarations to find which module a local name was imported from.
 * Returns the import source string, or undefined if the name isn't an import.
 */
function findImportSourceForName(
  ast: TSESTree.Program,
  name: string,
): string | undefined {
  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") {
      continue;
    }
    for (const spec of node.specifiers) {
      if (spec.local.name === name) {
        return node.source.value as string;
      }
    }
  }
  return undefined;
}

function resolveImportPathToLocation(
  source: string,
  currentUri: string,
  aliasMap: Map<string, string> | undefined,
): Location | null {
  const resolvedFile = resolveImportToFile(source, currentUri, aliasMap);
  if (!resolvedFile) {
    return null;
  }
  const fileUri = pathToFileURL(resolvedFile).toString();
  return Location.create(fileUri, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  });
}

function resolveImportToFile(
  source: string,
  currentUri: string,
  aliasMap: Map<string, string> | undefined,
): string | null {
  // Try alias resolution
  const aliasResolved = resolveAlias(source, aliasMap);
  if (aliasResolved && fs.existsSync(aliasResolved)) {
    return aliasResolved;
  }

  // Try relative resolution
  if (source.startsWith(".")) {
    let currentFile: string;
    try {
      currentFile = fileURLToPath(currentUri);
    } catch {
      return null;
    }
    const dir = path.dirname(currentFile);
    const resolved = path.resolve(dir, source);
    for (const ext of ["", ".ts", ".js", "/index.ts", "/index.js"]) {
      const candidate = resolved + ext;
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function fallbackWordLookup(
  params: TextDocumentPositionParams,
  ctx: RequestContext,
): Location | null {
  const doc = ctx.doc;
  if (!doc) { return null; }
  const word = getWordAtPosition(doc, params.position);
  if (!word) {
    return null;
  }
  const comp = ctx.index.getComponent(word);
  if (comp) {
    return Location.create(comp.uri, comp.range);
  }
  const fn = ctx.index.getFunction(word);
  if (fn) {
    return Location.create(fn.uri, fn.range);
  }
  return null;
}

/**
 * Walk up the directory tree from the current file looking for owl.js.
 * Covers cases where server.ts walk-up strategies missed the file because
 * they start from the workspace folder's *parent*, not from inside the tree.
 * Probes both direct paths and common addons sub-directories.
 */
function findOwlJsFromFile(currentUri: string): string | null {
  let currentFile: string;
  try {
    currentFile = fileURLToPath(currentUri);
  } catch {
    return null;
  }
  const OWL_SUFFIX = path.join("web", "static", "lib", "owl", "owl.js");
  const subPaths = [
    OWL_SUFFIX,
    path.join("addons", OWL_SUFFIX),
    path.join("odoo", "addons", OWL_SUFFIX),
  ];
  let dir = path.dirname(currentFile);
  for (let i = 0; i < 10; i++) {
    for (const sub of subPaths) {
      const candidate = path.join(dir, sub);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) { break; } // filesystem root
    dir = parent;
  }
  return null;
}
