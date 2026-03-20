import * as fs from "fs";
import * as path from "path";
import { AddonInfo } from "../../shared/types";

const MANIFEST_FILES = ["__manifest__.py", "__openerp__.py"];
const ODOO_ROOT_MARKERS = [
  "odoo-bin",
  path.join("odoo", "release.py"),
  "setup.cfg",
];

/**
 * Detect the Odoo root directory by searching upward from workspace folders
 * or using the configured override.
 */
export function detectOdooRoot(workspaceFolders: string[]): string | undefined {
  for (const folder of workspaceFolders) {
    // Check if workspace folder itself is odoo root
    if (isOdooRoot(folder)) {
      return folder;
    }
    // Check parent directories (up to 3 levels)
    let current = path.dirname(folder);
    for (let i = 0; i < 3; i++) {
      if (isOdooRoot(current)) {
        return current;
      }
      current = path.dirname(current);
    }
  }
  return undefined;
}

function isOdooRoot(dir: string): boolean {
  return ODOO_ROOT_MARKERS.some((marker) => {
    try {
      return fs.existsSync(path.join(dir, marker));
    } catch {
      return false;
    }
  });
}

/**
 * Scan directories for Odoo addons (directories with __manifest__.py).
 * Searches: odooRoot/addons/*, odooRoot/*, and each workspaceFolder directly.
 */
export function detectAddons(
  odooRoot: string | undefined,
  workspaceFolders: string[],
): AddonInfo[] {
  const addons: AddonInfo[] = [];
  const seen = new Set<string>();

  const searchRoots: string[] = [...workspaceFolders];
  if (odooRoot) {
    searchRoots.push(odooRoot, path.join(odooRoot, "addons"));
    // Also check for enterprise/extra-addons
    for (const extra of [
      "enterprise",
      "extra-addons",
      "custom-addons",
      "custom_addons",
    ]) {
      searchRoots.push(path.join(odooRoot, extra));
    }
  }

  for (const searchRoot of searchRoots) {
    if (!fs.existsSync(searchRoot)) {
      continue;
    }

    // Check if searchRoot itself is an addon
    if (isAddon(searchRoot) && !seen.has(searchRoot)) {
      const info = buildAddonInfo(searchRoot);
      if (info) {
        addons.push(info);
        seen.add(searchRoot);
      }
    }

    // Check direct children
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(searchRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const addonPath = path.join(searchRoot, entry.name);
      if (seen.has(addonPath)) {
        continue;
      }
      if (isAddon(addonPath)) {
        const info = buildAddonInfo(addonPath);
        if (info) {
          addons.push(info);
          seen.add(addonPath);
        }
      }
    }
  }

  return addons;
}

function isAddon(dir: string): boolean {
  return MANIFEST_FILES.some((m) => fs.existsSync(path.join(dir, m)));
}

function buildAddonInfo(addonRoot: string): AddonInfo | undefined {
  const staticSrc = path.join(addonRoot, "static", "src");
  const hasStaticSrc = fs.existsSync(staticSrc);
  // Also recognise addons that only have static/lib/owl/ (e.g. a minimal web addon in an
  // OWL-only workspace) so that findOwlLibraryFiles can detect the web addon even when
  // static/src has not been created yet.
  const hasOwlLib =
    !hasStaticSrc &&
    fs.existsSync(path.join(addonRoot, "static", "lib", "owl", "owl.js"));
  if (!hasStaticSrc && !hasOwlLib) {
    return undefined;
  }
  const name = path.basename(addonRoot);
  const staticSrcPath = hasStaticSrc ? staticSrc : "";
  return { name, root: addonRoot, staticSrcPath };
}

/**
 * Build the alias map from detected addons.
 * e.g. '@web' → '/path/to/web/static/src'
 */
export function buildAliasMap(addons: AddonInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const addon of addons) {
    map.set(`@${addon.name}`, addon.staticSrcPath);
  }
  return map;
}

/**
 * Find the OWL library file within the detected addons.
 * Looks for owl_module.js inside the `web` addon's static/lib/owl/ directory.
 * Returns the path if found, or undefined if not found.
 */
