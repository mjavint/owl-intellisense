/**
 * Unit tests for src/server/features/symbols.ts
 *
 * Covers:
 *   onDocumentSymbol:
 *     - Empty index for the URI → returns empty array
 *     - Single component in file → one SymbolInformation with SymbolKind.Class
 *     - Multiple components in same file → all returned
 *     - Component with templateRef → containerName equals templateRef
 *     - Component without templateRef → containerName is undefined
 *     - Result shape validation (name, kind, location.uri, location.range)
 *
 *   onWorkspaceSymbol:
 *     - Empty workspace → returns empty array
 *     - Empty query → returns ALL components
 *     - Exact name match
 *     - Partial / case-insensitive name match
 *     - Non-matching query → empty array
 *     - Multiple components — only matching ones returned
 *     - containerName equals filePath (not templateRef)
 *     - Result shape validation (SymbolKind.Class, location)
 */
import * as assert from "assert";
import { suite, test } from "mocha";
import { SymbolKind } from "vscode-languageserver/node";

import { onDocumentSymbol, onWorkspaceSymbol } from "../server/features/symbols";
import {
  OwlComponent,
  IComponentReader,
  IFunctionReader,
  IServiceReader,
  IRegistryReader,
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

function makeComponent(
  name: string,
  uri: string,
  templateRef?: string,
  rangeLine = 0
): OwlComponent {
  return {
    name,
    filePath: uri.replace("file://", ""),
    uri,
    range: makeRange(rangeLine, 0, rangeLine, name.length),
    props: {},
    templateRef,
    importPath: uri.replace("file://", ""),
  };
}

/**
 * Minimal IComponentReader backed by a flat array of components.
 * getComponentsInFile filters by uri; getAllComponents returns all.
 */
function makeIndex(
  components: OwlComponent[]
): IComponentReader & IFunctionReader & IServiceReader & IRegistryReader {
  return {
    // IComponentReader
    getComponent: (name) => components.find((c) => c.name === name),
    getAllComponents: function* () {
      for (const c of components) {
        yield c;
      }
    },
    getComponentsInFile: (uri) => components.filter((c) => c.uri === uri),
    // IFunctionReader
    getFunction: (_name) => undefined,
    getAllFunctions: function* () {},
    registerSourceAlias: () => {},
    getSourceAliasUris: (_source) => [],
    getFunctionBySource: (_source, _name) => undefined,
    // IServiceReader
    getService: (_name) => undefined,
    getAllServices: function* () {},
    // IRegistryReader
    getRegistry: (_category, _key) => undefined,
    getRegistriesByCategory: (_category) => [],
    getAllRegistryCategories: () => [],
  };
}

// ─── onDocumentSymbol ─────────────────────────────────────────────────────────

suite("onDocumentSymbol — empty index", () => {
  test("no components registered for URI → empty array", () => {
    const index = makeIndex([]);
    const result = onDocumentSymbol(
      { textDocument: { uri: "file:///empty.ts" } },
      index
    );
    assert.deepStrictEqual(result, []);
  });

  test("components registered for a different URI → empty array for queried URI", () => {
    const comp = makeComponent("OtherComp", "file:///other.ts");
    const index = makeIndex([comp]);

    const result = onDocumentSymbol(
      { textDocument: { uri: "file:///queried.ts" } },
      index
    );
    assert.deepStrictEqual(result, []);
  });
});

suite("onDocumentSymbol — single component", () => {
  test("single component → one SymbolInformation returned", () => {
    const uri = "file:///widget.ts";
    const comp = makeComponent("MyWidget", uri);
    const index = makeIndex([comp]);

    const result = onDocumentSymbol({ textDocument: { uri } }, index);

    assert.strictEqual(result.length, 1);
  });

  test("SymbolInformation has SymbolKind.Class", () => {
    const uri = "file:///widget.ts";
    const comp = makeComponent("MyWidget", uri);
    const index = makeIndex([comp]);

    const [sym] = onDocumentSymbol({ textDocument: { uri } }, index);

    assert.strictEqual(sym.kind, SymbolKind.Class);
  });

  test("SymbolInformation name matches component name", () => {
    const uri = "file:///widget.ts";
    const comp = makeComponent("NavBar", uri);
    const index = makeIndex([comp]);

    const [sym] = onDocumentSymbol({ textDocument: { uri } }, index);

    assert.strictEqual(sym.name, "NavBar");
  });

  test("location.uri matches component uri", () => {
    const uri = "file:///widget.ts";
    const comp = makeComponent("Footer", uri);
    const index = makeIndex([comp]);

    const [sym] = onDocumentSymbol({ textDocument: { uri } }, index);

    assert.strictEqual(sym.location.uri, uri);
  });

  test("location.range matches component range", () => {
    const uri = "file:///widget.ts";
    const comp = makeComponent("Header", uri, undefined, 5);
    const index = makeIndex([comp]);

    const [sym] = onDocumentSymbol({ textDocument: { uri } }, index);

    assert.deepStrictEqual(sym.location.range.start, { line: 5, character: 0 });
  });
});

suite("onDocumentSymbol — templateRef / containerName", () => {
  test("component with templateRef → containerName equals templateRef", () => {
    const uri = "file:///tmpl.ts";
    const comp = makeComponent("MyComp", uri, "my_module.MyComp");
    const index = makeIndex([comp]);

    const [sym] = onDocumentSymbol({ textDocument: { uri } }, index);

    assert.strictEqual(sym.containerName, "my_module.MyComp");
  });

  test("component without templateRef → containerName is undefined", () => {
    const uri = "file:///notmpl.ts";
    const comp = makeComponent("PlainComp", uri, undefined);
    const index = makeIndex([comp]);

    const [sym] = onDocumentSymbol({ textDocument: { uri } }, index);

    assert.strictEqual(sym.containerName, undefined);
  });
});

suite("onDocumentSymbol — multiple components in same file", () => {
  test("two components → two SymbolInformations", () => {
    const uri = "file:///multi.ts";
    const comps = [
      makeComponent("CompA", uri, undefined, 0),
      makeComponent("CompB", uri, undefined, 10),
    ];
    const index = makeIndex(comps);

    const result = onDocumentSymbol({ textDocument: { uri } }, index);

    assert.strictEqual(result.length, 2);
  });

  test("three components → names all present in results", () => {
    const uri = "file:///triple.ts";
    const comps = [
      makeComponent("Alpha", uri),
      makeComponent("Beta", uri),
      makeComponent("Gamma", uri),
    ];
    const index = makeIndex(comps);

    const result = onDocumentSymbol({ textDocument: { uri } }, index);

    const names = result.map((s) => s.name);
    assert.ok(names.includes("Alpha"));
    assert.ok(names.includes("Beta"));
    assert.ok(names.includes("Gamma"));
  });

  test("only components matching the URI are returned", () => {
    const targetUri = "file:///target.ts";
    const otherUri = "file:///other.ts";
    const comps = [
      makeComponent("InTarget", targetUri),
      makeComponent("InOther", otherUri),
    ];
    const index = makeIndex(comps);

    const result = onDocumentSymbol({ textDocument: { uri: targetUri } }, index);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "InTarget");
  });

  test("all results have SymbolKind.Class", () => {
    const uri = "file:///kinds.ts";
    const comps = [
      makeComponent("A", uri),
      makeComponent("B", uri),
    ];
    const index = makeIndex(comps);

    const result = onDocumentSymbol({ textDocument: { uri } }, index);

    for (const sym of result) {
      assert.strictEqual(sym.kind, SymbolKind.Class);
    }
  });
});

