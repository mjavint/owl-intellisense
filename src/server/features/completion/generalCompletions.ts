// General context completions — src/server/features/completion/generalCompletions.ts
// Provides completions for OWL hooks, classes, components, and functions in general context.

import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { OWL_HOOKS, HOOK_NAMES, OWL_CLASSES } from "../../owl/catalog";
import {
  buildAddImportEdits,
  buildAddImportEditsFromAst,
  isSpecifierImported,
  isSpecifierImportedFromAst,
  parseDocumentAst,
  resolveImportSource,
} from "../../utils/importUtils";
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
import { type RequestContext } from "../../shared";
import { renderDocumentation } from "./docs";
import { getSortPrefix } from "./sortPrefix";

/**
 * Provide completions for general/unknown context (outside OWL-specific contexts).
 * Includes: OWL hooks, OWL classes, workspace components, workspace functions.
 */
export function provideGeneralCompletions(
  params: TextDocumentPositionParams,
  ctx: RequestContext,
  docText: string,
): CompletionItem[] {
  const doc = ctx.doc;
  if (!doc) { return []; }
  const index = ctx.index as FullIndex;
  const aliasMap = ctx.aliasMap;
  const supportsResolve = ctx.supportsResolve ?? false;
  const currentUri = params.textDocument.uri;

  // PERF-02: Parse AST once for eager-fallback
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

  const items: CompletionItem[] = [];

  // ── OWL hooks ───────────────────────────────────────────────────────────────
  for (const hook of OWL_HOOKS) {
    const sortPrefix = getSortPrefix(hook.name, docText, true);
    const imported = isImported(hook.name);
    const importEdits = imported ? [] : getImportEdits(hook.name, hook.importSource ?? "@odoo/owl");
    const item: CompletionItem = {
      label: hook.name,
      kind: CompletionItemKind.Function,
      detail: hook.signature,
      insertText: hook.completionSnippet ?? hook.name,
      insertTextFormat: hook.completionSnippet
        ? InsertTextFormat.Snippet
        : InsertTextFormat.PlainText,
      sortText: sortPrefix + hook.name,
      additionalTextEdits: importEdits,
    };
    if (supportsResolve && !imported) {
      item.data = makeItemData(hook.name, hook.importSource ?? "@odoo/owl");
    }
    items.push(item);
  }

  // ── OWL classes ────────────────────────────────────────────────────────────
  for (const owlClass of OWL_CLASSES) {
    const sortPrefix = getSortPrefix(owlClass.name, docText, true);
    const imported = isImported(owlClass.name);
    const importEdits = imported ? [] : getImportEdits(owlClass.name, "@odoo/owl");
    const item: CompletionItem = {
      label: owlClass.name,
      kind: CompletionItemKind.Class,
      detail: owlClass.signature,
      documentation: { kind: MarkupKind.Markdown, value: owlClass.description },
      insertText: owlClass.name,
      insertTextFormat: InsertTextFormat.PlainText,
      sortText: sortPrefix + owlClass.name,
      additionalTextEdits: importEdits,
    };
    if (supportsResolve && !imported) {
      item.data = makeItemData(owlClass.name, "@odoo/owl");
    }
    items.push(item);
  }

  // ── Workspace components ───────────────────────────────────────────────────
  for (const comp of index.getAllComponents()) {
    const source = resolveImportSource(comp.filePath, currentUri, aliasMap);
    const imported = isImported(comp.name);
    const compImportEdits = imported ? [] : getImportEdits(comp.name, source);
    const sortPrefix = getSortPrefix(comp.name, docText, false);
    const item: CompletionItem = {
      label: comp.name,
      kind: CompletionItemKind.Class,
      detail: `OWL Component — ${comp.filePath}`,
      insertText: comp.name,
      sortText: sortPrefix + comp.name,
      additionalTextEdits: compImportEdits,
    };
    if (supportsResolve && !imported) {
      item.data = makeItemData(comp.name, source);
    }
    items.push(item);
  }

  // ── Workspace functions ────────────────────────────────────────────────────
  for (const fn of index.getAllFunctions()) {
    const source = resolveImportSource(fn.filePath, currentUri, aliasMap);
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
      documentation: docContent,
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
