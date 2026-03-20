import { Diagnostic } from 'vscode-languageserver/node';
import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { SymbolIndex } from '../analyzer/index';
import { checkHookRules } from './rules/hookRules';
import { checkComponentRules } from './rules/componentRules';
import { checkPropsRules } from './rules/propsRules';
import { checkImportRules, checkMissingOwlImports, checkNonOwlComponentImport } from './rules/importRules';
import { getOwlImportedNames } from '../owl/patterns';

/**
 * Validates a document and returns diagnostics.
 * Delegates to rule modules under ./rules/.
 */
export function validateDocument(
  uri: string,
  content: string,
  index: SymbolIndex
): Diagnostic[] {
  let ast: TSESTree.Program;
  try {
    ast = parse(content, { jsx: true, tolerant: true, loc: true, range: true }) as TSESTree.Program;
  } catch {
    return [];
  }

  const owlImported = getOwlImportedNames(ast);

  const diagnostics: Diagnostic[] = [];

  try { diagnostics.push(...checkImportRules(ast)); }
  catch (err) { process.stderr.write(`[owl-diagnostics] checkImportRules error for ${uri}: ${err}\n`); }

  try { diagnostics.push(...checkNonOwlComponentImport(ast)); }
  catch (err) { process.stderr.write(`[owl-diagnostics] checkNonOwlComponentImport error for ${uri}: ${err}\n`); }

  try { diagnostics.push(...checkMissingOwlImports(ast, owlImported)); }
  catch (err) { process.stderr.write(`[owl-diagnostics] checkMissingOwlImports error for ${uri}: ${err}\n`); }

  try { diagnostics.push(...checkComponentRules(ast)); }
  catch (err) { process.stderr.write(`[owl-diagnostics] checkComponentRules error for ${uri}: ${err}\n`); }

  try { diagnostics.push(...checkHookRules(ast)); }
  catch (err) { process.stderr.write(`[owl-diagnostics] checkHookRules error for ${uri}: ${err}\n`); }

  try { diagnostics.push(...checkPropsRules(ast, index)); }
  catch (err) { process.stderr.write(`[owl-diagnostics] checkPropsRules error for ${uri}: ${err}\n`); }

  return diagnostics;
}
