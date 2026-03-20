import {
  RenameParams,
  TextEdit,
  WorkspaceEdit,
  Range,
  PrepareRenameParams,
} from 'vscode-languageserver/node';
import {
  IComponentReader,
  IFunctionReader,
  IImportReader,
  IServiceReader,
} from '../../shared/types';
import { getWordAtPositionWithRange, type RequestContext } from '../shared';
import * as fs from 'fs';

/**
 * Check whether the given word is a symbol known to the index.
 * Returns the kind of symbol or null if not found.
 */
function resolveSymbolKind(
  word: string,
  index: IComponentReader & IFunctionReader & IImportReader & IServiceReader,
): 'component' | 'function' | 'service' | null {
  if (index.getComponent(word)) { return 'component'; }
  if (index.getFunction(word)) { return 'function'; }
  if (index.getService(word)) { return 'service'; }
  return null;
}

/**
 * Find all occurrences of `word` (as a whole identifier) in `content`
 * and return TextEdits replacing each with `newName`.
 */
function collectEditsInContent(
  content: string,
  word: string,
  newName: string,
): TextEdit[] {
  const edits: TextEdit[] = [];
  const lines = content.split('\n');
  const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line)) !== null) {
      edits.push(TextEdit.replace(
        Range.create(i, m.index, i, m.index + word.length),
        newName,
      ));
    }
  }

  return edits;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collect the set of file URIs that import `word` from any source.
 * We use the index's importsBySpecifier map for this.
 */
function collectImportingUris(
  word: string,
  index: IImportReader,
): Set<string> {
  const uris = new Set<string>();
  for (const imp of index.getImportsForSpecifier(word)) {
    uris.add(imp.uri);
  }
  return uris;
}

/**
 * Prepare rename: validate the cursor position and return the word range.
 * Returns null if no renameable symbol is found at the position.
 */
export function onPrepareRename(
  params: PrepareRenameParams,
  ctx: RequestContext,
): { range: Range; placeholder: string } | null {
  const doc = ctx.doc;
  if (!doc) { return null; }
  const wordInfo = getWordAtPositionWithRange(doc, params.position);
  if (!wordInfo) { return null; }

  const kind = resolveSymbolKind(wordInfo.word, ctx.index);
  if (!kind) { return null; }

  return {
    range: Range.create(
      params.position.line,
      wordInfo.start,
      params.position.line,
      wordInfo.end,
    ),
    placeholder: wordInfo.word,
  };
}

/**
 * Provide workspace-wide rename edits for the symbol at the given position.
 *
 * Strategy:
 * 1. Resolve the word under the cursor.
 * 2. Rename all occurrences in the current document.
 * 3. For every file that imports the symbol (tracked in the index),
 *    rename all occurrences in that file too (read from disk).
 */
export async function onRename(
  params: RenameParams,
  ctx: RequestContext,
): Promise<WorkspaceEdit | null> {
  const doc = ctx.doc;
  if (!doc) { return null; }
  const index = ctx.index;
  const { newName, position } = params;

  const wordInfo = getWordAtPositionWithRange(doc, position);
  if (!wordInfo) { return null; }

  const { word: oldName } = wordInfo;
  const kind = resolveSymbolKind(oldName, index);
  if (!kind) { return null; }

  const changes: Record<string, TextEdit[]> = {};

  // Rename in current document
  const currentEdits = collectEditsInContent(doc.getText(), oldName, newName);
  if (currentEdits.length > 0) {
    changes[doc.uri] = currentEdits;
  }

  // Rename in all files that import this symbol
  const importingUris = collectImportingUris(oldName, index);
  importingUris.delete(doc.uri); // already handled above

  for (const uri of importingUris) {
    // Convert URI to file path
    let filePath: string;
    try {
      filePath = new URL(uri).pathname;
    } catch {
      filePath = uri.replace('file://', '');
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const fileEdits = collectEditsInContent(content, oldName, newName);
      if (fileEdits.length > 0) {
        changes[uri] = fileEdits;
      }
    } catch {
      // Skip unreadable files silently
    }
  }

  return { changes };
}
