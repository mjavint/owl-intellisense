import * as assert from 'assert';
import { SymbolIndex } from '../server/analyzer/index';
import { OwlComponent, ParseResult } from '../shared/types';

function makeComponent(name: string, uri: string, props: Record<string, { type: string; optional: boolean; validate: boolean }> = {}): OwlComponent {
  return {
    name,
    filePath: '/workspace/' + name.toLowerCase() + '.ts',
    uri,
    range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
    props,
    templateRef: name,
    importPath: '/workspace/' + name.toLowerCase() + '.ts',
  };
}

function makeParseResult(uri: string, components: OwlComponent[]): ParseResult {
  return {
    uri,
    components,
    services: [],
    registries: [],
    functions: [],
    imports: [],
    diagnostics: [],
  };
}

suite('SymbolIndex Tests', () => {
  let index: SymbolIndex;

  setup(() => {
    index = new SymbolIndex();
  });

  // ─── getComponent / upsertComponent ──────────────────────────────────

  test('getComponent returns undefined for unknown name', () => {
    assert.strictEqual(index.getComponent('Unknown'), undefined);
  });

  test('upsertComponent and getComponent round-trip', () => {
    const comp = makeComponent('WidgetA', 'file:///widget-a.ts');
    index.upsertComponent(comp);
    const retrieved = index.getComponent('WidgetA');
    assert.ok(retrieved, 'should retrieve WidgetA');
    assert.strictEqual(retrieved!.name, 'WidgetA');
  });

  test('getAllComponents returns all indexed components', () => {
    index.upsertComponent(makeComponent('ChildA', 'file:///child-a.ts'));
    index.upsertComponent(makeComponent('ChildB', 'file:///child-b.ts'));
    // PERF-07: Array.from on iterator
    const all = Array.from(index.getAllComponents());
    const names = all.map((c: { name: string }) => c.name);
    assert.ok(names.includes('ChildA'));
    assert.ok(names.includes('ChildB'));
    assert.strictEqual(all.length, 2);
  });

  // ─── SC-03b: upsert updates props ────────────────────────────────────

  test('SC-03b: upsert replaces component with updated props', () => {
    const initial = makeComponent('WidgetA', 'file:///widget-a.ts', {
      label: { type: 'String', optional: false, validate: false },
    });
    index.upsertComponent(initial);

    // Re-upsert with an added prop
    const updated = makeComponent('WidgetA', 'file:///widget-a.ts', {
      label: { type: 'String', optional: false, validate: false },
      count: { type: 'Number', optional: false, validate: false },
    });
    index.upsertComponent(updated);

    const retrieved = index.getComponent('WidgetA');
    assert.ok(retrieved, 'WidgetA should still be in index');
    assert.ok('label' in retrieved!.props, 'should still have label');
    assert.ok('count' in retrieved!.props, 'should now have count');
  });

  // ─── getComponentsInFile ─────────────────────────────────────────────

  test('getComponentsInFile returns components for correct URI', () => {
    const uri = 'file:///multi.ts';
    index.upsertComponent(makeComponent('CompA', uri));
    index.upsertComponent(makeComponent('CompB', uri));
    index.upsertComponent(makeComponent('CompC', 'file:///other.ts'));

    const inFile = index.getComponentsInFile(uri);
    const names = inFile.map(c => c.name);
    assert.ok(names.includes('CompA'));
    assert.ok(names.includes('CompB'));
    assert.ok(!names.includes('CompC'));
  });

  test('getComponentsInFile returns empty array for unknown URI', () => {
    const result = index.getComponentsInFile('file:///nonexistent.ts');
    assert.deepStrictEqual(result, []);
  });

  // ─── SC-03c: removeFile ───────────────────────────────────────────────

  test('SC-03c: removeFile removes component from getComponent', () => {
    const uri = 'file:///widget-a.ts';
    index.upsertComponent(makeComponent('WidgetA', uri));
    index.removeFile(uri);
    assert.strictEqual(index.getComponent('WidgetA'), undefined);
  });

  test('SC-03c: removeFile makes getComponentsInFile return empty array', () => {
    const uri = 'file:///widget-a.ts';
    index.upsertComponent(makeComponent('WidgetA', uri));
    index.removeFile(uri);
    assert.deepStrictEqual(index.getComponentsInFile(uri), []);
  });

  test('removeFile only removes components from the specified URI', () => {
    const uri1 = 'file:///file1.ts';
    const uri2 = 'file:///file2.ts';
    index.upsertComponent(makeComponent('CompFrom1', uri1));
    index.upsertComponent(makeComponent('CompFrom2', uri2));

    index.removeFile(uri1);

    assert.strictEqual(index.getComponent('CompFrom1'), undefined);
    assert.ok(index.getComponent('CompFrom2'), 'CompFrom2 should remain');
  });

  // ─── clear ───────────────────────────────────────────────────────────

  test('clear removes all components', () => {
    index.upsertComponent(makeComponent('A', 'file:///a.ts'));
    index.upsertComponent(makeComponent('B', 'file:///b.ts'));
    index.clear();
    assert.strictEqual(Array.from(index.getAllComponents()).length, 0);
    assert.strictEqual(index.getComponent('A'), undefined);
  });

  // ─── upsertFileSymbols ────────────────────────────────────────────────

  test('upsertFileSymbols indexes multiple components at once', () => {
    const uri = 'file:///multi.ts';
    const result = makeParseResult(uri, [
      makeComponent('Alpha', uri),
      makeComponent('Beta', uri),
    ]);
    index.upsertFileSymbols(uri, result);
    assert.ok(index.getComponent('Alpha'));
    assert.ok(index.getComponent('Beta'));
  });

  test('upsertFileSymbols replaces previous symbols for same URI', () => {
    const uri = 'file:///evolving.ts';
    // First parse
    index.upsertFileSymbols(uri, makeParseResult(uri, [makeComponent('OldComp', uri)]));
    // Second parse (file changed)
    index.upsertFileSymbols(uri, makeParseResult(uri, [makeComponent('NewComp', uri)]));

    assert.strictEqual(index.getComponent('OldComp'), undefined, 'OldComp should be gone');
    assert.ok(index.getComponent('NewComp'), 'NewComp should be indexed');
  });
});
