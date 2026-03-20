/**
 * Unit tests for src/server/features/references.ts
 *
 * Covers:
 *   - Unknown word → empty array
 *   - Component name → declaration location + import usages
 *   - Component with no imports → only declaration location
 *   - OWL hook name → import usages (no declaration added)
 *   - OWL hook name with no import records → empty array
 *   - Workspace function → declaration location + import usages
 *   - Symbol that is both a component and a function → combined locations
 *   - Multiple files containing imports of the same specifier
 *   - Cursor on whitespace → empty array
 *   - Location objects have correct uri and range values
 */
import * as assert from "assert";
import { suite, test } from "mocha";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ReferenceParams } from "vscode-languageserver/node";

import { onReferences } from "../server/features/references";
import {
  OwlComponent,
  ExportedFunction,
  ImportRecord,
  IComponentReader,
  IFunctionReader,
  IImportReader,
  IServiceReader,
} from "../shared/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRange(
  startLine = 0,
  startChar = 0,
  endLine = 0,
  endChar = 10
) {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

function makeComponent(name: string, uri: string): OwlComponent {
  return {
    name,
    filePath: uri.replace("file://", ""),
    uri,
    range: makeRange(),
    props: {},
    templateRef: undefined,
    importPath: uri.replace("file://", ""),
  };
}

function makeFunction(name: string, uri: string): ExportedFunction {
  return {
    name,
    filePath: uri.replace("file://", ""),
    uri,
    range: makeRange(),
    isDefault: false,
  };
}

function makeImport(specifier: string, uri: string, rangeLine = 5): ImportRecord {
  return {
    specifier,
    source: "@some/module",
    localName: specifier,
    uri,
    range: makeRange(rangeLine, 0, rangeLine, specifier.length),
  };
}

interface MockIndexOptions {
  components?: OwlComponent[];
  functions?: ExportedFunction[];
  importsBySpecifier?: Map<string, ImportRecord[]>;
}

function makeIndex(opts: MockIndexOptions = {}): IComponentReader &
  IFunctionReader &
  IImportReader &
  IServiceReader {
  const compMap = new Map((opts.components ?? []).map((c) => [c.name, c]));
  const fnMap = new Map((opts.functions ?? []).map((f) => [f.name, f]));
  const importsBySpec = opts.importsBySpecifier ?? new Map<string, ImportRecord[]>();

  return {
    // IComponentReader
    getComponent: (name) => compMap.get(name),
    getAllComponents: () => compMap.values(),
    getComponentsInFile: (_uri) => [],
    // IFunctionReader
    getFunction: (name) => fnMap.get(name),
    getAllFunctions: () => fnMap.values(),
    registerSourceAlias: () => {},
    getSourceAliasUris: (_source) => [],
    getFunctionBySource: (_source, _name) => undefined,
    // IImportReader
    getImportsInFile: (_uri) => [],
    getImportsForSpecifier: (spec) => importsBySpec.get(spec) ?? [],
    // IServiceReader
    getService: (_name) => undefined,
    getAllServices: function* () {},
  };
}

function makeDoc(content: string, uri = "file:///test.ts"): TextDocument {
  return TextDocument.create(uri, "typescript", 1, content);
}

function makeParams(
  doc: TextDocument,
  line: number,
  character: number
): ReferenceParams {
  return {
    textDocument: { uri: doc.uri },
    position: { line, character },
    context: { includeDeclaration: true },
  };
}

// ─── Unknown word ─────────────────────────────────────────────────────────────

suite("onReferences — unknown word", () => {
  test("completely unknown word → empty array", () => {
    const index = makeIndex();
    const doc = makeDoc("unknownSymbol");
    const params = makeParams(doc, 0, 5);

    const result = onReferences(params, doc, index);
    assert.deepStrictEqual(result, []);
  });

  test("cursor on whitespace → empty array", () => {
    const index = makeIndex();
    const doc = makeDoc("const x = 1;");
    // space between 'const' and 'x'
    const params = makeParams(doc, 0, 6);

    const result = onReferences(params, doc, index);
    assert.deepStrictEqual(result, []);
  });

  test("empty line → empty array", () => {
    const index = makeIndex();
    const doc = makeDoc("");
    const params = makeParams(doc, 0, 0);

    const result = onReferences(params, doc, index);
    assert.deepStrictEqual(result, []);
  });
});

// ─── Component references ─────────────────────────────────────────────────────

suite("onReferences — component", () => {
  test("component with no imports → returns only declaration location", () => {
    const compUri = "file:///widget.ts";
    const comp = makeComponent("MyWidget", compUri);
    const index = makeIndex({ components: [comp] });

    const doc = makeDoc("MyWidget");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);

    assert.strictEqual(result.length, 1, "should have exactly one location (declaration)");
    assert.strictEqual(result[0].uri, compUri);
  });

  test("component with one import → returns declaration + import location", () => {
    const compUri = "file:///widget.ts";
    const importUri = "file:///consumer.ts";
    const comp = makeComponent("MyWidget", compUri);
    const imp = makeImport("MyWidget", importUri);

    const importsBySpec = new Map([["MyWidget", [imp]]]);
    const index = makeIndex({ components: [comp], importsBySpecifier: importsBySpec });

    const doc = makeDoc("MyWidget");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);

    assert.strictEqual(result.length, 2, "should have declaration + import");
    const uris = result.map((l) => l.uri);
    assert.ok(uris.includes(compUri), "should include declaration uri");
    assert.ok(uris.includes(importUri), "should include import uri");
  });

  test("component with multiple imports → returns declaration + all import locations", () => {
    const compUri = "file:///widget.ts";
    const comp = makeComponent("NavBar", compUri);
    const imports = [
      makeImport("NavBar", "file:///page1.ts", 1),
      makeImport("NavBar", "file:///page2.ts", 2),
      makeImport("NavBar", "file:///page3.ts", 3),
    ];
    const importsBySpec = new Map([["NavBar", imports]]);
    const index = makeIndex({ components: [comp], importsBySpecifier: importsBySpec });

    const doc = makeDoc("NavBar");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);

    // 1 declaration + 3 imports
    assert.strictEqual(result.length, 4);
  });

  test("component location has correct uri and range", () => {
    const compUri = "file:///mycomp.ts";
    const comp = makeComponent("FooComp", compUri);
    comp.range = makeRange(5, 0, 5, 7);
    const index = makeIndex({ components: [comp] });

    const doc = makeDoc("FooComp");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].uri, compUri);
    assert.deepStrictEqual(result[0].range.start, { line: 5, character: 0 });
  });
});

