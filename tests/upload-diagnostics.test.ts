/**
 * Compiler output → student diagnostics (src/upload/toolchain/diagnostics.ts):
 * gcc / ld stderr samples captured from the wasm toolchain are parsed into
 * .ino line numbers, and the most common mistakes get a plain-English hint.
 */
import { describe, expect, it } from 'vitest';
import { explain, formatDiagnostic, parseDiagnostics, summarizeErrors, type Diagnostic } from '../src/upload/toolchain/diagnostics';

const GCC_UNDECLARED = [
  'sketch.ino: In function \'void loop()\':',
  'sketch.ino:9:3: error: \'digitalwrite\' was not declared in this scope',
  '   digitalwrite(LED, HIGH);',
  '   ^~~~~~~~~~~~',
  'sketch.ino:9:3: note: suggested alternative: \'digitalWrite\'',
  '   digitalwrite(LED, HIGH);',
  '   ^~~~~~~~~~~~',
  '   digitalWrite',
];

const GCC_MISSING_SEMICOLON = ['sketch.ino: In function \'void setup()\':', 'sketch.ino:4:20: error: expected \';\' before \'}\' token', '   pinMode(A1, OUTPUT)', '                    ^'];

const GCC_SERVO_TYPE = ['sketch.ino:2:3: error: \'Servo\' does not name a type', '   Servo s;', '   ^~~~~'];

const GCC_HEADER_MISSING = ['sketch.ino:1:10: fatal error: FastLED.h: No such file or directory', ' #include <FastLED.h>', '          ^~~~~~~~~~~', 'compilation terminated.'];

const GCC_IN_LIBRARY = ['In file included from sketch.ino:2:0:', '/libraries/DHT/DHT.h:45:3: warning: unused variable \'x\' [-Wunused-variable]', '   int x;', '   ^'];

const LD_NO_LOOP = [
  '/sys/core.a(main.cpp.o): In function `main\':',
  'main.cpp:(.text.main+0x1a): undefined reference to `loop\'',
  'main.cpp:(.text.main+0x22): undefined reference to `loop\'',
];

const LD_OVERFLOW = ['avr-ld: address 0x80f3e of /build/sketch.elf section `.text\' is not within region `text\'', 'avr-ld: region `text\' overflowed by 1854 bytes'];

describe('parseDiagnostics', () => {
  it('parses file:line:col: severity: message and drops context lines', () => {
    const d = parseDiagnostics(GCC_UNDECLARED, 'sketch.ino');
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ file: 'sketch.ino', line: 9, column: 3, severity: 'error', message: "'digitalwrite' was not declared in this scope", inSketch: true });
    expect(d[1]).toMatchObject({ severity: 'note', line: 9, message: "suggested alternative: 'digitalWrite'" });
  });

  it('marks library files as not in the sketch and keeps the warning severity', () => {
    const d = parseDiagnostics(GCC_IN_LIBRARY, 'sketch.ino');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ file: '/libraries/DHT/DHT.h', line: 45, severity: 'warning', inSketch: false });
  });

  it('turns ld undefined references into one error each (no duplicates)', () => {
    const d = parseDiagnostics(LD_NO_LOOP);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ file: '', line: 0, severity: 'error', message: "undefined reference to 'loop'" });
    expect(d[0].hint).toBe("Your sketch needs a 'void loop()' function.");
  });

  it('turns a flash overflow into a "too big" error', () => {
    const d = parseDiagnostics(LD_OVERFLOW);
    expect(d.some((x) => x.message === "region 'text' overflowed by 1854 bytes" && x.hint?.includes('too big'))).toBe(true);
  });

  it('fatal errors count as errors', () => {
    const d = parseDiagnostics(GCC_HEADER_MISSING, 'sketch.ino');
    expect(d[0].severity).toBe('error');
    expect(d[0].hint).toContain("The library 'FastLED.h' is not available");
  });

  it('matches the sketch file by name even with a path prefix', () => {
    const d = parseDiagnostics(['/build/my sketch.ino:3:1: error: boom'], 'my sketch.ino');
    expect(d[0].inSketch).toBe(true);
    expect(d[0].line).toBe(3);
  });
});

describe('explain', () => {
  const diag = (message: string, severity: Diagnostic['severity'] = 'error'): Diagnostic => ({ file: 'sketch.ino', line: 1, severity, message, inSketch: true });

  it('names the header for a missing library type', () => {
    expect(explain(diag("'Servo' does not name a type"))).toBe('Add #include <Servo.h> at the top of your sketch.');
    expect(explain(diag("'LiquidCrystal_I2C' does not name a type"))).toContain('LiquidCrystal_I2C.h');
    expect(parseDiagnostics(GCC_SERVO_TYPE)[0].hint).toContain('#include <Servo.h>');
  });

  it('spots the usual capitalisation mistakes', () => {
    expect(explain(diag("'digitalwrite' was not declared in this scope"))).toBe("Did you mean 'digitalWrite'? (Arduino names are case-sensitive.)");
    expect(explain(diag("'serial' was not declared in this scope"))).toContain("'Serial'");
  });

  it('explains missing semicolons, braces and parentheses', () => {
    expect(parseDiagnostics(GCC_MISSING_SEMICOLON)[0].hint).toBe('A semicolon ; is missing at the end of the previous statement.');
    expect(explain(diag("expected '}' at end of input"))).toContain('closing brace');
    expect(explain(diag("expected ')' before ';' token"))).toContain('parentheses');
  });

  it('explains text + number and void misuse', () => {
    expect(explain(diag("invalid operands of types 'const char*' and 'int' to binary 'operator+'"))).toContain('String(');
    expect(explain(diag('void value not ignored as it ought to be'))).toContain('void');
    expect(explain(diag("undefined reference to 'setup'"))).toBe("Your sketch needs a 'void setup()' function.");
    expect(explain(diag("undefined reference to 'blinkTwice()'"))).toContain("'blinkTwice'");
  });

  it('has no hint for notes and unknown messages', () => {
    expect(explain(diag('something unusual'))).toBeUndefined();
    expect(explain(diag("suggested alternative: 'x'", 'note'))).toBeUndefined();
  });
});

describe('formatDiagnostic / summarizeErrors', () => {
  it('formats like the Arduino IDE and puts sketch errors first', () => {
    const d = parseDiagnostics([...GCC_IN_LIBRARY, '/libraries/DHT/DHT.h:50:3: error: bad', ...GCC_UNDECLARED], 'sketch.ino');
    expect(formatDiagnostic(d[0])).toBe("DHT.h:45:3: warning: unused variable 'x' [-Wunused-variable]");
    const errors = summarizeErrors(d);
    expect(errors.map((e) => e.file)).toEqual(['sketch.ino', '/libraries/DHT/DHT.h']);
    expect(formatDiagnostic(errors[0])).toBe("sketch.ino:9:3: error: 'digitalwrite' was not declared in this scope");
  });
});
