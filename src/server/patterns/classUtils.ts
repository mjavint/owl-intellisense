import type { TSESTree } from "@typescript-eslint/typescript-estree";

/**
 * Returns the set of names imported from '@odoo/owl' in the given AST.
 */
export function getOwlImportedNames(ast: TSESTree.Program): Set<string> {
  const names = new Set<string>();
  for (const node of ast.body) {
    if (
      node.type === "ImportDeclaration" &&
      node.source.value === "@odoo/owl"
    ) {
      for (const specifier of node.specifiers) {
        if (
          specifier.type === "ImportSpecifier" ||
          specifier.type === "ImportDefaultSpecifier" ||
          specifier.type === "ImportNamespaceSpecifier"
        ) {
          names.add(specifier.local.name);
        }
      }
    }
  }
  return names;
}

/**
 * Returns true if the given ClassDeclaration extends OWL Component
 * (i.e., superClass is an Identifier whose name is in owlImportedNames).
 */
export function isOwlComponentClass(
  node: TSESTree.ClassDeclaration,
  owlImportedNames: Set<string>,
): boolean {
  if (!node.superClass) {
    return false;
  }
  if (node.superClass.type === "Identifier") {
    return owlImportedNames.has(node.superClass.name);
  }
  return false;
}
