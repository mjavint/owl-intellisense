// Barrel re-exports for completion contexts

// Single-pass context detection
export { detectContext } from "./contextDetector";

// Setup method detection
export { isInsideSetupMethod } from "./setupDetector";

// Static components / props detection
export { isInsideStaticComponents, isInsideStaticProps, isAtClassBodyLevel } from "./staticDetector";

// JSX and class detection
export { getJsxTagComponentName, getEnclosingClassName } from "./jsx";
