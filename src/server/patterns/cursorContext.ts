import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { Range } from "vscode-languageserver-types";
import { toRange } from "./serviceExtractor";

export interface CursorContext {
  type: "import-specifier" | "import-path" | "identifier" | "unknown";
  name?: string;
  source?: string;
  range?: Range;
}

export function getCursorContext(
  ast: TSESTree.Program,
  line: number,
  character: number,
): CursorContext {
  const astLine = line + 1;

  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") {
      continue;
    }
    const loc = node.loc!;
    if (astLine < loc.start.line || astLine > loc.end.line) {
      continue;
    }

    const srcLoc = node.source.loc!;
    if (
      astLine === srcLoc.start.line &&
      character >= srcLoc.start.column &&
      character <= srcLoc.end.column
    ) {
      return {
        type: "import-path",
        source: node.source.value as string,
        range: toRange(srcLoc),
      };
    }

    for (const spec of node.specifiers) {
      const sLoc = spec.loc!;
      if (
        astLine >= sLoc.start.line &&
        astLine <= sLoc.end.line &&
        character >= sLoc.start.column &&
        character <= sLoc.end.column
      ) {
        const importedName =
          spec.type === "ImportSpecifier"
            ? spec.imported.type === "Identifier"
              ? spec.imported.name
              : (spec.imported as { value: string }).value
            : spec.local.name;
        return {
          type: "import-specifier",
          name: importedName,
          source: node.source.value as string,
          range: toRange(sLoc),
        };
      }
    }
  }

  return { type: "unknown" };
}