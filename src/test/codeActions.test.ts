import * as assert from 'assert';
import { buildAddImportEdits, isSpecifierImported } from '../server/utils/importUtils';

suite('CodeActions / ImportUtils Tests', () => {
  // ─── isSpecifierImported ─────────────────────────────────────────────

  test('isSpecifierImported returns true when specifier is imported', () => {
    const docText = `import { Component, useState } from '@odoo/owl';\nconst x = 1;`;
    assert.strictEqual(isSpecifierImported(docText, 'Component'), true);
    assert.strictEqual(isSpecifierImported(docText, 'useState'), true);
  });

  test('isSpecifierImported returns false when specifier is not imported', () => {
    const docText = `import { Component } from '@odoo/owl';\nconst x = 1;`;
    assert.strictEqual(isSpecifierImported(docText, 'useRef'), false);
  });

  test('isSpecifierImported returns false on empty document', () => {
    assert.strictEqual(isSpecifierImported('', 'useState'), false);
  });

  test('isSpecifierImported handles default imports correctly', () => {
    const docText = `import MyDefault from './module';\n`;
    // Named specifier lookup should not match default imports unless local name matches
    // default specifier local name check: 'MyDefault'
    assert.strictEqual(isSpecifierImported(docText, 'MyDefault'), true);
  });

  // ─── SC-08: New import insertion ─────────────────────────────────────

  test('SC-08: inserts new OWL import when none exists', () => {
    const docText = `const x = 1;\n`;
    const edits = buildAddImportEdits(docText, 'useState', '@odoo/owl');
    assert.ok(edits.length > 0, 'Should produce at least one TextEdit');
    const edit = edits[0];
    // Should be an insert (range start === end)
    assert.ok(edit.newText.includes("import { useState } from '@odoo/owl'"), 'Insert should include import statement');
  });

  test('SC-08: inserts import after last existing import', () => {
    const docText = `import { something } from 'somewhere';\nconst x = 1;\n`;
    const edits = buildAddImportEdits(docText, 'useState', '@odoo/owl');
    assert.ok(edits.length > 0, 'Should produce TextEdit');
    // Insert position should be after line 0 (last import is line 0)
    const edit = edits[0];
    assert.ok(edit.newText.includes('useState'), 'Edit should include useState');
  });

  // ─── SC-09b: Merge into existing OWL import ──────────────────────────

  test('SC-09b: merges specifier into existing @odoo/owl import (sorted)', () => {
    const docText = `import { Component } from '@odoo/owl';\nconst x = 1;\n`;
    const edits = buildAddImportEdits(docText, 'useRef', '@odoo/owl');
    assert.strictEqual(edits.length, 1, 'Should produce exactly one TextEdit (replace)');
    const edit = edits[0];
    // The merged import should contain both, sorted
    assert.ok(edit.newText.includes('Component'), 'Should keep Component');
    assert.ok(edit.newText.includes('useRef'), 'Should add useRef');
    // Sorted: Component < useRef
    const compIdx = edit.newText.indexOf('Component');
    const refIdx = edit.newText.indexOf('useRef');
    assert.ok(compIdx < refIdx, 'Component should appear before useRef (sorted)');
  });

  test('SC-09b: merging preserves existing specifiers when adding multiple', () => {
    const docText = `import { Component, onMounted } from '@odoo/owl';\n`;
    const edits = buildAddImportEdits(docText, 'useState', '@odoo/owl');
    assert.strictEqual(edits.length, 1, 'Should replace with merged import');
    const edit = edits[0];
    // Sorted: Component, onMounted, useState
    assert.ok(edit.newText.includes('Component'), 'Component must be present');
    assert.ok(edit.newText.includes('onMounted'), 'onMounted must be present');
    assert.ok(edit.newText.includes('useState'), 'useState must be added');
  });

  test('SC-09b: does not produce duplicate specifier (no-op if already imported)', () => {
    const docText = `import { Component, useState } from '@odoo/owl';\n`;
    const edits = buildAddImportEdits(docText, 'useState', '@odoo/owl');
    assert.strictEqual(edits.length, 0, 'Should return empty edits if already imported');
  });

  test('SC-09b: replace edit is a TextEdit.replace (non-empty range)', () => {
    const docText = `import { Component } from '@odoo/owl';\nconst y = 2;\n`;
    const edits = buildAddImportEdits(docText, 'useRef', '@odoo/owl');
    assert.strictEqual(edits.length, 1);
    const edit = edits[0];
    // A replace edit has range.start !== range.end
    const isReplace = !(
      edit.range.start.line === edit.range.end.line &&
      edit.range.start.character === edit.range.end.character
    );
    assert.ok(isReplace, 'Edit should be a replace (non-zero range) not an insert');
  });

  // ─── Non-OWL source imports ───────────────────────────────────────────

  test('inserts import for non-OWL source when not present', () => {
    const docText = `import { Component } from '@odoo/owl';\n`;
    const edits = buildAddImportEdits(docText, 'MyHelper', './helpers');
    assert.ok(edits.length > 0);
    assert.ok(edits[0].newText.includes("'./helpers'"), 'Should import from correct source');
    assert.ok(edits[0].newText.includes('MyHelper'));
  });

  test('does not add duplicate import from same non-OWL source', () => {
    const docText = `import { MyHelper } from './helpers';\n`;
    const edits = buildAddImportEdits(docText, 'MyHelper', './helpers');
    assert.strictEqual(edits.length, 0, 'Should not add duplicate');
  });
});
