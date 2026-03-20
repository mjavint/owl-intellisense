import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getEnclosingClassName } from "./contexts";
import { SERVICE_METHODS } from "../../owl/servicesCatalog";
import {
  IComponentReader,
  IFunctionReader,
  IServiceReader,
  IRegistryReader,
  IImportReader,
  ISetupPropReader,
} from "../../../shared/types";

type FullIndex = IComponentReader & IFunctionReader & IServiceReader & IRegistryReader & IImportReader & ISetupPropReader;

interface PropertyChainContext {
  kind: "thisProperty";
  propertyChain: string[];
}

export function provideThisPropertyCompletions(
  doc: TextDocument,
  params: TextDocumentPositionParams,
  index: FullIndex,
  completionCtx: PropertyChainContext,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const chain = completionCtx.propertyChain;
  const componentName = getEnclosingClassName(doc, params.position);
  if (!componentName) {
    return items;
  }

  const setupProps = index.getSetupProps(componentName, doc.uri);
  if (!setupProps) {
    return items;
  }

  if (chain.length <= 1) {
    for (const prop of setupProps) {
      items.push({
        label: prop.name,
        kind: CompletionItemKind.Property,
        detail: prop.hookReturns
          ? `(${prop.hookName}) → ${prop.hookReturns}`
          : (prop.hookName ?? "property"),
        documentation: {
          kind: "markdown",
          value: `Defined via \`${prop.hookName ?? "assignment"}\``,
        },
        sortText: "a" + prop.name,
      });
    }
  } else {
    const rootPropName = chain[0];
    const rootProp = setupProps.find((p) => p.name === rootPropName);
    if (rootProp?.stateShape) {
      for (const [key, type] of Object.entries(rootProp.stateShape)) {
        items.push({
          label: key,
          kind: CompletionItemKind.Field,
          detail: type,
          sortText: "a" + key,
        });
      }
    }
    if (rootProp?.hookName === "useService" && rootProp.serviceArg) {
      const methods = SERVICE_METHODS[rootProp.serviceArg];
      if (methods) {
        for (const method of methods) {
          items.push({
            label: method.name,
            kind: CompletionItemKind.Method,
            detail: method.signature,
            documentation: { kind: "markdown", value: method.doc },
            sortText: "a" + method.name,
            insertText: method.snippet ?? method.name,
            insertTextFormat: method.snippet
              ? InsertTextFormat.Snippet
              : InsertTextFormat.PlainText,
          });
        }
        return items;
      }
    }
  }
  return items;
}
