# Python mode — final specification

Status: **final (v1), ready to build** · Date: 2026-09-28 · Base: `main` = `d7c5c3f` (41 example
sketches, ~960 unit tests + emulator and hardware-sim suites) · Supersedes the draft reviewed by
three critics (semantics, classroom UX, integration). Every review item and its resolution is in
§14. The teacher's open choices are in §13.

The teacher's decisions this spec builds on (fixed):

- A third header mode **Python** (Code | Blocks | Python). Students **write and run** Python in
  MicroPython style (`machine.Pin`, `time.sleep`, …) on the same virtual board.
- The Python editor lives in a **Python** tab placed before *Generated JS* in the tab strip.
- The real ZERO1 board (ATmega328P) cannot run Python.

## 0. Summary

- The Python program is **translated in the browser into an Arduino C++ sketch** (`src/python/`,
  hand-written tokenizer, parser, data-flow analysis and emitter). The sketch is what Run
  executes, what the read-only Code tab shows, what is handed in (together with the Python), and
  what Open in Arduino IDE and Upload to board receive. Errors are always shown on Python lines.
- The subset (§2) is plain top-level code ending in `while True:`, with functions, `if`/`while`/
  `for`, ints, floats, bools, text, fixed and growable lists, f-strings, `global`, default and
  keyword arguments, and two `try`/`except` forms (sensor readings, `int()`/`float()` of text).
  Everything else is refused before running with a precise message (§5).
- The board API (§3) follows MicroPython (`machine`, `time`, `neopixel`, `dht`, `math`, `random`,
  `micropython`) plus a small `zero1` module for the ZERO1 pin names and its fixed-wiring parts.
- Numbers behave like the board: Python ints are 32-bit `long` **in every C++ expression**, decimals
  are 32-bit floats, printed with 7 significant digits like MicroPython (up to v1.25) on a
  single-precision port.
  Where Python and the board differ, the difference is listed (§2.13) and tested.
- The simulator itself gets four fidelity fixes first (§6, owner C): float32 rounding of every
  float literal and operation, C-width wrapping of every integer operation, `abort()`, and
  `String(float, n)` without "ovf". Without them the simulator and the board print different
  results for the same sketch (measured, §14 S3).
- Each mode keeps its own program: switching modes never overwrites `z1.code`, `z1.blocks` or
  `z1.python` (§7.6). The Code tab in Python mode is a second, read-only editor.
- Three developers work in parallel with explicit file ownership (§11): **A** translator +
  Python examples, **B** app UI, **C** class platform (+ the simulator fidelity PR).

### 0.1 Upload to board is not live yet (prerequisite, not a Python task)

Checked on 2026-09-28 with the GitHub API: `ebechalani/zero1smartboard` has **no releases and no
tags**, and the `avr-toolchain-wasm` workflow has **0 runs**. The latest Pages deploy
([run 36460925696](https://github.com/ebechalani/zero1smartboard/actions/runs/36460925696),
`d7c5c3f`, success) therefore shipped `toolchain/bundle/` but no `toolchain/manifest.json` and no
`toolchain/tools/*.wasm`, so the **Upload to board button stays hidden** on the live site in every
mode. The upload code itself works: the Optiboot end-to-end suite passed in that deploy, and the
compiler used locally for this spec builds and runs every probe sketch (Appendix B).

To turn it on (teacher, once): `git tag avr-toolchain-wasm-v1.0.0 && git push origin
avr-toolchain-wasm-v1.0.0` (the release step runs only on that tag; a manual run builds but
publishes nothing), wait for the two Docker builds (~15 min each), re-run the Pages deploy, then do
the 10-minute hardware check of docs/UPLOAD.md §4. This is step 0 of the plan (§11.3): Python's
"upload to the real board" promise and the CI board tests (§10.6) depend on it.

---

## 1. Decision: translate to Arduino C++ (not an interpreter)

### 1.1 Options

**A. Translation** (chosen): Python → tokens → AST → scopes, data flow and kinds → Arduino sketch
+ line map. **B. Interpreter**: Pyodide, MicroPython-WebAssembly, Brython, Skulpt, RustPython or a
hand-written tree-walker bound to the simulator's `Board`.

### 1.2 Evidence

Sizes: npm tarballs, `gzip -9`, 2026-09-28; lang-python measured inside this repo's dependency
graph (integration review).

| Criterion | A. Translation | Pyodide 314.0.7 | MicroPython-wasm 1.29.0-6 | Brython 3.14.3 | Skulpt 1.2.0 |
|---|---|---|---|---|---|
| Download (gzip) | lazy chunk ≈ 60–65 KB: `@codemirror/lang-python` 6.2.1 + `@lezer/python` 1.1.19 = 18.7 KB (shared CodeMirror packages already loaded), translator ≈ 20–25 KB (the 3.8 k-line C++ transpiler is 18.2 KB), 33 examples ≈ 12 KB | ≈ 6.3 MB | ≈ 229 KB | 262 KB (+4.8 MB stdlib) | ≈ 232 KB |
| Maintenance | ours | active | active | active | last release 2021-03-25, Python 2 semantics by default |
| `while True:` + `time.sleep()` without freezing the tab | yes, existing async runtime (`await __tick()`) | needs JSPI or a Worker | only `runPythonAsync` | `time.sleep()` raises `NotImplementedError` in the browser | suspensions, Python 2-ish |
| Stop button, deterministic `VirtualClock` tests | existing | Worker `terminate()` (COOP/COEP headers impossible on GitHub Pages); real time | same | same | partly |
| Error quality | before running, on the Python line, while typing | tracebacks at run time | at run time | at run time | medium |
| Hand in, share, review, `.ino` downloads | unchanged shape (+ Python source) | every consumer must learn Python | same | same | same |
| Open in Arduino IDE / Upload to board | work on the generated sketch | impossible (MicroPython needs ≥ 256 KiB flash + 16 KiB RAM; the UNO has 32 KB / 2 KB, no AVR port) | impossible | impossible | impossible |
| Integers vs the real board | same as the board (32-bit, §2.13) | big ints | big ints | JS numbers | — |

The integration review confirmed that everything downstream is sketch-shaped: `firestore.rules`
requires a non-empty `code`; the teacher's `.ino` downloads, zip, review replay, Arduino IDE
dialog and Upload all take a sketch. The semantics review confirmed that MicroPython on esp32 and
rp2 also uses single-precision floats (`MICROPY_FLOAT_IMPL_FLOAT`), so 32-bit floats are
MicroPython-faithful.

### 1.3 Decision and its price

**Translation.** It is the only option that lets a Python program reach the real board, and it
keeps Run, live errors, Hand in, Share, review, Open in Arduino IDE, Upload and Generated JS on
one tested path, for ~60 KB loaded on first use of Python mode. The price, stated to students and
teachers: a **subset** with **board semantics** (§2), checked before running, and a simulator that
must match the board bit for bit on arithmetic (§6).

The alternative stays possible later for a real MicroPython board (ESP32 / Pico): programs use
MicroPython's own APIs wherever they exist, and ZERO1 additions live in one module (`zero1`,
§3.1, §3.8, §3.10).

---

## 2. The language: ZERO1 Python (v1)

Wording used below: *Python* = CPython 3.12 (the error-message reference); *MicroPython* =
MicroPython `master` documentation (the API reference); *board* = the ATmega328P running the
generated sketch; *simulator* = `transpile()` + `Executor` after the §6 fixes.

### 2.1 Program structure

A Python program runs from top to bottom once; board programs end with `while True:`. The
translation maps that to Arduino's structure:

1. The **final top-level `while True:`** (condition literally `True` or `1`; no `break` that
   leaves it — a `break` of a nested loop is fine; nothing but comments and `def`s after it) is the
   *main loop*. Statements before it go into `setup()` in order; its body becomes `loop()`. A
   `continue` directly in the main loop becomes `return;` with the comment
   `// continue: start the next round of the loop`.
2. **No main loop**: everything goes into `setup()`; `loop()` is empty with the comment
   `// The Python program has no "while True:": it has ended.` `PythonTranslation.endsAfterSetup`
   is `true`, and the app finishes the run as described in §7.8 (a tone still sounding may finish,
   2 s at most). On the board `loop()` spins empty, exactly as the Arduino twins 42, 44 and 56 do.
3. `if __name__ == "__main__":` at top level is unwrapped (its body is top-level code).
4. A `while True:` that is not the main loop (statements after it, a `break` out of it, or inside
   `def main():` called at the end) stays where it is. Statements after an endless top-level
   `while True:` get W-unreachable. Statements that can never run (after such a loop, or after a
   `return`, `break` or `continue` of the same block) are left out of the sketch with the comment
   `// Python lines N-M are never reached, so they are left out.`
5. `def` may appear anywhere at top level. A top-level statement that uses a function before its
   `def` has run is E-name-later (Python would raise NameError). Functions are emitted before
   `setup()` in Python order; no prototypes are needed (the simulator resolves forward references;
   arduino-cli and this project's `.ino` preprocessing generate prototypes — verified, Appendix B).

Rejected: an Arduino-style `def setup():` / `def loop():` convention (not MicroPython; two
conventions confuse beginners). Functions named `setup` or `loop` are renamed like any reserved
name (§2.14).

### 2.2 Lexical rules

**Source normalisation** (before tokenizing, positions preserved): CRLF and lone CR → LF; a
leading U+FEFF is dropped. The Python editor additionally cleans pasted text (§7.4).

**Characters outside strings and comments.** ASCII, plus Unicode letters/digits in identifiers.
U+00A0 → S-nbsp; curly quotes U+2018/2019/201C/201D/201E → S-curly-quote; any other character →
S-invalid-char (all CPython 3.12 wording plus a hint, §5.1).

**Line structure.** Logical lines; implicit joining inside `()`, `[]` (and `{}` for the error
message); explicit `\` joining; blank and comment-only lines ignore indentation; `;` separates
simple statements and may end a line. **Indentation**: an INDENT/DEDENT stack; a tab advances to
the next multiple of 8, and the indentation is also compared with tab size 1 (TabError when the two
comparisons disagree), as CPython does. The editor inserts 4 spaces per level.

**Identifiers**: Python 3 identifiers (PEP 3131, NFKC-normalised). Non-ASCII names are legal and
transliterated for the sketch (§2.14). Keywords: all 35 Python keywords; `match`/`case` at the
start of a statement followed by `:` are NA-match, otherwise ordinary names.

**Numbers.**

| Form | Accepted | C++ |
|---|---|---|
| decimal int | `0`, `42`, `1_000` | `42`, `1000` (with `L` in arithmetic, §4.7 N1) |
| leading zeros | `007` → S-leading-zero (CPython refuses; C++ would read octal) | — |
| `0x3F`, `0o17`, `0b0101` (any case, `_` allowed) | yes | `0x3F`, `15`, `0b0101` |
| float | `0.5`, `.5`, `5.`, `1e3`, `1.5e-3`, `1_000.5` | `0.5`, `0.5`, `5.0`, `1000.0`, `0.0015`, `1000.5` (exponent form kept when shorter: `1e+30`) |
| imaginary `1j` | NA-complex | — |
| int outside −2147483648 … 2147483647 (after folding a leading `-`) | E-big-int | — |

**Strings.** `'…'`, `"…"`, `'''…'''`, `"""…"""`; prefixes `r`, `u`, `f`, `rf`, `fr` (any case);
`b'…'` → NA-bytes. Adjacent literals concatenate (`"ab" "cd"`, also with f-strings). Escapes
`\\ \' \" \a \b \f \n \r \t \v \ooo \xhh \uXXXX \UXXXXXXXX` and `\` + newline; `\N{…}` → NA-escape-N;
an unrecognised escape such as `\d` keeps the backslash (Python does) with W-escape. Text is
Unicode; it becomes UTF-8 in the sketch (§2.7).

**f-strings**: literal parts, `{{`, `}}`, fields `{expression}` / `{expression:spec}`; the
expression is parsed by the normal parser (the other quote kind may be used inside); every field
keeps its own source position. `!r`/`!s`/`!a`, `{x=}` and nested `{}` in the spec → NA-fstring-spec.
Spec grammar in §2.11.

**Comments** `# …` are kept (trivia) and carried into the sketch (§4.7 C1–C4).

### 2.3 Syntactic grammar

EBNF over tokens (`NAME NUMBER STRING FSTRING NEWLINE INDENT DEDENT`). Constructs written in
*italics* parse (so that the student gets a precise message) and are then refused with the code
shown. Anything that does not parse is a SyntaxError (§5.1).

```
file          := (NEWLINE | stmt)* ENDMARKER
stmt          := compound | simple_stmts
simple_stmts  := simple (';' simple)* [';'] NEWLINE
simple        := assign | augassign | expr_stmt | return | 'pass' | 'break' | 'continue'
               | global | import | raise | assert
               | *del* (NA-del) | *nonlocal* (NA-nonlocal) | *yield …* (NA-generator)
assign        := (target '=')+ expr                        # chained: a = b = 0
               | tuple_target '=' expr (',' expr)+ [',']   # a, b = b, a   (same count on both sides)
               | NAME '=' '(' expr ',' expr ',' expr ')'   # a colour, §3.6
target        := NAME | primary '[' expr ']'
tuple_target  := target (',' target)+ [',']
augassign     := target ('+=' | '-=' | '*=' | '/=' | '//=' | '%=' | '**=' | '&=' | '|=' | '^=' | '<<=' | '>>=') expr
expr_stmt     := expr                                      # a call; a docstring; else W-no-effect
return        := 'return' [expr]
global        := 'global' NAME (',' NAME)*
import        := 'import' modname ['as' NAME] (',' modname ['as' NAME])*
               | 'from' modname 'import' ('*' | names | '(' names [','] ')')
names         := NAME ['as' NAME] (',' NAME ['as' NAME])*
modname       := NAME                                      # §3 modules; dotted names → E-module
raise         := 'raise' NAME '(' [STRING | FSTRING] ')'    # §2.12; bare raise → NA-raise
assert        := 'assert' expr [',' (STRING | FSTRING)]

compound      := if | while | for | funcdef | try
               | *class* (NA-class) | *with* (NA-with) | *async …* (NA-async) | *match* (NA-match)
               | *decorator* '@' (NA-decorator)
if            := 'if' expr ':' block ('elif' expr ':' block)* ['else' ':' block]
while         := 'while' expr ':' block                     # *while … else* → NA-loop-else
for           := 'for' NAME 'in' expr ':' block             # iterable forms §2.4; *for … else* → NA-loop-else
funcdef       := 'def' NAME '(' [param (',' param)* [',']] ')' ':' block     # top level only (NA-nested-def)
param         := NAME ['=' expr]                            # *\*args*, *\*\*kw*, *annotations* → NA-star-args / NA-annotation
try           := 'try' ':' block 'except' [NAME ['as' NAME]] ':' block ['else' ':' block]
                                                           # only the §2.12 forms; *finally*, several excepts → NA-try
block         := simple_stmts | NEWLINE INDENT stmt+ DEDENT # one-line suites allowed: while True: pass

expr          := disjunction ['if' disjunction 'else' expr]  | *lambda* (NA-lambda) | *:=* (NA-walrus)
disjunction   := conjunction ('or' conjunction)*
conjunction   := inversion ('and' inversion)*
inversion     := 'not' inversion | comparison
comparison    := bitor (compop bitor)*                      # chains allowed, §2.5
compop        := '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not' 'in'   | *is*, *is not* (NA-is)
bitor         := bitxor ('|' bitxor)*
bitxor        := bitand ('^' bitand)*
bitand        := shift ('&' shift)*
shift         := sum (('<<' | '>>') sum)*
sum           := term (('+' | '-') term)*
term          := factor (('*' | '/' | '//' | '%') factor)*  | *'@'* (NA-matmul)
factor        := ('+' | '-' | '~') factor | power
power         := primary ['**' factor]
primary       := atom (call | '[' expr ']' | '.' NAME)*     # *slices a[i:j]* → NA-slice
call          := '(' [arg (',' arg)* [',']] ')'
arg           := expr | NAME '=' expr                       # *\*x*, *\*\*x* → NA-star-args
atom          := NAME | NUMBER | (STRING | FSTRING)+ | 'True' | 'False'
               | 'None'                                     # only `return None` (= return); else NA-none
               | '(' expr ')' | '(' expr ',' expr ',' expr ')'  # colour; other tuples NA-tuple
               | '[' [expr (',' expr)* [',']] ']'
               | *'{' … '}'* (NA-dict) | *comprehensions* (NA-comprehension) | *'...'* (NA-ellipsis)
```

### 2.4 Statements

| Python | C++ |
|---|---|
| `x = e` | declaration or assignment (§4.7 D1–D4); webs may give a second C++ name (§2.9) |
| `a = b = e` | targets assigned left to right from one evaluation of `e`, as in Python: `a = e; b = a;` when `a` is a plain name, else `{ T t = e; a = t; b = t; }` |
| `a[i] = e` | `a[pyIndex(i, N, line)] = e;` (§2.10); `np[i] = (r, g, b)` → §3.6 |
| `a, b = e1, e2` (names or subscripts) | `{ T1 t1 = e1; T2 t2 = e2; a = t1; b = t2; }` with each temporary of **its own target's kind**; covers `a, b = b, a` and `a[i], a[j] = a[j], a[i]` |
| `x op= e` | int kinds: `+= -= *= &= \|= ^= <<= >>=` as is; `//=`, `%=` choose by kind (`x = pyFloorDiv(x, …)` / `x = floor(x / …)`, `pyMod` / `pyFloatMod`); `/=` on an int web widens it (§2.9); `**=` → `x = pyPow(x, e, line)` or `pow`; divisors guarded (§4.7 N4) |
| `if` / `elif` / `else` | `if` / `else if` / `else`, always with braces |
| `while c:` | `while (…)` (truth values §2.8) |
| `for v in range(…)` | `for (long v = start; v < stop; v += step)`; `>` for a negative constant step; a zero or non-constant step → E-range-step. `stop` evaluated once: hoisted to `const long vStop = …;` unless a literal, a constant, `len()` of a fixed list, or a name not assigned in the body. If the body assigns `v` or `v` is read after the loop, a hidden counter keeps Python's meaning (W-loop-var-changed for the first). `_` as the loop variable becomes `i`, `j`, `k`, … |
| `for v in lst:` | `for (long vIndex = 0; vIndex < N; vIndex++) { T v = lst[vIndex]; … }` (`N` = the constant length or the count variable of a growable list, re-read every round like Python) |
| `for ch in text:` | `for (long chIndex = 0; chIndex < (long)text.length(); chIndex++) { String ch = String(text.charAt(chIndex)); … }` |
| `for a in i2c.scan():` | `for (byte a = 1; a < 127; a++) { Wire.beginTransmission(a); if (Wire.endTransmission() == 0) { … } }` (other uses of `scan()` → E-scan) |
| `for v in <other>` | E-not-iterable |
| `break`, `continue` | same (main-loop `continue` → `return;`, §2.1) |
| `pass` | nothing (an empty block `{\n}`) |
| `def f(a, b=1):` | typed C++ function (§2.9); defaults are filled in at each call site; defaults must be constant expressions (else NA-default-value) |
| `return` / `return e` / `return None` | same; a value on some paths only → `return <zero>;` at the end + W-missing-return |
| `global a, b` | nothing (module names are C++ globals); must come before any use in that function (S-global-after-use) |
| `import …`, `from … import …` | nothing; unused imports are never warned about |
| expression statement | the call; any other expression → W-no-effect and nothing is emitted |
| docstring | module: `/* … */` header (§4.7 C3); function: `//` lines above the function |
| `raise Name("text")` | `pyFail(line, "Name: text");` (§2.12) |
| `assert c` / `assert c, "m"` | `if (!(c)) pyFail(line, "AssertionError");` / `"AssertionError: m"` |
| `try` / `except` | the two forms of §2.12; others NA-try |

### 2.5 Expressions

C++ precedence is applied by the emitter (§4.7 E1); kinds in §2.9; integer rules in §4.7 N1–N6.

| Python | C++ |
|---|---|
| int / float / bool literals | §2.2; `True`/`False` → `true`/`false` |
| text literal | C++ string literal, UTF-8, escapes per §4.7 S1; on the LCD `°` → `"\xDF"` |
| `+ - *` on numbers | same, all operands `long` or `float` (N1) |
| `str + str` | `String` concatenation (a literal on the left is wrapped: `String("a") + s`) |
| `str + number` | E-concat |
| `/` | always a float: `(float)a / b` for two ints, `a / 2.0` for an int literal divisor |
| `//` | ints: `pyFloorDiv(a, b)`, or plain `/` when `a` is provably ≥ 0 and `b` a positive constant (N3); floats: `floor(a / b)` |
| `%` | ints: `pyMod(a, b)`, or plain `%` under the same condition; floats: `pyFloatMod(a, b)` |
| `**` | int ** int → `pyPow(a, b, line)` (constant `b ≥ 0` folds when both are literals); anything with a float, or a negative literal exponent → `pow(a, b)` (kind float) |
| unary `-`, `+`, `~` | same; `~` and `& \| ^ << >>` on a float → E-bitop-float |
| comparisons | same on numbers; on text: `String` operators (a literal on the left is wrapped: `String("M") > name`); text vs number: `==` → `false` / `!=` → `true` with W-str-num-eq; `<` etc. → E-compare |
| chained `a < b < c` | `(a < b && b < c)`; a middle operand with a call → NA-chain |
| `x in "text"`, `not in` | `(s.indexOf(x) >= 0)` / `< 0` (`x` must be text) |
| `x in [1, 2, 3]` (literal) | `(x == 1 \|\| x == 2 \|\| x == 3)`; `x` must be side-effect free (else NA-chain) |
| `x in lst` (list variable) | `pyInListL(lst, n, x)` (§2.10) |
| `and`, `or`, `not` | `&&`, `\|\|`, `!` on truth values; producing a non-bool value (`s or "guest"`) → NA-bool-value |
| `a if c else b` | `(c ? a : b)`; text results wrap literal branches in `String(…)` |
| calls | own functions (defaults and keywords resolved), built-ins (§2.6), API (§3) |
| `lst[i]` | list item (§2.10); `text[i]` → `pyCharAt(text, i, line)` |
| attribute | module members and API methods only (§3); others E-attr |

### 2.6 Built-in functions

Allowed: `print input len range int float str bool abs min max round pow chr ord sum`. Everything
else (`sorted any all enumerate zip map filter reversed list tuple dict set isinstance type id open
eval exec divmod hex bin oct repr format iter next hash callable super exit …`) → NA-builtin, with a
per-name hint where one helps (`enumerate` → `for i in range(len(items)):`; `hex` → `f"{n:x}"`).

| Built-in | C++ |
|---|---|
| `print(*args, sep=" ", end="\n")` | §2.11 (`sep`, `end` string literals; `file=` → NA-print-file) |
| `input(prompt="")` | `pyInput(prompt)`: prints the prompt, waits for a line, **echoes it** and a newline (like a terminal), returns it without the line ending |
| `len(x)` | fixed list → its constant `N`; growable list → its count variable; text → `(long)text.length()` (W-text-bytes if the text may hold non-ASCII); `len(np)` → pixel count; a number → E-len |
| `range(…)` | only as a `for` iterable (E-range-value elsewhere); float arguments → E-range-float |
| `int(x)` | float → `(long)x` (truncates, like Python); bool → `(long)x`; text → `pyInt(text, line)` (ValueError on bad text, like Python); `int(x, base)` → NA-builtin-arg |
| `float(x)` | number → `(float)x`; text → `pyFloatOf(text, line)` |
| `str(x)` | int → `String(x)`; float → `pyFloat(x)`; bool → `pyBool(x)`; list → `pyListText…` |
| `bool(x)` | truth value (§2.8) |
| `abs(x)` | side-effect-free `x`: Arduino's `abs(x)`; else `pyAbsL(x)` / `pyAbsF(x)` (Arduino's `abs` is a macro that evaluates its argument twice) |
| `min(a, b, …)`, `max(…)` | side-effect-free arguments: nested Arduino `min(a, min(b, c))`; else `pyMinL`/`pyMinF`/`pyMaxL`/`pyMaxF`, nested, each argument evaluated once in Python order. The result kind is float if any argument is float (so `min(2, 2.5)` prints `2.0`, Python `2`). One list argument → `pyMinListL(lst, n, line)` … |
| `sum(lst)` | `pySumL(lst, n)` / `pySumF` (lists only; NA-builtin-arg otherwise) |
| `round(x)` | float → `pyRound(x)` (halves to even, gives an int); int → `x` |
| `round(x, n)` | `n` literal 0..7: `pyRoundTo(x, n)` (float) |
| `pow(a, b)` | as `**`; `pow(a, b, m)` → NA-builtin-arg |
| `chr(n)` | `String((char)n)`; as `lcd.putchar()` argument → `lcd.write((byte)n)`; float → E-range-float wording |
| `ord(c)` | `(long)(byte)c.charAt(0)` (the first byte; W-text-bytes for non-ASCII) |

