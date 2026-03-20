// Service/useService context completions

import { CompletionItem, CompletionItemKind } from "vscode-languageserver/node";
import { RE_USE_SERVICE_OPEN } from "../../../shared";
import {
  IComponentReader,
  IServiceReader,
  IRegistryReader,
} from "../../../../shared/types";

/**
 * REQ-01: Service name completion — when cursor is inside useService('...')
 */
export function provideServiceCompletions(
  index: IComponentReader & IServiceReader & IRegistryReader,
  docText: string,
  before: string,
  getSortPrefix: (name: string, docText: string, isOwlBuiltin: boolean) => "a" | "b" | "c" | "z",
): CompletionItem[] {
  if (!RE_USE_SERVICE_OPEN.test(before)) {
    return [];
  }

  const items: CompletionItem[] = [];
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
