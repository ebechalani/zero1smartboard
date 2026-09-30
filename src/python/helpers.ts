/**
 * The C++ helpers of the sketches made from Python (docs/PYTHON.md §4.8): the texts that make
 * C++ behave like Python where the two differ (`//`, `%`, `round()`, printing a decimal number,
 * IndexError, ZeroDivisionError, …). Each is emitted once, only when used, after `loop()`, in
 * `helperOrder`, together with the helpers it needs; a comment shared by several helpers (the
 * abs / min / max family) goes before the first one emitted.
 *
 * The fixed texts are verbatim from §4.8. The list helpers exist per element kind (`…L` long,
 * `…F` float, `…S` String, `…B` bool, `…C` colour, `…P` Pin, `…Y` byte) and are generated from
 * one template each; the `…L` texts are §4.8's. `showSegments` / `showDigit` are the Blocks
 * generator's (src/sketch/helpers.ts).
 */
import { SEGMENT_HELPERS } from '../sketch/helpers';

/** The fixed helpers (§4.8, verbatim, without their comment lines), by name. */
const FIXED: Readonly<Record<string, string>> = {
  pyFail: String.raw`void pyFail(int line, String text) {
  Serial.print("Line ");
  Serial.print(line);
  Serial.print(": ");
  Serial.println(text);
  Serial.flush();
  abort();
}`,
  pyFloorDiv: String.raw`long pyFloorDiv(long a, long b) {
  long q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
  return q;
}`,
  pyMod: String.raw`long pyMod(long a, long b) {
  long r = a % b;
  if (r != 0 && ((r < 0) != (b < 0))) r += b;
  return r;
}`,
  pyFloatMod: String.raw`float pyFloatMod(float a, float b) {
  float r = fmod(a, b);
  if (r != 0 && ((r < 0) != (b < 0))) r += b;
  return r;
}`,
  pyNonZero: String.raw`long pyNonZero(long divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
}`,
  pyNonZeroF: String.raw`float pyNonZeroF(float divisor, int line) {
  if (divisor == 0) pyFail(line, "ZeroDivisionError: division by zero");
  return divisor;
}`,
  pyPow: String.raw`long pyPow(long base, long exponent, int line) {
  if (exponent < 0) pyFail(line, "a negative power of a whole number is a decimal number: write 2.0 ** n");
  long result = 1;
  for (long i = 0; i < exponent; i++) result *= base;
  return result;
}`,
  pyPow10: String.raw`float pyPow10(int n) {
  float result = 1;
  for (int i = 0; i < n; i++) result *= 10;
  for (int i = 0; i > n; i--) result /= 10;
  return result;
}`,
  pyRound: String.raw`long pyRound(float x) {
  long n = floor(x);
  float rest = x - n;
  if (rest > 0.5 || (rest == 0.5 && n % 2 != 0)) n++;
  return n;
}`,
  pyRoundTo: String.raw`float pyRoundTo(float x, int decimals) {
  float scale = pyPow10(decimals);
  return floor(x * scale + 0.5) / scale;
}`,
  pyAbsL: String.raw`long pyAbsL(long x) {
  return x < 0 ? -x : x;
}`,
  pyAbsF: String.raw`float pyAbsF(float x) {
  return x < 0 ? -x : x;
}`,
  pyMinL: String.raw`long pyMinL(long a, long b) {
  return a < b ? a : b;
}`,
  pyMaxL: String.raw`long pyMaxL(long a, long b) {
  return a > b ? a : b;
}`,
  pyMinF: String.raw`float pyMinF(float a, float b) {
  return a < b ? a : b;
}`,
  pyMaxF: String.raw`float pyMaxF(float a, float b) {
  return a > b ? a : b;
}`,
  pyBool: String.raw`String pyBool(bool b) {
  return b ? "True" : "False";
}`,
  pyFloat: String.raw`String pyFloat(float x) {
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
}`,
  pyDigits: String.raw`String pyDigits(float x, int exponent) {
  bool scientific = exponent < -4 || exponent >= 7;
  int decimals = scientific ? 6 : 6 - exponent;
  String text = String(scientific ? x / pyPow10(exponent) : x, decimals);
  if (decimals > 0) {
    while (text.endsWith("0")) text.remove(text.length() - 1);
    if (text.endsWith(".")) text.remove(text.length() - 1);
  }
  return text;
}`,
  pySignificant: String.raw`int pySignificant(String text) {
  int count = 0;
  bool started = false;
  for (unsigned int i = 0; i < text.length(); i++) {
    char c = text.charAt(i);
    if (c >= '1' && c <= '9') started = true;
    if (started && c >= '0' && c <= '9') count++;
  }
  return count;
}`,
  pyPad: String.raw`String pyPad(String text, int width, char how) {
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
}`,
  pyHex: String.raw`String pyHex(long n, bool upper) {
  String text = String(n < 0 ? -n : n, HEX);
  if (upper) text.toUpperCase();
  else text.toLowerCase();
  return n < 0 ? "-" + text : text;
}`,
  pyBin: String.raw`String pyBin(long n) {
  String text = String(n < 0 ? -n : n, BIN);
  return n < 0 ? "-" + text : text;
}`,
  pyInput: String.raw`String pyInput(String prompt) {
  Serial.print(prompt);
  while (Serial.available() == 0) {
  }
  String line = Serial.readStringUntil('\n');
  if (line.endsWith("\r")) line.remove(line.length() - 1);
  Serial.println(line);
  return line;
}`,
  pyIsInt: String.raw`bool pyIsInt(String text) {
  text.trim();
  int start = (text.startsWith("-") || text.startsWith("+")) ? 1 : 0;
  if ((int)text.length() <= start) return false;
  for (int i = start; i < (int)text.length(); i++) {
    char c = text.charAt(i);
    if (c < '0' || c > '9') return false;
  }
  return true;
}`,
  pyInt: String.raw`long pyInt(String text, int line) {
  if (!pyIsInt(text)) pyFail(line, "ValueError: invalid literal for int() with base 10: '" + text + "'");
  text.trim();
  return text.toInt();
}`,
  pyIsFloat: String.raw`bool pyIsFloat(String text) {
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
}`,
  pyFloatOf: String.raw`float pyFloatOf(String text, int line) {
  if (!pyIsFloat(text)) pyFail(line, "ValueError: could not convert string to float: '" + text + "'");
  return text.toFloat();
}`,
  pyIsDigit: String.raw`bool pyIsDigit(String text) {
  if (text.length() == 0) return false;
  for (unsigned int i = 0; i < text.length(); i++) {
    if (text.charAt(i) < '0' || text.charAt(i) > '9') return false;
  }
  return true;
}`,
  pyUpper: String.raw`String pyUpper(String text) {
  text.toUpperCase();
  return text;
}`,
  pyLower: String.raw`String pyLower(String text) {
  text.toLowerCase();
  return text;
}`,
  pyStrip: String.raw`String pyStrip(String text) {
  text.trim();
  return text;
}`,
  pyReplace: String.raw`String pyReplace(String text, String from, String to) {
  text.replace(from, to);
  return text;
}`,
  pyCharAt: String.raw`String pyCharAt(String text, long index, int line) {
  if (index < 0) index += text.length();
  if (index < 0 || index >= (long)text.length()) pyFail(line, "IndexError: string index out of range");
  return String(text.charAt(index));
}`,
  pyIndex: String.raw`long pyIndex(long index, long size, int line) {
  if (index < 0) index += size;
  if (index < 0 || index >= size) pyFail(line, "IndexError: list index out of range");
  return index;
}`,
  pySleep: String.raw`void pySleep(float seconds, int line) {
  if (seconds < 0) pyFail(line, "ValueError: sleep length must be non-negative");
  delay((unsigned long)(seconds * 1000 + 0.5));
}`,
  pySleepMs: String.raw`void pySleepMs(long ms, int line) {
  if (ms < 0) pyFail(line, "ValueError: sleep length must be non-negative");
  delay(ms);
}`,
  pyDistanceCm: String.raw`float pyDistanceCm(int trigPin, int echoPin, int line) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long duration = pulseIn(echoPin, HIGH, 30000);
  if (duration == 0 && line > 0) pyFail(line, "OSError: Out of range");
  return duration * 0.0343 / 2;
}`,
  ...SEGMENT_HELPERS,
};

