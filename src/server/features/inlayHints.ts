import {
  InlayHint,
  InlayHintKind,
  InlayHintParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { IComponentReader, IFunctionReader } from "../../shared/types";

// PERF-03: Module-level compiled regex patterns
const RE_VAR_ASSIGN =
  /(?:const|let|var)\s+(\w+)\s*=\s*(.+?)(?:\s*;|$)/;
const RE_FUNC_DECL =
  /(?:function\s+(\w+)|(\w+)\s*=\s*(?:async\s+)?function)\s*\(([^)]*)\)/;
const RE_NUMBER_LITERAL = /^-?\d+\.?\d*$/;
const RE_ARRAY_STRING = /['"]/;
const RE_ARRAY_NUMBER = /^\d/;
const RE_JSDOC_PARAM = /@param\s+\{(\w+)\}\s+(\w+)/g;

/**
 * Infer the JS type name from a value expression string.
 * Returns null when the type cannot be determined.
 */
function inferTypeFromValue(
  value: string,
  index: IComponentReader & IFunctionReader,
): string | null {
  if (!value) {return null;}
  const v = value.trim();
  if (v.startsWith("{")) {return "object";}
  if (v.startsWith("[")) {
    if (RE_ARRAY_STRING.test(v)) {return "string[]";}
    if (RE_ARRAY_NUMBER.test(v.slice(1))) {return "number[]";}
    return "any[]";
  }
  if (v.startsWith("'") || v.startsWith('"') || v.startsWith("`"))
    {return "string";}
  if (RE_NUMBER_LITERAL.test(v)) {return "number";}
  if (v === "true" || v === "false") {return "boolean";}
  if (v.includes("=>") || v.startsWith("function")) {return "Function";}
  if (v === "null") {return "null";}
  if (v === "undefined") {return "undefined";}
  // Try symbol index as last resort
  const comp = index.getComponent(v);
  if (comp) {return comp.name;}
  const fn = index.getFunction(v);
  if (fn) {return fn.name;}
  return null;
}

/**
 * Derive a parameter type hint from naming conventions and JSDoc in the document.
 */
function getParameterType(
  paramName: string,
  documentText: string,
): string | null {
  // Scan JSDoc @param tags in the document
  RE_JSDOC_PARAM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_JSDOC_PARAM.exec(documentText)) !== null) {
    if (m[2] === paramName) {return m[1];}
  }
  // Naming-convention heuristics
  if (paramName.startsWith("on") || paramName.endsWith("Callback") || paramName.endsWith("Handler"))
    {return "Function";}
  if (paramName.endsWith("Id") || paramName.endsWith("ID")) {return "number";}
  if (paramName.endsWith("Name") || paramName.endsWith("Label")) {return "string";}
  return null;
}

export function onInlayHint(
  params: InlayHintParams,
  doc: TextDocument,
  index: IComponentReader & IFunctionReader,
): InlayHint[] {
  // Only provide hints for JavaScript files (TypeScript has its own)
  const uri = doc.uri;
  if (!uri.endsWith(".js") && !uri.endsWith(".jsx")) {return [];}

  const hints: InlayHint[] = [];
  const content = doc.getText();
  const lines = content.split("\n");
  const { start, end } = params.range;

  for (
    let lineNum = start.line;
    lineNum <= end.line && lineNum < lines.length;
    lineNum++
  ) {
    const line = lines[lineNum];
    if (!line.trim()) {continue;}

    // Hint 1: Variable type inference
    const varMatch = RE_VAR_ASSIGN.exec(line);
    if (varMatch) {
      const varName = varMatch[1];
      const value = varMatch[2];
      // Skip if line already has a type annotation
      const varNamePos = line.indexOf(varName) + varName.length;
      if (!line.substring(varNamePos).trimStart().startsWith(":")) {
        const inferredType = inferTypeFromValue(value, index);
        if (inferredType) {
          hints.push({
            label: `: ${inferredType}`,
            position: { line: lineNum, character: varNamePos },
            kind: InlayHintKind.Type,
            paddingLeft: true,
            paddingRight: false,
            tooltip: {
              kind: "markdown",
              value: `Inferred type: \`${inferredType}\``,
            },
          });
        }
      }
    }

    // Hint 2: Parameter name/type hints
    const funcMatch = RE_FUNC_DECL.exec(line);
    if (funcMatch) {
      const paramsStr = funcMatch[3];
      if (paramsStr && paramsStr.trim()) {
        let currentPos = line.indexOf("(");
        for (const param of paramsStr.split(",").map((p) => p.trim())) {
          if (!param || param.includes(":")) {
            currentPos += param.length + 1;
            continue;
          }
          const paramType = getParameterType(param, content);
          if (paramType) {
            hints.push({
              label: `: ${paramType}`,
              position: {
                line: lineNum,
                character: currentPos + param.length + 1,
              },
              kind: InlayHintKind.Parameter,
              paddingLeft: false,
              paddingRight: true,
              tooltip: {
                kind: "markdown",
                value: `Parameter type: \`${paramType}\``,
              },
            });
          }
          currentPos += param.length + 1;
        }
      }
    }
  }

  return hints;
}
