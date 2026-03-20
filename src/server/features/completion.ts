import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupContent,
  MarkupKind,
  Position,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { OWL_HOOKS, HOOK_NAMES } from "../owl/catalog";
import {
  RE_USE_SERVICE_OPEN,
  RE_REGISTRY_CATEGORY_OPEN,
  RE_STATIC_PROPS_BLOCK,
} from "../owl/patterns";
import { SERVICE_METHODS } from "../owl/servicesCatalog";
import {
  buildAddImportEdits,
  buildAddImportEditsFromAst,
  isSpecifierImported,
  isSpecifierImportedFromAst,
  parseDocumentAst,
  resolveImportSource,
} from "../utils/importUtils";
import {
  CompletionContext,
  CompletionItemData,
  IComponentReader,
  IFunctionReader,
  IServiceReader,
  IRegistryReader,
  IImportReader,
  ISetupPropReader,
} from "../../shared/types";

// ─── PERF-03: Module-level regex cache ───────────────────────────────────────

const reCache = new Map<string, RegExp>();

/**
 * Returns a cached RegExp for the given pattern+flags, compiling once per unique key.
 */
function getCachedRegex(pattern: string, flags = ""): RegExp {
  const key = `${flags}:${pattern}`;
  let re = reCache.get(key);
  if (!re) {
    re = new RegExp(pattern, flags);
    reCache.set(key, re);
  }
  return re;
}

// ─── PERF-01: Single-pass context detection ───────────────────────────────────

/**
 * Detects the completion context at `offset` in `text` using a single O(n) scan.
 * Replaces the four independent detector functions called sequentially before.
 */
export function detectContext(text: string, offset: number): CompletionContext {
  const before = text.substring(0, offset);

  // Track brace depth and current class/method context
  let braceDepth = 0;
  let classDepth = -1; // brace depth at which the class opened (-1 = no class)
  let className = "";
  let methodName = "";
  let methodDepth = -1; // brace depth at which the current method opened

  // Pre-compiled patterns via cache (PERF-03)
  const reClass = getCachedRegex("\\bclass\\s+([A-Za-z_$][A-Za-z0-9_$]*)");
  // setup() method: requires parens; static components = { }: uses assignment syntax
  const reSetup = getCachedRegex("\\bsetup\\s*\\(");
  const reStaticComponents = getCachedRegex("\\bstatic\\s+components\\s*[=(]");

  // Simple line-by-line scan to detect class and method context
  const lines = before.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();

    // Detect class declaration
    const classMatch = reClass.exec(trimmed);
    if (classMatch && trimmed.includes("{")) {
      className = classMatch[1];
      classDepth = braceDepth;
    }

    // Detect method/block declarations
    const isSetup = reSetup.test(trimmed) && trimmed.includes("{");
    const isStaticComps =
      reStaticComponents.test(trimmed) && trimmed.includes("{");
    if (isSetup) {
      methodName = "setup";
      methodDepth = braceDepth;
    } else if (isStaticComps) {
      methodName = "static components";
      methodDepth = braceDepth;
    }

    // Count braces
    for (const ch of line) {
      if (ch === "{") {
        braceDepth++;
      } else if (ch === "}") {
        braceDepth--;
        if (methodDepth >= 0 && braceDepth <= methodDepth) {
          methodName = "";
          methodDepth = -1;
        }
        if (classDepth >= 0 && braceDepth <= classDepth) {
          className = "";
          classDepth = -1;
        }
      }
    }
  }

  // Determine context based on innermost scope
  if (methodName === "setup" && className) {
    // Check for useService( call near cursor
    if (RE_USE_SERVICE_OPEN.test(before)) {
      return { kind: "useService", serviceClass: null };
    }
    // Check for registry key access: registry.category('X').get(' or .add('
    const registryKeyMatchSetup =
      /registry\.category\(['"]([^'"]+)['"]\)\.(?:get|add)\(['"]([^'"]*)\s*$/.exec(
        before,
      );
    if (registryKeyMatchSetup) {
      return {
        kind: "registryKey",
        category: registryKeyMatchSetup[1],
        partial: registryKeyMatchSetup[2],
      };
    }
    // Check for this.X access near cursor — must run before returning 'setup'
    const thisPropMatchInSetup =
      /\bthis\.([A-Za-z_$][A-Za-z0-9_$.]*)\s*$/.exec(before);
    if (thisPropMatchInSetup) {
      return {
        kind: "thisProperty",
        propertyChain: thisPropMatchInSetup[1].split("."),
      };
    }
    return { kind: "setup", componentName: className };
  }

  if (methodName === "static components") {
    return { kind: "staticComponents" };
  }

  // Check for registry key access outside setup context
  const registryKeyMatch =
    /registry\.category\(['"]([^'"]+)['"]\)\.(?:get|add)\(['"]([^'"]*)\s*$/.exec(
      before,
    );
  if (registryKeyMatch) {
    return {
      kind: "registryKey",
      category: registryKeyMatch[1],
      partial: registryKeyMatch[2],
    };
  }

  // Check for this.X access near cursor (scan backward from offset on the current token)
  const thisMatch = /\bthis\.([A-Za-z_$][A-Za-z0-9_$.]*)\s*$/.exec(before);
  if (thisMatch) {
    return { kind: "thisProperty", propertyChain: thisMatch[1].split(".") };
  }

  return { kind: "unknown" };
}

// ─── ParsedJSDoc type and utilities ──────────────────────────────────────────

/** Structured representation of a JSDoc comment. */
export interface ParsedJSDoc {
  description?: string;
  params?: Array<{ name: string; description: string }>;
  returns?: string;
  deprecated?: string;
}

/**
 * Parse a raw JSDoc string into a structured ParsedJSDoc object.
 */
export function parseJsDoc(raw: string | undefined): ParsedJSDoc | undefined {
  if (!raw) {
    return undefined;
  }
  const result: ParsedJSDoc = {};
  const lines = raw.split("\n");
  const descLines: string[] = [];
  const params: Array<{ name: string; description: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const paramMatch = /^@param\s+\{?[^}]*\}?\s*(\w+)\s*[-–]?\s*(.*)/.exec(
      trimmed,
    );
    if (paramMatch) {
      params.push({ name: paramMatch[1], description: paramMatch[2].trim() });
      continue;
    }
    const returnsMatch = /^@returns?\s+(.+)/.exec(trimmed);
    if (returnsMatch) {
      result.returns = returnsMatch[1].trim();
      continue;
    }
    const deprecatedMatch = /^@deprecated\s*(.*)/.exec(trimmed);
    if (deprecatedMatch) {
      result.deprecated =
        deprecatedMatch[1].trim() || "This item is deprecated.";
      continue;
    }
    if (!trimmed.startsWith("@")) {
      descLines.push(line);
    }
  }

  const desc = descLines.join("\n").trim();
  if (desc) {
    result.description = desc;
  }
  if (params.length > 0) {
    result.params = params;
  }

  return result;
}

