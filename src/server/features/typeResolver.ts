import * as fs from "fs";
import * as path from "path";

/**
 * Represents a TypeScript type definition parsed from a .d.ts file.
 */
export interface TypeDefinition {
  name: string;
  kind: "class" | "interface" | "type" | "function" | "const" | "enum";
  members: TypeMember[];
  extends?: string[];
  typeParameters?: string[];
  signature?: string;
  documentation?: string;
  filePath: string;
}

/**
 * Represents a member (property or method) of a type definition.
 */
export interface TypeMember {
  name: string;
  type: string;
  kind: "property" | "method" | "getter" | "setter";
  optional: boolean;
  readonly: boolean;
  static: boolean;
  parameters?: TypeParameter[];
  returnType?: string;
  documentation?: string;
}

/**
 * Represents a parameter in a function/method signature.
 */
export interface TypeParameter {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
}

// ─── PERF-03: Module-level compiled regex patterns ────────────────────────────

const PATTERNS = {
  declareClass:
    /declare\s+class\s+(\w+)(?:<([^>]+)>)?(?:\s+extends\s+([\w<>,\s]+))?/,
  declareInterface:
    /(?:export\s+)?interface\s+(\w+)(?:<([^>]+)>)?(?:\s+extends\s+([\w<>,\s]+))?/,
  declareFunction:
    /declare\s+function\s+(\w+)(?:<([^>]+)>)?\s*\(([^)]*)\)\s*:\s*([^;{]+)/,
  declareConst: /declare\s+const\s+(\w+)\s*:\s*([^;]+)/,
  declareType:
    /(?:export\s+)?type\s+(\w+)(?:<([^>]+)>)?\s*=\s*([^;]+)/,
  property: /^\s*(readonly\s+)?(static\s+)?(\w+)(\?)?:\s*([^;]+)/,
  method:
    /^\s*(static\s+)?(\w+)(?:<([^>]+)>)?\s*\(([^)]*)\)\s*:\s*([^;{]+)/,
  parameter: /(\w+)(\?)?:\s*([^,)]+)(?:\s*=\s*([^,)]+))?/,
  importDecl:
    /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/,
  varDecl:
    /(?:const|let|var)\s+(\w+)\s*(?::\s*(\w+(?:<[^>]+>)?))?(?:\s*=\s*(.+))?/,
};

// ─── TypeResolver ─────────────────────────────────────────────────────────────

/**
 * Parses .d.ts files and provides type member lookups for definition resolution.
 *
 * Used as a fallback in `onDefinition` when no workspace symbol is found:
 * given an identifier, TypeResolver can locate which .d.ts member it corresponds
 * to and return its file location.
 */
export class TypeResolver {
  private readonly typeDefinitions: Map<string, TypeDefinition> = new Map();

  // ─── Public API ───────────────────────────────────────────────────────

