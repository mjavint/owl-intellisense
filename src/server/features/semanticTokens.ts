import {
  SemanticTokens,
  SemanticTokensParams,
  SemanticTokensLegend,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

// ─── Token type and modifier indices ──────────────────────────────────────────

export const SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
  tokenTypes: [
    "namespace",      // 0
    "type",           // 1
    "class",          // 2
    "interface",      // 3
    "struct",         // 4
    "typeParameter",  // 5
    "parameter",      // 6
    "variable",       // 7
    "property",       // 8
    "enum",           // 9
    "enumMember",     // 10
    "function",       // 11
    "method",         // 12
    "macro",          // 13
    "keyword",        // 14
    "modifier",       // 15
    "comment",        // 16
    "string",         // 17
    "number",         // 18
    "regexp",         // 19
    "operator",       // 20
  ],
  tokenModifiers: [
    "declaration",    // 0
    "definition",     // 1
    "readonly",       // 2
    "static",         // 3
    "deprecated",     // 4
    "abstract",       // 5
    "async",          // 6
    "defaultLibrary", // 7
  ],
};

// Modifier bit flags
const MOD_STATIC = 1 << 3; // bit 3

// ─── PERF-03: Module-level pre-compiled patterns ──────────────────────────────

const PATTERNS = {
  keyword:
    /\b(import|export|from|const|let|var|function|class|extends|new|this|super|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|async|await|yield|typeof|instanceof|in|of|delete|void|null|undefined|true|false|NaN|Infinity)\b/g,
  comment: /\/\/.*$|\/\*[\s\S]*?\*\//gm,
  string: /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g,
  number: /\b(?:0x[\da-fA-F]+|0o[0-7]+|0b[01]+|\d+\.?\d*(?:e[+-]?\d+)?)\b/g,
  functionCall: /\b([a-zA-Z_$][\w$]*)\s*\(/g,
  classDeclaration: /\bclass\s+([A-Z][a-zA-Z0-9_]*)/g,
  functionDeclaration: /\b(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/g,
  arrowFunction: /(?:const|let|var)\s+([a-z_$][\w$]*)\s*=\s*(?:async\s+)?\(/g,
  staticProperty: /static\s+([a-zA-Z_$][\w$]*)/g,
  method: /^\s*(?:async\s+)?(?:static\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*[{:]/gm,
  variable: /\b(?:const|let|var)\s+([a-z_$][\w$]*)/g,
  typeAnnotation: /:\s*([A-Z][a-zA-Z0-9_<>]+)(?:\s*[?=]|\s*[,;)])/g,
  operator: /[+\-*/%=<>!&|^~?:]+/g,
  decorator: /@\w+/g,
  // OWL-specific: static template/props/components
  owlStaticTemplate: /\bstatic\s+template\b/g,
  owlStaticProps: /\bstatic\s+props\b/g,
  owlStaticComponents: /\bstatic\s+components\b/g,
};

// Keywords to skip in function-call detection
const CALL_SKIP_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "instanceof",
]);

// Keywords to skip in method detection
const METHOD_SKIP_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "get", "set", "constructor",
]);

/**
 * Check if a character position in `line` falls inside a string literal
 * or single-line comment.
 */
function isInsideStringOrComment(line: string, position: number): boolean {
  const before = line.substring(0, position);
  if (before.includes("//")) {return true;}
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (!inString && (ch === '"' || ch === "'" || ch === "`")) {
      inString = true;
      stringChar = ch;
    } else if (inString && ch === stringChar && before[i - 1] !== "\\") {
      inString = false;
    }
  }
  return inString;
}

/**
 * Process a single line with a (stateful) regex, appending absolute-position
 * token entries [line, char, len, tokenType, tokenModifiers] to `data`.
 *
 * IMPORTANT: `pattern.lastIndex` is reset before each call so callers share
 * module-level RegExp instances safely.
 */