/**
 * Render a ParsedJSDoc (and optional signature) to a Markdown string.
 */
export function jsDocToMarkdown(
  parsed: ParsedJSDoc | undefined,
  signature?: string,
): string {
  if (!parsed) {
    return signature ?? "";
  }
  const parts: string[] = [];
  if (signature) {
    parts.push(`\`\`\`typescript\n${signature}\n\`\`\``);
  }
  if (parsed.deprecated) {
    parts.push(`**Deprecated:** ${parsed.deprecated}`);
  }
  if (parsed.description) {
    parts.push(parsed.description);
  }
  if (parsed.params && parsed.params.length > 0) {
    parts.push("**Parameters:**");
    for (const p of parsed.params) {
      parts.push(`- \`${p.name}\` — ${p.description}`);
    }
  }
  if (parsed.returns) {
    parts.push(`**Returns:** ${parsed.returns}`);
  }
  return parts.join("\n\n");
}

/**
 * Render documentation for a completion item. Returns undefined when neither
 * parsedDoc nor jsDoc is present (satisfies SC-03.4).
 */
export function renderDocumentation(item: {
  jsDoc?: string;
  parsedDoc?: ParsedJSDoc;
  signature?: string;
}): MarkupContent | undefined {
  if (!item.parsedDoc && !item.jsDoc) {
    return undefined;
  }
  let value: string;
  if (item.parsedDoc) {
    value = jsDocToMarkdown(item.parsedDoc, item.signature);
  } else {
    // Raw jsDoc string: parse then render
    value = jsDocToMarkdown(parseJsDoc(item.jsDoc), item.signature);
  }
  return { kind: MarkupKind.Markdown, value };
}

// ─── Sort prefix helper ───────────────────────────────────────────────────────

/**
 * Returns a sort prefix for a completion item:
 * - 'a' if the name is already imported in docText
 * - 'c' if it is an OWL built-in hook
 * - 'b' if it is a workspace symbol (not imported, not OWL builtin)
 * - 'z' for everything else
 */
