/**
 * Arduino C++ code generator for the ZERO1 block workspace
 * (docs/BLOCKS.md §11.3).
 *
 * `ArduinoGenerator.workspaceToCode(ws)` returns a complete sketch that goes
 * through the normal `transpile()` → Executor pipeline and that a student can
 * paste into the Arduino IDE. The per-block generators live in
 * `generator-builtin.ts` (standard Blockly blocks) and `generator-zero1.ts`
 * (`z1_*` blocks); they call the `use*` methods of this class to register the
 * includes, pin constants, library objects and helper functions that the
 * finished sketch needs.
 */
import * as Blockly from 'blockly';
import { SEGMENT_HELPERS } from '../sketch/helpers';
import { Order } from '../sketch/order';
import { PINS, type PinName } from '../sketch/pins';
import { KNOWN_RUNTIME_NAMES } from '../transpiler/signatures';
import { installBuiltinGenerators } from './generator-builtin';
import { installZero1Generators } from './generator-zero1';
import { inferTypes, type CType, type TypingResult } from './typing';

// The C++ precedence table, the pin table and the 7-segment helpers are shared with the Python
// translator (docs/PYTHON.md §4.2) and live in src/sketch; re-exported for the per-block generators.
export { Order };
export type { PinName };

/** Library objects a sketch may declare. */
export type ObjectName = 'servo' | 'lcd' | 'dht' | 'pixels';

/** Helper functions a sketch may contain (emitted once each, in this order). */
export type HelperName =
  | 'showSegments'
  | 'showDigit'
  | 'readDistanceCm'
  | 'readLine'
  | 'isPrime'
  | 'toUpper'
  | 'toLower'
  | 'toTitle'
  | 'trimText'
  | 'trimLeft'
  | 'trimRight';

interface ObjectInfo {
  name: ObjectName;
  includes: string[];
  declaration: string;
  setup: string[];
}

/** Library objects, in the order their includes / declarations / init lines are emitted. */
const OBJECTS: readonly ObjectInfo[] = [
  { name: 'servo', includes: ['Servo.h'], declaration: 'Servo servo;', setup: ['servo.attach(SERVO_PIN);'] },
  {
    name: 'lcd',
    includes: ['Wire.h', 'LiquidCrystal_I2C.h'],
    declaration: 'LiquidCrystal_I2C lcd(0x27, 16, 2);',
    setup: ['lcd.init();', 'lcd.backlight();'],
  },
  { name: 'dht', includes: ['DHT.h'], declaration: 'DHT dht(DHT_PIN, DHT22);', setup: ['dht.begin();'] },
  {
    name: 'pixels',
    includes: ['Adafruit_NeoPixel.h'],
    declaration: 'Adafruit_NeoPixel pixels(1, RGB_PIN, NEO_GRB + NEO_KHZ800);',
    setup: ['pixels.begin();', 'pixels.show();'],
  },
];

/** Order of the setup() init lines of the objects (docs/BLOCKS.md §11.3). */
const OBJECT_SETUP_ORDER: readonly ObjectName[] = ['lcd', 'pixels', 'dht', 'servo'];

/** Helper functions, verbatim (docs/BLOCKS.md §11.3). */
export const HELPERS: Readonly<Record<HelperName, string>> = {
  showSegments: SEGMENT_HELPERS.showSegments,
  showDigit: SEGMENT_HELPERS.showDigit,
  readDistanceCm: `float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  return duration * 0.0343 / 2;
}`,
  readLine: `String readLine() {
  String line = Serial.readStringUntil('\\n');
  line.trim();
  return line;
}`,
  isPrime: `bool isPrime(long n) {
  if (n < 2) return false;
  for (long d = 2; d * d <= n; d++) {
    if (n % d == 0) return false;
  }
  return true;
}`,
  toUpper: `String toUpper(String text) {
  text.toUpperCase();
  return text;
}`,
  toLower: `String toLower(String text) {
  text.toLowerCase();
  return text;
}`,
  toTitle: `String toTitle(String text) {
  bool newWord = true;
  for (unsigned int i = 0; i < text.length(); i++) {
    char c = text.charAt(i);
    if (c == ' ') {
      newWord = true;
    } else if (newWord) {
      text.setCharAt(i, toUpperCase(c));
      newWord = false;
    } else {
      text.setCharAt(i, toLowerCase(c));
    }
  }
  return text;
}`,
  trimText: `String trimText(String text) {
  text.trim();
  return text;
}`,
  trimLeft: `String trimLeft(String text) {
  while (text.length() > 0 && isSpace(text.charAt(0))) {
    text.remove(0, 1);
  }
  return text;
}`,
  trimRight: `String trimRight(String text) {
  while (text.length() > 0 && isSpace(text.charAt(text.length() - 1))) {
    text.remove(text.length() - 1);
  }
  return text;
}`,
};

