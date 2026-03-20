import {
  OwlComponent,
  SymbolIndexInterface,
  OdooService,
  OdooRegistry,
  ExportedFunction,
  ImportRecord,
  ParseResult,
  SetupPropertyAssignment,
} from '../../shared/types';

// ─── PERF-09: Composite key helper ───────────────────────────────────────────

function setupPropsKey(name: string, uri: string): string {
  return `${name}@${uri}`;
}

export class SymbolIndex implements SymbolIndexInterface {
  private componentsByName: Map<string, OwlComponent> = new Map();
  private componentsByUri: Map<string, OwlComponent[]> = new Map();
  private servicesByName: Map<string, OdooService> = new Map();
  private servicesByUri: Map<string, OdooService[]> = new Map();
  readonly registriesByCategory: Map<string, Map<string, OdooRegistry>> = new Map();
  private registriesByUri: Map<string, OdooRegistry[]> = new Map();
  private functionsByName: Map<string, ExportedFunction> = new Map();
  private functionsByUri: Map<string, ExportedFunction[]> = new Map();
  private importsByUri: Map<string, ImportRecord[]> = new Map();
  private importsBySpecifier: Map<string, ImportRecord[]> = new Map();
  // PERF-04: Reverse map for O(1) specifier cleanup on file removal
  private importSpecifiersByUri: Map<string, Set<string>> = new Map();
  // PERF-09: Setup props indexed by composite key "${name}@${uri}"
  private setupPropsByComponent: Map<string, SetupPropertyAssignment[]> = new Map();
  private setupPropsByUri: Map<string, string[]> = new Map(); // uri → list of composite keys
  // Source alias map: virtual source (e.g. '@odoo/owl') → set of file URIs
  // Used to look up symbols from OWL library files by their import source
  private sourceAliasToUris: Map<string, Set<string>> = new Map();

  // ─── Component methods ────────────────────────────────────────────────

  getComponent(name: string): OwlComponent | undefined {
    return this.componentsByName.get(name);
  }

  // PERF-07: Return iterator directly — no intermediate array allocation
  getAllComponents(): IterableIterator<OwlComponent> {
    return this.componentsByName.values();
  }

  getComponentsInFile(uri: string): OwlComponent[] {
    return this.componentsByUri.get(uri) ?? [];
  }

  upsertComponent(comp: OwlComponent): void {
    this.componentsByName.set(comp.name, comp);
    // PERF-03: Incremental update instead of filter+push
    const existing = this.componentsByUri.get(comp.uri) ?? [];
    const idx = existing.findIndex((c) => c.name === comp.name);
    if (idx >= 0) {
      existing[idx] = comp;
    } else {
      existing.push(comp);
    }
    this.componentsByUri.set(comp.uri, existing);
  }

  // ─── Service methods ──────────────────────────────────────────────────

  getService(name: string): OdooService | undefined {
    return this.servicesByName.get(name);
  }

  // PERF-07: Return iterator directly — no intermediate array allocation
  getAllServices(): IterableIterator<OdooService> {
    return this.servicesByName.values();
  }

  private upsertService(svc: OdooService): void {
    this.servicesByName.set(svc.name, svc);
    // PERF-04: Incremental update instead of filter+push
    const existing = this.servicesByUri.get(svc.uri) ?? [];
    const idx = existing.findIndex((s) => s.name === svc.name);
    if (idx >= 0) {
      existing[idx] = svc;
    } else {
      existing.push(svc);
    }
    this.servicesByUri.set(svc.uri, existing);
  }

  // ─── Registry methods ─────────────────────────────────────────────────

  getRegistry(category: string, key: string): OdooRegistry | undefined {
    return this.registriesByCategory.get(category)?.get(key);
  }

  getRegistriesByCategory(category: string): OdooRegistry[] {
    const catMap = this.registriesByCategory.get(category);
    if (!catMap) {return [];}
    return Array.from(catMap.values());
  }

  private upsertRegistry(reg: OdooRegistry): void {
    if (!this.registriesByCategory.has(reg.category)) {
      this.registriesByCategory.set(reg.category, new Map());
    }
    this.registriesByCategory.get(reg.category)!.set(reg.key, reg);

    // PERF-05: Incremental update instead of filter+push
    const existing = this.registriesByUri.get(reg.uri) ?? [];
    const idx = existing.findIndex((r) => r.category === reg.category && r.key === reg.key);
    if (idx >= 0) {
      existing[idx] = reg;
    } else {
      existing.push(reg);
    }
    this.registriesByUri.set(reg.uri, existing);
  }

