// Registry context completions

import { CompletionItem, CompletionItemKind } from "vscode-languageserver/node";
import { RE_REGISTRY_CATEGORY_OPEN } from "../../../shared";
import {
  IComponentReader,
  IRegistryReader,
} from "../../../../shared/types";

/**
 * Registry category completions when cursor is inside registry.category('...')
 */
export function provideRegistryCategoryCompletions(
  index: IComponentReader & IRegistryReader,
  docText: string,
  before: string,
  getSortPrefix: (name: string, docText: string, isOwlBuiltin: boolean) => "a" | "b" | "c" | "z",
): CompletionItem[] {
  if (!RE_REGISTRY_CATEGORY_OPEN.test(before)) {
    return [];
  }

  const items: CompletionItem[] = [];
  for (const category of index.getAllRegistryCategories()) {
    const sortPrefix = getSortPrefix(category, docText, false);
    items.push({
      label: category,
      kind: CompletionItemKind.Value,
      detail: `Registry category`,
      sortText: sortPrefix + category,
    });
  }
  return items;
}

/**
 * G3: registry key completions — registry.category('X').get(' or .add('
 */
export function provideRegistryKeyCompletions(
  index: IComponentReader & IRegistryReader,
  category: string,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const entries = index.getRegistriesByCategory(category);
  for (const entry of entries) {
    items.push({
      label: entry.key,
      kind: CompletionItemKind.Value,
      detail: `registry.category('${category}')`,
      sortText: "a" + entry.key,
    });
  }
  return items;
}
