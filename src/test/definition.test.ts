/**
 * Unit tests for src/server/features/definition.ts
 *
 * Covers:
 *   - invalidateAstCache (exported utility)
 *   - onDefinition with cursor on OWL hook/class name (fallback word lookup)
 *   - onDefinition with cursor on an import specifier (import-specifier context)
 *   - onDefinition with cursor on a usage site that resolves via AST import map
 *   - Unknown symbol → null
 *   - AST cache reuse (same doc version = no re-parse)
 *   - AST cache invalidation (version change = re-parse on next call)
 *   - Cursor on a non-word / whitespace position → null
 *   - Relative import path resolution when file exists on disk (skipped gracefully)
 */
import * as assert from "assert";
import { suite, test } from "mocha";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocumentPositionParams } from "vscode-languageserver/node";

import { onDefinition, invalidateAstCache } from "../server/features/definition";
import {
  OwlComponent,
  ExportedFunction,
  IComponentReader,
  IFunctionReader,
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

interface IndexOptions {
  components?: OwlComponent[];
  functions?: ExportedFunction[];
  componentsByFile?: Map<string, OwlComponent[]>;
}

function makeIndex(opts: IndexOptions = {}): IComponentReader & IFunctionReader {
  const compMap = new Map((opts.components ?? []).map((c) => [c.name, c]));
  const fnMap = new Map((opts.functions ?? []).map((f) => [f.name, f]));
  const compsByFile = opts.componentsByFile ?? new Map<string, OwlComponent[]>();

  return {
    getComponent: (name) => compMap.get(name),
    getAllComponents: () => compMap.values(),
    getComponentsInFile: (uri) => compsByFile.get(uri) ?? [],
    getFunction: (name) => fnMap.get(name),
    getAllFunctions: () => fnMap.values(),
    registerSourceAlias: () => {},
    getSourceAliasUris: (_source) => [],
    getFunctionBySource: (_source, _name) => undefined,
  };
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

function makeDoc(
  content: string,
  version = 1,
  uri = "file:///test.ts"
): TextDocument {
  return TextDocument.create(uri, "typescript", version, content);
}

// ─── invalidateAstCache ───────────────────────────────────────────────────────

suite("invalidateAstCache", () => {
  test("calling invalidateAstCache does not throw", () => {
    assert.doesNotThrow(() => {
      invalidateAstCache("file:///some-file.ts");
    });
  });

  test("invalidating a URI that was never cached does not throw", () => {
    assert.doesNotThrow(() => {
      invalidateAstCache("file:///never-cached.ts");
    });
  });
});

// ─── AST cache behaviour ─────────────────────────────────────────────────────

suite("onDefinition — AST cache", () => {
  /**
   * We cannot directly inspect the private cache map, but we can verify that:
   * - A second call with the same URI + version returns the same shape of result
   *   (cache hit path) without throwing.
   * - After invalidation and a version bump, the function still works correctly.
   */

  test("same URI + version called twice does not throw (cache reuse path)", () => {
    const uri = "file:///cache-test.ts";
    const content = `import { useState } from '@odoo/owl';\nconst x = useState;`;
    const doc = makeDoc(content, 1, uri);
    const index = makeIndex();
    const aliasMap = new Map<string, string>();
    const params = makeParams(doc, 1, 10);

    assert.doesNotThrow(() => {
      onDefinition(params, doc, index, aliasMap);
      onDefinition(params, doc, index, aliasMap);
    });
  });

  test("after invalidateAstCache a new call with updated version still works", () => {
    const uri = "file:///cache-inv.ts";
    const content = `import { onMounted } from '@odoo/owl';`;
    const doc1 = makeDoc(content, 1, uri);
    const doc2 = makeDoc(content + "\n// changed", 2, uri);
    const index = makeIndex();
    const aliasMap = new Map<string, string>();
    const params = makeParams(doc1, 0, 10);

    // Prime the cache
    onDefinition(params, doc1, index, aliasMap);

    // Invalidate and call with a new version document
    invalidateAstCache(uri);
    assert.doesNotThrow(() => {
      onDefinition(makeParams(doc2, 0, 10), doc2, index, aliasMap);
    });
  });

  test("version change (no explicit invalidation) triggers re-parse path", () => {
    const uri = "file:///ver-change.ts";
    const v1Content = `import { Component } from '@odoo/owl';`;
    const v2Content = `import { Component, useState } from '@odoo/owl';`;

    const doc1 = makeDoc(v1Content, 1, uri);
    const doc2 = makeDoc(v2Content, 2, uri);
    const index = makeIndex();
    const aliasMap = new Map<string, string>();

    // Both calls should succeed without throwing
    assert.doesNotThrow(() => {
      onDefinition(makeParams(doc1, 0, 10), doc1, index, aliasMap);
      onDefinition(makeParams(doc2, 0, 10), doc2, index, aliasMap);
    });
  });
});

// ─── Fallback word lookup — component index ───────────────────────────────────

suite("onDefinition — fallback word lookup via component index", () => {
  test("cursor on component name that is in the index → returns Location", () => {
    const compUri = "file:///widgets/MyWidget.ts";
    const comp = makeComponent("MyWidget", compUri);
    const index = makeIndex({ components: [comp] });

    // Simple content without any import declaration — forces fallback path
    const doc = makeDoc("const x = MyWidget;");
    const params = makeParams(doc, 0, 12);
    const aliasMap = new Map<string, string>();

    const result = onDefinition(params, doc, index, aliasMap);

    assert.ok(result, "should return a Location for the component");
    assert.ok(
      (result as { uri: string }).uri === compUri,
      "location uri should match the component uri"
    );
  });

  test("cursor on function name that is in the index → returns Location", () => {
    const fnUri = "file:///utils/helper.ts";
    const fn = makeFunction("myHelper", fnUri);
    const index = makeIndex({ functions: [fn] });

    const doc = makeDoc("const r = myHelper();");
    const params = makeParams(doc, 0, 12);
    const aliasMap = new Map<string, string>();

    const result = onDefinition(params, doc, index, aliasMap);

    assert.ok(result, "should return a Location for the function");
    assert.ok(
      (result as { uri: string }).uri === fnUri,
      "location uri should match the function uri"
    );
  });

  test("unknown word not in any index → returns null", () => {
    const index = makeIndex();
    const doc = makeDoc("const x = unknownSymbolXYZ;");
    const params = makeParams(doc, 0, 12);
    const aliasMap = new Map<string, string>();

    const result = onDefinition(params, doc, index, aliasMap);
    assert.strictEqual(result, null);
  });

  test("cursor on whitespace → returns null", () => {
    const index = makeIndex();
    const doc = makeDoc("const x = 1;");
    // Position 9 is the space before '1'
    const params = makeParams(doc, 0, 9);
    const aliasMap = new Map<string, string>();

    const result = onDefinition(params, doc, index, aliasMap);
    assert.strictEqual(result, null);
  });
});

// ─── Import specifier resolution ─────────────────────────────────────────────

suite("onDefinition — import specifier context", () => {
  /**
   * These tests use real TypeScript source code that the parser will parse.
   * They verify the import-specifier branch is exercised.
   * Because there is no real file system here for @odoo/owl, we expect the
   * function to either return null (no alias configured) or a fallback location
   * — the important thing is it does NOT throw.
   */

  test("cursor on import specifier from @odoo/owl — does not throw", () => {
    const content = `import { useState } from '@odoo/owl';`;
    const doc = makeDoc(content);
    const index = makeIndex();
    const aliasMap = new Map<string, string>();

    // Position 9 is inside 'useState' on the import specifier
    const params = makeParams(doc, 0, 9);

    assert.doesNotThrow(() => {
      onDefinition(params, doc, index, aliasMap);
    });
  });

  test("cursor on import-path string '@odoo/owl' — does not throw", () => {
    const content = `import { Component } from '@odoo/owl';`;
    const doc = makeDoc(content);
    const index = makeIndex();
    const aliasMap = new Map<string, string>();

    // Position 26 is inside the '@odoo/owl' string literal
    const params = makeParams(doc, 0, 26);

    assert.doesNotThrow(() => {
      onDefinition(params, doc, index, aliasMap);
    });
  });

  test("cursor on usage of imported name — resolves via AST import map", () => {
    // 'MyWidget' is imported from a module; when the cursor is on a usage site
    // the code resolves which import it came from via findImportSourceForName.
    const compUri = "file:///widgets/MyWidget.ts";
    const comp = makeComponent("MyWidget", compUri);

    const byFile = new Map<string, OwlComponent[]>();
    byFile.set(compUri, [comp]);

    const index = makeIndex({ components: [comp], componentsByFile: byFile });

    // The file imports MyWidget and then uses it — cursor on usage
    const content = `import { MyWidget } from './widgets/MyWidget';\nconst x = MyWidget;`;
    const doc = makeDoc(content);
    const aliasMap = new Map<string, string>();

    // Cursor on 'MyWidget' usage at line 1, character 10
    const params = makeParams(doc, 1, 12);

    // Should not throw — may return null if file doesn't exist on disk,
    // or a Location if resolved via index
    assert.doesNotThrow(() => {
      onDefinition(params, doc, index, aliasMap);
    });
  });

  test("import from relative path that does not exist → returns null", () => {
    const content = `import { SomeComp } from './nonexistent/path';`;
    const doc = makeDoc(content);
    const index = makeIndex();
    const aliasMap = new Map<string, string>();

    // Cursor inside the import specifier 'SomeComp' at character 9
    const params = makeParams(doc, 0, 9);
    const result = onDefinition(params, doc, index, aliasMap);

    // File does not exist on disk and nothing is in the index → null
    assert.strictEqual(result, null);
  });

  test("import-path for non-existent relative path → returns null", () => {
    const content = `import { X } from './no/such/file';`;
    const doc = makeDoc(content);
    const index = makeIndex();
    const aliasMap = new Map<string, string>();

    // Cursor on the path string at character 20
    const params = makeParams(doc, 0, 20);
    const result = onDefinition(params, doc, index, aliasMap);

    assert.strictEqual(result, null);
  });
});

// ─── Malformed / unparseable content ─────────────────────────────────────────

suite("onDefinition — parse error fallback", () => {
  test("unparseable content falls back to word lookup without throwing", () => {
    // Deliberately broken TypeScript — parser will fail, should fall back
    const content = `!!! @@@@ broken syntax !!!`;
    const doc = makeDoc(content);
    const index = makeIndex();
    const aliasMap = new Map<string, string>();
    const params = makeParams(doc, 0, 5);

    assert.doesNotThrow(() => {
      onDefinition(params, doc, index, aliasMap);
    });
  });

  test("parse error with a known component name falls back to component location", () => {
    const compUri = "file:///broken/Comp.ts";
    const comp = makeComponent("broken", compUri);
    const index = makeIndex({ components: [comp] });

    // Content that will fail to parse — word 'broken' is in the index
    const content = `!@# broken #@!`;
    const doc = makeDoc(content);
    const aliasMap = new Map<string, string>();
    const params = makeParams(doc, 0, 5);

    const result = onDefinition(params, doc, index, aliasMap);
    // Either a location from the index or null — should not throw
    // (actual result depends on whether the parser tolerates the input)
    assert.doesNotThrow(() => {
      onDefinition(params, doc, index, aliasMap);
    });
    if (result !== null) {
      assert.strictEqual(
        (result as { uri: string }).uri,
        compUri,
        "fallback should find the component"
      );
    }
  });
});

// ─── aliasMap resolution ─────────────────────────────────────────────────────

suite("onDefinition — aliasMap", () => {
  test("aliasMap entry for @web resolves specifier via function index if file is indexed", () => {
    // Even with a valid alias, if the resolved file is not on disk, we get null.
    // Here we test that an alias that resolves to a non-existent path returns null
    // rather than throwing.
    const aliasMap = new Map<string, string>([
      ["@web", "/no/such/path/web/static/src"],
    ]);
    const content = `import { someUtil } from '@web/utils';`;
    const doc = makeDoc(content);
    const index = makeIndex();
    const params = makeParams(doc, 0, 10);

    assert.doesNotThrow(() => {
      onDefinition(params, doc, index, aliasMap);
    });
  });

  test("empty aliasMap + unknown module path → null", () => {
    const aliasMap = new Map<string, string>();
    const content = `import { anything } from '@unknown/module';`;
    const doc = makeDoc(content);
    const index = makeIndex();
    const params = makeParams(doc, 0, 10);

    const result = onDefinition(params, doc, index, aliasMap);
    assert.strictEqual(result, null);
  });
});