/** The comment lines before a helper; `group` members share one (it goes before the first emitted). */
const COMMENTS: ReadonlyArray<{ comment: string; group: readonly string[] }> = [
  { comment: '// Stops the program like a Python error: the message goes to the Serial Monitor, then the board halts', group: ['pyFail'] },
  { comment: "// Python's // for whole numbers: rounds down (C++'s / rounds toward zero)", group: ['pyFloorDiv'] },
  { comment: "// Python's % for whole numbers: the result has the sign of the divisor", group: ['pyMod'] },
  { comment: "// Python's % for decimal numbers", group: ['pyFloatMod'] },
  { comment: '// Python stops with ZeroDivisionError instead of dividing by 0', group: ['pyNonZero', 'pyNonZeroF'] },
  { comment: "// Python's ** for whole numbers", group: ['pyPow'] },
  { comment: '// 10 to the power n, exact on the board (pow() is not)', group: ['pyPow10'] },
  { comment: "// Python's round(x): halves go to the even number (round(2.5) == 2)", group: ['pyRound'] },
  { comment: "// Python's round(x, n)", group: ['pyRoundTo'] },
  { comment: "// Python's abs(), min() and max(): each value is worked out once (Arduino's abs/min/max are macros)", group: ['pyAbsL', 'pyAbsF', 'pyMinL', 'pyMaxL', 'pyMinF', 'pyMaxF'] },
  { comment: '// How Python shows True and False', group: ['pyBool'] },
  {
    comment: '// How MicroPython shows a decimal number: 7 significant digits, 3.0 keeps its .0,\n// and 1e-05 / 1e+07 style below 0.0001 and from 10000000 on',
    group: ['pyFloat'],
  },
  { comment: '// The 7 significant digits of x, without the zeros at the end (for pyFloat)', group: ['pyDigits'] },
  { comment: '// How many significant digits a number text has (for pyFloat)', group: ['pySignificant'] },
  { comment: "// f-string widths: '>' spaces on the left (numbers), '<' spaces on the right (text), '0' zeros after the sign", group: ['pyPad'] },
  { comment: '// f"{n:x}" and f"{n:X}": hexadecimal, with "-" in front of negative numbers', group: ['pyHex'] },
  { comment: '// f"{n:b}": binary, with "-" in front of negative numbers', group: ['pyBin'] },
  { comment: "// Python's input(): waits for one line typed in the Serial Monitor and shows it, like a terminal", group: ['pyInput'] },
  { comment: '// True when int() can read the text: spaces, an optional sign, then digits', group: ['pyIsInt'] },
  { comment: "// Python's int(text): stops with ValueError when the text is not a whole number", group: ['pyInt'] },
  { comment: '// True when float() can read the text: an optional sign, digits with at most one point, an optional exponent', group: ['pyIsFloat'] },
  { comment: "// Python's float(text): stops with ValueError when the text is not a number", group: ['pyFloatOf'] },
  { comment: "// Python's str.isdigit()", group: ['pyIsDigit'] },
  { comment: "// text[i] with Python's negative indexes and IndexError", group: ['pyCharAt'] },
  { comment: "// list[i] with Python's negative indexes and IndexError", group: ['pyIndex'] },
  { comment: "// Python's time.sleep(seconds) for a value that is not a fixed number", group: ['pySleep'] },
  { comment: "// Python's time.sleep_ms(ms) for a value that is not a fixed number", group: ['pySleepMs'] },
  {
    comment: '// HC-SR04: a 10 µs pulse on trig, then the echo time on echo; no echo gives 0,\n// or stops the program with MicroPython\'s OSError when line > 0',
    group: ['pyDistanceCm'],
  },
];

