import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { Range } from 'vscode-languageserver-types';
import { PropDef, OdooService, OdooRegistry, ExportedFunction, ImportRecord } from '../../shared/types';

/**
 * Returns the set of names imported from '@odoo/owl' in the given AST.
 */
export function getOwlImportedNames(ast: TSESTree.Program): Set<string> {
  const names = new Set<string>();
  for (const node of ast.body) {
    if (
      node.type === 'ImportDeclaration' &&
      node.source.value === '@odoo/owl'
    ) {
      for (const specifier of node.specifiers) {
        if (
          specifier.type === 'ImportSpecifier' ||
          specifier.type === 'ImportDefaultSpecifier' ||
          specifier.type === 'ImportNamespaceSpecifier'
        ) {
          names.add(specifier.local.name);
        }
      }
    }
  }
  return names;
}

/**
 * Returns true if the given ClassDeclaration extends OWL Component
 * (i.e., superClass is an Identifier whose name is in owlImportedNames).
 */
export function isOwlComponentClass(
  node: TSESTree.ClassDeclaration,
  owlImportedNames: Set<string>
): boolean {
  if (!node.superClass) {return false;}
  if (node.superClass.type === 'Identifier') {
    return owlImportedNames.has(node.superClass.name);
  }
  return false;
}

/**
 * Extracts static props = { ... } from a class body.
 * Handles:
 *   - Shorthand: propName: String  (Identifier value)
 *   - Full schema: propName: { type: String, optional: true, validate: fn }
 *   - Array types: propName: [String, Number]  (ArrayExpression of Identifiers)
 */
export function extractStaticProps(
  classNode: TSESTree.ClassDeclaration
): Record<string, PropDef> {
  const props: Record<string, PropDef> = {};

  for (const member of classNode.body.body) {
    // PropertyDefinition with static === true and key.name === 'props'
    if (
      member.type === 'PropertyDefinition' &&
      member.static === true &&
      member.key.type === 'Identifier' &&
      member.key.name === 'props' &&
      member.value !== null
    ) {
      const value = member.value;
      if (value.type !== 'ObjectExpression') {continue;}

      for (const prop of value.properties) {
        if (prop.type !== 'Property') {continue;}

        const keyName =
          prop.key.type === 'Identifier'
            ? prop.key.name
            : prop.key.type === 'Literal'
            ? String(prop.key.value)
            : null;

        if (!keyName) {continue;}

        const propValue = prop.value;

        if (propValue.type === 'Identifier') {
          // Shorthand: propName: String
          props[keyName] = {
            type: propValue.name,
            optional: false,
            validate: false,
          };
        } else if (propValue.type === 'ArrayExpression') {
          // Array type: propName: [String, Number]
          const typeNames = propValue.elements
            .filter(
              (el): el is TSESTree.Identifier =>
                el !== null && el.type === 'Identifier'
            )
            .map((el) => el.name)
            .join(' | ');
          props[keyName] = {
            type: typeNames || 'unknown',
            optional: false,
            validate: false,
          };
        } else if (propValue.type === 'ObjectExpression') {
          // Full schema: propName: { type: String, optional: true, validate: fn }
          let type = 'unknown';
          let optional = false;
          let validate = false;

          for (const schemaProp of propValue.properties) {
            if (schemaProp.type !== 'Property') {continue;}
            const schemaKey =
              schemaProp.key.type === 'Identifier' ? schemaProp.key.name : null;
            if (!schemaKey) {continue;}

            const schemaVal = schemaProp.value;
            if (schemaKey === 'type') {
              if (schemaVal.type === 'Identifier') {
                type = schemaVal.name;
              } else if (schemaVal.type === 'ArrayExpression') {
                type = schemaVal.elements
                  .filter(
                    (el): el is TSESTree.Identifier =>
                      el !== null && el.type === 'Identifier'
                  )
                  .map((el) => el.name)
                  .join(' | ');
              }
            } else if (schemaKey === 'optional') {
              if (schemaVal.type === 'Literal') {
                optional = Boolean(schemaVal.value);
              }
            } else if (schemaKey === 'validate') {
              validate = true;
            }
          }

          props[keyName] = { type, optional, validate };
        }
      }
      break; // Only one static props definition expected
    }
  }

  return props;
}

/**
 * Extracts static template = "TemplateName" or static template = xml`...` from a class body.
 */
