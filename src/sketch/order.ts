/**
 * C++ operator precedence for generated expressions, shared by the Blocks generator
 * (docs/BLOCKS.md §11.3) and the Python translator (docs/PYTHON.md §4.2, §4.7 E1). Blockly-free,
 * so src/python can use it without loading Blockly.
 */

/**
 * C operator precedence for the generated expressions (lower binds tighter).
 * `valueToCode` adds parentheses only where the outer operator binds at least
 * as tightly as the inner one.
 */
export enum Order {
  ATOMIC = 0,
  UNARY_POSTFIX = 1,
  UNARY_PREFIX = 2,
  MULTIPLICATIVE = 3,
  ADDITIVE = 4,
  SHIFT = 5,
  RELATIONAL = 6,
  EQUALITY = 7,
  BITWISE_AND = 8,
  BITWISE_XOR = 9,
  BITWISE_OR = 10,
  LOGICAL_AND = 11,
  LOGICAL_OR = 12,
  CONDITIONAL = 13,
  ASSIGNMENT = 14,
  NONE = 99,
}
