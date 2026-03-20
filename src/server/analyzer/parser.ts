import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/typescript-estree";
import { fileURLToPath } from "url";
import { OwlComponent, ParseResult } from "../../shared/types";
import {
  getOwlImportedNames,
  isOwlComponentClass,
  extractStaticProps,
  extractTemplateRef,
  toRange,
  extractImports,
  extractServices,
  extractRegistries,
  extractExportedFunctions,
  extractSetupProperties,
} from "../owl/patterns";

export function parseFile(content: string, uri: string): ParseResult {
  let filePath: string;
  try {
    filePath = fileURLToPath(uri);
  } catch {
    filePath = uri;
  }

  const empty: ParseResult = {
    uri,
    components: [],
    services: [],
    registries: [],
    functions: [],
    imports: [],
    diagnostics: [],
  };

  let ast: TSESTree.Program;
  try {
    ast = parse(content, {
      jsx: true,
      tolerant: true,
      loc: true,
      range: true,
      comment: false,
    }) as TSESTree.Program;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    empty.diagnostics.push({
      message: `Parse error: ${msg}`,
      line: 0,
      column: 0,
    });
    return empty;
  }

  const owlNames = getOwlImportedNames(ast);
  const components: OwlComponent[] = [];
  const componentClassNodes = new Map<string, TSESTree.ClassDeclaration>();

  for (const node of ast.body) {
    let classNode: TSESTree.ClassDeclaration | null = null;

    if (node.type === "ClassDeclaration") {
      classNode = node;
    } else if (
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "ClassDeclaration"
    ) {
      classNode = node.declaration;
    } else if (
      node.type === "ExportDefaultDeclaration" &&
      node.declaration?.type === "ClassDeclaration"
    ) {
      classNode = node.declaration;
    }

    if (!classNode || !classNode.id) {
      continue;
    }
    if (!isOwlComponentClass(classNode, owlNames)) {
      continue;
    }

    components.push({
      name: classNode.id.name,
      filePath,
      uri,
      range: toRange(classNode.loc!),
      props: extractStaticProps(classNode),
      templateRef: extractTemplateRef(classNode),
      importPath: filePath,
    });
    componentClassNodes.set(classNode.id.name, classNode);
  }

  const setupProps = components.map((comp) => ({
    componentName: comp.name,
    uri,
    props: extractSetupProperties(componentClassNodes.get(comp.name) ?? ast),
  }));

  return {
    uri,
    components,
    services: extractServices(ast, uri, filePath),
    registries: extractRegistries(ast, uri, filePath),
    functions: extractExportedFunctions(ast, uri, filePath, content),
    imports: extractImports(ast, uri),
    diagnostics: [],
    setupProps,
  };
}


