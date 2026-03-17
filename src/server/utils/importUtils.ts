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
 * Build the TextEdits needed to add `specifier` imported from `source`.
 * - If an import from `source` already exists: merge specifier in (sorted, no dup).
 * - If not: insert a new import after the last existing import line.
 * Returns [] if the specifier is already imported.
 */
export function buildAddImportEdits(
  docText: string,
  specifier: string,
  source: string
): TextEdit[] {
  let ast: TSESTree.Program;
  try {
    ast = parse(docText, { tolerant: true, loc: true }) as TSESTree.Program;
  } catch {
    return [];
  }

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
 * Check if a specifier is already imported from any source in the document.
 */
export function isSpecifierImported(docText: string, specifier: string): boolean {
  let ast: TSESTree.Program;
  try {
    ast = parse(docText, { tolerant: true, loc: true }) as TSESTree.Program;
  } catch {
    return false;
  }
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') { continue; }
    for (const s of node.specifiers) {
      if (s.type === 'ImportSpecifier') {
        const name = s.imported.type === 'Identifier' ? s.imported.name : (s.imported as TSESTree.StringLiteral).value as string;
        if (name === specifier) { return true; }
      }
      if (s.type === 'ImportDefaultSpecifier' && s.local.name === specifier) { return true; }
    }
  }
  return false;
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
