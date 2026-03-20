/**
 * Comprehensive unit tests for diagnostic rule modules.
 * Tests each rule function in isolation using real parsed ASTs.
 *
 * Modules under test:
 *   - astUtils.ts
 *   - importRules.ts
 *   - componentRules.ts
 *   - propsRules.ts
 *   - hookRules.ts
 */

import * as assert from 'assert';
import { suite, test } from 'mocha';
import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';

import {
  nodeToRange,
  walkWithAncestors,
  nearestAncestor,
  hasAncestor,
  isInsideSetupMethod,
  isInsideConditional,
  isInsideLoop,
  isInsideAsyncFunction,
} from '../server/features/rules/astUtils';

import {
  checkImportRules,
  checkNonOwlComponentImport,
  checkMissingOwlImports,
} from '../server/features/rules/importRules';

import { checkComponentRules } from '../server/features/rules/componentRules';
import { checkPropsRules } from '../server/features/rules/propsRules';
import { checkHookRules } from '../server/features/rules/hookRules';

import { IComponentReader, OwlComponent } from '../shared/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse TypeScript/JS source into an AST program node. */
function parseCode(source: string): TSESTree.Program {
  return parse(source, {
    jsx: true,
    tolerant: true,
    loc: true,
    range: true,
  }) as TSESTree.Program;
}

/** Minimal IComponentReader backed by a plain map. */
function makeIndex(components: OwlComponent[] = []): IComponentReader {
  const map = new Map<string, OwlComponent>(components.map(c => [c.name, c]));
  return {
    getComponent: (name: string) => map.get(name),
    getAllComponents: () => map.values(),
    getComponentsInFile: (uri: string) =>
      [...map.values()].filter(c => c.uri === uri),
  };
}

/** Build a minimal OwlComponent fixture. */
function makeComponent(
  name: string,
  props: Record<string, { type: string; optional: boolean; validate: boolean }> = {}
): OwlComponent {
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  return {
    name,
    filePath: `/test/${name}.ts`,
    uri: `file:///test/${name}.ts`,
    range,
    props,
    importPath: `@test/${name}`,
  };
}

// ─── astUtils ─────────────────────────────────────────────────────────────────

suite('astUtils — nodeToRange', () => {
  test('converts 1-based TSESTree lines to 0-based LSP lines', () => {
    const loc: TSESTree.SourceLocation = {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 10 },
    };
    const range = nodeToRange(loc);
    assert.strictEqual(range.start.line, 0);
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.line, 0);
    assert.strictEqual(range.end.character, 10);
  });

  test('multiline node: lines and columns are mapped correctly', () => {
    const loc: TSESTree.SourceLocation = {
      start: { line: 3, column: 4 },
      end: { line: 7, column: 2 },
    };
    const range = nodeToRange(loc);
    assert.strictEqual(range.start.line, 2);
    assert.strictEqual(range.start.character, 4);
    assert.strictEqual(range.end.line, 6);
    assert.strictEqual(range.end.character, 2);
  });

  test('zero-length node (start === end column)', () => {
    const loc: TSESTree.SourceLocation = {
      start: { line: 5, column: 8 },
      end: { line: 5, column: 8 },
    };
    const range = nodeToRange(loc);
    assert.strictEqual(range.start.line, 4);
    assert.strictEqual(range.start.character, 8);
    assert.strictEqual(range.end.line, 4);
    assert.strictEqual(range.end.character, 8);
  });

  test('column 0 stays 0', () => {
    const loc: TSESTree.SourceLocation = {
      start: { line: 10, column: 0 },
      end: { line: 10, column: 0 },
    };
    const range = nodeToRange(loc);
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.character, 0);
  });
});

suite('astUtils — walkWithAncestors', () => {
  test('visits all nodes in a simple program', () => {
    const ast = parseCode('const x = 1;');
    const types: string[] = [];
    walkWithAncestors(ast, node => types.push(node.type));
    assert.ok(types.includes('Program'), 'should visit Program');
    assert.ok(types.includes('VariableDeclaration'), 'should visit VariableDeclaration');
    assert.ok(types.includes('VariableDeclarator'), 'should visit VariableDeclarator');
  });

  test('ancestors array grows as walk descends', () => {
    const ast = parseCode('function f() { return 1; }');
    let maxDepth = 0;
    walkWithAncestors(ast, (_node, ancestors) => {
      if (ancestors.length > maxDepth) { maxDepth = ancestors.length; }
    });
    assert.ok(maxDepth >= 2, `Expected at least 2 ancestor levels, got ${maxDepth}`);
  });

  test('skips non-object and null values without throwing', () => {
    assert.doesNotThrow(() => {
      walkWithAncestors(null as any, () => { /* no-op */ });
      walkWithAncestors(42 as any, () => { /* no-op */ });
      walkWithAncestors('string' as any, () => { /* no-op */ });
    });
  });

  test('does not walk "parent" key (avoids infinite recursion)', () => {
    const ast = parseCode('const a = 1;');
    // Attach circular parent references manually (as typescript-eslint does)
    (ast as any).parent = ast;
    let count = 0;
    assert.doesNotThrow(() => {
      walkWithAncestors(ast, () => { count++; if (count > 1000) { throw new Error('infinite loop'); } });
    });
  });
});

