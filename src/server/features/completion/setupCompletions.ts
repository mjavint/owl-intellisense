import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import {
  RE_USE_SERVICE_OPEN,
  RE_REGISTRY_CATEGORY_OPEN,
} from "../../shared";
import { OWL_HOOKS, HOOK_NAMES } from "../../owl/catalog";
import {
  buildAddImportEdits,
  buildAddImportEditsFromAst,
  isSpecifierImported,
  isSpecifierImportedFromAst,
  parseDocumentAst,
  resolveImportSource,
} from "../../utils/importUtils";
import { SERVICE_METHODS } from "../../owl/servicesCatalog";
import {
  CompletionItemData,
  IComponentReader,
  IFunctionReader,
  IServiceReader,
  IRegistryReader,
  IImportReader,
  ISetupPropReader,
} from "../../../shared/types";
import { type RequestContext } from "../../shared";
import { getSortPrefix } from "./sortPrefix";
import { renderDocumentation } from "./docs";

type FullIndex = IComponentReader & IFunctionReader & IServiceReader & IRegistryReader & IImportReader & ISetupPropReader;

export function provideSetupCompletions(
  params: TextDocumentPositionParams,
  ctx: RequestContext,
  docText: string,
  supportsResolve: boolean,
  eagerAst: ReturnType<typeof parseDocumentAst>,
  aliasMap: Map<string, string> | undefined,
): CompletionItem[] {
  const index = ctx.index as FullIndex;
  const items: CompletionItem[] = [];
  const before = docText.substring(0, ctx.doc!.offsetAt(params.position));

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

  // REQ-01: Service name completion
  if (RE_USE_SERVICE_OPEN.test(before)) {
    for (const svc of index.getAllServices()) {
      const sortPrefix = getSortPrefix(svc.name, docText, false);
      items.push({
        label: svc.name,
        kind: CompletionItemKind.Value,
        detail: svc.filePath,
        sortText: sortPrefix + svc.name,
      });
    }
    return items;
  }

  // REQ-01: Registry category completion
  if (RE_REGISTRY_CATEGORY_OPEN.test(before)) {
    const allCategoryItems: CompletionItem[] = [];
    for (const category of index.getAllRegistryCategories()) {
      const sortPrefix = getSortPrefix(category, docText, false);
      allCategoryItems.push({
        label: category,
        kind: CompletionItemKind.Value,
        detail: `Registry category`,
        sortText: sortPrefix + category,
      });
    }
    return allCategoryItems;
  }

  // OWL built-in hooks
  for (const hook of OWL_HOOKS) {
    const sortPrefix = getSortPrefix(hook.name, docText, true);
    const importEdits = isImported(hook.name)
      ? []
      : getImportEdits(hook.name, hook.importSource ?? "@odoo/owl");
    const item: CompletionItem = {
      label: hook.name,
      kind: CompletionItemKind.Function,
      detail: hook.signature,
      documentation: {
        kind: MarkupKind.Markdown,
        value: [
          `**${hook.name}**`,
          "",
          hook.description,
          hook.returns ? `\n**Returns:** ${hook.returns}` : "",
        ]
          .filter((l) => l !== undefined)
          .join("\n"),
      },
      insertText: hook.completionSnippet ?? hook.name,
      insertTextFormat: hook.completionSnippet
        ? InsertTextFormat.Snippet
        : InsertTextFormat.PlainText,
      sortText: sortPrefix + hook.name,
      additionalTextEdits: importEdits,
    };
    if (supportsResolve && !isImported(hook.name)) {
      item.data = makeItemData(hook.name, hook.importSource ?? "@odoo/owl");
    }
    items.push(item);
  }

  // Workspace functions
  for (const fn of index.getAllFunctions()) {
    if (fn.isCallable === false) {
      continue;
    }
    const source = resolveImportSource(
      fn.filePath,
      params.textDocument.uri,
      aliasMap,
    );
    const imported = isImported(fn.name);
    const hookImportEdits = imported ? [] : getImportEdits(fn.name, source);
    const isBuiltin = HOOK_NAMES.has(fn.name);
    const sortPrefix = getSortPrefix(fn.name, docText, isBuiltin);
    const docContent = renderDocumentation({
      jsDoc: fn.jsDoc,
      signature: fn.signature,
    });
    const item: CompletionItem = {
      label: fn.name,
      kind: CompletionItemKind.Function,
      detail: fn.signature ?? fn.name,
      documentation: docContent ?? {
        kind: "markdown" as const,
        value: `**From:** \`${source}\``,
      },
      insertText: fn.name,
      insertTextFormat: InsertTextFormat.PlainText,
      sortText: sortPrefix + fn.name,
      additionalTextEdits: hookImportEdits,
    };
    item.data =
      supportsResolve && !imported
        ? makeItemData(fn.name, source)
        : { type: "custom-hook", name: fn.name, uri: fn.uri };
    items.push(item);
  }

  return items;
}