const HELPER_ORDER = Object.keys(HELPERS) as HelperName[];

/** C++ keywords: never used as variable or function names. */
const CPP_KEYWORDS = [
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool', 'break', 'case', 'catch', 'char',
  'char16_t', 'char32_t', 'class', 'compl', 'const', 'constexpr', 'const_cast', 'continue', 'decltype', 'default',
  'delete', 'do', 'double', 'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for',
  'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'not_eq', 'nullptr',
  'operator', 'or', 'or_eq', 'private', 'protected', 'public', 'register', 'reinterpret_cast', 'return', 'short',
  'signed', 'sizeof', 'static', 'static_assert', 'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local',
  'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile',
  'wchar_t', 'while', 'xor', 'xor_eq',
  // Arduino type aliases and the two mandatory functions
  'boolean', 'byte', 'word', 'setup', 'loop', 'main',
];

/** Names the generator itself may emit; user names must not collide with them. */
const GENERATED_NAMES = [...PINS.map((p) => p.name), ...OBJECTS.map((o) => o.name), ...HELPER_ORDER, 'DIGITS'];

/** Default initialiser of a global variable of the given type. */
export function defaultValue(type: CType): string {
  switch (type) {
    case 'String':
      return '""';
    case 'bool':
      return 'false';
    case 'float':
      return '0.0';
    default:
      return '0';
  }
}

/** Format a Blockly number field as a C literal (`2.5`, `-3`, `100`). */
export function formatNumber(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(n);
}

const REPEAT_COUNTER_BASES = ['i', 'j', 'k'];

/** `(a == b)` → `a == b`, but only when the first `(` closes at the very end (string literals are skipped). */
function stripOuterParentheses(code: string): string {
  if (!code.startsWith('(') || !code.endsWith(')')) return code;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0 && i < code.length - 1) return code;
    }
  }
  return code.slice(1, -1);
}

/**
 * Blockly code generator that produces an Arduino sketch.
 *
 * The generator keeps per-run state (used pins, objects, helpers, the code of
 * every hat) which `init()` resets and `finish()` assembles into the final
 * layout: header comment, includes, pin constants, objects, global variables,
 * helper functions, user functions, `setup()`, `loop()`.
 */
export class ArduinoGenerator extends Blockly.CodeGenerator {
  readonly ORDER_ATOMIC = Order.ATOMIC;
  readonly ORDER_UNARY_POSTFIX = Order.UNARY_POSTFIX;
  readonly ORDER_UNARY_PREFIX = Order.UNARY_PREFIX;
  readonly ORDER_MULTIPLICATIVE = Order.MULTIPLICATIVE;
  readonly ORDER_ADDITIVE = Order.ADDITIVE;
  readonly ORDER_SHIFT = Order.SHIFT;
  readonly ORDER_RELATIONAL = Order.RELATIONAL;
  readonly ORDER_EQUALITY = Order.EQUALITY;
  readonly ORDER_BITWISE_AND = Order.BITWISE_AND;
  readonly ORDER_BITWISE_XOR = Order.BITWISE_XOR;
  readonly ORDER_BITWISE_OR = Order.BITWISE_OR;
  readonly ORDER_LOGICAL_AND = Order.LOGICAL_AND;
  readonly ORDER_LOGICAL_OR = Order.LOGICAL_OR;
  readonly ORDER_CONDITIONAL = Order.CONDITIONAL;
  readonly ORDER_ASSIGNMENT = Order.ASSIGNMENT;
  readonly ORDER_NONE = Order.NONE;