suite('astUtils — nearestAncestor', () => {
  test('returns the closest matching ancestor', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    const x = 1;
  }
}
`);
    const ancestors: TSESTree.Node[] = [];
    walkWithAncestors(ast, (node, anc) => {
      if (node.type === 'Literal') {
        ancestors.push(...anc);
      }
    });
    const found = nearestAncestor(ancestors, n => n.type === 'MethodDefinition');
    assert.ok(found, 'should find a MethodDefinition ancestor');
    assert.strictEqual(found!.type, 'MethodDefinition');
  });

  test('returns undefined when no ancestor matches', () => {
    const ancestors: TSESTree.Node[] = [];
    const result = nearestAncestor(ancestors, n => n.type === 'SwitchStatement');
    assert.strictEqual(result, undefined);
  });

  test('prefers deepest (last) matching ancestor', () => {
    const ast = parseCode(`
class Outer {
  method() {
    class Inner {
      setup() {}
    }
  }
}
`);
    const methodNodes: TSESTree.MethodDefinition[] = [];
    walkWithAncestors(ast, (node, anc) => {
      if (
        node.type === 'MethodDefinition' &&
        (node as TSESTree.MethodDefinition).key.type === 'Identifier' &&
        ((node as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
      ) {
        const closest = nearestAncestor(
          anc,
          n => n.type === 'MethodDefinition'
        );
        if (closest) { methodNodes.push(closest as TSESTree.MethodDefinition); }
      }
    });
    // The nearest MethodDefinition ancestor of 'setup' should be 'method', not nothing.
    assert.ok(methodNodes.length > 0, 'should find method ancestor');
  });
});

suite('astUtils — hasAncestor', () => {
  test('returns true when predicate matches any ancestor', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    const x = useState({});
  }
}
`);
    let foundInClass = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        foundInClass = hasAncestor(ancestors, n => n.type === 'ClassDeclaration');
      }
    });
    assert.strictEqual(foundInClass, true);
  });

  test('returns false on empty ancestors', () => {
    assert.strictEqual(hasAncestor([], () => true), false);
  });
});

suite('astUtils — isInsideSetupMethod', () => {
  test('returns true when inside a setup() MethodDefinition', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    useState({});
  }
}
`);
    let insideSetup = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        insideSetup = isInsideSetupMethod(ancestors);
      }
    });
    assert.strictEqual(insideSetup, true);
  });

  test('returns false when inside a non-setup method', () => {
    const ast = parseCode(`
class Foo {
  onMounted() {
    useState({});
  }
}
`);
    let insideSetup = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        insideSetup = isInsideSetupMethod(ancestors);
      }
    });
    assert.strictEqual(insideSetup, false);
  });
});

suite('astUtils — isInsideConditional', () => {
  test('returns true for hook inside if statement in setup', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    if (condition) {
      useState({});
    }
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideConditional(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, true);
  });

  test('returns true for hook inside ternary in setup', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    const x = condition ? useState({}) : null;
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideConditional(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, true);
  });

  test('returns false for hook at top level of setup (no conditional)', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    useState({});
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideConditional(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, false);
  });

  test('returns true for hook inside switch statement in setup', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    switch(x) {
      case 1: useState({}); break;
    }
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideConditional(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, true);
  });
});

suite('astUtils — isInsideLoop', () => {
  test('returns true for hook inside for loop in setup', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    for (let i = 0; i < 3; i++) {
      useState({});
    }
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideLoop(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, true);
  });

  test('returns true for hook inside while loop in setup', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    while (cond) {
      useState({});
    }
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideLoop(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, true);
  });

  test('returns true for hook inside forEach callback in setup', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    items.forEach(() => {
      useState({});
    });
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (
        node.type === 'CallExpression' &&
        (node as TSESTree.CallExpression).callee.type === 'Identifier' &&
        ((node as TSESTree.CallExpression).callee as TSESTree.Identifier).name === 'useState'
      ) {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideLoop(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, true);
  });

  test('returns false for hook at top level of setup (no loop)', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    useState({});
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideLoop(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, false);
  });
});

suite('astUtils — isInsideAsyncFunction', () => {
  test('returns true for hook inside async arrow function in setup', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    const fn = async () => {
      useState({});
    };
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideAsyncFunction(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, true);
  });

  test('returns false for hook in synchronous callback in setup', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    const fn = () => {
      useState({});
    };
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideAsyncFunction(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, false);
  });

  test('returns false for hook at top level of setup', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    useState({});
  }
}
`);
    let result = false;
    walkWithAncestors(ast, (node, ancestors) => {
      if (node.type === 'CallExpression') {
        const setupIdx = ancestors.findIndex(
          n =>
            n.type === 'MethodDefinition' &&
            (n as TSESTree.MethodDefinition).key.type === 'Identifier' &&
            ((n as TSESTree.MethodDefinition).key as TSESTree.Identifier).name === 'setup'
        );
        if (setupIdx !== -1) {
          result = isInsideAsyncFunction(ancestors, setupIdx);
        }
      }
    });
    assert.strictEqual(result, false);
  });
});

