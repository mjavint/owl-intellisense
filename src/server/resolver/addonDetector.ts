import * as fs from 'fs';
import * as path from 'path';
import { AddonInfo } from '../../shared/types';

const MANIFEST_FILES = ['__manifest__.py', '__openerp__.py'];
const ODOO_ROOT_MARKERS = ['odoo-bin', path.join('odoo', 'release.py'), 'setup.cfg'];

/**
 * Detect the Odoo root directory by searching upward from workspace folders
 * or using the configured override.
 */
export function detectOdooRoot(workspaceFolders: string[]): string | undefined {
  for (const folder of workspaceFolders) {
    // Check if workspace folder itself is odoo root
    if (isOdooRoot(folder)) {return folder;}
    // Check parent directories (up to 3 levels)
    let current = path.dirname(folder);
    for (let i = 0; i < 3; i++) {
      if (isOdooRoot(current)) {return current;}
      current = path.dirname(current);
    }
  }
  return undefined;
}

function isOdooRoot(dir: string): boolean {
  return ODOO_ROOT_MARKERS.some(marker => {
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
export function detectAddons(odooRoot: string | undefined, workspaceFolders: string[]): AddonInfo[] {
  const addons: AddonInfo[] = [];
  const seen = new Set<string>();

  const searchRoots: string[] = [...workspaceFolders];
  if (odooRoot) {
    searchRoots.push(odooRoot, path.join(odooRoot, 'addons'));
    // Also check for enterprise/extra-addons
    for (const extra of ['enterprise', 'extra-addons', 'custom-addons', 'custom_addons']) {
      searchRoots.push(path.join(odooRoot, extra));
    }
  }

  for (const searchRoot of searchRoots) {
    if (!fs.existsSync(searchRoot)) {continue;}

    // Check if searchRoot itself is an addon
    if (isAddon(searchRoot) && !seen.has(searchRoot)) {
      const info = buildAddonInfo(searchRoot);
      if (info) { addons.push(info); seen.add(searchRoot); }
    }

    // Check direct children
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(searchRoot, { withFileTypes: true }); }
    catch { continue; }

    for (const entry of entries) {
      if (!entry.isDirectory()) {continue;}
      const addonPath = path.join(searchRoot, entry.name);
      if (seen.has(addonPath)) {continue;}
      if (isAddon(addonPath)) {
        const info = buildAddonInfo(addonPath);
        if (info) { addons.push(info); seen.add(addonPath); }
      }
    }
  }

  return addons;
}

function isAddon(dir: string): boolean {
  return MANIFEST_FILES.some(m => fs.existsSync(path.join(dir, m)));
}

function buildAddonInfo(addonRoot: string): AddonInfo | undefined {
  const staticSrcPath = path.join(addonRoot, 'static', 'src');
  if (!fs.existsSync(staticSrcPath)) {return undefined;}
  const name = path.basename(addonRoot);
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
 * Resolve an import path using the alias map.
 * '@web/components/foo' → '/path/to/web/static/src/components/foo'
 */
export function resolveAlias(importPath: string, aliasMap: Map<string, string>): string | undefined {
  for (const [alias, targetDir] of aliasMap) {
    if (importPath === alias || importPath.startsWith(alias + '/')) {
      const rest = importPath.slice(alias.length + 1); // remove '@addon/'
      const resolved = path.join(targetDir, rest);
      // Try with extensions
      for (const ext of ['', '.ts', '.js', '/index.ts', '/index.js']) {
        const candidate = resolved + ext;
        if (fs.existsSync(candidate)) {return candidate;}
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
  const normalized = filePath.replace(/\\/g, '/');
  // Match: .../addons/{addonName}/static/src/{rest}
  const match = normalized.match(/\/addons\/([^/]+)\/static\/src\/(.+)$/);
  if (!match) { return undefined; }
  const [, addonName, rest] = match;
  // Strip extension
  const withoutExt = rest.replace(/\.(ts|js|mjs|cjs)$/, '');
  return `@${addonName}/${withoutExt}`;
}

/**
 * Given an absolute file path, compute its @addon/... import alias.
 * '/path/to/web/static/src/components/foo.ts' → '@web/components/foo'
 * Falls back to inferAliasFromPath if the aliasMap lookup fails.
 */
export function filePathToAlias(filePath: string, aliasMap: Map<string, string>): string | undefined {
  const normalized = filePath.replace(/\\/g, '/');
  for (const [alias, targetDir] of aliasMap) {
    const normalizedTarget = targetDir.replace(/\\/g, '/');
    if (normalized.startsWith(normalizedTarget + '/')) {
      const rest = normalized.slice(normalizedTarget.length + 1).replace(/\.(ts|js|mjs|cjs)$/, '');
      return `${alias}/${rest}`;
    }
  }
  // Fallback: infer from path pattern
  return inferAliasFromPath(filePath);
}