  /**
   * Load and parse all type definitions from a .d.ts file into the cache.
   * Safe to call multiple times; definitions are merged.
   */
  async loadTypeDefinitions(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {return;}
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      for (const def of parseTypeDefinitions(content, filePath)) {
        this.typeDefinitions.set(def.name, def);
      }
    } catch {
      // Ignore unreadable files
    }
  }

  /**
   * Returns the definition for a type name, or undefined if not found.
   */
  getTypeDefinition(typeName: string): TypeDefinition | undefined {
    return this.typeDefinitions.get(typeName);
  }

  /**
   * Returns all members of a type, including inherited ones (follows `extends`).
   */
  getTypeMembers(typeName: string): TypeMember[] {
    const def = this.getTypeDefinition(typeName);
    if (!def) {return [];}
    const members = [...def.members];
    if (def.extends) {
      for (const parent of def.extends) {
        members.push(...this.getTypeMembers(cleanTypeName(parent)));
      }
    }
    return members;
  }

  /**
   * Returns all loaded definitions.
   */
  getAllTypeDefinitions(): TypeDefinition[] {
    return Array.from(this.typeDefinitions.values());
  }

  /**
   * Returns true if the cache has any definitions loaded.
   */
  hasDefinitions(): boolean {
    return this.typeDefinitions.size > 0;
  }

  /**
   * Find the file path and approximate line for a named member of a type.
   * Returns null if not found.
   */
  findMemberLocation(
    typeName: string,
    memberName: string,
  ): { filePath: string; line: number } | null {
    const def = this.getTypeDefinition(typeName);
    if (!def) {return null;}
    const member = def.members.find((m) => m.name === memberName);
    if (!member) {
      // Check inherited types
      if (def.extends) {
        for (const parent of def.extends) {
          const result = this.findMemberLocation(
            cleanTypeName(parent),
            memberName,
          );
          if (result) {return result;}
        }
      }
      return null;
    }
    return { filePath: def.filePath, line: 0 };
  }

  /**
   * Infer the type string of an expression in a simple context.
   * Handles literals, variable context (passed in as varTypes), member access,
   * and `new` expressions.
   */
  inferType(
    expression: string,
    varTypes: Map<string, string>,
  ): string | null {
    const expr = expression.trim();
    if (varTypes.has(expr)) {return varTypes.get(expr)!;}
    if (expr.includes(".")) {return this.inferMemberAccessType(expr, varTypes);}
    if (expr.startsWith('"') || expr.startsWith("'") || expr.startsWith("`"))
      {return "string";}
    if (/^\d+$/.test(expr)) {return "number";}
    if (expr === "true" || expr === "false") {return "boolean";}
    if (expr === "null") {return "null";}
    if (expr === "undefined") {return "undefined";}
    if (expr.startsWith("[")) {return "Array";}
    if (expr.startsWith("{")) {return "object";}
    if (expr.startsWith("new ")) {
      return expr.substring(4).split("(")[0].trim();
    }
    return null;
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  private inferMemberAccessType(
    expression: string,
    varTypes: Map<string, string>,
  ): string | null {
    const parts = expression.split(".");
    if (parts.length === 0) {return null;}
    let current = this.inferType(parts[0], varTypes);
    if (!current) {return null;}
    for (let i = 1; i < parts.length; i++) {
      const memberName = parts[i].split("(")[0].trim();
      const members = this.getTypeMembers(cleanTypeName(current));
      const member = members.find((m) => m.name === memberName);
      if (!member) {return null;}
      current = parts[i].includes("(")
        ? member.returnType ?? member.type
        : member.type;
    }
    return current;
  }
}

// ─── Pure parsing helpers (module-level, no state) ───────────────────────────

function cleanTypeName(typeName: string): string {
  const idx = typeName.indexOf("<");
  return idx > 0 ? typeName.substring(0, idx).trim() : typeName.trim();
}