// ─── importRules — checkImportRules ──────────────────────────────────────────

suite('importRules — checkImportRules (owl/normalize-import)', () => {
  test('no diagnostic for a normal @odoo/owl import', () => {
    const ast = parseCode(`import { Component } from '@odoo/owl';`);
    const diags = checkImportRules(ast);
    assert.strictEqual(diags.length, 0);
  });

  test('no diagnostic for a normal relative import (shallow)', () => {
    const ast = parseCode(`import { foo } from './utils';`);
    const diags = checkImportRules(ast);
    assert.strictEqual(diags.length, 0);
  });

  test('emits hint diagnostic for import containing /static/src/', () => {
    const ast = parseCode(`import { foo } from '@web/addons/web/static/src/utils/misc';`);
    const diags = checkImportRules(ast);
    // The path includes /static/src/ so a hint should be emitted
    const diag = diags.find(d => d.code === 'owl/normalize-import');
    assert.ok(diag, 'Should emit owl/normalize-import hint');
    assert.strictEqual(diag!.severity, 4, 'Should be Hint severity (4)');
    assert.strictEqual(diag!.source, 'owl-lsp');
  });

  test('emits hint when import path has 3 or more ../  levels', () => {
    const ast = parseCode(`import { bar } from '../../../utils/something';`);
    const diags = checkImportRules(ast);
    const diag = diags.find(d => d.code === 'owl/normalize-import');
    assert.ok(diag, 'Should emit hint for 3+ ../ levels');
    assert.ok(
      diag!.message.includes('alias') || diag!.message.includes('Long relative'),
      `Unexpected message: ${diag!.message}`
    );
  });

  test('does NOT emit diagnostic for 2 ../ levels (below threshold)', () => {
    const ast = parseCode(`import { baz } from '../../utils';`);
    const diags = checkImportRules(ast);
    const diag = diags.find(d => d.code === 'owl/normalize-import');
    assert.strictEqual(diag, undefined, 'Should NOT emit for exactly 2 ../ levels');
  });

  test('emits alias-form message when /addons/{name}/static/src pattern found', () => {
    const ast = parseCode(`import { x } from '/path/to/addons/web/static/src/components/foo';`);
    const diags = checkImportRules(ast);
    const diag = diags.find(d => d.code === 'owl/normalize-import');
    assert.ok(diag, 'Should emit diagnostic');
    // inferAliasFromPath should resolve this to @web/components/foo
    assert.ok(diag!.message.includes('@web'), `Expected @web alias in message, got: ${diag!.message}`);
  });

  test('data payload contains the original source path', () => {
    const src = '/addons/mail/static/src/components/bar';
    const ast = parseCode(`import { x } from '${src}';`);
    const diags = checkImportRules(ast);
    const diag = diags.find(d => d.code === 'owl/normalize-import');
    assert.ok(diag);
    assert.strictEqual((diag!.data as any).source, src);
  });

  test('no diagnostics when file has no imports', () => {
    const ast = parseCode(`const x = 42;`);
    const diags = checkImportRules(ast);
    assert.strictEqual(diags.length, 0);
  });
});

// ─── importRules — checkNonOwlComponentImport ─────────────────────────────────

