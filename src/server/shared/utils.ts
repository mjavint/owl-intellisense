import { TextDocument } from "vscode-languageserver-textdocument";
import { Position, TextDocumentPositionParams } from "vscode-languageserver/node";

// ─── PERF-10: Bounded line read ────────────────────────────────────────────────

/** Maximum characters to read per line (prevents reading entire large files). */
const MAX_LINE_CHARS = 9999;

/**
 * Extracts the word (identifier) at the given position.
 * Works with both Position (LSP 0-based) and plain {line, character} objects.
 */
export function getWordAtPosition(
  doc: TextDocument,
  position: Position | { line: number; character: number },
): string | null {
  const { line, character } = position;
  const lineText = doc.getText({
    start: { line, character: 0 },
    end: { line, character: MAX_LINE_CHARS },
  });

  const char = character;
  let start = char;
  let end = char;

  while (start > 0 && /\w/.test(lineText[start - 1])) {
    start--;
  }
  while (end < lineText.length && /\w/.test(lineText[end])) {
    end++;
  }

  const word = lineText.substring(start, end);
  return word || null;
}

/**
 * Extracts the word (identifier) at the given position, returning
 * the word plus its start/end offsets within the line.
 */
export function getWordAtPositionWithRange(
  doc: TextDocument,
  position: Position | { line: number; character: number },
): { word: string; start: number; end: number } | null {
  const { line, character } = position;
  const lineText = doc.getText({
    start: { line, character: 0 },
    end: { line, character: MAX_LINE_CHARS },
  });

  const char = character;
  let start = char;
  let end = char;

  while (start > 0 && /[\w$]/.test(lineText[start - 1])) {
    start--;
  }
  while (end < lineText.length && /[\w$]/.test(lineText[end])) {
    end++;
  }

  const word = lineText.substring(start, end);
  return word ? { word, start, end } : null;
}

/**
 * Wrapper overload: extracts word at cursor from a TextDocumentPositionParams.
 */
export function getWordFromParams(
  doc: TextDocument,
  params: TextDocumentPositionParams,
): string | null {
  return getWordAtPosition(doc, params.position);
}
