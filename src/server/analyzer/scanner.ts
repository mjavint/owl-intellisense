import * as fs from "fs";
import * as path from "path";
import { AddonInfo, OwlNotifications, ISymbolStore } from "../../shared/types";
import { parseFile } from "./parser";
import { validateDocument } from "../features/diagnostics";

const CHUNK_SIZE = 10; // PERF-05: chunk size for async scanning with event loop yield
const DEBOUNCE_MS = 300;

export class WorkspaceScanner {
  private debounceMap: Map<string, ReturnType<typeof setTimeout>> = new Map();
  // PERF-06: Pre-compiled exclude patterns — compiled once in constructor, reused per file
  private excludePatterns: RegExp[] = [];
  private readonly publishDiagnostics: (uri: string, diags: unknown[]) => void;

  constructor(
    private readonly index: ISymbolStore,
    excludeGlobs: string[],
    publishDiagnostics: (uri: string, diags: unknown[]) => void,
    private readonly notify: (method: string, params: unknown) => void,
  ) {
    // PERF-06: Compile all exclude globs into RegExp once at initialization
    this.excludePatterns = excludeGlobs.map((g) => this.globToRegExp(g));
    this.publishDiagnostics = publishDiagnostics;
  }

  /**
   * Convert a glob pattern to a RegExp for path matching.
   * Only called during initialization (PERF-06: not inside scan loop).
   */
  private globToRegExp(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special regex chars (not * or ?)
      .replace(/\*\*/g, "§DOUBLESTAR§")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/§DOUBLESTAR§/g, ".*");
    return new RegExp(escaped);
  }

  // PERF-06: isExcluded uses pre-compiled patterns — no globToRegExp call inside
  isExcluded(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, "/");
    return this.excludePatterns.some((re) => re.test(normalizedPath));
  }

  // PERF-08: removeFile cancels any pending debounce timer before delegating to index
  removeFile(uri: string): void {
    const timer = this.debounceMap.get(uri);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.debounceMap.delete(uri);
    }
    this.index.removeFile(uri);
  }

  async scanWorkspaceFolders(
    workspaceFolders: string[],
    addons: AddonInfo[] = [],
    extraFiles: string[] = [],
  ): Promise<void> {
    const startTime = Date.now();
    this.notify(OwlNotifications.ScanStarted, {});

    const allFiles: string[] = [];
    const seenFiles = new Set<string>();
    // PERF-06: Use pre-compiled excludePatterns instead of re-compiling per call
    const excludePatterns = this.excludePatterns;

    // Add extra files (e.g. owl.js, owl_module.js) that bypass exclude patterns
    for (const extraFile of extraFiles) {
      const resolved = path.resolve(extraFile);
      if (!seenFiles.has(resolved) && fs.existsSync(resolved)) {
        seenFiles.add(resolved);
        allFiles.push(extraFile);
      }
    }

    if (addons.length > 0) {
      // Addon mode: scan each addon's static/src directory
      for (const addon of addons) {
        if (!addon.staticSrcPath) {
          continue;
        } // OWL-lib-only addon (no static/src to scan)
        try {
          this.collectFiles(
            addon.staticSrcPath,
            allFiles,
            excludePatterns,
            seenFiles,
          );
        } catch (err) {
          process.stderr.write(
            `[owl-scanner] Error collecting files from addon ${addon.name} (${addon.staticSrcPath}): ${err}\n`,
          );
        }
      }
    }

    // Also scan workspace folders, but only their static/src subdirectories
    // to avoid scanning non-OWL files outside addon structure
    for (const folder of workspaceFolders) {
      // If this folder is already covered by an addon scan, skip it
      const alreadyCovered = addons.some(
        (a) => folder.startsWith(a.root) || a.root.startsWith(folder),
      );
      if (alreadyCovered && addons.length > 0) {
        continue;
      }
      try {
        // Prefer scanning only static/src if it exists
        const staticSrc = path.join(folder, "static", "src");
        const scanRoot = fs.existsSync(staticSrc) ? staticSrc : folder;
        this.collectFiles(scanRoot, allFiles, excludePatterns, seenFiles);
      } catch (err) {
        process.stderr.write(
          `[owl-scanner] Error collecting files from ${folder}: ${err}\n`,
        );
      }
    }

    // PERF-05: Process in chunks of CHUNK_SIZE with async reads, yielding between chunks
    const totalFiles = allFiles.length;
    for (let i = 0; i < allFiles.length; i += CHUNK_SIZE) {
      const chunk = allFiles.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map((filePath) => this.indexFile(filePath)));

      // Send progress notification after each chunk
      const scannedFiles = Math.min(i + CHUNK_SIZE, totalFiles);
      this.notify(OwlNotifications.ScanProgress, {
        scannedFiles,
        totalFiles,
        componentCount: this.countComponents(),
        serviceCount: this.countServices(),
        functionCount: this.countFunctions(),
      } satisfies OwlNotifications.ScanProgressParams);

      // Yield to event loop between chunks
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const componentCount = this.countComponents();
    const serviceCount = this.countServices();
    const functionCount = this.countFunctions();
    const fileCount = allFiles.length;
    const durationMs = Date.now() - startTime;

    const params: OwlNotifications.ScanCompleteParams = {
      componentCount,
      serviceCount,
      functionCount,
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

  // Count helpers — use Array.from on iterators returned by getAllX (PERF-07 compat)
  private countComponents(): number {
    return Array.from(this.index.getAllComponents()).length;
  }

  private countServices(): number {
    return Array.from(this.index.getAllServices()).length;
  }

  private countFunctions(): number {
    return Array.from(this.index.getAllFunctions()).length;
  }

  // PERF-05: Async file indexing — non-blocking read via fs.promises.readFile
  private async indexFile(filePath: string): Promise<void> {
    let content: string;
    try {
      content = await fs.promises.readFile(filePath, "utf-8");
    } catch {
      return;
    }

    const uri = "file://" + filePath.replace(/\\/g, "/");
    try {
      const result = parseFile(content, uri);
      this.index.upsertFileSymbols(uri, result);
      const diags = validateDocument(uri, content, this.index);
      this.publishDiagnostics(uri, diags);
    } catch (err) {
      process.stderr.write(
        `[owl-scanner] Error indexing ${filePath}: ${err}\n`,
      );
    }
  }

  private collectFiles(
    dir: string,
    result: string[],
    excludePatterns: RegExp[],
    seen: Set<string> = new Set(),
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const normalizedPath = fullPath.replace(/\\/g, "/");

      // Check exclusion
      const excluded = excludePatterns.some((re) => re.test(normalizedPath));
      if (excluded) {
        continue;
      }

      if (entry.isDirectory()) {
        // Skip lib directories (third-party libraries inside static/src/lib)
        if (entry.name === "lib" || entry.name === "libs") {
          continue;
        }
        this.collectFiles(fullPath, result, excludePatterns, seen);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if ((ext === ".ts" || ext === ".js") && !entry.name.endsWith(".d.ts")) {
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
