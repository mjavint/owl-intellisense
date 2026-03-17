import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { OWL_HOOK_NAMES } from '../../owl/catalog';
import {
  walkWithAncestors, isInsideConditional,
  isInsideLoop, isInsideAsyncFunction, nodeToRange,
} from './astUtils';

export function checkHookRules(ast: TSESTree.Program): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walkWithAncestors(ast, (node, ancestors) => {
    if (node.type !== 'CallExpression') { return; }
    const call = node as TSESTree.CallExpression;
    const calleeName =
      call.callee.type === 'Identifier' ? (call.callee as TSESTree.Identifier).name : null;
    if (!calleeName || !OWL_HOOK_NAMES.has(calleeName)) { return; }

    const callLoc = call.callee.loc!;

    // Find setup MethodDefinition ancestor index
    const setupIdx = ancestors.findIndex(
      n =>
        n.type === 'MethodDefinition' &&
        (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
        ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
    );

    if (setupIdx === -1) {
      // Hook called outside setup()
      // Only flag if we're inside a class (avoid flagging top-level module calls)
      const insideClass = ancestors.some(n => n.type === 'ClassDeclaration' || n.type === 'ClassExpression');
      if (insideClass) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: nodeToRange(callLoc),
          message: `'${calleeName}' must be called inside setup(). OWL hooks cannot be used in lifecycle callbacks or other methods.`,
          source: 'owl-intellisense',
          code: 'owl/hook-outside-setup',
        });
      }
      return;
    }

    // Hook is inside setup — check for forbidden contexts
    if (isInsideLoop(ancestors, setupIdx)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: nodeToRange(callLoc),
        message: `'${calleeName}' cannot be called inside a loop. Hook call order must be stable across renders.`,
        source: 'owl-intellisense',
        code: 'owl/hook-in-loop',
      });
      return;
    }

    if (isInsideConditional(ancestors, setupIdx)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: nodeToRange(callLoc),
        message: `'${calleeName}' called inside a conditional. Hook call order must be consistent — move to top of setup().`,
        source: 'owl-intellisense',
        code: 'owl/hook-in-conditional',
      });
      return;
    }

    if (isInsideAsyncFunction(ancestors, setupIdx)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: nodeToRange(callLoc),
        message: `'${calleeName}' called inside an async function. Hooks must be called synchronously in setup().`,
        source: 'owl-intellisense',
        code: 'owl/hook-in-async',
      });
    }
  });

  return diagnostics;
}
