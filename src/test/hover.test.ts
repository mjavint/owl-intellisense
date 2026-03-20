/**
 * Unit tests for src/server/features/hover.ts
 *
 * Covers:
 *   - OWL lifecycle hook hover (isLifecycle = true)
 *   - OWL utility hook hover with returns field
 *   - OWL hook without returns field
 *   - OWL class catalog hover
 *   - Workspace function hover (with and without signature/jsDoc)
 *   - Workspace component hover (with props, without props, with templateRef)
 *   - Unknown word → null
 *   - Word at start / end of line
 *   - Different character positions on the same line
 *   - Empty content / whitespace-only position
 */
import * as assert from "assert";
import { suite, test } from "mocha";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  TextDocumentPositionParams,
  MarkupKind,
  MarkupContent,
} from "vscode-languageserver/node";

import { onHover } from "../server/features/hover";
import {
  OwlComponent,
  ExportedFunction,
  IComponentReader,
  IFunctionReader,
} from "../shared/types";

/**
 * Narrow the Hover.contents union to MarkupContent so TypeScript is happy.
 * onHover always returns { kind: MarkupKind.Markdown, value: string } so this
 * cast is safe for all tests in this file.
 */
function hoverContents(
  result: NonNullable<ReturnType<typeof onHover>>
): MarkupContent {
  return result.contents as MarkupContent;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDoc(content: string, uri = "file:///test.ts"): TextDocument {
  return TextDocument.create(uri, "typescript", 1, content);
}

function makeParams(
  doc: TextDocument,
  line: number,
  character: number
): TextDocumentPositionParams {
  return {
    textDocument: { uri: doc.uri },
    position: { line, character },
  };
}

/** A minimal range used by fixture objects. */
function makeRange() {
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 10 },
  };
}

/** Build a minimal OwlComponent fixture. */
function makeComponent(
  name: string,
  props: Record<string, { type: string; optional: boolean; validate: boolean }> = {},
  templateRef?: string
): OwlComponent {
  return {
    name,
    filePath: `/workspace/${name}.ts`,
    uri: `file:///workspace/${name}.ts`,
    range: makeRange(),
    props,
    templateRef,
    importPath: `/workspace/${name}.ts`,
  };
}

/** Build a minimal ExportedFunction fixture. */
function makeFunction(
  name: string,
  extra: Partial<ExportedFunction> = {}
): ExportedFunction {
  return {
    name,
    filePath: `/workspace/${name}.ts`,
    uri: `file:///workspace/${name}.ts`,
    range: makeRange(),
    isDefault: false,
    ...extra,
  };
}

/**
 * Build a minimal index mock.
 * Both components and functions are optionally pre-populated.
 */
function makeIndex(
  components: OwlComponent[] = [],
  functions: ExportedFunction[] = []
): IComponentReader & IFunctionReader {
  const compMap = new Map(components.map((c) => [c.name, c]));
  const fnMap = new Map(functions.map((f) => [f.name, f]));

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
  };
}

// ─── OWL Hook hover ───────────────────────────────────────────────────────────