export function extractTemplateRef(
  classNode: TSESTree.ClassDeclaration
): string | undefined {
  for (const member of classNode.body.body) {
    if (
      member.type === 'PropertyDefinition' &&
      member.static === true &&
      member.key.type === 'Identifier' &&
      member.key.name === 'template' &&
      member.value !== null
    ) {
      const value = member.value;
      if (value.type === 'Literal' && typeof value.value === 'string') {
        return value.value;
      }
      // Tagged template: xml`TemplateName`
      if (value.type === 'TaggedTemplateExpression') {
        const quasi = value.quasi;
        if (quasi.quasis.length > 0) {
          return quasi.quasis[0].value.cooked ?? quasi.quasis[0].value.raw;
        }
      }
      // Plain template literal
      if (value.type === 'TemplateLiteral') {
        if (value.quasis.length > 0) {
          return value.quasis[0].value.cooked ?? value.quasis[0].value.raw;
        }
      }
    }
  }
  return undefined;
}

/**
 * Converts a TSESTree SourceLocation (1-based lines) to an LSP Range (0-based lines).
 */
export function toRange(loc: TSESTree.SourceLocation): Range {
  return {
    start: {
      line: loc.start.line - 1,
      character: loc.start.column,
    },
    end: {
      line: loc.end.line - 1,
      character: loc.end.column,
    },
  };
}

/**
 * Extract all import declarations from an AST.
 */
export function extractImports(ast: TSESTree.Program, uri: string): ImportRecord[] {
  const records: ImportRecord[] = [];
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') {continue;}
    const source = node.source.value as string;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        const importedName = spec.imported.type === 'Identifier'
          ? spec.imported.name
          : (spec.imported as { value: string }).value;
        records.push({
          specifier: importedName,
          source,
          localName: spec.local.name,
          uri,
          range: toRange(spec.loc!),
        });
      } else if (spec.type === 'ImportDefaultSpecifier') {
        records.push({
          specifier: 'default',
          source,
          localName: spec.local.name,
          uri,
          range: toRange(spec.loc!),
        });
      }
    }
  }
  return records;
}

/**
 * Detect the local name bound to 'registry' from @web/core/registry.
 */
function getRegistryLocalName(ast: TSESTree.Program): string | null {
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') {continue;}
    const src = node.source.value as string;
    if (src.includes('registry') || src.includes('@web/core/registry')) {
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportSpecifier') {
          const imported = spec.imported.type === 'Identifier' ? spec.imported.name : (spec.imported as { value: string }).value;
          if (imported === 'registry') {return spec.local.name;}
        }
      }
    }
  }
  return null;
}

/**
 * Walk all AST nodes recursively, calling visitor for each.
 */
function walkAst(node: unknown, visitor: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') {return;}
  const n = node as Record<string, unknown>;
  if (n['type']) {visitor(n);}
  for (const key of Object.keys(n)) {
    if (key === 'parent') {continue;}
    const child = n[key];
    if (Array.isArray(child)) {
      child.forEach(c => walkAst(c, visitor));
    } else if (child && typeof child === 'object' && (child as Record<string, unknown>)['type']) {
      walkAst(child, visitor);
    }
  }
}

/**
 * Extract Odoo service definitions.
 * Detects: registry.category('services').add('name', serviceObj)
 */
export function extractServices(ast: TSESTree.Program, uri: string, filePath: string): OdooService[] {
  const services: OdooService[] = [];

  walkAst(ast, (node) => {
    // Pattern: registry.category('services').add('name', value)
    if (
      node['type'] === 'CallExpression' &&
      (node['callee'] as Record<string, unknown>)?.['type'] === 'MemberExpression' &&
      ((node['callee'] as Record<string, unknown>)?.['property'] as Record<string, unknown>)?.['type'] === 'Identifier' &&
      ((node['callee'] as Record<string, unknown>)?.['property'] as Record<string, unknown>)?.['name'] === 'add'
    ) {
      const callee = node['callee'] as Record<string, unknown>;
      const categoryCall = callee['object'] as Record<string, unknown>;
      if (
        categoryCall?.['type'] === 'CallExpression' &&
        (categoryCall['callee'] as Record<string, unknown>)?.['type'] === 'MemberExpression' &&
        ((categoryCall['callee'] as Record<string, unknown>)?.['property'] as Record<string, unknown>)?.['type'] === 'Identifier' &&
        ((categoryCall['callee'] as Record<string, unknown>)?.['property'] as Record<string, unknown>)?.['name'] === 'category'
      ) {
        const catArgs = categoryCall['arguments'] as Record<string, unknown>[];
        const catArg = catArgs?.[0];
        if (catArg?.['type'] === 'Literal' && catArg['value'] === 'services') {
          const nodeArgs = node['arguments'] as Record<string, unknown>[];
          const nameArg = nodeArgs?.[0];
          const name = nameArg?.['type'] === 'Literal' && typeof nameArg['value'] === 'string'
            ? nameArg['value'] : null;
          const valArg = nodeArgs?.[1];
          const localName = valArg?.['type'] === 'Identifier'
            ? (valArg['name'] as string)
            : (name ?? 'unknown');
          if (name) {
            const loc = node['loc'] as TSESTree.SourceLocation;
            services.push({ name, localName, filePath, uri, range: toRange(loc) });
          }
        }
      }
    }
  });

  return services;
}

