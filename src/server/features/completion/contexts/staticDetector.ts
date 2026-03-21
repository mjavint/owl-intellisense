// Static detection heuristics — src/server/features/completion/contexts/staticDetector.ts
// Heuristic: checks if cursor appears to be inside static contexts.

import { TextDocumentPositionParams } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { RE_STATIC_PROPS_BLOCK } from "../../../shared";

/**
 * Heuristic: checks if cursor is inside `static components = { ... }`.
 */
export function isInsideStaticComponents(
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
 */
export function isInsideStaticProps(
  doc: TextDocument,
  params: TextDocumentPositionParams,
): boolean {
  const offset = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  const match = RE_STATIC_PROPS_BLOCK.exec(before);
  if (!match) {
    return false;
  }

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
 */
export function isAtClassBodyLevel(
  doc: TextDocument,
  params: TextDocumentPositionParams,
): boolean {
  const offset = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  const classMatch = before.lastIndexOf("class ");
  if (classMatch === -1) {
    return false;
  }

  const afterClass = before.substring(classMatch);
  let depth = 0;
  let foundOpen = false;
  let inAssignment = false;
  for (let i = 0; i < afterClass.length; i++) {
    const ch = afterClass[i];
    if (ch === "{") {
      depth++;
      foundOpen = true;
    } else if (ch === "}") {
      depth--;
      if (depth === 1) {
        inAssignment = false;
      }
    } else if (ch === ";" && depth === 1) {
      inAssignment = false;
    } else if (
      ch === "=" && depth === 1 &&
      afterClass[i - 1] !== "!" && afterClass[i - 1] !== "<" &&
      afterClass[i - 1] !== ">" && afterClass[i - 1] !== "=" &&
      afterClass[i + 1] !== ">" && afterClass[i + 1] !== "="
    ) {
      inAssignment = true;
    }
  }
  return foundOpen && depth === 1 && !inAssignment;
}
