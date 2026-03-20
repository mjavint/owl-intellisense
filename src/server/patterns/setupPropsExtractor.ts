import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { SetupPropertyAssignment } from "../../shared/types";

// ─── REQ-05: Hook return-type map ─────────────────────────────────────────────

/**
 * Maps OWL hook names to their return-type string representations.
 * Derived from hooks.d.ts signatures — updated here when OWL is updated.
 * This is the authoritative "parsed" result, baked in at development time.
 */
export const HOOK_RETURN_TYPES: Record<string, string> = {
  useState: "T",
  useRef: "{ el: HTMLElement | null }",
  useService: "Service",
  useEnv: "Env",
  useComponent: "Component",
  useStore: "T",
  useChildRef: "{ el: HTMLElement | null }",
};

import { walkAst } from "./serviceExtractor";

/**
 * Extracts `this.prop = hookCall()` assignments from all setup() method bodies
 * found in the given AST. Populates `hookReturns` from HOOK_RETURN_TYPES when
 * the hook name is known.
 *
 * Covers REQ-05 / SC-05.1 and SC-05.3.
 */
export function extractSetupProperties(
  ast: TSESTree.Program | TSESTree.ClassDeclaration | TSESTree.ClassExpression,
): SetupPropertyAssignment[] {
  const results: SetupPropertyAssignment[] = [];

  walkAst(ast, (node) => {
    // Find MethodDefinition named 'setup'
    if (
      node["type"] === "MethodDefinition" &&
      (node["key"] as Record<string, unknown>)?.["type"] === "Identifier" &&
      (node["key"] as Record<string, unknown>)?.["name"] === "setup"
    ) {
      const value = node["value"] as Record<string, unknown>;
      const body = value?.["body"] as Record<string, unknown>;
      const bodyStatements = body?.["body"] as
        | Record<string, unknown>[]
        | undefined;
      if (!Array.isArray(bodyStatements)) {
        return;
      }

      for (const stmt of bodyStatements) {
        // Look for ExpressionStatement containing AssignmentExpression
        if (stmt["type"] !== "ExpressionStatement") {
          continue;
        }
        const expr = stmt["expression"] as Record<string, unknown>;
        if (expr?.["type"] !== "AssignmentExpression") {
          continue;
        }

        const left = expr["left"] as Record<string, unknown>;
        // Must be `this.propName`
        if (
          left?.["type"] !== "MemberExpression" ||
          (left["object"] as Record<string, unknown>)?.["type"] !==
            "ThisExpression" ||
          (left["property"] as Record<string, unknown>)?.["type"] !==
            "Identifier"
        ) {
          continue;
        }

        const propName = (left["property"] as Record<string, unknown>)[
          "name"
        ] as string;

        // RHS: look for CallExpression to detect hook calls
        const right = expr["right"] as Record<string, unknown>;
        let hookName: string | undefined;
        if (right?.["type"] === "CallExpression") {
          const callee = right["callee"] as Record<string, unknown>;
          if (callee?.["type"] === "Identifier") {
            hookName = callee["name"] as string;
          }
        }

        let stateShape: Record<string, string> | undefined;
        if (hookName === "useState" && right?.["type"] === "CallExpression") {
          const callArgs = right["arguments"] as Record<string, unknown>[];
          const firstArg = callArgs?.[0];
          if (firstArg?.["type"] === "ObjectExpression") {
            const shape: Record<string, string> = {};
            const properties = firstArg["properties"] as Record<
              string,
              unknown
            >[];
            for (const prop of properties) {
              if (prop["type"] === "Property") {
                const key = prop["key"] as Record<string, unknown>;
                if (key["type"] === "Identifier") {
                  const keyName = key["name"] as string;
                  const value = prop["value"] as Record<string, unknown>;
                  let valueType = "unknown";
                  if (value["type"] === "Literal") {
                    valueType = typeof value["value"];
                  } else if (value["type"] === "ArrayExpression") {
                    valueType = "Array";
                  } else if (value["type"] === "ObjectExpression") {
                    valueType = "object";
                  } else if (value["type"] === "Identifier") {
                    valueType = value["name"] as string;
                  }
                  shape[keyName] = valueType;
                }
              }
            }
            if (Object.keys(shape).length > 0) {
              stateShape = shape;
            }
          }
        }

        let serviceArg: string | undefined;
        if (hookName === "useService" && right?.["type"] === "CallExpression") {
          const callArgs = right["arguments"] as Record<string, unknown>[];
          const firstArg = callArgs?.[0];
          if (
            firstArg?.["type"] === "Literal" &&
            typeof firstArg["value"] === "string"
          ) {
            serviceArg = firstArg["value"] as string;
          }
        }

        results.push({
          name: propName,
          hookName,
          hookReturns: hookName ? HOOK_RETURN_TYPES[hookName] : undefined,
          stateShape,
          serviceArg,
        });
      }
    }
  });

  return results;
}
