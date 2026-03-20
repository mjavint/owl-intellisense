import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getJsxTagComponentName } from "./contexts";
import {
  IComponentReader,
  IFunctionReader,
  IServiceReader,
  IRegistryReader,
  IImportReader,
  ISetupPropReader,
} from "../../../shared/types";

type FullIndex = IComponentReader & IFunctionReader & IServiceReader & IRegistryReader & IImportReader & ISetupPropReader;

export function provideJsxPropCompletions(
  doc: TextDocument,
  index: FullIndex,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const jsxCompName = getJsxTagComponentName(doc, { textDocument: { uri: doc.uri }, position: { character: 0, line: 0 } });
  if (!jsxCompName) {
    return items;
  }
  const comp = index.getComponent(jsxCompName);
  if (!comp || Object.keys(comp.props).length === 0) {
    return items;
  }
  for (const [propName, propDef] of Object.entries(comp.props)) {
    const requiredLabel = propDef.optional ? "_(optional)_" : "**required**";
    items.push({
      label: propName,
      kind: CompletionItemKind.Property,
      detail: `${propName}: ${propDef.type}${propDef.optional ? "?" : ""}`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: [
          `**${propName}** — prop of \`${jsxCompName}\``,
          "",
          `**Type:** \`${propDef.type}\``,
          `**Required:** ${requiredLabel}`,
          propDef.validate ? "**Has validation function**" : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      insertText: `${propName}=`,
      insertTextFormat: InsertTextFormat.PlainText,
      sortText: (propDef.optional ? "b" : "a") + propName,
    });
  }
  return items;
}
