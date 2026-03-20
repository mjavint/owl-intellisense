import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import {
  buildAddImportEdits,
  buildAddImportEditsFromAst,
  isSpecifierImported,
  isSpecifierImportedFromAst,
  parseDocumentAst,
  resolveImportSource,
} from "../../utils/importUtils";
import { buildComponentDocs } from "./docs";
import {
  CompletionItemData,
  IComponentReader,
  IFunctionReader,
  IServiceReader,
  IRegistryReader,
  IImportReader,
  ISetupPropReader,
} from "../../../shared/types";

type FullIndex = IComponentReader & IFunctionReader & IServiceReader & IRegistryReader & IImportReader & ISetupPropReader;

export function provideStaticComponentCompletions(
  params: TextDocumentPositionParams,
  index: FullIndex,
  docText: string,
  aliasMap: Map<string, string> | undefined,
  supportsResolve: boolean,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const eagerAst = supportsResolve ? null : parseDocumentAst(docText);

  function getImportEdits(specifierName: string, modulePath: string) {
    if (supportsResolve) {
      return [];
    }
    if (!eagerAst) {
      return buildAddImportEdits(docText, specifierName, modulePath);
    }
    return buildAddImportEditsFromAst(eagerAst, specifierName, modulePath);
  }

  function isImported(specifierName: string): boolean {
    if (!eagerAst) {
      return isSpecifierImported(docText, specifierName);
    }
    return isSpecifierImportedFromAst(eagerAst, specifierName);
  }

  function makeItemData(specifierName: string, modulePath: string): CompletionItemData {
    return {
      specifierName,
      documentUri: params.textDocument.uri,
      position: params.position,
      modulePath,
    };
  }

  for (const comp of index.getAllComponents()) {
    const source = resolveImportSource(
      comp.filePath,
      params.textDocument.uri,
      aliasMap,
    );
    const imported = isImported(comp.name);
    const compImportEdits = imported ? [] : getImportEdits(comp.name, source);
    const item: CompletionItem = {
      label: comp.name,
      kind: CompletionItemKind.Class,
      detail: `OWL Component — ${comp.filePath}`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: buildComponentDocs(comp.name, comp.props),
      },
      insertText: `${comp.name},`,
      insertTextFormat: InsertTextFormat.PlainText,
      additionalTextEdits: compImportEdits,
    };
    if (supportsResolve && !imported) {
      item.data = makeItemData(comp.name, source);
    }
    items.push(item);
  }
  return items;
}