export function getSortPrefix(
  name: string,
  docText: string,
  isOwlBuiltin: boolean,
): "a" | "b" | "c" | "z" {
  if (isSpecifierImported(docText, name)) {
    return "a";
  }
  if (isOwlBuiltin) {
    return "c";
  }
  // Workspace symbol (will get additionalTextEdits for import)
  if (name.length > 0) {
    return "b";
  }
  return "z";
}

// ─── Context detectors ────────────────────────────────────────────────────────

/**
 * Heuristic: checks if the cursor appears to be inside a setup() method body.
 * We look backwards through the document text for a `setup()` opening and
 * confirm we're inside its braces.
 */
function isInsideSetupMethod(
  doc: TextDocument,
  params: TextDocumentPositionParams,
): boolean {
  const offset = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  // Find the last occurrence of setup() { before cursor
  const setupMatch = before.lastIndexOf("setup()");
  if (setupMatch === -1) {
    return false;
  }

  // Count braces after setup() to see if we're still inside
  const afterSetup = before.substring(setupMatch);
  let depth = 0;
  let foundOpen = false;
  for (const ch of afterSetup) {
    if (ch === "{") {
      depth++;
      foundOpen = true;
    } else if (ch === "}") {
      depth--;
    }
  }
  return foundOpen && depth > 0;
}

/**
 * SC-04b: Detect if cursor is inside a JSX opening tag for a known component.
 * Returns the component name if the cursor is inside `<ComponentName ...attrs... >` or `<ComponentName |>`.
 * Returns null if not in JSX tag context.
 *
 * Heuristic: scan backwards from cursor for `<Identifier` pattern, then verify we are
 * still within the opening tag (no closing `>` after the tag open).
 */
function getJsxTagComponentName(
  doc: TextDocument,
  params: TextDocumentPositionParams,
): string | null {
  const offset = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  // Find the last `<` before cursor
  const lastAngle = before.lastIndexOf("<");
  if (lastAngle === -1) {
    return null;
  }

  // Text after the `<`
  const tagStart = before.substring(lastAngle + 1);

  // Tag must start with an uppercase letter (OWL components are PascalCase)
  const tagMatch = /^([A-Z][A-Za-z0-9_]*)/.exec(tagStart);
  if (!tagMatch) {
    return null;
  }

  const compName = tagMatch[1];

  // Make sure we haven't passed a closing `>` after the `<`
  // (i.e., we are still within the opening tag)
  if (tagStart.includes(">")) {
    return null;
  }

  return compName;
}

/**
 * Heuristic: checks if cursor is inside `static components = { ... }`.
 */
function isInsideStaticComponents(
  doc: TextDocument,
  params: TextDocumentPositionParams,
): boolean {
  const offset = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  const staticMatch = before.lastIndexOf("static components");
  if (staticMatch === -1) {
    return false;
  }

  const afterStatic = before.substring(staticMatch);
  let depth = 0;
  let foundOpen = false;
  for (const ch of afterStatic) {
    if (ch === "{") {
      depth++;
      foundOpen = true;
    } else if (ch === "}") {
      depth--;
    }
  }
  return foundOpen && depth > 0;
}

/**
 * REQ-02: Detect if cursor is inside a `static props = { ... }` block.
 * Uses RE_STATIC_PROPS_BLOCK and brace-counting from the `=` sign.
 * Covers SC-02.1 (direct value) and SC-02.2 (nested type key).
 */
export function isInsideStaticProps(
  doc: TextDocument,
  params: TextDocumentPositionParams,
): boolean {
  const offset = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  // Find last `static props =` before cursor
  const match = RE_STATIC_PROPS_BLOCK.exec(before);
  if (!match) {
    return false;
  }

  // Find the position after `=`
  const staticPropsPos = before.lastIndexOf(match[0]);
  if (staticPropsPos === -1) {
    return false;
  }
  const afterEq = before.substring(staticPropsPos + match[0].length);

  let depth = 0;
  let foundOpen = false;
  for (const ch of afterEq) {
    if (ch === "{") {
      depth++;
      foundOpen = true;
    } else if (ch === "}") {
      depth--;
    }
  }
  return foundOpen && depth > 0;
}

/**
 * REQ-06: Detect if cursor is at class-body level (depth === 1 from class open brace).
 * Scans back for `class ` token, then counts braces to cursor.
 * Returns true only when depth === 1 (we are in the class body but not inside a nested block).
 * Covers SC-06.1 (class body), SC-06.2 (inside method — depth > 1), SC-06.3 (no class).
 */
