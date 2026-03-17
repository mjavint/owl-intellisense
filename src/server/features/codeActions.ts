import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { HOOK_NAMES } from '../owl/catalog';
import { SymbolIndex } from '../analyzer/index';
import { buildAddImportEdits, isSpecifierImported, resolveImportSource } from '../utils/importUtils';
import { filePathToAlias, inferAliasFromPath } from '../resolver/addonDetector';

export function onCodeAction(
  params: CodeActionParams,
  doc: TextDocument,
  index: SymbolIndex,
  aliasMap?: Map<string, string>
): CodeAction[] {
  const actions: CodeAction[] = [];
  const text = doc.getText();
  const currentFile = doc.uri;

  // Handle normalize-import (owl/normalize-import) diagnostics
  for (const diag of params.context.diagnostics) {
    if (diag.code !== 'owl/normalize-import' && diag.code !== 'normalize-import-alias') { continue; }
    const diagData = diag.data as { source: string } | undefined;
    if (!diagData) { continue; }

    const rawSource = diagData.source;

    // Resolve the raw source to an absolute path
    let absolutePath: string | undefined;

    // If it already contains /static/src/ pattern, infer directly
    if (rawSource.includes('/static/src/')) {
      absolutePath = rawSource;
    } else if (rawSource.startsWith('.')) {
      // Relative path — resolve to absolute
      try {
        const currentFilePath = fileURLToPath(doc.uri);
        const resolved = path.resolve(path.dirname(currentFilePath), rawSource);
        // Try with extensions
        for (const ext of ['', '.ts', '.js', '/index.ts', '/index.js']) {
          if (fs.existsSync(resolved + ext)) {
            absolutePath = resolved + ext;
            break;
          }
        }
        if (!absolutePath) { absolutePath = resolved; }
      } catch { continue; }
    }

    if (!absolutePath) { continue; }

    // Get the alias
    const alias = aliasMap
      ? filePathToAlias(absolutePath, aliasMap) ?? inferAliasFromPath(absolutePath)
      : inferAliasFromPath(absolutePath);

    if (!alias || alias === rawSource) { continue; }

    // Build TextEdit to replace the import string (range covers the string literal including quotes)
    const edit = TextEdit.replace(diag.range, `'${alias}'`);
    actions.push({
      title: `Replace with '${alias}'`,
      kind: CodeActionKind.QuickFix,
      isPreferred: true,
      diagnostics: [diag],
      edit: { changes: { [doc.uri]: [edit] } },
    });
  }

  // Handle owl/missing-owl-import diagnostics
  for (const diag of params.context.diagnostics) {
    if (diag.code !== 'owl/missing-owl-import') { continue; }
    const data = diag.data as { name: string; source: string } | undefined;
    if (!data) { continue; }
    const edits = buildAddImportEdits(text, data.name, data.source);
    if (edits.length > 0) {
      actions.push({
        title: `Import { ${data.name} } from '${data.source}'`,
        kind: CodeActionKind.QuickFix,
        isPreferred: true,
        diagnostics: [diag],
        edit: { changes: { [doc.uri]: edits } },
      });
    }
  }

  // Collect all diagnostics in the requested range
  for (const diagnostic of params.context.diagnostics) {
    const code = diagnostic.code;

    if (code === 'owl-unresolved' || code === 'owl-missing-import') {
      // Try to determine the symbol name from the diagnostic message
      const match = /['"`](\w+)['"`]/.exec(diagnostic.message);
      if (!match) {continue;}
      const word = match[1];

      // Is it an OWL built-in hook or class?
      if (HOOK_NAMES.has(word) || word === 'Component') {
        if (!isSpecifierImported(text, word)) {
          const edits = buildAddImportEdits(text, word, '@odoo/owl');
          if (edits.length > 0) {
            actions.push({
              title: `Import { ${word} } from '@odoo/owl'`,
              kind: CodeActionKind.QuickFix,
              diagnostics: [diagnostic],
              edit: { changes: { [doc.uri]: edits } },
            });
          }
        }
      } else {
        // Try to find as custom hook from addon
        if (word.startsWith('use') && !isSpecifierImported(text, word)) {
          const fn = index.getFunction(word);
          if (fn) {
            const source = resolveImportSource(fn.filePath, currentFile, aliasMap);
            const edits = buildAddImportEdits(text, word, source);
            if (edits.length > 0) {
              actions.push({
                title: `Import { ${word} } from '${source}'`,
                kind: CodeActionKind.QuickFix,
                diagnostics: [diagnostic],
                edit: { changes: { [doc.uri]: edits } },
              });
            }
          }
        }

        // Try to find as workspace component
        const comp = index.getComponent(word);
        if (comp && !isSpecifierImported(text, word)) {
          const source = resolveImportSource(comp.filePath, currentFile, aliasMap);
          const edits = buildAddImportEdits(text, word, source);
          if (edits.length > 0) {
            actions.push({
              title: `Import { ${word} } from '${source}'`,
              kind: CodeActionKind.QuickFix,
              diagnostics: [diagnostic],
              edit: { changes: { [doc.uri]: edits } },
            });
          }
        }
      }
    }
  }

  // Also offer proactive import actions based on current word if no specific diagnostic
  if (actions.length === 0) {
    const { line, character } = params.range.start;
    const lineText = doc.getText({
      start: { line, character: 0 },
      end: { line, character: character + 100 },
    });

    let start = character;
    let end = character;
    while (start > 0 && /\w/.test(lineText[start - 1])) {start--;}
    while (end < lineText.length && /\w/.test(lineText[end])) {end++;}
    const word = lineText.substring(start, end);

    if (word && (HOOK_NAMES.has(word) || word === 'Component') && !isSpecifierImported(text, word)) {
      const edits = buildAddImportEdits(text, word, '@odoo/owl');
      if (edits.length > 0) {
        actions.push({
          title: `Import { ${word} } from '@odoo/owl'`,
          kind: CodeActionKind.QuickFix,
          edit: { changes: { [doc.uri]: edits } },
        });
      }
    }

    // Proactive: custom hook auto-import
    if (word && word.startsWith('use') && !HOOK_NAMES.has(word) && !isSpecifierImported(text, word)) {
      const fn = index.getFunction(word);
      if (fn) {
        const source = resolveImportSource(fn.filePath, currentFile, aliasMap);
        const edits = buildAddImportEdits(text, word, source);
        if (edits.length > 0) {
          actions.push({
            title: `Import { ${word} } from '${source}'`,
            kind: CodeActionKind.QuickFix,
            edit: { changes: { [doc.uri]: edits } },
          });
        }
      }
    }

    // Proactive: workspace component auto-import
    if (word && !word.startsWith('use') && !HOOK_NAMES.has(word) && !isSpecifierImported(text, word)) {
      const comp = index.getComponent(word);
      if (comp) {
        const source = resolveImportSource(comp.filePath, currentFile, aliasMap);
        const edits = buildAddImportEdits(text, word, source);
        if (edits.length > 0) {
          actions.push({
            title: `Import { ${word} } from '${source}'`,
            kind: CodeActionKind.QuickFix,
            edit: { changes: { [doc.uri]: edits } },
          });
        }
      }
    }
  }

  return actions;
}