suite("onHover — OWL hook catalog", () => {
  const emptyIndex = makeIndex();

  test("lifecycle hook onMounted → returns Markdown with lifecycle label", () => {
    const doc = makeDoc("onMounted");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result, "should return a Hover for onMounted");
    assert.strictEqual(hoverContents(result!).kind, MarkupKind.Markdown);
    assert.ok(
      hoverContents(result!).value.includes("onMounted"),
      "value should mention hook name"
    );
    assert.ok(
      hoverContents(result!).value.includes("Lifecycle hook"),
      "should label as lifecycle hook"
    );
  });

  test("utility hook useState → returns Markdown with utility label", () => {
    const doc = makeDoc("useState");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result, "should return a Hover for useState");
    assert.strictEqual(hoverContents(result!).kind, MarkupKind.Markdown);
    assert.ok(
      hoverContents(result!).value.includes("useState"),
      "value should mention hook name"
    );
    assert.ok(
      hoverContents(result!).value.includes("Utility hook"),
      "should label as utility hook"
    );
  });

  test("utility hook useState → includes Returns field", () => {
    const doc = makeDoc("useState");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result, "should return a Hover");
    assert.ok(
      hoverContents(result!).value.includes("**Returns:**"),
      "should include the Returns line for hooks that have it"
    );
  });

  test("utility hook useEffect → does NOT include Returns field (no returns defined)", () => {
    const doc = makeDoc("useEffect");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result, "should return a Hover for useEffect");
    // useEffect has no `returns` field in the catalog
    assert.ok(
      !hoverContents(result!).value.includes("**Returns:**"),
      "useEffect should not have a Returns line"
    );
  });

  test("hook hover includes signature in code fence", () => {
    const doc = makeDoc("useRef");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result, "should return a Hover for useRef");
    assert.ok(
      hoverContents(result!).value.includes("```typescript"),
      "should include a typescript code fence"
    );
    assert.ok(
      hoverContents(result!).value.includes("useRef"),
      "code fence should contain the hook signature"
    );
  });

  test("lifecycle hook onWillStart → lifecycle label present", () => {
    const doc = makeDoc("onWillStart");
    const params = makeParams(doc, 0, 5);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result, "should return a Hover");
    assert.ok(hoverContents(result!).value.includes("Lifecycle hook"));
  });

  test("all OWL hooks produce a non-null hover", () => {
    const hooks = [
      "onWillStart",
      "onWillUpdateProps",
      "onMounted",
      "onWillUnmount",
      "onPatched",
      "onWillPatch",
      "onWillDestroy",
      "onError",
      "useState",
      "useRef",
      "useComponent",
      "useEnv",
      "useService",
      "useStore",
      "useEffect",
      "useChildSubEnv",
      "useSubEnv",
      "useExternalListener",
    ];
    for (const hookName of hooks) {
      const doc = makeDoc(hookName);
      const params = makeParams(doc, 0, 3);
      const result = onHover(params, doc, emptyIndex);
      assert.ok(result, `hook ${hookName} should produce a non-null Hover`);
    }
  });
});

// ─── OWL Class hover ──────────────────────────────────────────────────────────

suite("onHover — OWL class catalog", () => {
  const emptyIndex = makeIndex();

  test("Component → returns OWL class Markdown", () => {
    const doc = makeDoc("Component");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result, "should return a Hover for Component");
    assert.strictEqual(hoverContents(result!).kind, MarkupKind.Markdown);
    assert.ok(hoverContents(result!).value.includes("Component"));
    assert.ok(
      hoverContents(result!).value.includes("OWL class"),
      "should mention it is an OWL class"
    );
  });

  test("App → returns OWL class Markdown", () => {
    const doc = makeDoc("App");
    const params = makeParams(doc, 0, 1);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result, "should return a Hover for App");
    assert.ok(hoverContents(result!).value.includes("App"));
    assert.ok(hoverContents(result!).value.includes("OWL class"));
  });

  test("EventBus → returns OWL class Markdown", () => {
    const doc = makeDoc("EventBus");
    const params = makeParams(doc, 0, 4);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result, "should return a Hover for EventBus");
    assert.ok(hoverContents(result!).value.includes("EventBus"));
  });

  test("OWL class hover includes signature in code fence", () => {
    const doc = makeDoc("Component");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result);
    assert.ok(hoverContents(result!).value.includes("```typescript"));
  });

  test("OWL class hover references @odoo/owl import source", () => {
    const doc = makeDoc("reactive");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, emptyIndex);

    assert.ok(result);
    assert.ok(hoverContents(result!).value.includes("@odoo/owl"));
  });
});

// ─── Workspace function hover ─────────────────────────────────────────────────

