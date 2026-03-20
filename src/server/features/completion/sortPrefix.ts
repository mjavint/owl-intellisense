// Sort prefix helper for completion items
import { isSpecifierImported } from "../../utils/importUtils";

/**
 * Determine sort prefix for completion items based on import status and type.
 */
export function getSortPrefix(
  name: string,
  docText: string,
  isOwlBuiltin: boolean,
): "a" | "b" | "c" | "z" {
  if (isSpecifierImported(docText, name)) {
    return "a";
  }
  if (isOwlBuiltin) {
    return "c";
  }
  if (name.length > 0) {
    return "b";
  }
  return "z";
}