export function findOwlLibraryPath(addons: AddonInfo[]): string | undefined {
  const webAddon = addons.find((a) => a.name === "web");
  if (!webAddon) {
    return undefined;
  }
  const candidate = path.join(webAddon.root, "static", "lib", "owl", "owl.js");
  return fs.existsSync(candidate) ? candidate : undefined;
}

/**
 * Find OWL library files (owl.js and owl_module.js) in the `web` addon.
 * owl_module.js is preferred for symbol definitions as it contains the real OWL symbols.
 * Returns an object with the paths if found, undefined otherwise.
 */
export function findOwlLibraryFiles(addons: AddonInfo[]): {
  owlJs: string | undefined;
  owlModuleJs: string | undefined;
} {
  const webAddon = addons.find((a) => a.name === "web");
  if (!webAddon) {
    return { owlJs: undefined, owlModuleJs: undefined };
  }
  const owlDir = path.join(webAddon.root, "static", "lib", "owl");
  const owlJs = path.join(owlDir, "owl.js");
  // Support both naming conventions: owl_module.js (older) and odoo_module.js (newer Odoo versions)
  const owlModuleJs = path.join(owlDir, "owl_module.js");
  const odooModuleJs = path.join(owlDir, "odoo_module.js");
  return {
    owlJs: fs.existsSync(owlJs) ? owlJs : undefined,
    owlModuleJs: fs.existsSync(owlModuleJs)
      ? owlModuleJs
      : fs.existsSync(odooModuleJs)
        ? odooModuleJs
        : undefined,
  };
}

/**
 * Resolve an import path using the alias map.
 * '@web/components/foo' → '/path/to/web/static/src/components/foo'
 * '@odoo/owl' → '/path/to/web/static/lib/owl/owl.js'  (file-level alias — the OWL bundle)
 */
export function resolveAlias(
  importPath: string,
  aliasMap: Map<string, string> | undefined,
): string | undefined {
  if (!aliasMap) {
    return undefined;
  }
  for (const [alias, target] of aliasMap) {
    if (importPath === alias || importPath.startsWith(alias + "/")) {
      // File-level alias: target points directly to a file (not a directory)
      if (
        target.endsWith(".js") ||
        target.endsWith(".cjs") ||
        target.endsWith(".d.ts")
      ) {
        return target;
      }
      const rest = importPath.slice(alias.length + 1); // remove '@addon/'
      const resolved = path.join(target, rest);
      // Try with extensions
      for (const ext of ["", ".ts", ".js", "/index.ts", "/index.js"]) {
        const candidate = resolved + ext;
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return resolved; // return even if not found (best effort)
    }
  }
  return undefined;
}

/**
 * Infer @addon/... alias directly from a file path by detecting the
 * .../addons/{name}/static/src/... pattern. Works without a pre-built aliasMap.
 */
export function inferAliasFromPath(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  // Match: .../addons/{addonName}/static/src/{rest}
  const match = normalized.match(/\/addons\/([^/]+)\/static\/src\/(.+)$/);
  if (!match) {
    return undefined;
  }
  const [, addonName, rest] = match;
  // Strip extension
  const withoutExt = rest.replace(/\.(ts|js|mjs|cjs)$/, "");
  return `@${addonName}/${withoutExt}`;
}

/**
 * Given an absolute file path, compute its @addon/... import alias.
 * '/path/to/web/static/src/components/foo.ts' → '@web/components/foo'
 * Falls back to inferAliasFromPath if the aliasMap lookup fails.
 */
export function filePathToAlias(
  filePath: string,
  aliasMap: Map<string, string>,
): string | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  for (const [alias, targetDir] of aliasMap) {
    const normalizedTarget = targetDir.replace(/\\/g, "/");
    if (normalized.startsWith(normalizedTarget + "/")) {
      const rest = normalized
        .slice(normalizedTarget.length + 1)
        .replace(/\.(ts|js|mjs|cjs)$/, "");
      return `${alias}/${rest}`;
    }
  }
  // Fallback: infer from path pattern
  return inferAliasFromPath(filePath);
}
