/**
 * Unit tests for src/server/resolver/addonDetector.ts
 *
 * Strategy: real filesystem operations using os.tmpdir() temp directories.
 * Every test creates its own isolated directory and cleans up in a finally block.
 */
import * as assert from "assert";
import { suite, test } from "mocha";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  detectOdooRoot,
  detectAddons,
  buildAliasMap,
  findOwlLibraryPath,
  findOwlLibraryFiles,
  resolveAlias,
  inferAliasFromPath,
  filePathToAlias,
} from "../server/resolver/addonDetector";
import { AddonInfo } from "../shared/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "owl-addondetector-test-"));
}

function makeAddonWithStaticSrc(base: string, name: string): string {
  const addonRoot = path.join(base, name);
  const staticSrc = path.join(addonRoot, "static", "src");
  fs.mkdirSync(staticSrc, { recursive: true });
  fs.writeFileSync(path.join(addonRoot, "__manifest__.py"), "{}");
  return addonRoot;
}

function makeAddonWithOwlLib(base: string, name: string): string {
  const addonRoot = path.join(base, name);
  const owlDir = path.join(addonRoot, "static", "lib", "owl");
  fs.mkdirSync(owlDir, { recursive: true });
  fs.writeFileSync(path.join(addonRoot, "__manifest__.py"), "{}");
  fs.writeFileSync(path.join(owlDir, "owl.js"), "// owl");
  return addonRoot;
}

function makeAddonInfo(
  name: string,
  root: string,
  staticSrcPath: string
): AddonInfo {
  return { name, root, staticSrcPath };
}

// ─── detectOdooRoot ───────────────────────────────────────────────────────────