Shadowing a built-in or an imported name (`max = 0`, `sum = 0`, `Pin = 5`) is legal: W-shadow and
the C++ name is renamed; calling it afterwards is E-not-callable ("TypeError: 'int' object is not
callable").

### 2.7 Text (`str`)

- Text is Unicode in Python and **UTF-8 bytes on the board**. Accented text works in `print()` and
  the Serial Monitor (the Arduino IDE's monitor shows UTF-8). Two places differ and get warnings,
  never errors: the LCD (W-lcd-char; only ASCII and `°` display) and byte counting — `len()`,
  `text[i]`, `for ch in text`, `ord()` count bytes on the board (`len("été")` is 3 in Python and 5
  on the board; W-text-bytes when the text can hold non-ASCII).
- Methods: `upper()` → `pyUpper(s)`, `lower()` → `pyLower(s)`, `strip()` → `pyStrip(s)`,
  `startswith(t)` → `s.startsWith(t)`, `endswith(t)` → `s.endsWith(t)`, `find(t)` →
  `(long)s.indexOf(t)`, `replace(a, b)` → `pyReplace(s, a, b)`, `isdigit()` → `pyIsDigit(s)`.
  Others → NA-str-method (the message lists the ones that work). Python strings are immutable; the
  helpers take a copy.
- `%` formatting and `.format()` → NA-str-format. `"-" * 16` with a literal text and a constant
  count is folded; other repetitions → NA-str-repeat.

### 2.8 Truth values

`if x:`, `while x:`, `not x`, `and`, `or`: bool as is; int/float → `x != 0`; text →
`x.length() > 0` (Arduino's `String` is always true, so it is never used bare); `pin.value()` →
`digitalRead(p) == HIGH` (`not pin.value()` → `== LOW`); a list → `n > 0`.

### 2.9 Kinds, variables and inference

C++ needs a type per variable; Python has none. The translator infers **kinds**:

| Kind | C++ | Zero value |
|---|---|---|
| `int` | `long` (32-bit) | `0` |
| `float` | `float` (32-bit; AVR `double` is the same) | `0.0` |
| `bool` | `bool` | `false` |
| `str` | `String` | `""` |
| `color` (an `(r, g, b)` tuple) | `unsigned long` (`0xRRGGBB`) | `0` |
| `list<K>` fixed / growable | `T name[N]` / `T name[CAP]` + `long nameCount` (§2.10) | zero-filled |
| board objects | §3.8 | — |
| `none` | `void` (functions only) | — |

**Webs (one Python name, several C++ variables).** In each scope (the module's top-level code;
each function), reaching definitions are computed on the structured control-flow graph (if/elif/
else, loops with their back edge, `break`, `continue`, `return`). A *web* is a maximal set of
definitions and uses connected by "this use can see this definition". Each web gets one kind.
Webs of the same name **and the same kind** are merged back into one C++ *variable*; only a web
whose kind differs gets its own variable: the first in source order keeps the (mangled) name,
the next ones `name_2`, `name_3`, … (with the comment `// 'answer' again, now a number`).
Messages always use the Python name. So these all work:

```python
answer = input("Age? ")      # web 1: text   → String answer
answer = int(answer)         # web 2: int    → long answer_2
x = 5; print(x); x = 2.5     # prints 5 (web 1 int), then x is web 2 (float)
```

Exception: a module name that any function reads or assigns (with `global`) is **one web** (the
call order is unknown). The module's CFG runs through the setup part into the main loop, so a
value set before `while True:` and read inside it is naturally in one web.

**Combining kinds inside one web** (a use that can see several definitions, e.g. around a loop):
`bool`+`bool` → bool; `int`+`bool` → int (W-bool-int when the web is printed or turned into
text); `int`+`float` → float (W-int-float when printed/turned into text); `str` with anything else,
or a list/object/colour with anything else → E-retype (a ZERO1 limit, "ZERO1 Python does not have
… yet" wording, both lines named).

**Parameters** take the combined kind of the arguments at every call site (`int`+`float` →
float); text at one call and a number at another → E-param-kinds. Uncalled functions: parameters
are int, W-unused-function. **Return kinds** combine the same way; text and numbers → E-return-kinds.
Recursion is resolved by a fixed point (≤ 8 passes; unresolved → int). Cloning a function per
argument-kind combination is v1.1 (§14 S11).

**Expression kinds**: literals by type; `+ - *` → int if both int/bool, else float; `/` → float;
`//`, `%` → int if both int, else float; `**` → int if both int and the exponent is not a negative
literal; comparisons, `and`/`or`/`not`, `in` → bool; `a if c else b` → combined; calls → return
kind / API table; `a[i]` → element kind.

**Non-negative facts** (for N3): a web is known ≥ 0 when all its definitions are: non-negative
literals/constants, `analogRead`/`digitalRead`/`len`/`ticks`… readings, or `+ * // %` of known
non-negative values (fixed point; 32-bit overflow ignored).

**Definite assignment.** A use that no definition reaches → E-name (with "it gets its value on
line N, below" when a later definition exists). A use reached on some paths only → W-maybe-unassigned
(the board reads 0; Python raises NameError). A global read in a function but never assigned at
top level nor through `global` in any function → E-name. A name assigned only inside a function
after `global x` is still a C++ global (zero-initialised).

**Constants.** A top-level `UPPER_CASE` name (`^[A-Z][A-Z0-9_]*$`) assigned exactly once, at top
level, from a constant expression, or any name assigned with `micropython.const(e)`, becomes
`const long / float / String / unsigned long NAME = …;` (`const long NAME[N] = {…}` for a list never
written). Lower-case names stay variables even when never changed.

**Objects** (Pin, PWM, ADC, parts) are assigned once per scope and never re-bound
(NA-object-reassign). Library-backed parts (`Servo`, `LCD`, `NeoPixel`, `DHT22`/`DHT11`) must be
created at top level, outside loops and ifs (NA-object-here). A `Pin` may be passed to functions
(the parameter becomes `int`) and put in a fixed list (`const int leds[2] = {LED_RED, LED_GREEN};`).

### 2.10 Lists

A list holds one scalar kind (`int`, `float`, `bool`, `str`, `color`; `Pin` in fixed lists).
Lists of lists → NA-nested-list; mixed kinds → E-list-kinds.

**Fixed lists** — created by a literal `[e1, …]` or `[v] * N` (`N` a constant; `[0] * n` with a
variable → NA-list-size) and never grown: `long notes[3] = {262, 294, 330};`, `len()` is the
constant.

**Growable lists** — any list that is `append`ed or `pop`ped anywhere, including `readings = []`:

```cpp
long readings[20];            // the list 'readings' has room for 20 items
long readingsCount = 0;
```

**Capacity** = starting length + the provable number of appends when every `append` to the list
sits in `for … in range(K)` loops with constant bounds (products for nested loops), outside any
`while`, and not in a function; otherwise starting length + **20**, with W-list-capacity. The
memory estimate (§4.11) includes the capacity. A full list stops the program with
`MemoryError: the list is full (20 items on the board)` on the Python line (MicroPython on a real
board also ends with MemoryError when memory runs out).

| Operation | C++ |
|---|---|
| `lst.append(v)` | `lstCount = pyAppendL(lst, lstCount, CAP, v, line);` (statement only) |
| `lst.pop()` / `lst.pop(i)` (statement, or the whole right side of an assignment) | `x = pyPopL(lst, lstCount, -1 / i, line); lstCount--;` — IndexError "pop from empty list" / "pop index out of range"; elsewhere → NA-pop-here |
| `lst.clear()` | `lstCount = 0;` |
| `len(lst)` | `lstCount` / `N` |
| `lst[i]`, `lst[i] = v` | `lst[i]` when `i` is a literal within range (negative literals folded: `a[-1]` → `a[N-1]`) or the loop variable of `for i in range(len(lst))` / `range(N)` not assigned in the body; otherwise `lst[pyIndex(i, n, line)]` |
| `for x in lst`, `x in lst`, `sum`, `min`, `max`, `print(lst)`, `str(lst)`, `random.choice(lst)` | helpers per element kind (`…L` long, `…F` float, `…S` String, `…B` bool), emitted only when used |
| other methods (`insert remove sort reverse index count extend copy`) | NA-list-method (hint per method; `sort` → "write a bubble sort with a, b = b, a") |
| a list as a function argument | a hidden length parameter: `float average(long values[], long valuesCount)`; callers pass `N` or the count. Appending to or popping a **parameter** list → NA-list-param-grow (global lists can be grown from functions) |
| `return lst`, `lst == lst2`, `lst + lst2`, `b = a` (aliasing) | NA-list-value |

### 2.11 `print()`, f-strings and text conversion

`print(a, b, c)` becomes one `Serial.print(…)` per piece and a final `Serial.println(…)`
(Arduino sends `\r\n`; the monitor shows the same thing). `sep` (default `" "`) is merged into
adjacent literal pieces; `end=""` makes the last call `Serial.print`; another `end` literal is
printed after the pieces. `print()` → `Serial.println();`. The same piece rules build `String`
values for f-strings / `str()` outside `print` and drive `lcd.putstr()`.

| Piece | In `print` / `putstr` | As a `String` |
|---|---|---|
| text | `Serial.print(s)` | `s` |
| int | `Serial.print(n)` | `String(n)` |
| float | `Serial.print(pyFloat(x))` (`2.5`, `3.0`, `0.3333333`, `1e-07`) | `pyFloat(x)` |
| bool | `Serial.print(pyBool(b))` (`True` / `False`) | `pyBool(b)` |
| list | `Serial.print(pyListTextL(lst, n))` (`[1, 2, 3]`, text items quoted `'a'`) | same |

**Format spec** accepted: `[align][0][width][.precision][type]`, `align` ∈ `<` `>`, `type` ∈
`d f x X b s` or none. Anything else (`^`, `+`, `,`, `=`, `e`, `%`, custom fill) → NA-fstring-spec.

| Field | Rule | C++ |
|---|---|---|
| `{x}` | as `str(x)` | table above |
| `{x:.Nf}` (N 0..7; `{x:f}` = `.6f`) | int, bool or float; ints are converted | `Serial.print((float)x, N)` / `String((float)x, N)` |
| `{n:d}` | int/bool; on a float → E-format-code | `Serial.print(n)` / `String(n)` |
| `{n:x}` `{n:X}` `{n:b}` | int; a sign in front of negatives like Python (`-1` → `-1`, not `ffffffff`) | `pyHex(n, false)` / `pyHex(n, true)` / `pyBin(n)` |
| `{s:s}`, `{s:.N}` | text; `.N` keeps the first N characters | `s` / `s.substring(0, N)` |
| width `{v:5}` | numbers right-aligned, **text left-aligned** (Python's default), `<`/`>` override | `pyPad(<String>, 5, '>')` / `pyPad(…, 5, '<')` |
| zero pad `{n:03d}`, `{x:07.2f}` | numbers only (the sign stays in front: `-05`); on text → E-format-zero-text | `pyPad(<String>, 3, '0')` |

Rounding of `{x:.Nf}` is Arduino's (halves up on the float value): `f"{2.5:.0f}"` is `3` on the
board and `2` in Python (§2.13).

`pyFloat` prints like MicroPython up to v1.25 on a single-precision port (esp32, rp2:
`py/objfloat.c` formats with `'g'` and precision 7, then appends `.0`): 7 significant digits, trailing
zeros removed, `.0` kept for whole values, and `1e-05` / `1e+07` notation below 0.0001 and from
10,000,000 on; `nan`, `inf`, `-inf`. Examples: `0.1 + 0.2` → `0.3`, `1/3` → `0.3333333`,
`24.3` → `24.3`, `1234567.0` → `1234567.0`, `12345678.0` → `1.234568e+07`. Verified identical on
the simulator and avr8js for 21 values (Appendix B, f5).

### 2.12 `try` / `except`, `raise`, `assert`

MicroPython reports sensor failures with `OSError` and bad text with `ValueError`. v1 supports
exactly these two forms (anything else → NA-try, whose message shows form S):

**Form S — a sensor reading.**

```
try:
    <sensor statement>        # sensor.measure()   or   NAME = sonar.distance_cm()   or   … .distance_mm()
    <body…>                   # optional
except OSError:               # also: except OSError as e: / except Exception: / except:
    <handler…>
[else:
    <more…>]
```

```cpp
if (sensor.read()) {                    // try: sensor.measure()
  <body> <more>
} else {                                // except OSError:
  <handler>
}
```

When the try body is only the sensor statement and there is no `else`, the emitter writes
`if (!sensor.read()) { <handler> }`. For the ultrasonic sensor:
`distance = pyDistanceCm(TRIG_PIN, ECHO_PIN, 0); if (distance > 0) { … } else { … }`. With
`as e`, `e` is the text MicroPython would give: `"[Errno 110] ETIMEDOUT"` (DHT),
`"Out of range"` (HC-SR04).

**Form V — reading a number from text.**

```
try:
    NAME = int(<text expression>)      # or float(…)
    <body…>
except ValueError:                     # also: as e / Exception / bare
    <handler…>
[else: …]
```

```cpp
String ageText = <text expression>;    // evaluated once
if (pyIsInt(ageText)) {
  age = pyInt(ageText, 0);
  <body> <more>
} else {
  <handler>
}
```

Difference, documented: in Python an error raised by any statement of the try body is caught; here
only the sensor / conversion failure is.

**Without try**, the same failures stop the program like an uncaught Python exception: DHT
`measure()` → `if (!sensor.read()) pyFail(line, "OSError: [Errno 110] ETIMEDOUT");`;
`distance_cm()` → `pyDistanceCm(TRIG_PIN, ECHO_PIN, line)` (stops with `OSError: Out of range`);
`int(text)` → `pyInt(text, line)`. `measure()` gives no value (it returns `None` in MicroPython):
using its result → NA-none-value with the right idiom.

`raise Name("text")` (text literal or f-string; any exception name) → `pyFail(line, "Name: text")`;
`raise Name` → `pyFail(line, "Name")`; bare `raise` → NA-raise. `assert` → §2.4.

### 2.13 Numbers and other things that differ from Python on a computer

Shown to students in this document's student section (§2.15) and linked from the Python tab note.
Every row has a test (§10).

| Situation | Python (CPython) | ZERO1 board = simulator (after §6) | Why / what we do |
|---|---|---|---|
| whole numbers | unlimited | 32-bit: −2,147,483,648 … 2,147,483,647, wrap like an odometer | Python ints → C++ `long` in every expression (§4.7 N1), so `adc.read() * 100 // 1023` is `50`, `60 * 1000` is `60000`, `1 << 20` is `1048576` (a 16-bit `int` would give −15, −5536, 0 on the board) |
| `a = 50000; print(a * a)` | 2500000000 | −1794967296 | 32-bit wrap; the simulator wraps each operation (§6) |
| decimal numbers | 64-bit | 32-bit float (~7 digits) | `print` shows 7 significant digits like MicroPython (`1/3` → `0.3333333`) |
| `0.1 + 0.2 == 0.3` | False | True | float32 rounding |
| `print(0.1 + 0.2)` | `0.30000000000000004` | `0.3` | |
| `f"{2.5:.0f}"` | `2` | `3` | Arduino rounds halves up |
| `round(2.675, 2)` | `2.67` | `2.68` | in float32, 2.675 × 100 rounds to exactly 267.5 |
| `min(2, 2.5)` printed | `2` | `2.0` | one kind per expression |
| `//`, `%`, `round()`, `int()` | floor, sign of divisor, halves to even, truncation | the same (helpers) | |
| `/` | float | float | |
| division by zero | ZeroDivisionError | stops: `ZeroDivisionError: division by zero` on the Python line | `pyNonZero` guard when the divisor is not a non-zero constant |
| list / text index out of range | IndexError | stops with IndexError on the Python line | `pyIndex`, `pyCharAt` |
| `int("12abc")` | ValueError | stops with the same ValueError | `pyInt` |
| `2 ** -1` with a variable exponent | 0.5 | stops: "a negative power of a whole number is a decimal number: write 2.0 ** n" | kinds are static |
| `time.sleep(-1)` | ValueError | stops with the same ValueError | `pySleep` guard |
| `time.sleep_ms(1.5)` | (MicroPython: TypeError) | refused before running (E-sleep-ms-float) | |
| growing a list | no limit | 20 extra items by default, then MemoryError (§2.10) | |
| `len("été")` | 3 | 5 (bytes) | W-text-bytes |
| `time.ticks_ms()` | (MicroPython: wraps after a port-specific period) | `(long)millis()`: wraps after 24.8 days | use `ticks_diff` (W-ticks-diff) |
| deep recursion | RecursionError at 1000 | the board crashes at ~50 levels; the simulator does not notice | W-recursion |
| `input()` | reads a line | same, the typed line is echoed; waits forever if nothing is sent | Python mode forces the Newline line ending (§7.9) |

### 2.14 Names, scopes and renaming

- **Scopes** follow Python: module names are C++ globals; a name assigned anywhere in a `def` is
  local unless declared `global`; reading a global needs no declaration (UnboundLocalError and
  W-global-shadow as §5.2).
- **C++ name of a Python name**: (1) transliterate non-ASCII: NFD, drop combining marks, then `ß→ss
  æ→ae œ→oe ø→o đ→d ł→l þ→th`; any other non-ASCII character → `u` + 4 hex digits (`température` →
  `temperature`, `حرارة` → `u062du0631u0627u0631u0629`); (2) if the result is reserved (below) or
  already used, append `_` until free (`map` → `map_`, `B1` → `B1_`); (3) a web of another kind
  gets `_2`, `_3` (§2.9).
  Messages always use the Python name.
- **Reserved** (`src/python/reserved-names.ts`, generated and committed): the C++11 keywords and
  alternative tokens (`and_eq bitand bitor compl not_eq or_eq xor xor_eq …`); every macro of
  `cc1plus -E -dM` over a translation unit that includes `Arduino.h`, `Wire.h`,
  `LiquidCrystal_I2C.h`, `DHT.h`, `Adafruit_NeoPixel.h`, `Servo.h` (this covers `B0…B11111111`,
  `abs min max round sq constrain F DEFAULT HIGH PI …`); every identifier of that TU's preprocessed
  text whose `long NAME = 0;` fails at file scope or inside a function (`square rand div exp log A0
  LED_BUILTIN …`), found by `scripts/gen-reserved-names.mjs` with the WASM toolchain; the
  simulator's `KNOWN_RUNTIME_NAMES`; and every name the translator emits (`setup loop main String
  Serial Wire byte word boolean`, the `py…` helpers, `showSegments showDigit`, the zero1 pin
  constants, library class names).

### 2.15 Student section: "What works in ZERO1 Python"

Linked from the Python tab note (§7.3). A one-page summary of §2–§3 in student words: the program
shape (top part runs once, `while True:` runs forever); the modules and names (§3); what is
missing (classes, dictionaries, `try` except the two forms, slices, lambda, comprehensions); the
number table of §2.13; "the Code tab shows the Arduino sketch made from your Python — it is what
runs and what goes to the board". Owner A (it is part of this file; §11).

---

## 3. The board API (MicroPython style)

Modules a program may import: `machine`, `time` (alias `utime`), `neopixel`, `dht`, `hcsr04`,
`math`, `random`, `micropython`, `zero1`. Any other → E-module. `from m import *` is allowed for
all of them. The API is one table (`src/python/api.ts`): for each member, its Python parameters
(positional and keyword, kinds, defaults), result kind, lowering, what it needs (includes, pin
constants, globals, setup lines, helpers), a one-line doc (for completion and hover) and its hints.
The translator emits nothing the simulator's C++ subset (docs/ARCHITECTURE.md §4.2) or avr-g++ 7.3
would refuse; §10.6 proves it for every example and golden.

**Pins.** A pin argument may be an int `0..19`, a `zero1` constant, the string form of a ZERO1 or
Arduino name (`"LED_RED"`, `"D13"`, `"A3"`; `"LED"` = D13, MicroPython's usual built-in LED name),
or a `Pin` object. Anything else → E-pin. The generated C++ always uses the constant
(`Pin("LED_RED", Pin.OUT)` → `const int led = LED_RED;`).

**Import convention used by the examples and the New template**: standard things from their
MicroPython modules (`from machine import Pin, ADC, PWM, I2C`, `import time`,
`from neopixel import NeoPixel`, `import dht`), ZERO1 names and parts from `zero1`
(`from zero1 import *` or explicit names). `zero1` does **not** re-export `Pin` & co.

### 3.1 `zero1` pin names

Same names and comments as the Blocks generator (docs/BLOCKS.md §11.2), emitted once each when
used (`const int LED_RED = A1;      // red LED`). Keep the capitals (MicroPython boards name their
pins this way: pyboard-D `LED_RED`, Pico `"LED"`).

| Name | Pin | Name | Pin |
|---|---|---|---|
| `LED_RED`, `LED_GREEN` | A1, A2 | `BUZZER` | 8 |
| `LED_BUILTIN` | 13 (Arduino's own, no declaration) | `DHT_PIN` | 5 |
| `BUTTON_1`, `BUTTON_2` | 6, 7 | `TRIG_PIN`, `ECHO_PIN` | 3, 2 |
| `POT_LDR` | A3 | `RGB_PIN` | 9 |
| `MOTOR` | A0 | `SEG_DATA`, `SEG_LATCH`, `SEG_CLOCK` | 12, 11, 10 |
| `SERVO_PIN` | 4 | `A0` … `A5` | 14 … 19 (Arduino's own) |
| `LCD_ADDRESS` | `0x27` (a literal) | | |

### 3.2 `machine`

| MicroPython | C++ | Notes |
|---|---|---|
| `Pin(id)` | `const int name = id;` | a handle without a mode |
| `Pin(id, Pin.OUT)` / `Pin(id, Pin.OUT, value=1)` | `const int name = id;` + at the statement `pinMode(name, OUTPUT);` (+ `digitalWrite(name, HIGH);`) | |
| `Pin(id, Pin.IN)` / `Pin(id, Pin.IN, Pin.PULL_UP)` | `pinMode(name, INPUT);` / `INPUT_PULLUP` | |
| `Pin(id, Pin.IN, Pin.PULL_DOWN)` | `pinMode(name, INPUT);` + W-pull-down | |
| `Pin.OPEN_DRAIN`, `Pin.ALT…`, `Pin.ANALOG`, `drive=`, `alt=` | NA-api | |
| `p.on()` / `p.off()` | `digitalWrite(p, HIGH);` / `LOW` | W-pin-no-out when `p` was made without `Pin.OUT` |
| `p.value()`, `p()` | `digitalRead(p)` (int; `(long)` in arithmetic) | |
| `p.value(x)`, `p(x)` | `digitalWrite(p, x);` | int or bool |
| `p.toggle()` | `digitalWrite(p, !digitalRead(p));` | exists on esp32, esp8266, rp2, samd |
| `p.init()`, `p.irq()` | NA-api (irq hint: "check the pin in your while True loop instead") | |
| `PWM(pin)`, `PWM(pin, freq=…, duty_u16=…)` | `pinMode(p, OUTPUT);` (+ `analogWrite(p, duty / 257);`) | W-pwm-pin for pins other than 3 5 6 9 10 11; on `BUZZER` → W-pwm-buzzer; on `SERVO_PIN` or `freq(50)` → W-pwm-servo |
| `pwm.duty_u16(v)` | `analogWrite(p, v / 257);` (literals folded: 32768 → 127) | 65535 / 257 = 255 exactly |
| `pwm.duty(v)` (esp32/esp8266, 0..1023) | `analogWrite(p, v / 4);` | |
| `pwm.freq(f)` | nothing + W-pwm-freq | |
| `pwm.deinit()` | `analogWrite(p, 0);` | |
| `pwm.duty_u16()` (read), `duty_ns` | NA-api | |
| `ADC(pin)` / `ADC(Pin(pin))` | `const int name = pin;` | A0..A5 only (E-adc-pin) |
| `adc.read()` | `analogRead(p)` (int, `(long)` in arithmetic) | **0..1023 on the ZERO1** (like the ESP8266; esp32 lists `read()` as legacy 0..4095, rp2 has only `read_u16()`) — said in its completion doc and hover |
| `adc.read_u16()` | `map(analogRead(p), 0, 1023, 0, 65535)` | 0..65535 like every port |
| `adc.read_uv()`, `atten()`, `width()` | NA-api ("use read() * 5.0 / 1023 for volts") | |
| `I2C(0)`, `I2C(0, scl=Pin(A5), sda=Pin(A4))`, `SoftI2C(scl=…, sda=…)` | `#include <Wire.h>` + at the statement `Wire.begin();` | other pins → E-i2c-pins |
| `for a in i2c.scan():` | §2.4 | |
| `i2c.writeto`, `readfrom`, … | NA-api | |
| `time_pulse_us(pin, level, timeout_us=1000000)` | `(long)pulseIn(pin, level, timeout)` | 0 on timeout (MicroPython: −1/−2) — documented |
| `reset`, `freq`, `Timer`, `UART`, `SPI`, `RTC`, `WDT`, `deepsleep`, `lightsleep` | NA-api | |

### 3.3 `time` (alias `utime`)

| MicroPython | C++ | Notes |
|---|---|---|
| `sleep(s)` | literal: `delay(<ms>)` (`sleep(0.5)` → `delay(500)`); non-negative int constant: `delay(NAME * 1000L)`; non-negative float constant: `delay(round(NAME * 1000))`; anything else: `pySleep(s, line)` | W-sleep-long when a literal/constant is ≥ 60 |
| `sleep_ms(ms)` | literal / non-negative constant: `delay(ms)`; else `pySleepMs(ms, line)` | a float → E-sleep-ms-float |
| `sleep_us(us)` | `delayMicroseconds(us);` | |
| `ticks_ms()` / `ticks_us()` | `(long)millis()` / `(long)micros()` | int; subtracting or comparing tick values directly → W-ticks-diff |
| `ticks_diff(a, b)` | `(a - b)` | |
| `ticks_add(t, d)` | `(t + d)` | |
| `time()` | `(long)(millis() / 1000)` | seconds since the board started (the UNO has no clock) |

### 3.4 Serial: `print`, `input`

`print` → §2.11; `input` → `pyInput` (§2.6). `Serial.begin(9600);` is the first line of `setup()`
whenever `print`, `input`, `zero1.input_available()` or any helper that can stop the program
(`pyFail`) is used.

### 3.5 `neopixel`

| MicroPython | C++ |
|---|---|
| `NeoPixel(Pin(RGB_PIN), n)` (`n` a constant; `bpp`/`timing` → NA-api; other pin → E-part-pin) | `#include <Adafruit_NeoPixel.h>`; `Adafruit_NeoPixel np(n, RGB_PIN, NEO_GRB + NEO_KHZ800);`; at the statement `np.begin();` |
| `np[i] = (r, g, b)` / `np[i] = colour` | `np.setPixelColor(i, r, g, b);` / `np.setPixelColor(i, colour);` |
| `np.fill((r, g, b))` | `np.fill(np.Color(r, g, b));` (literal → hex constant) |
| `np.write()` | `np.show();` |
| `len(np)` | `n` |
| reading `np[i]` | NA-api |

### 3.6 Colours

A literal tuple → `0xRRGGBB` with the tuple as a comment (`const unsigned long RED = 0xFF0000; //
(255, 0, 0)`); a computed tuple → `np.Color(r, g, b)` using the program's NeoPixel (none → E-colour
"A colour (r, g, b) needs a NeoPixel: np = NeoPixel(Pin(RGB_PIN), 1)").

### 3.7 `dht`, `hcsr04`

| MicroPython | C++ |
|---|---|
| `dht.DHT22(Pin(DHT_PIN))` / `DHT11` | `#include <DHT.h>`; `DHT sensor(DHT_PIN, DHT22);`; at the statement `sensor.begin();` |
| `sensor.measure()` | statement only: §2.12 (form S or the stopping check) |
| `sensor.temperature()` / `humidity()` | `sensor.readTemperature()` / `sensor.readHumidity()` (float) |
| `HCSR04()`; also `HCSR04(trigger_pin=TRIG_PIN, echo_pin=ECHO_PIN)` and `hcsr04.HCSR04(…)` (rsc1975 driver names) | at the statement `pinMode(TRIG_PIN, OUTPUT); pinMode(ECHO_PIN, INPUT);`; other pins → E-part-pin; `echo_timeout_us` other than the default → W-echo-timeout |
| `sonar.distance_cm()` | `pyDistanceCm(TRIG_PIN, ECHO_PIN, line)` (float) — or form S |
| `sonar.distance_mm()` | `(long)(pyDistanceCm(TRIG_PIN, ECHO_PIN, line) * 10)` |

### 3.8 `zero1` parts (ZERO1-only; fixed wiring, so no pin argument)

Rule: **standard MicroPython classes take a pin** (`Pin`, `PWM`, `ADC`, `NeoPixel`, `DHT22`);
**ZERO1-only parts take none**. An explicit pin equal to the ZERO1 wiring is accepted (for code
copied from elsewhere); another pin → E-part-pin.

| Python | C++ declaration / setup line | Methods → C++ |
|---|---|---|
| `Servo()` | `#include <Servo.h>`; `Servo servo;`; `servo.attach(SERVO_PIN);` | `angle(a)` → `servo.write(a);` · `angle()` → `servo.read()` · `detach()` → `servo.detach();` |
| `LCD()` (`addr=0x27, cols=16, rows=2` accepted) | `#include <Wire.h>`, `<LiquidCrystal_I2C.h>`; `LiquidCrystal_I2C lcd(0x27, 16, 2);`; `lcd.init(); lcd.backlight();` | `clear()` · `move_to(col, row)` → `setCursor` · `putstr(text)` → `lcd.print(…)` per piece (text only: E-api-kind) · `putchar(chr(n))` → `lcd.write((byte)n);` · `putchar("A")` → `lcd.print("A");` · `custom_char(slot, bitmap)` → `lcd.createChar(slot, bitmap);` (`bitmap` a list of 8 ints 0..31, declared `byte`) · `backlight_on/off()` · `display_on/off()` · `show_cursor/hide_cursor()` · `blink_cursor_on/off()` (method names of dhylands/python_lcd) |
| `Buzzer()` | `pinMode(BUZZER, OUTPUT);` | `tone(freq)` → `tone(BUZZER, freq);` · `tone(freq, ms)` → `tone(BUZZER, freq, ms);` (does not wait) · `no_tone()` → `noTone(BUZZER);`. Click on/off: `Pin(BUZZER, Pin.OUT)` |
| `SevenSegment()` | `pinMode(SEG_DATA, OUTPUT);` ×3; helpers `showSegments`, `showDigit` (verbatim from the Blocks generator) | `show(d)` → `showDigit(d);` (0..9, others blank) · `segments(bits)` → `showSegments(bits);` · `clear()` → `showSegments(0);` |
| `HCSR04()` | §3.7 | §3.7 |
| `map_range(x, in_min, in_max, out_min, out_max)` | `map(…)` (whole numbers, Arduino rounding) | |
| `input_available()` | `(Serial.available() > 0)` | |

Not in v1: `Motor` (use `Pin(MOTOR, Pin.OUT)`), `Buzzer.on()/off()` (use a `Pin`).

**Hints for "number versus object" mix-ups** (E-attr-int-pin, E-class-not-part): `LED_RED.on()`
→ "AttributeError: 'int' object has no attribute 'on'. LED_RED is the pin number of the red LED:
make a Pin first: led = Pin(LED_RED, Pin.OUT)"; `Buzzer.tone(440)` → "TypeError: Buzzer.tone()
missing 1 required positional argument: 'self'. Buzzer is a kind of part: make one first:
buzzer = Buzzer()".

### 3.9 `math`, `random`, `micropython`

| Python | C++ |
|---|---|
| `math.pi`, `math.e` | `PI`, `EULER` |
| `math.sqrt sin cos tan asin acos atan atan2 exp log log10 fabs` | same names |
| `math.floor(x)`, `ceil`, `trunc` | `(long)floor(x)`, `(long)ceil(x)`, `(long)trunc(x)` (Python gives ints) |
| `math.pow(a, b)` | `pow(a, b)` |
| `math.radians(x)`, `degrees(x)` | `radians(x)`, `degrees(x)` |
| `math.isnan(x)`, `isinf(x)` | `isnan(x)`, `isinf(x)` |
| `random.randint(a, b)` | `random(a, b + 1L)` (literals folded: `random(1, 7)`) |
| `random.randrange(stop)` / `(start, stop)` | `random(stop)` / `random(start, stop)`; `step` → NA-api |
| `random.random()` | `(random(0, 1000000) / 1000000.0)` |
| `random.uniform(a, b)` | `(a + (b - a) * (random(0, 1000000) / 1000000.0))` |
| `random.choice(lst)` | `lst[random(0, N)]`; growable: `lst[pyIndex(random(0, lstCount), lstCount, line)]` |
| `random.seed(n)` / `random.seed()` | `randomSeed(n);` / `randomSeed(micros());` |
| `micropython.const(e)` | a constant (§2.9) |

### 3.10 Later, on a real MicroPython board (not built now)

A `zero1.py` for ESP32 / Pico would provide the pin table and the ZERO1-only parts (`Servo` via
`PWM(freq=50)` + `duty_ns`, `LCD` wrapping dhylands `I2cLcd`, `Buzzer.tone` via `PWM.freq` +
`duty_u16(32768)`, `SevenSegment` via three `Pin`s, `map_range`, `input_available` via
`select.poll`). Programs written for ZERO1 Python then run unchanged, because the sensor idioms
are MicroPython's own (`measure()` + `except OSError`). Differences a teacher would meet there:
big integers, `ADC.read()` absent on rp2, and Python's full language.

---

## 4. Translator design (`src/python/`, stream A)

### 4.1 Pipeline

```
Python source ─normalize()─▶ ─tokenize()─▶ tokens (NEWLINE/INDENT/DEDENT; comments as trivia)
             ─parse()─────▶ Module AST (line, col, endLine, endCol on every node)
             ─resolve()───▶ scopes, imports, API bindings, objects, main-loop split (§2.1)
             ─flow()──────▶ CFG per scope, reaching definitions, webs, definite assignment, non-negative facts
             ─infer()─────▶ kinds of every web / parameter / return / expression (§2.9)
             ─check()─────▶ subset and API rules, warnings (§5)
             ─emit()──────▶ Arduino sketch + SourceMap
sketch ──transpile() (unchanged API)──▶ JS + lineMap ──Executor──▶ virtual board
```

Parser: hand-written tokenizer and recursive descent with precedence climbing, like
`src/transpiler`. Reasons: CPython-quality messages at exact positions are the main product;
the subset is small; no dependency. Rejected: `@lezer/python` (error-tolerant tree, anonymous `⚠`
error nodes — kept for highlighting only), tree-sitter (hundreds of KB), unmaintained JS Python
parsers.

### 4.2 Files and public API

| File | Exports | Content |
|---|---|---|
| `index.ts` | the public surface below (nothing else is imported from outside `src/python`) | re-exports |
| `translate.ts` | `pythonToArduino` | runs the pipeline; never throws (X-internal) |
| `blank.ts` | `BLANK_PYTHON` | the New template (§7.7) |
| `tokens.ts` | `normalize`, `tokenize`, `Token`, `TokenKind` | §2.2 |
| `ast.ts` | node types | §4.4 |
| `parser.ts` | `parse(tokens): Module` (throws `PythonSyntaxError`) | §2.3 |
| `scope.ts` | `resolve(module): Resolved` | scopes, imports, globals, objects, main loop, names (§2.14) |
| `flow.ts` | `analyzeFlow(resolved): Flow` | CFG, reaching definitions, webs, definite assignment, non-negative facts |
| `kinds.ts` | `Kind`, `infer(resolved, flow): Typing` | §2.9 (not shared with Blocks: Python needs `long` and an error for text+number) |
| `api.ts` | `API_MODULES`, `lookupMember`, `API_COMPLETIONS` | §3 table + completion items with one-line docs |
| `check.ts` | `check(resolved, flow, typing): PythonDiagnostic[]` | every rule of §2, §3 |
| `emit.ts` | `emit(resolved, flow, typing): { sketch: string; map: SourceMap }` | §4.7 |
| `helpers.ts` | `PY_HELPERS`, `helperOrder` | verbatim C++ texts (§4.8), list helpers generated per element type from one template |
| `sourcemap.ts` | `SourceMap` | §4.9 |
| `messages.ts` | `MESSAGES`, `MessageCode`, `message()`, `pythonizeRuntimeMessage`, `PY_FAIL_LINE` | every student-facing text (§5), keyed by code |
| `reserved-names.ts` | `RESERVED_NAMES` | generated (§2.14) |

Shared, Blockly-free code extracted first (so `src/python` never imports Blockly):
`src/sketch/pins.ts` (the `PINS` table now in `src/blocks/generator.ts`), `src/sketch/order.ts`
(C++ precedence `Order`), `src/sketch/helpers.ts` (`showSegments`, `showDigit` texts),
`src/sketch/placeholder.ts` (below). `src/blocks/generator.ts` imports them; its golden outputs
must stay byte-identical. `combineKinds` is **not** shared.

```ts
// src/types.ts (Day-1 contract, §11.2) — additions
export interface Diagnostic {
  line: number; column: number; severity: 'error' | 'warning'; message: string;
  endLine?: number;   // new: underline to here (editor.ts toCmDiagnostic uses it)
  endColumn?: number;
}
export interface ConsoleMessage {
  /* …existing… */
  source?: 'sketch' | 'python';   // new: which editor `line` belongs to (console jump, §7.10)
}

// src/python/index.ts
export interface PythonDiagnostic extends Diagnostic {
  /** Stable id from messages.ts; tests assert on it. */
  code: MessageCode;
}
export interface PythonTranslation {
  /** No errors (warnings allowed): only then may the sketch be run, downloaded, handed in as a sketch or uploaded. */
  ok: boolean;
  /** The Arduino sketch; when !ok the placeholder of src/sketch/placeholder.ts. */
  sketch: string;
  map: SourceMap;
  /** Errors first, then warnings; each group sorted by position; at most 20 errors (+ X-too-many). */
  diagnostics: PythonDiagnostic[];
  /** No main loop (§2.1 rule 2): the app finishes the run after setup() (§7.8). */
  endsAfterSetup: boolean;
  /** The program calls input(): Run shows the Serial Monitor (§7.9). */
  usesInput: boolean;
}
export function pythonToArduino(source: string): PythonTranslation;
export const BLANK_PYTHON: string;
export { SourceMap } from './sourcemap';
export { API_COMPLETIONS } from './api';
export { pythonizeRuntimeMessage, type MessageCode } from './messages';
export { PYTHON_EXAMPLES, type PythonExample } from '../examples/python';

// src/python/sourcemap.ts
export class SourceMap {
  constructor(sketchToPython: readonly number[]);
  /** sketchToPython[sketchLine - 1] = Python line (1-based); 0 for scaffolding and helper bodies. */
  readonly sketchToPython: readonly number[];
  pythonLineOf(sketchLine: number): number;              // 0 when unknown
  sketchLinesOf(pythonLine: number): number[];           // every sketch line made from that Python line
  /** transpile()'s lineMap (JS line → sketch line) composed with this map (JS line → Python line). */
  composeJsLineMap(jsLineMap: readonly number[]): number[];
}

// src/python/messages.ts
/** A pyFail() line on the Serial Monitor: "Line 12: IndexError: list index out of range". */
export const PY_FAIL_LINE: RegExp; // /^Line (\d+): (.+)$/
/**
 * Python-mode rewording of a runtime console message. When the Executor reports abort()
 * (§6 item 3), the last PY_FAIL_LINE of `serialTail` becomes the message and its line number
 * (works on every browser: no stack frames needed). Known runtime texts get Python words.
 */
export function pythonizeRuntimeMessage(msg: ConsoleMessage, serialTail: string): ConsoleMessage;

// src/sketch/placeholder.ts (shared by A and C)
/** First line of the sketch generated for a Python program with errors. */
export const PYTHON_PLACEHOLDER_PREFIX = '// Your Python program has ';
/** "…has 2 errors, so there is no Arduino sketch yet." → 2; null for a real sketch. */
export function placeholderErrorCount(sketch: string): number | null;

// src/examples/python/index.ts
export interface PythonExample {
  id: string; title: string; group: string; description: string;
  /** The Python program. No `source` field: the Examples menu dispatches on the mode, never on 'source' in x. */
  python: string;
}
export const PYTHON_EXAMPLES: PythonExample[];
```

### 4.3 Tokenizer

Token kinds `NAME`, `NUMBER` (value, int/float, raw text), `STRING` (value, prefix, raw),
`FSTRING` (literal parts and fields, each field with its own position and spec text), `OP`,
`NEWLINE`, `INDENT`, `DEDENT`, `COMMENT` (trivia with its column), `EOF`. Implements §2.2
exactly; the first lexical error stops tokenizing (one error, like CPython). C-habit tokens are
recognised for better messages: `++`, `--` (as a suffix), `&&`, `||`, `!` (not before `=`),
`//` at the start of a logical line, `{` after a condition, `else if`, `true`/`false`/`null`
(NameError with "Did you mean: 'True'?").

### 4.4 AST

Positions on every node. Statements: `Assign` (targets: `Name` | `Subscript` | `TupleTarget`;
several targets for chains), `AugAssign`, `If` (elif as nested orelse), `While`, `For`,
`FunctionDef` (name, params with defaults, body, docstring), `Return`, `Global`, `Import`,
`ImportFrom`, `ExprStmt`, `Pass`, `Break`, `Continue`, `Try` (body, handler name/alias, handler
body, else body), `Raise`, `Assert`, `Unsupported` (keyword, for NA codes). Expressions: `Name`,
`Num`, `Str` (with concatenated parts), `FString`, `Bool`, `NoneLit`, `BinOp`, `UnaryOp`,
`BoolOp`, `Compare` (ops + comparators), `IfExp`, `Call` (args, keywords), `Attribute`,
`Subscript`, `ListLit`, `ListRepeat` (`[v] * N`), `TupleLit`, `Unsupported` (comprehension,
lambda, dict, set, slice, walrus, starred, await, yield, ellipsis). Comments: each comment is
attached by **indentation**: a comment line belongs to the innermost block whose indentation is ≤
its column, as a leading comment of the next statement of that block, or as a trailing comment of
the block when no statement follows (so a comment at the end of an indented block stays inside
its braces). End-of-line comments are `trailing` of the statement.

### 4.5 Resolution and data flow

`scope.ts`: module scope (imports, functions, globals), one scope per function (params, locals,
`global` names), API binding of every name and attribute, object instances (class, construction
statement, C++ name), the main-loop split, the C++ name of every Python name (§2.14).
`flow.ts`: per scope, a CFG over statements (conditions are nodes; `break`/`continue`/`return`
edges; the main loop's back edge), reaching definitions by the classic iterative algorithm,
def-use chains, webs (union-find over "use sees def"), definite assignment (a must-analysis on the
same CFG), non-negative facts (fixed point). Webs of module names shared with functions are forced
into one (§2.9).

### 4.6 Checks

`check.ts` applies every rule of §2 and §3 in one walk and produces diagnostics with codes and
exact positions (`line`, `column` of the first token; `endLine`, `endColumn` of the construct).
Parsing stops at the first syntax/indentation error; name, kind and API errors are collected (up
to 20). Warnings are only computed when there is no error.

### 4.7 Emitter conventions

**Layout** (blank line between non-empty sections; 2-space indentation like the Blocks generator):

```
// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/* <module docstring> */                              only when there is one
#include <…>                                          Wire, LiquidCrystal_I2C, DHT, Adafruit_NeoPixel, Servo — only those used
const int LED_RED = A1;        // red LED             zero1 pin names used (PINS order)
Servo servo; LiquidCrystal_I2C lcd(0x27, 16, 2); …    library objects, Python order
const long NOTE_C4 = 262;  long count = 0; …          constants, globals, lists (first definition order)
<user functions>                                      Python order (docstring as // lines above)
// Runs once: the lines before "while True:"          ("// Runs once: the whole program" without a main loop)
void setup() { Serial.begin(9600); … }
// Runs forever: the body of "while True:" (line N)
void loop() { … }
// ---- Helpers that make C++ behave like Python ----   only when helpers are used
<helpers>                                             §4.8 order, each once
```

**Numbers**

- **N1 (everything is `long`).** In an int-kinded expression, int literals that are operands of
  `+ - * / % << >> & | ^` (or of a unary `-` inside one) get the `L` suffix (`value * 100L / 1023L`,
  `pyMod(n, 5L)`); literals elsewhere (call arguments, comparisons, initialisers, sizes, and
  float-kinded expressions such as `BLINK_TIME * 1000`) stay plain. Int-kinded values of a narrower C++
  type get a `(long)` cast when they are such an operand: `analogRead`, `digitalRead`, `pulseIn`,
  `String::length`, `String::indexOf`, pin constants, bools. `millis()`/`micros()` are always
  `(long)millis()` (so tick differences can be negative, as in MicroPython). Compound assignments
  to a `long` need nothing (`count += 1;`).
- **N2** `/`: two ints → `(float)a / b`; an int literal divisor → `a / 2.0`.
- **N3** `//`, `%` on ints → `pyFloorDiv`, `pyMod`, except plain `/`, `%` when the dividend is
  known ≥ 0 (§2.9) and the divisor is a positive constant.
- **N4** divisors of `/ // %` (and their augmented forms) that are not non-zero constants are
  wrapped: `pyNonZero(d, line)` (int) / `pyNonZeroF(d, line)` (float).
- **N5** `**` per §2.5; `pyPow(a, b, line)` stops on a negative exponent.
- **N6** float literals are written without `f` (`0.5`, `3.0`, `1e+30`).

**Declarations**

- **D1 globals**: every variable (§2.9) that must outlive one round of `loop()` or is used by a function is a
  C++ global declared in the globals section at its first definition's place in source order. When
  that first definition is a top-level constant expression that runs before any use, it is the
  initialiser (`long count = 0;`, no `setup()` line); otherwise the global is declared with its
  zero value and assigned in place.
- **D2 loop locals**: a variable whose definitions and uses are all inside the main loop, used by no
  function, and whose definitions do not reach the loop head (no use can see a value from the
  previous round) is a local of `loop()`: declared at its first definition when that definition
  is directly in the loop body and dominates all uses (`long value = analogRead(adc);`), else at
  the top of `loop()` with its zero value. *First* means first in evaluation order: the right
  side is evaluated before the target, and an augmented assignment is a read. Hence
  `count = count + 1` / `count += 1` at the top of `while True:` never becomes a local (it is
  E-name on the first round, as in Python). The same rule makes setup-only variables locals of
  `setup()`.
- **D3 function locals**: declared at the first definition when it is directly in the body and
  dominates all uses; otherwise at the top of the function with the zero value.
- **D4 objects**: compile-time objects produce no variable except `Pin`/`ADC` (`const int led =
  LED_RED;`, keeping the student's name); library objects are globals named after the Python
  variable.

**Comments and text**

- **C1** Leading comments become `//` lines before the first line emitted for their statement;
  trailing comments go on the statement's first emitted line. Attachment by indentation (§4.4).
  The leading comments of the imports a program starts with describe the program: they go in the
  header, after the docstring.
- **C2** Carried comments have trailing whitespace trimmed; a `//` comment line that would end
  with `\` gets `.` appended (a `//` line ending in `\` swallows the next line in GCC).
- **C3** The module docstring becomes the `/* … */` header with every `*/` written `* /`; a
  function docstring becomes `//` lines (C2 applies).
- **C4** One blank line between two Python statements is kept (at most one).
- **S1** Strings are UTF-8; `"` `\` and control characters are escaped (`\n \t \r`, others
  `\xHH`); after any `\xHH` escape followed by a hex digit, and after `\0` followed by a digit, the
  literal is split (`"\x41" "BC"`: GCC would read `\x41BC` as one escape); `??` is split
  (`"?" "?"`, no trigraph warning); `°` on the LCD → `"\xDF"`.

**Statements and expressions**

- **E1** Expressions are printed from the AST with C++ precedence (`src/sketch/order.ts`),
  parentheses only where needed; `a & b == c` (Python: `(a & b) == c`) gets its parentheses;
  `not a == b` → `!(a == b)`; `-x ** 2` → `-pyPow(x, 2, line)` (`-2 ** 2` with literals folds to `-4`).
- **E2** Constant folding only where it helps reading: `sleep(0.5)` → `delay(500)`,
  `randint(1, 6)` → `random(1, 7)`, colour literals, `"-" * 16`, negative literal list indexes;
  never across names (`delay(round(BLINK_TIME * 1000))` keeps the student's constant).
- **E3** Every generated sketch must `transpile()` without errors and without warnings, and
  compile with avr-g++ `-Wall -Wextra` without warnings; tests enforce both (§10.6). A
  `transpile()` warning that still happens in the field is shown mapped (W-sketch).

### 4.8 C++ helpers (verbatim; emitted once each, only when used)

Validated on 2026-09-28 in the simulator (with `abort()` stubbed until §6 item 3 lands), with the
project's avr-g++ 7.3 WebAssembly toolchain at `-Wall -Wextra` (0 warnings) and on avr8js
(`tools/emulator/run-hex.mjs`): identical Serial output except `round(2.675, 2)` (2.67 in today's
simulator, 2.68 on the chip — fixed by §6 item 1) and the ultrasonic distance (49.7 vs 49.3 cm: the
simulator's and the emulator's echo models differ; board-twin tests compare distances to ±1 cm)
(Appendix B, f6). Names start with `py` so a reader sees where Python's rules live. The `…L`
list helpers exist also as `…F` (float), `…S` (String) and `…B` (bool), generated from the same
template by replacing the element type.

```cpp
// Stops the program like a Python error: the message goes to the Serial Monitor, then the board halts
void pyFail(int line, String text) {
  Serial.print("Line ");
  Serial.print(line);
  Serial.print(": ");
  Serial.println(text);
  Serial.flush();
  abort();
}

// Python's // for whole numbers: rounds down (C++'s / rounds toward zero)
long pyFloorDiv(long a, long b) {
  long q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
  return q;
}

// Python's % for whole numbers: the result has the sign of the divisor
long pyMod(long a, long b) {
  long r = a % b;
  if (r != 0 && ((r < 0) != (b < 0))) r += b;
  return r;
}

// Python's % for decimal numbers
float pyFloatMod(float a, float b) {
  float r = fmod(a, b);
  if (r != 0 && ((r < 0) != (b < 0))) r += b;
  return r;
}

// Python stops with ZeroDivisionError instead of dividing by 0
long pyNonZero(long divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
}

float pyNonZeroF(float divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
}

// Python's ** for whole numbers
long pyPow(long base, long exponent, int line) {
  if (exponent < 0) pyFail(line, "a negative power of a whole number is a decimal number: write 2.0 ** n");
  long result = 1;
  for (long i = 0; i < exponent; i++) result *= base;
  return result;
}

// 10 to the power n, exact on the board (pow() is not)
float pyPow10(int n) {
  float result = 1;
  for (int i = 0; i < n; i++) result *= 10;
  for (int i = 0; i > n; i--) result /= 10;
  return result;
}

// Python's round(x): halves go to the even number (round(2.5) == 2)
long pyRound(float x) {
  long n = floor(x);
  float rest = x - n;
  if (rest > 0.5 || (rest == 0.5 && n % 2 != 0)) n++;
  return n;
}

// Python's round(x, n)
float pyRoundTo(float x, int decimals) {
  float scale = pyPow10(decimals);
  return floor(x * scale + 0.5) / scale;
}

// Python's abs(), min() and max(): each value is worked out once (Arduino's abs/min/max are macros)
long pyAbsL(long x) {
  return x < 0 ? -x : x;
}

float pyAbsF(float x) {
  return x < 0 ? -x : x;
}

long pyMinL(long a, long b) {
  return a < b ? a : b;
}

long pyMaxL(long a, long b) {
  return a > b ? a : b;
}

float pyMinF(float a, float b) {
  return a < b ? a : b;
}

float pyMaxF(float a, float b) {
  return a > b ? a : b;
}

// How Python shows True and False
String pyBool(bool b) {
  return b ? "True" : "False";
}

// How MicroPython shows a decimal number: 7 significant digits, 3.0 keeps its .0,
// and 1e-05 / 1e+07 style below 0.0001 and from 10000000 on
String pyFloat(float x) {
  if (isnan(x)) return "nan";
  if (isinf(x)) return x > 0 ? "inf" : "-inf";
  if (x == 0) return "0.0";
  float size = fabs(x);
  int exponent = floor(log10(size));
  if (size < pyPow10(exponent)) exponent--;
  if (size >= pyPow10(exponent + 1)) exponent++;
  String text = pyDigits(x, exponent);
  if (pySignificant(text) > 7) {          // 9999999.6 rounds up to 10000000: one more digit
    exponent++;
    text = pyDigits(x, exponent);
  }
  if (exponent < -4 || exponent >= 7) {
    text += exponent < 0 ? "e-" : "e+";
    if (abs(exponent) < 10) text += "0";
    text += String(abs(exponent));
  } else if (text.indexOf('.') < 0) {
    text += ".0";
  }
  return text;
}

// The 7 significant digits of x, without the zeros at the end (for pyFloat)
String pyDigits(float x, int exponent) {
  bool scientific = exponent < -4 || exponent >= 7;
  int decimals = scientific ? 6 : 6 - exponent;
  String text = String(scientific ? x / pyPow10(exponent) : x, decimals);
  if (decimals > 0) {
    while (text.endsWith("0")) text.remove(text.length() - 1);
    if (text.endsWith(".")) text.remove(text.length() - 1);
  }
  return text;
}

// How many significant digits a number text has (for pyFloat)
int pySignificant(String text) {
  int count = 0;
  bool started = false;
  for (unsigned int i = 0; i < text.length(); i++) {
    char c = text.charAt(i);
    if (c >= '1' && c <= '9') started = true;
    if (started && c >= '0' && c <= '9') count++;
  }
  return count;
}

// f-string widths: '>' spaces on the left (numbers), '<' spaces on the right (text), '0' zeros after the sign
String pyPad(String text, int width, char how) {
  while ((int)text.length() < width) {
    if (how == '<') {
      text += " ";
    } else if (how == '0' && text.startsWith("-")) {
      text = "-0" + text.substring(1);
    } else if (how == '0') {
      text = "0" + text;
    } else {
      text = " " + text;
    }
  }
  return text;
}

// f"{n:x}" and f"{n:X}": hexadecimal, with "-" in front of negative numbers
String pyHex(long n, bool upper) {
  String text = String(n < 0 ? -n : n, HEX);
  if (upper) text.toUpperCase();
  else text.toLowerCase();
  return n < 0 ? "-" + text : text;
}

// f"{n:b}": binary, with "-" in front of negative numbers
String pyBin(long n) {
  String text = String(n < 0 ? -n : n, BIN);
  return n < 0 ? "-" + text : text;
}

// Python's input(): waits for one line typed in the Serial Monitor and shows it, like a terminal
String pyInput(String prompt) {
  Serial.print(prompt);
  while (Serial.available() == 0) {
  }
  String line = Serial.readStringUntil('\n');
  if (line.endsWith("\r")) line.remove(line.length() - 1);
  Serial.println(line);
  return line;
}

// True when int() can read the text: spaces, an optional sign, then digits
bool pyIsInt(String text) {
  text.trim();
  int start = (text.startsWith("-") || text.startsWith("+")) ? 1 : 0;
  if ((int)text.length() <= start) return false;
  for (int i = start; i < (int)text.length(); i++) {
    char c = text.charAt(i);
    if (c < '0' || c > '9') return false;
  }
  return true;
}

// Python's int(text): stops with ValueError when the text is not a whole number
long pyInt(String text, int line) {
  if (!pyIsInt(text)) pyFail(line, "ValueError: invalid literal for int() with base 10: '" + text + "'");
  text.trim();
  return text.toInt();
}

// True when float() can read the text: an optional sign, digits with at most one point, an optional exponent
bool pyIsFloat(String text) {
  text.trim();
  int i = (text.startsWith("-") || text.startsWith("+")) ? 1 : 0;
  int digits = 0;
  bool point = false;
  for (; i < (int)text.length(); i++) {
    char c = text.charAt(i);
    if (c >= '0' && c <= '9') {
      digits++;
    } else if (c == '.' && !point) {
      point = true;
    } else {
      break;
    }
  }
  if (digits == 0) return false;
  if (i < (int)text.length() && (text.charAt(i) == 'e' || text.charAt(i) == 'E')) {
    i++;
    if (i < (int)text.length() && (text.charAt(i) == '-' || text.charAt(i) == '+')) i++;
    int exponentDigits = 0;
    while (i < (int)text.length() && text.charAt(i) >= '0' && text.charAt(i) <= '9') {
      i++;
      exponentDigits++;
    }
    if (exponentDigits == 0) return false;
  }
  return i == (int)text.length();
}

// Python's float(text): stops with ValueError when the text is not a number
float pyFloatOf(String text, int line) {
  if (!pyIsFloat(text)) pyFail(line, "ValueError: could not convert string to float: '" + text + "'");
  return text.toFloat();
}

// Python's str.isdigit()
bool pyIsDigit(String text) {
  if (text.length() == 0) return false;
  for (unsigned int i = 0; i < text.length(); i++) {
    if (text.charAt(i) < '0' || text.charAt(i) > '9') return false;
  }
  return true;
}

String pyUpper(String text) {
  text.toUpperCase();
  return text;
}

String pyLower(String text) {
  text.toLowerCase();
  return text;
}

String pyStrip(String text) {
  text.trim();
  return text;
}

String pyReplace(String text, String from, String to) {
  text.replace(from, to);
  return text;
}

// text[i] with Python's negative indexes and IndexError
String pyCharAt(String text, long index, int line) {
  if (index < 0) index += text.length();
  if (index < 0 || index >= (long)text.length()) pyFail(line, "IndexError: string index out of range");
  return String(text.charAt(index));
}

// list[i] with Python's negative indexes and IndexError
long pyIndex(long index, long size, int line) {
  if (index < 0) index += size;
  if (index < 0 || index >= size) pyFail(line, "IndexError: list index out of range");
  return index;
}

// list.append(value) for a list with room for `capacity` items; gives the new length
long pyAppendL(long list[], long count, long capacity, long value, int line) {
  if (count >= capacity) pyFail(line, "MemoryError: the list is full (" + String(capacity) + " items on the board)");
  list[count] = value;
  return count + 1;
}

// list.pop(index): takes the item out and moves the ones after it; the caller then shortens the list by 1
long pyPopL(long list[], long count, long index, int line) {
  if (count == 0) pyFail(line, "IndexError: pop from empty list");
  if (index < 0) index += count;
  if (index < 0 || index >= count) pyFail(line, "IndexError: pop index out of range");
  long value = list[index];
  for (long i = index; i < count - 1; i++) list[i] = list[i + 1];
  return value;
}

// str(list) / print(list): [1, 2, 3]
String pyListTextL(long list[], long count) {
  String text = "[";
  for (long i = 0; i < count; i++) {
    if (i > 0) text += ", ";
    text += String(list[i]);
  }
  return text + "]";
}

long pySumL(long list[], long count) {
  long total = 0;
  for (long i = 0; i < count; i++) total += list[i];
  return total;
}

long pyMinListL(long list[], long count, int line) {
  if (count == 0) pyFail(line, "ValueError: min() arg is an empty sequence");
  long smallest = list[0];
  for (long i = 1; i < count; i++) {
    if (list[i] < smallest) smallest = list[i];
  }
  return smallest;
}

long pyMaxListL(long list[], long count, int line) {
  if (count == 0) pyFail(line, "ValueError: max() arg is an empty sequence");
  long largest = list[0];
  for (long i = 1; i < count; i++) {
    if (list[i] > largest) largest = list[i];
  }
  return largest;
}

bool pyInListL(long list[], long count, long value) {
  for (long i = 0; i < count; i++) {
    if (list[i] == value) return true;
  }
  return false;
}

// Python's time.sleep(seconds) for a value that is not a fixed number
void pySleep(float seconds, int line) {
  if (seconds < 0) pyFail(line, "ValueError: sleep length must be non-negative");
  delay((unsigned long)(seconds * 1000 + 0.5));
}

// Python's time.sleep_ms(ms) for a value that is not a fixed number
void pySleepMs(long ms, int line) {
  if (ms < 0) pyFail(line, "ValueError: sleep length must be non-negative");
  delay(ms);
}

// HC-SR04: a 10 µs pulse on trig, then the echo time on echo; no echo gives 0,
// or stops the program with MicroPython's OSError when line > 0
float pyDistanceCm(int trigPin, int echoPin, int line) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long duration = pulseIn(echoPin, HIGH, 30000);
  if (duration == 0 && line > 0) pyFail(line, "OSError: Out of range");
  return duration * 0.0343 / 2;
}
```

Element-kind details for the generated variants: `pyListTextF` uses `pyFloat(list[i])`,
`pyListTextS` writes `'` + item + `'`, `pyListTextB` uses `pyBool`; `…S` has no `pySum`/`pyMin`
variants (E-api-kind). `showSegments` / `showDigit` are the Blocks helpers, verbatim
(`src/sketch/helpers.ts`). `pyDistanceCm` uses the same arithmetic as the Arduino twins, so
distances match (`49.7 cm` at 50 cm in the simulator).

### 4.9 Source map

The emitter writes through a `Writer` that knows the Python statement being emitted
(`writer.at(stmt)`) and records, for every sketch line, that statement's first line (continuation
lines of a multi-line Python statement map to its first line). Scaffolding (header, includes,
pin constants, braces, `Serial.begin`, labels, helper bodies) maps to 0; hoisted declarations map
to the statement that caused them; object setup lines map to their construction statement; a
`for` header maps to the `for` line. `composeJsLineMap(js)[i] = js[i] ? sketchToPython[js[i] - 1]
: 0`.

Uses: (1) Executor `lineMap` in Python mode, so runtime messages carry Python lines; frames in
helpers map to 0 and `sourceLineOf()` walks to the caller where the browser records async frames
(V8); where it does not (Firefox without DevTools), errors from helpers still get their line
because every helper that can fail receives the Python line and reports it through `pyFail`'s
Serial text (§6 item 3, `pythonizeRuntimeMessage`); (2) `transpile()` errors → X-sketch-error at the
mapped line (column 1); (3) Upload compile errors (§7.12); (4) v1.1: highlight in the Code tab the
lines made from the Python line under the cursor.

### 4.10 Translation examples (input → output)

These are the golden cases of §10.2 (fixtures `tests/fixtures/python/*.py` → `*.ino`).

**T1 — Blink** (`01_blink_red.py`, docstring shortened to lines 1–4):

```python
"""
ZERO1 Smart Board - 01 Blink the red LED
...
"""
from machine import Pin
from zero1 import LED_RED
import time

BLINK_TIME = 0.5              # how long the LED stays on (and off), in seconds

led = Pin(LED_RED, Pin.OUT)   # the red LED is an output

while True:
    led.on()                  # 5 V on the pin: the LED lights up
    print("ON")
    time.sleep(BLINK_TIME)    # wait; the board does nothing else meanwhile

    led.off()                 # 0 V on the pin: the LED goes off
    print("OFF")
    time.sleep(BLINK_TIME)
```

```cpp
// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.
/*
ZERO1 Smart Board - 01 Blink the red LED
...
*/

const int LED_RED = A1;        // red LED

const float BLINK_TIME = 0.5;  // how long the LED stays on (and off), in seconds
const int led = LED_RED;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(led, OUTPUT);        // the red LED is an output
}

// Runs forever: the body of "while True:" (line 13)
void loop() {
  digitalWrite(led, HIGH);     // 5 V on the pin: the LED lights up
  Serial.println("ON");
  delay(round(BLINK_TIME * 1000));  // wait; the board does nothing else meanwhile

  digitalWrite(led, LOW);      // 0 V on the pin: the LED goes off
  Serial.println("OFF");
  delay(round(BLINK_TIME * 1000));
}
```

**T2 — whole numbers, floor division, a guarded division, format widths**

```python
from machine import ADC
from zero1 import POT_LDR
import time

adc = ADC(POT_LDR)
total = 0
count = 0

while True:
    value = adc.read()
    percent = value * 100 // 1023
    total += value
    count += 1
    average = total / count
    print(f"{percent:3d} %  average {average:.1f}  {count % 60}")
    time.sleep_ms(500)
```

```cpp
// Made from a Python program in the ZERO1 Simulator; edits here are not turned back into Python.

const int POT_LDR = A3;        // potentiometer / light sensor

const int adc = POT_LDR;
long total = 0;
long count = 0;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
}

// Runs forever: the body of "while True:" (line 9)
void loop() {
  long value = analogRead(adc);
  long percent = value * 100L / 1023L;
  total += value;
  count += 1;
  float average = (float)total / pyNonZero(count, 14);
  Serial.print(pyPad(String(percent), 3, '>'));
  Serial.print(" %  average ");
  Serial.print(average, 1);
  Serial.print("  ");
  Serial.println(count % 60L);
  delay(500);
}

// ---- Helpers that make C++ behave like Python ----

<pyFail, pyNonZero, pyPad verbatim>
```

(`value` and `count` are known ≥ 0, so `//` and `%` are plain C++ operators.)

**T3 — the same name as text, then as a number (webs)**

```python
while True:
    answer = input("How old are you? ")
    answer = int(answer)
    print("Next year you will be", answer + 1)
```

```cpp
void loop() {
  String answer = pyInput("How old are you? ");
  long answer_2 = pyInt(answer, 3);   // 'answer' again, now a number
  Serial.print("Next year you will be ");
  Serial.println(answer_2 + 1L);
}
```

**T4 — a growable list** (capacity not provable → W-list-capacity on line 6)

```python
from machine import ADC
from zero1 import POT_LDR
import time

adc = ADC(POT_LDR)
readings = []

while True:
    readings.append(adc.read())
    if len(readings) > 10:
        readings.pop(0)
    print(readings, sum(readings) // len(readings))
    time.sleep(1)
```

```cpp
const int POT_LDR = A3;        // potentiometer / light sensor

const int adc = POT_LDR;
long readings[20];             // the list 'readings' has room for 20 items
long readingsCount = 0;

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
}

// Runs forever: the body of "while True:" (line 8)
void loop() {
  readingsCount = pyAppendL(readings, readingsCount, 20, analogRead(adc), 9);
  if (readingsCount > 10) {
    pyPopL(readings, readingsCount, 0, 11);
    readingsCount--;
  }
  Serial.print(pyListTextL(readings, readingsCount));
  Serial.print(" ");
  Serial.println(pyFloorDiv(pySumL(readings, readingsCount), pyNonZero(readingsCount, 12)));
  delay(1000);
}
```

(Non-negative facts are tracked for webs, not for list items, so this `//` keeps `pyFloorDiv`.)

**T5 — DHT with MicroPython's own idiom (form S)**

```python
import dht
from machine import Pin
from zero1 import DHT_PIN
import time

sensor = dht.DHT22(Pin(DHT_PIN))

while True:
    time.sleep(2)             # the DHT22 needs 2 s between two readings
    try:
        sensor.measure()
    except OSError:
        print("DHT22 error (is it plugged in?)")
        continue
    t = sensor.temperature()
    h = sensor.humidity()
    print(f"Temperature: {t:.1f} C  Humidity: {h:.1f} %")
```

```cpp
#include <DHT.h>

const int DHT_PIN = 5;         // DHT22 temperature / humidity sensor

DHT sensor(DHT_PIN, DHT22);

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  sensor.begin();
}

// Runs forever: the body of "while True:" (line 8)
void loop() {
  delay(2000);                 // the DHT22 needs 2 s between two readings
  if (!sensor.read()) {        // try: sensor.measure()  except OSError:
    Serial.println("DHT22 error (is it plugged in?)");
    return;                    // continue: start the next round of the loop
  }
  float t = sensor.readTemperature();
  float h = sensor.readHumidity();
  Serial.print("Temperature: ");
  Serial.print(t, 1);
  Serial.print(" C  Humidity: ");
  Serial.print(h, 1);
  Serial.println(" %");
}
```

**T6 — reading a number safely (form V)**

```python
while True:
    try:
        age = int(input("Age? "))
    except ValueError:
        print("Please type a whole number")
    else:
        print("In ten years:", age + 10)
```

```cpp
void loop() {
  String ageText = pyInput("Age? ");
  if (pyIsInt(ageText)) {
    long age = pyInt(ageText, 0);
    Serial.print("In ten years: ");
    Serial.println(age + 10L);
  } else {
    Serial.println("Please type a whole number");
  }
}
```

**T7 — functions with defaults and keywords, a global**

```python
from machine import Pin
from zero1 import BUTTON_1, Buzzer
import time

buzzer = Buzzer()
button = Pin(BUTTON_1, Pin.IN)
presses = 0

def beep(ms=100):
    buzzer.tone(1000)
    time.sleep_ms(ms)
    buzzer.no_tone()

def count_press():
    global presses
    presses += 1
    return presses

while True:
    if button.value():
        n = count_press()
        beep()
        if n % 5 == 0:
            beep(ms=400)
        time.sleep_ms(300)
```

```cpp
const int BUTTON_1 = 6;        // button 1
const int BUZZER = 8;          // buzzer

const int button = BUTTON_1;
long presses = 0;

void beep(long ms) {
  tone(BUZZER, 1000);
  pySleepMs(ms, 11);
  noTone(BUZZER);
}

long count_press() {
  presses += 1;
  return presses;
}

// Runs once: the lines before "while True:"
void setup() {
  Serial.begin(9600);
  pinMode(BUZZER, OUTPUT);
  pinMode(button, INPUT);
}

// Runs forever: the body of "while True:" (line 19)
void loop() {
  if (digitalRead(button) == HIGH) {
    long n = count_press();
    beep(100);
    if (pyMod(n, 5L) == 0) {
      beep(400);
    }
    delay(300);
  }
}
```

(`Serial.begin` because `pySleepMs` can stop the program through `pyFail`.)

**T8 — a program that ends**

```python
from machine import Pin
from zero1 import LED_RED
import time

led = Pin(LED_RED, Pin.OUT)
for _ in range(10):
    led.on()
    time.sleep(0.2)
    led.off()
    time.sleep(0.2)
print("Done")
```

```cpp
const int LED_RED = A1;        // red LED

const int led = LED_RED;

// Runs once: the whole program
void setup() {
  Serial.begin(9600);
  pinMode(led, OUTPUT);
  for (long i = 0; i < 10; i++) {
    digitalWrite(led, HIGH);
    delay(200);
    digitalWrite(led, LOW);
    delay(200);
  }
  Serial.println("Done");
}

// The Python program has no "while True:": it has ended.
void loop() {
}
```

**T9 — the placeholder** when the Python has errors (what the Code tab shows; what a hand-in with
errors stores as `code`):

```cpp
// Your Python program has 2 errors, so there is no Arduino sketch yet.
// Fix them in the Python tab (see the console), then this tab shows the sketch.
```

### 4.11 Robustness and limits

- `pythonToArduino` never throws (a `try/catch` returns X-internal); the largest example
  translates in < 5 ms (live lint every 700 ms).
- Source ≤ 50,000 bytes UTF-8 (X-too-long); generated sketch ≤ 50,000 bytes (the hand-in
  `codeMaxBytes`; X-sketch-too-long). The wording says bytes.
- At most 20 errors, then X-too-many.
- Memory estimate (globals, lists with their capacity, `String` 6 bytes + text, library objects
  from a table): > 1,500 of the UNO's 2,048 bytes → W-memory.

---

## 5. Error and warning catalogue

### 5.0 Rules for every message

- **Python error class first** (`NameError: …`) when CPython 3.12 would also stop on that line,
  with CPython's exact wording, then at most one hint sentence and one example.
- **ZERO1 limits** (legal Python the translator does not handle): "ZERO1 Python does not have …
  yet." + the way forward. Never blame the board for a translator choice.
- **Board facts**: "The ZERO1 board …" / "The Arduino UNO …".
- At most two sentences plus one example, ≤ 240 characters, no C++ word the student did not write
  (`digitalWrite`, `String`, `long`, …) except in board-fact hints (meta-tests, §10.2).
- In the console, `line` is shown as a link ("Go to line N in the Python program"); the text does
  not repeat "Line N".
- All texts live in `src/python/messages.ts`, keyed by the codes below (a translated table can be
  added later). `{…}` are parameters, except the braces of the f-string examples inside a
  message (`f"T = {t}"`), which are literal.

### 5.1 Syntax and indentation (parsing stops at the first one)

| Code | Trigger | Message |
|---|---|---|
| S-syntax | anything else that does not parse | SyntaxError: invalid syntax |
| S-comma | two expressions side by side | SyntaxError: invalid syntax. Perhaps you forgot a comma? |
| S-colon | `if x` / `def f()` / `else` … without `:` | SyntaxError: expected ':' |
| S-else-if | `else if x:` | SyntaxError: expected ':'. In Python, else if is written elif: elif x > 5: |
| S-assign-in-if | `if x = 5:` | SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='? |
| S-never-closed | unclosed `(` `[` `{` | SyntaxError: '{bracket}' was never closed |
| S-unmatched | extra `)` `]` `}` | SyntaxError: unmatched '{bracket}' |
| S-unterminated | unclosed `'…` / `"…` | SyntaxError: unterminated string literal (detected at line {n}) |
| S-unterminated-triple | unclosed `"""…` | SyntaxError: unterminated triple-quoted string literal (detected at line {n}) |
| S-leading-zero | `007` | SyntaxError: leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers |
| S-nbsp | U+00A0 outside text | SyntaxError: invalid non-printable character U+00A0. It is an invisible space copied from a document: delete it and type a normal space. |
| S-curly-quote | `“ ” ‘ ’ „` outside text | SyntaxError: invalid character '{c}' (U+{hex}). Use straight quotes: " or '. |
| S-invalid-char | any other stray character | SyntaxError: invalid character '{c}' (U+{hex}) |
| S-plusplus | `x++`, `x--` | SyntaxError: invalid syntax. Python has no ++ or --: write x += 1 |
| S-c-operator | `&&`, `\|\|`, `!x` | SyntaxError: invalid syntax. In Python, && is written and, \|\| is written or, ! is written not. |
| S-c-comment | `// …` at the start of a line | SyntaxError: invalid syntax. Comments in Python start with #, not //. |
| S-brace | `{` after a condition or `def` | SyntaxError: invalid syntax. Python uses a colon and indentation instead of { }: if x > 5: |
| S-cannot-assign | `f() = 1`, `5 = x` | SyntaxError: cannot assign to {what} here. Maybe you meant '==' instead of '='? |
| S-return-outside | `return` at top level | SyntaxError: 'return' outside function |
| S-break-outside | | SyntaxError: 'break' outside loop |
| S-continue-outside | | SyntaxError: 'continue' not properly in loop |
| S-global-after-use | `global x` after `x` was used in that function | SyntaxError: name '{x}' is used prior to global declaration |
| S-keyword-repeated | `f(a=1, a=2)` | SyntaxError: keyword argument repeated: {a} |
| S-positional-after-keyword | `f(a=1, 2)` | SyntaxError: positional argument follows keyword argument |
| S-default-order | `def f(a=1, b):` | SyntaxError: parameter without a default follows parameter with a default |
| S-duplicate-param | `def f(a, a):` | SyntaxError: duplicate argument '{a}' in function definition |
| S-indent-expected | block missing | IndentationError: expected an indented block after '{kw}' statement on line {n}. Indent the lines inside it by 4 spaces (press Tab). |
| S-indent-unexpected | | IndentationError: unexpected indent |
| S-unindent | dedent to an unknown level | IndentationError: unindent does not match any outer indentation level |
| S-tab | tab/space mix (§2.2) | TabError: inconsistent use of tabs and spaces in indentation |

### 5.2 Names, imports and attributes

"Did you mean" uses CPython's rule (edit distance ≤ 2 over the names in scope, then built-ins).

| Code | Trigger | Message |
|---|---|---|
| E-name | undefined name | NameError: name '{x}' is not defined. Did you mean: '{y}'? |
| E-name-true | `true`, `false`, `null`, `none` | NameError: name '{x}' is not defined. Did you mean: '{True/False/None}'? |
| E-name-later | used before the line that gives it a value | NameError: name '{x}' is not defined. It gets its value on line {n}, below this line: move that line up. |
| E-missing-import | a §3 name without its import | NameError: name '{Pin}' is not defined. Did you forget: from machine import Pin |
| E-unbound-local | read of a local before its assignment, also a global | UnboundLocalError: cannot access local variable '{x}' where it is not associated with a value. To change the global '{x}', write global {x} as the first line of '{f}'. |
| E-module | unknown module | ModuleNotFoundError: No module named '{m}'. On the ZERO1 you can import: machine, time, neopixel, dht, hcsr04, math, random, micropython, zero1. |
| E-import-name | unknown name in a module | ImportError: cannot import name '{x}' from '{m}'. Did you mean: '{y}'? |
| E-attr | unknown module member | AttributeError: module '{m}' has no attribute '{x}'. Did you mean: '{y}'? |
| E-attr-object | unknown method of a part | AttributeError: '{Pin}' object has no attribute '{x}'. A {Pin} has: {list}. |
| E-attr-int-pin | `LED_RED.on()` (a pin number used as an object) | AttributeError: 'int' object has no attribute '{on}'. {LED_RED} is the pin number of the {red LED}: make a Pin first: led = Pin({LED_RED}, Pin.OUT) |
| E-class-not-part | `Buzzer.tone(440)` | TypeError: {Buzzer}.{tone}() missing 1 required positional argument: 'self'. {Buzzer} is a kind of part: make one first: {buzzer} = {Buzzer}() |
| E-not-callable | calling a shadowed name | TypeError: '{int}' object is not callable. '{max}' was given a value on line {n}. |

### 5.3 Kinds and values found before running (Python would stop at run time)

| Code | Trigger | Message |
|---|---|---|
| E-concat | `"T = " + t` | TypeError: can only concatenate str (not "{int}") to str. Use str(x): "T = " + str(t) |
| E-operand | `text - 1`, `text * 2.5` … | TypeError: unsupported operand type(s) for {-}: '{str}' and '{int}' |
| E-compare | `text < 5` | TypeError: '{<}' not supported between instances of '{str}' and '{int}' |
| E-index-float | `lst[len(lst) / 2]` | TypeError: list indices must be integers or slices, not float. Use // to divide whole numbers: middle = len(readings) // 2 |
| E-range-float | float in `range()`, `chr()`, `[v] * n` count | TypeError: 'float' object cannot be interpreted as an integer. Use int(x) or //. |
| E-bitop-float | `& \| ^ << >> ~` with a float | TypeError: unsupported operand type(s) for {&}: 'float' and '{int}' |
| E-repeat-float | `[0] * 2.5` | TypeError: can't multiply sequence by non-int of type 'float' |
| E-len | `len(5)` | TypeError: object of type '{int}' has no len() |
| E-not-iterable | `for x in 5:` | TypeError: '{int}' object is not iterable. To repeat 5 times write: for i in range(5): |
| E-range-value | `r = range(5)` | ZERO1 Python does not have range() outside a for loop yet: for i in range(5): |
| E-range-step | `range(0, 10, 0)` / a variable step | ValueError: range() arg 3 must not be zero (a variable step: ZERO1 Python needs a fixed step such as 2 or -1) |
| E-args-count | wrong number of arguments | TypeError: {f}() takes {1} positional argument but {2} were given / TypeError: {f}() missing {1} required positional argument: '{x}' |
| E-kwarg | unknown keyword | TypeError: {f}() got an unexpected keyword argument '{k}' |
| E-api-kind | wrong kind for an API parameter (one text per parameter kind in api.ts) | TypeError: {putstr}() needs {text}: use {lcd.putstr(str(x))} |
| E-format-code | `{x:d}` on a float, `{s:x}` on text … | ValueError: Unknown format code '{d}' for object of type '{float}'. Use {x:.0f} or int(x). |
| E-format-zero-text | `{s:05}` on text | ValueError: '=' alignment not allowed in string format specifier |
| E-sleep-ms-float | `time.sleep_ms(1.5)` | TypeError: sleep_ms() needs a whole number of milliseconds: time.sleep_ms(int(ms)), or time.sleep(1.5 / 1000) for seconds |

### 5.4 ZERO1 limits

| Code | Trigger | Message |
|---|---|---|
| NA-class | `class` | ZERO1 Python does not have classes yet. Use functions and variables instead. |
| NA-try | a `try` that is not §2.12 | ZERO1 Python has try / except only around a sensor reading or int() / float() of text, for example: try: sensor.measure() except OSError: print("no answer") |
| NA-raise | bare `raise` | ZERO1 Python does not have raise without an error yet: raise ValueError("too hot") |
| NA-with | `with` | ZERO1 Python does not have with yet. |
| NA-lambda | `lambda` | ZERO1 Python does not have lambda yet. Write a small def function instead. |
| NA-comprehension | `[x for …]` and friends | ZERO1 Python does not have [… for … in …] yet. Make the list first, then fill it in a for loop: squares = [0] * 10 |
| NA-dict | `{…}`, `dict()`, `set()` | ZERO1 Python does not have dictionaries and sets yet. Use lists or separate variables. |
| NA-tuple | a tuple that is not a colour or a parallel assignment | ZERO1 Python does not have tuples yet, except colours: np[0] = (255, 0, 0) |
| NA-unpack | `a, b = pair`, star targets | ZERO1 Python does not have this unpacking yet. Write a, b = x, y or one assignment per line. |
| NA-slice | `a[i:j]` | ZERO1 Python does not have slices [a:b] yet. |
| NA-nested-def | `def` inside `def` | ZERO1 Python does not have a def inside another def yet. Move '{f}' to the left edge of the program. |
| NA-nonlocal | | ZERO1 Python does not have nonlocal yet. |
| NA-generator | `yield` | ZERO1 Python does not have yield (generators) yet. |
| NA-async | `async`, `await` | ZERO1 Python does not have async / await yet. Use time.sleep() to wait. |
| NA-decorator | `@…` before `def` | ZERO1 Python does not have decorators (@) yet. |
| NA-annotation | `def f(x: int)`, `x: int = 5` | ZERO1 Python does not have type annotations yet: remove ': {int}'. |
| NA-star-args | `*args`, `**kw`, `f(*lst)` | ZERO1 Python does not have *args and **kwargs yet. Pass the values one by one. |
| NA-default-value | a default that is not a fixed value | ZERO1 Python needs a fixed default value such as 100 or "on" here. |
| NA-none | `None` as a value, `is None` | ZERO1 Python does not have None as a value yet. Use 0, -1, "" or False to mean "nothing yet". |
| NA-none-value | using the result of a function that gives nothing (own function or `measure()`) | ZERO1 Python does not have None as a value yet: {show}() gives no value, so there is nothing to store. {For the sensor: call sensor.measure() on its own line, then read sensor.temperature().} |
| NA-is | `is`, `is not` | ZERO1 Python does not have is / is not yet. Compare with == or != instead. |
| NA-loop-else | `for … else`, `while … else` | ZERO1 Python does not have else after a loop yet. |
| NA-del | `del` | ZERO1 Python does not have del yet. |
| NA-walrus | `:=` | ZERO1 Python does not have := yet. Assign on its own line first. |
| NA-match | `match` / `case` | ZERO1 Python does not have match / case yet. Use if / elif / else. |
| NA-ellipsis | `...` | ZERO1 Python does not have ... yet. Use pass. |
| NA-matmul | `@` operator | ZERO1 Python does not have the @ operator. |
| NA-complex | `1j` | ZERO1 Python does not have complex numbers. |
| NA-bytes | `b'…'` | ZERO1 Python does not have bytes (b'…') yet. Use text. |
| NA-escape-N | `\N{…}` | ZERO1 Python does not have \N{…} yet: type the character itself, for example ° |
| NA-list-method | other list methods | ZERO1 Python does not have list.{sort}() yet. {hint} |
| NA-list-size | `[0] * n` with a variable | ZERO1 Python needs a fixed size for [v] * n: readings = [0] * 10 |
| NA-list-value | `return lst`, `lst == lst2`, `lst + lst2`, `b = a` | ZERO1 Python does not have whole-list values here yet. Use the items: {lst}[0], {lst}[1], … |
| NA-list-param-grow | append/pop on a list parameter | ZERO1 Python does not have append() on a list passed to a function yet: append to the list where it is made. |
| NA-pop-here | `pop()` inside a bigger expression | ZERO1 Python needs pop() on its own line: x = {lst}.pop() |
| NA-nested-list | list of lists | ZERO1 Python does not have lists inside lists yet. |
| NA-str-method | other text methods | ZERO1 Python does not have str.{split}() yet. Text can use: upper, lower, strip, startswith, endswith, find, replace, isdigit, len, in, ==, +. |
| NA-str-format | `"%d" % x`, `.format()` | ZERO1 Python does not have % formatting and .format() yet. Use an f-string: f"T = {t}" |
| NA-str-repeat | `text * n` (not fixed) | ZERO1 Python repeats text only with fixed values, like "-" * 16. |
| NA-bool-value | `name = s or "guest"` | ZERO1 Python does not have and / or with values that are not True or False yet. Use if / else. |
| NA-chain | a call in the middle of a chain, or on the left of `in [..]` | ZERO1 Python needs the value in a variable first: value = adc.read() then if 0 < value < 500: |
| NA-builtin | other built-ins | ZERO1 Python does not have {sorted}() yet. {hint} Built-ins you can use: print, input, len, range, int, float, str, bool, abs, min, max, round, pow, chr, ord, sum. |
| NA-builtin-arg | `int(x, 16)`, `pow(a, b, m)`, `sum(1, 2)` | ZERO1 Python does not have this form of {int}() yet. |
| NA-print-file | `print(…, file=…)` | ZERO1 Python prints only to the Serial Monitor: remove file=. |
| NA-fstring-spec | other format specs | ZERO1 Python does not have this format ({spec}) yet. You can use {x}, {x:.2f}, {n:5d}, {n:03d}, {s:<8}, {n:x}, {n:X}, {n:b}. |
| NA-api | a MicroPython member not in §3 | ZERO1 Python does not have {Pin.irq}() yet. {hint from api.ts} |
| NA-object-here | a library part created inside a def, loop or if | Make the {Servo} at the top of the program (not inside a def, a loop or an if): the board prepares it once when it starts. |
| NA-object-reassign | an object variable given another value | ZERO1 Python keeps one part per variable: '{led}' already holds a Pin. Use another name. |
| E-retype | one web holds text and a number (§2.9) | ZERO1 Python does not have variables that are sometimes text and sometimes a number yet: '{x}' can be text (line {a}) or a number (line {b}) on line {c}. Use two names. |
| E-param-kinds | | ZERO1 Python does not have functions that take text and numbers in the same place yet: {show}() gets a number on line {a} and text on line {b}. Use str(): show(str(42)) |
| E-return-kinds | | ZERO1 Python does not have functions that give text and numbers yet: '{check}' gives text on line {a} and a number on line {b}. |
| E-list-kinds | | ZERO1 Python does not have lists that mix text and numbers yet: '{items}' gets a number on line {a} and text on line {b}. |

### 5.5 Board limits

| Code | Trigger | Message |
|---|---|---|
| E-big-int | literal / constant outside 32 bits | This number is too big for the board: whole numbers must stay between -2147483648 and 2147483647. |
| E-pin | unknown pin | Pin {25} does not exist on the Arduino UNO: use 0-13, A0-A5 or a ZERO1 name such as LED_RED. |
| E-adc-pin | `ADC` on a digital pin | ADC needs an analog pin: A0-A5, for example POT_LDR. |
| E-i2c-pins | other I2C pins | The UNO's I2C pins are fixed: SDA = A4 and SCL = A5. |
| E-part-pin | a part on another pin | The ZERO1 {servo} is wired to {D4}: write {Servo()} without a pin. |
| E-colour | a colour without a NeoPixel | A colour (r, g, b) needs a NeoPixel: np = NeoPixel(Pin(RGB_PIN), 1) |
| E-scan | `i2c.scan()` outside a `for` | i2c.scan() can only be used in a for loop: for address in i2c.scan(): |

### 5.6 Runtime stops (the program stops like an uncaught Python exception)

Printed by `pyFail` on the Serial Monitor as `Line {n}: {text}` (so the real board shows the same
thing), then the board halts (`abort()`). In the simulator the console shows the text as an error
on Python line {n} (§6 item 3 + `pythonizeRuntimeMessage`), the status says "Error at … ms" and a
click jumps to the line.

| Code | Text |
|---|---|
| R-index | IndexError: list index out of range |
| R-str-index | IndexError: string index out of range |
| R-pop-empty / R-pop-index | IndexError: pop from empty list / IndexError: pop index out of range |
| R-zero | ZeroDivisionError: division by zero |
| R-int / R-float | ValueError: invalid literal for int() with base 10: '{text}' / ValueError: could not convert string to float: '{text}' |
| R-min-empty / R-max-empty | ValueError: min() arg is an empty sequence / ValueError: max() arg is an empty sequence |
| R-sleep | ValueError: sleep length must be non-negative |
| R-list-full | MemoryError: the list is full ({20} items on the board) |
| R-dht | OSError: [Errno 110] ETIMEDOUT |
| R-sonar | OSError: Out of range |
| R-neg-power | a negative power of a whole number is a decimal number: write 2.0 ** n |
| R-assert | AssertionError / AssertionError: {message} |
| R-raise | {Name}: {message} |

### 5.7 Warnings (the program runs)

| Code | Message |
|---|---|
| W-shadow | '{max}' is a Python built-in function: from here on, {max}() cannot be used in this program. / '{Pin}' was imported from {machine}: from here on, {Pin}() cannot be used in this program. |
| W-global-shadow | '{count}' is also a global variable: this line makes a new '{count}' that exists only inside '{add}'. To change the global one, write global {count} as the first line of '{add}'. |
| W-no-effect | This line does nothing: it works out a value and throws it away. {Did you mean x = 5? / Did you mean led.on()?} |
| W-unreachable | This line is never reached: the while True loop above never ends. |
| W-loop-var-changed | Changing '{i}' inside the for loop does not change the next round: the loop goes on with the next number of the range. |
| W-missing-return | '{f}' does not give a value on every path: the board gives 0 there (Python gives None). |
| W-unused-function | The function '{f}' is never used. |
| W-maybe-unassigned | '{x}' may have no value here: it only gets one inside the {if} on line {n}. The board then uses 0; Python would stop with NameError. |
| W-int-float | '{x}' is a whole number on line {a} and a decimal number on line {b}: the board keeps a decimal number, so print({x}) shows 5.0 where Python shows 5. |
| W-bool-int | '{state}' is a number on line {a} and True/False on line {b}: print({state}) shows 1 and 0 on the board. Write {state} = False on line {a} to keep True and False. |
| W-str-num-eq | {command} is text and {1} is a number: they are never equal. Did you mean {command} == "1" or int({command}) == 1? |
| W-sleep-long | time.sleep() counts in seconds: time.sleep({500}) waits more than {8 minutes}. For milliseconds use time.sleep_ms({500}). |
| W-ticks-diff | Use time.ticks_diff(time.ticks_ms(), {start}) to subtract ticks: that is how MicroPython programs keep working when the counter wraps around. |
| W-pwm-pin | Pin {15} ({A1}, the {red LED}) cannot dim: only pins 3, 5, 6, 9, 10 and 11 have PWM on the UNO. duty_u16() of 32768 or more switches it on, less switches it off. |
| W-pwm-freq | The PWM frequency of the UNO is fixed (490 Hz, 980 Hz on pins 5 and 6): freq() is ignored. |
| W-pwm-buzzer | To play a note on the buzzer use Buzzer().tone(440): PWM().freq() is ignored on the UNO. |
| W-pwm-servo | To move the servo use Servo().angle(90): the UNO's PWM cannot make the 50 Hz servo signal. |
| W-pull-down | The Arduino UNO has no built-in pull-down resistors: Pin.PULL_DOWN is ignored. The ZERO1 buttons already have their own resistor. |
| W-pin-no-out | Pin '{led}' was made without Pin.OUT: write Pin({LED_RED}, Pin.OUT) to switch it on and off. |
| W-echo-timeout | echo_timeout_us is fixed at 30000 µs (about 5 m) on the ZERO1. |
| W-list-capacity | The board keeps at most {20} items in the list '{readings}' (Python lists have no limit): one more append stops the program with MemoryError. |
| W-memory | Your variables and lists use about {1,720} of the board's 2,048 bytes of memory: the program may not run on the real board. |
| W-lcd-char | The LCD cannot show '{é}': it shows another symbol. Use plain letters on the LCD (° works). |
| W-text-bytes | '{é}' takes {2} bytes on the board: len(), [i], for … in and ord() count bytes there, so they give other results than Python. |
| W-escape | '\{d}' is not an escape sequence: Python keeps the backslash. Write '\\{d}', or use a raw string r'…'. |
| W-recursion | '{f}' calls itself: each call uses memory on the board, and about 50 calls deep the board crashes (the simulator does not notice). |
| W-sketch | In the Arduino sketch made from this line: {transpile warning} |

### 5.8 Translator-internal

| Code | Message |
|---|---|
| X-internal | The simulator could not read this program: {error}. Please tell your teacher. |
| X-sketch-error | Python translation error (a bug in the simulator, please tell your teacher): {message} |
| X-too-long | This program is too long for the simulator: 50,000 bytes at most (it has {61,234}). |
| X-sketch-too-long | The Arduino sketch made from this program is too long to hand in: 50,000 bytes at most (it has {53,120}). Make the program shorter. |
| X-too-many | … and {7} more errors |

### 5.9 Runtime messages in Python words

`pythonizeRuntimeMessage` (1) turns the `abort()` report (§6 item 3) into the last `Line N: …` line of
the Serial Monitor, with `line: N` and `source: 'python'`; (2) rewords the simulator's own
runtime texts that a Python program can still trigger. The table is built by listing every
`console`/`SketchError` text in `src/runtime` and `src/peripherals` (A, test: every entry
matches a real text). Examples: "digitalWrite(15) but pinMode(15, OUTPUT) was never called" →
"Pin 15 is switched on or off but was not made with Pin.OUT: write Pin(15, Pin.OUT)"; a
`tone()` on a pin without the buzzer → "Buzzer().tone() plays on the buzzer (pin 8)". Unknown
texts pass through unchanged.

---

## 6. Simulator fidelity work (prerequisite PR "C0", owner C)

The semantics review ran the same sketches on CPython, the simulator and avr-g++ + avr8js. Today
the simulator rounds floats and wraps integers **only when a value is stored**, so intermediate
results differ from the board (`long a = 50000; a * a` → 2500000000 instead of −1794967296;
`float s = 0.1; s == 0.1` → false instead of true; this spec's own probe: `round(2.675, 2)` →
2.67 vs 2.68). These fixes make the simulator match the board for every sketch — Code and Blocks
modes included — and are required by the Python board-twin tests (§10.6).

1. **Floats are float32 everywhere** (`src/transpiler/codegen.ts`): every expression of C type
   `float`/`double` is rounded where it is produced — non-exact float literals (`__f32(0.1)`),
   results of `+ - * /`, float-returning calls (`sqrt`, `sin`, `pow`, `analogRead(...) * 5.0`, …)
   and casts. AVR `double` is `float`, so no C++ expression ever carries 64-bit precision.
2. **Integers wrap at their C width on every operation**: results of `+ - * <<` and unary `-` of
   C type `int`/`unsigned int`/`long`/`unsigned long` (after the usual promotions, which
   `arithResult` already computes) go through `__i16`/`__u16`/`__i32`/`__u32`; 32-bit
   multiplication uses `Math.imul` (`>>> 0` for unsigned), because a JS double loses precision
   above 2^53 before the wrap.
3. **`abort()`** (runtime + `signatures.ts`): throws `SketchAbort` (a `SketchError`); the
   Executor reports `{ level: 'error', text: 'The sketch stopped: abort() was called.', line }`.
   On the board avr-libc's `abort()` disables interrupts and loops forever (after `pyFail`'s
   `Serial.flush()`).
4. **`String(float, n)` and `dtostrf()`** stop printing "ovf" (only `Print::printFloat`, i.e.
   `Serial.print(float)`, does that on the board); they format like avr-libc (`String(1e10, 1)` →
   `10000000000.0`). Values checked in Appendix B f4 already match.
5. **Float literals ≥ 1e21 with an exponent** (`3.4e38`) are emitted as invalid JS today
   (`3.4e+38.0`, "missing ) after argument list"); emit `String(value)` when it contains `e`.

Tests (C, `tests/codegen.test.ts`, `tests/runtime-fidelity.test.ts`): one per rule, with the
board values measured on avr8js: `int p = analogRead(A3) * 100 / 1023;` → −15 at A3 = 512;
`60 * 1000` (int) → −5536; `1 << 20` (int) → 0; `long a = 50000; a * a` → −1794967296;
`float s = 0.1; s == 0.1` → true; `0.1 + 0.2 == 0.3` → true; `String(1e10, 1)` → `10000000000.0`;
`Serial.print(1e10)` → `ovf`; `abort()` → the console error with its line; `3.4e38` transpiles and
runs. All existing tests keep passing (a failing one is a place where the simulator differed from
the board; each is reviewed, not silently updated). docs/ARCHITECTURE.md §4.4 documents the rules.

---

## 7. App UI (stream B)

### 7.1 First task: a mode registry

`app.ts` has about 30 two-way `mode === 'blocks'` checks; a third mode silently takes the wrong
branch in many of them (`switchMode` would paste the Blocks sketch into Code; `exportSketch`
would hand in the mirror as kind `'code'`; `applyMode` would leave the mirror editable; the mode
button label would read "Blocks"). Before any Python UI, B moves every mode-dependent behaviour
into `src/ui/modes/` — `code-mode.ts`, `blocks-mode.ts`, `python-mode.ts` — behind one interface,
with Code and Blocks behaviour unchanged under the existing tests (except §7.6, which changes
Blocks on purpose):

```ts
// src/ui/modes/types.ts
export interface ModeController {
  readonly id: AppMode;                                   // 'code' | 'blocks' | 'python'
  readonly button: { label: string; title: string };
  readonly firstTab: TabId;                               // 'code' | 'blocks' | 'python'
  readonly mirrorsCode: boolean;                          // the Code tab shows the read-only mirror
  readonly words: { run: string; stop: string; ide: string; upload: string; newAria: string; newTitle: string };
  examples(): readonly MenuExample[];                     // [] while the chunk loads
  enter(link: HashPayload | null): Promise<void>;
  leave(): void;
  /** Run, live lint and every export call this; Python translates afresh (never reads the mirror). */
  sketch(): Promise<SketchResult>;
  exportWork(): ExportedWork | { error: string } | null;
  loadExample(example: MenuExample): Promise<void>;
  newProgram(): Promise<void>;
  untouched(): HandinWork['unchanged'];
  flush(): void;
  destroy(): void;
}
export type SketchResult =
  | { ok: true; sketch: string; composeLineMap?(jsLineMap: number[]): number[]; endsAfterSetup: boolean;
      usesInput: boolean; pythonize?(msg: ConsoleMessage, serialTail: string): ConsoleMessage }
  | { ok: false; reason: 'loading' | 'errors'; message: string; diagnostics?: Diagnostic[] };
export interface ExportedWork {
  kind: AppMode; sketch: string; hash: string;            // '#code=' | '#blocks=' | '#python='
  workspaceJson: string; python: string;                  // '' when not that kind
  mapLine?(sketchLine: number): number;                   // Python mode: for upload compile errors
}
```

`tests/app-mode-registry.test.ts` fails when `app.ts` contains a comparison with a mode literal
(`=== 'code'`, `!== 'blocks'`, `'python' ===`, …) outside `src/ui/modes/`.

### 7.2 Tabs

`TabId` gains `'python'`; `TABS` order: `blocks, code, serial, pinmap, python, js`. Visible:

| Mode | Tab strip |
|---|---|
| Code | Code · Serial Monitor · Pin Map · Generated JS |
| Blocks | Blocks · Code (lock icon) · Serial Monitor · Pin Map · Generated JS |
| Python | Code (lock icon) · Serial Monitor · Pin Map · **Python** · Generated JS |

The Python tab (the teacher's "placed before Generated JS", read literally — §13 D1) exists only
in Python mode and is **selected** on entering Python mode, after Run with errors, and after New,
an example or a `#python=` link. The lock is an inline SVG; the tab's accessible name becomes
"Code (read only)". Arrow keys move over the visible tabs only (unchanged).

### 7.3 The Python panel

A one-line note above the editor: "MicroPython-style Python for the ZERO1. It becomes the Arduino
sketch in the Code tab — that sketch is what runs and what goes to the board. **What works** ·
Esc then Tab: leave the editor · Ctrl+M: Tab moves focus". "What works" opens a dialog with the
§2.15 student text (content `src/python/help.ts`, owner A; dialog owner B). While the chunk
loads: "Loading Python…" (like "Loading blocks…"); a load failure uses the existing
chunk-failure path (console error + update prompt).

### 7.4 The Python editor

`src/ui/editor.ts` is generalised, not copied: `EditorOptions` gains `language?: Extension`
(default `cpp()`), `storageKey?: string` (default `'z1.code'`), `indent?: 2 | 4`,
`ariaLabel: string`, `readOnlyMirror?: boolean`, `extraExtensions?: Extension[]`. The Python editor
(created by `python-mode.ts` from the lazy chunk):

- storage `z1.python` (debounced 400 ms, flushed on `pagehide` and before the update prompt);
  `indentUnit` 4 spaces, `tabSize` 4, `indentWithTab` (Tab / Shift+Tab), Ctrl/Cmd+Enter = Run,
  Esc = Stop; `aria-label` "Python program".
- **Language support without CPython's completions** (`src/ui/python-language.ts`):
  `new LanguageSupport(pythonLanguage, [pythonLanguage.data.of({ autocomplete: zero1Completions }),
  pythonLanguage.data.of({ autocomplete: localCompletionSource })])` — *not* `python()`, whose
  completion list offers every CPython built-in, exception name and `try`/`class` snippet.
  `zero1Completions` offers: the §2.6 built-ins and the keywords of §2.3 that are supported; after
  `import `/`from ` the §3 modules; after `from m import ` that module's names; after `x.` the
  members of `x`'s module or part (from `API_COMPLETIONS`, found by a light scan of `x = Pin(…)` /
  `x = ADC(…)` / … assignments in the document), each with its one-line doc; snippets
  `while True:`, `for i in range():`, `def`, `if … else`. The `adc.read()` doc says "0-1023 on the
  ZERO1; on other boards use read_u16()".
- `highlightSpecialChars({ addSpecialChars: / / })` so pasted non-breaking spaces are visible.
- **Paste clean-up** (`EditorView.clipboardInputFilter`): `“ ” „ ‟` → `"`, `‘ ’ ‚ ‛` → `'`,
  U+00A0/U+2007/U+202F → space, U+200B/U+FEFF removed, leading tabs → 4 spaces each; when
  something changed, toast "Fixed {3} curly quotes and {12} invisible spaces (Ctrl+Z undoes it)".
  Python editor only.
- **Keyboard escape hatch (both editors)**: today the Esc → Stop binding returns `true`, so
  CodeMirror's own "Esc, then Tab leaves the editor" never arms (WCAG 2.1.2). The shared handler
  becomes `run: (view) => { options.onStop(); view.setTabFocusMode(2000); return true; }`.
- Live lint diagnostics use `endLine`/`endColumn` for the underline (`toCmDiagnostic`).

### 7.5 The Code tab: two editors

The Code tab hosts **two** CodeMirror instances; one is visible:

- `codeEditor` — the hand-written sketch (`z1.code`), editable, visible in Code mode;
  `aria-label` "Arduino sketch".
- `mirrorEditor` — Blocks and Python modes; never persists anything (no storage key, `flush()` is a
  no-op), `EditorState.readOnly` but still focusable, selectable and copyable (no
  `EditorView.editable.of(false)`); `aria-label` "Arduino sketch made from your Python (read only)"
  / "… from your blocks (read only)". Typing into it shows the toast "This sketch is made from your
  Python — edit it in the Python tab" / "… from your blocks — change the blocks".

Above the mirror, the banner: "Made from your Python program — read only." or "Made from your
blocks — read only." with a button **Edit a copy in Code mode** (§7.6). In Python mode the mirror
is updated by live lint (700 ms) and by Run with the current translation (the placeholder of T9
when there are errors).

This replaces the draft's `setCode(…, { persist: false })`, which could not protect `z1.code`
(every document change schedules a save, and `flush()` — called by the update prompt and
`pagehide` — saves unconditionally).

### 7.6 Mode switching: each mode keeps its own program

**Rule: switching modes never writes another mode's storage and never asks a question.** Code
mode always shows `z1.code`, Blocks mode `z1.blocks`, Python mode `z1.python`.

| Action | What happens |
|---|---|
| Code ↔ Blocks ↔ Python (any direction) | the target mode's own program is shown; nothing is copied, nothing asked |
| **Edit a copy in Code mode** (banner button; disabled with the title "Fix the errors in your Python program first" while there are errors) | if `z1.code` holds hand-written text (not blank, not an example, not the last loaded or copied text): confirm "Replace your Arduino code in Code mode with this sketch?\nYour current Arduino code can be brought back with Undo." Then: the old text goes to `z1.code.previous`, the sketch goes into `codeEditor` (saved), the app switches to Code mode, toast "Copied into Code mode · Undo" (Undo restores `z1.code.previous`, 8 s) |
| `#code=` link in Blocks/Python mode | switch to Code mode; ask only when `z1.code` is hand-written ("Load the sketch from this link?…") |
| `#python=` link | switch to Python mode; ask only when the Python program is not untouched |
| `#blocks=` link | unchanged |

Blocks mode follows the same rule (§13 D2, default yes): the automatic Blocks → Code hand-off and
the `CONFIRM_TO_BLOCKS` question are removed, Blocks gets the same banner button, docs/BLOCKS.md
§11.4 is updated. Without it, today's path Code (hand-written) → Blocks → Code loses the
hand-written sketch, and with Python, Code → Blocks → Python → Code would too.

### 7.7 New, Examples, first visit

- `BLANK_PYTHON` (from the chunk; `app.ts` never imports it statically):

```python
from machine import Pin
from zero1 import *   # ZERO1 names: LED_RED, BUTTON_1, BUZZER, …
import time

# Code here runs once, when the board starts.


while True:
    # Code here runs again and again, forever.
    pass
```

- **New** in Python mode: confirm "Start a new blank program?\nYour current Python program will
  be lost." unless untouched; toast "New blank Python program"; the button's `aria-label`/`title`
  read "Start a new blank Python program" / "New blank Python program". Does not stop a run.
- **Examples ▾** in Python mode lists `PYTHON_EXAMPLES` (empty with "Loading…" until the chunk
  is there, like Blocks). `ExamplesMenu<Example | BlockExample | PythonExample>`; the app
  dispatches to the current mode's `loadExample()` — never on `'source' in example`. Loading asks
  "Replace your Python program with the example "{title}"?\nYour current Python program will be
  lost." unless untouched; toast "Loaded example: {title}"; selects the Python tab.
- **First entry** into Python mode with no saved `z1.python`: Python example 01, untouched.
- **Untouched** = equal to `BLANK_PYTHON`, to a Python example, or to the last loaded text
  (`z1.python.baseline`, saved like the blocks baseline so a reload keeps it).

### 7.8 Live lint, Run, Stop

- **Live lint** (Python editor change, 700 ms): translate; diagnostics on the Python editor; the
  mirror gets the sketch; when `ok`, `transpile(sketch)` errors → X-sketch-error, warnings →
  W-sketch, both mapped to Python lines.
- **Run**: `mode.sketch()` (fresh translation). Errors → console (source `'python'`), header
  "{N} errors", console status "{N} errors — fix and run again", Python tab selected, cursor on the
  first error. Otherwise `transpile`, then
  `new Executor({ board, lineMap: composeLineMap(result.lineMap), onConsole: (m) => push(pythonize(m, serialTail)) })`,
  where `serialTail` is the last 2 KB of the Serial Monitor text.
- **Program without `while True:`** (`endsAfterSetup`): no `maxLoops`; once `executor.loops ≥ 1`
  (setup() returned), the app stops the run as soon as no tone is sounding
  (`board.buzzer.state.freq === 0`) or 2,000 ms of board time have passed, whichever is first;
  console "Program finished (it has no while True loop).", status "Finished at {ms} ms". Checked
  in the frame loop; a test drives it with the virtual clock.
- Console texts in Python mode: "Program started." / "Program stopped after {N} rounds of the while
  True loop." Stop and Settings ▾ → Reset the board: unchanged. Baud: 9600.

### 7.9 Where `print()` and `input()` happen

- If the translation `usesInput`, Run selects the Serial Monitor tab and focuses its send box.
- The first time a run prints while the Serial Monitor tab is hidden, the console shows (once per
  run) "print() output is in the Serial Monitor tab" with an action link "Open the Serial Monitor".
- The activity dot gets an accessible name: the tab's `aria-label` becomes "Serial Monitor, new
  output" while it shows.
- In Python mode the Serial Monitor's line ending is forced to **Newline** (select disabled,
  title "Python's input() reads one line: the Serial Monitor sends Newline"); otherwise
  `readStringUntil('\n')` waits for its 1 s timeout.
- Later (v1.1): an output strip under the Python editor.

### 7.10 Console

Messages carry `source` (`'sketch' | 'python'`): Python-mode diagnostics and every message of a
run started in Python mode are `'python'`. A click selects the Python tab and moves the Python
editor for `'python'`, the Code tab and the editor of that line for `'sketch'`, whatever the
current mode. Link text: "Go to line {N} in the Python program" / "… in the sketch".

### 7.11 Share ▾ and downloads

Python mode items: **Hand in to my teacher · Copy link · Download .py · Download .ino**
(`menu.setItems()` on mode change).

- Copy link → `#python=<base64url UTF-8>` (`encodeSharePython`, owner C) — works with errors.
- Download .py → `pythonFileName(student, date)` = `zero1_ali_khoury_0928_143210.py`
  (`src/ui/sketch-file.ts`); item title "Save the Python program (for the ZERO1 simulator)".
- Download .ino → fresh translation, `sketchFileName()`. With errors: toast "Fix the errors in
  your Python program first — see the console." and nothing is saved.

### 7.12 Open in Arduino IDE, Upload to board

Both take `exportWork()` (fresh translation). With errors: the same toast; nothing opens.

- IDE dialog note in Python mode: "This is the Arduino sketch made from your Python program (the
  code in the Code tab). The board runs this sketch: it cannot run Python itself."
- `installUploadButton({ getSketch })`: `getSketch()` returns `UploadPayload | { error: string } |
  null`; an `error` is toasted as is (the hard-coded "blocks are still loading" text moves into
  the Blocks controller). `UploadPayload` gains `note?`, `successNote?`, `mapLine?(sketchLine)`
  and `source?: 'python'`. Compile errors in Python mode: console lines on `mapLine(d.line)` with
  source `'python'`, and the C++ hints replaced by the X-sketch-error text (except "sketch too
  big", shown as is). Success in Python mode: "Done — the program is running on the board. Its
  print() output: open the Arduino IDE Serial Monitor at 9600 baud."
- Reminder: the Upload button is hidden on the live site until §0.1 is done.

### 7.13 Review mode (teacher replay)

`ReviewMessage` gains `python: string` (absent → `''`). Kind `'python'`: Python mode, nothing
written to storage, Python editor read-only, the chunk loaded, the Python translated; if the
sketch differs from the handed-in `code`, a banner "The simulator was updated since this hand-in:
the Code tab shows today's translation." with a button "Use the handed-in sketch" (the mirror
and Run then use `code`). If the chunk cannot load or the translation has errors: Code mode,
read-only, the handed-in `code`, banner "Made from the student's Python program."

### 7.14 Header, labels, accessibility

- Mode switch **Code | Blocks | Python**; Python's `title` "Write the program in Python
  (MicroPython style)"; `aria-pressed`. Entering a mode announces it with the toast
  (`role=status`): "Python mode".
- At 1366–1439 px the "Arduino IDE" button shows its icon only (label visually hidden;
  `aria-label` and tooltip unchanged), so brand, three mode buttons, seven actions and run status
  stay on one row; `tests/app-header.test.ts` checks 1366×768 and 1280×800.
- Words in Python mode: Run "Run the program (Ctrl+Enter)", Stop "Stop the program (Esc)", IDE
  "Open the sketch made from this program in the Arduino IDE", Upload "Upload the sketch made from
  this program to the ZERO1 board".

### 7.15 Storage keys

`z1.mode` accepts `'python'` (older builds fall back to Code). New: `z1.python`,
`z1.python.baseline`, `z1.code.previous`. Tests that used `'python'` as the invalid mode value use
`'pyth0n'`.

### 7.16 Bundle

- The Python chunk is reached only through `import('./python-chunk')` from `python-mode.ts`;
  `src/ui/python-chunk.ts` re-exports what the UI needs (`pythonToArduino`, `BLANK_PYTHON`,
  `PYTHON_EXAMPLES`, `API_COMPLETIONS`, help text, `pythonizeRuntimeMessage`, the language
  support). Code outside the chunk uses `import type` only.
- `tests/bundle-boundary.test.ts`: no static import from `src/main.ts` reaches `src/python`,
  `src/examples/python`, `@codemirror/lang-python` or `@lezer/python` (`import type` ignored).
- `scripts/check-bundle.mjs`: the chunk named `python-chunk-*.js` is found by name; budget =
  gzip of (its static closure minus the static closure of `index.html`) ≤ **80 KB** (expected
  60–65 KB); marker check: no chunk in the `index.html` closure contains
  "ZERO1 Python does not have". *Raised to 128 KB on 2026-09-30: the finished translator is
  ≈ 90 KB gzip, 4 times the estimate; measured 112.6 KB with the emitter (the sizes are in
  scripts/check-bundle.mjs).*
- `package.json`: `@codemirror/lang-python@^6.2.1` (brings `@lezer/python@^1.1.4`); the installed
  `@codemirror/autocomplete` 6.20.3, `language` 6.12.4, `state` 6.7.4 and `@lezer/common` 1.5.2
  satisfy its ranges, so nothing is duplicated.

---

## 8. Class platform (stream C)

### 8.1 Data model: the Python source goes into the existing `workspace` field

A Python hand-in is `{ kind: 'python', code: <generated sketch or the T9 placeholder>,
workspace: <Python source>, … }` — the same 10 keys as every hand-in. This replaces the draft's
separate `python` field (integration review, open question 8): every consumer already checks
`kind === 'blocks'` before reading `workspace` as Blockly JSON, `workspace` is already exempt from
indexing, the codec already gzips it, and the rules change is two lines. Old cached dashboards
read an unknown kind as Code (`readHandinDoc`) and show the sketch, which is correct.

TypeScript keeps the storage detail inside `src/classroom/model.ts` and `student.ts`:

```ts
export type HandinKind = 'code' | 'blocks' | 'python';
export const LIMITS = { /* … */ pythonMaxBytes: 50_000 /* client-only: the rules check workspace ≤ 100,000 */ };
export interface HandinDraft { kind: HandinKind; code: string; workspaceJson: string; python: string }   // '' when not that kind
export interface HandinContent { kind: HandinKind; code: string; workspaceJson: string; python: string }
// student.ts writes workspace = kind === 'python' ? draft.python : draft.workspaceJson
// contentOf(kind, decoded): python = kind === 'python' ? decoded.workspaceJson : ''; workspaceJson = kind === 'blocks' ? … : ''
// draftProblem(): kind 'python' and python.trim() === '' → 'empty_sketch'; utf8Length(python) > pythonMaxBytes → 'too_large'
// readHandinDoc(): kind in ['code', 'blocks', 'python'], else 'code'
```

`src/classroom/codec.ts` does not change.

### 8.2 `firestore.rules` (the whole change)

```diff
-      // (enc 'gzip'); a Code hand-in has an empty workspace, a Blocks hand-in a non-empty one.
+      // (enc 'gzip'); a Code hand-in has an empty workspace; Blocks (Blockly JSON) and Python (the
+      // Python source) hand-ins a non-empty one.
       function validContent(d) {
 …
-          && (d.kind == 'blocks' ? d.workspace.size() > 0 : d.workspace.size() == 0);
+          && (d.kind == 'code' ? d.workspace.size() == 0 : d.workspace.size() > 0);
       }
 …
-          && d.kind in ['code', 'blocks']
+          && d.kind in ['code', 'blocks', 'python']
```

`firestore.indexes.json`: unchanged. The conditional expression is supported by the rules
language (it is already used in this file).

### 8.3 Hand-in dialog (`src/ui/handin-dialog.ts`, owner C)

`HandinWork.kind` gains `'python'` and `python: string`; `currentDraft()` passes it; summary
"Your Python program and the Arduino sketch made from it"; `errorCount` = Python errors;
`unchanged` for `BLANK_PYTHON` / an untouched Python example. A `permission-denied` answer to a
Python hand-in shows "Your class is not ready for Python hand-ins yet: ask your teacher to update
the class rules." (covers a site deployed before the rules, §11.4).

### 8.4 Share links (`src/share-link.ts`, owner C)

`encodeSharePython(source)`, `pythonFromHash(hash)` (`#python=`, same base64url UTF-8 encoding as
`#code=`); `ReviewPayload.kind` gains `'python'` and `python?: string` (absent → `''` for older
links); `handinHash()` gives `#python=` for Python hand-ins.

### 8.5 Teacher side

- `src/teacher/detail.ts`, `feed.ts`, `overview.ts`: kind label "Python" (`z1t-kind-python`).
  The detail card shows **the Python first** (monospace, `textContent`), then a collapsed
  `<details>` "The Arduino sketch made from it". When `placeholderErrorCount(code)` is a number:
  "Handed in with {N} Python errors" and Download .ino disabled with that reason.
  Buttons: Download .py, Download .ino, Copy (copies the Python).
- `src/teacher/handins.ts`: `zipEntries()` adds `<First_Last>.py` next to the `.ino`;
  `reviewPayloadFor()` carries `python`.
- `src/review/page.ts`: header "· Python", Download .py next to Download .ino, Copy copies the
  Python.
- docs/CLASSROOM.md: data model (§2), content encoding, rules listing, limits table, dashboard
  screens; README "Features": a Python mode bullet (owner A, §11).

---

## 9. Python examples (stream A)

33 examples, not 41 (UX review, R6): the 20 part-by-part examples 40–59 (the same worksheets in
all three modes; Blocks already ships exactly these 20 plus its own 12 lessons) and 13 lessons.
Dropped for now: 04 (Adafruit `ColorHSV`/`gamma32`), 05 (`shiftOut`), 10 ≈ 45, 13 ≈ 50, 14 ≈ 57,
15 ≈ 52, 30 ≈ 54, 33 (a mix of the others).

Files `src/examples/python/NN_name.py` + `index.ts` (`PYTHON_EXAMPLES: PythonExample[]`, same `id`,
`title`, `group` as the `.ino` twin, in the same relative order — a test checks that the list is
an in-order subset of `EXAMPLES`). Header: a module docstring with the four sections of the `.ino`
headers — first line `ZERO1 Smart Board - NN Title`, then **WHAT IT TEACHES**, **PARTS AND PINS**,
**EXPECTED BEHAVIOUR**, **TRY THIS** — in Python words. EXPECTED BEHAVIOUR is the twin's (same
Serial lines, timings, pins). Every example translates with **no warning**. Imports follow §3.

| id | Title | Python content |
|---|---|---|
| 01_blink_red | Blink the red LED | `Pin.on/off`, `time.sleep`, `print` (T1) |
| 02_traffic_lights | Traffic lights | `def set_lights(red, green)` with `pin.value(x)`, `LED_BUILTIN`, `for _ in range(3)` |
| 03_buzzer_melody | Buzzer melody | note constants, two lists, `Buzzer().tone/no_tone`, `for i in range(len(MELODY))`, `sleep_ms` |
| 06_servo_sweep | Servo sweep | `Servo().angle(a)`, `range(0, 181)`, `range(180, -1, -1)` |
| 07_dc_motor | DC motor on / off | `Pin(MOTOR, Pin.OUT).on/off` |
| 11_button_toggle | Button toggle (debounce) | `ticks_ms`, `ticks_diff`, a conditional expression in an f-string |
| 12_potentiometer_serial | Potentiometer to Serial | `ADC(POT_LDR).read()`, `value * 5.0 / 1023`, `map_range`, `f"{voltage:.2f}"` |
| 16_serial_echo | Serial echo and commands | `input().strip().lower()`, `if/elif/else`, form V (`int()` of a command) |
| 20_lcd_hello | LCD hello | `LCD()`, `move_to`, `putstr`, `ticks_diff`, `str(time.ticks_ms() // 1000)` |
| 21_lcd_custom_char | LCD custom characters | `custom_char` with `0b…` lists, `putchar(chr(0))`, `chr(223)`, DHT with form S |
| 31_greenhouse | Smart greenhouse | DHT22 (form S) + LCD + fan on `Pin(MOTOR, Pin.OUT)` + LED alarm, `global` in `check_climate()` |
| 32_reaction_game | Reaction game | `SevenSegment().show/segments`, `random.seed(time.ticks_ms())`, `random.randint(1000, 2999)`, `wait_for_press(pin)`, `continue` |
| 34_i2c_scanner | I2C scanner | `I2C(0)`, `for address in i2c.scan():`, `f"0x{address:02X}"` |
| 40_led_blink_red | Blink the red LED | `sleep(0.5)` |
| 41_led_red_green | Blink red and green alternately | two `Pin`s |
| 42_led_blink_10_times | Blink the red LED 10 times | top-level `for _ in range(10)`, `print("Done")`, **no `while True`** (T8) |
| 43_buzzer_short_beeps | Short beeps forever | `Pin(BUZZER, Pin.OUT).on/off` |
| 44_buzzer_led_10_times | Beep 10 times with the red LED | top-level loop, ends |
| 45_buttons_leds | Buttons light the LEDs | two buttons |
| 46_buttons_beeps | Buttons: short beep and long beep | `def beep(ms=100)`, `def wait_for_release(button)` |
| 47_rgb_red_green_blue | RGB LED: red, green, blue | `NeoPixel(Pin(RGB_PIN), 1)`, colour constants `RED = (255, 0, 0)` |
| 48_rgb_buttons | Buttons colour the RGB LED | `if/elif/else` with colours |
| 49_ldr_serial | Show the light level on the Serial Monitor | `ADC.read()` |
| 50_ldr_red_green | Night light: red when dark, green when bright | threshold constant |
| 51_seg_buttons_count | Count up and down with the buttons | `SevenSegment().show(n)`, `range(1, 5)`, `range(7, 0, -1)` |
| 52_ultrasonic_serial | Show the distance on the Serial Monitor | `HCSR04()`, form S (`except OSError: print("No echo")`), `f"{d:.1f}"` |
| 53_ultrasonic_red_green | Distance alarm: red LED near, green LED far | form S |
| 54_ultrasonic_beep_rate | Parking beeper: faster beeps when closer | `min(max(int(d * 10), 50), 1000)` for Arduino's `constrain` |
| 55_servo_buttons | Buttons move the servo (0° and 90°) | wait-for-release loop |
| 56_servo_ultrasonic_10_times | Servo reacts to the ultrasonic sensor, 10 times | top-level `for round in range(1, 11)`, ends with `Done` |
| 57_dht_serial | Show temperature and humidity on the Serial Monitor | form S (T5) |
| 58_dht_servo_slow | Servo turns slowly when it is hot (above 28 °C) | `def turn_slowly()`, form S with `continue` |
| 59_motor_buttons | Buttons run the motor | `Pin(MOTOR, Pin.OUT)`, `f"Short run {n}"`, two loops |

`16_serial_echo` has its own behaviour test (its Serial output also contains the echoed input);
the no-echo / sensor-unplugged branches of 52–58 get their own Python tests (the Arduino twins
print a value there instead).

---

## 10. Test plan

All in `npm test` (Vitest; UI tests with happy-dom) unless stated. Target ≈ +550 tests. Every
table row of §2, §3 and §5 has at least one test; the meta-tests make sure of it.

### 10.1 Front end (A)

`tests/python-tokens.test.ts`:
- NEWLINE/INDENT/DEDENT on nested blocks; blank and comment-only lines; `\` joining; implicit
  joining in brackets; `;` separators and a trailing `;`; one-line suites (`while True: pass`).
- CRLF and lone CR normalised (positions unchanged); BOM dropped.
- Tabs: a tab = next multiple of 8; `if x:\n\tpass\n        pass` passes both checks,
  `\tpass` then 4 spaces → S-tab.
- Numbers: `0`, `00`, `1_000`, `0x3F`, `0o17`, `0b0101`, `1.`, `.5`, `1e3`, `1_000.5`;
  `007` → S-leading-zero; `1j` → NA-complex; `2147483648` → E-big-int; `-2147483648` accepted.
- Strings: all quote kinds and prefixes; `b''` → NA-bytes; escapes incl. `\x41`, `\u00e9`, `\N{…}` →
  NA-escape-N, `"\d"` keeps the backslash + W-escape; adjacent literals concatenate; unterminated
  single / triple → exact messages with "detected at line N".
- Characters: U+00A0 → S-nbsp (column of the character); `“hi”` → S-curly-quote; `€` outside text
  → S-invalid-char; `print("Lumière allumée")` and `température = 25` tokenize fine.
- f-strings: parts, `{{`/`}}`, field positions (an error inside `{…}` points into the field),
  specs kept as text; `{x!r}`, `{x=}` → NA-fstring-spec.
- C habits: `x++` → S-plusplus; `if a && b:` → S-c-operator; `// hi` → S-c-comment; `if x {` →
  S-brace; `else if y:` → S-else-if; `x = true` → E-name-true ("Did you mean: 'True'?").

`tests/python-parser.test.ts`: every statement of §2.4 and expression of §2.5; precedence
(`-2 ** 2`, `2 ** -1`, `not a == b`, `a & b == c`, `a or b and c`, `a < b < c`, ternary); chained
`a = b = 0`; `a, b = b, a`; `a[i], a[j] = a[j], a[i]`; defaults and keyword arguments; every
syntax/indentation error of §5.1 with its exact message, line and column; each NA construct
parses into `Unsupported` with the right code.

### 10.2 Analysis, emitter, messages (A)

`tests/python-flow.test.ts` (webs, definite assignment, non-negative facts):
- `answer = input(); answer = int(answer)` → two webs (`answer`, `answer_2`), no error.
- `x = 5; print(x); x = 2.5` → two webs; prints `5` then works with `2.5`.
- `state = 0` … in the loop `state = not state; print(state)` → one web, int, W-bool-int.
- `while True: count = count + 1` → E-name on `count` (first round); `while True: count += 1`
  → the same; `count = 0` before the loop → global, no error.
- loop-local promotion: `value = adc.read()` first in the loop → local; the same name assigned
  inside an `if` first → declared at the top of `loop()`; used in a function → global; read
  before written in the body → global (negative golden cases).
- `if c: x = 1` then `print(x)` → W-maybe-unassigned; nothing before → E-name-later when a later
  line defines it.
- a global only created in a function (`global x; x = 5`) → C++ global, reads elsewhere fine.
- non-negative: `value = adc.read(); value * 100 // 1023` → plain `/`; `n = f(); n % 5` →
  `pyMod`.

`tests/python-kinds.test.ts`: literal and operator kinds; `/` always float; `//`/`%` on floats;
`int+float` web → float + W-int-float only when printed; text+number web → E-retype with both
lines; parameters from call sites (int, float, text, Pin, list); E-param-kinds; return kinds and
E-return-kinds; recursion fixed point; list element kinds and E-list-kinds; colours; constants
(`UPPER_CASE` once → `const`, reassigned → variable, `micropython.const`).

`tests/python-emit.test.ts` — goldens `tests/fixtures/python/<case>.py` → `<case>.ino`
(`UPDATE_GOLDEN=1` regenerates): T1–T9 of §4.10 plus one case per rule: main-loop split (final
`while True`, `while 1`, none, `break` out of it, statements after it, `continue` → `return`,
main guard, `def main()` pattern); D1–D4; N1 (`adc.read() * 100 // 1023` → `value * 100L / 1023L`,
`60 * 1000` → `60L * 1000L`, `1 << 20` → `1L << 20L`, `(long)millis()`); N2–N5; every `print` form
and f-string spec of §2.11 (`{-5:03d}` → `-05`, `{-1:x}` → `-1`, `{-5:b}` → `-101`, `{'ab':5}`
left-aligned, `{512:.2f}` → `(float)`); text methods; `input`; lists fixed and growable (capacity
provable in `for range(K)`, 20 otherwise, `append`/`pop`/`clear`/`len`/`in`/`sum`/`min`/`max`/
`print`, list parameters with the hidden length, `a[-1]` folded, `pyIndex` only when needed);
try forms S and V (with and without `else`, `as e`); `raise`, `assert`; colours; every §3 API row
(one fixture per module); names (`map` → `map_`, `B1` → `B1_`, `square`, `température` →
`temperature`, a clash → `_`, webs `_2`); comments (end of an indented block stays inside its
braces; a comment ending in `\` → `\.`; a docstring with `*/` → `* /`); strings (`"\x41BC"` →
`"\x41" "BC"`, UTF-8 text, `°` on the LCD → `"\xDF"`); includes, pin names and helpers emitted
only when used and in order; `Serial.begin` only when needed. **Every golden must `transpile()`
with no error and no warning** (asserted in the same test).

`tests/python-errors.test.ts`, table-driven from `MESSAGES`: one row per code of §5 with a minimal
program, the expected code, exact text, line, column (and end column where relevant). Includes the
review cases: `readings[len(readings) / 2]` → E-index-float; `range(2.0)` → E-range-float;
`1.5 & 1` → E-bitop-float; `f"{1.5:d}"` → E-format-code; `"M" > 5` → E-compare; `name == 5` →
W-str-num-eq and the sketch contains `false`; `LED_RED.on()` → E-attr-int-pin; `Buzzer.tone(440)`
→ E-class-not-part; `time.sleep(500)` → W-sleep-long; `time.sleep_ms(0.5)` → E-sleep-ms-float;
`max = 0` then `max(1, 2)` → W-shadow + E-not-callable; `x = sensor.measure()` → NA-none-value;
`try: … finally:` → NA-try. Meta-tests: every `MESSAGES` entry is covered; every message ≤ 240
characters, Python classes first, no C++ word outside board-fact hints, NA texts start with
"ZERO1 Python".

`tests/python-sourcemap.test.ts`: `sketchToPython` for every statement kind (multi-line →
first line; scaffolding and helpers → 0; hoisted declarations → their statement; object setup
lines → the construction); `composeJsLineMap`; `x = 5 // y` with `y = 0` → console error
"ZeroDivisionError: division by zero" with `line` = that Python line, **also when the stack has
no async frames** (the test strips the stack); a transpile error in a stubbed bad sketch →
X-sketch-error at the mapped line.

`tests/python-reserved.test.ts`: C++ keywords and alternative tokens, `B0`…`B11111111`, `abs`,
`round`, `square`, `A0`, `LED_BUILTIN`, `setup`, `loop`, helper names are all reserved;
`value`, `count`, `data`, `x` are not (parameter names of library headers must not leak in).

### 10.3 Runtime behaviour (A; needs C0)

`tests/python-runtime.test.ts` runs translations on the simulator (`tests/helpers.ts
runSketch`) and checks every row of §2.13 with its board value; `pyFail` cases (IndexError,
ZeroDivisionError, ValueError from `int("12abc")`, MemoryError at capacity, OSError with the DHT
unplugged and with no echo, negative sleep, assert, raise) → the run stops with status `error`, a
console error with the Python text and line, and the `Line N: …` text on the Serial Monitor;
`input()` echoes the line; a program without `while True` finishes (and lets a final
`tone(…, 500)` finish, stopping at most 2 s later).

`tests/python-cpython.test.ts`: `tests/fixtures/python/cpython/*.py` are print-only programs
(arithmetic, `//`, `%`, `round`, f-strings, text methods, lists, loops, functions, webs) with
their CPython 3.12 output committed as `*.out` (regenerated by `scripts/record-cpython.mjs` where
`python3` exists). The simulator's Serial output must equal it line by line, except lines listed
in `*.deviations` with a §2.13 row id (e.g. float digits, 32-bit wrap).

### 10.4 Examples (A)

1. Refactor `tests/examples.test.ts`: the behaviour tests (`runExample`, `drive`, `timeline`,
   `highPulses`, `servoTargets`, …) move to `tests/example-behaviour.ts` as
   `describeExampleBehaviour(label, sourceOf: (id) => string | undefined)`; `examples.test.ts`
   calls it with the `.ino` sources (no behaviour change).
2. `tests/python-examples.test.ts`: 33 entries; ids/titles/groups equal to the twins' and an
   in-order subset of `EXAMPLES`; docstring header with the four sections; each translates with
   `ok`, **no warnings**, `endsAfterSetup` only for 42, 44, 56; the sketch transpiles without
   warnings; 4,000 virtual ms without console errors;
   `describeExampleBehaviour('Python', (id) => sketchOf(id))` — the **same assertions** as the
   Arduino twins (Serial texts such as `Value: 512`, `2.50 V`, `Distance: 49.7 cm`, `0x27`; pin
   timelines; buzzer pulses; servo targets; LCD rows; 7-segment patterns); 16 and the error
   branches of 52–58 have their own tests.
3. `BLANK_PYTHON` translates without errors or warnings to empty `setup()`/`loop()` bodies with
   the two comments.

### 10.5 Simulator fidelity (C0, C)

`tests/codegen.test.ts` + `tests/runtime-fidelity.test.ts`: the cases of §6; the ~960 existing
tests stay green (any change reviewed).

### 10.6 On the real chip (A; `npm run test:hardware-sim`, after the build)

`tests-hardware-sim/python-board.test.ts` (needs the WASM toolchain, i.e. §0.1; CI sets
`ZERO1_REQUIRE_TOOLCHAIN=1` once the release exists, so a missing toolchain fails instead of
skipping):
- every golden and every Python example's sketch compiles with `buildSketch(…, { warnings: 'all' })`
  (new test-only option: `-Wall -Wextra` instead of `-w`, owner A in
  `src/upload/toolchain/arduino-build.ts`) with **0 warnings**, and fits the UNO;
- each deterministic golden/example runs on avr8js (`tools/emulator/run-hex.mjs`, inputs as in
  `upload-libs-emulated.test.ts`: A3 = 512, DHT 24.0 °C / 55 %, distance 50 cm) and its Serial
  output equals the simulator's for the same time (distances ±1 cm);
- the reserved-name test: a sketch declaring one variable for every Python-legal name after
  renaming (`long B1_ = 0;`, `long square_ = 0;`, …) compiles.

Contingency if the release is late: a native adapter (`tests-hardware-sim/native-toolchain.ts`)
runs the same `buildSketch` pipeline with the `avr-g++` 7.3 that CI already installs.

### 10.7 App (B, happy-dom)

- `tests/app-mode-registry.test.ts` (§7.1).
- `tests/ui-python.test.ts`: three mode buttons, `aria-pressed`, `z1.mode` saved/restored,
  `'pyth0n'` → Code; tab strips of §7.2 in each mode and the Python tab selected on entry and after
  Run with errors; the Code tab is the mirror, read-only, focusable, labelled, typing → toast;
  **the three-hop path Code (hand-written) → Blocks → Python → Code keeps `z1.code` byte for byte**,
  also after `flush()`, the update prompt and `pagehide`; Edit a copy: no question when `z1.code`
  is untouched, confirm when hand-written, Undo restores; `#code=` in Python mode asks only for
  hand-written code; `#python=` start-up and `hashchange` (confirm rules); New (template, confirm,
  toast, labels); first entry loads example 01; Examples menu in Python mode lists
  `PYTHON_EXAMPLES` and loads into the **Python** editor (never the C++ one); live lint after the
  debounce with end positions; Run with errors (console lines are Python lines, header "N errors",
  cursor on the first); Run ok (composed line map; `pythonize` applied to an `abort()` report);
  `endsAfterSetup` finish logic; `usesInput` selects the Serial Monitor; first-print hint once;
  Newline forced; console jump by `source` after a mode switch; Share ▾ items and file names;
  Download .ino / IDE / Upload refused with the toast while there are errors; IDE/Upload notes;
  hand-in payload `{ kind: 'python', code, workspaceJson: '', python }`, `unchanged`,
  `errorCount`; review mode with `kind: 'python'` (no storage writes; banner when the translation
  differs; fallback to Code).
- `tests/python-editor.test.ts`: completion never offers an NA name (`sorted`, `dict`, `try`,
  `class`, `lambda`, `enumerate` …) and offers `Pin.OUT` after `Pin.`, `sleep_ms` after `time.`;
  paste clean-up (curly quotes, U+00A0, leading tabs) with the toast and Ctrl+Z; Esc then Tab
  leaves both editors.
- Updated: `tests/app-header.test.ts` (three modes, 1366×768 and 1280×800 on one row),
  `tests/app-review-mode.test.ts`, `tests/ui-blocks.test.ts` (no hand-off, the copy button),
  `tests/upload-dialog.test.ts` (`{ error }`, `mapLine`, success note),
  `tests/arduino-ide-dialog.test.ts`, `tests/bundle-boundary.test.ts`.

### 10.8 Class platform (C)

- `tests/classroom-model.test.ts`: `readHandinDoc` with `python`, `pyth0n` (→ code);
  `draftProblem` for Python (empty, too large); `contentOf`; `pythonMaxBytes` listed as client-only
  in the "every limit is in the rules" test; the exact rule clauses of §8.2 asserted as strings.
- `tests/classroom-codec.test.ts`: Python source through `workspace`, plain and gzip.
- `tests/classroom-student-unit.test.ts`: a Python hand-in writes the same 10 keys with
  `workspace` = the Python source.
- `tests/handin-dialog.test.ts`: Python summary, error count, permission-denied text.
- `tests/share-link.test.ts`: `pythonFromHash`/`encodeSharePython` (Unicode), `ReviewPayload`
  with `python`, old payloads without it, `handinHash` for Python, `'pyth0n'` as the invalid kind.
- `tests/teacher-dashboard.test.ts`, `tests/review-page.test.ts`, `tests/zip.test.ts`: label,
  Python first, collapsed sketch, "Handed in with N Python errors" + disabled .ino, `.py`
  downloads, zip entries.
- `tests-emulator/firestore.rules.test.ts` (`npm run test:emulator`): allow a Python hand-in plain
  and gzip; deny Python with an empty workspace (plain and gzip); deny Code with a non-empty
  workspace (existing); deny `kind: 'pyth0n'` (R6.6 changes from `'python'`); deny a Python
  workspace over 100,000 bytes; the existing cases stay green.
- `tests-emulator/mutations/`: all 10 files regenerated from the new rules, plus
  `python-workspace-unchecked.rules` (ternary reverted); a new `npm test` check
  (`tests/rules-mutations.test.ts`) fails when a mutation differs from `firestore.rules` by more
  than 4 lines (stale copies can no longer be "caught" for the wrong reason); CI runs
  `mutations.sh` in the emulator job.

---

## 11. Work plan

### 11.1 File ownership

| Stream | Owns (creates or edits; nobody else touches these) |
|---|---|
| **A — translator + examples** | `src/python/**`, `src/sketch/**`, `src/blocks/generator.ts` and `generator-*.ts` (extraction only), `src/examples/python/**`, `src/upload/toolchain/arduino-build.ts` (the `warnings` option only), `scripts/gen-reserved-names.mjs`, `scripts/record-cpython.mjs`, `tests/python-*.test.ts`, `tests/example-behaviour.ts`, `tests/examples.test.ts`, `tests/fixtures/python/**`, `tests-hardware-sim/python-board.test.ts`, `.gitattributes` (`*.py text eol=lf`, `src/examples/python/*.py linguist-documentation`), `docs/PYTHON.md`, `docs/ARCHITECTURE.md` (§ "Python mode"), `README.md` |
| **B — app UI** | `src/ui/**` except `handin-dialog.ts`, `src/upload/index.ts`, `src/upload/ui/**`, `src/main.ts`, `index.html`, `scripts/check-bundle.mjs`, `package.json`, `package-lock.json`, `tests/app-*.test.ts`, `tests/ui*.test.ts`, `tests/python-editor.test.ts`, `tests/bundle-boundary.test.ts`, `tests/upload-dialog.test.ts`, `tests/arduino-ide-dialog.test.ts`, `docs/BLOCKS.md` §11.4 |
| **C — class platform + simulator fidelity** | `src/classroom/**`, `src/teacher/**`, `src/review/**`, `src/share-link.ts`, `src/ui/handin-dialog.ts`, `firestore.rules`, `firestore.indexes.json`, `tests-emulator/**`, `tests/classroom-*.test.ts`, `tests/handin-dialog.test.ts`, `tests/share-link.test.ts`, `tests/teacher-dashboard.test.ts`, `tests/review-page.test.ts`, `tests/zip.test.ts`, `tests/rules-mutations.test.ts`, `docs/CLASSROOM.md`; **C0**: `src/transpiler/**`, `src/runtime/**`, `tests/codegen.test.ts`, `tests/runtime-fidelity.test.ts` |
| shared, Day 1 only | `src/types.ts` (the §4.2 additions) |

C0 sits with C for load balance: it touches no file of A or B, and C's classroom share shrank
with the `workspace` reuse (§8.1).

### 11.2 Day 1: the contract PR (all three, merged first)

- `src/types.ts`: `Diagnostic.endLine/endColumn`, `ConsoleMessage.source`.
- A: `src/python/index.ts` types + a stub `pythonToArduino` (returns T1 for example 01, the T9
  placeholder otherwise), `BLANK_PYTHON`, `PYTHON_EXAMPLES` with example 01, `MessageCode` and a
  skeleton `MESSAGES`, `pythonizeRuntimeMessage` (identity), `src/sketch/placeholder.ts`.
- B: `AppMode = 'code' | 'blocks' | 'python'` (`src/ui/blocks-panel.ts`) with `'python'` handled as
  Code everywhere until §7.1 lands.
- C: `HandinKind`, `HandinDraft.python`, `HandinWork.kind`, `ReviewPayload.kind/python`,
  `encodeSharePython`/`pythonFromHash`, `LIMITS.pythonMaxBytes` — minimal handling so that
  `tsc` and every test stay green.

### 11.3 Order

| When | A | B | C |
|---|---|---|---|
| Step 0 (teacher, before week 1) | — | — | — (§0.1: tag the toolchain release, redeploy, hardware check) |
| Week 1 | `src/sketch` extraction; tokenizer, parser, syntax errors; reserved-name generator | mode registry refactor (§7.1); two-editor Code tab + copy button (§7.5–7.6); Esc fix | C0 simulator fidelity PR; rules + emulator tests + mutations (deployable alone) |
| Week 2 | scopes, data flow, kinds, checks, messages; emitter, helpers, source map; goldens | Python panel, editor, completion, paste; lint/Run/console/finish logic; Share, downloads, IDE, Upload | model, dialog, share links, dashboard, zip, review page |
| Week 3 | lists, try forms; lessons 01–34; CPython set; runtime tests | review mode; header; output visibility; tests; **then**, if done, examples 40–59 under A's review (ownership of those files moves to B by agreement) | docs/CLASSROOM.md; tests; help A with the §5.9 runtime-text table (A reviews) |
| Week 4 | examples 40–59 (unless B took them); board tests; docs; integration | integration | integration |

### 11.4 Estimates and deploy checklist

A ≈ 24 dev-days (tokenizer/parser 3.5, resolve + reserved names 3, data flow 2.5, kinds/checks/
messages 3, emitter/helpers/source map 3.5, lists + try forms 2, 33 examples 2.5, tests 3.5,
docs 0.5); B ≈ 11 (registry 2, two editors + switching 1.5, panel/editor/completion/paste 2.5,
run/lint/console/output 2, share/IDE/upload 1, review/header 1, tests 1); C ≈ 9 (C0 3, rules +
emulator + mutations 2, model/dialog/links 1.5, dashboard/review/zip 1.5, docs 1). Integration 2.
Total ≈ 46 dev-days, ≈ 4 calendar weeks with three developers (A is the critical path).

Deploy, in this order:
1. Step 0 done (Upload visible on the live site).
2. C0 merged (announce: the simulator now overflows like the board in Code mode too).
3. C's rules PR merged; **the teacher runs `npx firebase-tools@15.31.0 deploy --only
   firestore:rules`** (a checklist item in the PR). Backward compatible.
4. A and B merged → Pages deploys automatically.
5. Hardware check (teacher, 10 minutes, one board): upload the Python versions of 01, 03, 12, 21
   and 57 and compare with docs/UPLOAD.md §4's expectations and the Arduino IDE Serial Monitor.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Upload is not live (§0.1) — "a Python program can go to the board" is untrue at launch | step 0; until then the Arduino IDE path works for Python too |
| R2 | C0 changes Code-mode results (overflow now shows) | it is the board's behaviour; announced; tests reviewed one by one; §13 D3 |
| R3 | Students hit the subset boundary | precise NA messages with a way forward; "What works" dialog; examples stay inside the subset; v1.1 list in §14 |
| R4 | Web splitting surprises (`answer_2` in the sketch) | messages use Python names; the sketch comment on the second declaration: `// 'answer' again, now a number` |
| R5 | A generated sketch fails in `transpile()` or GCC | goldens and examples are transpile-clean and GCC-clean at `-Wall -Wextra` (§10.6); X-sketch-error tells the student it is not their fault |
| R6 | Three copies of each example drift | shared behaviour suite fails on drift; same ids/titles enforced; 33 not 41 |
| R7 | Timing drift between twins (helper calls add ticks) | assertions round to ms; helpers are short; per-example tolerance where needed |
| R8 | Rules deployed after the site | deploy order (§11.4); permission-denied text (§8.3) |
| R9 | The avr-libc and simulator float formatting differ in a last digit | `pyFloat` stays at 7 digits (never needs `atof` round trips); 21 values verified equal; board tests compare Serial output |
| R10 | Bundle growth | lazy chunk, exclusive 80 KB budget, marker check (§7.16) |
| R11 | Firefox without async stack frames | line numbers never depend on frames (§4.9) |

---

## 13. Decisions the teacher still has to make

| # | Question | Recommendation (what is specified) |
|---|---|---|
| D1 | The Python tab "before Generated JS": immediately before it (Code · Serial Monitor · Pin Map · **Python** · Generated JS), or first like the Blocks tab? | Specified: immediately before Generated JS (the literal reading), always selected in Python mode. Changing to "first" is one line in `TABS`; please confirm. |
| D2 | Blocks mode also keeps its own program (no automatic Blocks → Code hand-off; the banner's "Edit a copy in Code mode" instead)? | Yes: it fixes today's silent loss of hand-written code and keeps the three modes consistent. |
| D3 | The simulator becomes board-exact for arithmetic in every mode (C0): Code-mode sketches that overflow 16-bit `int` now show the board's wrong-looking result. | Yes: students see what the real board will do. |
| D4 | Decimal printing: MicroPython style, 7 digits (`1/3` → `0.3333333`, `0.1 + 0.2` → `0.3`), not CPython's 17 digits (and not MicroPython 1.26+'s shortest round-trip form, which avr-libc cannot compute reliably). | Yes (it is what the board can print reliably, and what most MicroPython boards in schools print). |
| D5 | Ship 33 Python examples (20 part-by-part + 13 lessons) instead of 41. | Yes; the other 8 can follow. |
| Action | Publish the toolchain release (§0.1) — needed for Upload in every mode. | Before week 1. |

---

## 14. Decisions log (every review item and its resolution)

Reviews: **S** = semantics, **U** = classroom UX, **I** = integration. Severity as given by the
reviewer (B blocker, M major, m minor, L later).

### 14.1 Semantics review

| # | Sev | Finding | Resolution | Where |
|---|---|---|---|---|
| S0 | — | "Did the upload work?" | Not on the live site (no release, no tag, 0 workflow runs; re-checked) | §0.1 |
| S1 | B | Arithmetic between literals and readings is 16-bit on the board (`adc.read() * 100 // 1023` → −15) | Accepted: every int-kinded C++ expression is `long` (`L` literals in arithmetic, `(long)` casts of narrower readings and pin constants, `(long)millis()`); goldens checked on the simulator and on avr8js | §4.7 N1, §2.13, §10.2, §10.6 |
| S2 | B | "0 warnings" checks nothing (`-w`); nothing runs the compiled sketch | Accepted: test-only `warnings: 'all'` (`-Wall -Wextra`); every golden/example run on avr8js and compared with the simulator; a CPython comparison set with listed deviations | §10.3, §10.6 |
| S3 | M | The simulator rounds floats / wraps ints only on store | Accepted: C0 fidelity PR before Python mode; §2.13 rewritten; `0.1 + 0.2 == 0.3` documented | §6 |
| S4 | M | `ticks_ms()` is unsigned on the board | Accepted: `(long)millis()`/`(long)micros()`; W-ticks-diff | §3.3 |
| S5 | M | `abs`/`min`/`max` are macros (double evaluation); hoisting breaks short-circuit order | Accepted, refined: Arduino macros only when every argument is side-effect free (the familiar idiom), typed once-evaluating helpers otherwise; no hoisting | §2.6, §4.8 |
| S6 | M | `{n:.Nf}` on an int prints in base N | Accepted: `(float)` conversion; `{2.5:.0f}` → 3 documented | §2.11, §2.13 |
| S7 | M | Missing int-only checks (Run works, Upload fails) | Accepted: E-index-float, E-range-float, E-bitop-float, E-repeat-float, E-format-code with CPython wording | §5.3 |
| S8 | M | text == number wrong in the simulator; literal on the left fails in GCC | Accepted: `==`/`!=` → `false`/`true` + W-str-num-eq; `<` … → E-compare; literal wrapped in `String()` | §2.5 |
| S9 | M | Names colliding with C++/Arduino (`B1`, `square`, `rand`, `div`) | Accepted: generated reserved list (macros + failing declarations + keywords + alternative tokens + emitted names) and a GCC test | §2.14, §10.2, §10.6 |
| S10 | M | A comment ending in `\` deletes the next line on the board; `*/` in a docstring | Accepted: C2, C3 | §4.7 |
| S11 | M | One type per variable rejects everyday Python | Accepted: def-use webs with their own C++ names; widening warnings only when output differs; parameter/return messages. Per-kind function cloning deferred to v1.1 (the message gives a way forward) | §2.9 |
| S12 | M | Loop-local promotion could reset counters | Accepted: defined on webs, "first" in evaluation order, augmented assignment is a read; negative goldens | §4.7 D2, §10.2 |
| S13 | M | Grammar gaps (`;`, one-line suites, `a = b = 0`, adjacent literals, leading zeros, CRLF, U+00A0, smart quotes, C habits) | Accepted, all | §2.2, §2.3, §5.1 |
| S14 | M | Accented text banned | Accepted: UTF-8 text allowed; warnings (not errors) for the LCD and byte counting; accented names transliterated (no name error at all) | §2.7, §2.14 |
| S15 | M | `append` refused; `[]` unspecified | Accepted: growable lists with a capacity rule, append/pop/clear, sum/min/max/in/print, hidden length parameter; NA for returning/comparing lists | §2.10 |
| S16 | m | `//=`, `%=` ignore the kind | Accepted | §2.4 |
| S17 | m | `pyPow(2, -1)` prints 1 | Accepted: stops with R-neg-power; text corrected | §2.5, §2.13 |
| S18 | m | f-string signs and alignment | Accepted: `pyPad` (sign before zeros), signed hex/bin, text left-aligned, `<`/`>` | §2.11 |
| S19 | m | `"\x41BC"`; unknown escapes | Accepted: split literals; backslash kept + W-escape | §2.2, §4.7 S1 |
| S20 | m | IndexError only on Serial; `//` by zero meaningless on the board | Accepted: `pyFail` + `abort()`; `pyNonZero` guard with the line | §4.8, §6 |
| S21 | m | `input()` no echo; `int("12abc")`; `isdigit()`; NA-try pointer | Accepted: echo; `pyInt` raises ValueError; `isdigit()`; form V of try instead of only a hint | §2.6, §2.7, §2.12 |
| S22 | m | Negative sleep; `sleep_ms(1.5)`; dropped truncation warning | Accepted: guards; `sleep_ms` with a float is an **error** (MicroPython raises TypeError) | §3.3, §5.3 |
| S23 | m | Shadowing built-ins is legal | Accepted: W-shadow + rename + E-not-callable | §2.6 |
| S24 | m | Defaults and keyword arguments are free | Accepted | §2.4 |
| S25 | m | Reading before assignment gives 0; globals created in a function | Accepted: definite-assignment analysis | §2.9 |
| S26 | m | Float printing (`1e-7` → `0.0`; "64-bit floats" claim; `round(x, n)` via `long`) | Accepted in part: shortest round-trip **rejected** — avr-libc's parsing/printing is not exact enough (probe f2: `3.1400001`, `99999.992` on the chip); instead `%.7g`-style, exactly MicroPython ≤ 1.25 (1.26+ prints round-trip digits), verified equal on both targets; the 64-bit claim removed; `round(x, n)` in float with exact powers of ten | §2.11, §2.13, §4.8 |
| S27 | m | Comments at block ends, temporaries always `long`, subscript swaps | Accepted | §4.4, §2.4 |

### 14.2 Classroom UX review

| # | Sev | Finding | Resolution | Where |
|---|---|---|---|---|
| U0 | — | Upload answer, "push the tag" steps | Confirmed against `.github/workflows/avr-toolchain-wasm.yml` (release step only on `refs/tags/avr-toolchain-wasm-v*`) | §0.1 |
| U1 | B | Hand-written C++ lost (Code → Blocks → Python → Code) | Accepted: each mode keeps its own program; a second, never-persisting mirror editor; "Edit a copy in Code mode" with confirm + Undo; Blocks too (D2); three-hop test | §7.5, §7.6, §10.7 |
| U2 | M | Tab position ambiguous; recommends Python first | Resolved the other way: the teacher's fixed wording read literally (as the integration review does), with this review's mitigations (always selected, lock icon, typing toast); D1 asks for a one-line confirmation | §7.2, §13 |
| U3 | M | `if not sensor.measure()` is wrong on real MicroPython; HC-SR04 raises | Accepted: `measure()` is a statement; try/except form S; without try the program stops like MicroPython; examples use the real idiom | §2.12, §9 |
| U4 | M | Seconds vs milliseconds | Accepted: W-sleep-long; `sleep_ms(0.5)` is an error (stronger than the suggested warning, because MicroPython refuses it) | §3.3 |
| U5 | M | Autocomplete offers refused things | Accepted: own completion source | §7.4 |
| U6 | M | Esc then Tab never leaves the editor | Accepted: fixed in the shared editor | §7.4 |
| U7 | M | `print()`/`input()` out of sight | Accepted: Serial Monitor on `input()`, first-print hint, accessible dot, Newline forced; output strip v1.1 | §7.9 |
| U8 | M | IndexError hangs with "Running" | Accepted: `pyFail` + `abort()` + console error on the line; ZeroDivisionError wording | §4.8, §5.6, §6 |
| U9 | M | Accented text and names refused | Accepted (= S14) | §2.7, §2.14 |
| U10 | M | Code pasted from worksheets | Accepted: paste clean-up + toast + visible U+00A0 + CPython-worded leftovers | §7.4, §5.1 |
| U11 | M | Pin number vs object hints | Accepted: E-attr-int-pin, E-class-not-part | §3.8, §5.2 |
| U12 | M | ZERO1 limits labelled as Python errors | Accepted: "ZERO1 Python does not have … yet" wording; webs remove the `input()`/`int()` case | §5.0, §5.4 |
| U13 | m | Header wraps at 1366 px | Accepted | §7.14 |
| U14 | m | Keep `LED_RED`; accept strings; consistent imports | Accepted | §3 |
| U15 | m | ADC range and PWM habits from other boards | Accepted: documented in completion/hover; W-pwm-buzzer/servo; PWM → `tone()` translation v1.1 | §3.2 |
| U16 | m | One rule for creating parts; drop `Motor`, `Buzzer.on/off` | Accepted (an explicit pin equal to the wiring is still accepted for copied code) | §3.8 |
| U17 | m | 33 examples, not 41 | Accepted (D5) | §9 |
| U18 | m | First visit and the New template | Accepted | §7.7 |
| U19 | m | Sketch readability | Accepted: header line, section labels, helpers after `loop()` (verified in the simulator and the `.ino` build) | §4.7 |
| U20 | m | Upload/IDE/download texts | Accepted | §7.11, §7.12 |
| U21 | m | Hand-in and review details | Accepted | §7.13, §8.5 |
| U22 | m | Accessibility labels, focusable mirror | Accepted | §7.4, §7.5, §7.10, §7.14 |
| U23 | m | Wording rules, "More…" links | Accepted except "More…" links → v1.1 (v1 ships the "What works" dialog; messages carry an example) | §5.0, §7.3 |
| U24 | m | A program without `while True` cuts a final tone | Accepted: finish when silent, ≤ 2 s | §7.8 |
| U25 | L | Editor comfort (auto-dedent, guides, delayed squiggles) | Deferred to v1.1 | — |

### 14.3 Integration review

| # | Sev | Finding | Resolution | Where |
|---|---|---|---|---|
| I0 | — | Upload answer; "run the workflow" | Corrected: only a pushed tag publishes a release | §0.1 |
| I1 | B | Python examples would load into the C++ editor | Accepted: `PythonExample` without `source`; dispatch by mode | §4.2, §7.7 |
| I2 | B | `setCode(…, {persist:false})` cannot protect `z1.code` | Accepted with another fix: a separate mirror editor that never persists; no hand-off writes | §7.5 |
| I3 | M | ~30 two-way mode checks | Accepted: mode registry first, with a lint test | §7.1 |
| I4 | M | Bundle budget unworkable as specified | Accepted: `python-chunk-*` name, exclusive budget, marker check, `BLANK_PYTHON` only via the chunk | §7.16 |
| I5 | M | Stale rules mutations; weak limit test; R6.6 uses `'python'` | Accepted: regenerate, drift test, exact clause strings, `'pyth0n'`, `mutations.sh` in CI | §10.8 |
| I6 | M | GCC test would skip in CI | Accepted: step 0 release, tests in `test:hardware-sim` with `ZERO1_REQUIRE_TOOLCHAIN`, native fallback; avr8js twin | §10.6 |
| I7 | M | Deploy order | Accepted: rules first + permission-denied text | §11.4, §8.3 |
| I8 | M | Tab position against the fixed decision | Accepted | §7.2 |
| I9 | M | File collisions, Day-1 type breakage | Accepted: ownership table, Day-1 contract PR | §11.1, §11.2 |
| I10 | m | Upload compile errors on sketch lines | Accepted: `mapLine`, note, source | §7.12 |
| I11 | m | Firefox async frames | Accepted: helpers receive the line; `pyFail` text parsed | §4.9 |
| I12 | m | Comment/docstring break the board build | Accepted (= S10) | §4.7 |
| I13 | m | lang-python completions | Accepted (= U5) | §7.4 |
| I14 | m | Tests use `'python'` as invalid | Accepted: `'pyth0n'` | §7.15, §10.8 |
| I15 | m | Console jumps to the wrong editor | Accepted: `source` tag | §7.10 |
| I16 | m | Squiggles ignore end positions | Accepted: `endLine`/`endColumn` in `Diagnostic` | §4.2 |
| I17 | m | Sketch larger than `codeMaxBytes`; "characters" vs bytes | Accepted: X-sketch-too-long, byte wording | §4.11 |
| I18 | m | `encodeContent` positional API | Moot: the codec does not change (§8.1) | §8.1 |
| I19 | m | `combineKinds` does not fit Python | Accepted: not shared | §4.2 |
| I20 | m | Review re-translation may differ | Accepted: banner + "Use the handed-in sketch" | §7.13 |
| I21 | m | `.gitattributes` | Accepted | §11.1 |
| I22 | — | Weigh reusing `workspace` (draft Q8) | Adopted: Python source in `workspace`; two-line rules change; no index, codec or 11-key change | §8.1, §8.2 |

### 14.4 The draft's own open questions

Q1 tab → D1 · Q2 `long` for ints → kept · Q3 exceptions → two try forms in v1 · Q4 growable lists
→ v1 · Q5 auto-stop → finish when silent (≤ 2 s) · Q6 Blocks confirm → D2 · Q7 `#pyexample=` →
v1.1 · Q8 storage → `workspace` · Q9 `map_range` → kept · Q10 Code-tab highlighting → v1.1.

**v1.1 list**: function cloning per argument kinds; `insert`/`remove`/`sort`/`index`/`count` on
lists; `PWM(Pin(BUZZER)).freq(f)` → `tone`; `#pyexample=<id>` links; Code-tab highlight of the
current Python line; "More…" links from messages into the "What works" dialog; editor comfort
(U25); an output strip under the Python editor; the 8 remaining examples.

---

## Appendix A. Sources (checked 2026-09-28)

Repository state, via the GitHub API: releases of `ebechalani/zero1smartboard` (empty), tags
(empty), runs of `avr-toolchain-wasm.yml` (0), deploy run
https://github.com/ebechalani/zero1smartboard/actions/runs/36460925696 (success, `d7c5c3f`).

MicroPython (GitHub raw sources; docs.micropython.org is blocked by this environment's proxy):
- machine.Pin / PWM / ADC — https://raw.githubusercontent.com/micropython/micropython/master/docs/library/machine.Pin.rst ,
  …/machine.PWM.rst , …/machine.ADC.rst
- esp32 and rp2 quick references — https://raw.githubusercontent.com/micropython/micropython/master/docs/esp32/quickref.rst ,
  https://raw.githubusercontent.com/micropython/micropython/master/docs/rp2/quickref.rst
- time — https://raw.githubusercontent.com/micropython/micropython/master/docs/library/time.rst
  (ticks arithmetic "will lead to invalid result"; use `ticks_diff`)
- neopixel, random, micropython.const — …/docs/library/neopixel.rst , random.rst , micropython.rst
- DHT tutorial — https://raw.githubusercontent.com/micropython/micropython/master/docs/esp8266/tutorial/dht.rst
  (`docs/library/dht.rst` is 404); driver — https://raw.githubusercontent.com/micropython/micropython-lib/master/micropython/drivers/sensor/dht/dht.py
- Float configuration and printing — https://raw.githubusercontent.com/micropython/micropython/master/ports/esp32/mpconfigport.h ,
  …/ports/rp2/mpconfigport.h , …/py/formatfloat.c , …/py/objfloat.c (master:
  `MP_FLOAT_REPR_PREC`), https://raw.githubusercontent.com/micropython/micropython/v1.22.0/py/objfloat.c
  (single precision: `'g'`, precision 7, `.0` appended); `MP_FLOAT_REPR_PREC` first appears in
  v1.26.0 (checked v1.23–v1.27)
- Board pin names — …/ports/stm32/boards/PYBD_SF2/pins.csv , …/ports/rp2/boards/RPI_PICO/pins.csv
- HC-SR04 driver — https://raw.githubusercontent.com/rsc1975/micropython-hcsr04/master/hcsr04.py
  (`OSError('Out of range')`); I2C LCD — https://raw.githubusercontent.com/dhylands/python_lcd/master/lcd/lcd_api.py
- micro:bit `sleep(n)` in milliseconds — https://raw.githubusercontent.com/bbcmicrobit/micropython/master/docs/microbit.rst

CPython (GitHub raw; docs.python.org blocked): `Doc/library/string.rst` (format spec, `<` default
for text), `Doc/reference/lexical_analysis.rst` (unrecognised escapes kept),
`Doc/reference/compound_stmts.rst` (`;`-separated statements). Error texts checked with a local
CPython 3.11 (`compile()`/`exec()`); 3.12-only wordings (S-default-order, "Did you mean" in
NameError) from the 3.12 changelog as quoted by the reviewers.

Arduino: https://raw.githubusercontent.com/arduino/ArduinoCore-avr/master/cores/arduino/Arduino.h
(`abs`, `min`, `max`, `round` macros), …/Print.cpp (`printFloat`, "ovf", `base == 0`).

Packages: `@codemirror/lang-python` 6.2.1 and `@lezer/python` 1.1.19 (npm tarballs;
`index.d.ts` exports `globalCompletion`, `localCompletionSource`, `python`, `pythonLanguage`);
`@codemirror/view` 6.43.11 and `@codemirror/commands` 6.11.0 (installed). Interpreter sizes: npm
registry tarballs (pyodide 314.0.7, @micropython/micropython-webassembly-pyscript 1.29.0-6,
brython 3.14.3, skulpt 1.2.0).

Firebase: rules conditional expressions (release notes), indexed value limit 1,500 bytes
(https://firebase.google.com/docs/firestore/quotas).

Unreachable from here: docs.micropython.org, docs.python.org, en.cppreference.com, the live site
ebechalani.github.io.

## Appendix B. Probes behind this spec

Scratch files in the architect's scratchpad (`…/python-design/final/`, not in the repository),
run with the project's own `transpile()` + `runSketch()`, the WebAssembly avr-g++ 7.3 of
`src/upload/toolchain` (bundle and tools present locally) and `tools/emulator/run-hex.mjs`:

- `f1.ino` — `long` arithmetic (`(long)analogRead(A3) * 100L / 1023L` → 50, `60L * 1000L` →
  60000, `1L << 20` → 1048576), a comment ending in `\.`, typed min/max/abs helpers, list helpers,
  `(long)millis()` difference, helpers placed after `loop()` (the simulator and the `.ino`
  preprocessing both accept it): identical on both targets except the known float-literal case.
- `f2.ino` — the rejected round-trip float printer: `3.1400001`, `99999.992`, `2.6800001` on the
  chip; also found the simulator bug of §6 item 5 (`3.4e38` → invalid JS).
- `f4.ino` — `String(float, n)` for 13 values: identical.
- `f5.ino` — the final `pyFloat` on 21 values (`0.0001`, `1e-07`, `1.5e-05`, `1e+10`,
  `1234567.0`, `1e+07`, `1.234568e+07`, `-2.5e-06`, `99999.99`, `0.3333333`, `0.3`, …): identical.
- `f6.ino` — every helper of §4.8, verbatim: simulator (with `abort()` replaced by an endless loop
  until §6 item 3) and avr8js print the same lines, except `round(2.675, 2)` (§6 item 1) and the ultrasonic
  distance model; avr-g++ `-Wall -Wextra`: **0 warnings**, 19,764 bytes of flash for all helpers
  together; `Line 32: ZeroDivisionError: division by zero` printed, then the chip halts in
  `abort()`.
- The reviewers' probes (`…/python-design/semantics/`, `…/integration/`, `…/classroom-ux/`) are
  the evidence for §14.
