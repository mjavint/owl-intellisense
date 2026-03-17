import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { OWL_HOOKS } from '../owl/catalog';
import { SymbolIndex } from '../analyzer/index';
import { buildAddImportEdits, isSpecifierImported, resolveImportSource } from '../utils/importUtils';

/**
 * Heuristic: checks if the cursor appears to be inside a setup() method body.
 * We look backwards through the document text for a `setup()` opening and
 * confirm we're inside its braces.
 */
function isInsideSetupMethod(doc: TextDocument, params: TextDocumentPositionParams): boolean {
  const offset = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  // Find the last occurrence of setup() { before cursor
  const setupMatch = before.lastIndexOf('setup()');
  if (setupMatch === -1) {return false;}

  // Count braces after setup() to see if we're still inside
  const afterSetup = before.substring(setupMatch);
  let depth = 0;
  let foundOpen = false;
  for (const ch of afterSetup) {
    if (ch === '{') {
      depth++;
      foundOpen = true;
    } else if (ch === '}') {
      depth--;
    }
  }
  return foundOpen && depth > 0;
}

/**
 * Heuristic: checks if cursor is inside `static components = { ... }`.
 */
function isInsideStaticComponents(doc: TextDocument, params: TextDocumentPositionParams): boolean {
  const offset = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.substring(0, offset);

  const staticMatch = before.lastIndexOf('static components');
  if (staticMatch === -1) {return false;}

  const afterStatic = before.substring(staticMatch);
  let depth = 0;
  let foundOpen = false;
  for (const ch of afterStatic) {
    if (ch === '{') {
      depth++;
      foundOpen = true;
    } else if (ch === '}') {
      depth--;
    }
  }
  return foundOpen && depth > 0;
}

