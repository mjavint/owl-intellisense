import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { SymbolIndex } from '../../analyzer/index';
import { walkWithAncestors, nodeToRange } from './astUtils';

const VALID_PROP_TYPES = new Set([
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Function', 'Date',
  'Symbol', 'Any',
]);

export function checkPropsRules(ast: TSESTree.Program, index: SymbolIndex): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Rule: owl/unknown-prop-type — validate types used in static props schemas
  for (const node of ast.body) {
    if (node.type !== 'ClassDeclaration' || !(node as TSESTree.ClassDeclaration).id) { continue; }
    const classNode = node as TSESTree.ClassDeclaration;

    for (const member of classNode.body.body) {
      if (
        member.type !== 'PropertyDefinition' ||
        !(member as TSESTree.PropertyDefinition).static ||
        (member as TSESTree.PropertyDefinition).key.type !== 'Identifier' ||
        ((member as TSESTree.PropertyDefinition).key as TSESTree.Identifier).name !== 'props'
      ) { continue; }

      const val = (member as TSESTree.PropertyDefinition).value;
      if (!val || val.type !== 'ObjectExpression') { continue; }

      for (const prop of (val as TSESTree.ObjectExpression).properties) {
        if (prop.type !== 'Property') { continue; }
        const propNode = prop as TSESTree.Property;
        const propValue = propNode.value;

        // Shorthand type: String, Number, etc.
        if (propValue.type === 'Identifier' && !VALID_PROP_TYPES.has((propValue as TSESTree.Identifier).name)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: nodeToRange(propValue.loc!),
            message: `Unknown prop type '${(propValue as TSESTree.Identifier).name}'. Expected one of: ${[...VALID_PROP_TYPES].join(', ')}.`,
            source: 'owl-intellisense',
            code: 'owl/unknown-prop-type',
          });
        }

        // Full schema: { type: X, ... }
        if (propValue.type === 'ObjectExpression') {
          for (const schemaProp of (propValue as TSESTree.ObjectExpression).properties) {
            if (schemaProp.type !== 'Property') { continue; }
            const sp = schemaProp as TSESTree.Property;
            if (sp.key.type === 'Identifier' && (sp.key as TSESTree.Identifier).name === 'type') {
              if (sp.value.type === 'Identifier' && !VALID_PROP_TYPES.has((sp.value as TSESTree.Identifier).name)) {
                diagnostics.push({
                  severity: DiagnosticSeverity.Warning,
                  range: nodeToRange(sp.value.loc!),
                  message: `Unknown prop type '${(sp.value as TSESTree.Identifier).name}'.`,
                  source: 'owl-intellisense',
                  code: 'owl/unknown-prop-type',
                });
              }
            }
          }
        }
      }
    }
  }

  // Rule: owl/missing-required-prop and owl/unknown-prop-passed
  // Detect `new ComponentName({ ... })` call sites
  walkWithAncestors(ast, (node, _ancestors) => {
    if (node.type !== 'NewExpression') { return; }
    const newExpr = node as TSESTree.NewExpression;
    if (newExpr.callee.type !== 'Identifier') { return; }
    const compName = (newExpr.callee as TSESTree.Identifier).name;
    const comp = index.getComponent(compName);
    if (!comp || Object.keys(comp.props).length === 0) { return; }

    const arg = newExpr.arguments[0];
    if (!arg || arg.type !== 'ObjectExpression') { return; }

    const passedKeys = new Set(
      (arg as TSESTree.ObjectExpression).properties
        .filter((p): p is TSESTree.Property =>
          p.type === 'Property' && p.key.type === 'Identifier')
        .map(p => ((p as TSESTree.Property).key as TSESTree.Identifier).name)
    );

    // Unknown props passed
    for (const key of passedKeys) {
      if (!(key in comp.props)) {
        const propNode = (arg as TSESTree.ObjectExpression).properties.find(
          (p): p is TSESTree.Property =>
            p.type === 'Property' && p.key.type === 'Identifier' &&
            ((p as TSESTree.Property).key as TSESTree.Identifier).name === key
        );
        if (propNode) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: nodeToRange(propNode.key.loc!),
            message: `Unknown prop '${key}' for '${compName}'. Not in component's static props.`,
            source: 'owl-intellisense',
            code: 'owl/unknown-prop-passed',
          });
        }
      }
    }

    // Missing required props
    for (const [propName, propDef] of Object.entries(comp.props)) {
      if (!propDef.optional && !passedKeys.has(propName)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: nodeToRange(newExpr.callee.loc!),
          message: `Missing required prop '${propName}' for '${compName}'.`,
          source: 'owl-intellisense',
          code: 'owl/missing-required-prop',
        });
      }
    }
  });

  return diagnostics;
}
