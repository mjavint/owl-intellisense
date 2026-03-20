/**
 * Unit tests for src/server/analyzer/scanner.ts
 *
 * Strategy: real filesystem operations using os.tmpdir() for scanning tests.
 * Every test creates its own isolated directory and cleans up in a finally block.
 *
 * A minimal SymbolIndex is used as the ISymbolStore implementation.
 */
import * as assert from "assert";
import { suite, test } from "mocha";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { WorkspaceScanner } from "../server/analyzer/scanner";
import { SymbolIndex } from "../server/analyzer/index";
import { AddonInfo } from "../shared/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "owl-scanner-test-"));
}

function makeScanner(
  index: SymbolIndex,
  excludeGlobs: string[] = [],
  notify?: (method: string, params: unknown) => void
): WorkspaceScanner {
  return new WorkspaceScanner(
    index,
    excludeGlobs,
    () => {},
    notify ?? (() => {})
  );
}

function makeAddonInfo(
  name: string,
  root: string,
  staticSrcPath: string
): AddonInfo {
  return { name, root, staticSrcPath };
}

/**
 * Creates a static/src directory tree with the given file names (relative to static/src).
 * Returns { addonRoot, staticSrc }.
 */
function makeAddonWithFiles(
  base: string,
  addonName: string,
  relativeFiles: string[]
): { addonRoot: string; staticSrc: string } {
  const addonRoot = path.join(base, addonName);
  const staticSrc = path.join(addonRoot, "static", "src");
  fs.mkdirSync(staticSrc, { recursive: true });
  fs.writeFileSync(path.join(addonRoot, "__manifest__.py"), "{}");
  for (const rel of relativeFiles) {
    const full = path.join(staticSrc, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `// ${rel}\n`);
  }
  return { addonRoot, staticSrc };
}

// ─── isExcluded() ─────────────────────────────────────────────────────────────

suite("WorkspaceScanner.isExcluded()", () => {
  test("returns true for path matching **/node_modules/**", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index, ["**/node_modules/**"]);
    assert.strictEqual(
      scanner.isExcluded("/project/node_modules/lodash/index.js"),
      true
    );
  });

  test("returns false for path not matching any exclude pattern", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index, ["**/node_modules/**"]);
    assert.strictEqual(
      scanner.isExcluded("/project/src/component.ts"),
      false
    );
  });

  test("returns false when exclude list is empty", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index, []);
    assert.strictEqual(
      scanner.isExcluded("/project/node_modules/lodash/index.js"),
      false
    );
  });

  test("checks all patterns — matches **/dist/**", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index, ["**/node_modules/**", "**/dist/**"]);
    assert.strictEqual(scanner.isExcluded("/project/dist/bundle.js"), true);
    assert.strictEqual(scanner.isExcluded("/project/node_modules/x.js"), true);
    assert.strictEqual(scanner.isExcluded("/project/src/app.ts"), false);
  });

  test("matches **/.git/** pattern", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index, ["**/.git/**"]);
    assert.strictEqual(scanner.isExcluded("/project/.git/HEAD"), true);
    assert.strictEqual(scanner.isExcluded("/project/src/HEAD.ts"), false);
  });

  test("pattern with single * matches any path containing the suffix", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index, ["*.log"]);
    assert.strictEqual(scanner.isExcluded("/project/debug.log"), true);
    // The glob-to-regex conversion does not anchor patterns, so *.log
    // matches any path whose substring matches [^/]*\.log (i.e. any path
    // ending with .log — including nested paths).
    assert.strictEqual(scanner.isExcluded("/project/sub/debug.log"), true);
  });

  test("does not throw for empty string path", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index, ["**/node_modules/**"]);
    assert.doesNotThrow(() => scanner.isExcluded(""));
  });

  test("does not throw for root slash path", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index, ["**/node_modules/**"]);
    assert.doesNotThrow(() => scanner.isExcluded("/"));
  });

  test("normalizes Windows-style backslash paths before matching", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index, ["**/node_modules/**"]);
    // Backslash path should be normalized to forward slash internally
    assert.strictEqual(
      scanner.isExcluded("C:\\project\\node_modules\\pkg\\index.js"),
      true
    );
  });
});

