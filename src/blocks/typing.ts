/**
 * Variable and procedure type inference for the Arduino generator
 * (docs/BLOCKS.md §11.3, "Variable typing").
 *
 * Blockly variables are untyped; C++ needs a type for every global, every
 * function parameter and every return value. We look at every value assigned
 * to a variable (and every argument passed to a parameter) and pick the
 * smallest C type that can hold all of them:
 *
 *   any String  →  String
 *   all Boolean →  bool
 *   any float   →  float
 *   otherwise   →  int
 *
 * The kind of a value block is its output check plus a *float* hint for
 * blocks that produce fractional numbers. Because `variables_get` and
 * `procedures_callreturn` depend on the result, the inference is iterated to
 * a fixed point (at most 5 passes).
 */
import * as Blockly from 'blockly';

/** Kind of a single value: what a value block produces. */
export type Kind = 'int' | 'float' | 'String' | 'bool';

/** C type of a variable, parameter or return value. */
export type CType = 'int' | 'float' | 'String' | 'bool';

/** Inferred types of the procedures of a workspace. */
export interface ProcedureType {
  /** `void` for `procedures_defnoreturn`. */
  returnType: CType | 'void';
  /** One entry per parameter, in declaration order. */
  params: CType[];
}

/** Result of {@link inferTypes}. */
export interface TypingResult {
  /** C type of every variable of the workspace, keyed by variable id. */
  variables: Map<string, CType>;
  /** Types of every procedure definition, keyed by the (Blockly) procedure name. */
  procedures: Map<string, ProcedureType>;
  /** Kind of any value block of the workspace (`int` for statement blocks). */
  kindOf(block: Blockly.Block): Kind;
}

const MAX_PASSES = 5;

/** Combine the kinds of several values into one C type (see the module comment). */
export function combineKinds(kinds: Iterable<Kind>): CType {
  let any = false;
  let hasString = false;
  let hasFloat = false;
  let allBool = true;
  for (const k of kinds) {
    any = true;
    if (k === 'String') hasString = true;
    if (k === 'float') hasFloat = true;
    if (k !== 'bool') allBool = false;
  }
  if (!any) return 'int';
  if (hasString) return 'String';
  if (allBool) return 'bool';
  if (hasFloat) return 'float';
  return 'int';
}

/** Kind of a block by its output connection check alone. */
function kindFromCheck(block: Blockly.Block): Kind {
  const check = block.outputConnection?.getCheck();
  if (!check) return 'int';
  if (check.includes('String')) return 'String';
  if (check.includes('Boolean')) return 'bool';
  return 'int';
}

function variableIdOf(block: Blockly.Block, field = 'VAR'): string | null {
  const f = block.getField(field);
  const variable = f instanceof Blockly.FieldVariable ? f.getVariable() : null;
  if (variable) return variable.getId();
  const raw = block.getFieldValue(field);
  return typeof raw === 'string' ? raw : null;
}

function procedureNameOf(block: Blockly.Block): string {
  const b = block as Blockly.Block & { getProcedureCall?: () => string; getProcedureDef?: () => [string, string[], boolean] };
  if (b.getProcedureCall) return b.getProcedureCall();
  if (b.getProcedureDef) return b.getProcedureDef()[0];
  return String(block.getFieldValue('NAME') ?? '');
}

function isDefinition(block: Blockly.Block): boolean {
  return block.type === 'procedures_defnoreturn' || block.type === 'procedures_defreturn';
}

/**
 * Infer the C types of every variable and procedure of a workspace.
 * Run once before generating code.
 */
