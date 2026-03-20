import {
  Hover,
  MarkupKind,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { HOOK_NAMES, getHookByName, OWL_CLASS_NAMES, getClassByName } from '../owl/catalog';
import { SymbolIndex } from '../analyzer/index';

// PERF-10: Bounded line read — reads to end-of-line regardless of cursor position
const MAX_HOVER_LINE_CHARS = 9999;

/**
 * Gets the word at the cursor position in the document.
 */
function getWordAtPosition(
  doc: TextDocument,
  params: TextDocumentPositionParams
): string | null {
  const { line, character } = params.position;
  const lineText = doc.getText({
    start: { line, character: 0 },
    end: { line, character: MAX_HOVER_LINE_CHARS },
  });

  // Find word boundaries around cursor character position
  let start = character;
  let end = character;

  while (start > 0 && /\w/.test(lineText[start - 1])) {start--;}
  while (end < lineText.length && /\w/.test(lineText[end])) {end++;}

  const word = lineText.substring(start, end);
  return word || null;
}

export function onHover(
  params: TextDocumentPositionParams,
  doc: TextDocument,
  index: SymbolIndex
): Hover | null {
  const word = getWordAtPosition(doc, params);
  if (!word) {return null;}

  // Check OWL class catalog (Component, App, EventBus, etc.)
  if (OWL_CLASS_NAMES.has(word)) {
    const cls = getClassByName(word);
    if (cls) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: [
            `### \`${cls.name}\``,
            '',
            '```typescript',
            cls.signature,
            '```',
            '',
            cls.description,
            '',
            '_OWL class — imported from `@odoo/owl`_',
          ].join('\n'),
        },
      };
    }
  }

  // Check OWL hook catalog
  if (HOOK_NAMES.has(word)) {
    const hook = getHookByName(word);
    if (hook) {
      const content = [
        `### \`${hook.name}\``,
        '',
        '```typescript',
        hook.signature,
        '```',
        '',
        hook.description,
      ];
      if (hook.returns) {
        content.push('', `**Returns:** \`${hook.returns}\``);
      }
      if (hook.isLifecycle) {
        content.push('', '_Lifecycle hook_');
      } else {
        content.push('', '_Utility hook_');
      }

      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: content.join('\n'),
        },
      };
    }
  }

  // Check exported functions/utilities from workspace/addons
  const fn = index.getFunction(word);
  if (fn) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### \`${fn.name}\``,
          fn.signature ? `\`\`\`typescript\n${fn.signature}\n\`\`\`` : '',
          fn.jsDoc ?? '',
          `**Defined in:** \`${fn.filePath}\``,
        ].filter(Boolean).join('\n\n'),
      },
    };
  }

  // Check workspace component index
  const comp = index.getComponent(word);
  if (comp) {
    const propEntries = Object.entries(comp.props);
    const lines = [
      `### \`${comp.name}\` — OWL Component`,
      '',
      `**File:** \`${comp.filePath}\``,
    ];
    if (comp.templateRef) {
      lines.push(`**Template:** \`${comp.templateRef}\``);
    }
    lines.push('');
    if (propEntries.length === 0) {
      lines.push('_No props defined_');
    } else {
      lines.push('**Props:**', '');
      lines.push('| Name | Type | Optional |');
      lines.push('|------|------|----------|');
      for (const [propName, def] of propEntries) {
        lines.push(`| \`${propName}\` | \`${def.type}\` | ${def.optional ? '✓' : '✗'} |`);
      }
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: lines.join('\n'),
      },
    };
  }

  return null;
}
