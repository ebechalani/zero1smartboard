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
    values.ts                   FloatBox, __flt, __chr, StopSignal, SketchError (given)
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
    controls.ts settings.ts examples-menu.ts audio.ts style.css             [ui-app]
  examples/
    *.ino, index.ts             example sketches + manifest                 [examples]
tests/
  *.test.ts                     Vitest (node environment)
  helpers.ts                    makeBoard(), runSketch()                    [integration]
docs/
  ARCHITECTURE.md PINOUT.md
index.html                                                                  [ui-app]
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
        __tick, __array, __cstr, __chr, __flt, __str, __m, __mut, __charAt } = __rt;
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
   wrapping).
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
     `(int)3.7` → 3. `String`/class/array assignment: no wrapper.
   - `++`/`--`: prefix `++x` → `(x = __T(x + 1))`; postfix `x++` in a
     value context → `(x = __T(x + 1), __T(x - 1))`; in a statement/for-update
     context → `x = __T(x + 1)`. For `unknown`/float types use `x++` directly.
   - Shifts and bitwise ops are emitted as JS operators (32-bit); the
     assignment wrapper restores the C width.
   - `int` literal larger than 16 bits has type `long`; suffix `L`/`UL` too.
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
     `char`-typed → `__chr(x)`; `float`/`double`-typed → `__flt(x)` **only**
     when the callee name is `print`, `println`, `String`, or `write`. Never
     wrap arguments to user-defined functions.
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
`map`/`random`→long, `constrain`/`min`/`max`/`abs`→type of first argument
(`min`/`max`: common type), `sqrt sq pow sin cos tan asin acos atan atan2 exp log log10 floor ceil round fabs fmod trunc`→double
(but `sq(int)`→int, `abs(int)`→int, `round`→long), `shiftIn`→unsigned char,
`bit bitRead lowByte highByte`→int/unsigned char, `word`→unsigned int,
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
__idiv(a,b) : b===0 → throw SketchError('division by zero'); Math.trunc(a/b)
__imod(a,b) : b===0 → throw; a % b  (JS semantics equal C for integers)
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
- `delay(ms)`: `await clock.sleep(ms, signal)` then `throwIfStopped()`. Clamp
  negative to 0. `delayMicroseconds(us)`: sleep(us/1000).
- `millis()` = `Math.floor(clock.now())`, `micros()` = `clock.micros()` (both wrapped `__u32`).
- `tone(pin, freq, duration?)`: board.tone; if duration given, schedule
  `noTone(pin)` after `duration` ms via `clock.sleep` (do not await it; cancel
  if another tone starts). `noTone(pin)`.
- `pulseIn(pin, level, timeout = 1_000_000)` → board.pulseIn.
- `shiftOut(dataPin, clockPin, order, value)`: for each of 8 bits (MSBFIRST:
  bit 7 first): `digitalWrite(dataPin, bit); digitalWrite(clockPin, HIGH); digitalWrite(clockPin, LOW)`.
  `shiftIn` symmetric reading `digitalRead(dataPin)` after clocking HIGH.
- `map(x, inMin, inMax, outMin, outMax)` with **integer** arithmetic:
  `__idiv((x - inMin) * (outMax - outMin), (inMax - inMin)) + outMin` on
  truncated integer inputs. `constrain`, `min`, `max`, `abs`, `sq`, `pow`,
  `sqrt`, trig, `round` (half away from zero), `random(max)`,
  `random(min,max)` (exclusive max, seeded PRNG — mulberry32 — `randomSeed(s)`),
  `bit`, `bitRead`, `lowByte`, `highByte`, `word`, char classification
  functions, `isnan`, `isinf`, `interrupts`/`noInterrupts` (no-op),
  `attachInterrupt(n, isr, mode)`/`detachInterrupt` (store, warn once
  "external interrupts are not simulated on this board"), `digitalPinToInterrupt`,
  `analogReference` (no-op), `yield()` (`ctx.tick()`), `F(s)` → s.
