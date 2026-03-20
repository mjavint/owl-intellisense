import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { Range } from "vscode-languageserver-types";
import { ImportRecord } from "../../shared/types";

/**
 * Converts a TSESTree SourceLocation (1-based lines) to an LSP Range (0-based lines).
 */
export function toRange(loc: TSESTree.SourceLocation): Range {
  return {
    start: {
      line: loc.start.line - 1,
      character: loc.start.column,
    },
    end: {
      line: loc.end.line - 1,
      character: loc.end.column,
    },
  };
}

/**
 * Extract all import declarations from an AST.
 */
export function extractImports(
  ast: TSESTree.Program,
  uri: string,
): ImportRecord[] {
  const records: ImportRecord[] = [];
  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") {
      continue;
    }
    const source = node.source.value as string;
    for (const spec of node.specifiers) {
      if (spec.type === "ImportSpecifier") {
        const importedName =
          spec.imported.type === "Identifier"
            ? spec.imported.name
            : (spec.imported as { value: string }).value;
        records.push({
          specifier: importedName,
          source,
          localName: spec.local.name,
          uri,
          range: toRange(spec.loc!),
        });
      } else if (spec.type === "ImportDefaultSpecifier") {
        records.push({
          specifier: "default",
          source,
          localName: spec.local.name,
          uri,
          range: toRange(spec.loc!),
        });
      }
    }
  }
  return records;
}
