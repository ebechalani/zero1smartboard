/**
 * .ino -> .cpp preprocessing, the way arduino-cli does it (simplified):
 *   #include <Arduino.h>
 *   #line 1 "sketch.ino"
 *   ...source up to the first function definition...
 *   #line N "sketch.ino"      <- one prototype per function defined in the sketch
 *   void foo(int a);
 *   #line N "sketch.ino"
 *   ...rest of the source...
 * arduino-cli uses ctags; this uses a small scanner on a copy of the source in
 * which comments, string/char literals and preprocessor lines are blanked out
 * (newlines kept, so offsets and line numbers stay valid). The spike checked it
 * against arduino-cli's output on all 33 corpus sketches (identical prototypes).
 *
 * Pure JS, no DOM or Node APIs: the same file runs in the browser worker.
 * Port of the feasibility spike's toolchain/lib/ino.mjs (logic unchanged).
 */

function mask(src: string): string {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let lineStart = true;
  const blank = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    if (lineStart) {
      // preprocessor directive (with backslash continuations)
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) j++;
      if (src[j] === '#') {
        let k = j;
        while (k < n) {
          if (src[k] === '\n' && src[k - 1] !== '\\') break;
          k++;
        }
        blank(i, k);
        i = k;
        continue;
      }
    }
    if (c === '/' && src[i + 1] === '/') {
      let k = i;
      while (k < n && src[k] !== '\n') k++;
      blank(i, k);
      i = k;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let k = src.indexOf('*/', i + 2);
      k = k < 0 ? n : k + 2;
      blank(i, k);
      i = k;
      lineStart = false;
      continue;
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      blank(i + 1, k);
      i = k + 1;
      lineStart = false;
      continue;
    }
    lineStart = c === '\n' ? true : lineStart && (c === ' ' || c === '\t');
    i++;
  }
  return out.join('');
}

const NOT_FUNCTIONS = /^(if|while|for|switch|return|sizeof|catch|do|else)$/;
const TYPE_BLOCKS = /\b(struct|class|union|enum|namespace|typedef|operator)\b|\bextern\s+"|=/;

/** A function definition found at the top level of a sketch. */
export interface SketchFunction {
  name: string;
  /** The signature as it appears in the source, comments removed, whitespace collapsed. */
  signature: string;
  /** 1-based line of the start of the definition. */
  line: number;
  hasDefaults: boolean;
  /** Offsets [from, to) of default-argument initialisers ("= 100") in the source. */
  defaults: [number, number][];
}

/** Top-level function definitions of a sketch (what arduino-cli's ctags pass would list). */
export function findFunctions(src: string): SketchFunction[] {
  const m = mask(src);
  const fns: SketchFunction[] = [];
  let depth = 0;
  let chunkStart = 0; // start of the current top-level "statement"
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === '{') {
      if (depth === 0) {
        const chunk = m.slice(chunkStart, i);
        const re = /([A-Za-z_][\w\s*&:<>,[\]]*?[\s*&])([A-Za-z_]\w*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(const\s*)?$/;
        const hit = chunk.match(re);
        const head = chunk.slice(0, chunk.indexOf('(') < 0 ? chunk.length : chunk.indexOf('(')); // "=" in the params is a default argument
        if (hit && !TYPE_BLOCKS.test(head) && !NOT_FUNCTIONS.test(hit[2])) {
          const lead = chunk.length - chunk.trimStart().length;
          const startOff = chunkStart + lead;
          const sigEnd = chunkStart + chunk.trimEnd().length;
          const signature = src
            .slice(startOff, sigEnd)
            .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const line = src.slice(0, startOff).split('\n').length;
          const params = hit[3];
          // offsets of default-argument initialisers ("= 100") inside the parameter list
          const defaults: [number, number][] = [];
          if (/=/.test(params)) {
            const close = m.lastIndexOf(')', sigEnd);
            let d = 0;
            let open = close;
            for (let k = close; k >= startOff; k--) {
              if (m[k] === ')') d++;
              else if (m[k] === '(') {
                d--;
                if (d === 0) {
                  open = k;
                  break;
                }
              }
            }
            let pd = 0;
            let eq = -1;
            for (let k = open + 1; k <= close; k++) {
              const ch = m[k];
              if (ch === '(' || ch === '<' || ch === '[' || ch === '{') pd++;
              else if ((ch === ')' || ch === '>' || ch === ']' || ch === '}') && k !== close) pd--;
              if (ch === '=' && pd === 0 && eq < 0) eq = k;
              if ((ch === ',' && pd === 0) || k === close) {
                if (eq >= 0) defaults.push([eq, k]);
                eq = -1;
              }
            }
          }
          fns.push({ name: hit[2], signature, line, hasDefaults: defaults.length > 0, defaults });
        }
      }
      depth++;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) chunkStart = i + 1;
    } else if (c === ';' && depth === 0) {
      chunkStart = i + 1;
    }
  }
  return fns;
}

/**
 * Turn a sketch into the C++ translation unit the compiler gets.
 * @param source   .ino text
 * @param fileName name used in #line directives (what error messages show)
 */
export function inoToCpp(source: string, fileName = 'sketch.ino'): { cpp: string; prototypes: string[] } {
  let src = source.replace(/\r\n?/g, '\n');
  const fns = findFunctions(src);
  // Functions with default arguments: the prototype keeps "= value", the definition loses it
  // (blanked with spaces, so every line/column the compiler reports stays the same).
  const blanks = fns.flatMap((f) => f.defaults);
  if (blanks.length) {
    const chars = src.split('');
    for (const [a, b] of blanks) for (let k = a; k < b; k++) if (chars[k] !== '\n') chars[k] = ' ';
    src = chars.join('');
  }
  const q = JSON.stringify(fileName);
  const lines = src.split('\n');
  let out = `#include <Arduino.h>\n#line 1 ${q}\n`;
  if (!fns.length) return { cpp: out + src + '\n', prototypes: [] };
  const insertAt = fns[0].line; // 1-based line of the first function definition
  out += lines.slice(0, insertAt - 1).join('\n') + (insertAt > 1 ? '\n' : '');
  const prototypes: string[] = [];
  for (const f of fns) {
    out += `#line ${f.line} ${q}\n${f.signature};\n`;
    prototypes.push(`${f.signature};`);
  }
  out += `#line ${insertAt} ${q}\n` + lines.slice(insertAt - 1).join('\n') + '\n';
  return { cpp: out, prototypes };
}

/** Header names from #include <...> / "..." lines (comments ignored). */
export function includedHeaders(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const set = new Set<string>();
  for (const m of noComments.matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)) set.add(m[1].trim());
  return [...set];
}