  // ---- per-run state (reset by init) --------------------------------------
  private pins = new Set<PinName>();
  private objects = new Set<ObjectName>();
  private helpers = new Set<HelperName>();
  private serialUsed = false;
  private setupParts: string[] = [];
  private loopParts: string[] = [];
  private functionParts: string[] = [];
  private typing: TypingResult | null = null;
  private workspace: Blockly.Workspace | null = null;
  /** Sanitised names of every user variable and procedure (to keep loop counters distinct). */
  private userNames = new Set<string>();

  constructor() {
    super('Arduino');
    this.INDENT = '  ';
    this.isInitialized = false;
    this.addReservedWords([...CPP_KEYWORDS, ...KNOWN_RUNTIME_NAMES, ...GENERATED_NAMES].join(','));
    this.ORDER_OVERRIDES = [
      [Order.UNARY_POSTFIX, Order.UNARY_POSTFIX],
      [Order.LOGICAL_AND, Order.LOGICAL_AND],
      [Order.LOGICAL_OR, Order.LOGICAL_OR],
    ];
    installBuiltinGenerators(this);
    installZero1Generators(this);
  }

  // ---- Blockly hooks --------------------------------------------------------

  /** Reset the per-run state, infer the variable types and set up the name database. */
  override init(workspace: Blockly.Workspace): void {
    super.init(workspace);
    this.pins = new Set();
    this.objects = new Set();
    this.helpers = new Set();
    this.serialUsed = false;
    this.setupParts = [];
    this.loopParts = [];
    this.functionParts = [];
    this.workspace = workspace;
    this.typing = inferTypes(workspace);

    if (!this.nameDB_) this.nameDB_ = new Blockly.Names(this.RESERVED_WORDS_);
    else this.nameDB_.reset();
    this.nameDB_.setVariableMap(workspace.getVariableMap());
    this.nameDB_.populateVariables(workspace);
    this.nameDB_.populateProcedures(workspace);

    this.userNames = new Set();
    for (const v of workspace.getVariableMap().getAllVariables()) this.userNames.add(this.getVariableName(v.getId()));
    for (const list of Blockly.Procedures.allProcedures(workspace)) {
      for (const [name] of list) this.userNames.add(this.getProcedureName(name));
    }
    this.isInitialized = true;
  }

  /**
   * Generate the sketch of a workspace. Only the two hats and the function
   * definitions produce code; every other top-level block is ignored.
   */
  override workspaceToCode(workspace?: Blockly.Workspace): string {
    if (!workspace) throw new Error('workspaceToCode needs a workspace');
    this.init(workspace);
    for (const block of workspace.getTopBlocks(true)) {
      if (
        block.type === 'z1_setup_hat' ||
        block.type === 'z1_loop_hat' ||
        block.type === 'procedures_defnoreturn' ||
        block.type === 'procedures_defreturn'
      ) {
        this.blockToCode(block);
      }
    }
    return this.finish('');
  }

