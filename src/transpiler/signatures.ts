/**
 * What the code generator knows about the runtime (docs/ARCHITECTURE.md §4.5):
 * return types of core functions and library methods, types of constants,
 * class names, and a few special cases.
 */
import { T, type StaticType } from './typesys';

/** Return type rule for a core function: a fixed type, the type of the first argument, or the common type of all arguments. */
export type ReturnRule = StaticType | 'firstArg' | 'common';

export const CORE_RETURN: Readonly<Record<string, ReturnRule>> = {
  digitalRead: T.int,
  analogRead: T.int,
  millis: T.ulong,
  micros: T.ulong,
  pulseIn: T.ulong,
  pulseInLong: T.ulong,
  map: T.long,
  random: T.long,
  constrain: 'firstArg',
  min: 'common',
  max: 'common',
  abs: 'firstArg',
  sq: 'firstArg',
  sqrt: T.double,
  pow: T.double,
  sin: T.double,
  cos: T.double,
  tan: T.double,
  asin: T.double,
  acos: T.double,
  atan: T.double,
  atan2: T.double,
  exp: T.double,
  log: T.double,
  log10: T.double,
  floor: T.double,
  ceil: T.double,
  round: T.long,
  fabs: T.double,
  fmod: T.double,
  trunc: T.double,
  radians: T.double,
  degrees: T.double,
  shiftIn: T.uchar,
  bit: T.long,
  bitRead: T.int,
  lowByte: T.uchar,
  highByte: T.uchar,
  word: T.uint,
  isDigit: T.bool,
  isAlpha: T.bool,
  isAlphaNumeric: T.bool,
  isSpace: T.bool,
  isWhitespace: T.bool,
  isUpperCase: T.bool,
  isLowerCase: T.bool,
  isPunct: T.bool,
  isPrintable: T.bool,
  isGraph: T.bool,
  isControl: T.bool,
  isAscii: T.bool,
  isHexadecimalDigit: T.bool,
  isnan: T.bool,
  isinf: T.bool,
  isfinite: T.bool,
  toUpperCase: T.char,
  toLowerCase: T.char,
  toAscii: T.char,
  strlen: T.uint,
  strcmp: T.int,
  strncmp: T.int,
  strstr: T.int,
  atoi: T.int,
  atol: T.long,
  atof: T.double,
  sprintf: T.int,
  snprintf: T.int,
  dtostrf: T.cstring,
  itoa: T.cstring,
  ltoa: T.cstring,
  strcpy: T.cstring,
  strncpy: T.cstring,
  strcat: T.cstring,
  String: T.string,
  digitalPinToInterrupt: T.int,
  F: T.cstring,
};

/** Return types of library/object methods, keyed by method name (receiver-independent). */
export const METHOD_RETURN: Readonly<Record<string, StaticType>> = {
  available: T.int,
  read: T.int,
  peek: T.int,
  readString: T.string,
  readStringUntil: T.string,
  substring: T.string,
  parseInt: T.long,
  toInt: T.long,
  parseFloat: T.float,
  toFloat: T.float,
  toDouble: T.float,
  print: T.uint,
  println: T.uint,
  write: T.uint,
  length: T.uint,
  indexOf: T.int,
  lastIndexOf: T.int,
  compareTo: T.int,
  charAt: T.char,
  equals: T.bool,
  equalsIgnoreCase: T.bool,
  startsWith: T.bool,
  endsWith: T.bool,
  isEmpty: T.bool,
  attached: T.bool,
  readTemperature: T.float,
  readHumidity: T.float,
  computeHeatIndex: T.float,
  convertCtoF: T.float,
  convertFtoC: T.float,
  Color: T.ulong,
  ColorHSV: T.ulong,
  gamma32: T.ulong,
  getPixelColor: T.ulong,
  gamma8: T.uchar,
  sine8: T.uchar,
  numPixels: T.uint,
  getBrightness: T.uchar,
  ping: T.ulong,
  ping_median: T.ulong,
  ping_cm: T.uint,
  ping_in: T.uint,
  convert_cm: T.uint,
  convert_in: T.uint,
  endTransmission: T.uchar,
  requestFrom: T.uchar,
  readMicroseconds: T.int,
  readBytes: T.uint,
  readBytesUntil: T.uint,
  find: T.bool,
  canShow: T.bool,
  c_str: T.cstring,
};

/** Constants exposed by the runtime and their types. */
export const CONSTANT_TYPES: Readonly<Record<string, StaticType>> = Object.fromEntries([
  ...[
    'HIGH',
    'LOW',
    'INPUT',
    'OUTPUT',
    'INPUT_PULLUP',
    'A0',
    'A1',
    'A2',
    'A3',
    'A4',
    'A5',
    'LED_BUILTIN',
    'DEC',
    'HEX',
    'OCT',
    'BIN',
    'MSBFIRST',
    'LSBFIRST',
    'CHANGE',
    'RISING',
    'FALLING',
    'SDA',
    'SCL',
    'NULL',
    'NOT_AN_INTERRUPT',
    'DHT11',
    'DHT12',
    'DHT21',
    'DHT22',
    'AM2301',
    'NEO_RGB',
    'NEO_GRB',
    'NEO_RGBW',
    'NEO_BRG',
    'NEO_RBG',
    'NEO_GBR',
    'NEO_BGR',
    'NEO_KHZ800',
    'NEO_KHZ400',
  ].map((n) => [n, T.int] as const),
  ['F_CPU', T.ulong] as const,
  ...['PI', 'HALF_PI', 'TWO_PI', 'DEG_TO_RAD', 'RAD_TO_DEG', 'EULER'].map((n) => [n, T.double] as const),
]);

