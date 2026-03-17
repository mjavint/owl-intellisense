import { Definition, Location, TextDocumentPositionParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolIndex } from '../analyzer/index';
import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { getCursorContext } from '../owl/patterns';
import { resolveAlias } from '../resolver/addonDetector';
import { fileURLToPath, pathToFileURL } from 'url';
import * as fs from 'fs';
import * as path from 'path';

// Simple per-URI AST cache (cleared on document change)
const astCache = new Map<string, { version: number; ast: TSESTree.Program }>();

export function invalidateAstCache(uri: string): void {
  astCache.delete(uri);
}

export function onDefinition(
  params: TextDocumentPositionParams,
  doc: TextDocument,
  index: SymbolIndex,
  aliasMap: Map<string, string>
): Definition | null {
  const content = doc.getText();
  const uri = doc.uri;

  // Get or parse AST
  let ast: TSESTree.Program;
  const cached = astCache.get(uri);
  if (cached && cached.version === doc.version) {
    ast = cached.ast;
  } else {
    try {
      ast = parse(content, { jsx: true, tolerant: true, loc: true }) as TSESTree.Program;
      astCache.set(uri, { version: doc.version, ast });
    } catch {
      return fallbackWordLookup(params, doc, index);
    }
  }

  const ctx = getCursorContext(ast, params.position.line, params.position.character);

  if (ctx.type === 'import-path' && ctx.source) {
    return resolveImportPathToLocation(ctx.source, uri, aliasMap);
  }

  if (ctx.type === 'import-specifier' && ctx.source && ctx.name) {
    // Resolve the source file, then find the export
    const resolvedFile = resolveImportToFile(ctx.source, uri, aliasMap);
    if (resolvedFile) {
      // Try to find the specific export in the resolved file
      const fileUri = pathToFileURL(resolvedFile).toString();
      const comp = index.getComponentsInFile(fileUri).find(c => c.name === ctx.name);
      if (comp) {return Location.create(comp.uri, comp.range);}
      const fn = index.getAllFunctions().find(f => f.name === ctx.name && f.uri === fileUri);
      if (fn) {return Location.create(fn.uri, fn.range);}
      // Fallback: jump to file start
      return Location.create(fileUri, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
    }
  }

  // Fallback: word-at-cursor component lookup
  return fallbackWordLookup(params, doc, index);
}

function resolveImportPathToLocation(
  source: string,
  currentUri: string,
  aliasMap: Map<string, string>
): Location | null {
  const resolvedFile = resolveImportToFile(source, currentUri, aliasMap);
  if (!resolvedFile) {return null;}
  const fileUri = pathToFileURL(resolvedFile).toString();
  return Location.create(fileUri, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
}

function resolveImportToFile(
  source: string,
  currentUri: string,
  aliasMap: Map<string, string>
): string | null {
  // Try alias resolution
  const aliasResolved = resolveAlias(source, aliasMap);
  if (aliasResolved && fs.existsSync(aliasResolved)) {return aliasResolved;}

  // Try relative resolution
  if (source.startsWith('.')) {
    let currentFile: string;
    try { currentFile = fileURLToPath(currentUri); } catch { return null; }
    const dir = path.dirname(currentFile);
    const resolved = path.resolve(dir, source);
    for (const ext of ['', '.ts', '.js', '/index.ts', '/index.js']) {
      const candidate = resolved + ext;
      if (fs.existsSync(candidate)) {return candidate;}
    }
  }

  return null;
}

function fallbackWordLookup(
  params: TextDocumentPositionParams,
  doc: TextDocument,
  index: SymbolIndex
): Location | null {
  const word = getWordAtPosition(doc, params.position);
  if (!word) {return null;}
  const comp = index.getComponent(word);
  if (comp) {return Location.create(comp.uri, comp.range);}
  const fn = index.getFunction(word);
  if (fn) {return Location.create(fn.uri, fn.range);}
  return null;
}

function getWordAtPosition(doc: TextDocument, position: { line: number; character: number }): string | null {
  const line = doc.getText({ start: { line: position.line, character: 0 }, end: { line: position.line, character: 2000 } });
  const char = position.character;
  const re = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index <= char && char <= m.index + m[0].length) {return m[0];}
  }
  return null;
}
