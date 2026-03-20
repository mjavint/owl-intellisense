import { Location, ReferenceParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  IComponentReader,
  IFunctionReader,
  IImportReader,
  IServiceReader,
} from '../../shared/types';
import { OWL_HOOK_NAMES } from '../owl/catalog';

// PERF-10: Bounded line read
const MAX_LINE_CHARS = 9999;

// PERF-03: Module-level compiled identifier regex
const RE_IDENTIFIER = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;

function getWordAtPosition(
  doc: TextDocument,
  position: { line: number; character: number },
): string | null {
  const line = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line, character: MAX_LINE_CHARS },
  });
  const char = position.character;
  RE_IDENTIFIER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_IDENTIFIER.exec(line)) !== null) {
    if (m.index <= char && char <= m.index + m[0].length) { return m[0]; }
  }
  return null;
}

export function onReferences(
  params: ReferenceParams,
  doc: TextDocument,
  index: IComponentReader & IFunctionReader & IImportReader & IServiceReader,
): Location[] {
  const word = getWordAtPosition(doc, params.position);
  if (!word) { return []; }

  const locations: Location[] = [];
  // PERF-02: Use Set to deduplicate by "uri|line|char" key
  const seen = new Set<string>();

  function addLoc(loc: Location): void {
    const key = `${loc.uri}|${loc.range.start.line}|${loc.range.start.character}`;
    if (!seen.has(key)) {
      seen.add(key);
      locations.push(loc);
    }
  }

  // ── Component references ────────────────────────────────────────────────────
  const comp = index.getComponent(word);
  if (comp) {
    // Declaration
    if (params.context.includeDeclaration) {
      addLoc(Location.create(comp.uri, comp.range));
    }
    // All import usages across workspace
    for (const imp of index.getImportsForSpecifier(word)) {
      addLoc(Location.create(imp.uri, imp.range));
    }
    // Also find usages in files that define the component (e.g. JSX usage)
    for (const imp of index.getImportsInFile(comp.uri)) {
      if (imp.specifier === word) {
        addLoc(Location.create(imp.uri, imp.range));
      }
    }
  }

  // ── OWL hook references ─────────────────────────────────────────────────────
  if (OWL_HOOK_NAMES.has(word)) {
    for (const imp of index.getImportsForSpecifier(word)) {
      addLoc(Location.create(imp.uri, imp.range));
    }
  }

  // ── Exported function references ────────────────────────────────────────────
  const fn = index.getFunction(word);
  if (fn) {
    if (params.context.includeDeclaration) {
      addLoc(Location.create(fn.uri, fn.range));
    }
    for (const imp of index.getImportsForSpecifier(word)) {
      addLoc(Location.create(imp.uri, imp.range));
    }
  }

  // ── Odoo service references ─────────────────────────────────────────────────
  const svc = index.getService(word);
  if (svc) {
    if (params.context.includeDeclaration) {
      addLoc(Location.create(svc.uri, svc.range));
    }
    // Services are referenced by string name in useService() calls; the import
    // record for the service definition file is the best proxy we have in the
    // current index.
    for (const imp of index.getImportsForSpecifier(word)) {
      addLoc(Location.create(imp.uri, imp.range));
    }
  }

  // ── Generic import-specifier references (catch-all) ─────────────────────────
  // For symbols not captured above (e.g. re-exported utilities, aliases)
  if (locations.length === 0) {
    for (const imp of index.getImportsForSpecifier(word)) {
      addLoc(Location.create(imp.uri, imp.range));
    }
  }

  return locations;
}
