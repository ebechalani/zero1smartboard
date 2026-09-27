/**
 * Compiler / linker output → diagnostics a student can act on.
 *
 * gcc and ld print `file:line:col: severity: message` lines (plus "note:"
 * follow-ups and context lines). The sketch is compiled with `#line N
 * "<fileName>"` directives (ino.ts), so errors in the sketch carry the .ino
 * file name and its real line numbers. Errors inside library headers keep
 * their own file name; they are shown with the library path so the student
 * knows the problem is in something they included.
 *
 * `explain()` adds a plain-English hint for the mistakes students make most.
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'note';

export interface Diagnostic {
  /** File as the compiler printed it (`sketch.ino`, `/arduino/core/Print.h`, or '' for ld messages without a file). */
  file: string;
  /** 1-based line, 0 when unknown. */
  line: number;
  column?: number;
  severity: DiagnosticSeverity;
  /** The compiler's message, verbatim. */
  message: string;
  /** True when the message points into the student's sketch. */
  inSketch: boolean;
  /** A plain-language explanation / fix, when one is known. */
  hint?: string;
}

const LINE_RE = /^(.*?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.*)$/;
/** avr-ld: "sketch.o: In function `loop':" / "(.text+0x12): undefined reference to `foo'" */
const LD_UNDEFINED_RE = /undefined reference to [`']([^'`]+)'/;
const LD_OVERFLOW_RE = /region [`']?(text|data)'? overflowed by (\d+) bytes/;

/** Parse gcc/ld stderr lines into diagnostics (context lines and carets are dropped). */
export function parseDiagnostics(lines: readonly string[], sketchFileName = 'sketch.ino'): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const push = (d: Diagnostic) => {
    const key = `${d.severity}|${d.file}|${d.line}|${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    d.hint = explain(d);
    out.push(d);
  };
  for (const raw of lines) {
    const l = raw.replace(/\r$/, '');
    const m = l.match(LINE_RE);
    if (m) {
      const file = m[1];
      const severity: DiagnosticSeverity = m[4] === 'warning' ? 'warning' : m[4] === 'note' ? 'note' : 'error';
      push({
        file,
        line: +m[2],
        column: m[3] ? +m[3] : undefined,
        severity,
        message: m[5].trim(),
        inSketch: isSketchFile(file, sketchFileName),
      });
      continue;
    }
    const u = l.match(LD_UNDEFINED_RE);
    if (u) {
      push({ file: '', line: 0, severity: 'error', message: `undefined reference to '${u[1]}'`, inSketch: false });
      continue;
    }
    const o = l.match(LD_OVERFLOW_RE);
    if (o) {
      push({ file: '', line: 0, severity: 'error', message: `region '${o[1]}' overflowed by ${o[2]} bytes`, inSketch: false });
      continue;
    }
    // ld's own fatal lines ("ld: cannot find -lfoo") without a location
    const ld = l.match(/^(?:avr-)?ld(?:\.wasm)?:\s*(.*)$/);
    if (ld && !/^warning/i.test(ld[1])) push({ file: '', line: 0, severity: 'error', message: ld[1].trim(), inSketch: false });
  }
  return out;
}

function isSketchFile(file: string, sketchFileName: string): boolean {
  return file === sketchFileName || file.endsWith('/' + sketchFileName) || /\.ino$/.test(file);
}

