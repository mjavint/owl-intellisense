// Main completion handler — src/server/features/completion/index.ts
// This file contains the primary onCompletion logic.
// Extracted modules: data.ts (static items), docs.ts (documentation),
// contexts/ (context detection utilities).

import {
  CompletionItem,
  CompletionItemKind,
  MarkupKind,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { OWL_HOOKS } from "../../owl/catalog";
import { parseDocumentAst } from "../../utils/importUtils";
import {
  IComponentReader,
  IFunctionReader,
  IServiceReader,
  IRegistryReader,
  IImportReader,
  ISetupPropReader,
} from "../../../shared/types";
import { type RequestContext } from "../../shared";
import { provideSetupCompletions } from "./setupCompletions";
import { provideJsxPropCompletions } from "./jsxPropCompletions";
import { provideThisPropertyCompletions } from "./thisPropertyCompletions";
import { provideStaticComponentCompletions } from "./staticComponentCompletions";

// Re-export extracted data
export { OWL_PROP_TYPE_ITEMS, STATIC_MEMBER_SNIPPETS } from "./data";
export { buildComponentDocs, parseJsDoc, jsDocToMarkdown, renderDocumentation } from "./docs";

// Also import for local use
import { OWL_PROP_TYPE_ITEMS, STATIC_MEMBER_SNIPPETS } from "./data";

// Re-export context detection utilities
export {
  detectContext,
  isInsideSetupMethod,
  isInsideStaticComponents,
  isInsideStaticProps,
  isAtClassBodyLevel,
  getJsxTagComponentName,
  getEnclosingClassName,
} from "./contexts";

// Also import locally for use in this module
import {
  detectContext,
  isInsideSetupMethod,
  isInsideStaticComponents,
  isInsideStaticProps,
  isAtClassBodyLevel,
} from "./contexts";

type FullIndex = IComponentReader & IFunctionReader & IServiceReader & IRegistryReader & IImportReader & ISetupPropReader;

// Re-export getSortPrefix for external use
export { getSortPrefix } from "./sortPrefix";

import { provideGeneralCompletions } from "./generalCompletions";

// ─── Sort prefix helper ────────────────────────────────────────────────────────

// ─── Main completion handler ────────────────────────────────────────────────────

export function onCompletion(
  params: TextDocumentPositionParams,
  ctx: RequestContext,
): CompletionItem[] {
  const doc = ctx.doc;
  if (!doc) { return []; }
  const index = ctx.index as FullIndex;
  const aliasMap = ctx.aliasMap;
  const supportsResolve = ctx.supportsResolve ?? false;

  const items: CompletionItem[] = [];
  const docText = doc.getText();
  const offset = doc.offsetAt(params.position);
  const eagerAst = supportsResolve ? null : parseDocumentAst(docText);

  // PERF-01: Single-pass context detection
  const completionCtx = detectContext(docText, offset);

  // useService string arg — only service names, no general completions
  if (completionCtx.kind === "useService") {
    return provideSetupCompletions(params, ctx, docText, supportsResolve, eagerAst, aliasMap);
  }

  if (
    completionCtx.kind === "setup" ||
    (completionCtx.kind === "unknown" && isInsideSetupMethod(doc, params))
  ) {
    const setupItems = provideSetupCompletions(params, ctx, docText, supportsResolve, eagerAst, aliasMap);
    const generalItems = provideGeneralCompletions(params, ctx, docText);
    return [...setupItems, ...generalItems];
  }

  // G1: this.xxx property completions
  if (completionCtx.kind === "thisProperty") {
    return provideThisPropertyCompletions(doc, params, index, completionCtx);
  }

  // G3: registry key completions
  if (completionCtx.kind === "registryKey") {
    const entries = index.getRegistriesByCategory(completionCtx.category);
    for (const entry of entries) {
      items.push({
        label: entry.key,
        kind: CompletionItemKind.Value,
        detail: `registry.category('${completionCtx.category}')`,
        sortText: "a" + entry.key,
      });
    }
    return items;
  }

  // SC-04b: JSX prop completions
  const jsxItems = provideJsxPropCompletions(doc, index);
  if (jsxItems.length > 0) {
    return jsxItems;
  }

  // static components context
  if (
    completionCtx.kind === "staticComponents" ||
    isInsideStaticComponents(doc, params)
  ) {
    return provideStaticComponentCompletions(params, index, docText, aliasMap, supportsResolve);
  }

  // REQ-02: static props = { ... }
  if (isInsideStaticProps(doc, params)) {
    return OWL_PROP_TYPE_ITEMS;
  }

  // REQ-06: class-body level (depth === 1)
  if (isAtClassBodyLevel(doc, params)) {
    return STATIC_MEMBER_SNIPPETS;
  }

  // Unknown/general context — delegate to specialized module
  return provideGeneralCompletions(params, ctx, docText);
}

export function onCompletionResolve(item: CompletionItem): CompletionItem {
  // Custom hook — documentation already set at completion time
  if (item.data && (item.data as { type?: string }).type === "custom-hook") {
    return item;
  }

  // Enrich with full documentation if not already present
  if (!item.documentation) {
    const hook = OWL_HOOKS.find((h) => h.name === item.label);
    if (hook) {
      item.documentation = {
        kind: MarkupKind.Markdown,
        value: [
          `### ${hook.name}`,
          "",
          `\`\`\`typescript`,
          hook.signature,
          `\`\`\``,
          "",
          hook.description,
          hook.returns ? `\n**Returns:** \`${hook.returns}\`` : "",
        ]
          .filter((l) => l !== undefined)
          .join("\n"),
      };
    }
  }
  return item;
}