/**
 * Extract registry.category(X).add(key, value) calls for all categories.
 */
export function extractRegistries(ast: TSESTree.Program, uri: string, filePath: string): OdooRegistry[] {
  const registries: OdooRegistry[] = [];

  walkAst(ast, (node) => {
    if (
      node['type'] === 'CallExpression' &&
      (node['callee'] as Record<string, unknown>)?.['type'] === 'MemberExpression' &&
      ((node['callee'] as Record<string, unknown>)?.['property'] as Record<string, unknown>)?.['type'] === 'Identifier' &&
      ((node['callee'] as Record<string, unknown>)?.['property'] as Record<string, unknown>)?.['name'] === 'add'
    ) {
      const callee = node['callee'] as Record<string, unknown>;
      const categoryCall = callee['object'] as Record<string, unknown>;
      if (
        categoryCall?.['type'] === 'CallExpression' &&
        (categoryCall['callee'] as Record<string, unknown>)?.['type'] === 'MemberExpression' &&
        ((categoryCall['callee'] as Record<string, unknown>)?.['property'] as Record<string, unknown>)?.['type'] === 'Identifier' &&
        ((categoryCall['callee'] as Record<string, unknown>)?.['property'] as Record<string, unknown>)?.['name'] === 'category'
      ) {
        const catArgs = categoryCall['arguments'] as Record<string, unknown>[];
        const catArg = catArgs?.[0];
        const category = catArg?.['type'] === 'Literal' && typeof catArg['value'] === 'string'
          ? catArg['value'] : null;
        const nodeArgs = node['arguments'] as Record<string, unknown>[];
        const keyArg = nodeArgs?.[0];
        const key = keyArg?.['type'] === 'Literal' && typeof keyArg['value'] === 'string'
          ? keyArg['value'] : null;
        const valArg = nodeArgs?.[1];
        const localName = valArg?.['type'] === 'Identifier'
          ? (valArg['name'] as string)
          : (key ?? 'unknown');
        if (category && key) {
          const loc = node['loc'] as TSESTree.SourceLocation;
          registries.push({ category, key, localName, filePath, uri, range: toRange(loc) });
        }
      }
    }
  });

  return registries;
}

/**
 * Build a human-readable parameter signature string from a list of TSESTree parameters.
 */
function getParamSignature(params: TSESTree.Parameter[]): string {
  return params.map(p => {
    if (p.type === 'Identifier') {return p.name;}
    if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {return `${p.left.name}?`;}
    if (p.type === 'RestElement' && p.argument.type === 'Identifier') {return `...${p.argument.name}`;}
    return '?';
  }).join(', ');
}

/**
 * Extract a JSDoc comment (/** ... *\/) immediately preceding a node.
 * Looks at the raw source text before the node's start offset.
 */
function extractJsDoc(source: string, nodeStart: number): string | undefined {
  const before = source.substring(0, nodeStart).trimEnd();
  if (!before.endsWith('*/')) {return undefined;}
  const commentStart = before.lastIndexOf('/**');
  if (commentStart === -1) {return undefined;}
  const raw = before.substring(commentStart);
  // Strip leading /** and trailing */ and leading * on each line
  return raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();
}

/**
 * Extract named exported functions and arrow functions.
 */
