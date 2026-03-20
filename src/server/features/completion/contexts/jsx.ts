// JSX and class detection heuristics — src/server/features/completion/contexts/jsx.ts
// JSX tag and class name detection for completion context.

import { Position, TextDocumentPositionParams } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getCachedRegex } from "../../../shared";

/**
 * SC-04b: Detect if cursor is inside a JSX opening tag for a known component.
 * Returns the component name if the cursor is inside `<ComponentName ...attrs... >` or `<ComponentName |>`.
 * Returns null if not in JSX tag context.
 */
export function getJsxTagComponentName(
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
  if (tagStart.includes(">")) {
    return null;
  }

  return compName;
}

/**
 * G1: Finds the name of the class enclosing the given position by scanning
 * forward through the text before the cursor and tracking brace depth.
 * Returns undefined if the cursor is not inside a class body.
 */
export function getEnclosingClassName(
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
