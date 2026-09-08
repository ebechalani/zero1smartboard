/**
 * Arduino code for the standard Blockly blocks the toolbox offers
 * (logic, loops, math, text, variables, functions — docs/BLOCKS.md §11.2).
 */
import type * as Blockly from 'blockly';
import { Order, defaultValue, formatNumber, type ArduinoGenerator } from './generator';

type Block = Blockly.Block;
type Value = [string, Order];

/** Install the `forBlock` entries for the standard blocks on a generator. */
export function installBuiltinGenerators(g: ArduinoGenerator): void {
  const f = g.forBlock;

  // --- Logic -----------------------------------------------------------------

  f['controls_if'] = (block: Block, gen: ArduinoGenerator): string => {
    let code = '';
    for (let n = 0; block.getInput(`IF${n}`); n++) {
      const condition = gen.value(block, `IF${n}`, Order.NONE, 'false');
      const branch = gen.statementToCode(block, `DO${n}`);
      code += `${n === 0 ? 'if' : ' else if'} (${condition}) {\n${branch}}`;
    }
    if (block.getInput('ELSE')) {
      code += ` else {\n${gen.statementToCode(block, 'ELSE')}}`;
    }
    return code + '\n';
  };

  f['logic_compare'] = (block: Block, gen: ArduinoGenerator): Value => {
    const operators: Record<string, string> = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
    const op = operators[String(block.getFieldValue('OP'))] ?? '==';
    const order = op === '==' || op === '!=' ? Order.EQUALITY : Order.RELATIONAL;
    const a = gen.value(block, 'A', order, '0');
    const b = gen.value(block, 'B', order, '0');
    return [`${a} ${op} ${b}`, order];
  };

  f['logic_operation'] = (block: Block, gen: ArduinoGenerator): Value => {
    const and = block.getFieldValue('OP') === 'AND';
    const order = and ? Order.LOGICAL_AND : Order.LOGICAL_OR;
    const a = gen.value(block, 'A', order, 'false');
    const b = gen.value(block, 'B', order, 'false');
    return [`${a} ${and ? '&&' : '||'} ${b}`, order];
  };

  f['logic_negate'] = (block: Block, gen: ArduinoGenerator): Value => {
    return [`!${gen.value(block, 'BOOL', Order.UNARY_PREFIX, 'false')}`, Order.UNARY_PREFIX];
  };

  f['logic_boolean'] = (block: Block): Value => {
    return [block.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', Order.ATOMIC];
  };

  f['logic_ternary'] = (block: Block, gen: ArduinoGenerator): Value => {
    const condition = gen.value(block, 'IF', Order.CONDITIONAL, 'false');
    const a = gen.value(block, 'THEN', Order.CONDITIONAL, '0');
    const b = gen.value(block, 'ELSE', Order.CONDITIONAL, '0');
    return [`${condition} ? ${a} : ${b}`, Order.CONDITIONAL];
  };

  // --- Loops -----------------------------------------------------------------

  f['controls_repeat_ext'] = (block: Block, gen: ArduinoGenerator): string => {
    const times = gen.value(block, 'TIMES', Order.RELATIONAL, '0');
    const counter = gen.repeatCounter(block);
    const body = gen.statementToCode(block, 'DO');
    return `for (int ${counter} = 0; ${counter} < ${times}; ${counter}++) {\n${body}}\n`;
  };

  f['controls_whileUntil'] = (block: Block, gen: ArduinoGenerator): string => {
    const until = block.getFieldValue('MODE') === 'UNTIL';
    let condition = gen.value(block, 'BOOL', until ? Order.UNARY_PREFIX : Order.NONE, 'false');
    if (until) condition = `!${condition}`;
    const body = gen.statementToCode(block, 'DO');
    return `while (${condition}) {\n${body}}\n`;
  };

  f['controls_for'] = (block: Block, gen: ArduinoGenerator): string => {
    const variable = gen.variableName(block);
    const from = gen.value(block, 'FROM', Order.ASSIGNMENT, '0');
    const to = gen.value(block, 'TO', Order.RELATIONAL, '0');
    const literalStep = gen.literalNumber(block, 'BY');
    const body = gen.statementToCode(block, 'DO');
    let compare: string;
    let update: string;
    if (literalStep !== null && literalStep < 0) {
      const step = formatNumber(-literalStep);
      compare = `${variable} >= ${to}`;
      update = step === '1' ? `${variable}--` : `${variable} -= ${step}`;
    } else {
      const step = literalStep !== null ? formatNumber(literalStep) : gen.value(block, 'BY', Order.ASSIGNMENT, '1');
      compare = `${variable} <= ${to}`;
      update = step === '1' ? `${variable}++` : `${variable} += ${step}`;
    }
    return `for (${variable} = ${from}; ${compare}; ${update}) {\n${body}}\n`;
  };

  f['controls_flow_statements'] = (block: Block): string => {
    return block.getFieldValue('FLOW') === 'CONTINUE' ? 'continue;\n' : 'break;\n';
  };

  // --- Math ------------------------------------------------------------------

  f['math_number'] = (block: Block): Value => {
    const code = formatNumber(block.getFieldValue('NUM'));
    return [code, code.startsWith('-') ? Order.UNARY_PREFIX : Order.ATOMIC];
  };

  f['math_arithmetic'] = (block: Block, gen: ArduinoGenerator): Value => {
    const op = String(block.getFieldValue('OP'));
    if (op === 'POWER') {
      const a = gen.value(block, 'A', Order.NONE, '0');
      const b = gen.value(block, 'B', Order.NONE, '0');
      return [`pow(${a}, ${b})`, Order.UNARY_POSTFIX];
    }
    const operators: Record<string, [string, Order]> = {
      ADD: ['+', Order.ADDITIVE],
      MINUS: ['-', Order.ADDITIVE],
      MULTIPLY: ['*', Order.MULTIPLICATIVE],
      DIVIDE: ['/', Order.MULTIPLICATIVE],
    };
    const [symbol, order] = operators[op] ?? operators['ADD']!;
    const a = gen.value(block, 'A', order, '0');
    let b = gen.value(block, 'B', order, '0');
    if (symbol === '-' && b.startsWith('-')) b = ` ${b}`; // avoid "--"
    return [`${a} ${symbol} ${b}`, order];
  };

  f['math_single'] = (block: Block, gen: ArduinoGenerator): Value => {
    const op = String(block.getFieldValue('OP'));
    if (op === 'NEG') {
      let arg = gen.value(block, 'NUM', Order.UNARY_PREFIX, '0');
      if (arg.startsWith('-')) arg = ` ${arg}`; // avoid "--"
      return [`-${arg}`, Order.UNARY_PREFIX];
    }
    const arg = gen.value(block, 'NUM', Order.NONE, '0');
    const functions: Record<string, string> = { ROOT: 'sqrt', ABS: 'abs', LN: 'log', LOG10: 'log10', EXP: 'exp' };
    if (op === 'POW10') return [`pow(10, ${arg})`, Order.UNARY_POSTFIX];
    return [`${functions[op] ?? 'abs'}(${arg})`, Order.UNARY_POSTFIX];
  };

  f['math_trig'] = (block: Block, gen: ArduinoGenerator): Value => {
    const op = String(block.getFieldValue('OP'));
    const arg = gen.value(block, 'NUM', Order.NONE, '0');
    const name = op.toLowerCase();
    if (op === 'SIN' || op === 'COS' || op === 'TAN') return [`${name}(radians(${arg}))`, Order.UNARY_POSTFIX];
    return [`degrees(${name}(${arg}))`, Order.UNARY_POSTFIX];
  };

  f['math_constant'] = (block: Block): Value => {
    switch (block.getFieldValue('CONSTANT')) {
      case 'E':
        return ['EULER', Order.ATOMIC];
      case 'GOLDEN_RATIO':
        return ['1.61803398875', Order.ATOMIC];
      case 'SQRT2':
        return ['sqrt(2)', Order.UNARY_POSTFIX];
      case 'SQRT1_2':
        return ['sqrt(0.5)', Order.UNARY_POSTFIX];
      case 'INFINITY':
        return ['INFINITY', Order.ATOMIC];
      default:
        return ['PI', Order.ATOMIC];
    }
  };

  f['math_number_property'] = (block: Block, gen: ArduinoGenerator): Value => {
    const property = String(block.getFieldValue('PROPERTY'));
    if (property === 'PRIME') {
      const n = gen.value(block, 'NUMBER_TO_CHECK', Order.NONE, '0');
      return [`${gen.useHelper('isPrime')}(${n})`, Order.UNARY_POSTFIX];
    }
    switch (property) {
      case 'EVEN':
        return [`${gen.value(block, 'NUMBER_TO_CHECK', Order.MULTIPLICATIVE, '0')} % 2 == 0`, Order.EQUALITY];
      case 'ODD':
        return [`${gen.value(block, 'NUMBER_TO_CHECK', Order.MULTIPLICATIVE, '0')} % 2 == 1`, Order.EQUALITY];
      case 'WHOLE': {
        const n = gen.value(block, 'NUMBER_TO_CHECK', Order.EQUALITY, '0');
        return [`${n} == (long) ${n}`, Order.EQUALITY];
      }
      case 'POSITIVE':
        return [`${gen.value(block, 'NUMBER_TO_CHECK', Order.RELATIONAL, '0')} > 0`, Order.RELATIONAL];
      case 'NEGATIVE':
        return [`${gen.value(block, 'NUMBER_TO_CHECK', Order.RELATIONAL, '0')} < 0`, Order.RELATIONAL];
      case 'DIVISIBLE_BY': {
        const n = gen.value(block, 'NUMBER_TO_CHECK', Order.MULTIPLICATIVE, '0');
        const divisor = gen.value(block, 'DIVISOR', Order.MULTIPLICATIVE, '1');
        return [`${n} % ${divisor} == 0`, Order.EQUALITY];
      }
      default:
        return ['false', Order.ATOMIC];
    }
  };

  f['math_round'] = (block: Block, gen: ArduinoGenerator): Value => {
    const functions: Record<string, string> = { ROUND: 'round', ROUNDUP: 'ceil', ROUNDDOWN: 'floor' };
    const name = functions[String(block.getFieldValue('OP'))] ?? 'round';
    return [`${name}(${gen.value(block, 'NUM', Order.NONE, '0')})`, Order.UNARY_POSTFIX];
  };

  f['math_modulo'] = (block: Block, gen: ArduinoGenerator): Value => {
    const a = gen.value(block, 'DIVIDEND', Order.MULTIPLICATIVE, '0');
    const b = gen.value(block, 'DIVISOR', Order.MULTIPLICATIVE, '1');
    return [`${a} % ${b}`, Order.MULTIPLICATIVE];
  };

  f['math_constrain'] = (block: Block, gen: ArduinoGenerator): Value => {
    const v = gen.value(block, 'VALUE', Order.NONE, '0');
    const low = gen.value(block, 'LOW', Order.NONE, '0');
    const high = gen.value(block, 'HIGH', Order.NONE, '0');
    return [`constrain(${v}, ${low}, ${high})`, Order.UNARY_POSTFIX];
  };

  f['math_random_int'] = (block: Block, gen: ArduinoGenerator): Value => {
    const a = gen.value(block, 'FROM', Order.NONE, '0');
    const b = gen.value(block, 'TO', Order.ADDITIVE, '0');
    return [`random(${a}, ${b} + 1)`, Order.UNARY_POSTFIX];
  };

  f['math_random_float'] = (): Value => {
    return ['random(0, 1000) / 1000.0', Order.MULTIPLICATIVE];
  };

  // --- Text ------------------------------------------------------------------

  f['text'] = (block: Block, gen: ArduinoGenerator): Value => {
    return [gen.quote(String(block.getFieldValue('TEXT') ?? '')), Order.ATOMIC];
  };

  f['text_join'] = (block: Block, gen: ArduinoGenerator): Value => {
    const count = (block as Block & { itemCount_?: number }).itemCount_ ?? 0;
    const items: string[] = [];
    for (let i = 0; i < count; i++) {
      if (!block.getInputTargetBlock(`ADD${i}`)) continue;
      items.push(`String(${gen.value(block, `ADD${i}`, Order.NONE, '""')})`);
    }
    if (items.length === 0) return ['""', Order.ATOMIC];
    if (items.length === 1) return [items[0]!, Order.UNARY_POSTFIX];
    return [items.join(' + '), Order.ADDITIVE];
  };

  /** A String-typed receiver for `.length()` (string literals are `char*`, so they are wrapped). */
  const stringReceiver = (block: Block, name: string, gen: ArduinoGenerator): string => {
    const target = block.getInputTargetBlock(name);
    if (!target || target.type === 'text') return `String(${gen.value(block, name, Order.NONE, '""')})`;
    return gen.value(block, name, Order.UNARY_POSTFIX, '""');
  };

  f['text_length'] = (block: Block, gen: ArduinoGenerator): Value => {
    return [`${stringReceiver(block, 'VALUE', gen)}.length()`, Order.UNARY_POSTFIX];
  };

  f['text_isEmpty'] = (block: Block, gen: ArduinoGenerator): Value => {
    return [`${stringReceiver(block, 'VALUE', gen)}.length() == 0`, Order.EQUALITY];
  };

  f['text_append'] = (block: Block, gen: ArduinoGenerator): string => {
    const variable = gen.variableName(block);
    const text = gen.value(block, 'TEXT', Order.NONE, '""');
    return `${variable} += String(${text});\n`;
  };

  f['text_changeCase'] = (block: Block, gen: ArduinoGenerator): Value => {
    const helpers = { UPPERCASE: 'toUpper', LOWERCASE: 'toLower', TITLECASE: 'toTitle' } as const;
    const key = String(block.getFieldValue('CASE')) as keyof typeof helpers;
    const helper = gen.useHelper(helpers[key] ?? 'toUpper');
    return [`${helper}(${gen.value(block, 'TEXT', Order.NONE, '""')})`, Order.UNARY_POSTFIX];
  };

  f['text_trim'] = (block: Block, gen: ArduinoGenerator): Value => {
    const helpers = { LEFT: 'trimLeft', RIGHT: 'trimRight', BOTH: 'trimText' } as const;
    const key = String(block.getFieldValue('MODE')) as keyof typeof helpers;
    const helper = gen.useHelper(helpers[key] ?? 'trimText');
    return [`${helper}(${gen.value(block, 'TEXT', Order.NONE, '""')})`, Order.UNARY_POSTFIX];
  };

  // --- Variables -------------------------------------------------------------

  f['variables_get'] = (block: Block, gen: ArduinoGenerator): Value => {
    return [gen.variableName(block), Order.ATOMIC];
  };

  f['variables_set'] = (block: Block, gen: ArduinoGenerator): string => {
    const variable = gen.variableName(block);
    const value = gen.value(block, 'VALUE', Order.ASSIGNMENT, defaultValue(gen.variableType(block)));
    return `${variable} = ${value};\n`;
  };

  f['math_change'] = (block: Block, gen: ArduinoGenerator): string => {
    const variable = gen.variableName(block);
    const delta = gen.value(block, 'DELTA', Order.ASSIGNMENT, '1');
    return `${variable} += ${delta};\n`;
  };

  // --- Functions -------------------------------------------------------------

  const signature = (block: Block, gen: ArduinoGenerator): { name: string; params: string } => {
    const procedureName = String(block.getFieldValue('NAME'));
    const name = gen.getProcedureName(procedureName);
    const types = gen.types.procedures.get(procedureName)?.params ?? [];
    const params = block
      .getVarModels()
      .map((v, i) => `${types[i] ?? 'int'} ${gen.getVariableName(v.getId())}`)
      .join(', ');
    return { name, params };
  };

  f['procedures_defnoreturn'] = (block: Block, gen: ArduinoGenerator): null => {
    const { name, params } = signature(block, gen);
    const body = gen.statementToCode(block, 'STACK');
    gen.addFunction(`void ${name}(${params}) {\n${body}}`);
    return null;
  };

  f['procedures_defreturn'] = (block: Block, gen: ArduinoGenerator): null => {
    const { name, params } = signature(block, gen);
    const procedureName = String(block.getFieldValue('NAME'));
    const type = gen.types.procedures.get(procedureName)?.returnType ?? 'int';
    const returnType = type === 'void' ? 'int' : type;
    const body = gen.statementToCode(block, 'STACK');
    const value = gen.value(block, 'RETURN', Order.NONE, defaultValue(returnType));
    gen.addFunction(`${returnType} ${name}(${params}) {\n${body}${gen.INDENT}return ${value};\n}`);
    return null;
  };

  const callArguments = (block: Block, gen: ArduinoGenerator): string => {
    const procedureName = (block as Block & { getProcedureCall?: () => string }).getProcedureCall?.() ?? String(block.getFieldValue('NAME'));
    const types = gen.types.procedures.get(procedureName)?.params ?? [];
    const args: string[] = [];
    for (let i = 0; block.getInput(`ARG${i}`); i++) {
      args.push(gen.value(block, `ARG${i}`, Order.NONE, defaultValue(types[i] ?? 'int')));
    }
    return args.join(', ');
  };

  const callName = (block: Block, gen: ArduinoGenerator): string => {
    const procedureName = (block as Block & { getProcedureCall?: () => string }).getProcedureCall?.() ?? String(block.getFieldValue('NAME'));
    return gen.getProcedureName(procedureName);
  };

  f['procedures_callnoreturn'] = (block: Block, gen: ArduinoGenerator): string => {
    return `${callName(block, gen)}(${callArguments(block, gen)});\n`;
  };

  f['procedures_callreturn'] = (block: Block, gen: ArduinoGenerator): Value => {
    return [`${callName(block, gen)}(${callArguments(block, gen)})`, Order.UNARY_POSTFIX];
  };

  f['procedures_ifreturn'] = (block: Block, gen: ArduinoGenerator): string => {
    const condition = gen.value(block, 'CONDITION', Order.NONE, 'false');
    const root = block.getRootBlock();
    let statement = 'return;';
    if (root.type === 'procedures_defreturn') {
      const type = gen.types.procedures.get(String(root.getFieldValue('NAME')))?.returnType ?? 'int';
      const fallback = defaultValue(type === 'void' ? 'int' : type);
      statement = block.getInput('VALUE') ? `return ${gen.value(block, 'VALUE', Order.NONE, fallback)};` : `return ${fallback};`;
    }
    return `if (${condition}) {\n${gen.INDENT}${statement}\n}\n`;
  };
}