// ─── OWL hook references ─────────────────────────────────────────────────────

suite("onReferences — OWL hook", () => {
  test("known hook with no import records → empty array", () => {
    const index = makeIndex();
    const doc = makeDoc("useState");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);
    assert.deepStrictEqual(result, []);
  });

  test("useState with one import record → returns that import location", () => {
    const importUri = "file:///component.ts";
    const imp = makeImport("useState", importUri, 1);
    const importsBySpec = new Map([["useState", [imp]]]);
    const index = makeIndex({ importsBySpecifier: importsBySpec });

    const doc = makeDoc("useState");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].uri, importUri);
  });

  test("onMounted with multiple import records → returns all import locations", () => {
    const imports = [
      makeImport("onMounted", "file:///comp1.ts", 2),
      makeImport("onMounted", "file:///comp2.ts", 3),
    ];
    const importsBySpec = new Map([["onMounted", imports]]);
    const index = makeIndex({ importsBySpecifier: importsBySpec });

    const doc = makeDoc("onMounted");
    const params = makeParams(doc, 0, 4);

    const result = onReferences(params, doc, index);
    assert.strictEqual(result.length, 2);
  });

  test("OWL hook result does NOT include a declaration location (hooks have no declaration in index)", () => {
    const importUri = "file:///consumer.ts";
    const imp = makeImport("useRef", importUri, 0);
    const importsBySpec = new Map([["useRef", [imp]]]);
    const index = makeIndex({ importsBySpecifier: importsBySpec });

    const doc = makeDoc("useRef");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);

    // Only the import record — hooks are not components, no declaration is added
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].uri, importUri);
  });

  test("all OWL lifecycle hooks are recognised (return non-throw for valid hook names)", () => {
    const hooks = [
      "onWillStart", "onWillUpdateProps", "onMounted", "onWillUnmount",
      "onPatched", "onWillPatch", "onWillDestroy", "onError",
    ];
    const index = makeIndex();
    for (const hookName of hooks) {
      const doc = makeDoc(hookName);
      const params = makeParams(doc, 0, 3);
      assert.doesNotThrow(() => {
        const result = onReferences(params, doc, index);
        assert.ok(Array.isArray(result));
      }, `hook ${hookName} should not throw`);
    }
  });

  test("all OWL utility hooks are recognised (return non-throw for valid hook names)", () => {
    const hooks = [
      "useState", "useRef", "useComponent", "useEnv",
      "useService", "useStore", "useEffect",
      "useChildSubEnv", "useSubEnv", "useExternalListener",
    ];
    const index = makeIndex();
    for (const hookName of hooks) {
      const doc = makeDoc(hookName);
      const params = makeParams(doc, 0, 3);
      assert.doesNotThrow(() => {
        const result = onReferences(params, doc, index);
        assert.ok(Array.isArray(result));
      }, `hook ${hookName} should not throw`);
    }
  });
});