  /** Assemble the final sketch from the state collected while generating. */
  override finish(_code: string): string {
    const sections: string[] = ['// Generated from blocks — ZERO1 Smart Board Simulator'];

    const includes = OBJECTS.filter((o) => this.objects.has(o.name)).flatMap((o) => o.includes);
    if (includes.length) sections.push(includes.map((h) => `#include <${h}>`).join('\n'));

    const pinLines = PINS.filter((p) => this.pins.has(p.name) && p.value !== null).map(
      (p) => `const int ${p.name} = ${p.value};  // ${p.comment}`,
    );
    if (pinLines.length) sections.push(pinLines.join('\n'));

    const objectLines = OBJECTS.filter((o) => this.objects.has(o.name)).map((o) => o.declaration);
    if (objectLines.length) sections.push(objectLines.join('\n'));

    const variableLines = this.globalVariableLines();
    if (variableLines.length) sections.push(variableLines.join('\n'));

    for (const name of HELPER_ORDER) if (this.helpers.has(name)) sections.push(HELPERS[name]);
    sections.push(...this.functionParts);

    const setupLines: string[] = [];
    if (this.serialUsed) setupLines.push('Serial.begin(9600);');
    for (const p of PINS) if (this.pins.has(p.name) && p.mode === 'OUTPUT') setupLines.push(`pinMode(${p.name}, OUTPUT);`);
    for (const p of PINS) if (this.pins.has(p.name) && p.mode === 'INPUT') setupLines.push(`pinMode(${p.name}, INPUT);`);
    for (const name of OBJECT_SETUP_ORDER) {
      if (this.objects.has(name)) setupLines.push(...OBJECTS.find((o) => o.name === name)!.setup);
    }
    let setupBody = setupLines.map((l) => this.INDENT + l + '\n').join('');
    const userSetup = this.setupParts.join('');
    if (userSetup) setupBody += (setupBody ? '\n' : '') + userSetup;
    sections.push(`void setup() {\n${setupBody}}`);
    sections.push(`void loop() {\n${this.loopParts.join('')}}`);

    return sections.join('\n\n').replace(/[ \t]+\n/g, '\n') + '\n';
  }

  /** Statement chaining: the code of a block is followed by the code of the next block. */
  override scrub_(block: Blockly.Block, code: string, thisOnly = false): string {
    let result = code;
    if (!block.outputConnection) {
      const comment = block.getCommentText();
      if (comment) result = comment.split('\n').map((line) => `// ${line.trim()}\n`).join('') + result;
    }
    if (thisOnly) return result;
    const next = block.nextConnection?.targetBlock() ?? null;
    return result + this.blockToCode(next);
  }

  /** Orphan values never reach the sketch. */
  override scrubNakedValue(_line: string): string {
    return '';
  }

  // ---- helpers for the per-block generators --------------------------------

  /** The types inferred for the current workspace. */
  get types(): TypingResult {
    if (!this.typing) throw new Error('ArduinoGenerator.init() must run before generating code');
    return this.typing;
  }

  /** Declare that the sketch uses a pin (adds the constant and its pinMode line). */
  usePin(name: PinName): string {
    this.pins.add(name);
    return name;
  }

  /** Declare that the sketch uses a library object (adds include, declaration and init lines). */
  useObject(name: ObjectName): string {
    this.objects.add(name);
    if (name === 'servo') this.usePin('SERVO_PIN');
    if (name === 'dht') this.usePin('DHT_PIN');
    if (name === 'pixels') this.usePin('RGB_PIN');
    return name;
  }

  /** Declare that the sketch prints or reads on Serial (adds `Serial.begin(9600)`). */
  useSerial(): void {
    this.serialUsed = true;
  }

  /** Declare that the sketch needs a helper function; returns its name. */
  useHelper(name: HelperName): string {
    this.helpers.add(name);
    switch (name) {
      case 'showDigit':
        this.helpers.add('showSegments');
      // fall through
      case 'showSegments':
        this.usePin('SEG_DATA');
        this.usePin('SEG_LATCH');
        this.usePin('SEG_CLOCK');
        break;
      case 'readDistanceCm':
        this.usePin('TRIG_PIN');
        this.usePin('ECHO_PIN');
        break;
      case 'readLine':
        this.useSerial();
        break;
      default:
        break;
    }
    return name;
  }

  /** Add the statements of a `z1_setup_hat` to `setup()`. */
  addSetupCode(code: string): void {
    this.setupParts.push(code);
  }

  /** Add the statements of a `z1_loop_hat` to `loop()`. */
  addLoopCode(code: string): void {
    this.loopParts.push(code);
  }

  /** Add a user function definition (emitted before `setup()`). */
  addFunction(code: string): void {
    this.functionParts.push(code);
  }

  /**
   * Code of a value input, or the default for its check type (`0`, `""` or
   * `false`) when nothing is connected.
   */
  value(block: Blockly.Block, name: string, order: Order, fallback?: string): string {
    const code = this.valueToCode(block, name, order);
    if (code) return code;
    if (fallback !== undefined) return fallback;
    const check = block.getInput(name)?.connection?.getCheck() ?? null;
    if (check?.includes('String')) return '""';
    if (check?.includes('Boolean')) return 'false';
    return '0';
  }

