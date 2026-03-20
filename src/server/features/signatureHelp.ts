import {
  SignatureHelp,
  SignatureHelpParams,
  SignatureInformation,
  ParameterInformation,
  MarkupKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { IFunctionReader, IImportReader, ExportedFunction } from '../../shared/types';
import { getHookByName, HOOK_NAMES } from '../owl/catalog';

// PERF-10: Bounded line read
const MAX_SIG_LINE_CHARS = 9999;

/**
 * Extract the function name being called and the active parameter index
 * from the text up to the cursor on the current line.
 *
 * Handles nested calls by tracking parenthesis depth so we always resolve
 * the *innermost* open call.
 */
function extractFunctionCall(
  lineUpToCursor: string,
): { name: string; paramIndex: number } | null {
  // Walk backwards tracking depth to find the innermost unclosed '('
  let depth = 0;
  let openParenIdx = -1;

  for (let i = lineUpToCursor.length - 1; i >= 0; i--) {
    const ch = lineUpToCursor[i];
    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth === 0) {
        openParenIdx = i;
        break;
      }
      depth--;
    }
  }

  if (openParenIdx <= 0) {
    return null;
  }

  // Extract identifier just before '('
  const before = lineUpToCursor.substring(0, openParenIdx);
  const identMatch = before.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (!identMatch) {
    return null;
  }

  const name = identMatch[1];
  // Count commas at depth 0 after openParen to determine parameter index
  const afterParen = lineUpToCursor.substring(openParenIdx + 1);
  let paramIndex = 0;
  let innerDepth = 0;

  for (const ch of afterParen) {
    if (ch === '(' || ch === '[' || ch === '{') {
      innerDepth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      innerDepth--;
    } else if (ch === ',' && innerDepth === 0) {
      paramIndex++;
    }
  }

  return { name, paramIndex };
}

/**
 * Parse parameter names from a function signature string like `foo(a, b?, ...c)`.
 * Returns an array of parameter labels.
 */
function parseSignatureParams(signature: string): string[] {
  const parenStart = signature.indexOf('(');
  const parenEnd = signature.lastIndexOf(')');
  if (parenStart === -1 || parenEnd === -1 || parenEnd <= parenStart) {
    return [];
  }
  const inner = signature.substring(parenStart + 1, parenEnd).trim();
  if (!inner) {
    return [];
  }
  return inner.split(',').map((p) => p.trim()).filter(Boolean);
}

/**
 * Build a SignatureInformation from an ExportedFunction.
 */
function buildSignatureInfo(fn: ExportedFunction): SignatureInformation {
  const label = fn.signature ?? fn.name + '()';
  const params = parseSignatureParams(label);

  const docParts: string[] = [];
  if (fn.jsDoc) {
    docParts.push(fn.jsDoc);
  }
  docParts.push(`**Defined in:** \`${fn.filePath}\``);

  return {
    label,
    documentation: {
      kind: MarkupKind.Markdown,
      value: docParts.join('\n\n'),
    },
    parameters: params.map(
      (p): ParameterInformation => ({ label: p }),
    ),
  };
}

/**
 * Build a SignatureInformation for an OWL catalog hook.
 */
function buildOwlHookSignature(name: string): SignatureInformation | null {
  const hook = getHookByName(name);
  if (!hook) {
    return null;
  }
  const params = parseSignatureParams(hook.signature);
  return {
    label: hook.signature,
    documentation: {
      kind: MarkupKind.Markdown,
      value: [
        hook.description,
        hook.returns ? `\n\n**Returns:** \`${hook.returns}\`` : '',
        '\n\n_OWL hook — imported from `@odoo/owl`_',
      ].join(''),
    },
    parameters: params.map((p): ParameterInformation => ({ label: p })),
  };
}

export function onSignatureHelp(
  params: SignatureHelpParams,
  doc: TextDocument,
  index: IFunctionReader & IImportReader,
): SignatureHelp | null {
  const { line, character } = params.position;

  const lineText = doc.getText({
    start: { line, character: 0 },
    end: { line, character: MAX_SIG_LINE_CHARS },
  });

  const lineUpToCursor = lineText.substring(0, character);
  const call = extractFunctionCall(lineUpToCursor);
  if (!call) {
    return null;
  }

  const { name, paramIndex } = call;

  // Check OWL hook catalog first
  if (HOOK_NAMES.has(name)) {
    const sig = buildOwlHookSignature(name);
    if (sig) {
      return {
        signatures: [sig],
        activeSignature: 0,
        activeParameter: paramIndex,
      };
    }
  }

  // Check workspace function index
  const fn = index.getFunction(name);
  if (fn) {
    return {
      signatures: [buildSignatureInfo(fn)],
      activeSignature: 0,
      activeParameter: paramIndex,
    };
  }

  // Try to find by source alias (e.g. imported from @odoo/owl)
  const imports = index.getImportsInFile(doc.uri);
  for (const imp of imports) {
    if (imp.localName === name || imp.specifier === name) {
      const fnBySource = index.getFunctionBySource(imp.source, imp.specifier);
      if (fnBySource) {
        return {
          signatures: [buildSignatureInfo(fnBySource)],
          activeSignature: 0,
          activeParameter: paramIndex,
        };
      }
    }
  }

  return null;
}
