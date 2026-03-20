import {
  DocumentSymbolParams,
  SymbolInformation,
  SymbolKind,
  WorkspaceSymbolParams,
} from 'vscode-languageserver/node';
import {
  IComponentReader,
  IFunctionReader,
  IServiceReader,
  IRegistryReader,
} from '../../shared/types';
import { type RequestContext } from '../shared';

// ─── Document Symbols ─────────────────────────────────────────────────────────

export function onDocumentSymbol(
  params: DocumentSymbolParams,
  ctx: RequestContext,
): SymbolInformation[] {
  const uri = params.textDocument.uri;
  const index = ctx.index;
  const results: SymbolInformation[] = [];

  // OWL Components (SymbolKind.Class)
  for (const comp of index.getComponentsInFile(uri)) {
    results.push({
      name: comp.name,
      kind: SymbolKind.Class,
      location: { uri: comp.uri, range: comp.range },
      containerName: comp.templateRef,
    });
  }

  // Exported functions (SymbolKind.Function)
  // PERF-07: getAllFunctions returns an iterator — we filter by URI
  for (const fn of index.getAllFunctions()) {
    if (fn.uri !== uri) { continue; }
    results.push({
      name: fn.name,
      kind: fn.isCallable === false ? SymbolKind.Constant : SymbolKind.Function,
      location: { uri: fn.uri, range: fn.range },
    });
  }

  // Odoo services (SymbolKind.Module)
  for (const svc of index.getAllServices()) {
    if (svc.uri !== uri) { continue; }
    results.push({
      name: svc.name,
      kind: SymbolKind.Module,
      location: { uri: svc.uri, range: svc.range },
      containerName: 'service',
    });
  }

  // Registry entries (SymbolKind.EnumMember)
  for (const category of index.getAllRegistryCategories()) {
    for (const reg of index.getRegistriesByCategory(category)) {
      if (reg.uri !== uri) { continue; }
      results.push({
        name: `${category}/${reg.key}`,
        kind: SymbolKind.EnumMember,
        location: { uri: reg.uri, range: reg.range },
        containerName: category,
      });
    }
  }

  return results;
}

// ─── Workspace Symbols ────────────────────────────────────────────────────────

export function onWorkspaceSymbol(
  params: WorkspaceSymbolParams,
  ctx: RequestContext,
): SymbolInformation[] {
  const query = params.query.toLowerCase();
  const index = ctx.index;
  const results: SymbolInformation[] = [];

  function matchesQuery(name: string): boolean {
    if (!query) { return true; }
    return name.toLowerCase().includes(query);
  }

  // OWL Components
  // PERF-07: Array.from to materialise the iterator when array methods are needed
  for (const comp of index.getAllComponents()) {
    if (matchesQuery(comp.name)) {
      results.push({
        name: comp.name,
        kind: SymbolKind.Class,
        location: { uri: comp.uri, range: comp.range },
        containerName: comp.filePath,
      });
    }
  }

  // Exported functions
  for (const fn of index.getAllFunctions()) {
    if (matchesQuery(fn.name)) {
      results.push({
        name: fn.name,
        kind: fn.isCallable === false ? SymbolKind.Constant : SymbolKind.Function,
        location: { uri: fn.uri, range: fn.range },
        containerName: fn.filePath,
      });
    }
  }

  // Odoo services
  for (const svc of index.getAllServices()) {
    if (matchesQuery(svc.name)) {
      results.push({
        name: svc.name,
        kind: SymbolKind.Module,
        location: { uri: svc.uri, range: svc.range },
        containerName: svc.filePath,
      });
    }
  }

  // Registry entries
  for (const category of index.getAllRegistryCategories()) {
    for (const reg of index.getRegistriesByCategory(category)) {
      const fullName = `${category}/${reg.key}`;
      if (matchesQuery(reg.key) || matchesQuery(fullName)) {
        results.push({
          name: fullName,
          kind: SymbolKind.EnumMember,
          location: { uri: reg.uri, range: reg.range },
          containerName: reg.filePath,
        });
      }
    }
  }

  return results;
}
