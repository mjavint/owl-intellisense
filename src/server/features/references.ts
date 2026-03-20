import { Location, ReferenceParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { IComponentReader, IFunctionReader, IImportReader } from '../../shared/types';
import { OWL_HOOK_NAMES } from '../owl/catalog';

export function onReferences(
  params: ReferenceParams,
  doc: TextDocument,
  index: IComponentReader & IFunctionReader & IImportReader
): Location[] {
  const word = getWordAtPosition(doc, params.position);
  if (!word) {return [];}

  const locations: Location[] = [];

  // Component references: all declarations + all import usages
  const comp = index.getComponent(word);
  if (comp) {
    // Declaration location
    locations.push(Location.create(comp.uri, comp.range));
    // Import usages across workspace
    for (const importRec of index.getImportsForSpecifier(word)) {
      locations.push(Location.create(importRec.uri, importRec.range));
    }
  }

  // Hook usages: scan imports for the hook name
  if (OWL_HOOK_NAMES.has(word)) {
    for (const importRec of index.getImportsForSpecifier(word)) {
      locations.push(Location.create(importRec.uri, importRec.range));
    }
  }

  // Function references
  const fn = index.getFunction(word);
  if (fn) {
    locations.push(Location.create(fn.uri, fn.range));
    for (const importRec of index.getImportsForSpecifier(word)) {
      locations.push(Location.create(importRec.uri, importRec.range));
    }
  }

  return locations;
}

function getWordAtPosition(doc: TextDocument, position: { line: number; character: number }): string | null {
  const line = doc.getText({ start: { line: position.line, character: 0 }, end: { line: position.line, character: 2000 } });
  const char = position.character;
  const re = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index <= char && char <= m.index + m[0].length) {return m[0];}
  }
  return null;
}