- Constants: `HIGH 1, LOW 0, INPUT 0, OUTPUT 1, INPUT_PULLUP 2, A0..A5 14..19,
  LED_BUILTIN 13, DEC 10, HEX 16, OCT 8, BIN 2, MSBFIRST 1, LSBFIRST 0,
  CHANGE 1, FALLING 2, RISING 3, SDA 18, SCL 19, NULL 0, PI, HALF_PI, TWO_PI,
  DEG_TO_RAD, RAD_TO_DEG, EULER, F_CPU 16000000`.
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
  nothing matches, omit `line`). Message for `SketchError` is its text; for
  other JS errors, prefix "runtime error: ".
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
- `FloatBox`/non-integer number: `formatFloat(v, fmt ?? 2)` (from values.ts).
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
  stays), bool → "1"/"0", string → as is.
- `__str(v, kind)`: converts for concatenation per §4.4 rule 5.
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

Single page, dark purple theme matching the PCB (background `#17112a`,
panels `#241a3d`, accent `#8b5cf6`, text `#ede9fe`, monospace for code and
serial). Responsive grid:

```
┌─────────────────────────────────────────────────────────────────────┐
│ header: ZERO1 Smart Board Simulator · [Examples ▾] [▶ Run] [■ Stop] │
│         [↺ Reset] [⚙ Settings] [GitHub]                             │
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
Below 1000 px width the columns stack (board on top).

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
- Editor (`editor.ts`): CodeMirror 6 with `@codemirror/lang-cpp`, one-dark
  theme, line numbers, tab = 2 spaces, `Ctrl/Cmd+Enter` = Run. Diagnostics
  from `transpile()` shown with `@codemirror/lint` `setDiagnostics`. Code is
  persisted to `localStorage` (`z1.code`) and restored on load; an
  `Examples` menu replaces the code (confirm if the current code differs
  from the last loaded example). URL hash `#code=<base64url>` loads shared
  code ("Share" button copies such a link).
- Run: `transpile()` → on error show diagnostics in the editor and console,
  else `board.reset()`, `executor.run(js)`; buttons reflect status; the
  header shows a running indicator and elapsed `millis()`.
  Stop: `executor.stop()`. Reset: stop + `board.reset()` + clear serial.
- Serial monitor (`serial-monitor.ts`): output area (monospace, autoscroll
  toggle, clear, max 5000 lines), input line + Send (Enter), line-ending
  select (No line ending / Newline / Carriage return / Both; default
  Newline), baud label ("9600 baud" from `Serial.begin`, display only).
  Output arrives via `board.serial.onTx`. Show a hint when the sketch printed
  nothing yet.
- Pin map (`pinmap.ts`): the lesson table (Sr.No, Part, Description, Pin)
  plus live `Mode` and `Value` columns (`value` = level, PWM duty, tone Hz,
  servo angle, analog value as appropriate) refreshed 10×/s.
- Generated JS tab: read-only view of the transpiled code (for teachers).
- Console panel (`console-panel.ts`): messages from `onConsole` with level
  colours; clicking a message with a line jumps the editor to it.
- Inputs panel (`controls.ts`): POT slider (0..1023, two-way with the knob),
  LDR light slider (0..100 %) with sun/moon icons, DHT temperature (-40..80)
  and humidity (0..100) sliders, ultrasonic distance slider (2..400 cm),
  checkboxes "Servo plugged", "Ultrasonic plugged", "DHT22 plugged",
  "Mute buzzer".
- Settings (`settings.ts`, a dialog): the `BoardConfig` options with plain
  explanations, persisted to `localStorage` (`z1.config`), applied via
  `board.applyConfig`.
- Audio (`audio.ts`): WebAudio square-wave oscillator following
  `buzzer.state.freq` (start on first user gesture; gain 0.05; mute toggle).
- Examples menu (`examples-menu.ts`): grouped list from `src/examples/index.ts`.
- Keyboard: `Ctrl/Cmd+Enter` run, `Esc` stop.
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