export function extractExportedFunctions(ast: TSESTree.Program, uri: string, filePath: string, source?: string): ExportedFunction[] {
  const fns: ExportedFunction[] = [];

  for (const node of ast.body) {
    // export function foo() {}
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'FunctionDeclaration' &&
      node.declaration.id
    ) {
      const n = node as TSESTree.ExportNamedDeclaration & { declaration: TSESTree.FunctionDeclaration };
      const name = n.declaration.id!.name;
      const sig = `${name}(${getParamSignature(n.declaration.params)})`;
      const jsDoc = source ? extractJsDoc(source, node.range![0]) : undefined;
      fns.push({ name, filePath, uri, range: toRange(node.loc!), isDefault: false, signature: sig, jsDoc });
    }
    // export const foo = () => {} or export const foo = function() {}
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'VariableDeclaration'
    ) {
      for (const decl of (node as TSESTree.ExportNamedDeclaration & { declaration: TSESTree.VariableDeclaration }).declaration.declarations) {
        if (decl.id.type !== 'Identifier') {continue;}
        const isFunc = decl.init?.type === 'ArrowFunctionExpression' || decl.init?.type === 'FunctionExpression';
        if (isFunc) {
          const name = (decl.id as TSESTree.Identifier).name;
          const initNode = decl.init as TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;
          const sig = `${name}(${getParamSignature(initNode.params)})`;
          const jsDoc = source ? extractJsDoc(source, node.range![0]) : undefined;
          fns.push({ name, filePath, uri, range: toRange(decl.loc!), isDefault: false, signature: sig, jsDoc });
        } else {
          // export const foo = value (non-function: objects, strings, classes exported as const, etc.)
          const name = (decl.id as TSESTree.Identifier).name;
          const jsDoc = source ? extractJsDoc(source, decl.range?.[0] ?? 0) : undefined;
          fns.push({
            name,
            filePath,
            uri,
            range: toRange(decl.loc!),
            isDefault: false,
            signature: `const ${name}`,
            jsDoc,
          });
        }
      }
    }
    // export { name as alias } re-exports
    if (node.type === 'ExportNamedDeclaration' && !node.declaration && node.specifiers.length > 0) {
      for (const spec of node.specifiers) {
        if (spec.type !== 'ExportSpecifier') {continue;}
        const exportedName = spec.exported.type === 'Identifier'
          ? spec.exported.name
          : (spec.exported as { value: string }).value;
        fns.push({
          name: exportedName,
          filePath,
          uri,
          range: toRange(spec.loc!),
          isDefault: false,
          signature: exportedName,
        });
      }
    }
    // export default function
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      if (decl.type === 'FunctionDeclaration' && decl.id) {
        const name = decl.id.name;
        const sig = `${name}(${getParamSignature(decl.params)})`;
        const jsDoc = source ? extractJsDoc(source, node.range![0]) : undefined;
        fns.push({ name, filePath, uri, range: toRange(node.loc!), isDefault: true, signature: sig, jsDoc });
      }
    }
  }

  return fns;
}

/**
 * Determine the cursor context for go-to-definition.
 */
export interface CursorContext {
  type: 'import-specifier' | 'import-path' | 'identifier' | 'unknown';
  name?: string;        // identifier or specifier name
  source?: string;      // import source if type is import-path or import-specifier
  range?: Range;
}

export function getCursorContext(ast: TSESTree.Program, line: number, character: number): CursorContext {
  // line and character are 0-based (LSP)
  const astLine = line + 1; // TSESTree is 1-based

  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') {continue;}
    const loc = node.loc!;
    if (astLine < loc.start.line || astLine > loc.end.line) {continue;}

    // Check if cursor is on the source string
    const srcLoc = node.source.loc!;
    if (
      astLine === srcLoc.start.line &&
      character >= srcLoc.start.column &&
      character <= srcLoc.end.column
    ) {
      return { type: 'import-path', source: node.source.value as string, range: toRange(srcLoc) };
    }

    // Check if cursor is on a specifier
    for (const spec of node.specifiers) {
      const sLoc = spec.loc!;
      if (
        astLine >= sLoc.start.line && astLine <= sLoc.end.line &&
        character >= sLoc.start.column && character <= sLoc.end.column
      ) {
        const importedName = spec.type === 'ImportSpecifier'
          ? (spec.imported.type === 'Identifier' ? spec.imported.name : (spec.imported as { value: string }).value)
          : spec.local.name;
        return {
          type: 'import-specifier',
          name: importedName,
          source: node.source.value as string,
          range: toRange(sLoc),
        };
      }
    }
  }

  return { type: 'unknown' };
}
