import * as assert from 'assert';
import { validateDocument } from '../server/features/diagnostics';
import { SymbolIndex } from '../server/analyzer/index';

function makeIndex(): SymbolIndex {
  return new SymbolIndex();
}

suite('Diagnostics Tests', () => {
  // ─── SC-08b: non-OWL Component import ────────────────────────────────

  test('SC-08b: fires information diagnostic when Component extends from non-OWL source', () => {
    const content = `
import { Component } from './base-component';

class MyWidget extends Component {
  static template = 'MyWidget';
  setup() {}
}
`;
    const index = makeIndex();
    const diagnostics = validateDocument('file:///test.ts', content, index);
    const importDiag = diagnostics.find(d =>
      d.code === 'owl/non-owl-component-import' &&
      d.message.includes('@odoo/owl')
    );
    assert.ok(importDiag, 'Should fire SC-08b diagnostic for non-OWL Component import');
    // Severity 3 = Information in LSP DiagnosticSeverity
    assert.strictEqual(importDiag!.severity, 3, 'Should be Information severity');
  });

  test('SC-08b: does NOT fire diagnostic when Component is imported from @odoo/owl', () => {
    const content = `
import { Component, useState } from '@odoo/owl';

class MyWidget extends Component {
  static template = 'MyWidget';
  setup() {
    useState({});
  }
}
`;
    const index = makeIndex();
    const diagnostics = validateDocument('file:///test.ts', content, index);
    const importDiag = diagnostics.find(d => d.code === 'owl/non-owl-component-import');
    assert.strictEqual(importDiag, undefined, 'Should NOT fire for valid @odoo/owl import');
  });

  test('SC-08c: no false diagnostics on valid OWL component', () => {
    const content = `
import { Component, useState } from '@odoo/owl';

class ValidComp extends Component {
  static template = 'ValidComp';
  static props = { label: String };
  setup() {
    this.state = useState({ count: 0 });
  }
}
`;
    const index = makeIndex();
    const diagnostics = validateDocument('file:///valid.ts', content, index);
    // Filter to only owl/non-owl-component-import diagnostics — there should be none
    const falseDiag = diagnostics.find(d => d.code === 'owl/non-owl-component-import');
    assert.strictEqual(falseDiag, undefined, 'No false diagnostics on valid component');
  });

  // ─── Resilience ───────────────────────────────────────────────────────

  test('does not throw on completely broken syntax', () => {
    const content = '{{{{ broken {{{{ syntax class { }}}';
    const index = makeIndex();
    let threw = false;
    try {
      validateDocument('file:///broken.ts', content, index);
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, 'validateDocument should not throw on broken syntax');
  });

  test('does not throw on empty content', () => {
    const index = makeIndex();
    let threw = false;
    try {
      validateDocument('file:///empty.ts', '', index);
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, 'validateDocument should not throw on empty content');
  });

  test('does not throw on content with no OWL code', () => {
    const content = `
const x = 42;
function hello() { return 'world'; }
`;
    const index = makeIndex();
    let threw = false;
    try {
      validateDocument('file:///plain.ts', content, index);
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, 'validateDocument should not throw on plain JS/TS');
  });

  // ─── Existing rules still work ────────────────────────────────────────

  test('fires warning when Component is extended via non-OWL import but class does not trigger checkComponentRules', () => {
    // The rule we care about here is SC-08b only
    // checkComponentRules would fire owl/no-template for a valid OWL class without template
    const content = `
import { Component } from 'some-other-lib';

class Headless extends Component {
}
`;
    const index = makeIndex();
    const diagnostics = validateDocument('file:///headless.ts', content, index);
    // Should have the SC-08b diagnostic since Component is not from @odoo/owl
    const sc08b = diagnostics.find(d => d.code === 'owl/non-owl-component-import');
    assert.ok(sc08b, 'SC-08b fires for any non-@odoo/owl Component import when class extends it');
  });
});