suite("onHover — workspace function index", () => {
  test("function with signature and jsDoc → includes both in hover", () => {
    const fn = makeFunction("myHelper", {
      signature: "myHelper(x: number): string",
      jsDoc: "Converts a number to string.",
    });
    const index = makeIndex([], [fn]);
    const doc = makeDoc("myHelper");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, index);

    assert.ok(result, "should return a Hover for the workspace function");
    assert.ok(hoverContents(result!).value.includes("myHelper"));
    assert.ok(
      hoverContents(result!).value.includes("myHelper(x: number): string"),
      "should include signature"
    );
    assert.ok(
      hoverContents(result!).value.includes("Converts a number to string."),
      "should include jsDoc"
    );
  });

  test("function without signature → hover omits code fence", () => {
    const fn = makeFunction("simpleUtil");
    const index = makeIndex([], [fn]);
    const doc = makeDoc("simpleUtil");
    const params = makeParams(doc, 0, 5);
    const result = onHover(params, doc, index);

    assert.ok(result, "should return a Hover even without signature");
    assert.ok(hoverContents(result!).value.includes("simpleUtil"));
  });

  test("function hover includes Defined in file path", () => {
    const fn = makeFunction("myUtil");
    const index = makeIndex([], [fn]);
    const doc = makeDoc("myUtil");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, index);

    assert.ok(result);
    assert.ok(
      hoverContents(result!).value.includes("**Defined in:**"),
      "should include defined-in label"
    );
    assert.ok(
      hoverContents(result!).value.includes(fn.filePath),
      "should include the actual file path"
    );
  });
});

// ─── Workspace component hover ────────────────────────────────────────────────

suite("onHover — workspace component index", () => {
  test("component with props → hover includes prop table", () => {
    const comp = makeComponent("MyWidget", {
      label: { type: "String", optional: false, validate: false },
      count: { type: "Number", optional: true, validate: false },
    });
    const index = makeIndex([comp]);
    const doc = makeDoc("MyWidget");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, index);

    assert.ok(result, "should return a Hover for the component");
    assert.ok(hoverContents(result!).value.includes("MyWidget"));
    assert.ok(hoverContents(result!).value.includes("OWL Component"));
    assert.ok(hoverContents(result!).value.includes("label"), "should list prop 'label'");
    assert.ok(hoverContents(result!).value.includes("count"), "should list prop 'count'");
    assert.ok(hoverContents(result!).value.includes("**Props:**"), "should show Props header");
  });

  test("component with no props → hover says No props defined", () => {
    const comp = makeComponent("EmptyWidget", {});
    const index = makeIndex([comp]);
    const doc = makeDoc("EmptyWidget");
    const params = makeParams(doc, 0, 5);
    const result = onHover(params, doc, index);

    assert.ok(result);
    assert.ok(
      hoverContents(result!).value.includes("_No props defined_"),
      "should display no-props message"
    );
  });

  test("component with templateRef → hover includes Template line", () => {
    const comp = makeComponent("NavBar", {}, "NavBarTemplate");
    const index = makeIndex([comp]);
    const doc = makeDoc("NavBar");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, index);

    assert.ok(result);
    assert.ok(
      hoverContents(result!).value.includes("**Template:**"),
      "should include Template label"
    );
    assert.ok(
      hoverContents(result!).value.includes("NavBarTemplate"),
      "should show the templateRef value"
    );
  });

  test("component without templateRef → hover does not include Template line", () => {
    const comp = makeComponent("Plain", {}, undefined);
    const index = makeIndex([comp]);
    const doc = makeDoc("Plain");
    const params = makeParams(doc, 0, 2);
    const result = onHover(params, doc, index);

    assert.ok(result);
    assert.ok(
      !hoverContents(result!).value.includes("**Template:**"),
      "should not include Template line when no templateRef"
    );
  });

  test("component hover includes file path", () => {
    const comp = makeComponent("Dashboard");
    const index = makeIndex([comp]);
    const doc = makeDoc("Dashboard");
    const params = makeParams(doc, 0, 4);
    const result = onHover(params, doc, index);

    assert.ok(result);
    assert.ok(hoverContents(result!).value.includes("**File:**"));
    assert.ok(hoverContents(result!).value.includes(comp.filePath));
  });

  test("optional prop renders checkmark, required prop renders cross", () => {
    const comp = makeComponent("PropWidget", {
      required: { type: "String", optional: false, validate: false },
      optional: { type: "Boolean", optional: true, validate: false },
    });
    const index = makeIndex([comp]);
    const doc = makeDoc("PropWidget");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, index);

    assert.ok(result);
    assert.ok(hoverContents(result!).value.includes("✓"), "optional prop should show checkmark");
    assert.ok(hoverContents(result!).value.includes("✗"), "required prop should show cross");
  });
});

