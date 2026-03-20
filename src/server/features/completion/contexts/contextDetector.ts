// Context detection for completion — src/server/features/completion/contexts/contextDetector.ts
// Single-pass O(n) context detection that replaces multiple independent detectors.

import { CompletionContext } from "../../../../shared/types";
import { RE_USE_SERVICE_OPEN, getCachedRegex } from "../../../shared";

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
