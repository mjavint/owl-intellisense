import { TextEdit } from 'vscode-languageserver/node';
import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { filePathToAlias, inferAliasFromPath } from '../resolver/addonDetector';

export interface ImportGroup {
  source: string;
  specifiers: string[]; // sorted
}

/**
 * Parse all existing import declarations from source text.
 */
export function parseImportGroups(source: string): ImportGroup[] {
  let ast: TSESTree.Program;
  try {
    ast = parse(source, { tolerant: true, loc: true }) as TSESTree.Program;
  } catch {
    return [];
  }
  const groups: ImportGroup[] = [];
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') { continue; }
    const specifiers: string[] = [];
    for (const s of node.specifiers) {
      if (s.type === 'ImportSpecifier') {
        specifiers.push(s.imported.type === 'Identifier' ? s.imported.name : (s.imported as TSESTree.StringLiteral).value as string);
      } else if (s.type === 'ImportDefaultSpecifier') {
        specifiers.push('default:' + s.local.name);
      }
    }
    groups.push({ source: node.source.value as string, specifiers });
  }
  return groups;
}

/**
 * Parse document text into an AST for use with buildAddImportEditsFromAst / isSpecifierImportedFromAst.
 * Returns null on parse failure.
 */
export function parseDocumentAst(docText: string): TSESTree.Program | null {
  try {
    return parse(docText, { tolerant: true, loc: true }) as TSESTree.Program;
  } catch {
    return null;
  }
}

/**
 * Build the TextEdits needed to add `specifier` imported from `source`.
 * Accepts a pre-parsed AST to avoid re-parsing (PERF-02 eager-fallback path).
 */
export function buildAddImportEditsFromAst(
  ast: TSESTree.Program,
  specifier: string,
  source: string
): TextEdit[] {

  // Find existing import from same source
  const existing = (ast.body as TSESTree.Node[]).find(
    (n): n is TSESTree.ImportDeclaration =>
      n.type === 'ImportDeclaration' && n.source.value === source
  ) as TSESTree.ImportDeclaration | undefined;

  if (existing) {
    // Collect current named specifiers
    const currentSpecifiers: string[] = existing.specifiers
      .filter((s): s is TSESTree.ImportSpecifier => s.type === 'ImportSpecifier')
      .map(s => s.imported.type === 'Identifier' ? s.imported.name : (s.imported as TSESTree.StringLiteral).value as string);

    // Already imported?
    if (currentSpecifiers.includes(specifier)) { return []; }

    // Merge and sort
    const merged = [...currentSpecifiers, specifier].sort();
    const newImportText = `import { ${merged.join(', ')} } from '${source}';`;

    // Replace the entire import line
    const startLine = existing.loc!.start.line - 1;
    const endLine = existing.loc!.end.line - 1;
    const endCol = existing.loc!.end.column;

    return [TextEdit.replace(
      { start: { line: startLine, character: 0 }, end: { line: endLine, character: endCol } },
      newImportText
    )];
  }

  // No existing import from this source — insert after last import
  const lastImportLine = findLastImportLine(ast.body);
  const insertLine = lastImportLine + 1;
  return [TextEdit.insert(
    { line: insertLine, character: 0 },
    `import { ${specifier} } from '${source}';\n`
  )];
}

/**
 * Build the TextEdits needed to add `specifier` imported from `source`.
 * Parses the document text internally (use buildAddImportEditsFromAst when AST is pre-parsed).
 */
export function buildAddImportEdits(
  docText: string,
  specifier: string,
  source: string
): TextEdit[] {
  const ast = parseDocumentAst(docText);
  if (!ast) { return []; }
  return buildAddImportEditsFromAst(ast, specifier, source);
}

// ─── PERF-09: WeakMap cache for imported specifier Set ────────────────────────

const astImportCache = new WeakMap<TSESTree.Program, Set<string>>();

/**
 * REQ-PERF-09: Returns a cached Set of all imported specifier names from the given AST.
 * Built once per AST and stored in a WeakMap so it is garbage-collected when the AST is.
 */
export function getAllImportedSpecifiers(ast: TSESTree.Program): Set<string> {
  let cache = astImportCache.get(ast);
  if (!cache) {
    cache = new Set<string>();
    for (const node of ast.body) {
      if (node.type !== 'ImportDeclaration') { continue; }
      for (const s of node.specifiers) {
        if (s.type === 'ImportSpecifier') {
          const name = s.imported.type === 'Identifier'
            ? s.imported.name
            : (s.imported as TSESTree.StringLiteral).value as string;
          cache.add(name);
        }
        if (s.type === 'ImportDefaultSpecifier') {
          cache.add(s.local.name);
        }
      }
    }
    astImportCache.set(ast, cache);
  }
  return cache;
}

/**
 * Check if a specifier is already imported (pre-parsed AST variant — PERF-02 eager-fallback).
 * Uses getAllImportedSpecifiers with WeakMap cache for O(1) lookup.
 */
export function isSpecifierImportedFromAst(ast: TSESTree.Program, specifier: string): boolean {
  return getAllImportedSpecifiers(ast).has(specifier);
}

/**
 * Check if a specifier is already imported from any source in the document.
 * Parses internally (use isSpecifierImportedFromAst when AST is pre-parsed).
 */
export function isSpecifierImported(docText: string, specifier: string): boolean {
  const ast = parseDocumentAst(docText);
  if (!ast) { return false; }
  return isSpecifierImportedFromAst(ast, specifier);
}

function findLastImportLine(body: TSESTree.Node[]): number {
  let last = -1;
  for (const node of body) {
    if (node.type === 'ImportDeclaration') {
      last = node.loc!.end.line - 1;
    }
  }
  return last;
}

/**
 * Compute the best import source string for a symbol defined at `symbolFilePath`.
 * Priority:
 *   1. Alias path: @addon/path/to/file  (no extension)
 *   2. Relative path from currentFileUri (no extension)
 * Never returns an absolute path.
 */
export function resolveImportSource(
  symbolFilePath: string,
  currentFileUri: string,
  aliasMap: Map<string, string> | undefined
): string {
  // 1. Try alias map lookup (also uses inferAliasFromPath as fallback internally)
  if (aliasMap) {
    const alias = filePathToAlias(symbolFilePath, aliasMap);
    if (alias) { return alias; }
  }

  // 2. Direct path inference (no aliasMap needed)
  const inferred = inferAliasFromPath(symbolFilePath);
  if (inferred) { return inferred; }

  // 3. Relative path (last resort)
  let currentFile: string;
  try { currentFile = fileURLToPath(currentFileUri); } catch { currentFile = currentFileUri; }

  let rel = path.relative(path.dirname(currentFile), symbolFilePath).replace(/\\/g, '/');
  if (!rel.startsWith('.')) { rel = './' + rel; }
  // Strip extension
  return rel.replace(/\.(ts|js|mjs|cjs)$/, '');
}