export function onCompletion(
  params: TextDocumentPositionParams,
  doc: TextDocument,
  index: SymbolIndex,
  aliasMap?: Map<string, string>
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const docText = doc.getText();

  if (isInsideSetupMethod(doc, params)) {
    // Return OWL built-in hooks as completion items
    for (const hook of OWL_HOOKS) {
      const importEdits = isSpecifierImported(docText, hook.name)
        ? []
        : buildAddImportEdits(docText, hook.name, '@odoo/owl');
      const item: CompletionItem = {
        label: hook.name,
        kind: CompletionItemKind.Function,
        detail: hook.signature,
        documentation: {
          kind: MarkupKind.Markdown,
          value: [
            `**${hook.name}**`,
            '',
            hook.description,
            hook.returns ? `\n**Returns:** ${hook.returns}` : '',
          ]
            .filter((l) => l !== undefined)
            .join('\n'),
        },
        insertText: hook.completionSnippet ?? hook.name,
        insertTextFormat: hook.completionSnippet
          ? InsertTextFormat.Snippet
          : InsertTextFormat.PlainText,
        additionalTextEdits: importEdits,
      };
      items.push(item);
    }

    // All exported symbols from workspace/addons — hooks get higher priority
    for (const fn of index.getAllFunctions()) {
      const source = resolveImportSource(fn.filePath, params.textDocument.uri, aliasMap);
      const hookImportEdits = isSpecifierImported(docText, fn.name)
        ? []
        : buildAddImportEdits(docText, fn.name, source);
      items.push({
        label: fn.name,
        kind: CompletionItemKind.Function,
        detail: fn.signature ?? fn.name,
        documentation: {
          kind: 'markdown',
          value: [
            fn.jsDoc ?? '',
            `**From:** \`${source}\``,
          ].filter(Boolean).join('\n\n'),
        },
        insertText: fn.name,
        insertTextFormat: InsertTextFormat.PlainText,
        sortText: (fn.name.startsWith('use') ? 'z' : 'zz') + fn.name,
        data: { type: 'custom-hook', name: fn.name, uri: fn.uri },
        additionalTextEdits: hookImportEdits,
      });
    }

    return items;
  }

  if (isInsideStaticComponents(doc, params)) {
    // Return workspace components
    for (const comp of index.getAllComponents()) {
      const source = resolveImportSource(comp.filePath, params.textDocument.uri, aliasMap);
      const compImportEdits = isSpecifierImported(docText, comp.name)
        ? []
        : buildAddImportEdits(docText, comp.name, source);
      const item: CompletionItem = {
        label: comp.name,
        kind: CompletionItemKind.Class,
        detail: `OWL Component — ${comp.filePath}`,
        documentation: {
          kind: MarkupKind.Markdown,
          value: buildComponentDocs(comp.name, comp.props),
        },
        insertText: `${comp.name},`,
        insertTextFormat: InsertTextFormat.PlainText,
        additionalTextEdits: compImportEdits,
      };
      items.push(item);
    }
    return items;
  }

  // General context (not inside setup or static components):
  // Offer components and custom hooks with lower priority so they don't overwhelm
  // context-specific completions.
  for (const hook of OWL_HOOKS) {
    const importEdits = isSpecifierImported(docText, hook.name)
      ? []
      : buildAddImportEdits(docText, hook.name, '@odoo/owl');
    items.push({
      label: hook.name,
      kind: CompletionItemKind.Function,
      detail: hook.signature,
      insertText: hook.completionSnippet ?? hook.name,
      insertTextFormat: hook.completionSnippet
        ? InsertTextFormat.Snippet
        : InsertTextFormat.PlainText,
      sortText: 'zz' + hook.name,
      additionalTextEdits: importEdits,
    });
  }

  for (const comp of index.getAllComponents()) {
    const source = resolveImportSource(comp.filePath, params.textDocument.uri, aliasMap);
    const compImportEdits = isSpecifierImported(docText, comp.name)
      ? []
      : buildAddImportEdits(docText, comp.name, source);
    items.push({
      label: comp.name,
      kind: CompletionItemKind.Class,
      detail: `OWL Component — ${comp.filePath}`,
      insertText: comp.name,
      sortText: 'zz' + comp.name,
      additionalTextEdits: compImportEdits,
    });
  }

  for (const fn of index.getAllFunctions()) {
    const source = resolveImportSource(fn.filePath, params.textDocument.uri, aliasMap);
    const hookImportEdits = isSpecifierImported(docText, fn.name)
      ? []
      : buildAddImportEdits(docText, fn.name, source);
    items.push({
      label: fn.name,
      kind: CompletionItemKind.Function,
      detail: fn.signature ?? fn.name,
      insertText: fn.name,
      insertTextFormat: InsertTextFormat.PlainText,
      sortText: (fn.name.startsWith('use') ? 'zz' : 'zzz') + fn.name,
      data: { type: 'custom-hook', name: fn.name, uri: fn.uri },
      additionalTextEdits: hookImportEdits,
    });
  }

  return items;
}

export function onCompletionResolve(item: CompletionItem): CompletionItem {
  // Custom hook — documentation already set at completion time
  if (item.data && (item.data as { type?: string }).type === 'custom-hook') {
    return item;
  }

  // Enrich with full documentation if not already present
  if (!item.documentation) {
    const hook = OWL_HOOKS.find((h) => h.name === item.label);
    if (hook) {
      item.documentation = {
        kind: MarkupKind.Markdown,
        value: [
          `### ${hook.name}`,
          '',
          `\`\`\`typescript`,
          hook.signature,
          `\`\`\``,
          '',
          hook.description,
          hook.returns ? `\n**Returns:** \`${hook.returns}\`` : '',
        ]
          .filter((l) => l !== undefined)
          .join('\n'),
      };
    }
  }
  return item;
}

function buildComponentDocs(name: string, props: Record<string, { type: string; optional: boolean; validate: boolean }>): string {
  const lines = [`**${name}** — OWL Component`, ''];
  const propEntries = Object.entries(props);
  if (propEntries.length === 0) {
    lines.push('_No props defined_');
  } else {
    lines.push('**Props:**', '');
    lines.push('| Name | Type | Optional |');
    lines.push('|------|------|----------|');
    for (const [propName, def] of propEntries) {
      lines.push(`| \`${propName}\` | \`${def.type}\` | ${def.optional ? 'yes' : 'no'} |`);
    }
  }
  return lines.join('\n');
}
