// FACADE: features/completion.ts re-exports everything from features/completion/index.ts
// This preserves the original import path for all consumers.
// The actual implementation has been moved to src/server/features/completion/.

export {
  onCompletion,
  onCompletionResolve,
  getSortPrefix,
  OWL_PROP_TYPE_ITEMS,
  STATIC_MEMBER_SNIPPETS,
  buildComponentDocs,
  parseJsDoc,
  jsDocToMarkdown,
  renderDocumentation,
  detectContext,
  isInsideSetupMethod,
  isInsideStaticComponents,
  isInsideStaticProps,
  isAtClassBodyLevel,
  getJsxTagComponentName,
  getEnclosingClassName,
} from "./completion/index";

export type { ParsedJSDoc } from "./completion/docs";
