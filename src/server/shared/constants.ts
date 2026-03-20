// ─── PERF-03: Module-level regex cache ────────────────────────────────────────

const reCache = new Map<string, RegExp>();

/**
 * Returns a cached RegExp for the given pattern+flags, compiling once per unique key.
 * Used by both completion.ts and patterns.ts for consistent regex caching.
 */
export function getCachedRegex(pattern: string, flags = ""): RegExp {
  const key = `${flags}:${pattern}`;
  let re = reCache.get(key);
  if (!re) {
    re = new RegExp(pattern, flags);
    reCache.set(key, re);
  }
  return re;
}

// ─── Service / Registry completion patterns ───────────────────────────────────

/**
 * Matches text like `useService('` or `useService("` at the end of a string,
 * indicating the cursor is inside the string argument of useService().
 */
export const RE_USE_SERVICE_OPEN = /useService\(\s*['"][^'"]*$/;

/**
 * Matches text like `registry.category('` or `registry.category("` at end of string,
 * indicating the cursor is inside the string argument of registry.category().
 */
export const RE_REGISTRY_CATEGORY_OPEN = /registry\.category\(\s*['"][^'"]*$/;

/**
 * Matches `static props =` anywhere in the text before the cursor,
 * used to detect cursor position inside the static props block.
 */
export const RE_STATIC_PROPS_BLOCK = /static\s+props\s*=/;
