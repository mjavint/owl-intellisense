import {
  Hover,
  MarkupKind,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import {
  HOOK_NAMES,
  getHookByName,
  OWL_CLASS_NAMES,
  getClassByName,
} from '../owl/catalog';
import { ExportedFunction } from '../../shared/types';
import { getWordAtPosition, type RequestContext } from '../shared';

// PERF-03: Module-level compiled regex patterns for JSDoc parsing
const RE_JSDOC_PARAM = /@param\s+\{([^}]+)\}\s+(\w+)\s*(.*)/g;
const RE_JSDOC_RETURNS = /@returns?\s+\{([^}]+)\}\s*(.*)/;
const RE_JSDOC_DESC_TAG = /@description\s+(.+)/;

/**
 * Build rich markdown hover content for an ctx.indexed ExportedFunction,
 * including signature, JSDoc description, parameters, and source location.
 */
function buildFunctionHover(fn: ExportedFunction): string {
  const parts: string[] = [];

  // Signature code block
  if (fn.signature) {
    parts.push('```typescript\n' + fn.signature + '\n```');
  }

  // JSDoc description
  if (fn.jsDoc) {
    // Extract the @description line or the first non-tag paragraph
    const descMatch = RE_JSDOC_DESC_TAG.exec(fn.jsDoc);
    if (descMatch) {
      parts.push(descMatch[1]);
    } else {
      // Use everything before the first @tag
      const firstTagIdx = fn.jsDoc.indexOf('@');
      const desc =
        firstTagIdx > 0
          ? fn.jsDoc.substring(0, firstTagIdx).trim()
          : fn.jsDoc.trim();
      if (desc) {
        parts.push(desc);
      }
    }

    // @param entries — reset lastIndex since RE_JSDOC_PARAM is module-level /g
    RE_JSDOC_PARAM.lastIndex = 0;
    const paramLines: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = RE_JSDOC_PARAM.exec(fn.jsDoc)) !== null) {
      const [, type, name, desc] = m;
      paramLines.push(`• **${name}** \`${type}\`${desc ? ' — ' + desc : ''}`);
    }
    if (paramLines.length > 0) {
      parts.push('**Parameters**\n\n' + paramLines.join('\n'));
    }

    // @returns
    const returnMatch = RE_JSDOC_RETURNS.exec(fn.jsDoc);
    if (returnMatch) {
      const [, type, desc] = returnMatch;
      parts.push(`**Returns** — \`${type}\`${desc ? ' — ' + desc : ''}`);
    }
  }

  // Source location
  parts.push(`**Defined in:** \`${fn.filePath}\``);

  return parts.filter(Boolean).join('\n\n');
}

export function onHover(
  params: TextDocumentPositionParams,
  ctx: RequestContext,
): Hover | null {
  const doc = ctx.doc;
  if (!doc) { return null; }
  const word = getWordAtPosition(doc, params.position);
  if (!word) { return null; }

  // ── OWL class catalog (Component, App, EventBus, etc.) ───────────────────
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

  // ── OWL hook catalog ─────────────────────────────────────────────────────
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

  // ── Exported functions / utilities from workspace/addons ─────────────────
  const fn = ctx.index.getFunction(word);
  if (fn) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: buildFunctionHover(fn),
      },
    };
  }

  // ── Workspace component ctx.index ─────────────────────────────────────────────
  const comp = ctx.index.getComponent(word);
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
        lines.push(
          `| \`${propName}\` | \`${def.type}\` | ${def.optional ? '✓' : '✗'} |`,
        );
      }
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: lines.join('\n'),
      },
    };
  }

  // ── Odoo service ctx.index ────────────────────────────────────────────────────
  const svc = ctx.index.getService(word);
  if (svc) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `### \`${svc.name}\` — Odoo Service`,
          '',
          `**Registered as:** \`${svc.name}\``,
          `**Local identifier:** \`${svc.localName}\``,
          `**File:** \`${svc.filePath}\``,
          '',
          '_Use via `useService("' + svc.name + '")`_',
        ].join('\n'),
      },
    };
  }

  return null;
}
