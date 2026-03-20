import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { Range } from "vscode-languageserver-types";
import { OdooService } from "../../shared/types";

/**
 * Walk all AST nodes recursively, calling visitor for each.
 */
export function walkAst(
  node: unknown,
  visitor: (n: Record<string, unknown>) => void,
): void {
  if (!node || typeof node !== "object") {
    return;
  }
  const n = node as Record<string, unknown>;
  if (n["type"]) {
    visitor(n);
  }
  for (const key of Object.keys(n)) {
    if (key === "parent") {
      continue;
    }
    const child = n[key];
    if (Array.isArray(child)) {
      child.forEach((c) => walkAst(c, visitor));
    } else if (
      child &&
      typeof child === "object" &&
      (child as Record<string, unknown>)["type"]
    ) {
      walkAst(child, visitor);
    }
  }
}

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
 * Extract Odoo service definitions.
 * Detects: registry.category('services').add('name', serviceObj)
 */
export function extractServices(
  ast: TSESTree.Program,
  uri: string,
  filePath: string,
): OdooService[] {
  const services: OdooService[] = [];

  walkAst(ast, (node) => {
    // Pattern: registry.category('services').add('name', value)
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
        if (catArg?.["type"] === "Literal" && catArg["value"] === "services") {
          const nodeArgs = node["arguments"] as Record<string, unknown>[];
          const nameArg = nodeArgs?.[0];
          const name =
            nameArg?.["type"] === "Literal" &&
            typeof nameArg["value"] === "string"
              ? nameArg["value"]
              : null;
          const valArg = nodeArgs?.[1];
          const localName =
            valArg?.["type"] === "Identifier"
              ? (valArg["name"] as string)
              : (name ?? "unknown");
          if (name) {
            const loc = node["loc"] as TSESTree.SourceLocation;
            services.push({
              name,
              localName,
              filePath,
              uri,
              range: toRange(loc),
            });
          }
        }
      }
    }
  });

  return services;
}

/**
 * Parse an AST from source content.
 */
export function parseAst(content: string): TSESTree.Program {
  return parse(content, {
    jsx: true,
    tolerant: true,
    loc: true,
  }) as TSESTree.Program;
}
