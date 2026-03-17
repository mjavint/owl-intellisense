import {
  Diagnostic,
  DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { SymbolIndex } from '../analyzer/index';
import { getOwlImportedNames, toRange } from '../owl/patterns';

/**
 * Validates a document and returns diagnostics.
 */
export function validateDocument(
  uri: string,
  content: string,
  index: SymbolIndex
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  let ast: TSESTree.Program;
  try {
    ast = parse(content, {
      jsx: true,
      tolerant: true,
      loc: true,
      range: true,
    }) as TSESTree.Program;
  } catch {
    return diagnostics;
  }

  // Rule: normalize import path to @addon alias
  try {
    for (const node of ast.body) {
      if (node.type !== 'ImportDeclaration') { continue; }
      const src = node.source.value as string;
      const hasStaticSrc = src.includes('/static/src/') || src.includes('\\static\\src\\');
      if (hasStaticSrc) {
        const range = node.source.loc
          ? toRange(node.source.loc)
          : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
        diagnostics.push({
          severity: DiagnosticSeverity.Hint,
          range,
          message: `Import path can be simplified to an @addon alias.`,
          source: 'owl-intellisense',
          code: 'normalize-import-alias',
          data: { source: src },
        });
      } else if (src.startsWith('..') && (src.match(/\.\.\//g) ?? []).length >= 3) {
        const range = node.source.loc
          ? toRange(node.source.loc)
          : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
        diagnostics.push({
          severity: DiagnosticSeverity.Hint,
          range,
          message: `Long relative import — consider using @addon alias if this is an Odoo module.`,
          source: 'owl-intellisense',
          code: 'normalize-import-alias',
          data: { source: src },
        });
      }
    }
  } catch (err) {
    process.stderr.write(`[owl-diagnostics] Error checking import aliases for ${uri}: ${err}\n`);
  }

  try {
    const owlImportedNames = getOwlImportedNames(ast);

    // Walk AST nodes
    walkNode(ast, (node) => {
      // Rule 1: class extends Component but not from @odoo/owl
      if (node.type === 'ClassDeclaration' && node.superClass) {
        if (
          node.superClass.type === 'Identifier' &&
          node.superClass.name === 'Component' &&
          !owlImportedNames.has('Component')
        ) {
          const range = node.superClass.loc
            ? toRange(node.superClass.loc)
            : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
          diagnostics.push({
            range,
            severity: DiagnosticSeverity.Information,
            message:
              "Component does not extend @odoo/owl Component — OWL IntelliSense will not apply",
            source: 'owl-intellisense',
            code: 'owl-non-owl-component',
          });
        }
      }

      // Rules 2 & 3: unknown / missing required props
      // Look for JSX-like patterns or object literals in component usage
      // We detect object expressions passed as the second argument in component instantiation
      // Also scan for tagged template literals matching component patterns
      // For now, scan CallExpression with identifiers matching known components
      if (node.type === 'NewExpression') {
        if (node.callee.type === 'Identifier') {
          const compName = node.callee.name;
          const comp = index.getComponent(compName);
          if (comp && Object.keys(comp.props).length > 0) {
            // Check if props are passed as first argument (object)
            const firstArg = node.arguments[0];
            if (firstArg && firstArg.type === 'ObjectExpression') {
              const passedKeys = new Set(
                firstArg.properties
                  .filter((p): p is TSESTree.Property => p.type === 'Property')
                  .map((p) =>
                    p.key.type === 'Identifier'
                      ? p.key.name
                      : p.key.type === 'Literal'
                      ? String(p.key.value)
                      : null
                  )
                  .filter((k): k is string => k !== null)
              );

              // Rule 2: Unknown prop
              for (const key of passedKeys) {
                if (!(key in comp.props)) {
                  const propNode = firstArg.properties.find(
                    (p): p is TSESTree.Property =>
                      p.type === 'Property' &&
                      ((p.key.type === 'Identifier' && p.key.name === key) ||
                        (p.key.type === 'Literal' && p.key.value === key))
                  );
                  const range = propNode?.loc
                    ? toRange(propNode.loc)
                    : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
                  diagnostics.push({
                    range,
                    severity: DiagnosticSeverity.Warning,
                    message: `Unknown prop '${key}' for component '${compName}'`,
                    source: 'owl-intellisense',
                    code: 'owl-unknown-prop',
                  });
                }
              }

              // Rule 3: Missing required prop
              for (const [propName, propDef] of Object.entries(comp.props)) {
                if (!propDef.optional && !passedKeys.has(propName)) {
                  const range = firstArg.loc
                    ? toRange(firstArg.loc)
                    : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
                  diagnostics.push({
                    range,
                    severity: DiagnosticSeverity.Warning,
                    message: `Missing required prop '${propName}' for component '${compName}'`,
                    source: 'owl-intellisense',
                    code: 'owl-missing-prop',
                  });
                }
              }
            }
          }
        }
      }
    });
  } catch (err) {
    process.stderr.write(`[owl-diagnostics] Error validating ${uri}: ${err}\n`);
  }

  return diagnostics;
}

/**
 * Simple recursive AST walker.
 */
function walkNode(node: TSESTree.Node, visitor: (n: TSESTree.Node) => void): void {
  visitor(node);
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && 'type' in item) {
          walkNode(item as TSESTree.Node, visitor);
        }
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      walkNode(child as TSESTree.Node, visitor);
    }
  }
}
