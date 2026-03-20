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
 * SC-08b: Detect `class X extends Component` where Component is NOT imported from @odoo/owl.
 * Emits an `information` diagnostic so OWL IntelliSense can warn that it won't apply.
 */
export function checkNonOwlComponentImport(ast: TSESTree.Program): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Build a map: localName → importSource for all imported specifiers
  const importSourceByLocal = new Map<string, string>();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') { continue; }
    const decl = node as TSESTree.ImportDeclaration;
    const src = decl.source.value as string;
    for (const spec of decl.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        importSourceByLocal.set(spec.local.name, src);
      } else if (spec.type === 'ImportDefaultSpecifier') {
        importSourceByLocal.set(spec.local.name, src);
      }
    }
  }

  // Walk class declarations looking for `extends <Identifier>`
  for (const node of ast.body) {
    let classNode: TSESTree.ClassDeclaration | null = null;

    if (node.type === 'ClassDeclaration') {
      classNode = node as TSESTree.ClassDeclaration;
    } else if (
      node.type === 'ExportNamedDeclaration' &&
      (node as TSESTree.ExportNamedDeclaration).declaration?.type === 'ClassDeclaration'
    ) {
      classNode = (node as TSESTree.ExportNamedDeclaration).declaration as TSESTree.ClassDeclaration;
    } else if (
      node.type === 'ExportDefaultDeclaration' &&
      (node as TSESTree.ExportDefaultDeclaration).declaration?.type === 'ClassDeclaration'
    ) {
      classNode = (node as TSESTree.ExportDefaultDeclaration).declaration as TSESTree.ClassDeclaration;
    }

    if (!classNode || !classNode.superClass) { continue; }
    if (classNode.superClass.type !== 'Identifier') { continue; }

    const superName = (classNode.superClass as TSESTree.Identifier).name;
    const importSrc = importSourceByLocal.get(superName);

    // Only flag if we can confirm it is imported from somewhere other than @odoo/owl
    if (importSrc !== undefined && importSrc !== '@odoo/owl') {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: nodeToRange(classNode.superClass.loc!),
        message: `Component does not extend @odoo/owl Component — OWL IntelliSense will not apply`,
        source: 'owl-intellisense',
        code: 'owl/non-owl-component-import',
        data: { superName, importSrc },
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
