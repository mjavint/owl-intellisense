import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { isOwlComponentClass, getOwlImportedNames } from '../../owl/patterns';
import { nodeToRange } from './astUtils';

export function checkComponentRules(ast: TSESTree.Program): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const owlNames = getOwlImportedNames(ast);
  const templateNames: Map<string, string> = new Map(); // templateName → componentName

  for (const node of ast.body) {
    if (node.type !== 'ClassDeclaration' || !(node as TSESTree.ClassDeclaration).id) { continue; }
    const classNode = node as TSESTree.ClassDeclaration;
    if (!isOwlComponentClass(classNode, owlNames)) { continue; }

    const className = classNode.id!.name;
    const members = classNode.body.body;

    let hasTemplate = false;
    let hasProps = false;
    let hasSetup = false;
    let templateValue: string | null = null;

    for (const member of members) {
      // static template
      if (
        member.type === 'PropertyDefinition' &&
        (member as TSESTree.PropertyDefinition).static &&
        (member as TSESTree.PropertyDefinition).key.type === 'Identifier' &&
        ((member as TSESTree.PropertyDefinition).key as TSESTree.Identifier).name === 'template'
      ) {
        hasTemplate = true;
        const val = (member as TSESTree.PropertyDefinition).value;
        if (val?.type === 'Literal' && typeof (val as TSESTree.StringLiteral).value === 'string') {
          templateValue = (val as TSESTree.StringLiteral).value as string;
        } else if (val?.type === 'TaggedTemplateExpression') {
          templateValue = `__inline__${className}`;
        } else if (val?.type === 'Identifier') {
          // Variable reference — can't validate statically
          diagnostics.push({
            severity: DiagnosticSeverity.Information,
            range: nodeToRange(val.loc!),
            message: `'${className}': template is a variable reference — cannot be validated statically.`,
            source: 'owl-intellisense',
            code: 'owl/template-ref-dynamic',
          });
          hasTemplate = true;
        }
      }

      // static props
      if (
        member.type === 'PropertyDefinition' &&
        (member as TSESTree.PropertyDefinition).static &&
        (member as TSESTree.PropertyDefinition).key.type === 'Identifier' &&
        ((member as TSESTree.PropertyDefinition).key as TSESTree.Identifier).name === 'props'
      ) {
        hasProps = true;
        const val = (member as TSESTree.PropertyDefinition).value;
        if (
          val &&
          val.type !== 'ObjectExpression' &&
          val.type !== 'ArrayExpression'
        ) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: nodeToRange(val.loc!),
            message: `'${className}': static props must be an object or array schema, got ${val.type}.`,
            source: 'owl-intellisense',
            code: 'owl/invalid-props-schema',
          });
        }
      }

      // setup()
      if (
        member.type === 'MethodDefinition' &&
        (member as TSESTree.MethodDefinition).key.type === 'Identifier' &&
        ((member as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
      ) {
        hasSetup = true;
      }
    }

    // owl/no-template: Component with no template (skip abstract — no props AND no setup)
    const isLikelyAbstract = !hasProps && !hasSetup;
    if (!hasTemplate && !isLikelyAbstract) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: nodeToRange(classNode.id!.loc!),
        message: `'${className}' extends Component but has no static template defined.`,
        source: 'owl-intellisense',
        code: 'owl/no-template',
      });
    }

    // owl/no-setup: has props but no setup
    if (hasProps && !hasSetup) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: nodeToRange(classNode.id!.loc!),
        message: `'${className}' defines static props but has no setup() method.`,
        source: 'owl-intellisense',
        code: 'owl/no-setup',
      });
    }

    // owl/duplicate-template-name
    if (templateValue) {
      if (templateNames.has(templateValue)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: nodeToRange(classNode.id!.loc!),
          message: `Duplicate template name '${templateValue}' — also used by '${templateNames.get(templateValue)}'.`,
          source: 'owl-intellisense',
          code: 'owl/duplicate-template-name',
        });
      } else {
        templateNames.set(templateValue, className);
      }
    }
  }

  return diagnostics;
}
