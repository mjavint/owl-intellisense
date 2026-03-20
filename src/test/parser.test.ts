import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { parseFile } from '../server/analyzer/parser';

suite('Parser Tests', () => {
  const fixtureDir = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures');
  const sampleFile = path.join(fixtureDir, 'sample-owl-component.ts');
  const sampleUri = `file://${sampleFile}`;

  function readFixture(filename: string): string {
    return fs.readFileSync(path.join(fixtureDir, filename), 'utf8');
  }

  test('parseFile returns empty result on broken syntax', () => {
    const result = parseFile('class { broken syntax {{{{', 'file:///broken.ts');
    // Should not throw; components may be empty but diagnostics may be populated
    assert.ok(Array.isArray(result.components));
    assert.ok(Array.isArray(result.diagnostics));
  });

  test('parseFile extracts NavBar component with correct name', () => {
    const content = readFixture('sample-owl-component.ts');
    const result = parseFile(content, sampleUri);
    const navBar = result.components.find(c => c.name === 'NavBar');
    assert.ok(navBar, 'NavBar component should be extracted');
    assert.strictEqual(navBar!.name, 'NavBar');
  });

  test('parseFile extracts NavBar props with correct types', () => {
    const content = readFixture('sample-owl-component.ts');
    const result = parseFile(content, sampleUri);
    const navBar = result.components.find(c => c.name === 'NavBar');
    assert.ok(navBar, 'NavBar should be found');
    const props = navBar!.props;

    assert.ok('title' in props, 'should have title prop');
    assert.strictEqual(props['title'].type, 'String');
    assert.strictEqual(props['title'].optional, false);

    assert.ok('collapsed' in props, 'should have collapsed prop');
    assert.strictEqual(props['collapsed'].type, 'Boolean');
    assert.strictEqual(props['collapsed'].optional, true);
  });

  test('parseFile extracts CounterWidget with all props', () => {
    const content = readFixture('sample-owl-component.ts');
    const result = parseFile(content, sampleUri);
    const counter = result.components.find(c => c.name === 'CounterWidget');
    assert.ok(counter, 'CounterWidget should be extracted');
    const props = counter!.props;

    assert.ok('initialCount' in props, 'should have initialCount prop');
    assert.strictEqual(props['initialCount'].type, 'Number');

    assert.ok('label' in props, 'should have label prop');
    assert.strictEqual(props['label'].type, 'String');

    assert.ok('onReset' in props, 'should have onReset prop');
    assert.strictEqual(props['onReset'].type, 'Function');
    assert.strictEqual(props['onReset'].optional, true);
  });

  test('parseFile extracts component range (line numbers)', () => {
    const content = readFixture('sample-owl-component.ts');
    const result = parseFile(content, sampleUri);
    const navBar = result.components.find(c => c.name === 'NavBar');
    assert.ok(navBar, 'NavBar should be found');
    // Range should be valid LSP range (0-based lines)
    assert.ok(navBar!.range.start.line >= 0, 'start line should be non-negative');
    assert.ok(navBar!.range.end.line > navBar!.range.start.line, 'end should be after start');
  });

  test('parseFile extracts templateRef from static template', () => {
    const content = readFixture('sample-owl-component.ts');
    const result = parseFile(content, sampleUri);
    const navBar = result.components.find(c => c.name === 'NavBar');
    assert.ok(navBar, 'NavBar should be found');
    assert.strictEqual(navBar!.templateRef, 'NavBar');
  });

  test('parseFile extracts multiple components from one file', () => {
    const content = readFixture('sample-owl-component.ts');
    const result = parseFile(content, sampleUri);
    const names = result.components.map(c => c.name);
    assert.ok(names.includes('NavBar'), 'should include NavBar');
    assert.ok(names.includes('CounterWidget'), 'should include CounterWidget');
    assert.ok(names.includes('SimpleButton'), 'should include SimpleButton');
  });

  test('parseFile result has correct uri', () => {
    const content = readFixture('sample-owl-component.ts');
    const result = parseFile(content, sampleUri);
    assert.strictEqual(result.uri, sampleUri);
  });

  test('parseFile with empty content returns empty components', () => {
    const result = parseFile('', 'file:///empty.ts');
    assert.strictEqual(result.components.length, 0);
    assert.strictEqual(result.diagnostics.length, 0);
  });

  test('parseFile with non-OWL class does not extract component', () => {
    const content = `
import { SomethingElse } from 'some-lib';
class MyWidget extends SomethingElse {
  static template = 'MyWidget';
}
`;
    const result = parseFile(content, 'file:///nonowl.ts');
    assert.strictEqual(result.components.length, 0, 'Non-OWL class should not be indexed');
  });
});