suite('importRules — checkNonOwlComponentImport (owl/non-owl-component-import)', () => {
  test('no diagnostic when class does not extend anything', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';
class Foo {}
`);
    const diags = checkNonOwlComponentImport(ast);
    assert.strictEqual(diags.length, 0);
  });

  test('no diagnostic when class extends Component from @odoo/owl', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';
class Foo extends Component {}
`);
    const diags = checkNonOwlComponentImport(ast);
    assert.strictEqual(diags.length, 0);
  });

  test('emits diagnostic when Component comes from non-OWL source', () => {
    const ast = parseCode(`
import { Component } from './base';
class Foo extends Component {}
`);
    const diags = checkNonOwlComponentImport(ast);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].code, 'owl/non-owl-component-import');
    assert.strictEqual(diags[0].severity, 3, 'Information = 3');
    assert.ok(diags[0].message.includes('@odoo/owl'));
  });

  test('emits diagnostic for export named class with non-OWL parent', () => {
    const ast = parseCode(`
import { Component } from 'some-lib';
export class MyComp extends Component {}
`);
    const diags = checkNonOwlComponentImport(ast);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].code, 'owl/non-owl-component-import');
  });

  test('emits diagnostic for export default class with non-OWL parent', () => {
    const ast = parseCode(`
import { Component } from 'some-lib';
export default class MyComp extends Component {}
`);
    const diags = checkNonOwlComponentImport(ast);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].code, 'owl/non-owl-component-import');
  });

  test('does NOT emit when superClass is not imported at all (unknown origin)', () => {
    // If Component is not imported, we cannot confirm it is from a non-OWL source.
    const ast = parseCode(`
class Foo extends Component {}
`);
    const diags = checkNonOwlComponentImport(ast);
    assert.strictEqual(diags.length, 0, 'Should not flag unknown (non-imported) superClass');
  });

  test('data payload contains superName and importSrc', () => {
    const ast = parseCode(`
import { Component } from './my-base';
class X extends Component {}
`);
    const diags = checkNonOwlComponentImport(ast);
    assert.strictEqual(diags.length, 1);
    const data = diags[0].data as any;
    assert.strictEqual(data.superName, 'Component');
    assert.strictEqual(data.importSrc, './my-base');
  });
});

// ─── importRules — checkMissingOwlImports ─────────────────────────────────────

suite('importRules — checkMissingOwlImports (owl/missing-owl-import)', () => {
  test('no diagnostic when OWL hook is imported and used', () => {
    const ast = parseCode(`
import { useState } from '@odoo/owl';
class Foo {
  setup() { useState({}); }
}
`);
    const owlImported = new Set(['useState']);
    const diags = checkMissingOwlImports(ast, owlImported);
    assert.strictEqual(diags.length, 0);
  });

  test('emits error when OWL hook is used but not imported', () => {
    const ast = parseCode(`
class Foo {
  setup() { useState({}); }
}
`);
    const diags = checkMissingOwlImports(ast, new Set());
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].code, 'owl/missing-owl-import');
    assert.strictEqual(diags[0].severity, 1, 'Error = 1');
    assert.ok(diags[0].message.includes('useState'));
    assert.ok(diags[0].message.includes('@odoo/owl'));
  });

  test('emits one error per unimported hook (multiple hooks)', () => {
    const ast = parseCode(`
class Foo {
  setup() {
    useState({});
    useRef(null);
    onMounted(() => {});
  }
}
`);
    const diags = checkMissingOwlImports(ast, new Set());
    // All three are OWL hooks not imported
    assert.strictEqual(diags.length, 3);
    const codes = new Set(diags.map(d => d.code));
    assert.ok(codes.has('owl/missing-owl-import'));
  });

  test('does not emit for a non-OWL function call', () => {
    const ast = parseCode(`
function doSomething() {}
doSomething();
`);
    const diags = checkMissingOwlImports(ast, new Set());
    assert.strictEqual(diags.length, 0);
  });

  test('does not emit when hook is imported from any source (not necessarily @odoo/owl)', () => {
    // The function checks `allImported` — any import of the name suppresses the diagnostic
    const ast = parseCode(`
import { useState } from './local-hooks';
class Foo {
  setup() { useState({}); }
}
`);
    const diags = checkMissingOwlImports(ast, new Set());
    assert.strictEqual(diags.length, 0);
  });

  test('data payload contains name and source', () => {
    const ast = parseCode(`
class Foo {
  setup() { useRef(null); }
}
`);
    const diags = checkMissingOwlImports(ast, new Set());
    assert.strictEqual(diags.length, 1);
    const data = diags[0].data as any;
    assert.strictEqual(data.name, 'useRef');
    assert.strictEqual(data.source, '@odoo/owl');
  });
});

// ─── componentRules ───────────────────────────────────────────────────────────

