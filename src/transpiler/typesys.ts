/**
 * Static types tracked by the code generator (docs/ARCHITECTURE.md §4.4 rule 4).
 *
 * The generated JavaScript has one number type, so the transpiler keeps a C++
 * static type for every expression to decide where integer division, width
 * wrapping and char/float boxing must be inserted.
 */
import type { TypeSpec } from './ast';

export type IntTypeName =
  | 'char'
  | 'unsigned char'
  | 'short'
  | 'unsigned short'
  | 'int'
  | 'unsigned int'
  | 'long'
  | 'unsigned long'
  | 'long long'
  | 'unsigned long long';

export type StaticType =
  | { kind: 'int'; name: IntTypeName }
  | { kind: 'float'; name: 'float' | 'double' }
  | { kind: 'bool' }
  | { kind: 'string' } // Arduino String (a JS string)
  | { kind: 'cstring' } // char* / string literal (a JS string)
  | { kind: 'array'; elem: StaticType; dims: number }
  | { kind: 'class'; name: string }
  | { kind: 'void' }
  | { kind: 'unknown' };

export const T = {
  char: { kind: 'int', name: 'char' } as StaticType,
  uchar: { kind: 'int', name: 'unsigned char' } as StaticType,
  int: { kind: 'int', name: 'int' } as StaticType,
  uint: { kind: 'int', name: 'unsigned int' } as StaticType,
  long: { kind: 'int', name: 'long' } as StaticType,
  ulong: { kind: 'int', name: 'unsigned long' } as StaticType,
  float: { kind: 'float', name: 'float' } as StaticType,
  double: { kind: 'float', name: 'double' } as StaticType,
  bool: { kind: 'bool' } as StaticType,
  string: { kind: 'string' } as StaticType,
  cstring: { kind: 'cstring' } as StaticType,
  void: { kind: 'void' } as StaticType,
  unknown: { kind: 'unknown' } as StaticType,
} as const;

/** Names the transpiler treats as plain `int` (enums declared in the sketch are added at runtime). */
export function typeFromName(name: string, enumNames: ReadonlySet<string>): StaticType {
  switch (name) {
    case 'bool':
      return T.bool;
    case 'char':
    case 'unsigned char':
    case 'short':
    case 'unsigned short':
    case 'int':
    case 'unsigned int':
    case 'long':
    case 'unsigned long':
    case 'long long':
    case 'unsigned long long':
      return { kind: 'int', name };
    case 'float':
    case 'double':
      return { kind: 'float', name };
    case 'String':
      return T.string;
    case 'void':
      return T.void;
    default:
      if (enumNames.has(name)) return T.int;
      return { kind: 'class', name };
  }
}

/** Static type of a declared entity (variable, parameter, return value). */
export function typeFromSpec(spec: TypeSpec, arrayDims: number, enumNames: ReadonlySet<string>): StaticType {
  let base = typeFromName(spec.name, enumNames);
  if (spec.pointer > 0) {
    if (spec.name === 'char' && spec.pointer === 1) base = T.cstring;
    else base = T.unknown; // rejected by codegen
  }
  if (arrayDims > 0) return { kind: 'array', elem: base, dims: arrayDims };
  return base;
}

export function isInt(t: StaticType): boolean {
  return t.kind === 'int';
}

export function isIntegral(t: StaticType): boolean {
  return t.kind === 'int' || t.kind === 'bool';
}

export function isFloat(t: StaticType): boolean {
  return t.kind === 'float';
}

export function isNumeric(t: StaticType): boolean {
  return t.kind === 'int' || t.kind === 'float' || t.kind === 'bool';
}

export function isChar(t: StaticType): boolean {
  return t.kind === 'int' && t.name === 'char';
}

export function isStringLike(t: StaticType): boolean {
  return t.kind === 'string' || t.kind === 'cstring';
}

export function isCharArray(t: StaticType): boolean {
  return t.kind === 'array' && t.dims === 1 && isChar(t.elem);
}

export function isUnsigned(t: StaticType): boolean {
  return t.kind === 'int' && t.name.startsWith('unsigned');
}

/** Bit width of an integer type on the AVR. */
export function bitWidth(t: StaticType): number {
  if (t.kind !== 'int') return 0;
  switch (t.name) {
    case 'char':
    case 'unsigned char':
      return 8;
    case 'short':
    case 'unsigned short':
    case 'int':
    case 'unsigned int':
      return 16;
    default:
      return 32;
  }
}

