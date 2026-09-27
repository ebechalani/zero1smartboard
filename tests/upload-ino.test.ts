/**
 * .ino → .cpp preprocessing (src/upload/toolchain/ino.ts): prototypes are
 * generated the way arduino-cli does it, with #line directives that keep the
 * compiler's line numbers equal to the student's, and includedHeaders() finds
 * the libraries a sketch needs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { findFunctions, includedHeaders, inoToCpp } from '../src/upload/toolchain/ino';
import { EXAMPLES } from '../src/examples';

describe('inoToCpp', () => {
  it('adds #include <Arduino.h>, #line 1 and one prototype per function, before the first definition', () => {
    const src = '#include <Servo.h>\nServo s;\nint twice(int x) {\n  return 2 * x;\n}\nvoid setup() {\n  s.attach(4);\n}\nvoid loop() {\n}\n';
    const { cpp, prototypes } = inoToCpp(src, 'sketch.ino');
    expect(prototypes).toEqual(['int twice(int x);', 'void setup();', 'void loop();']);
    expect(cpp).toBe(
      '#include <Arduino.h>\n#line 1 "sketch.ino"\n#include <Servo.h>\nServo s;\n' +
        '#line 3 "sketch.ino"\nint twice(int x);\n#line 6 "sketch.ino"\nvoid setup();\n#line 9 "sketch.ino"\nvoid loop();\n' +
        '#line 3 "sketch.ino"\nint twice(int x) {\n  return 2 * x;\n}\nvoid setup() {\n  s.attach(4);\n}\nvoid loop() {\n}\n\n',
    );
  });

  it('keeps every line number: the source line N is line N of the .ino part of the .cpp', () => {
    const src = 'const int LED = A1;\n\nvoid setup() {\n  pinMode(LED, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED, HIGH);\n  undefinedCall();\n}\n';
    const { cpp } = inoToCpp(src, 'my.ino');
    // The #line directive before the rest of the source restates the line of the first definition.
    const lines = cpp.split('\n');
    const idx = lines.lastIndexOf('#line 3 "my.ino"');
    expect(lines[idx + 1]).toBe('void setup() {');
    expect(lines[idx + 7]).toBe('  undefinedCall();'); // source line 9 = 3 + 6
  });

  it('handles default arguments: the prototype keeps "= value", the definition loses it (same columns)', () => {
    const src = 'void beep(int times = 3, int ms = 100) {\n  tone(8, 440, ms);\n}\nvoid setup() {}\nvoid loop() {}\n';
    const { cpp, prototypes } = inoToCpp(src);
    expect(prototypes[0]).toBe('void beep(int times = 3, int ms = 100);');
    expect(cpp).toContain('void beep(int times    , int ms      ) {');
  });

  it('ignores functions in comments, strings and preprocessor lines, and control statements', () => {
    const src = '// void fake() {\n/* void other() {\n */\nconst char* t = "void str() {";\n#define X(a) a\nvoid setup() {\n  if (1) {\n  }\n  while (0) {\n  }\n}\nvoid loop() {}\n';
    expect(findFunctions(src).map((f) => f.name)).toEqual(['setup', 'loop']);
  });

  it('does not treat class/struct bodies or initialiser braces as functions', () => {
    const src = 'struct Point {\n  int x;\n};\nint values[] = {1, 2, 3};\nPoint p = {1, 2};\nvoid setup() {}\nvoid loop() {}\n';
    expect(findFunctions(src).map((f) => f.name)).toEqual(['setup', 'loop']);
  });

  it('a sketch without functions gets the header lines only', () => {
    expect(inoToCpp('int x;\n').cpp).toBe('#include <Arduino.h>\n#line 1 "sketch.ino"\nint x;\n\n');
  });

  it('normalises CRLF line endings', () => {
    const { cpp } = inoToCpp('void setup() {\r\n}\r\nvoid loop() {\r\n}\r\n');
    expect(cpp).not.toContain('\r');
    expect(cpp).toContain('void setup();\n');
  });
});

describe('includedHeaders', () => {
  it('lists <> and "" includes once, ignoring comments', () => {
    const src = '#include <Wire.h>\n#include "DHT.h"\n// #include <Servo.h>\n/* #include <SPI.h> */\n#include <Wire.h>\n  #  include <LiquidCrystal_I2C.h>\n';
    expect(includedHeaders(src)).toEqual(['Wire.h', 'DHT.h', 'LiquidCrystal_I2C.h']);
  });
});

describe('the 21 example sketches', () => {
  it('all get setup() and loop() prototypes and their prototypes match the golden arduino-cli output', () => {
    const goldenDir = new URL('./fixtures/upload/ino-cpp/', import.meta.url);
    const golden = new Set(readdirSync(goldenDir));
    for (const ex of EXAMPLES) {
      const { cpp, prototypes } = inoToCpp(ex.source, `${ex.id}.ino`);
      expect(prototypes, ex.id).toContain('void setup();');
      expect(prototypes, ex.id).toContain('void loop();');
      const file = `${ex.id}.ino.cpp`;
      if (!golden.has(file)) continue;
      // arduino-cli writes absolute paths in #line; the golden files were normalised to the bare name.
      const expected = readFileSync(new URL(file, goldenDir), 'utf8');
      expect(cpp, ex.id).toBe(expected);
    }
  });
});