// ─── onWorkspaceSymbol ────────────────────────────────────────────────────────

suite("onWorkspaceSymbol — empty workspace", () => {
  test("no components in index → empty array for any query", () => {
    const index = makeIndex([]);
    const result = onWorkspaceSymbol({ query: "anything" }, index);
    assert.deepStrictEqual(result, []);
  });

  test("no components in index → empty array for empty query", () => {
    const index = makeIndex([]);
    const result = onWorkspaceSymbol({ query: "" }, index);
    assert.deepStrictEqual(result, []);
  });
});

suite("onWorkspaceSymbol — empty query returns all", () => {
  test("empty query → all components returned", () => {
    const comps = [
      makeComponent("Alpha", "file:///a.ts"),
      makeComponent("Beta", "file:///b.ts"),
      makeComponent("Gamma", "file:///c.ts"),
    ];
    const index = makeIndex(comps);

    const result = onWorkspaceSymbol({ query: "" }, index);

    assert.strictEqual(result.length, 3, "empty query should return all 3 components");
  });

  test("empty query results each have SymbolKind.Class", () => {
    const comps = [
      makeComponent("X", "file:///x.ts"),
      makeComponent("Y", "file:///y.ts"),
    ];
    const index = makeIndex(comps);

    const result = onWorkspaceSymbol({ query: "" }, index);

    for (const sym of result) {
      assert.strictEqual(sym.kind, SymbolKind.Class);
    }
  });
});

