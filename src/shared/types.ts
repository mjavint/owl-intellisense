import { Range } from 'vscode-languageserver-types';

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
}

export interface AddonInfo {
  name: string;         // addon name (e.g. 'web', 'mail')
  root: string;         // absolute path to addon root
  staticSrcPath: string; // absolute path to addon/static/src
}

export type AliasMap = Map<string, string>; // '@web' → '/path/to/web/static/src'

export interface OdooService {
  name: string;         // service name as registered (e.g. 'orm', 'notification')
  localName: string;    // JS identifier name
  filePath: string;
  uri: string;
  range: Range;
}

export interface OdooRegistry {
  category: string;     // e.g. 'actions', 'views', 'services'
  key: string;          // registered key
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
}

export interface ImportRecord {
  specifier: string;    // imported name
  source: string;       // from '...' value
  localName: string;    // local binding name
  uri: string;
  range: Range;
}

export interface SymbolIndexInterface {
  // existing component methods
  getComponent(name: string): OwlComponent | undefined;
  getAllComponents(): OwlComponent[];
  getComponentsInFile(uri: string): OwlComponent[];
  upsertComponent(comp: OwlComponent): void;
  removeFile(uri: string): void;
  clear(): void;

  // new
  getService(name: string): OdooService | undefined;
  getAllServices(): OdooService[];
  getRegistry(category: string, key: string): OdooRegistry | undefined;
  getRegistriesByCategory(category: string): OdooRegistry[];
  getFunction(name: string): ExportedFunction | undefined;
  getAllFunctions(): ExportedFunction[];
  getImportsInFile(uri: string): ImportRecord[];
  getImportsForSpecifier(specifier: string): ImportRecord[];
  upsertFileSymbols(uri: string, result: ParseResult): void;
}

export interface ParseResult {
  uri: string;
  components: OwlComponent[];
  services: OdooService[];
  registries: OdooRegistry[];
  functions: ExportedFunction[];
  imports: ImportRecord[];
  diagnostics: ParseDiagnostic[];
}

export interface ParseDiagnostic {
  message: string;
  line: number;
  column: number;
}

export namespace OwlNotifications {
  export const ScanStarted = 'owl/scanStarted';
  export const ScanComplete = 'owl/scanComplete';

  export interface ScanCompleteParams {
    componentCount: number;
    fileCount: number;
    durationMs: number;
  }
}
