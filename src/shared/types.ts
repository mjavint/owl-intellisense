import { Range } from "vscode-languageserver-types";

// ─── PERF-01: Completion context discriminated union ─────────────────────────

export type CompletionContext =
  | { kind: "setup"; componentName: string }
  | { kind: "staticComponents" }
  | { kind: "thisProperty"; propertyChain: string[] }
  | { kind: "useService"; serviceClass: string | null }
  | { kind: "registryKey"; category: string; partial: string }
  | { kind: "unknown" };

// ─── PERF-02: Completion item data payload ────────────────────────────────────

export interface CompletionItemData {
  specifierName: string;
  documentUri: string;
  position: { line: number; character: number };
  modulePath: string; // source module for the import
}

export interface PropDef {
  type: string;
  optional: boolean;
  validate: boolean;
}

export interface OwlComponent {
  name: string;
  filePath: string;
  uri: string;
  range: Range;
  props: Record<string, PropDef>;
  templateRef?: string;
  importPath: string;
}

export interface OWLHook {
  name: string;
  signature: string;
  description: string;
  returns?: string;
  completionSnippet?: string;
  isLifecycle: boolean;
  importSource?: string;
}

export interface AddonInfo {
  name: string; // addon name (e.g. 'web', 'mail')
  root: string; // absolute path to addon root
  staticSrcPath: string; // absolute path to addon/static/src
}

export type AliasMap = Map<string, string>; // '@web' → '/path/to/web/static/src'

export interface OdooService {
  name: string; // service name as registered (e.g. 'orm', 'notification')
  localName: string; // JS identifier name
  filePath: string;
  uri: string;
  range: Range;
}

export interface OdooRegistry {
  category: string; // e.g. 'actions', 'views', 'services'
  key: string; // registered key
  localName: string;
  filePath: string;
  uri: string;
  range: Range;
}

export interface ExportedFunction {
  name: string;
  filePath: string;
  uri: string;
  range: Range;
  isDefault: boolean;
  signature?: string;
  jsDoc?: string;
  isCallable?: boolean;
}

export interface ImportRecord {
  specifier: string; // imported name
  source: string; // from '...' value
  localName: string; // local binding name
  uri: string;
  range: Range;
}

/**
 * Represents a single property assignment inside a setup() method body.
 * e.g. `this.myState = useState({})` produces:
 *   { name: 'myState', hookName: 'useState', hookReturns: 'T' }
 */
export interface SetupPropertyAssignment {
  name: string; // property name (this.XXX)
  hookName?: string; // hook function called on the RHS (if any)
  hookReturns?: string; // return-type string from HOOK_RETURN_TYPES (if hookName is known)
  stateShape?: Record<string, string>; // key→type map for useState({...}) initial object
  serviceArg?: string; // 'orm', 'rpc', etc. when hookName === 'useService'
}

/**
 * Associates a component's name and URI with the setup property assignments
 * extracted from its setup() method body.
 */
export interface SetupPropsResult {
  componentName: string;
  uri: string;
  props: SetupPropertyAssignment[];
}

// ─── SOLID ISP: Narrow read interfaces ──────────────────────────────────────

export interface IComponentReader {
  getComponent(name: string): OwlComponent | undefined;
  getAllComponents(): IterableIterator<OwlComponent>;
  getComponentsInFile(uri: string): OwlComponent[];
}

export interface IFunctionReader {
  getFunction(name: string): ExportedFunction | undefined;
  getAllFunctions(): IterableIterator<ExportedFunction>;
  registerSourceAlias(source: string, fileUri: string): void;
  getSourceAliasUris(source: string): string[];
  getFunctionBySource(
    source: string,
    name: string,
  ): ExportedFunction | undefined;
}

export interface IServiceReader {
  getService(name: string): OdooService | undefined;
  getAllServices(): IterableIterator<OdooService>;
}

export interface IRegistryReader {
  getRegistry(category: string, key: string): OdooRegistry | undefined;
  getRegistriesByCategory(category: string): OdooRegistry[];
  getAllRegistryCategories(): string[];
}

export interface IImportReader {
  getImportsInFile(uri: string): ImportRecord[];
  getImportsForSpecifier(specifier: string): ImportRecord[];
}

export interface ISetupPropReader {
  getSetupProps(
    componentName: string,
    uri: string,
  ): SetupPropertyAssignment[] | undefined;
}

/**
 * Full store interface: union of all narrow interfaces plus write operations.
 * Used by server.ts, scanner.ts, and WorkspaceScanner — anything that writes to the index.
 */
export type ISymbolStore = IComponentReader &
  IFunctionReader &
  IServiceReader &
  IRegistryReader &
  IImportReader &
  ISetupPropReader & {
    upsertFileSymbols(uri: string, result: ParseResult): void;
    upsertSetupProps(
      componentName: string,
      uri: string,
      props: SetupPropertyAssignment[],
    ): void;
    removeFile(uri: string): void;
    clear(): void;
  };

/** @deprecated Use ISymbolStore or the specific narrow interfaces instead. */
export type SymbolIndexInterface = ISymbolStore;

export interface ParseResult {
  uri: string;
  components: OwlComponent[];
  services: OdooService[];
  registries: OdooRegistry[];
  functions: ExportedFunction[];
  imports: ImportRecord[];
  diagnostics: ParseDiagnostic[];
  setupProps?: SetupPropsResult[];
}

export interface ParseDiagnostic {
  message: string;
  line: number;
  column: number;
}

export namespace OwlNotifications {
  export const ScanStarted = "owl/scanStarted";
  export const ScanProgress = "owl/scanProgress";
  export const ScanComplete = "owl/scanComplete";

  export interface ScanProgressParams {
    scannedFiles: number;
    totalFiles: number;
    componentCount: number;
    serviceCount: number;
    functionCount: number;
  }

  export interface ScanCompleteParams {
    componentCount: number;
    serviceCount: number;
    functionCount: number;
    fileCount: number;
    durationMs: number;
  }
}