/** Runtime objects that exist without a declaration. */
export const GLOBAL_OBJECTS: Readonly<Record<string, StaticType>> = {
  Serial: { kind: 'class', name: 'HardwareSerial' },
  Wire: { kind: 'class', name: 'TwoWire' },
};

/** Library classes the sketch may construct with `Type name(args)` or `Type(args)`. */
export const KNOWN_CLASSES: ReadonlySet<string> = new Set([
  'Servo',
  'LiquidCrystal_I2C',
  'LiquidCrystal',
  'DHT',
  'Adafruit_NeoPixel',
  'NewPing',
]);

/** Method names that, on a String receiver, produce a new value the variable must be reassigned to. */
export const STRING_MUTATORS: ReadonlySet<string> = new Set([
  'toUpperCase',
  'toLowerCase',
  'trim',
  'replace',
  'remove',
  'concat',
  'setCharAt',
]);

/** Callee names for which float arguments are boxed with `__flt` (printing semantics). */
export const FLOAT_BOXING_CALLEES: ReadonlySet<string> = new Set(['print', 'println', 'String', 'write']);

/** Runtime functions that write into a char array argument and therefore need the raw array. */
export const RAW_CHAR_ARRAY_CALLEES: ReadonlySet<string> = new Set([
  'sprintf',
  'snprintf',
  'strcpy',
  'strncpy',
  'strcat',
  'itoa',
  'ltoa',
  'dtostrf',
  'readBytes',
  'readBytesUntil',
  'toCharArray',
  'getBytes',
  'memset',
  'memcpy',
]);

/** Arduino bit macros that modify their first argument in place. */
export const BIT_MACROS: ReadonlySet<string> = new Set(['bitSet', 'bitClear', 'bitWrite', 'bitToggle']);

/** UNO pins with hardware PWM, for the analogWrite warning. */
export const PWM_PIN_NUMBERS: ReadonlySet<number> = new Set([3, 5, 6, 9, 10, 11]);

/**
 * Every name the runtime exposes through `__rt` (core API, constants, library
 * objects/classes/functions). An identifier that is neither declared in the
 * sketch nor listed here is reported as "was not declared in this scope" at
 * transpile time, like the Arduino compiler would.
 */
export const KNOWN_RUNTIME_NAMES: ReadonlySet<string> = new Set([
  // core functions
  'pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite', 'analogReference',
  'delay', 'delayMicroseconds', 'millis', 'micros', 'yield', 'tone', 'noTone', 'pulseIn', 'pulseInLong',
  'shiftOut', 'shiftIn', 'map', 'constrain', 'min', 'max', 'abs', 'fabs', 'sq', 'pow', 'sqrt',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'log10', 'floor', 'ceil', 'trunc',
  'fmod', 'round', 'radians', 'degrees', 'isnan', 'isinf', 'isfinite', 'random', 'randomSeed',
  'bit', 'bitRead', 'lowByte', 'highByte', 'word', 'isDigit', 'isAlpha', 'isAlphaNumeric', 'isSpace',
  'isWhitespace', 'isUpperCase', 'isLowerCase', 'isPunct', 'isPrintable', 'isGraph', 'isControl',
  'isAscii', 'isHexadecimalDigit', 'toUpperCase', 'toLowerCase', 'toAscii', 'interrupts', 'noInterrupts',
  'attachInterrupt', 'detachInterrupt', 'digitalPinToInterrupt', 'F',
  // core constants
  'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'LED_BUILTIN',
  'DEC', 'HEX', 'OCT', 'BIN', 'MSBFIRST', 'LSBFIRST', 'CHANGE', 'FALLING', 'RISING', 'NOT_AN_INTERRUPT',
  'SDA', 'SCL', 'NULL', 'PI', 'HALF_PI', 'TWO_PI', 'DEG_TO_RAD', 'RAD_TO_DEG', 'EULER', 'F_CPU',
  'DEFAULT', 'EXTERNAL', 'INTERNAL', 'INT_MAX', 'INT_MIN', 'UINT_MAX', 'LONG_MAX', 'LONG_MIN', 'ULONG_MAX',
  'NAN', 'INFINITY',
  // libraries
  'Serial', 'String', 'strlen', 'strcpy', 'strncpy', 'strcat', 'strcmp', 'strncmp', 'strstr', 'atoi', 'atol',
  'atof', 'itoa', 'ltoa', 'dtostrf', 'sprintf', 'snprintf', 'Servo', 'LiquidCrystal_I2C', 'LiquidCrystal',
  'DHT', 'DHT11', 'DHT12', 'DHT21', 'DHT22', 'AM2301', 'Adafruit_NeoPixel', 'NEO_RGB', 'NEO_GRB', 'NEO_RGBW',
  'NEO_BRG', 'NEO_RBG', 'NEO_GBR', 'NEO_BGR', 'NEO_KHZ800', 'NEO_KHZ400', 'NewPing', 'Wire',
]);

/** Compile-time values of runtime constants (used for warnings and array sizes). */
export const CONSTANT_VALUES: Readonly<Record<string, number>> = {
  HIGH: 1,
  LOW: 0,
  INPUT: 0,
  OUTPUT: 1,
  INPUT_PULLUP: 2,
  A0: 14,
  A1: 15,
  A2: 16,
  A3: 17,
  A4: 18,
  A5: 19,
  LED_BUILTIN: 13,
  DEC: 10,
  HEX: 16,
  OCT: 8,
  BIN: 2,
  MSBFIRST: 1,
  LSBFIRST: 0,
  SDA: 18,
  SCL: 19,
  NULL: 0,
};