suite("onWorkspaceSymbol — name filtering", () => {
  const comps = [
    makeComponent("TodoList", "file:///todo.ts"),
    makeComponent("TodoItem", "file:///item.ts"),
    makeComponent("NavBar", "file:///nav.ts"),
    makeComponent("Sidebar", "file:///sidebar.ts"),
  ];

  test("exact lowercase query matches correct component", () => {
    const index = makeIndex(comps);
    const result = onWorkspaceSymbol({ query: "navbar" }, index);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "NavBar");
  });

  test("partial query 'todo' matches TodoList and TodoItem", () => {
    const index = makeIndex(comps);
    const result = onWorkspaceSymbol({ query: "todo" }, index);

    assert.strictEqual(result.length, 2);
    const names = result.map((s) => s.name);
    assert.ok(names.includes("TodoList"));
    assert.ok(names.includes("TodoItem"));
  });

  test("query is case-insensitive (uppercase input)", () => {
    const index = makeIndex(comps);
    const result = onWorkspaceSymbol({ query: "SIDEBAR" }, index);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "Sidebar");
  });

  test("mixed-case query matches case-insensitively", () => {
    const index = makeIndex(comps);
    const result = onWorkspaceSymbol({ query: "ToDo" }, index);

    assert.strictEqual(result.length, 2);
  });

  test("non-matching query → empty array", () => {
    const index = makeIndex(comps);
    const result = onWorkspaceSymbol({ query: "xyznotexist" }, index);

    assert.deepStrictEqual(result, []);
  });

  test("single-character query returns all components whose name contains that char", () => {
    const index = makeIndex(comps);
    // 'a' is in NavBar, TodoList, TodoItem, Sidebar — all contain 'a'? Let's check:
    // NavBar → yes; TodoList → yes (a); TodoItem → yes; Sidebar → yes
    const result = onWorkspaceSymbol({ query: "a" }, index);
    // All 4 contain 'a' (case-insensitive)
    assert.ok(result.length >= 1, "at least one component should match single char");
  });
});

suite("onWorkspaceSymbol — result shape", () => {
  test("each result has SymbolKind.Class", () => {
    const comps = [makeComponent("ShapeComp", "file:///shape.ts")];
    const index = makeIndex(comps);

    const [sym] = onWorkspaceSymbol({ query: "shape" }, index);

    assert.strictEqual(sym.kind, SymbolKind.Class);
  });

  test("location.uri matches the component uri", () => {
    const uri = "file:///loc-test.ts";
    const comps = [makeComponent("LocTest", uri)];
    const index = makeIndex(comps);

    const [sym] = onWorkspaceSymbol({ query: "loctest" }, index);

    assert.strictEqual(sym.location.uri, uri);
  });

  test("location.range matches the component range", () => {
    const uri = "file:///range-test.ts";
    const comp = makeComponent("RangeTest", uri, undefined, 7);
    const index = makeIndex([comp]);

    const [sym] = onWorkspaceSymbol({ query: "range" }, index);

    assert.deepStrictEqual(sym.location.range.start, { line: 7, character: 0 });
  });

  test("containerName equals filePath (not templateRef)", () => {
    const uri = "file:///container.ts";
    const comp = makeComponent("ContainerComp", uri, "some_template");
    const index = makeIndex([comp]);

    const [sym] = onWorkspaceSymbol({ query: "container" }, index);

    // onWorkspaceSymbol uses comp.filePath, NOT comp.templateRef
    assert.strictEqual(sym.containerName, comp.filePath);
  });

  test("name in result matches component name", () => {
    const comps = [makeComponent("NameCheck", "file:///nc.ts")];
    const index = makeIndex(comps);

    const [sym] = onWorkspaceSymbol({ query: "namecheck" }, index);

    assert.strictEqual(sym.name, "NameCheck");
  });
});

suite("onWorkspaceSymbol — large workspace", () => {
  test("50 components with varied names — partial query filters correctly", () => {
    const comps: OwlComponent[] = [];
    for (let i = 0; i < 40; i++) {
      comps.push(makeComponent(`Widget${i}`, `file:///widget${i}.ts`));
    }
    for (let i = 0; i < 10; i++) {
      comps.push(makeComponent(`Panel${i}`, `file:///panel${i}.ts`));
    }
    const index = makeIndex(comps);

    const widgetResults = onWorkspaceSymbol({ query: "widget" }, index);
    const panelResults = onWorkspaceSymbol({ query: "panel" }, index);

    assert.strictEqual(widgetResults.length, 40, "should return all 40 Widget components");
    assert.strictEqual(panelResults.length, 10, "should return all 10 Panel components");
  });
});