// ---------------------------------------------------------------------------
// list helpers: one template per operation, one variant per element kind
// ---------------------------------------------------------------------------

/** The suffix of a list helper variant: the element kind in one letter. */
export type ListSuffix = 'L' | 'F' | 'S' | 'B' | 'C' | 'P' | 'Y';

/** Per variant: the C++ type of an item, the type sum / min / max give, and an item as text (print(list)). */
const VARIANTS: Readonly<Record<ListSuffix, { type: string; number: string; text: string }>> = {
  L: { type: 'long', number: 'long', text: 'String(list[i])' },
  F: { type: 'float', number: 'float', text: 'pyFloat(list[i])' },
  S: { type: 'String', number: 'long', text: `String("'") + list[i] + "'"` },
  B: { type: 'bool', number: 'long', text: 'pyBool(list[i])' },
  C: { type: 'unsigned long', number: 'long', text: 'String("(") + String(list[i] >> 16) + ", " + String((list[i] >> 8) & 255) + ", " + String(list[i] & 255) + ")"' },
  P: { type: 'int', number: 'long', text: 'String(list[i])' },
  Y: { type: 'byte', number: 'long', text: 'String(list[i])' },
};

/** The list operations (§2.10), in the order their helpers are emitted. */
const LIST_OPERATIONS = ['pyAppend', 'pyPop', 'pyListText', 'pySum', 'pyMinList', 'pyMaxList', 'pyInList'] as const;
export type ListOperation = (typeof LIST_OPERATIONS)[number];

