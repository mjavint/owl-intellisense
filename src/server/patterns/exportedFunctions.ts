import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { ExportedFunction } from "../../shared/types";
import { toRange } from "./serviceExtractor";
import { getParamSignature } from "./paramSignature";
import { extractJsDoc } from "./jsDocExtractor";

export function extractExportedFunctions(
  ast: TSESTree.Program,
  uri: string,
  filePath: string,
  source?: string,
  _visited?: Set<string>,
): ExportedFunction[] {
  const fns: ExportedFunction[] = [];
  const visited = _visited ?? new Set<string>([filePath]);

  for (const node of ast.body) {
    if (
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "FunctionDeclaration" &&
      node.declaration.id
    ) {
      const n = node as TSESTree.ExportNamedDeclaration & {
        declaration: TSESTree.FunctionDeclaration;
      };
      const name = n.declaration.id!.name;
      const sig = `${name}(${getParamSignature(n.declaration.params)})`;
      const jsDoc = source ? extractJsDoc(source, node.range![0]) : undefined;
      fns.push({
        name,
        filePath,
        uri,
        range: toRange(node.loc!),
        isDefault: false,
        signature: sig,
        jsDoc,
      });
    }
    if (
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "VariableDeclaration"
    ) {
      for (const decl of (
        node as TSESTree.ExportNamedDeclaration & {
          declaration: TSESTree.VariableDeclaration;
        }
      ).declaration.declarations) {
        if (decl.id.type !== "Identifier") {
          continue;
        }
        const isFunc =
          decl.init?.type === "ArrowFunctionExpression" ||
          decl.init?.type === "FunctionExpression";
        if (isFunc) {
          const name = (decl.id as TSESTree.Identifier).name;
          const initNode = decl.init as
            | TSESTree.ArrowFunctionExpression
            | TSESTree.FunctionExpression;
          const sig = `${name}(${getParamSignature(initNode.params)})`;
          const jsDoc = source
            ? extractJsDoc(source, node.range![0])
            : undefined;
          fns.push({
            name,
            filePath,
            uri,
            range: toRange(decl.loc!),
            isDefault: false,
            signature: sig,
            jsDoc,
          });
        } else {
          const name = (decl.id as TSESTree.Identifier).name;
          const jsDoc = source
            ? extractJsDoc(source, decl.range?.[0] ?? 0)
            : undefined;
          fns.push({
            name,
            filePath,
            uri,
            range: toRange(decl.loc!),
            isDefault: false,
            signature: `const ${name}`,
            jsDoc,
            isCallable: false,
          });
        }
      }
    }
    if (
      node.type === "ExportNamedDeclaration" &&
      !node.declaration &&
      node.specifiers.length > 0
    ) {
      for (const spec of node.specifiers) {
        if (spec.type !== "ExportSpecifier") {
          continue;
        }
        const exportedName =
          spec.exported.type === "Identifier"
            ? spec.exported.name
            : (spec.exported as { value: string }).value;
        fns.push({
          name: exportedName,
          filePath,
          uri,
          range: toRange(spec.loc!),
          isDefault: false,
          signature: exportedName,
        });
      }
    }
    if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration;
      if (decl.type === "FunctionDeclaration" && decl.id) {
        const name = decl.id.name;
        const sig = `${name}(${getParamSignature(decl.params)})`;
        const jsDoc = source ? extractJsDoc(source, node.range![0]) : undefined;
        fns.push({
          name,
          filePath,
          uri,
          range: toRange(node.loc!),
          isDefault: true,
          signature: sig,
          jsDoc,
        });
      }
    }
    if (node.type === "ExportAllDeclaration" && node.source) {
      const sourceFile = path.resolve(
        path.dirname(filePath),
        node.source.value as string,
      );
      if (!visited.has(sourceFile) && fs.existsSync(sourceFile)) {
        visited.add(sourceFile);
        try {
          const srcContent = fs.readFileSync(sourceFile, "utf-8");
          const srcAst = parse(srcContent, {
            jsx: true,
            tolerant: true,
            loc: true,
          }) as TSESTree.Program;
          const srcUri = pathToFileURL(sourceFile).toString();
          const reExported = extractExportedFunctions(
            srcAst,
            srcUri,
            sourceFile,
            srcContent,
            visited,
          );
          fns.push(...reExported);
        } catch {
          /* unparseable bundle — definition.ts findSymbolPositionInFile handles these */
        }
      }
    }
  }

  return fns;
}