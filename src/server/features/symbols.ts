import {
  DocumentSymbolParams,
  SymbolInformation,
  SymbolKind,
  WorkspaceSymbolParams,
} from 'vscode-languageserver/node';
import { IComponentReader } from '../../shared/types';

export function onDocumentSymbol(
  params: DocumentSymbolParams,
  index: IComponentReader
): SymbolInformation[] {
  const uri = params.textDocument.uri;
  const components = index.getComponentsInFile(uri);

  return components.map((comp) => ({
    name: comp.name,
    kind: SymbolKind.Class,
    location: {
      uri: comp.uri,
      range: comp.range,
    },
    containerName: comp.templateRef,
  }));
}

export function onWorkspaceSymbol(
  params: WorkspaceSymbolParams,
  index: IComponentReader
): SymbolInformation[] {
  const query = params.query.toLowerCase();
  // PERF-07: Array.from to materialise the iterator when array methods are needed
  const allComponents = Array.from(index.getAllComponents());

  const filtered = query
    ? allComponents.filter((comp) =>
        comp.name.toLowerCase().includes(query)
      )
    : allComponents;

  return filtered.map((comp) => ({
    name: comp.name,
    kind: SymbolKind.Class,
    location: {
      uri: comp.uri,
      range: comp.range,
    },
    containerName: comp.filePath,
  }));
}