/** The mistakes students make most, in plain English. Returns undefined when nothing is known. */
export function explain(d: Diagnostic): string | undefined {
  const msg = d.message;
  let m: RegExpMatchArray | null;
  if (d.severity === 'note') return undefined;

  if ((m = msg.match(/^'([A-Za-z_]\w*)' does not name a type/))) {
    const lib = LIBRARY_TYPES[m[1]];
    if (lib) return `Add #include <${lib}> at the top of your sketch.`;
    return `The type '${m[1]}' is unknown. Check the spelling, or add the #include of the library that defines it.`;
  }
  if ((m = msg.match(/^'([A-Za-z_]\w*)' was not declared in this scope/))) {
    const name = m[1];
    const type = LIBRARY_TYPES[name];
    if (type) return `Add #include <${type}> at the top of your sketch.`;
    const lib = LIBRARY_FUNCTIONS[name];
    if (lib) return `'${name}' comes from the ${lib.library} library: add #include <${lib.header}> at the top of your sketch.`;
    const fix = COMMON_TYPOS[name];
    if (fix) return `Did you mean '${fix}'? (Arduino names are case-sensitive.)`;
    return `'${name}' is not defined anywhere. Check the spelling (Arduino is case-sensitive) or declare it before using it.`;
  }
  if (/^expected ';' before/.test(msg)) return 'A semicolon ; is missing at the end of the previous statement.';
  if (/^expected '\)' before/.test(msg) || /^expected '\(' /.test(msg)) return 'Check the parentheses: every ( needs a matching ).';
  if (/^expected '}' at end of input/.test(msg) || /^expected '}' before/.test(msg)) return 'A closing brace } is missing: every { needs a matching }.';
  if (/^expected declaration before '}' token/.test(msg)) return 'There is one closing brace } too many.';
  if (/^expected primary-expression before/.test(msg)) return 'Something is missing or misplaced in this expression (a value, a variable or an operator).';
  if (/^expected unqualified-id before/.test(msg)) return 'This name cannot be used here. Check for a stray keyword, number or symbol.';
  if (/^expected initializer before/.test(msg)) return 'Check the line before this one: a semicolon or an = is probably missing.';
  if (/^too few arguments to function/.test(msg)) return 'This function needs more values between its parentheses. Check its documentation or its definition.';
  if (/^too many arguments to function/.test(msg)) return 'This function is called with too many values between its parentheses.';
  if (/^no matching function for call to/.test(msg)) return 'No version of this function takes these arguments. Check the number and the types of the values you pass.';
  if (/^invalid conversion from 'const char\*' to '(int|long|char|unsigned)/.test(msg)) return 'A text ("...") is used where a number is expected.';
  if (/^invalid conversion from 'int' to 'const char\*'/.test(msg)) return 'A number is used where a text ("...") is expected.';
  if (/^invalid operands of types 'const char\*' and 'int' to binary 'operator\+'/.test(msg) || /^invalid operands of types 'const char\[\d+\]' and/.test(msg)) {
    return 'You cannot add a number to a text with +. Print them one after the other, or use String("...") + number.';
  }
  if (/^redefinition of /.test(msg) || /^redeclaration of /.test(msg)) return 'This name is defined twice. Give one of them another name.';
  if (/^'([A-Za-z_]\w*)' cannot be used as a function/.test(msg)) return 'This is a variable, not a function: it cannot be called with parentheses.';
  if (/^assignment of read-only variable/.test(msg)) return 'This variable is a const: it cannot be changed after its declaration.';
  if (/^lvalue required as left operand of assignment/.test(msg)) return 'The left side of = must be a variable. (Did you mean == to compare?)';
  if ((m = msg.match(/^'class ([A-Za-z_]\w*)' has no member named '([A-Za-z_]\w*)'/))) {
    return `'${m[1]}' has no function or field called '${m[2]}'. Check the spelling and the library's documentation.`;
  }
  if (/^void value not ignored as it ought to be/.test(msg)) return 'This function returns nothing (void): its result cannot be stored or printed.';
  if (/^return-statement with a value, in function returning 'void'/.test(msg)) return "A void function cannot return a value. Change 'void' to the type you return, or remove the value.";
  if (/^jump to case label/.test(msg) || /crosses initialization/.test(msg)) return 'A variable is declared inside a switch case: wrap the case body in braces { }.';
  if ((m = msg.match(/^([^:]+\.h): No such file or directory/))) {
    const name = m[1].replace(/^.*\//, '');
    return `The library '${name}' is not available on the ZERO1 board. Only Wire, LiquidCrystal_I2C, Servo, DHT, Adafruit_NeoPixel and NewPing are installed.`;
  }
  if ((m = msg.match(/^undefined reference to '(setup|loop)'/))) return `Your sketch needs a 'void ${m[1]}()' function.`;
  if ((m = msg.match(/^undefined reference to '([^']+)'/))) {
    return `'${m[1].replace(/\(.*$/, '')}' is declared but never defined. Write the function body, or check the spelling of the call.`;
  }
  if (/^region 'text' overflowed/.test(msg)) return 'The sketch is too big for the board (32,256 bytes of program storage). Remove code or libraries.';
  if (/^region 'data' overflowed/.test(msg)) return 'The sketch uses more memory (RAM) than the board has (2,048 bytes). Use smaller arrays or F("...") for texts.';
  if (/^unused variable/.test(msg)) return 'This variable is never used. Remove it, or use it.';
  if (/^narrowing conversion/.test(msg)) return 'The value does not fit in the type of the variable (for example 300 in a byte).';
  if (/comparison between signed and unsigned/.test(msg)) return undefined;
  if (/^stray '\\\d+' in program/.test(msg) || /^stray '.' in program/.test(msg)) return 'There is a character the compiler does not understand (often a curly quote pasted from a document). Retype it.';
  if (/^missing terminating (" character|' character)/.test(msg)) return 'A text is not closed: check the quotes.';
  if (/^unterminated comment/.test(msg)) return 'A /* comment is never closed with */.';
  return undefined;
}

/** Class types students use and the header that declares them. */
const LIBRARY_TYPES: Record<string, string> = {
  Servo: 'Servo.h',
  LiquidCrystal_I2C: 'LiquidCrystal_I2C.h',
  LiquidCrystal: 'LiquidCrystal_I2C.h',
  DHT: 'DHT.h',
  Adafruit_NeoPixel: 'Adafruit_NeoPixel.h',
  NewPing: 'NewPing.h',
};

const LIBRARY_FUNCTIONS: Record<string, { library: string; header: string }> = {
  Wire: { library: 'Wire', header: 'Wire.h' },
  DHT22: { library: 'DHT', header: 'DHT.h' },
  DHT11: { library: 'DHT', header: 'DHT.h' },
  NEO_GRB: { library: 'Adafruit_NeoPixel', header: 'Adafruit_NeoPixel.h' },
  NEO_KHZ800: { library: 'Adafruit_NeoPixel', header: 'Adafruit_NeoPixel.h' },
};

/** Wrong capitalisation students type most. */
const COMMON_TYPOS: Record<string, string> = {
  digitalwrite: 'digitalWrite',
  DigitalWrite: 'digitalWrite',
  digitalread: 'digitalRead',
  DigitalRead: 'digitalRead',
  analogread: 'analogRead',
  AnalogRead: 'analogRead',
  analogwrite: 'analogWrite',
  pinmode: 'pinMode',
  PinMode: 'pinMode',
  Delay: 'delay',
  serial: 'Serial',
  SERIAL: 'Serial',
  Millis: 'millis',
  high: 'HIGH',
  low: 'LOW',
  output: 'OUTPUT',
  input: 'INPUT',
  Setup: 'setup',
  Loop: 'loop',
};

/** One line per diagnostic, the way the Arduino IDE prints it: `sketch.ino:12:3: error: ...`. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file ? `${d.file.replace(/^.*\//, '')}:${d.line}${d.column ? ':' + d.column : ''}: ` : '';
  return `${where}${d.severity}: ${d.message}`;
}

/** Errors first (sketch ones before library ones), then warnings; notes are kept after the error they follow. */
export function summarizeErrors(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  errors.sort((a, b) => Number(b.inSketch) - Number(a.inSketch));
  return errors;
}