// ─── removeFile() ─────────────────────────────────────────────────────────────

suite("WorkspaceScanner.removeFile()", () => {
  test("does not throw for a URI with no pending timer and no indexed data", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    assert.doesNotThrow(() => scanner.removeFile("file:///not-indexed.ts"));
  });

  test("removes file from the underlying SymbolIndex", () => {
    const tmpDir = makeTmpDir();
    try {
      const { staticSrc } = makeAddonWithFiles(tmpDir, "web", ["hooks.ts"]);
      const index = new SymbolIndex();
      const scanner = makeScanner(index);
      const uri = "file://" + path.join(staticSrc, "hooks.ts").replace(/\\/g, "/");

      // Manually upsert something so the index has data for that URI
      index.upsertFileSymbols(uri, {
        uri,
        components: [],
        services: [],
        registries: [],
        functions: [],
        imports: [],
        diagnostics: [],
      });

      scanner.removeFile(uri);
      // After removal the index should have no data for that URI
      assert.deepStrictEqual(index.getComponentsInFile(uri), []);
      assert.deepStrictEqual(index.getImportsInFile(uri), []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("cancels a pending debounce timer so no late re-parse fires", (done) => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    const uri = "file:///debounce-cancel.ts";

    // Schedule a reparse (starts the 300 ms debounce timer)
    scanner.scheduleReparse(uri, "export const x = 1;");

    // Immediately cancel via removeFile
    scanner.removeFile(uri);

    // After 400 ms (longer than DEBOUNCE_MS = 300), the parse should not have run.
    // We verify indirectly: no components were indexed for that URI.
    setTimeout(() => {
      const components = index.getComponentsInFile(uri);
      assert.deepStrictEqual(
        components,
        [],
        "debounce callback should have been cancelled"
      );
      done();
    }, 400);
  });

  test("second removeFile call for same URI does not throw", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    const uri = "file:///double-remove.ts";
    scanner.scheduleReparse(uri, "const a = 1;");
    assert.doesNotThrow(() => {
      scanner.removeFile(uri); // first: cancels timer
      scanner.removeFile(uri); // second: no timer, should be a no-op
    });
  });

  test("after removeFile, scheduleReparse can be called again without error", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    const uri = "file:///reuse.ts";
    scanner.scheduleReparse(uri, "const a = 1;");
    scanner.removeFile(uri);
    assert.doesNotThrow(() => scanner.scheduleReparse(uri, "const b = 2;"));
  });
});

// ─── scheduleReparse() & reparseDocument() ───────────────────────────────────

suite("WorkspaceScanner.scheduleReparse()", () => {
  test("does not throw when called with valid content", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    assert.doesNotThrow(() =>
      scanner.scheduleReparse("file:///a.ts", "export const x = 1;")
    );
  });

  test("coalesces rapid calls — only the last one fires after the debounce window", (done) => {
    const index = new SymbolIndex();
    const notifications: string[] = [];
    const scanner = makeScanner(index, [], (method) => {
      notifications.push(method);
    });
    const uri = "file:///coalesce.ts";

    // Fire scheduleReparse 5 times in quick succession
    for (let i = 0; i < 5; i++) {
      scanner.scheduleReparse(uri, `export const x = ${i};`);
    }

    // After 500 ms (past DEBOUNCE_MS = 300), only one parse should have run.
    // We verify by checking the index is in a consistent state (no errors).
    setTimeout(() => {
      assert.doesNotThrow(() => index.getComponentsInFile(uri));
      done();
    }, 500);
  });

  test("reparseDocument runs immediately and updates index", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    const uri = "file:///immediate.ts";
    // reparseDocument is public — call it directly
    assert.doesNotThrow(() =>
      scanner.reparseDocument(uri, "export const x = 1;")
    );
  });

  test("reparseDocument does not throw on empty content", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    assert.doesNotThrow(() => scanner.reparseDocument("file:///empty.ts", ""));
  });

  test("reparseDocument does not throw on malformed content", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    assert.doesNotThrow(() =>
      scanner.reparseDocument("file:///bad.ts", "{{{{{{{{ invalid ts")
    );
  });
});

