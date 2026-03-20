/**
 * Unit tests for src/server/resolver/owlAliasResolver.ts
 *
 * Tests cover all four resolution strategies of OwlAliasResolver.resolve():
 *   Strategy 1 — derive from @web alias already in map
 *   Strategy 2 — scan detected addons list for web addon
 *   Strategy 3 — walk up ancestor directories and probe sub-paths
 *   Strategy 4 — use detected odooRoot directly
 *
 * Each test creates its own isolated temp directory with real files
 * and cleans up in a finally block.
 */
import * as assert from "assert";
import { suite, test } from "mocha";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { OwlAliasResolver } from "../server/resolver/owlAliasResolver";
import { AddonInfo } from "../shared/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "owl-alias-resolver-test-"));
}

function makeOwlJs(base: string): string {
  const owlDir = path.join(base, "web", "static", "lib", "owl");
  fs.mkdirSync(owlDir, { recursive: true });
  const owlJs = path.join(owlDir, "owl.js");
  fs.writeFileSync(owlJs, "// OWL runtime");
  return owlJs;
}

function makeWebAddon(base: string): {
  addonRoot: string;
  staticSrc: string;
  owlJs: string;
} {
  const addonRoot = path.join(base, "web");
  const staticSrc = path.join(addonRoot, "static", "src");
  const owlDir = path.join(addonRoot, "static", "lib", "owl");
  fs.mkdirSync(staticSrc, { recursive: true });
  fs.mkdirSync(owlDir, { recursive: true });
  fs.writeFileSync(path.join(addonRoot, "__manifest__.py"), "{}");
  const owlJs = path.join(owlDir, "owl.js");
  fs.writeFileSync(owlJs, "// OWL runtime");
  return { addonRoot, staticSrc, owlJs };
}

function makeAddonInfo(
  name: string,
  root: string,
  staticSrcPath: string
): AddonInfo {
  return { name, root, staticSrcPath };
}

// ─── Strategy 1: @odoo/owl already present ────────────────────────────────────