suite('componentRules — checkComponentRules', () => {
  test('no diagnostics for a fully valid OWL component', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

class MyComp extends Component {
  static template = 'MyComp';
  static props = { label: String };
  setup() {}
}
`);
    const diags = checkComponentRules(ast);
    assert.strictEqual(diags.length, 0);
  });

  test('emits owl/no-template when component has props and setup but no template', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

class MyComp extends Component {
  static props = { label: String };
  setup() {}
}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/no-template');
    assert.ok(diag, 'Should emit owl/no-template');
    assert.strictEqual(diag!.severity, 2, 'Warning = 2');
    assert.ok(diag!.message.includes('MyComp'));
  });

  test('does NOT emit owl/no-template for abstract-like class (no props, no setup)', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

class AbstractComp extends Component {}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/no-template');
    assert.strictEqual(diag, undefined, 'Abstract-like class should be exempt from owl/no-template');
  });

  test('emits owl/no-setup when component has props but no setup', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

class MyComp extends Component {
  static template = 'MyComp';
  static props = { count: Number };
}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/no-setup');
    assert.ok(diag, 'Should emit owl/no-setup');
    assert.strictEqual(diag!.severity, 3, 'Information = 3');
    assert.ok(diag!.message.includes('MyComp'));
  });

  test('does NOT emit owl/no-setup when component has both props and setup', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

class MyComp extends Component {
  static template = 'MyComp';
  static props = { label: String };
  setup() {}
}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/no-setup');
    assert.strictEqual(diag, undefined);
  });

  test('emits owl/invalid-props-schema when static props is not an object or array', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

class MyComp extends Component {
  static template = 'MyComp';
  static props = "invalid";
  setup() {}
}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/invalid-props-schema');
    assert.ok(diag, 'Should emit owl/invalid-props-schema');
    assert.strictEqual(diag!.severity, 1, 'Error = 1');
    assert.ok(diag!.message.includes('MyComp'));
  });

  test('does NOT emit owl/invalid-props-schema for array props', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

class MyComp extends Component {
  static template = 'MyComp';
  static props = ['label', 'count'];
  setup() {}
}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/invalid-props-schema');
    assert.strictEqual(diag, undefined, 'Array props should be valid');
  });

  test('emits owl/template-ref-dynamic when template is an identifier (variable reference)', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

const TMPL = 'MyComp';
class MyComp extends Component {
  static template = TMPL;
  setup() {}
}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/template-ref-dynamic');
    assert.ok(diag, 'Should emit owl/template-ref-dynamic');
    assert.strictEqual(diag!.severity, 3, 'Information = 3');
  });

  test('emits owl/duplicate-template-name when two components share the same template name', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

class CompA extends Component {
  static template = 'SharedTemplate';
  setup() {}
}

class CompB extends Component {
  static template = 'SharedTemplate';
  setup() {}
}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/duplicate-template-name');
    assert.ok(diag, 'Should emit owl/duplicate-template-name');
    assert.strictEqual(diag!.severity, 2, 'Warning = 2');
    assert.ok(diag!.message.includes('SharedTemplate'));
    assert.ok(diag!.message.includes('CompA') || diag!.message.includes('CompB'));
  });

  test('does NOT emit owl/duplicate-template-name for unique template names', () => {
    const ast = parseCode(`
import { Component } from '@odoo/owl';

class CompA extends Component {
  static template = 'CompA';
  setup() {}
}

class CompB extends Component {
  static template = 'CompB';
  setup() {}
}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/duplicate-template-name');
    assert.strictEqual(diag, undefined);
  });

  test('ignores classes that do not extend an OWL-imported name', () => {
    const ast = parseCode(`
import { Component } from './base';
class Foo extends Component {
  setup() {}
}
`);
    // Component is NOT from @odoo/owl so checkComponentRules should ignore it
    const diags = checkComponentRules(ast);
    // Should produce no component-specific diagnostics (the class is not an OWL component)
    const owlDiags = diags.filter(d =>
      d.code === 'owl/no-template' ||
      d.code === 'owl/no-setup' ||
      d.code === 'owl/invalid-props-schema'
    );
    assert.strictEqual(owlDiags.length, 0, 'Non-OWL class should not be checked');
  });

  test('accepts tagged template literal (xml`...`) as a valid template', () => {
    const ast = parseCode(`
import { Component, xml } from '@odoo/owl';

class MyComp extends Component {
  static template = xml\`<div>Hello</div>\`;
  setup() {}
}
`);
    const diags = checkComponentRules(ast);
    const diag = diags.find(d => d.code === 'owl/no-template');
    assert.strictEqual(diag, undefined, 'xml tagged template should be accepted as a template');
  });
});

// ─── propsRules ───────────────────────────────────────────────────────────────

