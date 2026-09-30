/**
 * `pythonToArduino` (docs/PYTHON.md §4.1): a Python program → an Arduino sketch, its source map
 * and the diagnostics. Never throws (X-internal).
 *
 * normalize → tokenize → parse: a syntax or indentation error (§5.1) comes back as its
 * diagnostic, with the T9 placeholder (§4.10), and a program over 50,000 bytes is X-too-long
 * (§4.11). Then `analyze()`: resolve → flow → infer → check, with every name, kind, ZERO1-limit
 * and board-limit diagnostic (§5.2–§5.5, §5.7); a program with errors gets the placeholder with
 * its error count. A program without errors goes to the emitter (emit.ts, §4.7): its sketch, the
 * source map and the warnings; a sketch over 50,000 bytes is X-sketch-too-long (§4.11).
 */
import { pythonPlaceholder } from '../sketch/placeholder';
import type { Module } from './ast';
import { check } from './check';
import { emit } from './emit';
import { analyzeFlow, type Flow } from './flow';
import type { PythonDiagnostic, PythonTranslation } from './index';
import { infer, type Typing } from './kinds';
import { message } from './messages';
import { parse } from './parser';
import { resolve, type Resolved } from './scope';
import { SourceMap } from './sourcemap';
import { PythonSyntaxError, normalize, tokenize } from './tokens';

/** The largest program the translator reads (§4.11), in UTF-8 bytes. */
export const MAX_PYTHON_BYTES = 50_000;

/** At most this many errors are listed (§4.2); X-too-many says how many more there are. */
export const MAX_ERRORS = 20;

/** A checked, typed program: what the emitter works from (`emit(resolved, flow, typing)`, §4.2). */
export interface Analysis {
  resolved: Resolved;
  flow: Flow;
  typing: Typing;
  /** Errors first, then warnings (only when there is no error, §4.6); each group by position; errors cut at 20 + X-too-many. */
  diagnostics: PythonDiagnostic[];
  /** Every error found (the placeholder's count; `diagnostics` lists at most 20 of them). */
  errorCount: number;
}

/** resolve → flow → infer → check over a parsed program; `source` is its normalised text. */
export function analyze(module: Module, source: string): Analysis {
  const resolved = resolve(module, source);
  const flow = analyzeFlow(resolved);
  const typing = infer(resolved, flow);
  const found = check(resolved, flow, typing);
  const byPosition = (a: PythonDiagnostic, b: PythonDiagnostic) => a.line - b.line || a.column - b.column;
  const errors = found.filter((d) => d.severity === 'error').sort(byPosition);
  const warnings = errors.length > 0 ? [] : found.filter((d) => d.severity === 'warning').sort(byPosition);
  const listed = errors.slice(0, MAX_ERRORS);
  if (errors.length > MAX_ERRORS) {
    const next = errors[MAX_ERRORS];
    listed.push({ code: 'X-too-many', severity: 'error', line: next.line, column: next.column, endLine: next.endLine, endColumn: next.endColumn, message: message('X-too-many', { count: errors.length - MAX_ERRORS }) });
  }
  return { resolved, flow, typing, diagnostics: [...listed, ...warnings], errorCount: errors.length };
}

/** The largest sketch that can be handed in (§4.11, the hand-in's `codeMaxBytes`), in UTF-8 bytes. */
export const MAX_SKETCH_BYTES = 50_000;

/** 61234 → "61,234". */
function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ',');
}

export function pythonToArduino(source: string): PythonTranslation {
  try {
    const text = normalize(source);
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_PYTHON_BYTES) {
      return failed({ code: 'X-too-long', line: 1, column: 1, severity: 'error', message: message('X-too-long', { bytes: withCommas(bytes) }) });
    }
    let module: Module;
    try {
      module = parse(tokenize(text));
    } catch (err) {
      if (err instanceof PythonSyntaxError) return failed(syntaxDiagnostic(err));
      throw err;
    }
    const analysis = analyze(module, text);
    if (analysis.errorCount > 0) return failed(analysis.diagnostics, analysis.errorCount);
    const { sketch, map } = emit(analysis.resolved, analysis.flow, analysis.typing);
    const sketchBytes = new TextEncoder().encode(sketch).length;
    if (sketchBytes > MAX_SKETCH_BYTES) {
      return failed({ code: 'X-sketch-too-long', line: 1, column: 1, severity: 'error', message: message('X-sketch-too-long', { bytes: withCommas(sketchBytes) }) });
    }
    return { ok: true, sketch, map, diagnostics: analysis.diagnostics, endsAfterSetup: analysis.resolved.endsAfterSetup, usesInput: analysis.resolved.usesInput };
  } catch (err) {
    return notTranslated(err instanceof Error ? err.message : String(err));
  }
}

/** A syntax or indentation error (§5.1) as the diagnostic of the Python editor. */
export function syntaxDiagnostic(err: PythonSyntaxError): PythonDiagnostic {
  return {
    code: err.code,
    line: err.line,
    column: err.column,
    endLine: err.endLine,
    endColumn: err.endColumn,
    severity: 'error',
    message: err.message,
  };
}

/** The T9 placeholder with one X-internal error on line 1. */
function notTranslated(reason: string): PythonTranslation {
  return failed({ code: 'X-internal', line: 1, column: 1, severity: 'error', message: message('X-internal', { error: reason }) });
}

/** The T9 placeholder for `errorCount` errors (one when a single diagnostic is given). */
function failed(diagnostics: PythonDiagnostic | PythonDiagnostic[], errorCount = 1): PythonTranslation {
  const list = Array.isArray(diagnostics) ? diagnostics : [diagnostics];
  const sketch = pythonPlaceholder(errorCount);
  return {
    ok: false,
    sketch,
    map: new SourceMap(sketch.replace(/\n$/, '').split('\n').map(() => 0)),
    diagnostics: list,
    endsAfterSetup: false,
    usesInput: false,
  };
}
