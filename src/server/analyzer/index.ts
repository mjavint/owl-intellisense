import {
  OwlComponent,
  SymbolIndexInterface,
  OdooService,
  OdooRegistry,
  ExportedFunction,
  ImportRecord,
  ParseResult,
} from '../../shared/types';

export class SymbolIndex implements SymbolIndexInterface {
  private componentsByName: Map<string, OwlComponent> = new Map();
  private componentsByUri: Map<string, OwlComponent[]> = new Map();
  private servicesByName: Map<string, OdooService> = new Map();
  private servicesByUri: Map<string, OdooService[]> = new Map();
  private registriesByCategory: Map<string, Map<string, OdooRegistry>> = new Map();
  private registriesByUri: Map<string, OdooRegistry[]> = new Map();
  private functionsByName: Map<string, ExportedFunction> = new Map();
  private functionsByUri: Map<string, ExportedFunction[]> = new Map();
  private importsByUri: Map<string, ImportRecord[]> = new Map();
  private importsBySpecifier: Map<string, ImportRecord[]> = new Map();

  // ─── Component methods ────────────────────────────────────────────────

  getComponent(name: string): OwlComponent | undefined {
    return this.componentsByName.get(name);
  }

  getAllComponents(): OwlComponent[] {
    return Array.from(this.componentsByName.values());
  }

  getComponentsInFile(uri: string): OwlComponent[] {
    return this.componentsByUri.get(uri) ?? [];
  }

  upsertComponent(comp: OwlComponent): void {
    this.componentsByName.set(comp.name, comp);
    const existing = this.componentsByUri.get(comp.uri) ?? [];
    const withoutDuplicate = existing.filter((c) => c.name !== comp.name);
    withoutDuplicate.push(comp);
    this.componentsByUri.set(comp.uri, withoutDuplicate);
  }

  // ─── Service methods ──────────────────────────────────────────────────

  getService(name: string): OdooService | undefined {
    return this.servicesByName.get(name);
  }

  getAllServices(): OdooService[] {
    return Array.from(this.servicesByName.values());
  }

  private upsertService(svc: OdooService): void {
    this.servicesByName.set(svc.name, svc);
    const existing = this.servicesByUri.get(svc.uri) ?? [];
    const withoutDuplicate = existing.filter((s) => s.name !== svc.name);
    withoutDuplicate.push(svc);
    this.servicesByUri.set(svc.uri, withoutDuplicate);
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

    const existing = this.registriesByUri.get(reg.uri) ?? [];
    const withoutDuplicate = existing.filter((r) => !(r.category === reg.category && r.key === reg.key));
    withoutDuplicate.push(reg);
    this.registriesByUri.set(reg.uri, withoutDuplicate);
  }

  // ─── Function methods ─────────────────────────────────────────────────

  getFunction(name: string): ExportedFunction | undefined {
    return this.functionsByName.get(name);
  }

  getAllFunctions(): ExportedFunction[] {
    return Array.from(this.functionsByName.values());
  }

  private upsertFunction(fn: ExportedFunction): void {
    this.functionsByName.set(fn.name, fn);
    const existing = this.functionsByUri.get(fn.uri) ?? [];
    const withoutDuplicate = existing.filter((f) => f.name !== fn.name);
    withoutDuplicate.push(fn);
    this.functionsByUri.set(fn.uri, withoutDuplicate);
  }

  // ─── Import methods ───────────────────────────────────────────────────

  getImportsInFile(uri: string): ImportRecord[] {
    return this.importsByUri.get(uri) ?? [];
  }

  getImportsForSpecifier(specifier: string): ImportRecord[] {
    return this.importsBySpecifier.get(specifier) ?? [];
  }

  private upsertImports(uri: string, imports: ImportRecord[]): void {
    // Remove old specifier entries for this URI
    for (const [spec, records] of this.importsBySpecifier) {
      const filtered = records.filter((r) => r.uri !== uri);
      if (filtered.length === 0) {
        this.importsBySpecifier.delete(spec);
      } else {
        this.importsBySpecifier.set(spec, filtered);
      }
    }

    this.importsByUri.set(uri, imports);

    for (const imp of imports) {
      const existing = this.importsBySpecifier.get(imp.specifier) ?? [];
      existing.push(imp);
      this.importsBySpecifier.set(imp.specifier, existing);
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

    // Remove imports
    const imports = this.importsByUri.get(uri);
    if (imports) {
      for (const imp of imports) {
        const records = this.importsBySpecifier.get(imp.specifier);
        if (records) {
          const filtered = records.filter((r) => r.uri !== uri);
          if (filtered.length === 0) {
            this.importsBySpecifier.delete(imp.specifier);
          } else {
            this.importsBySpecifier.set(imp.specifier, filtered);
          }
        }
      }
    }
    this.importsByUri.delete(uri);
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
  }
}
