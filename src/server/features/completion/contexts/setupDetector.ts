// Setup method detection heuristics — src/server/features/completion/contexts/setupDetector.ts
// Heuristic: checks if cursor appears to be inside a setup() method body.

import { TextDocumentPositionParams } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

/**
 * Heuristic: checks if the cursor appears to be inside a setup() method body.
 * We look backwards through the document text for a `setup()` opening and
 * confirm we're inside its braces.
 */
export function isInsideSetupMethod(
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
