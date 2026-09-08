/**
 * Public entry point of the transpiler (docs/ARCHITECTURE.md §4.1).
 */
import type { Diagnostic, TranspileResult } from '../types';
import { CodegenError, generate } from './codegen';
import { parse, ParseError } from './parser';

export { parse, ParseError } from './parser';
export { tokenize } from './lexer';
export { generate, CodegenError } from './codegen';

/** Compile an Arduino sketch to JavaScript. Never throws. */
export function transpile(source: string): TranspileResult {
  try {
    const program = parse(source);
    const { js, lineMap, warnings } = generate(program);
    return { ok: true, js, lineMap, warnings };
  } catch (e) {
    if (e instanceof ParseError || e instanceof CodegenError) {
      const error: Diagnostic = { line: e.line, column: e.column, message: e.message, severity: 'error' };
      return { ok: false, errors: [error], warnings: [] };
    }
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [{ line: 1, column: 1, message: `internal transpiler error: ${message}`, severity: 'error' }], warnings: [] };
  }
}
