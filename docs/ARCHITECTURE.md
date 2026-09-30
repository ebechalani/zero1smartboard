# ZERO1 Smart Board Simulator — architecture & module contracts

A browser application in which students write **real Arduino C++ sketches**
for the ZERO1 Smart Board and watch a virtual board react (LEDs, LCD, servo,
buzzer, 7-segment, serial monitor…). The sketch is transpiled to JavaScript
in the browser and executed against a software model of the board.

Stack: Vite + TypeScript (strict), vanilla DOM, CodeMirror 6, Vitest.
No frameworks. Deployed as a static site (GitHub Pages).

`src/types.ts` and `src/transpiler/ast.ts` are the binding contracts. If you
find that you need to change them, do it minimally, keep every other module
compiling, and describe the change at the end of your work.

---

## 1. Data flow

```
 .ino source ──transpile()──▶ JS body ──new Function('__rt', js)──▶ SketchModule {setup, loop}
                                                                        │
                       Executor drives setup()/loop() ◀─────────────────┘
                                │  calls into
                          __rt (Proxy over core API + libs + helpers)
                                │  calls into
                          Board (pins, events, serial)  ◀──── Peripherals register/subscribe
                                │
                     UI reads pins + peripheral state every animation frame
```

Real time is used in the browser (`RealClock`); tests use `VirtualClock`.

---

## 2. Repository layout & ownership

```
src/
  types.ts                      shared contracts (given)
  main.ts                       app entry                                   [ui-app]
  zero1.ts                      createZero1Board(clock, config?)            [peripherals]
  transpiler/
    ast.ts                      AST contract (given)
    lexer.ts  parser.ts         source -> Program                           [parser]
    typesys.ts signatures.ts    static types, runtime signature table       [codegen]
    codegen.ts index.ts         Program -> JS; transpile()                  [codegen]
  runtime/
    values.ts                   FloatBox, __flt, __chr, StopSignal, SketchError, SketchAbort (given)
    avr-float.ts                Print::printFloat and avr-libc dtostrf, bit-exact [runtime-core]
    clock.ts                    RealClock, VirtualClock                     [runtime-core]
    board.ts                    class Board implements IBoard               [runtime-core]
    helpers.ts                  numeric helpers (__i16 …), __array, __cstr  [runtime-core]
    core.ts                     createCoreApi(ctx)                          [runtime-core]
    executor.ts                 class Executor implements IExecutor         [runtime-core]
    index.ts                    createRuntime(ctx) -> Proxy                 [runtime-core]
    libs/
      index.ts                  createLibs(ctx)                             [runtime-libs]
      print.ts                  Print formatting shared by Serial/LCD       [runtime-libs]
      serial.ts strings.ts servo.ts lcd.ts dht.ts neopixel.ts newping.ts wire.ts  [runtime-libs]
  peripherals/
    led.ts rgb.ts buzzer.ts sevenseg.ts motor.ts servo.ts potldr.ts
    button.ts dht.ts ultrasonic.ts lcd.ts index.ts                          [peripherals]
  ui/
    board-view.ts board-svg.ts  interactive SVG board                       [board-svg]
    app.ts editor.ts serial-monitor.ts pinmap.ts console-panel.ts
    controls.ts settings.ts menu.ts examples-menu.ts audio.ts style.css     [ui-app]
    arduino-ide-dialog.ts sketch-file.ts                                    [ui-app]
    handin-dialog.ts            the student side of the class platform      [ui-app / B]
  python/                       Python mode's translator: Python → Arduino sketch (§14)  [Python A]
  sketch/                       pins, C++ precedence, 7-segment helpers, placeholder (Blocks + Python) [Python A]
  share-link.ts                 #code= / #blocks= / #class= links, review payload (pure) [A]
  firebase-config.ts            public Firebase web config (empty = classes off) [A]
  classroom/                    class platform data layer (§12)             [A]
  teacher/  review/             teacher dashboard, sandboxed review page (§13) [C]
  examples/
    *.ino, index.ts             example sketches + manifest                 [examples]
tests/
  *.test.ts                     Vitest (node environment; UI tests use happy-dom)
  helpers.ts                    makeBoard(), runSketch()                    [integration]
tests-emulator/                 Firebase emulator suites (rules, APIs, flow) [A]
docs/
  ARCHITECTURE.md PINOUT.md BLOCKS.md CLASSROOM.md
index.html teacher.html review.html                                         [ui-app / C]
```

Only touch files you own. Import other modules by the paths and names given
here; they may not exist yet while you work — that is expected, integration
happens afterwards. Where you need them for your own tests, write small fakes
inside your test file.

---

## 3. Conventions

- TypeScript strict, ES2022, ESM, `import type` for types. No `any` in exported
  signatures (internal `any` is tolerated in the transpiler where the AST is
  walked generically).
- Every exported function/class has a short doc comment.
- Errors shown to students must be readable by a 14-year-old: say what is wrong
  and, when possible, how to fix it. Prefer the Arduino compiler's wording
  where one exists (`'foo' was not declared in this scope`).
- Tests: Vitest, `tests/<module>.test.ts`, node environment, no DOM. Use
  `VirtualClock`. Aim for behaviour tests (input → observable state), not
  implementation tests.
- Run `npm run typecheck` and `npm test` before finishing; fix what you own.

---

## 4. Transpiler (`src/transpiler`)

### 4.1 Public API

```ts
// src/transpiler/index.ts
export function transpile(source: string): TranspileResult;   // see types.ts
// src/transpiler/parser.ts
export function parse(source: string): Program;                // throws ParseError
export class ParseError extends Error { line: number; column: number; }
// src/transpiler/lexer.ts
export function tokenize(source: string): Token[];             // throws ParseError
export interface Token { type: TokenType; value: string; line: number; column: number; }
export type TokenType = 'ident'|'keyword'|'int'|'float'|'char'|'string'|'punct'|'directive'|'eof';
```

`transpile()` never throws: parse errors become `{ok:false, errors:[...]}`;
unsupported constructs found during codegen also become errors with the
position of the offending node. Multiple errors may be reported when feasible,
but one is fine.

### 4.2 Supported language subset

Types: everything in `PRIMITIVE_TYPES` + aliases in `TYPE_ALIASES`; `String`;
`char*` / `const char*` (a JS string); class types (`Servo`, `LiquidCrystal_I2C`,
`DHT`, `Adafruit_NeoPixel`, `NewPing`, or any other identifier — codegen emits
`new __rt.Name(...)`, and the runtime reports unknown names); arrays of all of
these (1-D and 2-D, sized or initializer-sized); `enum` (plain, values become
`int` constants). Qualifiers `const static volatile PROGMEM constexpr inline
extern register` are accepted (`const`→JS `const` only for scalars; `static`
locals are hoisted, see 4.4).

Declarations: globals, locals (block scoped), functions with typed params and
return types, prototypes, multiple declarators (`int a = 1, b[3], c;`),
direct-init (`Servo s(4); String t("x");`).

Statements: block, expression, if/else, for (with declaration in init), while,
do-while, switch/case/default (fallthrough preserved), break, continue,
return, empty `;`.

Expressions: all C operators with C precedence (assignment, `?:`, `||`, `&&`,
`|`, `^`, `&`, `== !=`, `< > <= >=`, `<< >>`, `+ -`, `* / %`, unary `- + ! ~
++ --`, postfix `++ --`, call, index, member `.` and `->`), casts `(T)x` and
`T(x)` for primitive T, `sizeof`, comma. Literals: decimal/hex/octal/binary
(`0b1010` and Arduino `B1010`), suffixes `u l ul f`, floats, chars with escapes,
strings with escapes and adjacent-literal concatenation, `true/false`.

Preprocessor: `#include <x.h>` / `"x.h"` (recorded, otherwise ignored),
`#define NAME` and `#define NAME expr` (object-like macros → module-level
`const`). Line continuation with `\` in directives. `//` and `/* */` comments.

