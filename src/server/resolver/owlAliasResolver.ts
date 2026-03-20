import * as fs from 'fs';
import * as path from 'path';
import { AddonInfo } from '../../shared/types';
import { findOwlLibraryPath } from './addonDetector';

/**
 * Resolves the `@odoo/owl` alias by trying 4 strategies in cascade.
 * SRP: this single class owns all OWL filesystem path discovery logic,
 * keeping server.ts as a thin composition root.
 */
export class OwlAliasResolver {
  constructor(private readonly odooRoot: string | undefined) {}

  /**
   * Tries to set `aliasMap.get('@odoo/owl')` by probing filesystem paths
   * in order of specificity. Stops at the first successful strategy.
   */
  resolve(
    folderPaths: string[],
    addons: AddonInfo[],
    aliasMap: Map<string, string>,
  ): void {
    if (!this.strategy1FromWebAlias(aliasMap)) { return; }
    if (!this.strategy2FromAddonsList(addons, aliasMap)) { return; }
    if (!this.strategy3WalkUpDirectories(folderPaths, aliasMap)) { return; }
    this.strategy4FromOdooRoot(aliasMap);
  }

  /**
   * Strategy 1: derive from @web alias already in the map.
   * Returns false when alias is set (stop), true when not set (continue).
   */
  private strategy1FromWebAlias(aliasMap: Map<string, string>): boolean {
    if (aliasMap.has('@odoo/owl')) { return false; }
    const webStaticSrc = aliasMap.get('@web');
    if (webStaticSrc) {
      const candidate = path.resolve(
        webStaticSrc,
        '..',
        'lib',
        'owl',
        'owl.js',
      );
      if (fs.existsSync(candidate)) {
        aliasMap.set('@odoo/owl', candidate);
        process.stderr.write(
          `[owl-server] Mapped @odoo/owl → ${candidate}\n`,
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Strategy 2: scan detected addons list for the web addon.
   * Returns false when alias is set (stop), true when not set (continue).
   */
  private strategy2FromAddonsList(addons: AddonInfo[], aliasMap: Map<string, string>): boolean {
    if (aliasMap.has('@odoo/owl')) { return false; }
    const owlLibPath = findOwlLibraryPath(addons);
    if (owlLibPath) {
      aliasMap.set('@odoo/owl', owlLibPath);
      process.stderr.write(`[owl-server] Mapped @odoo/owl → ${owlLibPath}\n`);
      return false;
    }
    return true;
  }

  /**
   * Strategy 3: walk up ancestor directories and probe multiple sub-path patterns.
   * Covers workspaces separated from the Odoo repo (e.g. enterprise addons alongside odoo/).
   * Probed sub-paths (relative to each ancestor):
   *   web/static/lib/owl/owl.js                    — workspace IS inside web addon
   *   addons/web/static/lib/owl/owl.js              — ancestor is an addons/ dir
   *   odoo/addons/web/static/lib/owl/owl.js         — Odoo one level nested
   *   odoo/odoo/addons/web/static/lib/owl/owl.js    — Odoo double-nested (e.g. Repos/Odoo/odoo/odoo/)
   * Returns false when alias is set (stop), true when not set (continue).
   */
  private strategy3WalkUpDirectories(folderPaths: string[], aliasMap: Map<string, string>): boolean {
    if (aliasMap.has('@odoo/owl')) { return false; }
    const OWL_SUFFIX = path.join('web', 'static', 'lib', 'owl', 'owl.js');
    const subPaths = [
      OWL_SUFFIX,
      path.join('addons', OWL_SUFFIX),
      path.join('odoo', 'addons', OWL_SUFFIX),
      path.join('odoo', 'odoo', 'addons', OWL_SUFFIX),
    ];
    for (const folder of folderPaths) {
      // Start from the workspace folder itself (not its parent) so that
      // sub-paths like addons/web/... are found when the workspace IS the Odoo root.
      let dir = folder;
      for (let i = 0; i < 10; i++) {
        for (const sub of subPaths) {
          const candidate = path.join(dir, sub);
          if (fs.existsSync(candidate)) {
            aliasMap.set('@odoo/owl', candidate);
            process.stderr.write(
              `[owl-server] Mapped @odoo/owl → ${candidate}\n`,
            );
            return false;
          }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
          break;
        } // reached filesystem root
        dir = parent;
      }
    }
    return true;
  }

  /**
   * Strategy 4: use detected odooRoot directly.
   */
  private strategy4FromOdooRoot(aliasMap: Map<string, string>): void {
    if (aliasMap.has('@odoo/owl')) { return; }
    if (!this.odooRoot) { return; }
    const candidate = path.join(
      this.odooRoot,
      'addons',
      'web',
      'static',
      'lib',
      'owl',
      'owl.js',
    );
    if (fs.existsSync(candidate)) {
      aliasMap.set('@odoo/owl', candidate);
      process.stderr.write(`[owl-server] Mapped @odoo/owl → ${candidate}\n`);
    }
  }
}