function rank(t: StaticType): number {
  if (t.kind !== 'int') return 0;
  switch (t.name) {
    case 'long long':
    case 'unsigned long long':
      return 4;
    case 'long':
    case 'unsigned long':
      return 3;
    default:
      return 2; // everything narrower than int promotes to int
  }
}

/** Integer promotion: char/short/bool become int. */
export function promote(t: StaticType): StaticType {
  if (t.kind === 'bool') return T.int;
  if (t.kind === 'int' && rank(t) === 2 && t.name !== 'int' && t.name !== 'unsigned int') return T.int;
  return t;
}

/** C "usual arithmetic conversions" for a binary arithmetic/bitwise operator. */
export function arithResult(a: StaticType, b: StaticType): StaticType {
  if (a.kind === 'float' || b.kind === 'float') return T.double;
  if (a.kind === 'unknown' || b.kind === 'unknown') return T.unknown;
  if (!isIntegral(a) || !isIntegral(b)) return T.unknown;
  const pa = promote(a);
  const pb = promote(b);
  const ra = rank(pa);
  const rb = rank(pb);
  const hi = ra >= rb ? pa : pb;
  const lo = ra >= rb ? pb : pa;
  const unsigned = isUnsigned(hi) || (ra === rb && isUnsigned(lo));
  const baseName = (hi as { name: IntTypeName }).name.replace(/^unsigned /, '') as IntTypeName;
  return { kind: 'int', name: (unsigned ? `unsigned ${baseName}` : baseName) as IntTypeName };
}

/** Result type of `?:`. */
export function commonType(a: StaticType, b: StaticType): StaticType {
  if (a.kind === 'string' || b.kind === 'string') return T.string;
  if (a.kind === 'cstring' && b.kind === 'cstring') return T.cstring;
  if (isNumeric(a) && isNumeric(b)) return arithResult(a, b);
  if (a.kind === b.kind) return a;
  return T.unknown;
}

/** Name of the `__rt` helper that stores a value into a variable of type `t`, or null when no coercion applies. */
export function wrapHelper(t: StaticType): string | null {
  switch (t.kind) {
    case 'bool':
      return '__bool';
    case 'float':
      return '__f32';
    case 'int':
      switch (t.name) {
        case 'char':
          return '__i8';
        case 'unsigned char':
          return '__u8';
        case 'short':
        case 'int':
          return '__i16';
        case 'unsigned short':
        case 'unsigned int':
          return '__u16';
        case 'long':
        case 'long long':
          return '__i32';
        default:
          return '__u32';
      }
    default:
      return null;
  }
}

/** sizeof() in bytes on the AVR. */
export function sizeOf(t: StaticType): number {
  switch (t.kind) {
    case 'bool':
      return 1;
    case 'int':
      return bitWidth(t) / 8;
    case 'float':
      return 4;
    case 'string':
      return 6;
    case 'cstring':
      return 2;
    case 'array':
      return 0; // computed by codegen from the declared dimensions
    case 'class':
      return 1;
    default:
      return 2;
  }
}

/** Conversion kind passed to `__str()` when the value is concatenated to a String. */
export function printKind(t: StaticType): 'int' | 'float' | 'char' | 'bool' | 'string' | 'unknown' {
  switch (t.kind) {
    case 'int':
      return t.name === 'char' ? 'char' : 'int';
    case 'float':
      return 'float';
    case 'bool':
      return 'bool';
    case 'string':
    case 'cstring':
      return 'string';
    default:
      return 'unknown';
  }
}

/** JS default value for an uninitialised variable of type `t`. */
export function defaultValue(t: StaticType): string {
  switch (t.kind) {
    case 'bool':
      return 'false';
    case 'string':
    case 'cstring':
      return '""';
    case 'int':
    case 'float':
      return '0';
    default:
      return 'undefined';
  }
}

export function describeType(t: StaticType): string {
  switch (t.kind) {
    case 'int':
    case 'float':
      return t.name;
    case 'array':
      return `${describeType(t.elem)}${'[]'.repeat(t.dims)}`;
    case 'class':
      return t.name;
    case 'cstring':
      return 'char*';
    case 'string':
      return 'String';
    default:
      return t.kind;
  }
}