function processLine(
  line: string,
  lineIndex: number,
  pattern: RegExp,
  tokenType: number,
  tokenModifiers: number,
  data: number[],
): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const text = match[1] ?? match[0];
    if (!text) {continue;}
    const startChar = match[1] !== undefined
      ? line.indexOf(match[1], match.index)
      : match.index;
    if (isInsideStringOrComment(line, startChar)) {continue;}
    data.push(lineIndex, startChar, text.length, tokenType, tokenModifiers);
  }
}

/**
 * Process function *calls* (distinguish from declarations).
 */
function processFunctionCalls(
  line: string,
  lineIndex: number,
  data: number[],
): void {
  PATTERNS.functionCall.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATTERNS.functionCall.exec(line)) !== null) {
    const funcName = match[1];
    const startChar = match.index;
    if (isInsideStringOrComment(line, startChar)) {continue;}
    const beforeMatch = line.substring(0, startChar).trim();
    if (beforeMatch.endsWith("function") || beforeMatch.endsWith("async")) {continue;}
    if (CALL_SKIP_KEYWORDS.has(funcName)) {continue;}
    data.push(lineIndex, startChar, funcName.length, 11, 0);
  }
}

/**
 * Process method definitions inside classes.
 */
function processMethods(
  line: string,
  lineIndex: number,
  data: number[],
): void {
  PATTERNS.method.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATTERNS.method.exec(line)) !== null) {
    const methodName = match[1];
    const startChar = line.indexOf(methodName, match.index);
    if (METHOD_SKIP_KEYWORDS.has(methodName)) {continue;}
    if (isInsideStringOrComment(line, startChar)) {continue;}
    const afterMatch = line.substring(startChar + methodName.length);
    if (!afterMatch.trim().startsWith("(")) {continue;}
    data.push(lineIndex, startChar, methodName.length, 12, 0);
  }
}

/**
 * Process OWL-specific `static template/props/components` lines.
 * These receive the `property` token type (8) with `static` modifier (3).
 */
function processOwlStaticMembers(
  line: string,
  lineIndex: number,
  data: number[],
): void {
  for (const pattern of [
    PATTERNS.owlStaticTemplate,
    PATTERNS.owlStaticProps,
    PATTERNS.owlStaticComponents,
  ]) {
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (match) {
      // Highlight the member name (template/props/components) with static modifier
      const fullMatch = match[0]; // e.g. "static template"
      const memberName = fullMatch.split(/\s+/).pop()!;
      const memberStart = match.index + fullMatch.lastIndexOf(memberName);
      data.push(lineIndex, memberStart, memberName.length, 8, MOD_STATIC);
    }
  }
}

export function onSemanticTokens(
  _params: SemanticTokensParams,
  doc: TextDocument,
): SemanticTokens {
  const content = doc.getText();
  const lines = content.split("\n");
  const data: number[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (!line.trim()) {continue;}

    processLine(line, lineIndex, PATTERNS.keyword, 14, 0, data);
    processLine(line, lineIndex, PATTERNS.comment, 16, 0, data);
    processLine(line, lineIndex, PATTERNS.string, 17, 0, data);
    processLine(line, lineIndex, PATTERNS.number, 18, 0, data);
    processLine(line, lineIndex, PATTERNS.operator, 20, 0, data);
    processLine(line, lineIndex, PATTERNS.classDeclaration, 2, 0, data);
    processLine(line, lineIndex, PATTERNS.functionDeclaration, 11, 0, data);
    processLine(line, lineIndex, PATTERNS.arrowFunction, 11, 0, data);
    processLine(line, lineIndex, PATTERNS.variable, 7, 0, data);
    processLine(line, lineIndex, PATTERNS.typeAnnotation, 1, 0, data);
    processLine(line, lineIndex, PATTERNS.staticProperty, 8, MOD_STATIC, data);
    processLine(line, lineIndex, PATTERNS.decorator, 13, 0, data);

    processFunctionCalls(line, lineIndex, data);
    processMethods(line, lineIndex, data);

    // OWL-specific highlights for static template/props/components
    processOwlStaticMembers(line, lineIndex, data);
  }

  return { data };
}