export function inferTypes(workspace: Blockly.Workspace): TypingResult {
  const blocks = workspace.getAllBlocks(false);
  const variables = new Map<string, CType>();
  const procedures = new Map<string, ProcedureType>();

  // Procedure definitions: name → parameter variable ids.
  const definitions = new Map<string, { block: Blockly.Block; paramIds: string[] }>();
  for (const block of blocks) {
    if (!isDefinition(block)) continue;
    const name = procedureNameOf(block);
    const paramIds = block.getVarModels().map((v) => v.getId());
    definitions.set(name, { block, paramIds });
  }

  // Procedure return types (recomputed every pass).
  const returnTypes = new Map<string, CType | 'void'>();
  for (const [name, def] of definitions) returnTypes.set(name, def.block.type === 'procedures_defreturn' ? 'int' : 'void');

  const kindOf = (block: Blockly.Block | null): Kind => {
    if (!block) return 'int';
    const input = (name: string): Blockly.Block | null => block.getInputTargetBlock(name);
    switch (block.type) {
      case 'math_number': {
        const n = Number(block.getFieldValue('NUM'));
        return Number.isFinite(n) && !Number.isInteger(n) ? 'float' : 'int';
      }
      case 'math_arithmetic': {
        const op = block.getFieldValue('OP');
        if (op === 'DIVIDE' || op === 'POWER') return 'float';
        return kindOf(input('A')) === 'float' || kindOf(input('B')) === 'float' ? 'float' : 'int';
      }
      case 'math_single': {
        const op = block.getFieldValue('OP');
        if (op === 'ABS' || op === 'NEG') return kindOf(input('NUM')) === 'float' ? 'float' : 'int';
        return 'float';
      }
      case 'math_trig':
      case 'math_constant':
      case 'math_random_float':
      case 'z1_dht_read':
      case 'z1_ultrasonic_cm':
        return 'float';
      case 'math_constrain':
        return kindOf(input('VALUE')) === 'float' ? 'float' : 'int';
      case 'math_modulo':
        return kindOf(input('DIVIDEND')) === 'float' || kindOf(input('DIVISOR')) === 'float' ? 'float' : 'int';
      case 'logic_ternary': {
        const kinds: Kind[] = [];
        if (input('THEN')) kinds.push(kindOf(input('THEN')));
        if (input('ELSE')) kinds.push(kindOf(input('ELSE')));
        return combineKinds(kinds);
      }
      case 'variables_get': {
        const id = variableIdOf(block);
        return (id && variables.get(id)) || 'int';
      }
      case 'procedures_callreturn': {
        const t = returnTypes.get(procedureNameOf(block));
        return t && t !== 'void' ? t : 'int';
      }
      default:
        return kindFromCheck(block);
    }
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const assigned = new Map<string, Set<Kind>>();
    const returned = new Map<string, Set<Kind>>();
    const add = (map: Map<string, Set<Kind>>, key: string | null, kind: Kind) => {
      if (!key) return;
      let set = map.get(key);
      if (!set) map.set(key, (set = new Set()));
      set.add(kind);
    };

    for (const block of blocks) {
      switch (block.type) {
        case 'variables_set':
          add(assigned, variableIdOf(block), kindOf(block.getInputTargetBlock('VALUE')));
          break;
        case 'math_change':
          add(assigned, variableIdOf(block), kindOf(block.getInputTargetBlock('DELTA')));
          break;
        case 'text_append':
          add(assigned, variableIdOf(block), 'String');
          break;
        case 'controls_for':
          add(assigned, variableIdOf(block), 'int');
          break;
        case 'procedures_callnoreturn':
        case 'procedures_callreturn': {
          const def = definitions.get(procedureNameOf(block));
          if (!def) break;
          def.paramIds.forEach((id, i) => add(assigned, id, kindOf(block.getInputTargetBlock(`ARG${i}`))));
          break;
        }
        case 'procedures_defreturn': {
          const value = block.getInputTargetBlock('RETURN');
          if (value) add(returned, procedureNameOf(block), kindOf(value));
          break;
        }
        case 'procedures_ifreturn': {
          const root = block.getRootBlock();
          const value = block.getInputTargetBlock('VALUE');
          if (root.type === 'procedures_defreturn' && value) add(returned, procedureNameOf(root), kindOf(value));
          break;
        }
        default:
          break;
      }
    }

    let changed = false;
    for (const v of workspace.getVariableMap().getAllVariables()) {
      const type = combineKinds(assigned.get(v.getId()) ?? []);
      if (variables.get(v.getId()) !== type) {
        variables.set(v.getId(), type);
        changed = true;
      }
    }
    for (const [name, def] of definitions) {
      const type: CType | 'void' = def.block.type === 'procedures_defreturn' ? combineKinds(returned.get(name) ?? []) : 'void';
      if (returnTypes.get(name) !== type) {
        returnTypes.set(name, type);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const [name, def] of definitions) {
    procedures.set(name, {
      returnType: returnTypes.get(name) ?? 'void',
      params: def.paramIds.map((id) => variables.get(id) ?? 'int'),
    });
  }

  return { variables, procedures, kindOf: (block) => kindOf(block) };
}
