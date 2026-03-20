import { MarkupContent, MarkupKind } from "vscode-languageserver/node";

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

/**
 * Build a markdown documentation string for a component with its props table.
 */
export function buildComponentDocs(
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
