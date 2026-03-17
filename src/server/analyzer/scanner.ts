import * as fs from 'fs';
import * as path from 'path';
import { AddonInfo, OwlNotifications } from '../../shared/types';
import { SymbolIndex } from './index';
import { parseFile } from './parser';

const CHUNK_SIZE = 20;
const DEBOUNCE_MS = 300;

export class WorkspaceScanner {
  private debounceMap: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    private readonly index: SymbolIndex,
    private readonly excludeGlobs: string[],
    _publishDiagnostics: (uri: string, diags: unknown[]) => void,
    private readonly notify: (method: string, params: unknown) => void
  ) {}

  /**
   * Convert a glob pattern to a RegExp for path matching.
   */
  private globToRegExp(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special regex chars (not * or ?)
      .replace(/\*\*/g, '§DOUBLESTAR§')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/§DOUBLESTAR§/g, '.*');
    return new RegExp(escaped);
  }

  isExcluded(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    for (const glob of this.excludeGlobs) {
      const re = this.globToRegExp(glob);
      if (re.test(normalizedPath)) {return true;}
    }
    return false;
  }

  async scanWorkspaceFolders(workspaceFolders: string[], addons: AddonInfo[] = []): Promise<void> {
    const startTime = Date.now();
    this.notify(OwlNotifications.ScanStarted, {});

    const allFiles: string[] = [];
    const seenFiles = new Set<string>();
    const excludePatterns = this.excludeGlobs.map((g) => this.globToRegExp(g));

    if (addons.length > 0) {
      // Addon mode: scan each addon's static/src directory
      for (const addon of addons) {
        try {
          this.collectFiles(addon.staticSrcPath, allFiles, excludePatterns, seenFiles);
        } catch (err) {
          process.stderr.write(
            `[owl-scanner] Error collecting files from addon ${addon.name} (${addon.staticSrcPath}): ${err}\n`
          );
        }
      }
    }

    // Always also scan workspace folders themselves (for non-addon repos or mixed setups)
    for (const folder of workspaceFolders) {
      try {
        this.collectFiles(folder, allFiles, excludePatterns, seenFiles);
      } catch (err) {
        process.stderr.write(
          `[owl-scanner] Error collecting files from ${folder}: ${err}\n`
        );
      }
    }

    // Process in chunks of CHUNK_SIZE, yielding between chunks
    for (let i = 0; i < allFiles.length; i += CHUNK_SIZE) {
      const chunk = allFiles.slice(i, i + CHUNK_SIZE);
      for (const filePath of chunk) {
        this.indexFile(filePath);
      }
      // Yield to event loop between chunks
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const componentCount = this.index.getAllComponents().length;
    const fileCount = allFiles.length;
    const durationMs = Date.now() - startTime;

    const params: OwlNotifications.ScanCompleteParams = {
      componentCount,
      fileCount,
      durationMs,
    };
    this.notify(OwlNotifications.ScanComplete, params);
  }

  /**
   * Debounced re-parse: schedules a reparse in DEBOUNCE_MS ms.
   */
  scheduleReparse(uri: string, content: string): void {
    const existing = this.debounceMap.get(uri);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timeout = setTimeout(() => {
      this.debounceMap.delete(uri);
      this.reparseDocument(uri, content);
    }, DEBOUNCE_MS);
    this.debounceMap.set(uri, timeout);
  }

  /**
   * Immediately re-parses the document and updates the index.
   */
  reparseDocument(uri: string, content: string): void {
    try {
      const result = parseFile(content, uri);
      this.index.upsertFileSymbols(uri, result);
    } catch (err) {
      process.stderr.write(`[owl-scanner] Error reparsing ${uri}: ${err}\n`);
    }
  }

  private indexFile(filePath: string): void {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    const uri = 'file://' + filePath.replace(/\\/g, '/');
    try {
      const result = parseFile(content, uri);
      this.index.upsertFileSymbols(uri, result);
    } catch (err) {
      process.stderr.write(`[owl-scanner] Error indexing ${filePath}: ${err}\n`);
    }
  }

  private collectFiles(
    dir: string,
    result: string[],
    excludePatterns: RegExp[],
    seen: Set<string> = new Set()
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const normalizedPath = fullPath.replace(/\\/g, '/');

      // Check exclusion
      const excluded = excludePatterns.some((re) => re.test(normalizedPath));
      if (excluded) {continue;}

      if (entry.isDirectory()) {
        this.collectFiles(fullPath, result, excludePatterns, seen);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (
          (ext === '.ts' || ext === '.js') &&
          !entry.name.endsWith('.d.ts')
        ) {
          const resolvedPath = path.resolve(fullPath);
          if (!seen.has(resolvedPath)) {
            seen.add(resolvedPath);
            result.push(fullPath);
          }
        }
      }
    }
  }
}