const LIST_COMMENTS: Partial<Record<ListOperation, string>> = {
  pyAppend: '// list.append(value) for a list with room for `capacity` items; gives the new length',
  pyPop: '// list.pop(index): takes the item out and moves the ones after it; the caller then shortens the list by 1',
  pyListText: '// str(list) / print(list): [1, 2, 3]',
};

/** The text of one list helper variant; `$T` is the item type, `$N` the number type of sum / min / max. */
function listHelper(op: ListOperation, suffix: ListSuffix): string {
  const v = VARIANTS[suffix];
  const templates: Record<ListOperation, string> = {
    pyAppend: `long pyAppend$S($T list[], long count, long capacity, $T value, int line) {
  if (count >= capacity) pyFail(line, "MemoryError: the list is full (" + String(capacity) + " items on the board)");
  list[count] = value;
  return count + 1;
}`,
    pyPop: `$T pyPop$S($T list[], long count, long index, int line) {
  if (count == 0) pyFail(line, "IndexError: pop from empty list");
  if (index < 0) index += count;
  if (index < 0 || index >= count) pyFail(line, "IndexError: pop index out of range");
  $T value = list[index];
  for (long i = index; i < count - 1; i++) list[i] = list[i + 1];
  return value;
}`,
    pyListText: `String pyListText$S($T list[], long count) {
  String text = "[";
  for (long i = 0; i < count; i++) {
    if (i > 0) text += ", ";
    text += $X;
  }
  return text + "]";
}`,
    pySum: `$N pySum$S($T list[], long count) {
  $N total = 0;
  for (long i = 0; i < count; i++) total += list[i];
  return total;
}`,
    pyMinList: `$N pyMinList$S($T list[], long count, int line) {
  if (count == 0) pyFail(line, "ValueError: min() arg is an empty sequence");
  $N smallest = list[0];
  for (long i = 1; i < count; i++) {
    if (list[i] < smallest) smallest = list[i];
  }
  return smallest;
}`,
    pyMaxList: `$N pyMaxList$S($T list[], long count, int line) {
  if (count == 0) pyFail(line, "ValueError: max() arg is an empty sequence");
  $N largest = list[0];
  for (long i = 1; i < count; i++) {
    if (list[i] > largest) largest = list[i];
  }
  return largest;
}`,
    pyInList: `bool pyInList$S($T list[], long count, $T value) {
  for (long i = 0; i < count; i++) {
    if (list[i] == value) return true;
  }
  return false;
}`,
  };
  return templates[op].replace(/\$S/g, suffix).replace(/\$T/g, v.type).replace(/\$N/g, v.number).replace(/\$X/g, v.text);
}

// ---------------------------------------------------------------------------
// the public table
// ---------------------------------------------------------------------------

const SUFFIXES = Object.keys(VARIANTS) as ListSuffix[];