// ─── Function references ──────────────────────────────────────────────────────

suite("onReferences — workspace function", () => {
  test("function with no imports → returns only declaration location", () => {
    const fnUri = "file:///utils.ts";
    const fn = makeFunction("formatDate", fnUri);
    const index = makeIndex({ functions: [fn] });

    const doc = makeDoc("formatDate");
    const params = makeParams(doc, 0, 5);

    const result = onReferences(params, doc, index);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].uri, fnUri);
  });

  test("function with one import → returns declaration + import location", () => {
    const fnUri = "file:///utils.ts";
    const importUri = "file:///caller.ts";
    const fn = makeFunction("formatDate", fnUri);
    const imp = makeImport("formatDate", importUri, 3);
    const importsBySpec = new Map([["formatDate", [imp]]]);
    const index = makeIndex({ functions: [fn], importsBySpecifier: importsBySpec });

    const doc = makeDoc("formatDate");
    const params = makeParams(doc, 0, 5);

    const result = onReferences(params, doc, index);
    assert.strictEqual(result.length, 2);
    const uris = result.map((l) => l.uri);
    assert.ok(uris.includes(fnUri));
    assert.ok(uris.includes(importUri));
  });

  test("function with multiple imports → returns declaration + all", () => {
    const fnUri = "file:///utils.ts";
    const fn = makeFunction("parseDate", fnUri);
    const imports = [
      makeImport("parseDate", "file:///a.ts", 1),
      makeImport("parseDate", "file:///b.ts", 2),
      makeImport("parseDate", "file:///c.ts", 3),
    ];
    const importsBySpec = new Map([["parseDate", imports]]);
    const index = makeIndex({ functions: [fn], importsBySpecifier: importsBySpec });

    const doc = makeDoc("parseDate");
    const params = makeParams(doc, 0, 5);

    const result = onReferences(params, doc, index);
    assert.strictEqual(result.length, 4); // 1 decl + 3 imports
  });
});

// ─── Combined component + function overlap ────────────────────────────────────

suite("onReferences — combined component and function with same name", () => {
  test("name in both component and function index → both declarations appear", () => {
    // This edge case: the name is registered as both a component and a function
    const compUri = "file:///comp.ts";
    const fnUri = "file:///fn.ts";
    const comp = makeComponent("Shared", compUri);
    const fn = makeFunction("Shared", fnUri);
    const index = makeIndex({ components: [comp], functions: [fn] });

    const doc = makeDoc("Shared");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);

    // At minimum: comp declaration + fn declaration
    assert.ok(result.length >= 2, "should include both component and function declarations");
    const uris = result.map((l) => l.uri);
    assert.ok(uris.includes(compUri), "component uri should be present");
    assert.ok(uris.includes(fnUri), "function uri should be present");
  });
});

// ─── Result shape validation ──────────────────────────────────────────────────

suite("onReferences — result object shape", () => {
  test("every location in result has uri and range properties", () => {
    const compUri = "file:///shape-test.ts";
    const importUri = "file:///user.ts";
    const comp = makeComponent("ShapeTest", compUri);
    const imp = makeImport("ShapeTest", importUri, 7);
    const importsBySpec = new Map([["ShapeTest", [imp]]]);
    const index = makeIndex({ components: [comp], importsBySpecifier: importsBySpec });

    const doc = makeDoc("ShapeTest");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);

    for (const loc of result) {
      assert.ok(typeof loc.uri === "string", "uri should be a string");
      assert.ok(loc.range, "range should be defined");
      assert.ok(
        typeof loc.range.start.line === "number",
        "range.start.line should be a number"
      );
      assert.ok(
        typeof loc.range.start.character === "number",
        "range.start.character should be a number"
      );
    }
  });

  test("import record range is preserved correctly in the returned Location", () => {
    const importUri = "file:///precise.ts";
    const imp = makeImport("useState", importUri, 12);
    imp.range = {
      start: { line: 12, character: 9 },
      end: { line: 12, character: 17 },
    };
    const importsBySpec = new Map([["useState", [imp]]]);
    const index = makeIndex({ importsBySpecifier: importsBySpec });

    const doc = makeDoc("useState");
    const params = makeParams(doc, 0, 3);

    const result = onReferences(params, doc, index);

    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].range.start, { line: 12, character: 9 });
    assert.deepStrictEqual(result[0].range.end, { line: 12, character: 17 });
  });
});