function splitParameters(params: string): string[] {
  const result: string[] = [];
  let current = "";
  let angle = 0, square = 0, curly = 0;
  for (const ch of params) {
    if (ch === "<") {angle++;}
    if (ch === ">") {angle--;}
    if (ch === "[") {square++;}
    if (ch === "]") {square--;}
    if (ch === "{") {curly++;}
    if (ch === "}") {curly--;}
    if (ch === "," && angle === 0 && square === 0 && curly === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {result.push(current.trim());}
  return result;
}

function parseParameters(paramsStr: string): TypeParameter[] {
  if (!paramsStr.trim()) {return [];}
  const result: TypeParameter[] = [];
  for (const part of splitParameters(paramsStr)) {
    const m = PATTERNS.parameter.exec(part.trim());
    if (!m) {continue;}
    result.push({
      name: m[1],
      type: m[3].trim(),
      optional: !!m[2],
      defaultValue: m[4]?.trim(),
    });
  }
  return result;
}

function extractJsDocAbove(
  lines: string[],
  lineIndex: number,
): string | undefined {
  let i = lineIndex - 1;
  const jsDocLines: string[] = [];
  let inJsDoc = false;
  while (i >= 0) {
    const line = lines[i].trim();
    if (line === "*/") {
      inJsDoc = true;
      i--;
      continue;
    }
    if (inJsDoc) {
      if (line.startsWith("/**")) {break;}
      const cleaned = line.replace(/^\s*\*\s?/, "");
      if (cleaned) {jsDocLines.unshift(cleaned);}
    } else {
      if (line && !line.startsWith("//")) {break;}
    }
    i--;
  }
  return jsDocLines.length > 0 ? jsDocLines.join(" ") : undefined;
}

function parseClassOrInterface(
  lines: string[],
  startIndex: number,
  kind: "class" | "interface",
  match: RegExpExecArray,
  filePath: string,
): (TypeDefinition & { endLine?: number }) | null {
  const name = match[1];
  const typeParams = match[2];
  const extendsClause = match[3];
  const members: TypeMember[] = [];
  const typeParameters = typeParams
    ? typeParams.split(",").map((t) => t.trim())
    : undefined;
  const extendsTypes = extendsClause
    ? extendsClause.split(",").map((t) => t.trim())
    : undefined;

  let i = startIndex;
  let braceDepth = 0;
  let foundOpenBrace = false;

  while (i < lines.length && !foundOpenBrace) {
    const line = lines[i];
    if (line.includes("{")) {
      foundOpenBrace = true;
      braceDepth =
        (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    }
    i++;
  }
  if (!foundOpenBrace) {return null;}

  while (i < lines.length && braceDepth > 0) {
    const line = lines[i];
    const trimmed = line.trim();
    braceDepth +=
      (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    if (braceDepth === 0) {break;}
    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    ) {
      i++;
      continue;
    }

    const methodMatch = PATTERNS.method.exec(trimmed);
    if (methodMatch) {
      const isStatic = !!methodMatch[1];
      const memberName = methodMatch[2];
      const paramsStr = methodMatch[4];
      const returnType = methodMatch[5].trim();
      members.push({
        name: memberName,
        type: returnType,
        kind: "method",
        optional: false,
        readonly: false,
        static: isStatic,
        parameters: parseParameters(paramsStr),
        returnType,
        documentation: extractJsDocAbove(lines, i),
      });
      i++;
      continue;
    }

    const propertyMatch = PATTERNS.property.exec(trimmed);
    if (propertyMatch) {
      members.push({
        name: propertyMatch[3],
        type: propertyMatch[5].trim(),
        kind: "property",
        optional: !!propertyMatch[4],
        readonly: !!propertyMatch[1],
        static: !!propertyMatch[2],
        documentation: extractJsDocAbove(lines, i),
      });
    }

    i++;
  }

  return {
    name,
    kind,
    members,
    extends: extendsTypes,
    typeParameters,
    filePath,
    documentation: extractJsDocAbove(lines, startIndex),
    endLine: i,
  };
}

function parseTypeDefinitions(
  content: string,
  filePath: string,
): TypeDefinition[] {
  const definitions: TypeDefinition[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line.startsWith("//") || line.startsWith("/*")) {
      i++;
      continue;
    }

    const classMatch = PATTERNS.declareClass.exec(line);
    if (classMatch) {
      const def = parseClassOrInterface(lines, i, "class", classMatch, filePath);
      if (def) {
        definitions.push(def);
        i = (def as TypeDefinition & { endLine?: number }).endLine ?? i + 1;
        continue;
      }
    }

    const interfaceMatch = PATTERNS.declareInterface.exec(line);
    if (interfaceMatch) {
      const def = parseClassOrInterface(
        lines,
        i,
        "interface",
        interfaceMatch,
        filePath,
      );
      if (def) {
        definitions.push(def);
        i = (def as TypeDefinition & { endLine?: number }).endLine ?? i + 1;
        continue;
      }
    }

    const functionMatch = PATTERNS.declareFunction.exec(line);
    if (functionMatch) {
      definitions.push({
        name: functionMatch[1],
        kind: "function",
        members: [],
        signature: line,
        filePath,
        documentation: extractJsDocAbove(lines, i),
      });
    }

    const typeMatch = PATTERNS.declareType.exec(line);
    if (typeMatch) {
      definitions.push({
        name: typeMatch[1],
        kind: "type",
        members: [],
        signature: line,
        typeParameters: typeMatch[2]
          ? typeMatch[2].split(",").map((t) => t.trim())
          : undefined,
        filePath,
        documentation: extractJsDocAbove(lines, i),
      });
    }

    i++;
  }

  return definitions;
}