/** sum(), min() and max() need numbers: no text, colour or Pin variants (E-api-kind refuses them). */
const NUMERIC_OPERATIONS: ReadonlySet<ListOperation> = new Set(['pySum', 'pyMinList', 'pyMaxList']);
const NUMERIC_SUFFIXES: ReadonlySet<ListSuffix> = new Set(['L', 'F', 'B', 'Y']);

/** The variants that exist. */
function hasVariant(op: ListOperation, suffix: ListSuffix): boolean {
  return !NUMERIC_OPERATIONS.has(op) || NUMERIC_SUFFIXES.has(suffix);
}

/** Every helper name in the order helpers are emitted (§4.8): the fixed ones, the list variants, the 7-segment ones. */
export const helperOrder: readonly string[] = (() => {
  const fixed = Object.keys(FIXED).filter((n) => !(n in SEGMENT_HELPERS));
  const beforeLists = fixed.indexOf('pySleep');
  const lists = LIST_OPERATIONS.flatMap((op) => SUFFIXES.filter((s) => hasVariant(op, s)).map((s) => `${op}${s}`));
  return [...fixed.slice(0, beforeLists), ...lists, ...fixed.slice(beforeLists), ...Object.keys(SEGMENT_HELPERS)];
})();

/** Every helper's C++ text (without its comment), by name. */
export const PY_HELPERS: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = { ...FIXED };
  for (const op of LIST_OPERATIONS) for (const s of SUFFIXES) if (hasVariant(op, s)) out[`${op}${s}`] = listHelper(op, s);
  return out;
})();

/** The helpers each helper calls (they are emitted with it). */
const NEEDS: Readonly<Record<string, readonly string[]>> = {
  pyNonZero: ['pyFail'],
  pyNonZeroF: ['pyFail'],
  pyPow: ['pyFail'],
  pyRoundTo: ['pyPow10'],
  pyFloat: ['pyPow10', 'pyDigits', 'pySignificant'],
  pyDigits: ['pyPow10'],
  pyInt: ['pyIsInt', 'pyFail'],
  pyFloatOf: ['pyIsFloat', 'pyFail'],
  pyCharAt: ['pyFail'],
  pyIndex: ['pyFail'],
  pySleep: ['pyFail'],
  pySleepMs: ['pyFail'],
  pyDistanceCm: ['pyFail'],
  showDigit: ['showSegments'],
  ...Object.fromEntries(
    SUFFIXES.flatMap((s) => [
      [`pyAppend${s}`, ['pyFail']],
      [`pyPop${s}`, ['pyFail']],
      [`pyMinList${s}`, ['pyFail']],
      [`pyMaxList${s}`, ['pyFail']],
      [`pyListText${s}`, s === 'F' ? ['pyFloat'] : s === 'B' ? ['pyBool'] : []],
    ]),
  ),
};

/** `names` with every helper they need, in emission order. */
export function withNeeds(names: Iterable<string>): string[] {
  const all = new Set<string>();
  const add = (n: string) => {
    if (all.has(n)) return;
    all.add(n);
    for (const m of NEEDS[n] ?? []) add(m);
  };
  for (const n of names) add(n);
  return helperOrder.filter((n) => all.has(n));
}

/** The name of the comment group a helper belongs to (its comment goes before the first one emitted). */
function commentOf(name: string): { key: string; comment: string } | null {
  for (const op of LIST_OPERATIONS) {
    if (name.startsWith(op) && name.length === op.length + 1) {
      const c = LIST_COMMENTS[op];
      return c ? { key: op, comment: c } : null;
    }
  }
  const entry = COMMENTS.find((c) => c.group.includes(name));
  return entry ? { key: entry.group[0], comment: entry.comment } : null;
}

/** The helper section of a sketch: `names` (with what they need) in order, each once, blank lines between. */
export function helperTexts(names: Iterable<string>): string[] {
  const done = new Set<string>();
  return withNeeds(names).map((name) => {
    const c = commentOf(name);
    const head = c && !done.has(c.key) ? `${c.comment}\n` : '';
    if (c) done.add(c.key);
    return head + PY_HELPERS[name];
  });
}

/** The helpers that can stop the program (they call pyFail, so setup() starts Serial). */
export function stopsProgram(names: Iterable<string>): boolean {
  return withNeeds(names).includes('pyFail');
}