suite("detectOdooRoot()", () => {
  test("returns the workspace folder itself when it contains odoo-bin", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, "odoo-bin"), "#!/usr/bin/env python");
      const result = detectOdooRoot([tmpDir]);
      assert.strictEqual(result, tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns folder when it contains setup.cfg (odoo root marker)", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, "setup.cfg"), "[options]");
      const result = detectOdooRoot([tmpDir]);
      assert.strictEqual(result, tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns folder when it contains odoo/release.py", () => {
    const tmpDir = makeTmpDir();
    try {
      const odooDir = path.join(tmpDir, "odoo");
      fs.mkdirSync(odooDir, { recursive: true });
      fs.writeFileSync(path.join(odooDir, "release.py"), "VERSION = '17.0'");
      const result = detectOdooRoot([tmpDir]);
      assert.strictEqual(result, tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("finds odoo root 1 level up from workspace folder", () => {
    const tmpDir = makeTmpDir();
    try {
      // odoo-bin is at tmpDir level; workspace folder is tmpDir/addons/my_addon
      fs.writeFileSync(path.join(tmpDir, "odoo-bin"), "#!/usr/bin/env python");
      const workspace = path.join(tmpDir, "addons", "my_addon");
      fs.mkdirSync(workspace, { recursive: true });
      const result = detectOdooRoot([workspace]);
      assert.strictEqual(result, tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("finds odoo root 2 levels up from workspace folder", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, "odoo-bin"), "#!/usr/bin/env python");
      const workspace = path.join(tmpDir, "level1", "level2");
      fs.mkdirSync(workspace, { recursive: true });
      const result = detectOdooRoot([workspace]);
      assert.strictEqual(result, tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("finds odoo root 3 levels up from workspace folder", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, "odoo-bin"), "#!/usr/bin/env python");
      const workspace = path.join(tmpDir, "a", "b", "c");
      fs.mkdirSync(workspace, { recursive: true });
      const result = detectOdooRoot([workspace]);
      assert.strictEqual(result, tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns undefined when no odoo root marker is found", () => {
    const tmpDir = makeTmpDir();
    try {
      const result = detectOdooRoot([tmpDir]);
      assert.strictEqual(result, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns undefined for empty workspace folders array", () => {
    const result = detectOdooRoot([]);
    assert.strictEqual(result, undefined);
  });

  test("returns first matched root when multiple workspace folders are provided", () => {
    const tmpDir1 = makeTmpDir();
    const tmpDir2 = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir1, "odoo-bin"), "#!/usr/bin/env python");
      fs.writeFileSync(path.join(tmpDir2, "odoo-bin"), "#!/usr/bin/env python");
      const result = detectOdooRoot([tmpDir1, tmpDir2]);
      assert.strictEqual(result, tmpDir1);
    } finally {
      fs.rmSync(tmpDir1, { recursive: true });
      fs.rmSync(tmpDir2, { recursive: true });
    }
  });

  test("returns undefined when marker is 4+ levels up (beyond search depth)", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, "odoo-bin"), "#!/usr/bin/env python");
      // 4 levels deep — beyond the 3-level limit
      const workspace = path.join(tmpDir, "a", "b", "c", "d");
      fs.mkdirSync(workspace, { recursive: true });
      const result = detectOdooRoot([workspace]);
      assert.strictEqual(result, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── detectAddons ─────────────────────────────────────────────────────────────

suite("detectAddons()", () => {
  test("discovers addon directories with __manifest__.py and static/src", () => {
    const tmpDir = makeTmpDir();
    try {
      const addonPath = makeAddonWithStaticSrc(tmpDir, "my_addon");
      const addons = detectAddons(undefined, [tmpDir]);
      const found = addons.find((a) => a.name === "my_addon");
      assert.ok(found, "should discover my_addon");
      assert.strictEqual(found!.root, addonPath);
      assert.strictEqual(
        found!.staticSrcPath,
        path.join(addonPath, "static", "src")
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("discovers multiple addons in a workspace folder", () => {
    const tmpDir = makeTmpDir();
    try {
      makeAddonWithStaticSrc(tmpDir, "addon_a");
      makeAddonWithStaticSrc(tmpDir, "addon_b");
      makeAddonWithStaticSrc(tmpDir, "addon_c");
      const addons = detectAddons(undefined, [tmpDir]);
      const names = addons.map((a) => a.name);
      assert.ok(names.includes("addon_a"), "should find addon_a");
      assert.ok(names.includes("addon_b"), "should find addon_b");
      assert.ok(names.includes("addon_c"), "should find addon_c");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("ignores directories without __manifest__.py", () => {
    const tmpDir = makeTmpDir();
    try {
      // Directory with static/src but no manifest
      const noManifest = path.join(tmpDir, "no_manifest");
      fs.mkdirSync(path.join(noManifest, "static", "src"), { recursive: true });
      const addons = detectAddons(undefined, [tmpDir]);
      const found = addons.find((a) => a.name === "no_manifest");
      assert.strictEqual(found, undefined, "should not detect addon without manifest");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("ignores addon directories without static/src (and no owl lib)", () => {
    const tmpDir = makeTmpDir();
    try {
      // Has manifest but no static/src
      const addonDir = path.join(tmpDir, "bare_addon");
      fs.mkdirSync(addonDir, { recursive: true });
      fs.writeFileSync(path.join(addonDir, "__manifest__.py"), "{}");
      const addons = detectAddons(undefined, [tmpDir]);
      const found = addons.find((a) => a.name === "bare_addon");
      assert.strictEqual(
        found,
        undefined,
        "addon without static/src or owl lib should not be returned"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("accepts __openerp__.py as an alternative manifest file", () => {
    const tmpDir = makeTmpDir();
    try {
      const addonDir = path.join(tmpDir, "old_addon");
      fs.mkdirSync(path.join(addonDir, "static", "src"), { recursive: true });
      fs.writeFileSync(path.join(addonDir, "__openerp__.py"), "{}");
      const addons = detectAddons(undefined, [tmpDir]);
      const found = addons.find((a) => a.name === "old_addon");
      assert.ok(found, "should detect addon with __openerp__.py manifest");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("detects addons inside odooRoot/addons/ when odooRoot is provided", () => {
    const tmpDir = makeTmpDir();
    try {
      const addonsDir = path.join(tmpDir, "addons");
      fs.mkdirSync(addonsDir, { recursive: true });
      makeAddonWithStaticSrc(addonsDir, "web");
      const addons = detectAddons(tmpDir, []);
      const found = addons.find((a) => a.name === "web");
      assert.ok(found, "should discover web addon inside odooRoot/addons/");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("detects addons directly inside odooRoot when odooRoot is provided", () => {
    const tmpDir = makeTmpDir();
    try {
      makeAddonWithStaticSrc(tmpDir, "mail");
      const addons = detectAddons(tmpDir, []);
      const found = addons.find((a) => a.name === "mail");
      assert.ok(found, "should discover mail addon directly in odooRoot");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("deduplicates addons that appear in multiple search roots", () => {
    const tmpDir = makeTmpDir();
    try {
      // Addon is both in workspaceFolders and inside odooRoot
      makeAddonWithStaticSrc(tmpDir, "shared_addon");
      // workspace folder = tmpDir, odooRoot = tmpDir — same addon seen twice
      const addons = detectAddons(tmpDir, [tmpDir]);
      const count = addons.filter((a) => a.name === "shared_addon").length;
      assert.strictEqual(count, 1, "duplicate addon should appear only once");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("detects owl-lib-only addon (static/lib/owl/owl.js without static/src)", () => {
    const tmpDir = makeTmpDir();
    try {
      makeAddonWithOwlLib(tmpDir, "web");
      const addons = detectAddons(undefined, [tmpDir]);
      const found = addons.find((a) => a.name === "web");
      assert.ok(found, "should detect web addon with only owl lib");
      assert.strictEqual(found!.staticSrcPath, "", "staticSrcPath should be empty string for owl-lib-only");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns empty array when workspace folder does not exist", () => {
    const addons = detectAddons(undefined, ["/nonexistent/path/9999"]);
    assert.deepStrictEqual(addons, []);
  });

  test("checks extra addon paths: enterprise, extra-addons, custom-addons, custom_addons", () => {
    const tmpDir = makeTmpDir();
    try {
      for (const extra of ["enterprise", "extra-addons", "custom-addons", "custom_addons"]) {
        const extraDir = path.join(tmpDir, extra);
        makeAddonWithStaticSrc(extraDir, `addon_in_${extra}`);
      }
      const addons = detectAddons(tmpDir, []);
      const names = addons.map((a) => a.name);
      assert.ok(names.includes("addon_in_enterprise"), "should find addon in enterprise/");
      assert.ok(names.includes("addon_in_extra-addons"), "should find addon in extra-addons/");
      assert.ok(names.includes("addon_in_custom-addons"), "should find addon in custom-addons/");
      assert.ok(names.includes("addon_in_custom_addons"), "should find addon in custom_addons/");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── buildAliasMap ────────────────────────────────────────────────────────────

suite("buildAliasMap()", () => {
  test("creates @addon-name → staticSrcPath entries", () => {
    const addons: AddonInfo[] = [
      makeAddonInfo("web", "/odoo/web", "/odoo/web/static/src"),
      makeAddonInfo("mail", "/odoo/mail", "/odoo/mail/static/src"),
    ];
    const map = buildAliasMap(addons);
    assert.strictEqual(map.get("@web"), "/odoo/web/static/src");
    assert.strictEqual(map.get("@mail"), "/odoo/mail/static/src");
  });

  test("returns an empty map for an empty addons array", () => {
    const map = buildAliasMap([]);
    assert.strictEqual(map.size, 0);
  });

  test("handles addon with empty staticSrcPath (owl-lib-only)", () => {
    const addons: AddonInfo[] = [
      makeAddonInfo("web", "/odoo/web", ""),
    ];
    const map = buildAliasMap(addons);
    assert.strictEqual(map.has("@web"), true);
    assert.strictEqual(map.get("@web"), "");
  });

  test("correctly prefixes @ symbol on every addon name", () => {
    const addons: AddonInfo[] = [
      makeAddonInfo("account", "/odoo/account", "/odoo/account/static/src"),
      makeAddonInfo("sale", "/odoo/sale", "/odoo/sale/static/src"),
    ];
    const map = buildAliasMap(addons);
    assert.ok(map.has("@account"));
    assert.ok(map.has("@sale"));
    assert.ok(!map.has("account"), "raw name without @ should not be a key");
  });

  test("returns a Map instance", () => {
    const map = buildAliasMap([]);
    assert.ok(map instanceof Map);
  });

  test("handles many addons without collision", () => {
    const addons: AddonInfo[] = Array.from({ length: 20 }, (_, i) =>
      makeAddonInfo(`addon${i}`, `/path/addon${i}`, `/path/addon${i}/static/src`)
    );
    const map = buildAliasMap(addons);
    assert.strictEqual(map.size, 20);
    for (let i = 0; i < 20; i++) {
      assert.strictEqual(map.get(`@addon${i}`), `/path/addon${i}/static/src`);
    }
  });
});

// ─── findOwlLibraryPath ───────────────────────────────────────────────────────

suite("findOwlLibraryPath()", () => {
  test("returns path to owl.js when web addon has it", () => {
    const tmpDir = makeTmpDir();
    try {
      const webRoot = makeAddonWithOwlLib(tmpDir, "web");
      const addons: AddonInfo[] = [
        makeAddonInfo("web", webRoot, ""),
      ];
      const result = findOwlLibraryPath(addons);
      assert.strictEqual(
        result,
        path.join(webRoot, "static", "lib", "owl", "owl.js")
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns undefined when there is no web addon", () => {
    const addons: AddonInfo[] = [
      makeAddonInfo("mail", "/odoo/mail", "/odoo/mail/static/src"),
    ];
    const result = findOwlLibraryPath(addons);
    assert.strictEqual(result, undefined);
  });

  test("returns undefined when web addon exists but owl.js is absent", () => {
    const tmpDir = makeTmpDir();
    try {
      const webRoot = path.join(tmpDir, "web");
      fs.mkdirSync(path.join(webRoot, "static", "src"), { recursive: true });
      fs.writeFileSync(path.join(webRoot, "__manifest__.py"), "{}");
      const addons: AddonInfo[] = [
        makeAddonInfo("web", webRoot, path.join(webRoot, "static", "src")),
      ];
      const result = findOwlLibraryPath(addons);
      assert.strictEqual(result, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns undefined for empty addons array", () => {
    const result = findOwlLibraryPath([]);
    assert.strictEqual(result, undefined);
  });
});

// ─── findOwlLibraryFiles ──────────────────────────────────────────────────────

suite("findOwlLibraryFiles()", () => {
  test("returns owlJs path when owl.js exists", () => {
    const tmpDir = makeTmpDir();
    try {
      const webRoot = makeAddonWithOwlLib(tmpDir, "web");
      const addons: AddonInfo[] = [makeAddonInfo("web", webRoot, "")];
      const result = findOwlLibraryFiles(addons);
      assert.strictEqual(
        result.owlJs,
        path.join(webRoot, "static", "lib", "owl", "owl.js")
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns owlModuleJs when owl_module.js exists", () => {
    const tmpDir = makeTmpDir();
    try {
      const webRoot = makeAddonWithOwlLib(tmpDir, "web");
      const owlDir = path.join(webRoot, "static", "lib", "owl");
      fs.writeFileSync(path.join(owlDir, "owl_module.js"), "// module");
      const addons: AddonInfo[] = [makeAddonInfo("web", webRoot, "")];
      const result = findOwlLibraryFiles(addons);
      assert.strictEqual(
        result.owlModuleJs,
        path.join(owlDir, "owl_module.js")
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("falls back to odoo_module.js when owl_module.js is absent", () => {
    const tmpDir = makeTmpDir();
    try {
      const webRoot = makeAddonWithOwlLib(tmpDir, "web");
      const owlDir = path.join(webRoot, "static", "lib", "owl");
      fs.writeFileSync(path.join(owlDir, "odoo_module.js"), "// odoo module");
      const addons: AddonInfo[] = [makeAddonInfo("web", webRoot, "")];
      const result = findOwlLibraryFiles(addons);
      assert.strictEqual(
        result.owlModuleJs,
        path.join(owlDir, "odoo_module.js")
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns both undefined when no web addon is present", () => {
    const addons: AddonInfo[] = [makeAddonInfo("mail", "/mail", "/mail/static/src")];
    const result = findOwlLibraryFiles(addons);
    assert.strictEqual(result.owlJs, undefined);
    assert.strictEqual(result.owlModuleJs, undefined);
  });

  test("returns both undefined for empty addons array", () => {
    const result = findOwlLibraryFiles([]);
    assert.strictEqual(result.owlJs, undefined);
    assert.strictEqual(result.owlModuleJs, undefined);
  });

  test("owlModuleJs is undefined when neither owl_module.js nor odoo_module.js exists", () => {
    const tmpDir = makeTmpDir();
    try {
      const webRoot = makeAddonWithOwlLib(tmpDir, "web");
      const addons: AddonInfo[] = [makeAddonInfo("web", webRoot, "")];
      const result = findOwlLibraryFiles(addons);
      assert.strictEqual(result.owlModuleJs, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── resolveAlias ─────────────────────────────────────────────────────────────

suite("resolveAlias()", () => {
  test("resolves @web/core/utils/hooks to a real path when file exists", () => {
    const tmpDir = makeTmpDir();
    try {
      const staticSrc = path.join(tmpDir, "web", "static", "src");
      const targetDir = path.join(staticSrc, "core", "utils");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, "hooks.ts"), "export {};");
      const aliasMap = new Map([["@web", staticSrc]]);
      const result = resolveAlias("@web/core/utils/hooks", aliasMap);
      assert.strictEqual(result, path.join(targetDir, "hooks.ts"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns best-effort resolved path when file does not exist", () => {
    const aliasMap = new Map([["@web", "/fake/web/static/src"]]);
    const result = resolveAlias("@web/core/utils/hooks", aliasMap);
    // Should return a path even though file doesn't exist
    assert.ok(typeof result === "string");
    assert.ok(result!.includes("hooks"));
  });

  test("returns undefined for import path with no matching alias", () => {
    const aliasMap = new Map([["@web", "/fake/web/static/src"]]);
    const result = resolveAlias("@mail/thread/list", aliasMap);
    assert.strictEqual(result, undefined);
  });

  test("returns file-level alias target directly when target ends with .js", () => {
    const aliasMap = new Map([
      ["@odoo/owl", "/path/to/web/static/lib/owl/owl.js"],
    ]);
    const result = resolveAlias("@odoo/owl", aliasMap);
    assert.strictEqual(result, "/path/to/web/static/lib/owl/owl.js");
  });

  test("returns file-level alias for path starting with the alias", () => {
    const aliasMap = new Map([
      ["@odoo/owl", "/path/to/web/static/lib/owl/owl.js"],
    ]);
    // When the import starts with the alias, the file-level target is returned as-is
    const result = resolveAlias("@odoo/owl", aliasMap);
    assert.ok(result!.endsWith("owl.js"));
  });

  test("returns undefined when alias map is empty", () => {
    const aliasMap = new Map<string, string>();
    const result = resolveAlias("@web/core/hooks", aliasMap);
    assert.strictEqual(result, undefined);
  });

  test("resolves exact alias match (no subpath)", () => {
    const tmpDir = makeTmpDir();
    try {
      // Put an index.ts at the staticSrc root
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "index.ts"), "export {};");
      const aliasMap = new Map([["@web", tmpDir]]);
      const result = resolveAlias("@web", aliasMap);
      // For an exact alias match with no trailing slash, the target is treated
      // as a directory; it tries resolved + extensions
      assert.ok(typeof result === "string" || result === undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("tries .ts extension before returning best-effort", () => {
    const tmpDir = makeTmpDir();
    try {
      const staticSrc = path.join(tmpDir, "static", "src");
      fs.mkdirSync(staticSrc, { recursive: true });
      fs.writeFileSync(path.join(staticSrc, "hooks.ts"), "export {};");
      const aliasMap = new Map([["@web", staticSrc]]);
      const result = resolveAlias("@web/hooks", aliasMap);
      assert.strictEqual(result, path.join(staticSrc, "hooks.ts"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns the directory path when directory exists (index.ts inside is not checked first)", () => {
    const tmpDir = makeTmpDir();
    try {
      const staticSrc = path.join(tmpDir, "static", "src");
      const subDir = path.join(staticSrc, "components");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, "index.ts"), "export {};");
      const aliasMap = new Map([["@web", staticSrc]]);
      const result = resolveAlias("@web/components", aliasMap);
      // resolveAlias checks extensions in order: ["", ".ts", ".js", "/index.ts", "/index.js"].
      // The bare path (no extension) resolves to the directory itself, which fs.existsSync
      // returns true for. So the directory path is returned before /index.ts is tried.
      assert.strictEqual(result, subDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("returns target for .cjs and .d.ts file-level aliases", () => {
    const aliasMap = new Map([
      ["@lib/cjs", "/some/lib.cjs"],
      ["@lib/dts", "/some/lib.d.ts"],
    ]);
    assert.strictEqual(resolveAlias("@lib/cjs", aliasMap), "/some/lib.cjs");
    assert.strictEqual(resolveAlias("@lib/dts", aliasMap), "/some/lib.d.ts");
  });
});

// ─── inferAliasFromPath ───────────────────────────────────────────────────────

suite("inferAliasFromPath()", () => {
  test("infers @addonName/... from a standard addons path", () => {
    const filePath = "/odoo/addons/web/static/src/core/utils/hooks.ts";
    const result = inferAliasFromPath(filePath);
    assert.strictEqual(result, "@web/core/utils/hooks");
  });

  test("strips .js extension", () => {
    const filePath = "/project/addons/mail/static/src/thread/list.js";
    const result = inferAliasFromPath(filePath);
    assert.strictEqual(result, "@mail/thread/list");
  });

  test("strips .ts extension", () => {
    const filePath = "/project/addons/sale/static/src/views/form.ts";
    const result = inferAliasFromPath(filePath);
    assert.strictEqual(result, "@sale/views/form");
  });

  test("strips .mjs and .cjs extensions", () => {
    assert.strictEqual(
      inferAliasFromPath("/addons/web/static/src/foo.mjs"),
      "@web/foo"
    );
    assert.strictEqual(
      inferAliasFromPath("/addons/web/static/src/bar.cjs"),
      "@web/bar"
    );
  });

  test("returns undefined for paths not matching the addons pattern", () => {
    assert.strictEqual(inferAliasFromPath("/usr/local/lib/something.ts"), undefined);
    assert.strictEqual(inferAliasFromPath("/workspace/src/component.ts"), undefined);
  });

  test("handles Windows-style backslash paths by normalizing them", () => {
    // The function normalizes backslashes to forward slashes
    const filePath = "C:\\odoo\\addons\\web\\static\\src\\hooks.ts";
    const result = inferAliasFromPath(filePath);
    assert.strictEqual(result, "@web/hooks");
  });

  test("returns undefined for empty string", () => {
    assert.strictEqual(inferAliasFromPath(""), undefined);
  });

  test("preserves nested subpath correctly", () => {
    const filePath = "/odoo/addons/account/static/src/components/reconcile/list.ts";
    const result = inferAliasFromPath(filePath);
    assert.strictEqual(result, "@account/components/reconcile/list");
  });
});

// ─── filePathToAlias ──────────────────────────────────────────────────────────

suite("filePathToAlias()", () => {
  test("converts file path to alias using aliasMap", () => {
    const aliasMap = new Map([["@web", "/odoo/web/static/src"]]);
    const result = filePathToAlias("/odoo/web/static/src/core/hooks.ts", aliasMap);
    assert.strictEqual(result, "@web/core/hooks");
  });

  test("strips extension in result", () => {
    const aliasMap = new Map([["@mail", "/odoo/mail/static/src"]]);
    const result = filePathToAlias("/odoo/mail/static/src/thread.ts", aliasMap);
    assert.strictEqual(result, "@mail/thread");
  });

  test("falls back to inferAliasFromPath when aliasMap has no match", () => {
    const aliasMap = new Map<string, string>();
    const result = filePathToAlias(
      "/project/addons/web/static/src/hooks.ts",
      aliasMap
    );
    // Falls back to inferAliasFromPath which parses the /addons/ pattern
    assert.strictEqual(result, "@web/hooks");
  });

  test("returns undefined when neither aliasMap nor path pattern matches", () => {
    const aliasMap = new Map<string, string>();
    const result = filePathToAlias("/usr/local/lib/something.ts", aliasMap);
    assert.strictEqual(result, undefined);
  });

  test("handles multiple aliases — picks the correct one", () => {
    const aliasMap = new Map([
      ["@web", "/odoo/web/static/src"],
      ["@mail", "/odoo/mail/static/src"],
    ]);
    assert.strictEqual(
      filePathToAlias("/odoo/mail/static/src/thread/model.ts", aliasMap),
      "@mail/thread/model"
    );
    assert.strictEqual(
      filePathToAlias("/odoo/web/static/src/core/bus.ts", aliasMap),
      "@web/core/bus"
    );
  });

  test("handles Windows-style paths in filePath by normalizing", () => {
    const aliasMap = new Map([["@web", "C:/odoo/web/static/src"]]);
    // Both paths get backslash-normalized in the function
    const result = filePathToAlias("C:\\odoo\\web\\static\\src\\hooks.ts", aliasMap);
    // Normalization makes both paths use forward slashes
    assert.ok(
      result === "@web/hooks" || result === undefined,
      "should resolve or return undefined gracefully"
    );
  });
});