suite("OwlAliasResolver — Strategy 1: @odoo/owl already in aliasMap", () => {
  test("does not overwrite @odoo/owl when already set", () => {
    const resolver = new OwlAliasResolver(undefined);
    const aliasMap = new Map([["@odoo/owl", "/existing/owl.js"]]);
    resolver.resolve([], [], aliasMap);
    assert.strictEqual(
      aliasMap.get("@odoo/owl"),
      "/existing/owl.js",
      "pre-existing @odoo/owl entry must not be overwritten"
    );
  });

  test("sets @odoo/owl from @web alias when owl.js exists", () => {
    const tmpDir = makeTmpDir();
    try {
      const { staticSrc, owlJs } = makeWebAddon(tmpDir);
      const aliasMap = new Map([["@web", staticSrc]]);
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([], [], aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("does NOT set @odoo/owl from @web alias when owl.js is absent", () => {
    const tmpDir = makeTmpDir();
    try {
      // @web points to a static/src that exists, but no lib/owl/owl.js
      const staticSrc = path.join(tmpDir, "web", "static", "src");
      fs.mkdirSync(staticSrc, { recursive: true });
      const aliasMap = new Map([["@web", staticSrc]]);
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([], [], aliasMap);
      // Strategy 1 fails → falls through to strategy 2, which has no addons
      // → falls through to strategy 3, which finds no owl.js in walk-up
      // → falls through to strategy 4, which has no odooRoot
      // → @odoo/owl remains unset
      assert.strictEqual(aliasMap.has("@odoo/owl"), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── Strategy 2: scan addons list for web addon ───────────────────────────────

suite("OwlAliasResolver — Strategy 2: addons list contains web addon", () => {
  test("sets @odoo/owl from web addon owl.js when @web alias is not set", () => {
    const tmpDir = makeTmpDir();
    try {
      const { addonRoot, owlJs } = makeWebAddon(tmpDir);
      const addons: AddonInfo[] = [
        makeAddonInfo("web", addonRoot, path.join(addonRoot, "static", "src")),
      ];
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([], addons, aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("skips strategy 2 when @odoo/owl already set", () => {
    const tmpDir = makeTmpDir();
    try {
      const { addonRoot } = makeWebAddon(tmpDir);
      const addons: AddonInfo[] = [
        makeAddonInfo("web", addonRoot, path.join(addonRoot, "static", "src")),
      ];
      const aliasMap = new Map([["@odoo/owl", "/already/set/owl.js"]]);
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([], addons, aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), "/already/set/owl.js");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("does not set @odoo/owl when no web addon is in addons list", () => {
    const addons: AddonInfo[] = [
      makeAddonInfo("mail", "/fake/mail", "/fake/mail/static/src"),
    ];
    const aliasMap = new Map<string, string>();
    const resolver = new OwlAliasResolver(undefined);
    // No folder paths → strategy 3 won't find anything; no odooRoot → strategy 4 noop
    resolver.resolve([], addons, aliasMap);
    assert.strictEqual(aliasMap.has("@odoo/owl"), false);
  });

  test("does not set @odoo/owl when web addon exists but owl.js is missing", () => {
    const tmpDir = makeTmpDir();
    try {
      const addonRoot = path.join(tmpDir, "web");
      const staticSrc = path.join(addonRoot, "static", "src");
      fs.mkdirSync(staticSrc, { recursive: true });
      fs.writeFileSync(path.join(addonRoot, "__manifest__.py"), "{}");
      // No owl/owl.js created
      const addons: AddonInfo[] = [makeAddonInfo("web", addonRoot, staticSrc)];
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([], addons, aliasMap);
      assert.strictEqual(aliasMap.has("@odoo/owl"), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── Strategy 3: walk up ancestor directories ─────────────────────────────────

suite("OwlAliasResolver — Strategy 3: walk-up directory probe", () => {
  test("finds owl.js via web/static/lib/owl/owl.js from workspace folder itself", () => {
    const tmpDir = makeTmpDir();
    try {
      // owl.js is at tmpDir/web/static/lib/owl/owl.js
      const owlJs = makeOwlJs(tmpDir);
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(undefined);
      // Pass tmpDir as a folder path — strategy 3 checks tmpDir/web/static/lib/owl/owl.js
      resolver.resolve([tmpDir], [], aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("finds owl.js via addons/web/static/lib/owl/owl.js (workspace is addons/ root)", () => {
    const tmpDir = makeTmpDir();
    try {
      // Place owl.js at tmpDir/addons/web/static/lib/owl/owl.js
      const owlDir = path.join(tmpDir, "addons", "web", "static", "lib", "owl");
      fs.mkdirSync(owlDir, { recursive: true });
      const owlJs = path.join(owlDir, "owl.js");
      fs.writeFileSync(owlJs, "// OWL");
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([tmpDir], [], aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("finds owl.js via odoo/addons/web/static/lib/owl/owl.js", () => {
    const tmpDir = makeTmpDir();
    try {
      const owlDir = path.join(
        tmpDir, "odoo", "addons", "web", "static", "lib", "owl"
      );
      fs.mkdirSync(owlDir, { recursive: true });
      const owlJs = path.join(owlDir, "owl.js");
      fs.writeFileSync(owlJs, "// OWL");
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([tmpDir], [], aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("finds owl.js when workspace folder is nested 1 level below the Odoo root", () => {
    const tmpDir = makeTmpDir();
    try {
      // owl.js at tmpDir/web/static/lib/owl/owl.js
      const owlJs = makeOwlJs(tmpDir);
      // Workspace folder is one level below: tmpDir/my_addon
      const workspace = path.join(tmpDir, "my_addon");
      fs.mkdirSync(workspace, { recursive: true });
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([workspace], [], aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("stops walking when @odoo/owl is set by strategy 1 before reaching strategy 3", () => {
    const tmpDir = makeTmpDir();
    try {
      // Strategy 1 sets it via @web → lib/owl/owl.js
      const { staticSrc, owlJs } = makeWebAddon(tmpDir);
      // Also place a different owl.js deeper (should not be used)
      const otherOwlDir = path.join(tmpDir, "other", "web", "static", "lib", "owl");
      fs.mkdirSync(otherOwlDir, { recursive: true });
      fs.writeFileSync(path.join(otherOwlDir, "owl.js"), "// OTHER OWL");
      const aliasMap = new Map([["@web", staticSrc]]);
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([path.join(tmpDir, "other")], [], aliasMap);
      // Strategy 1 must have set it to owlJs (the one adjacent to staticSrc)
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("does not set @odoo/owl when no owl.js found during walk-up", () => {
    const tmpDir = makeTmpDir();
    try {
      const workspace = path.join(tmpDir, "workspace");
      fs.mkdirSync(workspace, { recursive: true });
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(undefined);
      // No owl.js anywhere; no addons; no odooRoot
      resolver.resolve([workspace], [], aliasMap);
      assert.strictEqual(aliasMap.has("@odoo/owl"), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("does not throw for an empty folderPaths array", () => {
    const aliasMap = new Map<string, string>();
    const resolver = new OwlAliasResolver(undefined);
    assert.doesNotThrow(() => resolver.resolve([], [], aliasMap));
  });
});

// ─── Strategy 4: use odooRoot directly ───────────────────────────────────────

suite("OwlAliasResolver — Strategy 4: odooRoot fallback", () => {
  test("sets @odoo/owl from odooRoot/addons/web/static/lib/owl/owl.js", () => {
    const tmpDir = makeTmpDir();
    try {
      const owlDir = path.join(tmpDir, "addons", "web", "static", "lib", "owl");
      fs.mkdirSync(owlDir, { recursive: true });
      const owlJs = path.join(owlDir, "owl.js");
      fs.writeFileSync(owlJs, "// OWL");
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(tmpDir);
      // No folder paths, no addons, no @web alias → strategies 1-3 all fail
      // Strategy 4 uses this.odooRoot
      resolver.resolve([], [], aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("does not set @odoo/owl when odooRoot is undefined", () => {
    const aliasMap = new Map<string, string>();
    const resolver = new OwlAliasResolver(undefined);
    resolver.resolve([], [], aliasMap);
    assert.strictEqual(aliasMap.has("@odoo/owl"), false);
  });

  test("does not set @odoo/owl when odooRoot is defined but owl.js is missing", () => {
    const tmpDir = makeTmpDir();
    try {
      // odooRoot exists but has no addons/web/static/lib/owl/owl.js
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(tmpDir);
      resolver.resolve([], [], aliasMap);
      assert.strictEqual(aliasMap.has("@odoo/owl"), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("skips strategy 4 when @odoo/owl already set by an earlier strategy", () => {
    const tmpDir = makeTmpDir();
    try {
      // Strategy 2 will set it via addons list
      const { addonRoot, owlJs } = makeWebAddon(tmpDir);
      // Also create owl.js for strategy 4 (different path)
      const odooRoot = makeTmpDir();
      const s4OwlDir = path.join(odooRoot, "addons", "web", "static", "lib", "owl");
      fs.mkdirSync(s4OwlDir, { recursive: true });
      fs.writeFileSync(path.join(s4OwlDir, "owl.js"), "// OTHER OWL");
      const addons: AddonInfo[] = [
        makeAddonInfo("web", addonRoot, path.join(addonRoot, "static", "src")),
      ];
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(odooRoot);
      resolver.resolve([], addons, aliasMap);
      // Strategy 2 sets it to owlJs; strategy 4 must not overwrite
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
      fs.rmSync(odooRoot, { recursive: true });
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── Edge cases & resolve() method contract ───────────────────────────────────

suite("OwlAliasResolver — resolve() method contract", () => {
  test("does not throw when called with all-empty arguments", () => {
    const resolver = new OwlAliasResolver(undefined);
    const aliasMap = new Map<string, string>();
    assert.doesNotThrow(() => resolver.resolve([], [], aliasMap));
  });

  test("does not throw when folderPaths contains a non-existent path", () => {
    const resolver = new OwlAliasResolver(undefined);
    const aliasMap = new Map<string, string>();
    assert.doesNotThrow(() =>
      resolver.resolve(["/nonexistent/path/999"], [], aliasMap)
    );
  });

  test("does not set @odoo/owl when called with no useful inputs", () => {
    const resolver = new OwlAliasResolver(undefined);
    const aliasMap = new Map<string, string>();
    resolver.resolve([], [], aliasMap);
    assert.strictEqual(aliasMap.has("@odoo/owl"), false);
  });

  test("resolve() mutates the provided aliasMap in-place", () => {
    const tmpDir = makeTmpDir();
    try {
      const { staticSrc } = makeWebAddon(tmpDir);
      const aliasMap = new Map([["@web", staticSrc]]);
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([], [], aliasMap);
      // The same map object should now contain @odoo/owl
      assert.ok(aliasMap.has("@odoo/owl"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("resolves correctly when multiple workspace folders are provided", () => {
    const tmpDir1 = makeTmpDir();
    const tmpDir2 = makeTmpDir();
    try {
      // Place owl.js only under tmpDir2
      const owlJs = makeOwlJs(tmpDir2);
      const aliasMap = new Map<string, string>();
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([tmpDir1, tmpDir2], [], aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), owlJs);
    } finally {
      fs.rmSync(tmpDir1, { recursive: true });
      fs.rmSync(tmpDir2, { recursive: true });
    }
  });

  test("calling resolve() twice does not duplicate or overwrite a valid entry", () => {
    const tmpDir = makeTmpDir();
    try {
      const { staticSrc, owlJs } = makeWebAddon(tmpDir);
      const aliasMap = new Map([["@web", staticSrc]]);
      const resolver = new OwlAliasResolver(undefined);
      resolver.resolve([], [], aliasMap);
      const firstValue = aliasMap.get("@odoo/owl");
      // Second call — already set, should not change
      resolver.resolve([], [], aliasMap);
      assert.strictEqual(aliasMap.get("@odoo/owl"), firstValue);
      assert.strictEqual(firstValue, owlJs);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
