import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { OWL_HOOK_NAMES } from '../../owl/catalog';
import { nodeToRange } from './astUtils';
import { inferAliasFromPath } from '../../resolver/addonDetector';

export function checkImportRules(ast: TSESTree.Program): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') { continue; }
    const decl = node as TSESTree.ImportDeclaration;
    const src = decl.source.value as string;

    // owl/normalize-import: path contains /static/src/ or is 3+ level relative
    const hasStaticSrc = src.includes('/static/src/') || src.includes('\\static\\src\\');
    const longRelative = src.startsWith('..') && (src.match(/\.\.\//g) ?? []).length >= 3;

    if (hasStaticSrc || longRelative) {
      // Only flag if we can compute an alias for it
      const inferredAlias = hasStaticSrc ? inferAliasFromPath(src) : undefined;
      diagnostics.push({
        severity: DiagnosticSeverity.Hint,
        range: nodeToRange(decl.source.loc!),
        message: inferredAlias
          ? `Use alias: '${inferredAlias}' instead of this path.`
          : `Long relative import — consider using @addon alias if this is an Odoo module.`,
        source: 'owl-intellisense',
        code: 'owl/normalize-import',
        data: { source: src },
      });
    }
  }

  return diagnostics;
}

/**
 * Check if OWL hooks used in file are imported from @odoo/owl.
 * Emits owl/missing-owl-import for each unimported OWL hook symbol.
 */
export function checkMissingOwlImports(
  ast: TSESTree.Program,
  _owlImported: Set<string>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Collect all locally imported names (any source)
  const allImported = new Set<string>();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') { continue; }
    for (const spec of (node as TSESTree.ImportDeclaration).specifiers) {
      allImported.add(spec.local.name);
    }
  }

  // Walk call expressions for OWL hook names not imported
  function walk(n: any): void {
    if (!n || typeof n !== 'object') { return; }
    if (n.type === 'CallExpression' && n.callee?.type === 'Identifier') {
      const name = n.callee.name as string;
      if (OWL_HOOK_NAMES.has(name) && !allImported.has(name)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: nodeToRange(n.callee.loc!),
          message: `'${name}' is not imported. Add: import { ${name} } from '@odoo/owl'`,
          source: 'owl-intellisense',
          code: 'owl/missing-owl-import',
          data: { name, source: '@odoo/owl' },
        });
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'parent') { continue; }
      const child = n[key];
      if (Array.isArray(child)) { child.forEach(walk); }
      else if (child && typeof child === 'object' && child.type) { walk(child); }
    }
  }
  walk(ast);
  return diagnostics;
}