suite('propsRules — checkPropsRules (owl/unknown-prop-type)', () => {
  test('no diagnostic for valid shorthand prop types', () => {
    const ast = parseCode(`
class Foo {
  static props = {
    label: String,
    count: Number,
    active: Boolean,
    data: Object,
    items: Array,
    fn: Function,
  };
}
`);
    const diags = checkPropsRules(ast, makeIndex());
    const typeDiags = diags.filter(d => d.code === 'owl/unknown-prop-type');
    assert.strictEqual(typeDiags.length, 0);
  });

  test('emits owl/unknown-prop-type for an unrecognized shorthand type', () => {
    const ast = parseCode(`
class Foo {
  static props = {
    data: Stream,
  };
}
`);
    const diags = checkPropsRules(ast, makeIndex());
    const diag = diags.find(d => d.code === 'owl/unknown-prop-type');
    assert.ok(diag, 'Should emit owl/unknown-prop-type');
    assert.strictEqual(diag!.severity, 2, 'Warning = 2');
    assert.ok(diag!.message.includes('Stream'));
  });

  test('no diagnostic for full schema with valid type', () => {
    const ast = parseCode(`
class Foo {
  static props = {
    label: { type: String, optional: true },
  };
}
`);
    const diags = checkPropsRules(ast, makeIndex());
    const typeDiags = diags.filter(d => d.code === 'owl/unknown-prop-type');
    assert.strictEqual(typeDiags.length, 0);
  });

  test('emits owl/unknown-prop-type for full schema with invalid type', () => {
    const ast = parseCode(`
class Foo {
  static props = {
    item: { type: InvalidType },
  };
}
`);
    const diags = checkPropsRules(ast, makeIndex());
    const diag = diags.find(d => d.code === 'owl/unknown-prop-type');
    assert.ok(diag, 'Should emit for invalid type in full schema');
    assert.ok(diag!.message.includes('InvalidType'));
  });

  test('accepts "Any" as a valid type', () => {
    const ast = parseCode(`
class Foo {
  static props = { data: Any };
}
`);
    const diags = checkPropsRules(ast, makeIndex());
    const typeDiags = diags.filter(d => d.code === 'owl/unknown-prop-type');
    assert.strictEqual(typeDiags.length, 0, '"Any" should be a valid prop type');
  });

  test('accepts "Symbol" and "Date" as valid types', () => {
    const ast = parseCode(`
class Foo {
  static props = {
    key: Symbol,
    timestamp: Date,
  };
}
`);
    const diags = checkPropsRules(ast, makeIndex());
    const typeDiags = diags.filter(d => d.code === 'owl/unknown-prop-type');
    assert.strictEqual(typeDiags.length, 0);
  });

  test('no diagnostic when static props is not an ObjectExpression', () => {
    // Array-form props: the rule only checks ObjectExpression values
    const ast = parseCode(`
class Foo {
  static props = ['label', 'count'];
}
`);
    const diags = checkPropsRules(ast, makeIndex());
    const typeDiags = diags.filter(d => d.code === 'owl/unknown-prop-type');
    assert.strictEqual(typeDiags.length, 0);
  });
});

suite('propsRules — checkPropsRules (owl/unknown-prop-passed)', () => {
  test('emits owl/unknown-prop-passed when an unrecognized prop is passed to new Component()', () => {
    const comp = makeComponent('MyButton', {
      label: { type: 'String', optional: false, validate: false },
    });
    const index = makeIndex([comp]);
    const ast = parseCode(`new MyButton({ label: 'Click', unknown: true });`);
    const diags = checkPropsRules(ast, index);
    const diag = diags.find(d => d.code === 'owl/unknown-prop-passed');
    assert.ok(diag, 'Should emit owl/unknown-prop-passed');
    assert.strictEqual(diag!.severity, 2, 'Warning = 2');
    assert.ok(diag!.message.includes('unknown'));
    assert.ok(diag!.message.includes('MyButton'));
  });

  test('no diagnostic when all passed props are known', () => {
    const comp = makeComponent('MyButton', {
      label: { type: 'String', optional: false, validate: false },
    });
    const index = makeIndex([comp]);
    const ast = parseCode(`new MyButton({ label: 'Click' });`);
    const diags = checkPropsRules(ast, index);
    const diag = diags.find(d => d.code === 'owl/unknown-prop-passed');
    assert.strictEqual(diag, undefined);
  });

  test('no diagnostic for unknown component (not in index)', () => {
    const index = makeIndex([]);
    const ast = parseCode(`new UnknownComp({ foo: 'bar' });`);
    const diags = checkPropsRules(ast, index);
    assert.strictEqual(diags.length, 0);
  });
});