**Unsupported (must produce a clear error with position):** function-like
macros, `#if/#ifdef/#else/#endif` (error: "conditional compilation is not
supported"), `struct`/`class`/`union`/`typedef` definitions, templates,
pointers other than `char*`, address-of `&x` (except in `attachInterrupt`
argument lists where `&isr` may be silently accepted), dereference `*p`,
references in parameters (`int &x`), `goto`, labels, `namespace`, `using`,
lambdas, `new`/`delete`, `enum class`, function overloading (same name
declared twice with a body → error "function 'f' is defined twice"),
default parameter values, `Serial1`, `__asm__`.

### 4.3 Parser rules that matter

- **Declaration vs expression statement.** A statement is a declaration if it
  starts with a type keyword (`TYPE_KEYWORDS`), a qualifier, or the pattern
  `Identifier Identifier` / `Identifier Identifier [` / `Identifier Identifier (`
  / `Identifier Identifier =` / `Identifier Identifier ;` / `Identifier Identifier ,`.
  Otherwise it is an expression statement.
- **Function vs constructor call after `Type name (`.** If the token after `(`
  is `)`, a type keyword, a qualifier, or an identifier immediately followed by
  another identifier, `*`, `&`, or `[` → parameter list (function
  declaration/prototype). Otherwise → constructor arguments (`Servo s(4)`).
  At top level, `Type name(...)` followed by `{` is always a function.
- `A0`..`A5`, `LED_BUILTIN`, `HIGH`, `LOW`, etc. are plain identifiers.
- `true`/`false` → BoolLiteral. `NULL` → identifier.
- `String` is a type keyword (TypeSpec name 'String'), but `String(...)` in
  expression position is a CallExpr with callee Identifier 'String'.
- Functional casts: `int(x)`, `long(x)`, `float(x)`, `char(x)`, `byte(x)`,
  `word(x)`, `bool(x)`, `unsigned long(x)` are illegal C++ for the multi-word
  ones; accept single-keyword functional casts only → CastExpr.
- `sizeof x`, `sizeof(x)`, `sizeof(int)`.
- Positions: every node's `pos` is the position of its first token
  (FunctionDecl: the name). Diagnostics reported with those positions.
- Statement-level `;` after a function body is tolerated. A missing `;`
  should produce `expected ';' before 'X'` (like GCC).

### 4.4 Code generation rules

The output is the body of `new Function('__rt', js)`:

```js
"use strict";
const { __i8, __u8, __i16, __u16, __i32, __u32, __f32, __bool, __idiv, __imod,
        __imul, __ftoi, __ftou, __tick, __array, __cstr, __chr, __flt, __str,
        __m, __mut, __charAt } = __rt;
return (async () => {
  const LED = 13;                              // #define / enum members
  let count = 0;                               // globals in source order
  let myServo = new __rt.Servo();
  let lcd = new __rt.LiquidCrystal_I2C(0x27, 16, 2);
  let __static_blink_n = 0;                    // hoisted static locals
  async function setup() { ... }
  async function loop() { ... }
  async function blink(times) { times = __i16(times); await __tick(); ... }
  return { setup, loop, serialEvent: typeof serialEvent === 'function' ? serialEvent : undefined };
})();
```

Rules:

1. **All user functions are `async`; every call is awaited**: user functions,
   `__rt.*` functions, method calls on objects. (`await` on non-promises is
   fine.) Pure helper wrappers (`__i16(...)`, `__idiv`, `__str`, `__chr`,
   `__flt`, `__charAt`) are NOT awaited. Calls are also not awaited inside
   `#define`/global-const initialisers when that would be a syntax problem —
   the IIFE is async, so awaiting at that level is allowed and preferred.
2. **Cooperative yield points**: emit `await __tick();` as the first statement
   of every function body and at the top of every loop body (`for`, `while`,
   `do`). `__tick` throws `StopSignal` when the sketch is stopped and yields
   to the event loop periodically.
3. **Identifier resolution**: keep a scope chain. Names declared in the sketch
   (globals, locals, params, functions, enum members, `#define`s) are emitted
   as-is (mangled with a trailing `$` if they collide with a JS reserved word
   or start with `__`). Any other identifier is emitted as `__rt.name`
   (the runtime Proxy throws `'name' was not declared in this scope` if it
   does not exist). `setup`/`loop` missing → transpile error "sketch must
   define void setup() and void loop()".
4. **Static typing & integer semantics.** Track a static type for every
   expression (see `typesys.ts`): literal types, declared variable types,
   function return types (user functions from their declaration; runtime
   functions/methods from `signatures.ts`, §4.5), operator result types by C
   usual arithmetic conversions (any float/double → `double`; otherwise
   integer; `int`×`int` → `int`, with `long` if either is long, unsigned if
   either is unsigned), comparisons/logical → `bool`, `?:` → common type,
   `String`+anything → `String`, char literal → `char`, string literal →
   `char*`. Unknown → `unknown` (treated as double: no integer division, no
   wrapping). A shift has the type of its promoted left operand;
   `min`/`max`/`constrain` have the common type of their arguments.
   - Integer `/` → `__idiv(a, b)`; integer `%` → `__imod(a, b)`. (Both throw
     `SketchError('division by zero')` for b === 0.)
   - **Assignment coercion**: storing into a variable/param/array element of
     integer type wraps to the C width: `char`→`__i8`, `unsigned char`→`__u8`,
     `short`/`int`→`__i16`, `unsigned short`/`unsigned int`→`__u16`,
     `long`→`__i32`, `unsigned long`→`__u32`, `long long` → `__i32`,
     `unsigned long long` → `__u32`, `bool`→`__bool`, `float`/`double`→`__f32`.
     Applies to initialisers, `=`, compound assignments (`x += y` →
     `x = __i16(x + y)`), `++`/`--`, function parameters on entry, and
     `return` values of typed functions. Casts `(T)x` use the same helpers;
     `(int)3.7` → 3. `String`/class/array assignment: no wrapper. A value
     that already went through the same helper (see "board-exact arithmetic"
     below; `ExprResult.wrapped`) is not wrapped twice.
   - `++`/`--`: prefix `++x` → `(x = __T(x + 1))`; postfix `x++` in a
     value context → `(x = __T(x + 1), __T(x - 1))`; in a statement/for-update
     context → `x = __T(x + 1)`. Floats: `(f = __f32(f + 1))`, and in a value
     context `([f, f = __f32(f + 1)][0])` (the old value first). For
     `unknown`/`bool` use `x++` directly.
   - `int` literal larger than 16 bits has type `long`; suffix `L`/`UL` too.
   - **Board-exact arithmetic** (docs/PYTHON.md §6, "C0"). The simulator
     computes like the ATmega328P in every mode (Code, Blocks, Python), not
     only when a value is stored; every rule below was measured against
     avr-g++ 7.3 + avr8js (`tests/runtime-fidelity.test.ts`):
     1. *Floats are single precision everywhere* (AVR `double` is `float`).
        Every expression of C type `float`/`double` is rounded where it is
        produced: a literal the chip cannot hold exactly → `__f32(0.1)` (an
        exact one such as `0.5` stays as is), the results of `+ - * /` →
        `__f32(a * b)`, float-returning runtime calls and methods →
        `__f32(await __rt.sqrt(x))`, `__f32(await dht.readTemperature())`,
        casts → `__f32(x)`, `f++` as above. A `long`/`unsigned long` operand
        of a float operation or comparison is converted first
        (`__f32(n) + 0.5`: 16777217 → 16777216.0). So `float s = 0.1;
        s == 0.1` and `0.1 + 0.2 == 0.3` are true, as on the board.
     2. *Integers wrap at their C width on every operation*: the results of
        `+ - * <<` and unary `-` of an integer C type (after the promotions)
        go through `__i16`/`__u16`/`__i32`/`__u32` (`60 * 1000` →
        `__i16(60 * 1000)` = −5536, `1 << 20` → 0); a 32-bit `*` is
        `__imul(a, b)` (`Math.imul`; `__u32(__imul(a, b))` for unsigned),
        because a double loses the low bits of products above 2^53
        (`long a = 50000; a * a` → −1794967296). `~ & | ^` of an unsigned
        type are wrapped too (JavaScript gives signed 32-bit results);
        `>>` of an `unsigned long` is `>>>`; a signed `/` is wrapped unless
        the divisor is a constant other than −1 (`-32768 / -1` is −32768
        on the board, `x / 1023` needs no wrapper). The `sq`/`abs` macros
        wrap an integer result (`sq(300)` → 24464); `sq` of a side-effect-free
        `long` expression is `__imul(x, x)`. Constant operands whose plain
        JavaScript result already fits are not wrapped (`(2 * 3)`); a
        JavaScript `-0` never stands for an integer 0 (`1.0 / 0` is inf).
     3. *C's usual arithmetic conversions of the operands*: for `/`, `%`,
        comparisons and `?:`, a signed operand next to an unsigned one is
        converted first (`int neg = -1; unsigned int one = 1; neg < one` →
        `(__u16(neg) < one)`, false; `neg / one` → 65535); `min`, `max`
        and `constrain` (macros) get all their arguments in their common
        type (`max(0UL, -7)` → 4294967289). The maths functions of
        `NUMERIC_CALLEES` receive a `char` as its signed number, not boxed
        with `__chr` (`ceil((char)-32)` is −32).
     4. *Float → integer* conversions follow avr-gcc's run-time routines:
        `__ftoi` (`__fixsfsi`: truncation, and −2147483648 for NaN, ±inf and
        values outside `long`) for `char`/`byte`/`int`/`long`, `__ftou`
        (`__fixunssfsi`: modulo 2^32, 0 outside ±2^32) for `unsigned int` /
        `unsigned long`, then the width: `int n = f;` → `let n =
        __i16(__ftoi(f));`, `long l = f;` → `__ftoi(f)`. Also for a float
        argument of a user function's integer parameter (at the call site).
        Out-of-range conversion is undefined behaviour in C: when GCC folds
        it at compile time it saturates instead (3e9 → 2147483647).
     5. *Float literals with an exponent* (`3.4e38`, JavaScript text
        `3.4e+38`) get no `.0` suffix, which would be invalid JavaScript.
     6. `abort()` is a runtime function (§5.4); `String(float, n)`,
        `String + float` and `dtostrf()` format like avr-libc (§6.3).

     Remaining known differences: the transcendental functions (`sin`, `exp`,
     `pow`, …) are JavaScript's, rounded to single precision, and may differ
     from avr-libc's in the last bit; a float outside the `long` range passed
     to a runtime function with integer parameters (`map(3e9, …)`) is
     converted modulo 2^32; `sq()` of a `long` expression containing a call
     (`sq(millis())`) loses the low bits beyond ±94,906,265; `delay()` of a
     negative number waits 0 ms (the
     board waits ~49 days); avr-gcc 7.3 at `-Os` miscompiles a few
     expressions (`x << ((ul ^ l) & 15)` shifts by 0), which the simulator
     computes as C says.
5. **Chars and strings.**
   - `char` values are numbers. `'A'` → `65`.
   - `String` values are JS strings. A `String` declaration without initialiser
     → `""`. `String(x)` / `String(x, base|digits)` → `__rt.String(x, arg)`.
   - `char*` / string literals are JS strings.
   - `char name[N]` / `char name[] = "hi"` → JS array of char codes with a
     trailing 0 (padded to N). `__cstr(arr)` converts to a JS string; emit it
     when a `char[]`-typed expression is passed to a runtime function/method,
     used in `+` with a String, compared with `==` to a string, or returned
     from a `String`/`char*` function.
   - Method calls on a `String`-typed receiver: `s.length()` → `s.length`,
     everything else → `__m(s, "name", [args])`. Mutating methods
     (`toUpperCase toLowerCase trim replace remove concat setCharAt`) on an
     l-value receiver → `(s = __mut(s, "name", [args]))`; `concat` yields
     `true` afterwards: `((s = __mut(s,"concat",[x])), true)`. Receiver of
     `unknown` type → `__m(...)` as well. `s[i]` on a String → `__charAt(s, i)`.
   - `+` with a `String` operand: `__str(a, "kindA") + __str(b, "kindB")` where
     kind ∈ `int|float|char|bool|string|unknown` from the static type (chars
     append the character, floats print with 2 decimals, bools "1"/"0").
     `"lit" + x` where neither side is String: emit the JS `+` and a warning
     `adding to a string literal is pointer arithmetic in C++; use String("lit") + x`.
     `==`/`!=` between two `String`/`char*` values → JS `===`/`!==`.
   - Passing arguments to **runtime** functions/methods (not user functions):
     `char`-typed → `__chr(x)` (except for the maths functions of
     `NUMERIC_CALLEES`, which get the signed number); `float`/`double`-typed
     → `__flt(x)` **only** when the callee name is `print`, `println`,
     `String`, or `write`. Arguments to user-defined functions are not
     wrapped, except a float passed for an integer parameter (rule 4,
     `__ftoi`/`__ftou`).
   - `bool`-typed values are JS booleans; arithmetic on them works (`true + 1`).
6. **Arrays.** `int a[5];` → `let a = __array([5], 0)`; `float f[2][3]` →
   `__array([2,3], 0)`; `String s[3]` → `__array([3], "")`; `Servo s[2]` →
   `[new __rt.Servo(), new __rt.Servo()]`. Initialiser lists become JS array
   literals with each element coerced; missing trailing elements are filled
   with the default; unsized dims take the initialiser length. Element
   assignment coerces (`a[i] = __i16(v)`). `sizeof(a)` = elements × element
   size (`char/bool/unsigned char`=1, `short/int/unsigned`=2, `long/float/double`=4,
   `String`=6, pointer=2, class=1); `sizeof(a)/sizeof(a[0])` therefore gives
   the length.
7. **Functions.** `void f(int x, float y)` → `async function f(x, y) { x = __i16(x); y = __f32(y); await __tick(); ... }`.
   Array parameters are passed by reference (JS arrays) — no copy. Prototypes
   are ignored (but their names count as declared). A `return` in `void`
   functions is plain `return`. Functions may be defined after use.
8. **`static` locals** → module-level `let __static_<fn>_<name> = init;` and
   all uses renamed. **`#define X v`** and enum members → module-level
   `const`. `#define` without a value → `const X = 1`.
9. **switch** → JS `switch` on the discriminant (chars are numbers on both
   sides, so `case 'a':` works).
10. **Special forms** (only when the name is not user-declared):
    `bitSet(x,n)` → `(x = __T(x | (1 << n)))`, `bitClear(x,n)` →
    `(x = __T(x & ~(1 << n)))`, `bitWrite(x,n,b)` →
    `(x = __T(b ? x | (1<<n) : x & ~(1<<n)))`, `bitToggle(x,n)` →
    `(x = __T(x ^ (1 << n)))`. `F("x")` → `"x"`. `sizeof` per rule 6.
    `attachInterrupt(digitalPinToInterrupt(p), isr, MODE)` → the `isr`
    argument is passed as the function reference (no call).
11. **Line map.** Emit one generated line per source statement where
    practical and record `lineMap[genLine-1] = srcLine` (0 when synthetic).
    Emit `//# L<n>` nowhere — the map is enough.
12. **Diagnostics/warnings** (non-fatal): `==` used in an assignment-looking
    statement (`x == 5;`) → "statement has no effect"; comparing a `String`
    with `==` to a char literal; `analogWrite` on a non-PWM pin literal
    (pins other than 3,5,6,9,10,11 and A0..A5 → note that only pins 3,5,6,9,10,11
    support PWM; the ZERO1 LEDs on A1/A2 are on/off only); `delay()` argument
    that is a float literal; unused prototype; missing `Serial.begin` while
    `Serial.print*` is used (warning).
13. The generated code must not use any global except `__rt`; no `eval`,
    no `with`.

### 4.5 Runtime signature table (`signatures.ts`)

Return types the codegen must know (all others → `unknown`):

Core functions: `digitalRead`→int, `analogRead`→int, `millis`/`micros`/`pulseIn`/`pulseInLong`→unsigned long,
`map`/`random`→long, `abs`/`sq`→type of first argument
(`min`/`max`/`constrain`: common type of all arguments), `sqrt sq pow sin cos tan asin acos atan atan2 exp log log10 floor ceil round fabs fmod trunc`→double
(but `sq(int)`→int, `abs(int)`→int, `round`→long), `shiftIn`→unsigned char,
`bit`→unsigned long (`1UL << b`), `bitRead lowByte highByte`→int/unsigned char, `word`→unsigned int,
`isDigit isAlpha isAlphaNumeric isSpace isUpperCase isLowerCase isPunct isPrintable isHexadecimalDigit isnan isinf`→bool,
`toUpperCase toLowerCase`(char)→char, `strlen`→unsigned int, `strcmp strncmp atoi`→int,
`atol`→long, `atof`→double, `sprintf snprintf`→int, `dtostrf itoa ltoa`→char*,
`String`→String, `digitalPinToInterrupt`→int.

Method return types (by method name, regardless of receiver, unless noted):
`available read peek`→int, `readString readStringUntil substring`→String,
`parseInt toInt`→long, `parseFloat toFloat toDouble`→float,
`print println write`→unsigned int, `length indexOf lastIndexOf compareTo`→int,
`charAt`→char, `equals equalsIgnoreCase startsWith endsWith isEmpty attached`→bool,
`readTemperature readHumidity computeHeatIndex convertCtoF convertFtoC`→float,
`Color ColorHSV gamma32 getPixelColor`→unsigned long, `numPixels`→unsigned int,
`ping ping_median`→unsigned long, `ping_cm ping_in convert_cm convert_in`→unsigned int,
`endTransmission requestFrom`→unsigned char, `readMicroseconds`→int,
`c_str`→char*.

Constants: `HIGH LOW INPUT OUTPUT INPUT_PULLUP A0..A5 LED_BUILTIN DEC HEX OCT BIN
MSBFIRST LSBFIRST CHANGE RISING FALLING SDA SCL NEO_* DHT11 DHT22 DHT21 AM2301` → int;
`PI HALF_PI TWO_PI DEG_TO_RAD RAD_TO_DEG EULER` → double.

---

## 5. Runtime core (`src/runtime`)

### 5.1 Clock (`clock.ts`)

`RealClock`: `now()` = `performance.now() - epoch`; `sleep(ms, signal)`: if
`ms < 1` busy-wait on `performance.now()` for up to 1 ms then resolve,
otherwise `setTimeout`, resolving early when `signal` aborts (remove the
timer; never reject); `yield()` = a macrotask hop using `MessageChannel`
(falls back to `setTimeout(0)`), which advances nothing.
`VirtualClock`: `now()` returns a virtual ms counter; `sleep(ms)` adds `ms`
and resolves; `yield()` adds `yieldCostMs` (constructor option, default
0.005) and resolves; `micros()` = `Math.floor(now()*1000)`.

### 5.2 Board (`board.ts`)

`class Board implements IBoard` with `constructor(clock: Clock, config?: Partial<BoardConfig>)`.
Behaviour:

- `pins` initialised to `{mode:null, level:0, pwm:null, tone:null, servo:null, inputLevel:null, analogInput:null}`.
- `pinMode(pin, mode)`: validate 0..19 (else `SketchError`), set mode; `INPUT_PULLUP` sets `level=1`; `OUTPUT` keeps level; emits `pinMode`.
- `digitalWrite(pin, level)`: level coerced to 0/1; set `pins[pin].level`; clear `pwm` and (if tone active on that pin) leave tone alone; emit
  `{type:'digitalWrite', pin, level, prev}` **always** (even when unchanged —
  shift-register clocks rely on it). Writing HIGH to an input pin enables the
  pull-up (like the real UNO).
- `digitalRead(pin)`: if a peripheral drives `inputLevel` (non-null) use the
  board config wiring rules (buttons set inputLevel themselves, already
  resolved — Board just returns it); else if mode is `OUTPUT` return `level`;
  else if mode is `INPUT_PULLUP` (or level===1 pull-up) return 1; else the pin
  is floating → return a pseudo-random 0/1 derived from `clock.micros()`
  (e.g. `(micros >> 4) & 1`) so students see garbage.
- `analogWrite(pin, value)`: clamp 0..255, integer. On PWM pins set
  `pwm=value` and `level = value > 127 ? 1 : 0`; on others set `pwm=null`
  and behave exactly like `digitalWrite(pin, value > 127)`. Emit `analogWrite`
  then (for non-PWM) the `digitalWrite` event. Real UNO: `analogWrite(pin,0)`
  and `255` on PWM pins are plain digitalWrite; treat equally (pwm 0/255).
- `analogRead(pin)`: `pin` 0..5 → 14..19; 14..19 as is; else `SketchError`.
  Returns `analogInput` when non-null, else a noisy floating value
  (slowly varying, 300..700 region, derived from micros). Integer 0..1023.
- `tone(pin, freq)`: only one tone at a time (UNO uses one timer): if another
  pin has an active tone, ignore the call. Set `pins[pin].tone = freq`; emit
  `tone`. `noTone(pin)` clears it and emits `{tone:null}`. `freq` ≤ 0 → noTone.
- `pulseIn(pin, level, timeoutUs)`: if a PulseSource is registered on `pin`,
  `w = src.measure(level)`; if `w > 0`, `await clock.sleep(w/1000)` and return
  `w`. Otherwise `await clock.sleep(timeoutUs/1000)` and return 0.
- `servoWrite(pin, angle)`: `pins[pin].servo = angle`, emit `servo`.
- `pixelsWrite(pin, colors)`: emit `pixels` (colors = packed 0xRRGGBB).
- `i2cDevice(addr)`, `dhtRead(pin)`, `registerX` as in the interface.
- `setDigitalInput` / `setAnalogInput` just store; `setAnalogInput` clamps 0..1023.
- `serial`: a `SerialPort` implementation with RX/TX buffers; `write(text)`
  emits `{type:'serialTx', text}` and calls `onTx` listeners.
- `reset()`: reset pins, serial, `peripherals.forEach(p => p.reset())`, emit `reset`.
  Registered sources/devices are kept (peripherals stay attached).
- Listeners are called synchronously; exceptions in listeners are caught and
  logged to `console.error` (never break the sketch).

### 5.3 Numeric helpers (`helpers.ts`)

```ts
__i8(x)  = (x << 24) >> 24        __u8(x)  = x & 0xff
__i16(x) = (x << 16) >> 16        __u16(x) = x & 0xffff
__i32(x) = x | 0                  __u32(x) = x >>> 0
__f32(x) = Math.fround(x)         __bool(x) = !!x   (numbers: x !== 0; strings: true)
__idiv(a,b) : b===0 → throw SketchError('division by zero'); Math.trunc(a/b) + 0
__imod(a,b) : b===0 → throw; a % b + 0  (JS semantics equal C for integers; + 0: never -0)
__imul(a,b) = Math.imul(a, b)     low 32 bits of a long product (signed)
__ftoi(x)   : float → signed integer like avr-gcc __fixsfsi: trunc, NaN/±inf/out of long → -2147483648
__ftou(x)   : float → unsigned like __fixunssfsi: trunc(x) >>> 0, NaN/±inf/|x| ≥ 2^32 → 0
__array(dims: number[], fill) : nested arrays
__cstr(x) : number[] → string up to first 0; string → string
```
Every helper must first coerce non-numbers: booleans → 0/1, FloatBox → value,
strings → `Number(s) || 0`, `null/undefined` → 0.

### 5.4 Core API (`core.ts`)

`createCoreApi(ctx: RuntimeContext): Record<string, unknown>` returns every
core Arduino function and constant listed below. Semantics follow the Arduino
UNO reference; a few specifics:

- `pinMode(pin, mode)`: mode numbers `INPUT=0, OUTPUT=1, INPUT_PULLUP=2`
  (also accept the strings). Invalid pin → `SketchError('pin X does not exist on the UNO (use 0-13 or A0-A5)')`.
- `digitalWrite(pin, v)`: v is truthy/`HIGH`(1) → 1. Warn once per pin
  (`ctx.console`) if the pin was never set to OUTPUT: "digitalWrite(pin) but pinMode(pin, OUTPUT) was never called".
- `delay(ms)`: `await clock.sleep(ms, signal)` then `throwIfStopped()`. The
  decimal part is dropped like the `unsigned long` parameter does
  (`delay(497.4)` waits 497 ms); clamp negative to 0. `delayMicroseconds(us)`:
  sleep(trunc(us)/1000).
- `millis()` = `Math.floor(clock.now())`, `micros()` = `clock.micros()` (both wrapped `__u32`).
- `tone(pin, freq, duration?)`: board.tone; if duration given, schedule
  `noTone(pin)` after `duration` ms via `clock.sleep` (do not await it; cancel
  if another tone starts). `noTone(pin)`.
- `pulseIn(pin, level, timeout = 1_000_000)` → board.pulseIn.
- `shiftOut(dataPin, clockPin, order, value)`: for each of 8 bits (MSBFIRST:
  bit 7 first): `digitalWrite(dataPin, bit); digitalWrite(clockPin, HIGH); digitalWrite(clockPin, LOW)`.
  `shiftIn` symmetric reading `digitalRead(dataPin)` after clocking HIGH.
- `map(x, inMin, inMax, outMin, outMax)` with **32-bit `long`** arithmetic
  like WMath.cpp: `(x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin`,
  every step wrapped (`Math.imul` for the product; `map(100000, 0, 200000, 0,
  100000)` is 7050 on the board). `constrain`, `min`, `max`, `abs`, `sq`
  (Arduino.h macros: the transpiler converts the arguments and wraps the
  result, §4.4), `pow`, `sqrt`, trig, `exp`, `log`, `floor`, `ceil`, …
  (single-precision argument and result, like avr-libc), `radians`/`degrees`
  (times the single-precision `DEG_TO_RAD`/`RAD_TO_DEG`), `round` (the macro
  `(long)(x + 0.5)` / `(long)(x - 0.5)` with the addition in single
  precision), `random(max)`,
  `random(min,max)` (exclusive max, seeded PRNG — mulberry32 — `randomSeed(s)`),
  `bit`, `bitRead`, `lowByte`, `highByte`, `word`, char classification
  functions, `isnan`, `isinf`, `interrupts`/`noInterrupts` (no-op),
  `attachInterrupt(n, isr, mode)`/`detachInterrupt` (store, warn once
  "external interrupts are not simulated on this board"), `digitalPinToInterrupt`,
  `analogReference` (no-op), `yield()` (`ctx.tick()`), `F(s)` → s.
- `abort()`: throws `SketchAbort` (a `SketchError`, values.ts), so the run
  stops with status `error` and the console error "The sketch stopped:
  abort() was called." on the line of the call (§5.6). On the board avr-libc's
  `abort()` disables the interrupts and loops forever; what was printed
  before stays on the Serial Monitor (Python's `pyFail`, docs/PYTHON.md §4.8).
- Constants: `HIGH 1, LOW 0, INPUT 0, OUTPUT 1, INPUT_PULLUP 2, A0..A5 14..19,
  LED_BUILTIN 13, DEC 10, HEX 16, OCT 8, BIN 2, MSBFIRST 1, LSBFIRST 0,
  CHANGE 1, FALLING 2, RISING 3, SDA 18, SCL 19, NULL 0, PI, HALF_PI, TWO_PI,
  DEG_TO_RAD, RAD_TO_DEG, EULER, F_CPU 16000000` (`PI` … `EULER` are the
  single-precision values the board has: `PI` prints as 3.1415927).
- Servo caveat: when any Servo is attached, `analogWrite` on pins 9/10 warns
  "PWM on pins 9 and 10 is disabled while a Servo is attached" and does a
  digital write instead (register a `servoAttached` counter on `ctx` via a
  module-level WeakMap keyed by board, so libs can update it — expose
  `ctx.board` based helper `setServoAttachedCount(board, n)` from core.ts).

### 5.5 Runtime assembly (`index.ts`)

```ts
export function createRuntime(ctx: RuntimeContext): Record<string, unknown>
```
Merges `helpers`, `values` (`__flt`, `__chr`), `createCoreApi(ctx)`,
`createLibs(ctx)` and `{ __tick: ctx.tick }` into one object, wrapped in a
`Proxy` whose `get` throws `SketchError("'name' was not declared in this scope")`
for unknown **string** keys — except `then`, `toJSON`, `constructor`,
`Symbol.*`, and anything starting with `__` (return `undefined`). Later
sources override earlier ones (libs may replace core names).

### 5.6 Executor (`executor.ts`)

`class Executor implements IExecutor` with `constructor(options: ExecutorOptions)`.

- `run(js)`: build `AbortController`, `RuntimeContext` (`tick()` implements the
  cooperative yield: increments a counter; every 512 calls **or** when more
  than 8 ms of `clock.now()` have elapsed since the last yield, `await
  clock.yield()`; always `throwIfStopped()`; also checks `deadline`/
  `stopAfterMs` and `maxLoops`), `createRuntime`, then
  `const mod = await new Function('__rt', js)(rt)`; validate `setup`/`loop`
  are functions; `await mod.setup()`; loop: `await mod.loop(); loops++;
  if (mod.serialEvent && board.serial.available()) await mod.serialEvent();
  await ctx.tick()`. Catch `StopSignal` → status `stopped`; any other error →
  status `error`, `onConsole({level:'error', text, line})` where `line` is
  recovered from the stack (`<anonymous>:L:C` → `lineMap[L - 3]`, because
  `new Function` adds 2 header lines in V8; Firefox uses `Function:L:C`; if
  nothing matches, omit `line`). Message for `SketchError` is its text (for
  `abort()`: "The sketch stopped: abort() was called."); for other JS
  errors, prefix "runtime error: ".
- `stop()`: abort the controller, set the flag, resolve after `run()` finishes.
- `status` transitions: idle → running → stopped|error. A new `run()` on a
  running executor first awaits `stop()`.
- Never throws from `run()`.

---

## 6. Libraries (`src/runtime/libs`)

`createLibs(ctx)` returns an object with these names. All methods may be
`async`; return plain JS values.

### 6.1 Print formatting (`print.ts`)

`formatPrintArg(value: unknown, fmt?: number): string` implementing Arduino `Print`:
- `FloatBox`/non-integer number: `formatFloat(v, fmt ?? 2)` (from values.ts):
  Arduino's `Print::printFloat` with every step in single precision
  (`printFloat` in `src/runtime/avr-float.ts`): "nan", "inf" for both signs,
  "ovf" beyond ±4294967040, halves rounded up at the last decimal.
- integer number with `fmt` undefined or 10: decimal; `fmt` 16/2/8: unsigned
  32-bit (`>>> 0`) in that base, HEX uppercase; `fmt` 0 → raw byte char
  (`write` semantics); other bases 2..36 supported.
- string: as is; boolean: "1"/"0"; array of numbers (char[]): `__cstr`;
  `null`/`undefined`: "" ; objects: `String(value)`.
Return value of `print` is the number of characters written.

### 6.2 `Serial`

`begin(baud)`, `end()`, `print(x, fmt?)`, `println(x?, fmt?)` (adds `\r\n`),
`write(x)` (number → the byte's character, string → as is), `available()`,
`read()`, `peek()`, `flush()`, `setTimeout(ms)` (default 1000),
`readString()`, `readStringUntil(term)` (term may be a number or 1-char
string), `readBytes(buf, len)`, `readBytesUntil(term, buf, len)`,
`parseInt()`, `parseFloat()`, `find(str)`, `available()`. Blocking reads wait
in slices of ~5 ms using `clock.sleep` until data arrives or the timeout
elapses (calling `ctx.throwIfStopped()` between slices). Printing before
`begin()` is dropped and produces **one** console warning: "Serial output
ignored: call Serial.begin(9600) in setup()". `Serial` must be truthy
(`while(!Serial);` must not hang).

### 6.3 String helpers (`strings.ts`)

- `String(x, arg?)` constructor function: number+base (`String(255, HEX)`),
  float+digits (`String(3.14159, 2)` or FloatBox), char (1-char string
  stays), bool → "1"/"0", string → as is. A float is formatted like
  WString.cpp does, `dtostrf(x, n + 2, n)`: `String(2.5, 0)` is " 3",
  `String(1e10, 1)` is "10000000000.0" (never "ovf": that is only
  `Serial.print`), NaN is " NAN".
- `__str(v, kind)`: converts for concatenation per §4.4 rule 5; a float (and
  `concat(float)`) is `dtostrf(x, 4, 2)` like `String::concat(float)`.
- `dtostrf(value, width, prec)` in `src/runtime/avr-float.ts` is a line-by-line
  port of avr-libc 2.0's `ftoa_engine.S` and `dtoa_prf.c`: at most 8
  significant digits, then zeros (`dtostrf(4294967296.0, 4, 2)` →
  "4294967300.00"), "NAN"/"INF"/"-INF" in capitals, negative width →
  left-aligned. It matches the chip character for character (golden table in
  `tests/runtime-fidelity.test.ts`).
- `__m(obj, name, args)`: if `obj` is a string, implement the Arduino String
  API: `length charAt(→ code) indexOf lastIndexOf substring(from, to?) equals
  equalsIgnoreCase startsWith endsWith compareTo toInt toFloat toDouble
  c_str isEmpty toCharArray(buf, len) getBytes`; `indexOf`/`startsWith` args
  may be char codes (numbers) → convert. If `obj` is an array → `length`
  property etc. Otherwise call `obj[name](...args)`; missing → `SketchError`
  ("'name' is not a member of this object").
- `__mut(s, name, args)` → new string for `toUpperCase toLowerCase trim
  replace(a,b) remove(i, n?) concat(x) setCharAt(i, c)`.
- `__charAt(s, i)` → char code (0 if out of range).
- C string functions on JS strings or char-code arrays: `strlen strcpy strncpy
  strcat strcmp strncmp strstr(→ index or -1 is fine) atoi atol atof itoa(n,
  buf, base) ltoa dtostrf(f, width, prec, buf) sprintf(buf, fmt, ...) snprintf`.
  `sprintf` supports `%d %i %u %ld %lu %c %s %x %X %% %5d %-5d %05d`; `%f`
  prints `?` (as on AVR) plus a one-time console warning "sprintf does not
  support %f on Arduino UNO; use dtostrf()". Writing into a char-code array
  mutates it in place (with trailing 0).

### 6.4 `Servo`

`attach(pin, min=544, max=2400)`, `detach()`, `write(v)` (v < 544 → angle
clamped 0..180, else treated as microseconds), `writeMicroseconds(us)`
(angle = map(us, min, max, 0, 180)), `read()`, `readMicroseconds()`,
`attached()`. `write` before `attach` → console warning once. Calls
`board.servoWrite(pin, angle)` and `servoWrite(pin, null)` on detach; updates
the servo-attached counter from core (§5.4).

### 6.5 `LiquidCrystal_I2C` (and `LiquidCrystal`)

`LiquidCrystal_I2C(addr, cols, rows)`; `init()`, `begin()`, `begin(cols, rows)`
(all equivalent: look up `board.i2cDevice(addr)`; if missing, warn once
"No I2C LCD found at address 0xNN (the ZERO1 LCD is at 0x27)" and become a
no-op object), `clear home setCursor(col,row) print println write(code|string)
backlight noBacklight setBacklight(b) display noDisplay cursor noCursor blink
noBlink createChar(idx, uint8_t[8]) scrollDisplayLeft scrollDisplayRight
autoscroll noAutoscroll leftToRight rightToLeft printstr`. `print` uses
`formatPrintArg` and writes each character code; `°` and other non-ASCII
chars → `0xDF`/`?`. `LiquidCrystal(rs, en, d4..d7)` → warn "the ZERO1 LCD is
connected over I2C; use LiquidCrystal_I2C lcd(0x27, 16, 2)" and behave as a
no-op.

### 6.6 `DHT`

`DHT(pin, type)`, `begin()`, `readTemperature(isF=false, force=false)`,
`readHumidity()`, `computeHeatIndex(t, h, isF=true)` (Adafruit formula),
`convertCtoF`, `convertFtoC`. Reads via `board.dhtRead(pin)`; `null` → `NaN`.
Constants `DHT11 11, DHT12 12, DHT22 22, DHT21 21, AM2301 21`.

### 6.7 `Adafruit_NeoPixel`

`Adafruit_NeoPixel(n, pin, type)`; `begin()`, `show()`, `setPixelColor(i, r, g, b)`,
`setPixelColor(i, color)`, `Color(r,g,b,w?)` → `(r<<16)|(g<<8)|b`,
`ColorHSV(hue 0..65535, sat=255, val=255)`, `gamma32(c)`, `gamma8(x)`,
`setBrightness(b)`, `getBrightness()`, `clear()`, `fill(c=0, first=0, count=0)`,
`numPixels()`, `getPixelColor(i)`, `setPin`, `updateLength(n)`, `rainbow(firstHue=0)`,
`sine8`, `canShow()` → true. `show()` before `begin()` → warn once and do nothing.
`show()` calls `board.pixelsWrite(pin, colors)` with brightness applied
(`c * (b+1) >> 8` per channel, like the library). Constants `NEO_RGB 0x06,
NEO_GRB 0x52, NEO_RGBW 0x1b, NEO_KHZ800 0x0000, NEO_KHZ400 0x0100` (values
only need to be distinct numbers).

### 6.8 `NewPing`

`NewPing(trig, echo, maxCm=500)`; `ping()` (µs or 0), `ping_cm()`, `ping_in()`,
`ping_median(n=5)`, `convert_cm(us)` (us/57), `convert_in(us)`. Implements the
trigger (write trig LOW, HIGH, wait 10 µs, LOW) then `board.pulseIn(echo, 1, maxCm*58)`.

### 6.9 `Wire`

`begin()`, `beginTransmission(addr)`, `write(b)`, `endTransmission()` → 0 if
`board.i2cDevice(addr)` exists, else 2 (so the classic I2C scanner works),
`requestFrom(addr, n)` → 0, `available()` → 0, `read()` → -1, `setClock()`.

---

## 7. Peripherals (`src/peripherals`) and `createZero1Board`

Every peripheral is a class implementing the matching interface in
`types.ts`, constructed with its pin(s), attached via `board.addPeripheral(p)`
(the board calls `attach`). Behaviour:

- **LedPeripheral(id, pin)**: on `digitalWrite`/`analogWrite` events for its
  pin: `on = level===1 || pwm>0`, `brightness = pwm!=null ? pwm/255 : level`.
  On `pinMode(pin, INPUT_PULLUP)` a real LED glows faintly: brightness 0.15.
- **RgbPeripheral(pin)**: on `pixels` events for its pin: takes `colors[0]`
  (0 if empty) → r,g,b; `count = colors.length`. Reset → black.
- **BuzzerPeripheral(pin)**: `freq` = tone on its pin if any; else, when
  `config.buzzerType==='active'` and level===1 → `freq = 2500`; else null.
  `level` mirrors the pin.
- **SevenSegPeripheral(data, latch, clk)**: models a 74HC595: on rising edge
  of `clk` → `shift = ((shift << 1) | pins[data].level) & 0xff`; on rising edge
  of `latch` → `latched = shift` and recompute `segments` using
  `config.sevenSegOrder` (Q0=a: bit i → segment i; Q7=a: bit 7-i → segment i)
  and `config.sevenSegCommon` (anode inverts). Reset clears everything.
- **MotorPeripheral(pin)**: `running = level===1` (pwm on A0 is impossible; if
  pwm non-null use `pwm/255` anyway), `speed = running ? 1 : 0`; `tick(now)`
  advances `angle` by `speed * 720 °/s` (mod 360).
- **ServoPeripheral(pin)**: `attached` when a `servo` event with non-null
  angle arrives (null → detached); `target = angle`; `tick(now)` slews `angle`
  toward `target` at 500 °/s (SG90 ≈ 0.12 s/60°). `connected` default true;
  when not connected the servo does not move (target still recorded).
- **PotLdrPeripheral(pin)**: `source` default `'pot'`, `pot` default 512,
  `light` default 60. Presents `adc` on `board.setAnalogInput(pin, adc)`:
  pot → `pot`; ldr → `brighter-higher`: `round(40 + light/100 * 900)`, else
  `round(940 - light/100 * 900)`. Recompute on any setter and on
  `config` change (`refresh()` public method).
- **ButtonPeripheral(id, pin)**: `press()`/`release()` set `pressed` and call
  `board.setDigitalInput(pin, level)` where level follows `config.buttonWiring`:
  pulldown → pressed?1:0; pullup → pressed?0:1; none → pressed?0:null (null =
  floating; Board's digitalRead then applies INPUT_PULLUP). `click(ms=80)`
  presses, `await clock.sleep(ms)`, releases. Re-evaluate on reset.
- **DhtPeripheral(pin)**: defaults 24.0 °C / 55 %; `registerDht(pin, ...)`
  returning `null` when `connected===false`. `set()` clamps to sensor ranges
  (-40..80 °C, 0..100 %), one decimal.
- **UltrasonicPeripheral(trig, echo)**: default 50 cm; watches `digitalWrite`
  on `trig`: a falling edge after a HIGH that lasted ≥ 2 µs (compare
  `clock.micros()` at rising vs falling) counts as a trigger →
  `lastPingAt = clock.now()`. `registerPulseSource(echo, {measure(level)})`:
  returns `round(distanceCm * 58)` when `level===1`, `connected`, and a
  trigger happened within the last 60 ms; otherwise 0. Distance clamped 2..400.
- **LcdPeripheral(addr, cols=16, rows=2)**: implements `LcdDevice` faithfully
  enough: 16×2 DDRAM, cursor advance with wrap to the next line after col 39
  (HD44780 has 40 columns per row; visible 16 — keep a 40-wide buffer and
  apply `scroll`), `clear` (spaces + home), `setCursor` clamps, `createChar`
  stores 8×5 bitmaps, `backlight`, `display`, `cursor`, `blink`, autoscroll,
  right-to-left. Registers itself with `board.registerI2CDevice(addr, this)`
  using `config.lcdAddress`. Default state: backlight **off** until the sketch
  turns it on (as on real hardware after `lcd.init()`… note: real
  `LiquidCrystal_I2C::init()` leaves backlight off; `backlight()` turns it on);
  `backlightSwitch` default true. `setBacklightSwitch(on)`.
- **led-builtin** is a `LedPeripheral('led-builtin', 13)`.

`src/zero1.ts`:

```ts
export interface Zero1Board extends IBoard { /* typed getters */ ledRed: LedPeripheral; ledGreen; ledBuiltin; rgb; buzzer; sevenSeg; motor; servo; potLdr; buttonA; buttonB; dht; ultrasonic; lcd; }
export function createZero1Board(clock: Clock, config?: Partial<BoardConfig>): Zero1Board;
```
It constructs a `Board`, adds every peripheral with the ids in
`PERIPHERAL_IDS`, and returns the board augmented with typed getters
(implemented by wrapping/extending `Board`). `board.config` must be a live
object: the UI mutates it through `applyConfig(partial)` (add this method to
Zero1Board) which updates `config`, calls `refresh()` on pot/LDR and buttons
and re-registers the LCD if the address changed.

---

## 8. UI (`src/ui`, `index.html`)

### 8.1 Layout

Single page, light theme with the PCB purple as the accent (page background
`#f5f3fa`, white cards, borders `#e2dcee`, accent `#7c3aed`, text `#1e1633`,
muted text `#5f5878`, monospace for code and serial; every text colour meets
WCAG AA on its background). Responsive grid:

```
┌─────────────────────────────────────────────────────────────────────┐
│ header: ZERO1 Simulator · [Code|Blocks] · [＋ New] [Examples ▾] [▶ Run] │
│   [■ Stop] [⚙ Settings ▾] [🔗 Share · Ali K… ▾] [∞ Arduino IDE]        │
│   · run status        Settings ▾: Reset the board · Board settings…     │
│                       Share ▾: Hand in to my teacher · Copy link ·      │
│                                Download .ino                            │
├───────────────────────────────┬─────────────────────────────────────┤
│ board SVG (scales to fit)     │ tabs: Code | Serial Monitor |       │
│                               │       Pin Map | Generated JS        │
│ inputs panel:                 │                                     │
│  POT slider · LDR light · DHT │  (CodeMirror editor fills the tab)  │
│  temp/humidity · distance ·   │                                     │
│  module plugs · mute audio    ├─────────────────────────────────────┤
│                               │ console (errors/warnings, status)   │
└───────────────────────────────┴─────────────────────────────────────┘
```
Below 1000 px width the columns stack (board on top). The header (brand,
Code | Blocks switch, the actions, run status) is one row from 1366 px wide
(up to 1439 px the Settings button shows only its ⚙; the run status texts
stay short, e.g. "2 errors", "Error at 1523 ms"); narrower, the actions
move to rows of their own under the brand, the mode switch and the status.
Below 1536 px the brand reads "ZERO1 Simulator" (`.z1-title-short`); the full
name stays in `<title>` and in visually hidden text. Settings and Share are
dropdown menus (fewer header buttons, by teacher request): **Settings ▾** holds
Reset the board and Board settings…, **Share ▾** holds Hand in to my teacher,
Copy link and Download .ino. The Hand in item exists only when the class
platform is configured (`isClassroomConfigured()`, docs/CLASSROOM.md §1.1);
while a name is remembered the Share button reads "Share · Ali Khoury" (the
name part is cut at 14ch with an ellipsis, the `aria-label` and `title` have
it whole).

### 8.2 Board view (`board-view.ts`, `board-svg.ts`) — owner: board-svg

```ts
export interface BoardView { update(): void; destroy(): void; }
export function createBoardView(container: HTMLElement, board: Zero1Board): BoardView;
```
- `board-svg.ts` exports `BOARD_SVG: string` (a `viewBox="0 0 1000 500"`
  drawing built from `docs/PINOUT.md` "Physical layout", with stable `id`s on
  every dynamic element) plus `BOARD_IDS` constants.
- `update()` (called every animation frame by the app) reads
  `board.pins` and peripheral `state`s and patches the DOM: LED glow (opacity +
  radial glow filter), RGB fill colour, buzzer sound-wave arcs when `freq`,
  7-segment segments, motor rotor rotation, servo horn rotation, pot knob
  angle (from `pot`), POT/LDR switch position, LDR brightness ring (from
  `light`), LCD (16×2 grid of characters rendered as `<text>` per cell in a
  5×8-ish monospace font; custom chars rendered as 5×8 pixel rects; backlight
  colour; cursor/blink), ultrasonic distance label + obstacle bar, DHT
  temperature/humidity label, TX/RX activity LEDs (pulse for ~80 ms after a
  `serialTx`/`inject`), built-in L LED (pin 13), power LED always on while
  the sketch is running (pass a `running` flag through `board`? no — read
  `document.body.dataset.running`, set by the app), UNO section.
- Interactions (pointer + keyboard): Button 1/2 (`pointerdown` → `press()`,
  `pointerup/leave/cancel` → `release()`; keys `1`/`2` while the board has
  focus or globally when no input is focused), potentiometer knob (drag
  vertically or horizontally, wheel; ±1023 range; calls `setPot`), POT/LDR
  switch (click toggles `setSource`), Backlight switch (click →
  `setBacklightSwitch`), clicking the LDR opens nothing (light lives in the
  inputs panel), clicking the servo/ultrasonic/DHT header toggles
  `setConnected`. Hover tooltips (`<title>`) with the pin name for every
  module ("Button 1 — D6").
- Must not import the transpiler or executor. Must work with 60 fps updates
  (cache element references; only write attributes that changed).

### 8.3 App (`app.ts`, others) — owner: ui-app

- `main.ts`: creates `RealClock`, `createZero1Board`, mounts `App`.
- Modes (`src/ui/modes/`, docs/PYTHON.md §7.1): the header switch **Code |
  Blocks | Python** (`aria-pressed`, `z1.mode`; an unknown value opens Code
  mode). Everything that differs between the modes lives behind one
  `ModeController` (`code-mode.ts`, `blocks-mode.ts`, `python-mode.ts`,
  interface in `types.ts`): the first tab, the header words (`words`), the
  console words of a run (`runWords`), the texts around the read-only sketch
  (`mirror`: banner, typing toast, Arduino IDE / Upload notes), Share ▾'s own
  file (`programFile`: Download .py), `sketch()` (what Run, live lint and
  every export use; Python translates afresh), `exportWork()`, examples, New,
  links, review. `app.ts` never compares the mode with a literal
  (`tests/app-mode-registry.test.ts`). Each mode keeps its own program
  (`z1.code`, `z1.blocks`, `z1.python`): switching copies nothing and asks
  nothing. In Blocks and Python mode the Code tab shows a second, read-only
  editor (the mirror: focusable, never saved, padlock on the tab, "Code (read
  only)"), with the banner "Made from your … — read only." and **Edit a copy
  in Code mode** (off while a Python program has errors; asks before
  replacing hand-written code, keeps it in `z1.code.previous`, toast with
  Undo for 8 s).
- Editor (`editor.ts`): CodeMirror 6 with `@codemirror/lang-cpp` by default
  (`EditorOptions`: `language`, `storageKey`, `indent`, `ariaLabel`,
  `readOnlyMirror`, `extraExtensions`), a light
  theme and syntax colours matching the app palette, line numbers, tab = 2 spaces, `Ctrl/Cmd+Enter` = Run,
  Esc = Stop, then Tab leaves the editor for 2 s (WCAG 2.1.2). Diagnostics
  from `transpile()` shown with `@codemirror/lint` `setDiagnostics`
  (underlined up to `endLine`/`endColumn` when given). Code is
  persisted to `localStorage` (`z1.code`) and restored on load; an
  `Examples` menu replaces the code (confirm if the current code differs
  from the last loaded example). **New** puts the Arduino IDE's blank sketch
  (`BLANK_SKETCH`, File > New) in the editor, with the same confirmation; in
  Blocks mode it resets the workspace to `DEFAULT_WORKSPACE`, in Python mode it
  puts `BLANK_PYTHON`. Neither stops a
  running sketch. URL hash `#code=<base64url>` loads shared code, `#python=`
  a Python program (Python mode; asks only when the Python program is not
  untouched).
- Python tab (`modes/python-mode.ts`; docs/PYTHON.md §7.3–7.4): exists in
  Python mode only, just before Generated JS, selected on entering the mode,
  after Run with errors, New, an example or a link. The translator, example
  01, the "What works" content and the editor extras come in the lazy
  Python chunk (`python-chunk.ts`, reached only with `import()`), the other
  examples in `python-examples-chunk.ts`, fetched together with it
  ("Loading Python…" meanwhile and "Loading…" in Examples ▾, the
  chunk-failure path on error, also when a swallowed preload error makes
  `import()` give undefined). A one-line note
  above the editor ("… **What works** · Esc then Tab: leave the editor ·
  Ctrl+M: Tab moves focus") opens the What works dialog
  (`python-help-dialog.ts`, `WHAT_WORKS` of src/python/help.ts laid out with
  `textContent`). The Python editor (`z1.python`, 4-space indent,
  `aria-label` "Python program") has ZERO1 Python's completions
  (`python-language.ts`: `zero1Completions` over `API_COMPLETIONS` plus the
  program's own names, never CPython's list), shows non-breaking spaces, and
  cleans up pastes (`python-paste.ts`: curly quotes, invisible spaces,
  leading tabs; inserted as pasted, then fixed as a separate undo step, toast
  "Fixed 3 curly quotes and 12 invisible spaces (Ctrl+Z undoes it)"). Live
  lint (700 ms) translates, puts the sketch (or the placeholder) into the
  mirror, and checks the sketch with `transpile()`: its errors become
  X-sketch-error and its warnings W-sketch on the Python lines they were
  made from (the analogWrite() warning on a pin without PWM is left out when
  the program already has its W-pwm-pin / W-pwm-buzzer / W-pwm-servo).
- Header menus (`menu.ts`: a "Label ▾" trigger with `aria-haspopup="menu"`
  and an absolutely positioned `role="menu"` list, optionally in titled
  groups; opens on click or ArrowDown, arrows / Home / End move between the
  items, Esc closes it and refocuses the trigger, Tab or a pointer down
  outside closes it, an item click closes it then runs its action). Three
  header menus are built on it: Examples (`examples-menu.ts`), **Settings ▾**
  (Reset the board = `App.reset()`; Board settings… = the settings dialog)
  and **Share ▾**. The Share menu acts at once, without a dialog: **Copy
  link** puts the `#code=` / `#blocks=` / `#python=` link on the clipboard and toasts
  "Link copied" (when the clipboard refuses or is missing: a toast and a
  `window.prompt` with the link selected, "Press Ctrl+C to copy the link");
  **Download .ino** saves `sketchFileName()` (`sketch-file.ts`) named after
  the student's remembered name (`currentStudentName()`,
  `src/classroom/session-store.ts`) and toasts the file name; in Python mode
  **Download .py** (before it; `menu.setItems()` on every mode change) saves
  the program as `pythonFileName()` (`zero1_ali_khoury_0928_143210.py`), also
  while it has errors, whereas Download .ino, Arduino IDE and Upload refuse a
  Python program with errors with the toast "Fix the errors in your Python
  program first — see the console."; **Hand in to my
  teacher** (only when the class platform is configured) opens the Hand in
  dialog. The former Share dialog and the email sending (a Google Apps Script
  relay) are gone; `main.ts` removes the relay's two legacy `localStorage`
  keys once.
- Hand in dialog (`handin-dialog.ts`, opened by Share ▾ → Hand in to my teacher, spec
  docs/CLASSROOM.md §1.2 and §4.10). The App builds a `HandinWork` from the
  same `exportWork()` as Share (the sketch, in Blocks mode also the
  workspace JSON, in Python mode also the Python program), plus `unchanged` (the blank sketch / empty program, or an
  untouched example with its title) and `errorCount` from a synchronous
  `transpile()` (a Python program with errors: the count its placeholder
  sketch carries). The dialog loads `src/classroom/student.ts` with `import()`
  on first open and calls `restore()`; nothing is downloaded while no session
  is saved. One short flow (simplified by teacher decision, 2026-09-27):
  Loading → Code (class code, checked locally with `normalizeClassCode` /
  `codeProblem`) → Name (first name + last name, prefilled with the name this
  device gave before; Hand in = `join()` then the send) → Success ("✓ Handed
  in · 14:32 · Your teacher can see it now."). A device that remembers a
  name opens on Ready ("Hand in as **Ali Khoury** to class **BKT-4M9**" with
  Hand in and a small Change link, which is also the shared-computer check).
  The untouched example / blank sketch is one confirm dialog; the error-count
  note is shown. A hand-in keeps one `newHandinId()` per draft so Try again
  after a timeout reuses it; after the request timeout the status reads
  "Checking whether it arrived…". Every error shows its §1.5 text;
  `device_removed`, `class_deleted` and `handins_closed` get their own button.
  `onSessionChange` updates the header label ("Share · Ali Khoury"). A `#class=<code>` link
  (`takeHashPayload`, also on `hashchange`) opens the dialog with the code
  prefilled, or shows the "Classes are not set up on this site." toast when
  not configured. All class strings are rendered with `textContent`.
- Arduino IDE dialog (`arduino-ide-dialog.ts`, opened by the "Arduino IDE"
  button with the editor text, or in Blocks and Python mode the sketch made
  from the program — the same `exportWork()` as Share — with the mode's note:
  "This is the Arduino sketch made from your Python program (the code in the
  Code tab). The board runs this sketch: it cannot run Python itself."). A web page cannot start
  the desktop IDE (it has no URL protocol), so the dialog offers three ways:
  **Download sketch (.ino)** saves `sketchFileName()` (`sketch-file.ts`:
  `zero1[_<name>]_MMDD_HHMMSS.ino`) and lights up three numbered steps that
  name the file: open it (the IDE installers open `.ino` files), click OK
  when the IDE offers to move it into a `<name>/` sketch folder, choose
  Arduino Uno + port and Upload. Names are unique per download because a
  second `name.ino` would become `name (1).ino` in the Downloads folder (a
  name IDE 2 refuses) or clash with the `name/` folder made from the first
  one. **Save into my Arduino folder…** (only where `showDirectoryPicker`
  exists: Chrome, Edge; `id: 'zero1-sketchbook'`, `startIn: 'documents'`)
  writes `<name>/<name>.ino` into the picked folder, ideally the sketchbook
  *Documents › Arduino*, which File › Open (and File › Sketchbook) opens with
  no prompt; a cancelled picker says nothing, a refused or failed save
  suggests Download. **Copy code** for File › New Sketch + paste (every IDE
  version). A note sends Chromebook users to the Arduino Cloud Editor
  (app.arduino.cc → Create → Import). Status line (`aria-live`) and Close;
  Esc closes; every `open()` starts with no status and the steps reset.
- Run: `mode.sketch()` (a Python program with errors: its errors in the
  console on Python lines, "N errors" in the header, the Python tab and the
  cursor on the first one) → `transpile()` → on error show diagnostics in the editor and console,
  else `board.reset()`, `executor.run(js)` (Python: the line map composed
  through the source map, runtime messages through `pythonize()`, the
  program's warnings in the console on Python lines); buttons reflect status; the
  header shows a running indicator and elapsed `millis()`. The console says
  "Sketch started." / "Sketch stopped after N loop() calls." (Python:
  "Program started." / "Program stopped after N rounds of the while True
  loop."). A Python program without `while True:` (`endsAfterSetup`) is
  ended by the frame loop once `setup()` returned and no tone sounds (2 s of
  board time at most): "Program finished (it has no while True loop).",
  "Finished at N ms". A program that calls `input()` (`usesInput`) shows the
  Serial Monitor with the cursor in its send box.
  Stop: `executor.stop()`. Reset (Settings ▾ → Reset the board): stop +
  `board.reset()` + clear serial.
- Serial monitor (`serial-monitor.ts`): output area (monospace, autoscroll
  toggle, clear, max 5000 lines), input line + Send (Enter), line-ending
  select (No line ending / Newline / Carriage return / Both; default
  Newline; in Python mode forced to Newline and disabled, `forceNewline()`,
  the student's choice comes back in the other modes), baud label ("9600 baud" from `Serial.begin`, display only).
  Output arrives via `board.serial.onTx`. Show a hint when the sketch printed
  nothing yet. The hint and the send box name what prints and reads
  (`setWords()`, the mode's `runWords.serial`): the sketch and
  `Serial.println("Hello");` in Code and Blocks mode, "your program" and
  `print("Hello")` in Python mode. Output while the tab is hidden puts a dot on the tab (its
  `aria-label` then reads "Serial Monitor, new output"); in Python mode the
  first such output of a run also puts "print() output is in the Serial
  Monitor tab" with the link "Open the Serial Monitor" into the console.
- Pin map (`pinmap.ts`): the lesson table (Sr.No, Part, Description, Pin)
  plus live `Mode` and `Value` columns (`value` = level, PWM duty, tone Hz,
  servo angle, analog value as appropriate) refreshed 10×/s.
- Generated JS tab: read-only view of the transpiled code (for teachers).
- Console panel (`console-panel.ts`): messages from `onConsole` with level
  colours; clicking a message with a line jumps to it by the message's
  `source`: `'python'` opens the Python tab (switching to Python mode when
  needed) and moves the Python editor there, `'sketch'` the Code tab of the
  current mode ("Go to line N in the Python program" / "… in the sketch").
  A message may end with an action button (the print() hint).
- Inputs panel (`controls.ts`): POT slider (0..1023, two-way with the knob),
  LDR light slider (0..100 %) with sun/moon icons, DHT temperature (-40..80)
  and humidity (0..100) sliders, ultrasonic distance slider (2..400 cm),
  checkboxes "Servo plugged", "Ultrasonic plugged", "DHT22 plugged",
  "Mute buzzer".
- Settings (`settings.ts`, a dialog opened by Settings ▾ → Board settings…):
  the `BoardConfig` options with plain explanations, persisted to
  `localStorage` (`z1.config`), applied via `board.applyConfig`.
- Audio (`audio.ts`): WebAudio square-wave oscillator following
  `buzzer.state.freq` (start on first user gesture; gain 0.05; mute toggle).
- Examples menu (`examples-menu.ts`, on `menu.ts`): grouped list from `src/examples/index.ts`.
- Keyboard: `Ctrl/Cmd+Enter` run, `Esc` stop — both ignored while the
  Settings, Hand in, Arduino IDE, Upload or What works dialog is open (Esc then closes the
  dialog), and Esc is ignored while a header menu is open (it closes the menu).
- Header (docs/PYTHON.md §7.14): at 1366–1439 px the Settings and Arduino IDE
  buttons show their icons only (`aria-label` and tooltip unchanged), so
  brand, mode switch, the seven actions and the run status stay on one row.
  While Upload to board is shown, Upload and Arduino IDE show their icons only
  from 1366 to 1759 px (`.z1-toolbar:has(…upload:not([hidden]))`), which keeps
  one row with "Share · <name>" and "Error at 12345 ms" (measured in Chromium
  at 1366, 1440, 1536 and 1600 px); below 1366 px the
  actions get a row of their own. Entering a mode toasts its name ("Python
  mode").
- Upload to board (`src/upload`): `getSketch()` gives an `UploadPayload`
  (in Blocks and Python mode with the mode's note; Python adds `successNote`,
  `mapLine`, `source: 'python'` and `sketchError`, so compile errors point at
  Python lines with the X-sketch-error text, except "too big", shown as is)
  or `{ error }`, toasted as is.
- Mode from links: a `#code=` / `#blocks=` / `#python=` link decides the mode at start-up
  (`this.mode = fromLink.kind`), so a saved Blocks mode never hides a shared
  sketch; only without a link is `loadMode()` used.
- Review mode (`isReviewFrame()`: `location.hash === '#review'` inside an
  opaque origin, i.e. review.html's `<iframe sandbox="allow-scripts">`): the
  App reads and writes no storage (editor `persist: false`, no mode / blocks /
  mute / config writes; `main.ts` skips `loadConfig()`), hides New, Examples,
  Share (Hand in included) and Arduino IDE (the Settings menu stays), has no
  `hashchange` listener, posts
  `{ type: 'z1-review-ready' }` to the parent and accepts `{ type: 'z1-review',
  payload }` only from `window.parent` on the site's own origin; the payload
  decides the mode (`ModeController.review()`): Blocks from `workspaceJson`;
  Python (docs/PYTHON.md §7.13) shows the payload's `python` read-only in the
  Python tab and today's translation in the Code tab; when that is not the
  handed-in `code`, a banner above the program ("The simulator was updated
  since this hand-in: the Code tab shows today's translation.") offers **Use
  the handed-in sketch** (the mirror and Run then use `code`, on sketch
  lines). Otherwise (no workspace / no Python, the chunk cannot load, the
  program has errors today) the handed-in sketch in Code mode — read-only for
  Python — with the banner "Made from the student's blocks." / "… Python
  program." (the Code tab's banner uses the same words over the mirror in the
  frame). The Upload button stays hidden (disposed before detection ends).
  Nothing runs until Run. A `#review=` /
  `#rid=` hash on the site origin is sent to `./review.html` with
  `location.replace` (docs/CLASSROOM.md §3.4).
- X1 hardening: `codegen.ts` refuses the member names `constructor`,
  `prototype`, `__proto__`, `caller`, `callee`, `arguments`, `call`, `apply`,
  `bind` and any `__` name in members, method calls and constant string keys
  ("'name' is not available in the simulator"); `__m` / `__mut` in
  `src/runtime/libs/strings.ts` refuse the same names and any function
  inherited from `Object.prototype` / `Function.prototype`.
- Update prompt: `vite:preloadError` (and a Blockly or Python chunk that cannot be
  fetched while online) flushes every mode's autosave and shows the
  banner "The simulator was updated. Reload the page to continue (your work is
  saved)." with a Reload button (`data-slot="update"`); the Hand in dialog
  reports `app_updated` errors to it through `onAppUpdated`.
- The class platform's data layer is §12 (A); the teacher dashboard and the
  review page are §13 (C).
- `index.html`: minimal shell with `<div id="app">`, meta viewport, title
  "ZERO1 Smart Board Simulator", favicon as inline SVG data URI.
- `style.css`: imported from `main.ts`.

---

## 9. Examples (`src/examples`) — owner: examples

Each example is a `.ino` file with a header comment (title, what it shows,
which board parts, expected behaviour) and is listed in `index.ts`:

```ts
export interface Example { id: string; title: string; group: string; description: string; source: string; }
export const EXAMPLES: Example[];
```
(`source` imported with `?raw`). Groups & sketches (write them in the style a
teacher would show a beginner: comments, constants for pins, small functions):

1. **Outputs** — `01_blink_red.ino` (red LED on A1 blinks 1 Hz);
   `02_traffic_lights.ino` (red/green alternate + built-in L);
   `03_buzzer_melody.ino` (tone() melody on D8, note table);
   `04_rgb_rainbow.ino` (NeoPixel on D9, hue cycle with ColorHSV);
   `05_seven_segment_counter.ino` (74HC595 digit counts 0-9, digits table,
   shiftOut, MSBFIRST);
   `06_servo_sweep.ino` (Servo on D4 sweep 0-180);
   `07_dc_motor.ino` (motor via A0, on 2 s / off 2 s).
2. **Inputs** — `10_button_led.ino` (button A lights red, button B lights green);
   `11_button_toggle.ino` (edge detection + debounce toggles LED);
   `12_potentiometer_serial.ino` (reads A3, prints value and voltage, uses map);
   `13_ldr_night_light.ino` (threshold turns LED on when dark; explains the POT/LDR switch);
   `14_dht22_serial.ino` (temperature/humidity every 2 s, isnan check);
   `15_ultrasonic_distance.ino` (trig/echo with pulseIn, cm formula);
   `16_serial_echo.ino` (reads the Serial Monitor, echoes and reacts to commands `on`/`off`).
3. **Display** — `20_lcd_hello.ino` (LiquidCrystal_I2C 0x27, init, backlight, setCursor, print, millis counter);
   `21_lcd_custom_char.ino` (createChar heart + degree symbol with temperature).
4. **Projects** — `30_parking_sensor.ino` (ultrasonic + buzzer beep rate + RGB colour);
   `31_greenhouse.ino` (DHT22 + LCD + motor as fan + red LED alarm);
   `32_reaction_game.ino` (buttons + 7-segment countdown + buzzer + Serial score);
   `33_dimmer.ino` (potentiometer → servo angle + RGB brightness + 7-seg level 0-9);
   `34_i2c_scanner.ino` (Wire scanner printing found addresses — expected 0x27).

Part-by-part groups (listed after the four lesson groups, one short beginner
sketch per item of the teacher's list; items that only differed by the button
are merged into one sketch with both buttons; "Button 1" / "Button 2" are the
buttons the teacher calls A / B, on D6 / D7):

5. **LED** — `40_led_blink_red.ino` (500 ms on / 500 ms off); `41_led_red_green.ino`
   (red and green alternate every 500 ms, never both on);
   `42_led_blink_10_times.ino` (for loop in setup() blinks 10 times, prints `Done`).
6. **Buzzer** — `43_buzzer_short_beeps.ino` (100 ms beep, 400 ms silence, active
   buzzer via digitalWrite); `44_buzzer_led_10_times.ino` (buzzer + red LED
   together, exactly 10 times, then `Done`).
7. **Push Button** — `45_buttons_leds.ino` (red LED while Button 1 is held, green
   LED while Button 2 is held); `46_buttons_beeps.ino` (Button 1 → one 100 ms
   beep, Button 2 → one 1 s beep; waits for the release so holding does not
   repeat).
8. **RGB LED** — `47_rgb_red_green_blue.ino` (red → green → blue, 1 s each);
   `48_rgb_buttons.ino` (Button 1 red, Button 2 green, else off).
9. **LDR** — `49_ldr_serial.ino` (prints `Light: <adc>` every 500 ms);
   `50_ldr_red_green.ino` (red below 500, green at 500 or above, prints the
   value every 500 ms); both tell the student to flip the POT / LDR switch to LDR.
10. **Seven-Segment** — `51_seg_buttons_count.ino` (Button 1 → 1, 2, 3, 4, one
    per second, then blank; Button 2 → 7 … 1, then blank; Serial prints each
    digit); same `DIGITS[]` table and `shiftOut()` as `05`.
11. **Ultrasonic** — `52_ultrasonic_serial.ino` (distance every 500 ms);
    `53_ultrasonic_red_green.ino` (red < 10 cm, green otherwise);
    `54_ultrasonic_beep_rate.ino` (50 ms beeps, pause =
    `constrain(distance * 10, 50, 1000)` ms).
12. **Servo Motor** — `55_servo_buttons.ino` (starts at 0°, Button 1 → 0°,
    Button 2 → 90°, prints the angle); `56_servo_ultrasonic_10_times.ino`
    (10 rounds 1 s apart: < 10 cm → 180° else 0°, then back to 0° and `Done`).
13. **DHT Sensor** — `57_dht_serial.ino` (temperature and humidity on one line
    every 2 s); `58_dht_servo_slow.ino` (> 28 °C → servo 0° → 180° one degree
    every 15 ms, else 0°).
14. **DC Motor** — `59_motor_buttons.ino` (Button 1 → 5 runs of 500 ms with
    500 ms stops, `Short run 1` … `Short run 5`; Button 2 → 5 runs of 1 s with
    1 s stops, `Long run 1` … `Long run 5`; then `Done`). The board wires only
    IN1 of the motor driver (A0), so the motor cannot run backward: Button 2
    changes the rhythm instead of the direction and the header explains why.

Every sketch must transpile and run in the simulator; the examples agent
cannot run them yet, so keep to the subset in §4.2 and the APIs in §5–6, and
describe in the header comment the exact expected observable behaviour (used
by the test agents).

---

## 10. Tests (`tests/`)

`tests/helpers.ts` (integration):

```ts
export function makeBoard(config?: Partial<BoardConfig>): { board: Zero1Board; clock: VirtualClock };
export async function runSketch(source: string, opts?: { stopAfterMs?: number; maxLoops?: number; config?; before?: (board) => void }): Promise<{ board; clock; console: ConsoleMessage[]; serial: string; status: ExecutorStatus; js: string }>;
```
Module tests live next to their module name: `tests/parser.test.ts`,
`tests/codegen.test.ts`, `tests/board.test.ts`, `tests/executor.test.ts`,
`tests/libs.test.ts`, `tests/peripherals.test.ts`, `tests/examples.test.ts`.

---

## 11. Block programming

See docs/BLOCKS.md (block set, Arduino generator rules, UI behaviour, tests, examples).

---

## 12. Classes: data layer (`src/classroom`, `src/firebase-config.ts`, `src/share-link.ts`) — owner: A

The class platform (docs/CLASSROOM.md) has no server: Firebase Authentication and
Cloud Firestore, guarded by `firestore.rules`, and client code. The data layer is
the part between the UI (Hand in dialog, teacher dashboard) and Firebase.

```
src/firebase-config.ts        public web config, APP_CHECK_SITE_KEY, CLASSROOM_DEFAULTS
src/share-link.ts             #code= / #blocks= / #class= links, review payload (pure)
src/classroom/
  model.ts                    types, LIMITS, class codes, student names (cleanName, nameProblem, nameKeyOf),
                              cleanLine, deviceLabel, document readers (pure)
  codec.ts                    encodeContent / decodeContent: gzip bytes or plain strings, capped inflate (pure)
  errors.ts                   ClassroomError, toClassroomError, withTimeout, the text tables, quotaResetText (pure)
  session-store.ts            z1.classroom (v2: code + first/last name) in localStorage, the last code (pure)
  firebase.ts                 isClassroomConfigured(), lazy loaders of the two named apps, App Check, emulators
  student-sdk.ts              the ONLY import of firebase/app, auth, firestore/lite, app-check (loaded with import())
  teacher-sdk.ts              the ONLY import of firebase/app, auth, firestore, app-check (loaded with import())
  student.ts                  createStudentApi(): restore, findClass, join (create or rename the member doc), handIn (idempotent retry), forget
  teacher.ts                  createTeacherApi(): sign-in, classes, members, hand-ins (by nameKey), retention, deletion
```

- **Bundle boundary.** Nothing reachable by static imports from a page entry imports
  `firebase/*` except with `import type`; `firebase.ts` loads the two barrels with
  `import()`. `tests/bundle-boundary.test.ts` scans the sources; `scripts/check-bundle.mjs`
  (run by `npm run build`) checks the emitted chunks and the gzip sizes.
- **Two named apps.** `z1-student` (Firestore Lite, anonymous auth persisted in IndexedDB)
  and `z1-teacher` (full SDK with the memory cache, session-only auth persistence). A
  teacher session and a student session never replace each other.
- **Names, not a roster.** A student's `firstName` / `lastName` / `nameKey` live on the
  member doc (`members/{uid}`, created by the student, renamed in place on "Change") and
  are copied onto every hand-in; the rules require the copy to match the member doc.
  Anyone with the code can hand in under any name (CLASSROOM §3.5).
- **Hand-in batch.** One document per hand-in plus the member counter tick, in one batch
  whose id the dialog makes before sending (`newHandinId()`) and reuses on retry; the rules
  tie the two writes together and refuse a second commit with the same id. After a timeout
  the API reads the member doc: `lastHandinId === id` means it arrived.
- **Errors.** Every method rejects with a `ClassroomError` whose `message` is the text of
  the §1.5 table for its side (student or teacher); listeners report through `onError`.
- **Configuration.** `src/firebase-config.ts` holds the public web config; while its four
  keys are empty the platform is "not configured" and never downloads Firebase.
  `vite --mode emulator` (`.env.emulator`) points both apps at the local emulators.
- **Tests.** `tests/classroom-*.test.ts`, `tests/share-link.test.ts` and
  `tests/bundle-boundary.test.ts` run with `npm test` (fakes only). `tests-emulator/`
  holds the security-rules suite (62 cases), the API integration tests and the end-to-end
  flow; they need the Firebase emulators: `npm run test:emulator` (Java 21), or
  `npm run test:rules` for the rules alone. `tests-emulator/mutations.sh` checks that each
  weakened copy of the rules in `tests-emulator/mutations/` makes a test fail.

## 13. Teacher dashboard and review page (`teacher.html`, `review.html`, `src/teacher`, `src/review`) — owner: C

Two extra Vite pages next to the simulator (`vite.config.ts`, `rollupOptions.input`;
`base: './'` keeps every link relative for GitHub Pages). Both reuse the tokens and the
`.z1-btn` / `.z1-dialog` / `.z1-setting` / `.z1-table` / `.z1-toast` classes of
`src/ui/style.css` (imported, never edited) and add their own stylesheet (prefix `z1t-`
for the dashboard, `z1r-` for the review page). Everything is vanilla DOM; every string
that comes from a student or a teacher is rendered with `textContent` (CLASSROOM §3.4).

```
teacher.html, src/teacher/main.ts  entry: styles, then mountDashboard(); the TeacherApi (and the
                                   Firebase SDK behind it) is loaded at page load, never on a click
src/teacher/
  dashboard.ts    mountDashboard(root, options): the not-configured, signed-out and main views, the
                  top bar with the class switcher, the error banner (+ Retry), the toast, the class
                  list, Create class, Sign out, Delete my data; parks the previous class's session
  context.ts      DashboardContext: API, clock, storages, download / copy / confirm hooks, banner,
                  toast, save() ("Saving…", the 10 s waiting text, SAVE_FAILED), tracked timers
  session.ts      ClassSession: watchClass + watchTodayHandins (or the one-off period view), the
                  members listener while a view needs it, the decode cache, the New/Seen marks (by
                  nameKey), the memoised review links (one #rid= handoff per hand-in), loadAll()
  class-page.ts   the class header (code, hand-ins switch), Show to the class overlay, the three
                  tabs, the retention check (its download pages through every old hand-in)
  overview.ts     T5: period/sort, "n students handed in", one row per name ("Last, First", grouped
                  by nameKey), Open / .ino, zips
  detail.ts       T6: versions, Load older (studentHandins by nameKey), Open / .ino / Copy, Remove
                  computer, Delete; openLink() and inoButton() shared with the Overview
  feed.ts         T7: All hand-ins, filter by student
  settings.ts     T9: class name, hand-ins switch, keepWeeks, Delete class ("Download everything
                  first" pages through every hand-in; code confirm, progress, Finish deleting)
  handins.ts      DecodeCache, overviewRows() by nameKey, review payload / link, .ino names, zip entries
  zip.ts          makeZip(): store-only zip, CRC-32, UTF-8 names; uniqueName()
  format.ts       time texts, storage keys (z1.teacher.*), storage access that never throws, el()
review.html, src/review/main.ts, page.ts, review.css
                  mountReview(): banner + Download .ino + Copy code, then
                  <iframe sandbox="allow-scripts" src="./index.html#review">; the ready/payload
                  handshake checks event.source and origin 'null'; #review= or #rid= (localStorage
                  handoff `<created ms>:<payload>`, dropped after a day)
```

- **No await between a click and its effect.** Every record is decoded once when it
  arrives (`DecodeCache`); Open is a real `<a target="_blank" rel="noopener noreferrer">`
  whose `href` is computed at render time (a large payload writes its `z1.review.<rid>`
  handoff once, memoised per hand-in on the session), `.ino` and Copy are enabled only once decoded, and
  `signIn()` / `deleteAccount()` are the first statement of their click handlers.
- **Listeners.** One `watchClasses` while signed in; the open class has `watchClass` and,
  in the Today view, `watchTodayHandins`; `watchMembers` runs only while a detail panel is
  shown (device labels). Switching class keeps the previous session for 10 minutes (one at
  most). Sign out stops everything and clears the review handoffs.
- **Storage.** `z1.teacher.lastClass` (re-opened only when it is one of the signed-in
  teacher's classes), `z1.teacher.period.<code>`, `z1.teacher.seen.<code>`
  in localStorage, `z1.teacher.pruned.<code>` in sessionStorage; all reads and writes are
  wrapped, so a blocked storage only loses the conveniences.
- **Tests.** `tests/teacher-dashboard.test.ts` (happy-dom, with `tests/fakes/fake-teacher-api.ts`:
  an in-memory TeacherApi with `emit*` helpers, a `ready` deferred, call recording and
  `failNext`), `tests/review-page.test.ts` and `tests/zip.test.ts`. The build check
  (`scripts/check-bundle.mjs`) confirms that neither page's static import graph contains
  Firebase.

---

## 14. Python translator (`src/python`) — owner: A (Python mode)

Python mode (docs/PYTHON.md) never runs Python: `pythonToArduino(source)` translates a
MicroPython-style program into an Arduino sketch, and everything downstream (Run, the Code tab,
hand-in, share, review, Open in Arduino IDE, Upload) works on that sketch. The UI reaches the
translator only through the lazy chunk `src/ui/python-chunk.ts` (docs/PYTHON.md §7.16); nothing
outside `src/python` imports more than `src/python/index.ts`.

```
normalize → tokenize (tokens.ts) → parse (parser.ts, ast.ts)   syntax errors §5.1: one, then stop
  → resolve (scope.ts)     scopes, imports, API bindings, main-loop split, C++ names (reserved-names.ts)
  → analyzeFlow (flow.ts)  CFG per scope, reaching definitions, webs, definite assignment, dominators
  → infer (kinds.ts)       kinds of webs / parameters / returns / expressions, variables and storage (D1–D3)
  → check (check.ts)       every NA- / E- / W- rule of §5 (messages.ts); errors → the T9 placeholder
  → emit (emit.ts)         the sketch + SourceMap (sourcemap.ts), helpers (helpers.ts)
```

- **Entry.** `translate.ts`: `pythonToArduino` never throws (X-internal); `analyze()` returns
  the typed program and the diagnostics (errors first, at most 20 + X-too-many; warnings only
  without errors). A program with errors gets `pythonPlaceholder(n)` (`src/sketch/placeholder.ts`);
  one without errors is emitted (X-sketch-too-long above 50,000 bytes).
- **Emitter** (`emit.ts`, docs/PYTHON.md §4.7): header, the module docstring and the comments
  of the imports the program starts with, includes, zero1 pin constants (`src/sketch/pins.ts`),
  library objects, globals (D1: an initialiser when the first definition is a constant that runs
  before any use), functions in Python order, `setup()` (the statements before the final
  `while True:`), `loop()` (its body; `continue` there is `return;`), then the helpers. Locals are
  declared where kinds.ts placed them (D2/D3). Expressions are printed with C++ precedence
  (`src/sketch/order.ts`), every int is a `long` (N1: `L` literals, `(long)` casts of narrower
  readings), `//` `%` `**` and guarded divisions go through the helpers (N3–N5). The board API is
  lowered by the member ids of `api.ts` (`Pin.on`, `time.sleep_ms`, …). Statements that can never
  run (after an endless loop, a `return`, `break` or `continue`) are left out with a comment.
  Python's order of evaluation (E4): where C++ leaves it open (operands, arguments), the parts
  with effects — calls of own functions that have effects, `input()`, `pop()` — that could run
  out of order are worked out first into `value1`, `value2`, … (`order()` / `hoist()` through
  `ctx.pre`), and print() / putstr() work out their values before printing when a value with
  effects comes after printed text. E3 without warnings: a local or parameter the C++ never reads
  gets `(void)name;` (`quietUnused()`), overflowing literal arithmetic is written as its 32-bit
  result.
- **Helpers** (`helpers.ts`, §4.8): the fixed texts verbatim, the list helpers generated per
  element type from one template (`…L` long, `…F` float, `…S` String, `…B` bool, `…C` colour,
  `…P` Pin, `…Y` byte); `helperTexts(names)` adds what each needs, in `helperOrder`, each once.
  `Serial.begin(9600)` is written when the program prints, reads, or uses a helper that can stop
  it (`pyFail` prints `Line N: <Python error>`, flushes and calls `abort()`).
- **Source map** (`sourcemap.ts`, §4.9): every sketch line records the first line of the Python
  statement it was made from (0 for scaffolding and helper bodies); `composeJsLineMap()` gives the
  Executor Python lines; `pythonizeRuntimeMessage()` turns an `abort()` report into the last
  `Line N: …` line of the Serial Monitor, so a runtime stop has its Python line on every browser.
- **Runtime texts in Python words** (`messages.ts` `RUNTIME_WORDINGS`, §5.9): the simulator's own
  console texts that a translated program can still trigger (a `Pin` switched without
  `Pin.OUT`, a pin or ADC number worked out while running, PWM
  on pins 9/10 next to a `Servo()`, `servo.angle()` after `detach()`, an LCD at another address,
  the LCD or RGB LED used by a function before the line that makes it) are reworded by
  `pythonizeRuntimeMessage()`; everything else passes through. A new console text in
  `src/runtime` that Python can reach needs an entry (and a case in `tests/python-runtime.test.ts`).
- **PWM.** `duty_u16(v)` is `analogWrite(p, v / 256)`: 65535 → 255 and 32768 → 128, the first
  value that switches a pin without PWM on, as W-pwm-pin says (it was `/ 257` before 2026-09-30).
- **Examples** (`src/examples/python`, §9): 33 `NN_name.py` files imported with `?raw`; `index.ts`
  lists the 13 lessons (`PYTHON_LESSON_EXAMPLES`), `parts.ts` the 20 part-by-part examples 40–59
  (`PYTHON_PART_EXAMPLES`); `PYTHON_EXAMPLES` is both, in the order of `EXAMPLES`. Example 01,
  the first-visit program, is also exported alone (`first.ts`, `PYTHON_FIRST_EXAMPLE`): the Python
  chunk carries it, the other 32 are a lazy chunk of their own (`src/ui/python-examples-chunk.ts`). Each has the id, title and group of its `.ino` twin, a
  module docstring with the twin's four header sections in Python words, the twin's behaviour,
  and translates with no warning. The sensor examples 52–58 catch `OSError` (no echo, DHT22
  unplugged) where their twins print a value; those branches have Python-only tests.
- **Tests.** `python-tokens`, `python-parser`, `python-resolve`, `python-flow`, `python-kinds`,
  `python-errors` (the §5 table and its meta-tests), `python-api`, `python-reserved`,
  `python-emit` (goldens `tests/fixtures/python/<case>.py` → `<case>.ino`, `UPDATE_GOLDEN=1`
  regenerates; T1–T9 compared with docs/PYTHON.md §4.10; every golden transpiles without
  warnings and, with the WebAssembly toolchain built, compiles with avr-g++ `-Wall -Wextra`
  without warnings), `python-helpers` (§4.8 verbatim; each helper's value in the simulator against
  Python's; every runtime stop), `python-sourcemap`, `python-contract`,
  `python-runtime` (every row of §2.13 on the simulator, the runtime stops of §5.6 with their
  console error and `Line N:` text, `input()`, the finish of a program without `while True:`,
  every `RUNTIME_WORDINGS` entry against the real text) and `python-cpython` (the print-only
  programs of `tests/fixtures/python/cpython/` against CPython 3.12's output, recorded by
  `node scripts/record-cpython.mjs`; lines that differ are listed in `<name>.deviations` with
  their §2.13 row and the board's line).
  **Twin behaviour** (§10.4): `tests/example-behaviour.ts` holds `EXAMPLE_BEHAVIOUR`, the
  behaviour checks of every example keyed by example id, and `describeExampleBehaviour(label,
  sourceOf)`, which registers the checks of the examples `sourceOf(id)` gives a sketch for.
  `examples.test.ts` runs it on the `.ino` sources, `python-examples.test.ts` on the sketches made
  from the Python examples (plus their list, headers, translation without warnings, a clean
  4-second run and the Python-only checks), so both twins pass the same assertions.
  `npm run test:hardware-sim` adds `tests-hardware-sim/python-board.test.ts`: every golden and
  every Python example compiles without warnings and fits the UNO; the helpers, the deterministic
  goldens and examples print the same Serial output on avr8js as in the simulator (distances, and
  the numbers made from them, within 1 cm: the chip times the echo a little differently); `duty_u16()`
  and `len()` of accented text behave on the chip as the warnings say.