  /**
   * Code of a Boolean input written inside `if (…)` / `while (…)`: the
   * parentheses that some value blocks carry (`(digitalRead(BUTTON_1) == HIGH)`)
   * would be doubled, so a redundant outer pair is dropped.
   */
  condition(block: Blockly.Block, name: string): string {
    return stripOuterParentheses(this.value(block, name, Order.NONE, 'false'));
  }

  /** The block connected to a value input, if any. */
  inputBlock(block: Blockly.Block, name: string): Blockly.Block | null {
    return block.getInputTargetBlock(name);
  }

  /** A `math_number` literal connected to the input, or null when the input holds anything else. */
  literalNumber(block: Blockly.Block, name: string): number | null {
    const target = block.getInputTargetBlock(name);
    if (!target || target.type !== 'math_number') return null;
    const n = Number(target.getFieldValue('NUM'));
    return Number.isFinite(n) ? n : null;
  }

  /** A C string literal with escapes. */
  quote(text: string): string {
    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }

  /** Sanitised C name of the variable selected in a `VAR` field. */
  variableName(block: Blockly.Block, field = 'VAR'): string {
    return this.getVariableName(this.variableId(block, field));
  }

  /** Id of the variable selected in a `VAR` field. */
  variableId(block: Blockly.Block, field = 'VAR'): string {
    const f = block.getField(field);
    const variable = f instanceof Blockly.FieldVariable ? f.getVariable() : null;
    return variable ? variable.getId() : String(block.getFieldValue(field));
  }

  /** C type of the variable selected in a `VAR` field. */
  variableType(block: Blockly.Block, field = 'VAR'): CType {
    return this.types.variables.get(this.variableId(block, field)) ?? 'int';
  }

  /**
   * Name of the local counter of a `controls_repeat_ext` block: `i` for the
   * outermost loop, `j`, `k` for nested ones, then `i2`, `j2`, …; names taken
   * by user variables are skipped.
   */
  repeatCounter(block: Blockly.Block): string {
    let depth = 0;
    for (let parent = block.getSurroundParent(); parent; parent = parent.getSurroundParent()) {
      if (parent.type === 'controls_repeat_ext') depth++;
    }
    let index = 0;
    for (let round = 1; ; round++) {
      for (const base of REPEAT_COUNTER_BASES) {
        const name = round === 1 ? base : `${base}${round}`;
        if (this.userNames.has(name)) continue;
        if (index === depth) return name;
        index++;
      }
    }
  }

  /** Declarations of the global variables (every used variable that is not only a function parameter). */
  private globalVariableLines(): string[] {
    const workspace = this.workspace;
    if (!workspace) return [];
    const allBlocks = workspace.getAllBlocks(false);
    const definitions = allBlocks.filter((b) => b.type === 'procedures_defnoreturn' || b.type === 'procedures_defreturn');
    const paramIds = new Set<string>();
    for (const def of definitions) for (const v of def.getVarModels()) paramIds.add(v.getId());

    const lines: string[] = [];
    for (const variable of Blockly.Variables.allUsedVarModels(workspace)) {
      const id = variable.getId();
      if (paramIds.has(id)) {
        // Skip a parameter unless it is also used outside the function(s) that
        // declare it. (Call blocks list the parameters too; they do not count.)
        const usedElsewhere = allBlocks.some((b) => {
          if (b.type === 'procedures_callnoreturn' || b.type === 'procedures_callreturn') return false;
          if (!b.getVarModels().some((v) => v.getId() === id)) return false;
          const root = b.getRootBlock();
          if (root.type !== 'procedures_defnoreturn' && root.type !== 'procedures_defreturn') return true;
          return !root.getVarModels().some((v) => v.getId() === id);
        });
        if (!usedElsewhere) continue;
      }
      const type = this.types.variables.get(id) ?? 'int';
      lines.push(`${type} ${this.getVariableName(id)} = ${defaultValue(type)};`);
    }
    return lines;
  }
}
