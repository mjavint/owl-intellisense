// RequestContext: standardized context passed to all LSP feature handlers
// Centralizes: doc, index, aliasMap, connection, and injectable services

import { TextDocument } from "vscode-languageserver-textdocument";
import {
  ISymbolStore,
  AliasMap,
} from "../../shared/types";
import { TypeResolver } from "../features/typeResolver";

export interface DiagnosticsService {
  validateDocument(
    uri: string,
    content: string,
    index: ISymbolStore,
  ): import("vscode-languageserver-types").Diagnostic[];
}

export interface WorkspaceScanner {
  reparseDocument(uri: string, content: string): void;
  scheduleReparse(uri: string, content: string): void;
}

export interface RequestContext {
  /** The text document being processed (optional for workspace-wide handlers). */
  doc?: TextDocument;
  /** In-memory symbol index. */
  index: ISymbolStore;
  /** Import alias map (source → absolute path). */
  aliasMap?: AliasMap;
  /** Whether the client supports completionItem/resolve. */
  supportsResolve?: boolean;
  /** LSP connection for sending notifications. */
  connection?: {
    sendDiagnostics(params: {
      uri: string;
      diagnostics: import("vscode-languageserver-types").Diagnostic[];
    }): void;
  };
  /** Injectable services. */
  services: {
    /** Type resolution for go-to-definition fallback. */
    typeResolver: TypeResolver;
  };
}

/**
 * Creates a RequestContext from the server's shared state.
 * This factory is called by server.ts before dispatching to each handler.
 */
export function createRequestContext(
  doc: TextDocument | undefined,
  index: ISymbolStore,
  aliasMap: Map<string, string> | undefined,
  supportsResolve: boolean,
  typeResolver: TypeResolver,
  connection?: RequestContext["connection"],
): RequestContext {
  return {
    doc,
    index,
    aliasMap,
    supportsResolve,
    connection,
    services: {
      typeResolver,
    },
  };
}
