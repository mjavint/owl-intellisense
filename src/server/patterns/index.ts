// Patterns module barrel export
// Re-exports all pattern extraction functions from split sub-modules

export { extractServices, parseAst, walkAst, toRange } from "./serviceExtractor";
export { extractRegistries } from "./registryExtractor";
export {
  extractSetupProperties,
  HOOK_RETURN_TYPES,
} from "./setupPropsExtractor";
export {
  extractExportedFunctions,
  getCursorContext,
  type CursorContext,
} from "./setupMethodsExtractor";

// ─── Class body utilities (kept in-patterns, small enough to not warrant split) ─

export { getOwlImportedNames, isOwlComponentClass } from "./classUtils";
export { extractStaticProps, extractTemplateRef } from "./classPropsExtractor";
export { extractImports, toRange as importToRange } from "./importExtractor";
