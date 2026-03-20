import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { Range } from "vscode-languageserver-types";
import { OdooRegistry } from "../../shared/types";
import { walkAst } from "./serviceExtractor";

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
 * Extract registry.category(X).add(key, value) calls for all categories.
 */
export function extractRegistries(
  ast: TSESTree.Program,
  uri: string,
  filePath: string,
): OdooRegistry[] {
  const registries: OdooRegistry[] = [];

  walkAst(ast, (node) => {
    if (
      node["type"] === "CallExpression" &&
      (node["callee"] as Record<string, unknown>)?.["type"] ===
        "MemberExpression" &&
      (
        (node["callee"] as Record<string, unknown>)?.["property"] as Record<
          string,
          unknown
        >
      )?.["type"] === "Identifier" &&
      (
        (node["callee"] as Record<string, unknown>)?.["property"] as Record<
          string,
          unknown
        >
      )?.["name"] === "add"
    ) {
      const callee = node["callee"] as Record<string, unknown>;
      const categoryCall = callee["object"] as Record<string, unknown>;
      if (
        categoryCall?.["type"] === "CallExpression" &&
        (categoryCall["callee"] as Record<string, unknown>)?.["type"] ===
          "MemberExpression" &&
        (
          (categoryCall["callee"] as Record<string, unknown>)?.[
            "property"
          ] as Record<string, unknown>
        )?.["type"] === "Identifier" &&
        (
          (categoryCall["callee"] as Record<string, unknown>)?.[
            "property"
          ] as Record<string, unknown>
        )?.["name"] === "category"
      ) {
        const catArgs = categoryCall["arguments"] as Record<string, unknown>[];
        const catArg = catArgs?.[0];
        const category =
          catArg?.["type"] === "Literal" && typeof catArg["value"] === "string"
            ? catArg["value"]
            : null;
        const nodeArgs = node["arguments"] as Record<string, unknown>[];
        const keyArg = nodeArgs?.[0];
        const key =
          keyArg?.["type"] === "Literal" && typeof keyArg["value"] === "string"
            ? keyArg["value"]
            : null;
        const valArg = nodeArgs?.[1];
        const localName =
          valArg?.["type"] === "Identifier"
            ? (valArg["name"] as string)
            : (key ?? "unknown");
        if (category && key) {
          const loc = node["loc"] as TSESTree.SourceLocation;
          registries.push({
            category,
            key,
            localName,
            filePath,
            uri,
            range: toRange(loc),
          });
        }
      }
    }
  });

  return registries;
}
