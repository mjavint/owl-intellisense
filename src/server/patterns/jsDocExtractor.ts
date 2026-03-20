export function extractJsDoc(source: string, nodeStart: number): string | undefined {
  const before = source.substring(0, nodeStart).trimEnd();
  if (!before.endsWith("*/")) {
    return undefined;
  }
  const commentStart = before.lastIndexOf("/**");
  if (commentStart === -1) {
    return undefined;
  }
  const raw = before.substring(commentStart);
  return raw
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}