  // ─── Function methods ─────────────────────────────────────────────────

  getFunction(name: string): ExportedFunction | undefined {
    return this.functionsByName.get(name);
  }

  // PERF-07: Return iterator directly — no intermediate array allocation
  getAllFunctions(): IterableIterator<ExportedFunction> {
    return this.functionsByName.values();
  }

  private upsertFunction(fn: ExportedFunction): void {
    this.functionsByName.set(fn.name, fn);
    // PERF-06: Incremental update instead of filter+push
    const existing = this.functionsByUri.get(fn.uri) ?? [];
    const idx = existing.findIndex((f) => f.name === fn.name);
    if (idx >= 0) {
      existing[idx] = fn;
    } else {
      existing.push(fn);
    }
    this.functionsByUri.set(fn.uri, existing);
  }

  // ─── Source alias methods ─────────────────────────────────────────────

  /**
   * Register a file URI as belonging to a virtual source alias (e.g. '@odoo/owl').
   * This allows resolveSpecifierDefinition to find symbols from OWL lib files
   * even though they live in static/lib (excluded from normal scanning).
   */
  registerSourceAlias(source: string, fileUri: string): void {
    const uris = this.sourceAliasToUris.get(source) ?? new Set<string>();
    uris.add(fileUri);
    this.sourceAliasToUris.set(source, uris);
  }

  /**
   * Get the file URIs registered for a source alias (e.g. '@odoo/owl').
   * Returns an empty array if the source alias is not registered.
   */
  getSourceAliasUris(source: string): string[] {
    const uris = this.sourceAliasToUris.get(source);
    return uris ? Array.from(uris) : [];
  }

  /**
   * Get all functions exported from files registered under a source alias.
   * Prioritizes the first URI registered (owl_module.js should be registered first).
   */
  getFunctionBySource(source: string, name: string): ExportedFunction | undefined {
    const uris = this.sourceAliasToUris.get(source);
    if (!uris) {return undefined;}
    for (const uri of uris) {
      const fns = this.functionsByUri.get(uri) ?? [];
      const fn = fns.find(f => f.name === name);
      if (fn) {return fn;}
      const comps = this.componentsByUri.get(uri) ?? [];
      // components are not functions but check for class-like symbols
      const comp = comps.find(c => c.name === name);
      if (comp) {return { name: comp.name, filePath: comp.filePath, uri: comp.uri, range: comp.range, isDefault: false };}
    }
    return undefined;
  }

  // ─── Import methods ───────────────────────────────────────────────────

  getImportsInFile(uri: string): ImportRecord[] {
    return this.importsByUri.get(uri) ?? [];
  }

  getImportsForSpecifier(specifier: string): ImportRecord[] {
    return this.importsBySpecifier.get(specifier) ?? [];
  }

  private upsertImports(uri: string, imports: ImportRecord[]): void {
    // PERF-04: Use importSpecifiersByUri for O(|old|+|new|) cleanup instead of full scan
    const newSpecifiers = new Set(imports.map((imp) => imp.specifier));
    const oldSpecifiers = this.importSpecifiersByUri.get(uri) ?? new Set<string>();

    // Remove stale specifier entries for this URI
    for (const spec of oldSpecifiers) {
      if (!newSpecifiers.has(spec)) {
        const records = this.importsBySpecifier.get(spec);
        if (records) {
          const filtered = records.filter((r) => r.uri !== uri);
          if (filtered.length === 0) {
            this.importsBySpecifier.delete(spec);
          } else {
            this.importsBySpecifier.set(spec, filtered);
          }
        }
      }
    }

    this.importsByUri.set(uri, imports);
    this.importSpecifiersByUri.set(uri, newSpecifiers);

    for (const imp of imports) {
      if (!oldSpecifiers.has(imp.specifier)) {
        // Only add if it wasn't already present (avoids duplicates for unchanged specifiers)
        const existing = this.importsBySpecifier.get(imp.specifier) ?? [];
        existing.push(imp);
        this.importsBySpecifier.set(imp.specifier, existing);
      } else {
        // Update the existing record (content may have changed)
        const existing = this.importsBySpecifier.get(imp.specifier) ?? [];
        const idx = existing.findIndex((r) => r.uri === uri);
        if (idx >= 0) {
          existing[idx] = imp;
        } else {
          existing.push(imp);
        }
        this.importsBySpecifier.set(imp.specifier, existing);
      }
    }
  }

