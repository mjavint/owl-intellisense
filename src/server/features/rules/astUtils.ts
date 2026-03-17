import type { TSESTree } from '@typescript-eslint/typescript-estree';

export type AncestorStack = TSESTree.Node[];

/**
 * Walk AST with ancestor stack. visitor receives (node, ancestors).
 */
export function walkWithAncestors(
  node: any,
  visitor: (node: TSESTree.Node, ancestors: AncestorStack) => void,
  ancestors: AncestorStack = []
): void {
  if (!node || typeof node !== 'object') { return; }
  if (node.type) {
    visitor(node as TSESTree.Node, ancestors);
    const nextAncestors = [...ancestors, node as TSESTree.Node];
    for (const key of Object.keys(node)) {
      if (key === 'parent') { continue; }
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) { walkWithAncestors(item, visitor, nextAncestors); }
      } else if (child && typeof child === 'object' && child.type) {
        walkWithAncestors(child, visitor, nextAncestors);
      }
    }
  }
}

/** Find nearest ancestor matching a predicate. */
export function nearestAncestor(
  ancestors: AncestorStack,
  predicate: (n: TSESTree.Node) => boolean
): TSESTree.Node | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (predicate(ancestors[i])) { return ancestors[i]; }
  }
  return undefined;
}

/** Check if any ancestor matches a predicate. */
export function hasAncestor(
  ancestors: AncestorStack,
  predicate: (n: TSESTree.Node) => boolean
): boolean {
  return ancestors.some(predicate);
}

/** Check if node is inside a setup() MethodDefinition. */
export function isInsideSetupMethod(ancestors: AncestorStack): boolean {
  return ancestors.some(
    n =>
      n.type === 'MethodDefinition' &&
      (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
      ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
  );
}

/** Check if node is inside a conditional (if/ternary/logical). */
export function isInsideConditional(ancestors: AncestorStack, setupAncestorIdx: number): boolean {
  for (let i = setupAncestorIdx + 1; i < ancestors.length; i++) {
    const t = ancestors[i].type;
    if (t === 'IfStatement' || t === 'ConditionalExpression' || t === 'LogicalExpression' || t === 'SwitchStatement') {
      return true;
    }
  }
  return false;
}

/** Check if node is inside a loop. */
export function isInsideLoop(ancestors: AncestorStack, setupAncestorIdx: number): boolean {
  for (let i = setupAncestorIdx + 1; i < ancestors.length; i++) {
    const n = ancestors[i];
    if (
      n.type === 'ForStatement' || n.type === 'ForInStatement' ||
      n.type === 'ForOfStatement' || n.type === 'WhileStatement' ||
      n.type === 'DoWhileStatement'
    ) { return true; }
    // forEach/map/filter/reduce/find
    if (
      n.type === 'CallExpression' &&
      (n as TSESTree.CallExpression).callee.type === 'MemberExpression'
    ) {
      const prop = ((n as TSESTree.CallExpression).callee as TSESTree.MemberExpression).property;
      if (prop.type === 'Identifier') {
        const iterators = new Set(['forEach', 'map', 'filter', 'reduce', 'find', 'some', 'every', 'flatMap']);
        if (iterators.has((prop as TSESTree.Identifier).name)) { return true; }
      }
    }
  }
  return false;
}

/** Check if node is inside an async function (ArrowFunction or FunctionExpression). */
export function isInsideAsyncFunction(ancestors: AncestorStack, setupAncestorIdx: number): boolean {
  for (let i = setupAncestorIdx + 1; i < ancestors.length; i++) {
    const n = ancestors[i];
    if (
      (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression') &&
      (n as TSESTree.ArrowFunctionExpression).async
    ) { return true; }
  }
  return false;
}

export function nodeToRange(loc: TSESTree.SourceLocation): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: { line: loc.start.line - 1, character: loc.start.column },
    end: { line: loc.end.line - 1, character: loc.end.column },
  };
}