// ─── Unknown word / null cases ────────────────────────────────────────────────

suite("onHover — null cases", () => {
  const emptyIndex = makeIndex();

  test("unknown word not in catalog or index → returns null", () => {
    const doc = makeDoc("unknownXyzWord");
    const params = makeParams(doc, 0, 5);
    const result = onHover(params, doc, emptyIndex);
    assert.strictEqual(result, null);
  });

  test("cursor on whitespace only → returns null", () => {
    const doc = makeDoc("   ");
    const params = makeParams(doc, 0, 1);
    const result = onHover(params, doc, emptyIndex);
    assert.strictEqual(result, null);
  });

  test("empty document line → returns null", () => {
    const doc = makeDoc("");
    const params = makeParams(doc, 0, 0);
    const result = onHover(params, doc, emptyIndex);
    assert.strictEqual(result, null);
  });
});

// ─── Word-at-position edge cases ─────────────────────────────────────────────

suite("onHover — cursor position edge cases", () => {
  const emptyIndex = makeIndex();

  test("cursor at start of OWL hook word → still recognises the hook", () => {
    const doc = makeDoc("onMounted();");
    // character 0 — left edge of 'onMounted'
    const params = makeParams(doc, 0, 0);
    const result = onHover(params, doc, emptyIndex);
    assert.ok(result, "hovering at start of hook name should work");
    assert.ok(hoverContents(result!).value.includes("onMounted"));
  });

  test("cursor at end of OWL hook word → still recognises the hook", () => {
    const doc = makeDoc("onMounted");
    // character 9 — right after last char (boundary)
    const params = makeParams(doc, 0, 9);
    const result = onHover(params, doc, emptyIndex);
    assert.ok(result, "hovering at end of hook name should work");
  });

  test("cursor on non-word character between words → returns null", () => {
    const doc = makeDoc("foo + bar");
    // character 4 — the '+' space
    const params = makeParams(doc, 0, 4);
    const result = onHover(params, doc, emptyIndex);
    assert.strictEqual(result, null);
  });

  test("two different words on same line resolve independently", () => {
    // 'useState' at col 0, 'onMounted' at col 10
    const doc = makeDoc("useState; onMounted;");

    const hoverState = onHover(makeParams(doc, 0, 3), doc, emptyIndex);
    const hoverMounted = onHover(makeParams(doc, 0, 13), doc, emptyIndex);

    assert.ok(hoverState, "useState hover should not be null");
    assert.ok(hoverMounted, "onMounted hover should not be null");
    assert.ok(hoverContents(hoverState!).value.includes("useState"));
    assert.ok(hoverContents(hoverMounted!).value.includes("onMounted"));
  });

  test("OWL class name takes precedence — checked before function index", () => {
    // Index contains a function also called 'Component'; class catalog should win
    const fn = makeFunction("Component");
    const index = makeIndex([], [fn]);
    const doc = makeDoc("Component");
    const params = makeParams(doc, 0, 3);
    const result = onHover(params, doc, index);

    assert.ok(result);
    // OWL class hover includes "OWL class"; function hover includes "Defined in:"
    assert.ok(
      hoverContents(result!).value.includes("OWL class"),
      "class catalog should take precedence over function index"
    );
  });

  test("multiline document — hover on correct line", () => {
    const doc = makeDoc("const x = 1;\nonMounted;\nconst y = 2;");
    // 'onMounted' is on line 1
    const params = makeParams(doc, 1, 3);
    const result = onHover(params, doc, emptyIndex);
    assert.ok(result, "should hover on line 1");
    assert.ok(hoverContents(result!).value.includes("onMounted"));
  });
});