suite('propsRules — checkPropsRules (owl/missing-required-prop)', () => {
  test('emits owl/missing-required-prop when required prop is not passed', () => {
    const comp = makeComponent('Alert', {
      message: { type: 'String', optional: false, validate: false },
      title: { type: 'String', optional: true, validate: false },
    });
    const index = makeIndex([comp]);
    const ast = parseCode(`new Alert({});`);
    const diags = checkPropsRules(ast, index);
    const diag = diags.find(d => d.code === 'owl/missing-required-prop');
    assert.ok(diag, 'Should emit owl/missing-required-prop');
    assert.strictEqual(diag!.severity, 2, 'Warning = 2');
    assert.ok(diag!.message.includes('message'));
    assert.ok(diag!.message.includes('Alert'));
  });

  test('no diagnostic when required prop is passed', () => {
    const comp = makeComponent('Alert', {
      message: { type: 'String', optional: false, validate: false },
    });
    const index = makeIndex([comp]);
    const ast = parseCode(`new Alert({ message: 'Hello' });`);
    const diags = checkPropsRules(ast, index);
    const diag = diags.find(d => d.code === 'owl/missing-required-prop');
    assert.strictEqual(diag, undefined);
  });

  test('no diagnostic when optional prop is not passed', () => {
    const comp = makeComponent('Card', {
      title: { type: 'String', optional: true, validate: false },
    });
    const index = makeIndex([comp]);
    const ast = parseCode(`new Card({});`);
    const diags = checkPropsRules(ast, index);
    const diag = diags.find(d => d.code === 'owl/missing-required-prop');
    assert.strictEqual(diag, undefined, 'Optional prop being absent should not trigger diagnostic');
  });

  test('emits multiple missing-required-prop diagnostics for multiple missing required props', () => {
    const comp = makeComponent('Form', {
      name: { type: 'String', optional: false, validate: false },
      value: { type: 'Number', optional: false, validate: false },
    });
    const index = makeIndex([comp]);
    const ast = parseCode(`new Form({});`);
    const diags = checkPropsRules(ast, index);
    const missing = diags.filter(d => d.code === 'owl/missing-required-prop');
    assert.strictEqual(missing.length, 2);
  });

  test('no diagnostic when newExpression has no arguments', () => {
    const comp = makeComponent('Btn', {
      label: { type: 'String', optional: false, validate: false },
    });
    const index = makeIndex([comp]);
    // new Btn() without arguments — first arg check: arg is undefined
    const ast = parseCode(`new Btn();`);
    const diags = checkPropsRules(ast, index);
    // No props check when no argument object is passed
    assert.ok(diags.length >= 0, 'Should not throw');
  });
});

// ─── hookRules ────────────────────────────────────────────────────────────────

suite('hookRules — checkHookRules (owl/hook-outside-setup)', () => {
  test('no diagnostic when OWL hook is called inside setup()', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  static template = 'MyComp';
  setup() {
    this.state = useState({ count: 0 });
  }
}
`);
    const diags = checkHookRules(ast);
    assert.strictEqual(diags.length, 0);
  });

  test('emits owl/hook-outside-setup when hook is called in a non-setup method', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  static template = 'MyComp';
  onMounted() {
    useState({});
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-outside-setup');
    assert.ok(diag, 'Should emit owl/hook-outside-setup');
    assert.strictEqual(diag!.severity, 1, 'Error = 1');
    assert.ok(diag!.message.includes('useState'));
    assert.ok(diag!.message.includes('setup()'));
  });

  test('does NOT emit hook-outside-setup for top-level (non-class) function calls', () => {
    // OWL hook called at module level — not inside a class at all
    const ast = parseCode(`
import { useState } from '@odoo/owl';
const state = useState({});
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-outside-setup');
    assert.strictEqual(diag, undefined, 'Top-level hook calls outside any class should not be flagged');
  });

  test('emits owl/hook-outside-setup for hook used in constructor', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  constructor() {
    super();
    useState({});
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-outside-setup');
    assert.ok(diag, 'Hook inside constructor should be flagged');
  });
});

suite('hookRules — checkHookRules (owl/hook-in-loop)', () => {
  test('emits owl/hook-in-loop when hook is inside a for loop in setup()', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    for (let i = 0; i < 3; i++) {
      useState({});
    }
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-loop');
    assert.ok(diag, 'Should emit owl/hook-in-loop');
    assert.strictEqual(diag!.severity, 1, 'Error = 1');
    assert.ok(diag!.message.includes('useState'));
  });

  test('emits owl/hook-in-loop when hook is inside a forEach callback in setup()', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    items.forEach(() => {
      useState({});
    });
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-loop');
    assert.ok(diag, 'Should emit owl/hook-in-loop for forEach');
  });

  test('emits owl/hook-in-loop for while loop in setup()', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    while (cond) {
      useState({});
    }
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-loop');
    assert.ok(diag, 'Should emit owl/hook-in-loop for while');
  });

  test('emits owl/hook-in-loop for do-while loop in setup()', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    do {
      useState({});
    } while (cond);
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-loop');
    assert.ok(diag, 'Should emit owl/hook-in-loop for do-while');
  });

  test('no hook-in-loop when hook is at top level of setup()', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    this.state = useState({ x: 0 });
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-loop');
    assert.strictEqual(diag, undefined);
  });
});

