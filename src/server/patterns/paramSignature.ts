import type { TSESTree } from "@typescript-eslint/typescript-estree";

export function getParamSignature(params: TSESTree.Parameter[]): string {
  return params
    .map((p) => {
      if (p.type === "Identifier") {
        return p.name;
      }
      if (p.type === "AssignmentPattern" && p.left.type === "Identifier") {
        return `${p.left.name}?`;
      }
      if (p.type === "RestElement" && p.argument.type === "Identifier") {
        return `...${p.argument.name}`;
      }
      return "?";
    })
    .join(", ");
}