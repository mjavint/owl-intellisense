import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from "vscode-languageserver/node";

// ─── REQ-02: OWL prop type completion items ───────────────────────────────────

/**
 * REQ-02: OWL prop type completion items.
 * Offered when cursor is inside a `static props = { ... }` block.
 */
export const OWL_PROP_TYPE_ITEMS: CompletionItem[] = [
  {
    label: "String",
    kind: CompletionItemKind.Keyword,
    detail: "OWL prop type",
    sortText: "a_String",
  },
  {
    label: "Number",
    kind: CompletionItemKind.Keyword,
    detail: "OWL prop type",
    sortText: "a_Number",
  },
  {
    label: "Boolean",
    kind: CompletionItemKind.Keyword,
    detail: "OWL prop type",
    sortText: "a_Boolean",
  },
  {
    label: "Object",
    kind: CompletionItemKind.Keyword,
    detail: "OWL prop type",
    sortText: "a_Object",
  },
  {
    label: "Array",
    kind: CompletionItemKind.Keyword,
    detail: "OWL prop type",
    sortText: "a_Array",
  },
  {
    label: "Function",
    kind: CompletionItemKind.Keyword,
    detail: "OWL prop type",
    sortText: "a_Function",
  },
  {
    label: "true",
    kind: CompletionItemKind.Keyword,
    detail: "OWL prop type",
    sortText: "a_true",
  },
  {
    label: "false",
    kind: CompletionItemKind.Keyword,
    detail: "OWL prop type",
    sortText: "a_false",
  },
  {
    label: "{ type, optional }",
    kind: CompletionItemKind.Snippet,
    detail: "OWL prop schema object",
    insertText: "{ type: $1, optional: $2 }",
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: "b_schema",
  },
];

// ─── REQ-06: Static member snippets ───────────────────────────────────────────

/**
 * REQ-06: Static member snippet completion items.
 * Offered when cursor is at class-body level (depth === 1).
 */
export const STATIC_MEMBER_SNIPPETS: CompletionItem[] = [
  {
    label: "static template",
    kind: CompletionItemKind.Snippet,
    detail: "OWL component template reference",
    documentation: {
      kind: MarkupKind.Markdown,
      value:
        "Define the XML template name or inline template for this component.",
    },
    insertText: "static template = `$0`;",
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: "a_static_template",
  },
  {
    label: "static props",
    kind: CompletionItemKind.Snippet,
    detail: "OWL component props schema",
    documentation: {
      kind: MarkupKind.Markdown,
      value:
        "Define the props schema for this component. Each key maps to a TypeDescription.",
    },
    insertText: "static props = {\n\t$0\n};",
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: "a_static_props",
  },
  {
    label: "static components",
    kind: CompletionItemKind.Snippet,
    detail: "OWL sub-component registry",
    documentation: {
      kind: MarkupKind.Markdown,
      value:
        "Register child components used in the template of this component.",
    },
    insertText: "static components = {\n\t$0\n};",
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: "a_static_components",
  },
  {
    label: "static defaultProps",
    kind: CompletionItemKind.Snippet,
    detail: "OWL component default prop values",
    documentation: {
      kind: MarkupKind.Markdown,
      value: "Define default values for optional props.",
    },
    insertText: "static defaultProps = {\n\t$0\n};",
    insertTextFormat: InsertTextFormat.Snippet,
    sortText: "a_static_defaultProps",
  },
];