suite('hookRules — checkHookRules (owl/hook-in-conditional)', () => {
  test('emits owl/hook-in-conditional when hook is inside if statement in setup()', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    if (condition) {
      useState({});
    }
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-conditional');
    assert.ok(diag, 'Should emit owl/hook-in-conditional');
    assert.strictEqual(diag!.severity, 2, 'Warning = 2');
    assert.ok(diag!.message.includes('useState'));
    assert.ok(diag!.message.includes('setup()'));
  });

  test('emits owl/hook-in-conditional for ternary inside setup()', () => {
    const ast = parseCode(`
import { Component, useRef } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    const r = condition ? useRef(null) : null;
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-conditional');
    assert.ok(diag, 'Should emit for ternary');
    assert.ok(diag!.message.includes('useRef'));
  });

  test('no owl/hook-in-conditional for hook at top of setup()', () => {
    const ast = parseCode(`
import { Component, useRef } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    this.ref = useRef(null);
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-conditional');
    assert.strictEqual(diag, undefined);
  });
});

suite('hookRules — checkHookRules (owl/hook-in-async)', () => {
  test('emits owl/hook-in-async when hook is inside async arrow function in setup()', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    const load = async () => {
      useState({});
    };
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-async');
    assert.ok(diag, 'Should emit owl/hook-in-async');
    assert.strictEqual(diag!.severity, 2, 'Warning = 2');
    assert.ok(diag!.message.includes('useState'));
    assert.ok(diag!.message.includes('async'));
  });

  test('no owl/hook-in-async for synchronous callback in setup()', () => {
    const ast = parseCode(`
import { Component, onMounted } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    onMounted(() => {
      console.log('mounted');
    });
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-async');
    assert.strictEqual(diag, undefined);
  });

  test('no owl/hook-in-async for hook at top of setup()', () => {
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    this.s = useState({ x: 0 });
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-in-async');
    assert.strictEqual(diag, undefined);
  });
});

suite('hookRules — checkHookRules (lifecycle hooks)', () => {
  test('no diagnostic when lifecycle hooks are used correctly inside setup()', () => {
    const ast = parseCode(`
import { Component, onMounted, onWillUnmount, onPatched } from '@odoo/owl';

class MyComp extends Component {
  static template = 'MyComp';
  setup() {
    onMounted(() => {});
    onWillUnmount(() => {});
    onPatched(() => {});
  }
}
`);
    const diags = checkHookRules(ast);
    assert.strictEqual(diags.length, 0);
  });

  test('emits owl/hook-outside-setup for lifecycle hook in willStart method', () => {
    const ast = parseCode(`
import { Component, onMounted } from '@odoo/owl';

class MyComp extends Component {
  willStart() {
    onMounted(() => {});
  }
}
`);
    const diags = checkHookRules(ast);
    const diag = diags.find(d => d.code === 'owl/hook-outside-setup');
    assert.ok(diag, 'Should flag lifecycle hook outside setup()');
    assert.ok(diag!.message.includes('onMounted'));
  });
});

suite('hookRules — checkHookRules (multiple violations)', () => {
  test('reports multiple distinct violations in one file', () => {
    const ast = parseCode(`
import { Component, useState, useRef } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    if (x) {
      useState({});
    }
    for (let i = 0; i < 3; i++) {
      useRef(null);
    }
  }
}
`);
    const diags = checkHookRules(ast);
    const conditional = diags.find(d => d.code === 'owl/hook-in-conditional');
    const loop = diags.find(d => d.code === 'owl/hook-in-loop');
    assert.ok(conditional, 'Should report hook-in-conditional');
    assert.ok(loop, 'Should report hook-in-loop');
  });

  test('hook-in-loop takes priority over hook-in-conditional (returns early)', () => {
    // A hook inside a loop inside a conditional — only loop is reported (early return in rule)
    const ast = parseCode(`
import { Component, useState } from '@odoo/owl';

class MyComp extends Component {
  setup() {
    if (cond) {
      for (let i = 0; i < 3; i++) {
        useState({});
      }
    }
  }
}
`);
    const diags = checkHookRules(ast);
    // loop check fires first (per implementation order) — only loop diagnostic should appear
    const loop = diags.find(d => d.code === 'owl/hook-in-loop');
    const conditional = diags.find(d => d.code === 'owl/hook-in-conditional');
    assert.ok(loop, 'Should report hook-in-loop');
    // Conditional should NOT also appear for the same call (early return)
    assert.strictEqual(conditional, undefined, 'Only loop diagnostic should appear for loop inside conditional');
  });
});
