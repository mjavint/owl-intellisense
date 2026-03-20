// FACADE: owl/patterns.ts re-exports everything from src/server/patterns/
// This preserves the original import path for all consumers.
// The actual implementation has been split into src/server/patterns/.

export {
  extractServices,
  parseAst,
  walkAst,
  toRange,
} from "../patterns/serviceExtractor";

export { extractRegistries } from "../patterns/registryExtractor";

export {
  extractSetupProperties,
  HOOK_RETURN_TYPES,
} from "../patterns/setupPropsExtractor";

export {
  extractExportedFunctions,
  getCursorContext,
  type CursorContext,
} from "../patterns/setupMethodsExtractor";

export { getOwlImportedNames, isOwlComponentClass } from "../patterns/classUtils";

export { extractStaticProps, extractTemplateRef } from "../patterns/classPropsExtractor";

export { extractImports, toRange as importToRange } from "../patterns/importExtractor";

// Re-export shared regex constants
export {
  RE_USE_SERVICE_OPEN,
  RE_REGISTRY_CATEGORY_OPEN,
  RE_STATIC_PROPS_BLOCK,
} from "../shared/constants";

// Keep legacy module-level cache for backward compatibility
export { getCachedRegex } from "../shared/constants";