  // ─── Batch upsert ────────────────────────────────────────────────────

  upsertFileSymbols(uri: string, result: ParseResult): void {
    this.removeFile(uri);

    for (const comp of result.components) {
      this.upsertComponent(comp);
    }
    for (const svc of result.services) {
      this.upsertService(svc);
    }
    for (const reg of result.registries) {
      this.upsertRegistry(reg);
    }
    for (const fn of result.functions) {
      this.upsertFunction(fn);
    }
    this.upsertImports(uri, result.imports);
  }

  // ─── Removal ─────────────────────────────────────────────────────────

  removeFile(uri: string): void {
    // Remove components
    const components = this.componentsByUri.get(uri);
    if (components) {
      for (const comp of components) {
        const indexed = this.componentsByName.get(comp.name);
        if (indexed && indexed.uri === uri) {
          this.componentsByName.delete(comp.name);
        }
      }
    }
    this.componentsByUri.delete(uri);

    // Remove services
    const services = this.servicesByUri.get(uri);
    if (services) {
      for (const svc of services) {
        const indexed = this.servicesByName.get(svc.name);
        if (indexed && indexed.uri === uri) {
          this.servicesByName.delete(svc.name);
        }
      }
    }
    this.servicesByUri.delete(uri);

    // Remove registries
    const registries = this.registriesByUri.get(uri);
    if (registries) {
      for (const reg of registries) {
        const catMap = this.registriesByCategory.get(reg.category);
        if (catMap) {
          const indexed = catMap.get(reg.key);
          if (indexed && indexed.uri === uri) {
            catMap.delete(reg.key);
          }
          if (catMap.size === 0) {
            this.registriesByCategory.delete(reg.category);
          }
        }
      }
    }
    this.registriesByUri.delete(uri);

    // Remove functions
    const fns = this.functionsByUri.get(uri);
    if (fns) {
      for (const fn of fns) {
        const indexed = this.functionsByName.get(fn.name);
        if (indexed && indexed.uri === uri) {
          this.functionsByName.delete(fn.name);
        }
      }
    }
    this.functionsByUri.delete(uri);

    // PERF-04: Remove imports using importSpecifiersByUri for O(|specifiers|) cleanup
    const specifiers = this.importSpecifiersByUri.get(uri);
    if (specifiers) {
      for (const spec of specifiers) {
        const records = this.importsBySpecifier.get(spec);
        if (records) {
          const filtered = records.filter((r) => r.uri !== uri);
          if (filtered.length === 0) {
            this.importsBySpecifier.delete(spec);
          } else {
            this.importsBySpecifier.set(spec, filtered);
          }
        }
      }
      this.importSpecifiersByUri.delete(uri);
    }
    this.importsByUri.delete(uri);

    // PERF-09: Remove setupProps using composite key — only removes this URI's entries
    const setupKeys = this.setupPropsByUri.get(uri);
    if (setupKeys) {
      for (const key of setupKeys) {
        this.setupPropsByComponent.delete(key);
      }
      this.setupPropsByUri.delete(uri);
    }
  }

  // ─── Setup Props methods (PERF-09) ───────────────────────────────────

  upsertSetupProps(componentName: string, uri: string, props: SetupPropertyAssignment[]): void {
    const key = setupPropsKey(componentName, uri);
    this.setupPropsByComponent.set(key, props);
    // PERF-02: Use Set for O(1) membership check instead of Array.includes
    const existingSet = new Set(this.setupPropsByUri.get(uri) ?? []);
    if (!existingSet.has(key)) {
      existingSet.add(key);
      this.setupPropsByUri.set(uri, [...existingSet]);
    }
  }

  getSetupProps(componentName: string, uri: string): SetupPropertyAssignment[] | undefined {
    return this.setupPropsByComponent.get(setupPropsKey(componentName, uri));
  }

  clear(): void {
    this.componentsByName.clear();
    this.componentsByUri.clear();
    this.servicesByName.clear();
    this.servicesByUri.clear();
    this.registriesByCategory.clear();
    this.registriesByUri.clear();
    this.functionsByName.clear();
    this.functionsByUri.clear();
    this.importsByUri.clear();
    this.importsBySpecifier.clear();
    this.importSpecifiersByUri.clear();
    this.setupPropsByComponent.clear();
    this.setupPropsByUri.clear();
    this.sourceAliasToUris.clear();
  }
}