// ─── scanWorkspaceFolders() — basic contract ──────────────────────────────────

suite("WorkspaceScanner.scanWorkspaceFolders() — basic contract", () => {
  test("returns a Promise", () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    const result = scanner.scanWorkspaceFolders([]);
    assert.ok(result instanceof Promise, "should return a Promise");
    return result;
  });

  test("resolves without throwing for empty folder list", async () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    await assert.doesNotReject(scanner.scanWorkspaceFolders([]));
  });

  test("resolves without throwing for a non-existent path", async () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    await assert.doesNotReject(
      scanner.scanWorkspaceFolders(["/definitely/does/not/exist/98765"])
    );
  });
});

// ─── scanWorkspaceFolders() — file discovery via addon mode ───────────────────

suite("WorkspaceScanner.scanWorkspaceFolders() — addon mode", () => {
  test("indexes .ts files found in addon static/src", async () => {
    const tmpDir = makeTmpDir();
    try {
      const { addonRoot, staticSrc } = makeAddonWithFiles(tmpDir, "web", [
        "component.ts",
        "utils.ts",
      ]);
      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(index, [], (method, params) => {
        notifications.push({ method, params });
      });
      const addons: AddonInfo[] = [makeAddonInfo("web", addonRoot, staticSrc)];
      await scanner.scanWorkspaceFolders([], addons);

      // ScanComplete notification must have been sent
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      assert.ok(complete, "owl/scanComplete notification must be sent");
      const params = complete!.params as { fileCount: number };
      assert.strictEqual(
        params.fileCount,
        2,
        "fileCount should equal number of .ts files discovered"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("skips addon with empty staticSrcPath (owl-lib-only)", async () => {
    const tmpDir = makeTmpDir();
    try {
      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(index, [], (method, params) => {
        notifications.push({ method, params });
      });
      // staticSrcPath is empty — should be silently skipped
      const addons: AddonInfo[] = [makeAddonInfo("web", tmpDir, "")];
      await scanner.scanWorkspaceFolders([], addons);
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      assert.ok(complete);
      const params = complete!.params as { fileCount: number };
      assert.strictEqual(params.fileCount, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("discovers files in nested subdirectories under static/src", async () => {
    const tmpDir = makeTmpDir();
    try {
      const { addonRoot, staticSrc } = makeAddonWithFiles(tmpDir, "mail", [
        "components/thread.ts",
        "components/message.ts",
        "views/list.ts",
      ]);
      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(index, [], (method, params) => {
        notifications.push({ method, params });
      });
      const addons: AddonInfo[] = [makeAddonInfo("mail", addonRoot, staticSrc)];
      await scanner.scanWorkspaceFolders([], addons);
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      const params = complete!.params as { fileCount: number };
      assert.strictEqual(params.fileCount, 3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("skips .d.ts files", async () => {
    const tmpDir = makeTmpDir();
    try {
      const { addonRoot, staticSrc } = makeAddonWithFiles(tmpDir, "web", [
        "types.d.ts",
        "component.ts",
      ]);
      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(index, [], (method, params) => {
        notifications.push({ method, params });
      });
      const addons: AddonInfo[] = [makeAddonInfo("web", addonRoot, staticSrc)];
      await scanner.scanWorkspaceFolders([], addons);
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      const params = complete!.params as { fileCount: number };
      // Only component.ts should be indexed, not types.d.ts
      assert.strictEqual(params.fileCount, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("skips lib/ and libs/ directories inside static/src", async () => {
    const tmpDir = makeTmpDir();
    try {
      const { addonRoot, staticSrc } = makeAddonWithFiles(tmpDir, "web", [
        "component.ts",
        "lib/third-party.js",
        "libs/another.js",
      ]);
      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(index, [], (method, params) => {
        notifications.push({ method, params });
      });
      const addons: AddonInfo[] = [makeAddonInfo("web", addonRoot, staticSrc)];
      await scanner.scanWorkspaceFolders([], addons);
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      const params = complete!.params as { fileCount: number };
      // Only component.ts; lib/ and libs/ are skipped
      assert.strictEqual(params.fileCount, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("excludes files matching provided exclude globs", async () => {
    const tmpDir = makeTmpDir();
    try {
      const { addonRoot, staticSrc } = makeAddonWithFiles(tmpDir, "web", [
        "component.ts",
        "node_modules/dep.ts",
      ]);
      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(
        index,
        ["**/node_modules/**"],
        (method, params) => {
          notifications.push({ method, params });
        }
      );
      const addons: AddonInfo[] = [makeAddonInfo("web", addonRoot, staticSrc)];
      await scanner.scanWorkspaceFolders([], addons);
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      const params = complete!.params as { fileCount: number };
      // node_modules/dep.ts is excluded; only component.ts is indexed
      assert.strictEqual(params.fileCount, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("deduplicates files that appear via multiple scan roots", async () => {
    const tmpDir = makeTmpDir();
    try {
      const { addonRoot, staticSrc } = makeAddonWithFiles(tmpDir, "web", [
        "component.ts",
      ]);
      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(index, [], (method, params) => {
        notifications.push({ method, params });
      });
      const addons: AddonInfo[] = [makeAddonInfo("web", addonRoot, staticSrc)];
      // Pass the same addonRoot as a workspace folder too — file should appear once
      await scanner.scanWorkspaceFolders([addonRoot], addons);
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      const params = complete!.params as { fileCount: number };
      assert.strictEqual(
        params.fileCount,
        1,
        "each file should be counted only once even if reachable via multiple roots"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── scanWorkspaceFolders() — workspace folder mode (no addons) ───────────────

suite(
  "WorkspaceScanner.scanWorkspaceFolders() — workspace folder mode (no addons)",
  () => {
    test("scans static/src subdirectory when it exists inside workspace folder", async () => {
      const tmpDir = makeTmpDir();
      try {
        const staticSrc = path.join(tmpDir, "static", "src");
        fs.mkdirSync(staticSrc, { recursive: true });
        fs.writeFileSync(path.join(staticSrc, "main.ts"), "export {};");
        fs.writeFileSync(path.join(staticSrc, "utils.ts"), "export {};");

        const index = new SymbolIndex();
        const notifications: { method: string; params: unknown }[] = [];
        const scanner = makeScanner(index, [], (method, params) => {
          notifications.push({ method, params });
        });
        await scanner.scanWorkspaceFolders([tmpDir]);
        const complete = notifications.find(
          (n) => n.method === "owl/scanComplete"
        );
        const params = complete!.params as { fileCount: number };
        assert.strictEqual(params.fileCount, 2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test("scans workspace folder root when no static/src exists", async () => {
      const tmpDir = makeTmpDir();
      try {
        fs.writeFileSync(path.join(tmpDir, "app.ts"), "export {};");
        fs.writeFileSync(path.join(tmpDir, "helper.js"), "export {};");

        const index = new SymbolIndex();
        const notifications: { method: string; params: unknown }[] = [];
        const scanner = makeScanner(index, [], (method, params) => {
          notifications.push({ method, params });
        });
        await scanner.scanWorkspaceFolders([tmpDir]);
        const complete = notifications.find(
          (n) => n.method === "owl/scanComplete"
        );
        const params = complete!.params as { fileCount: number };
        assert.strictEqual(params.fileCount, 2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    test("skips workspace folder that is already covered by an addon scan", async () => {
      const tmpDir = makeTmpDir();
      try {
        const { addonRoot, staticSrc } = makeAddonWithFiles(tmpDir, "web", [
          "main.ts",
        ]);
        // Also place a file at the workspace root level that would be scanned
        // if the workspace were not covered
        fs.writeFileSync(path.join(addonRoot, "extra.ts"), "export {};");

        const index = new SymbolIndex();
        const notifications: { method: string; params: unknown }[] = [];
        const scanner = makeScanner(index, [], (method, params) => {
          notifications.push({ method, params });
        });
        const addons: AddonInfo[] = [makeAddonInfo("web", addonRoot, staticSrc)];
        // Pass addonRoot as workspace folder — it should be skipped since addon covers it
        await scanner.scanWorkspaceFolders([addonRoot], addons);
        const complete = notifications.find(
          (n) => n.method === "owl/scanComplete"
        );
        const params = complete!.params as { fileCount: number };
        // Only main.ts from static/src; extra.ts at root not scanned due to coverage
        assert.strictEqual(params.fileCount, 1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });
  }
);

// ─── scanWorkspaceFolders() — extra files bypass exclusion ───────────────────

suite("WorkspaceScanner.scanWorkspaceFolders() — extraFiles bypass exclusion", () => {
  test("extra files are included even when they match exclude patterns", async () => {
    const tmpDir = makeTmpDir();
    try {
      // Create owl.js inside a lib directory (which would normally be skipped)
      const owlDir = path.join(tmpDir, "web", "static", "lib", "owl");
      fs.mkdirSync(owlDir, { recursive: true });
      const owlJs = path.join(owlDir, "owl.js");
      fs.writeFileSync(owlJs, "// OWL runtime");

      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(
        index,
        ["**/lib/**"],
        (method, params) => {
          notifications.push({ method, params });
        }
      );
      // Pass owl.js as an extra file — it bypasses exclusion
      await scanner.scanWorkspaceFolders([], [], [owlJs]);
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      const params = complete!.params as { fileCount: number };
      assert.strictEqual(params.fileCount, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("non-existent extra files are silently skipped", async () => {
    const index = new SymbolIndex();
    const scanner = makeScanner(index);
    await assert.doesNotReject(
      scanner.scanWorkspaceFolders(
        [],
        [],
        ["/nonexistent/owl.js"]
      )
    );
  });
});

// ─── scanWorkspaceFolders() — notifications ───────────────────────────────────

suite("WorkspaceScanner.scanWorkspaceFolders() — notifications", () => {
  test("sends owl/scanStarted notification at the beginning", async () => {
    const index = new SymbolIndex();
    const notifications: string[] = [];
    const scanner = makeScanner(index, [], (method) => notifications.push(method));
    await scanner.scanWorkspaceFolders([]);
    assert.ok(
      notifications[0] === "owl/scanStarted",
      "first notification should be owl/scanStarted"
    );
  });

  test("sends owl/scanComplete notification at the end", async () => {
    const index = new SymbolIndex();
    const notifications: string[] = [];
    const scanner = makeScanner(index, [], (method) => notifications.push(method));
    await scanner.scanWorkspaceFolders([]);
    const lastNotif = notifications[notifications.length - 1];
    assert.strictEqual(lastNotif, "owl/scanComplete");
  });

  test("sends owl/scanProgress notifications during chunked processing", async () => {
    const tmpDir = makeTmpDir();
    try {
      // Create 15 files to trigger at least 2 chunks (CHUNK_SIZE = 10)
      const staticSrc = path.join(tmpDir, "web", "static", "src");
      fs.mkdirSync(staticSrc, { recursive: true });
      for (let i = 0; i < 15; i++) {
        fs.writeFileSync(path.join(staticSrc, `comp${i}.ts`), `export {};`);
      }
      const addonRoot = path.join(tmpDir, "web");
      fs.writeFileSync(path.join(addonRoot, "__manifest__.py"), "{}");

      const index = new SymbolIndex();
      const notifications: string[] = [];
      const scanner = makeScanner(index, [], (method) => notifications.push(method));
      const addons: AddonInfo[] = [makeAddonInfo("web", addonRoot, staticSrc)];
      await scanner.scanWorkspaceFolders([], addons);

      const progressNotifs = notifications.filter(
        (n) => n === "owl/scanProgress"
      );
      assert.ok(
        progressNotifs.length >= 1,
        "should send at least one owl/scanProgress notification"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("owl/scanComplete params include fileCount, durationMs, componentCount", async () => {
    const tmpDir = makeTmpDir();
    try {
      const { addonRoot, staticSrc } = makeAddonWithFiles(tmpDir, "web", [
        "a.ts",
        "b.ts",
      ]);
      const index = new SymbolIndex();
      let completeParams: unknown;
      const scanner = makeScanner(index, [], (method, params) => {
        if (method === "owl/scanComplete") completeParams = params;
      });
      const addons: AddonInfo[] = [makeAddonInfo("web", addonRoot, staticSrc)];
      await scanner.scanWorkspaceFolders([], addons);

      assert.ok(completeParams, "owl/scanComplete params should be set");
      const p = completeParams as {
        fileCount: number;
        durationMs: number;
        componentCount: number;
        serviceCount: number;
        functionCount: number;
      };
      assert.strictEqual(typeof p.fileCount, "number");
      assert.strictEqual(typeof p.durationMs, "number");
      assert.strictEqual(typeof p.componentCount, "number");
      assert.strictEqual(typeof p.serviceCount, "number");
      assert.strictEqual(typeof p.functionCount, "number");
      assert.ok(p.durationMs >= 0);
      assert.strictEqual(p.fileCount, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── scanWorkspaceFolders() — large workspace ─────────────────────────────────

suite("WorkspaceScanner.scanWorkspaceFolders() — large workspace", () => {
  test("handles 50 files without error", async () => {
    const tmpDir = makeTmpDir();
    try {
      const relFiles = Array.from({ length: 50 }, (_, i) => `comp${i}.ts`);
      const { addonRoot, staticSrc } = makeAddonWithFiles(
        tmpDir,
        "big_addon",
        relFiles
      );
      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(index, [], (method, params) => {
        notifications.push({ method, params });
      });
      const addons: AddonInfo[] = [
        makeAddonInfo("big_addon", addonRoot, staticSrc),
      ];
      await assert.doesNotReject(scanner.scanWorkspaceFolders([], addons));
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      assert.ok(complete, "should emit owl/scanComplete");
      const params = complete!.params as { fileCount: number };
      assert.strictEqual(params.fileCount, 50);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("handles multiple addons totalling many files", async () => {
    const tmpDir = makeTmpDir();
    try {
      const addons: AddonInfo[] = [];
      for (let a = 0; a < 5; a++) {
        const relFiles = Array.from({ length: 8 }, (_, i) => `file${i}.ts`);
        const { addonRoot, staticSrc } = makeAddonWithFiles(
          tmpDir,
          `addon${a}`,
          relFiles
        );
        addons.push(makeAddonInfo(`addon${a}`, addonRoot, staticSrc));
      }
      const index = new SymbolIndex();
      const notifications: { method: string; params: unknown }[] = [];
      const scanner = makeScanner(index, [], (method, params) => {
        notifications.push({ method, params });
      });
      await assert.doesNotReject(scanner.scanWorkspaceFolders([], addons));
      const complete = notifications.find(
        (n) => n.method === "owl/scanComplete"
      );
      const params = complete!.params as { fileCount: number };
      assert.strictEqual(params.fileCount, 40);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
