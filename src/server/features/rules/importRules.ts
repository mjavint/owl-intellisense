import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { OWL_HOOK_NAMES } from '../../owl/catalog';
import { nodeToRange, walkWithAncestors, AncestorStack } from './astUtils';
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
        source: 'owl-lsp',
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
        source: 'owl-lsp',
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
  // PERF: Use shared walkWithAncestors to avoid duplicated walk implementation
  walkWithAncestors(ast, (n: TSESTree.Node, _ancestors: AncestorStack) => {
    if (
      n.type === 'CallExpression' &&
      (n as TSESTree.CallExpression).callee?.type === 'Identifier'
    ) {
      const callee = (n as TSESTree.CallExpression).callee as TSESTree.Identifier;
      const name = callee.name;
      if (OWL_HOOK_NAMES.has(name) && !allImported.has(name)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: nodeToRange(callee.loc!),
          message: `'${name}' is not imported. Add: import { ${name} } from '@odoo/owl'`,
          source: 'owl-lsp',
          code: 'owl/missing-owl-import',
          data: { name, source: '@odoo/owl' },
        });
      }
    }
  });
  return diagnostics;
}

// ─── Unused imports detection ─────────────────────────────────────────────────

/**
 * owl/unused-import: Detect imported names that are never referenced in the file body.
 *
 * Skips type-only imports (we don't have type info) and side-effect imports.
 * Uses a simple identifier walk to collect all non-import references.
 */
export function checkUnusedImports(ast: TSESTree.Program): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Collect all imported local names with their location
  interface ImportedName {
    localName: string;
    loc: TSESTree.SourceLocation;
    declNode: TSESTree.ImportDeclaration;
  }
  const importedNames: ImportedName[] = [];

  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') { continue; }
    const decl = node as TSESTree.ImportDeclaration;
    // Side-effect import: import 'foo' — skip
    if (decl.specifiers.length === 0) { continue; }

    for (const spec of decl.specifiers) {
      importedNames.push({
        localName: spec.local.name,
        loc: spec.local.loc!,
        declNode: decl,
      });
    }
  }

  if (importedNames.length === 0) { return []; }

  // Collect all identifier usages outside import declarations
  const usedNames = new Set<string>();
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') { continue; }
    walkWithAncestors(node, (n) => {
      if (n.type === 'Identifier') {
        usedNames.add((n as TSESTree.Identifier).name);
      }
      // Also catch JSXIdentifier (components used in JSX)
      if ((n as any).type === 'JSXIdentifier') {
        usedNames.add((n as any).name as string);
      }
    });
  }

  // Report unused imports
  for (const { localName, loc, declNode } of importedNames) {
    if (!usedNames.has(localName)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Hint,
        range: nodeToRange(loc),
        message: `'${localName}' is imported but never used.`,
        source: 'owl-lsp',
        code: 'owl/unused-import',
        data: { localName, source: declNode.source.value as string },
      });
    }
  }

  return diagnostics;
}

// ─── Duplicate imports detection ─────────────────────────────────────────────

/**
 * owl/duplicate-import: Detect the same specifier imported from the same source
 * more than once, or the same source imported in multiple declarations.
 */
export function checkDuplicateImports(ast: TSESTree.Program): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Map: "source|specifier" → first occurrence loc
  const seen = new Map<string, TSESTree.SourceLocation>();
  // Map: source → first import decl loc (for detecting `import A from 'x'` + `import B from 'x'`)
  const seenSources = new Map<string, TSESTree.SourceLocation>();

  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') { continue; }
    const decl = node as TSESTree.ImportDeclaration;
    const src = decl.source.value as string;

    // Check for duplicate source (two separate import declarations from same module)
    if (seenSources.has(src)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: nodeToRange(decl.source.loc!),
        message: `Duplicate import from '${src}' — merge into a single import statement.`,
        source: 'owl-lsp',
        code: 'owl/duplicate-import',
        data: { source: src },
      });
    } else {
      seenSources.set(src, decl.source.loc!);
    }

    // Check for duplicate specifiers within the same source
    for (const spec of decl.specifiers) {
      const specName =
        spec.type === 'ImportSpecifier'
          ? (spec.imported.type === 'Identifier' ? spec.imported.name : (spec.imported as any).value as string)
          : spec.local.name;
      const key = `${src}|${specName}`;
      if (seen.has(key)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: nodeToRange(spec.loc!),
          message: `'${specName}' is already imported from '${src}'.`,
          source: 'owl-lsp',
          code: 'owl/duplicate-import-specifier',
          data: { specifier: specName, source: src },
        });
      } else {
        seen.set(key, spec.loc!);
      }
    }
  }

  return diagnostics;
}