export function isAtClassBodyLevel(
  doc: TextDocument,
  params: TextDocumentPositionParams,
): boolean {
  const offset = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  // Find last `class ` before cursor
  const classMatch = before.lastIndexOf("class ");
  if (classMatch === -1) {
    return false;
  }

  const afterClass = before.substring(classMatch);
  let depth = 0;
  let foundOpen = false;
  for (const ch of afterClass) {
    if (ch === "{") {
      depth++;
      foundOpen = true;
    } else if (ch === "}") {
      depth--;
    }
  }
  // depth === 1 means we are inside the class body but not inside any nested block
  return foundOpen && depth === 1;
}

/**
 * G1: Finds the name of the class enclosing the given position by scanning
 * forward through the text before the cursor and tracking brace depth.
 * Returns undefined if the cursor is not inside a class body.
 */
function getEnclosingClassName(
  doc: TextDocument,
  position: Position,
): string | undefined {
  const offset = doc.offsetAt(position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  let braceDepth = 0;
  let classDepth = -1;
  let className = "";

  const lines = before.split("\n");
  const reClass = getCachedRegex("\\bclass\\s+([A-Za-z_$][A-Za-z0-9_$]*)");

  for (const line of lines) {
    const trimmed = line.trim();
    const classMatch = reClass.exec(trimmed);
    if (classMatch && trimmed.includes("{")) {
      className = classMatch[1];
      classDepth = braceDepth;
    }

    for (const ch of line) {
      if (ch === "{") {
        braceDepth++;
      } else if (ch === "}") {
        braceDepth--;
        if (classDepth >= 0 && braceDepth <= classDepth) {
          className = "";
          classDepth = -1;
        }
      }
    }
  }

  return className || undefined;
}

// ─── Static completion data ───────────────────────────────────────────────────

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

// ─── Main completion handler ──────────────────────────────────────────────────

export function onCompletion(
  params: TextDocumentPositionParams,
  doc: TextDocument,
  index: IComponentReader &
    IFunctionReader &
    IServiceReader &
    IRegistryReader &
    IImportReader &
    ISetupPropReader,
  aliasMap?: Map<string, string>,
  supportsResolve = false,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const docText = doc.getText();
  const offset = doc.offsetAt(params.position);

  // PERF-02: Parse AST once for eager-fallback (only when client doesn't support resolve)
  const eagerAst = supportsResolve ? null : parseDocumentAst(docText);

  /**
   * Helper: build import edits for a specifier.
   * - supportsResolve=true  → returns [] (deferred to onCompletionResolve via item.data)
   * - supportsResolve=false → uses pre-parsed AST (parsed once above)
   */
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

  /**
   * Build the CompletionItemData for deferred resolve (PERF-02).
   */
  function makeItemData(
    specifierName: string,
    modulePath: string,
  ): CompletionItemData {
    return {
      specifierName,
      documentUri: params.textDocument.uri,
      position: params.position,
      modulePath,
    };
  }

  // PERF-01: Single-pass context detection replacing four sequential scanners
  const ctx = detectContext(docText, offset);
  const before = docText.substring(0, offset);

  if (
    ctx.kind === "setup" ||
    ctx.kind === "useService" ||
    (ctx.kind === "unknown" && isInsideSetupMethod(doc, params))
  ) {
    // REQ-01: Service name completion — when cursor is inside useService('...')
    if (RE_USE_SERVICE_OPEN.test(before)) {
      // PERF-07: for...of on iterator — no intermediate array
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

    // REQ-01: Registry category completion — when cursor is inside registry.category('...')
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

    // Return OWL built-in hooks as completion items
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

    // All exported symbols from workspace/addons — PERF-07: for...of on iterator
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
      // PERF-02: store data for deferred resolve; use 'fn-import' type to distinguish
      item.data =
        supportsResolve && !imported
          ? makeItemData(fn.name, source)
          : { type: "custom-hook", name: fn.name, uri: fn.uri };
      items.push(item);
    }

    return items;
  }

  // G1: this.xxx property completions from setup()
  if (ctx.kind === "thisProperty") {
    const chain = ctx.propertyChain;
    const componentName = getEnclosingClassName(doc, params.position);
    if (!componentName) {
      return items;
    }

    const setupProps = index.getSetupProps(componentName, doc.uri);
    if (!setupProps) {
      return items;
    }

    if (chain.length <= 1) {
      for (const prop of setupProps) {
        items.push({
          label: prop.name,
          kind: CompletionItemKind.Property,
          detail: prop.hookReturns
            ? `(${prop.hookName}) → ${prop.hookReturns}`
            : (prop.hookName ?? "property"),
          documentation: {
            kind: "markdown",
            value: `Defined via \`${prop.hookName ?? "assignment"}\``,
          },
          sortText: "a" + prop.name,
        });
      }
    } else {
      const rootPropName = chain[0];
      const rootProp = setupProps.find((p) => p.name === rootPropName);
      if (rootProp?.stateShape) {
        for (const [key, type] of Object.entries(rootProp.stateShape)) {
          items.push({
            label: key,
            kind: CompletionItemKind.Field,
            detail: type,
            sortText: "a" + key,
          });
        }
      }
      // useService → service method completions from static catalog
      if (rootProp?.hookName === "useService" && rootProp.serviceArg) {
        const methods = SERVICE_METHODS[rootProp.serviceArg];
        if (methods) {
          for (const method of methods) {
            items.push({
              label: method.name,
              kind: CompletionItemKind.Method,
              detail: method.signature,
              documentation: { kind: "markdown", value: method.doc },
              sortText: "a" + method.name,
              insertText: method.snippet ?? method.name,
              insertTextFormat: method.snippet
                ? InsertTextFormat.Snippet
                : InsertTextFormat.PlainText,
            });
          }
          return items;
        }
      }
    }
    return items;
  }

  // G3: registry key completions — registry.category('X').get(' or .add('
  if (ctx.kind === "registryKey") {
    const entries = index.getRegistriesByCategory(ctx.category);
    for (const entry of entries) {
      items.push({
        label: entry.key,
        kind: CompletionItemKind.Value,
        detail: `registry.category('${ctx.category}')`,
        sortText: "a" + entry.key,
      });
    }
    return items;
  }

  // SC-04b: Prop name completions — cursor is inside a JSX opening tag for a known component
  const jsxCompName = getJsxTagComponentName(doc, params);
  if (jsxCompName) {
    const comp = index.getComponent(jsxCompName);
    if (comp && Object.keys(comp.props).length > 0) {
      for (const [propName, propDef] of Object.entries(comp.props)) {
        const requiredLabel = propDef.optional
          ? "_(optional)_"
          : "**required**";
        const item: CompletionItem = {
          label: propName,
          kind: CompletionItemKind.Property,
          detail: `${propName}: ${propDef.type}${propDef.optional ? "?" : ""}`,
          documentation: {
            kind: MarkupKind.Markdown,
            value: [
              `**${propName}** — prop of \`${jsxCompName}\``,
              "",
              `**Type:** \`${propDef.type}\``,
              `**Required:** ${requiredLabel}`,
              propDef.validate ? "**Has validation function**" : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
          insertText: `${propName}=`,
          insertTextFormat: InsertTextFormat.PlainText,
          sortText: (propDef.optional ? "b" : "a") + propName,
        };
        items.push(item);
      }
      return items;
    }
  }

  // PERF-01: ctx.kind === 'staticComponents' or fallback detector
  if (
    ctx.kind === "staticComponents" ||
    isInsideStaticComponents(doc, params)
  ) {
    // Return workspace components — PERF-07: for...of on iterator
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

  // REQ-02: Prop-value completions — cursor inside `static props = { ... }`
  if (isInsideStaticProps(doc, params)) {
    return OWL_PROP_TYPE_ITEMS;
  }

  // REQ-06: Static member snippets — cursor at class-body level (depth === 1)
  if (isAtClassBodyLevel(doc, params)) {
    return STATIC_MEMBER_SNIPPETS;
  }

  // General context: offer components and hooks with lower priority
  // PERF-07: for...of on iterators — no intermediate arrays
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

  for (const comp of index.getAllComponents()) {
    const source = resolveImportSource(
      comp.filePath,
      params.textDocument.uri,
      aliasMap,
    );
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

  for (const fn of index.getAllFunctions()) {
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

function buildComponentDocs(
  name: string,
  props: Record<string, { type: string; optional: boolean; validate: boolean }>,
): string {
  const lines = [`**${name}** — OWL Component`, ""];
  const propEntries = Object.entries(props);
  if (propEntries.length === 0) {
    lines.push("_No props defined_");
  } else {
    lines.push("**Props:**", "");
    lines.push("| Name | Type | Optional |");
    lines.push("|------|------|----------|");
    for (const [propName, def] of propEntries) {
      lines.push(
        `| \`${propName}\` | \`${def.type}\` | ${def.optional ? "yes" : "no"} |`,
      );
    }
  }
  return lines.join("\n");
}
