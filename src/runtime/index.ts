/**
 * Runtime assembly (docs/ARCHITECTURE.md §5.5): the `__rt` object handed to
 * the generated code. It merges the numeric helpers, the value boxes, the
 * Arduino core API and the library emulations, and reports any name the
 * sketch uses that none of them define.
 */
import type { RuntimeContext } from '../types';
import { createCoreApi } from './core';
import { HELPERS } from './helpers';
import { createLibs } from './libs/index';
import { __chr, __flt, SketchError } from './values';

/** Names the JS engine or debugging tools may probe on any object; they must not look like sketch errors. */
const PROBED_KEYS: ReadonlySet<string> = new Set(['then', 'toJSON', 'constructor']);

/**
 * Build the `__rt` runtime object for one sketch run. Later sources override
 * earlier ones (a library may replace a core name). Reading an unknown name
 * throws `'name' was not declared in this scope`, except for `then`,
 * `toJSON`, `constructor`, symbols and `__*` names, which read as `undefined`.
 */
export function createRuntime(ctx: RuntimeContext): Record<string, unknown> {
  const members: Record<string, unknown> = Object.assign(
    Object.create(null) as Record<string, unknown>,
    HELPERS,
    { __flt, __chr },
    createCoreApi(ctx),
    createLibs(ctx),
    { __tick: ctx.tick },
  );
  return new Proxy(members, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
      if (PROBED_KEYS.has(key) || key.startsWith('__')) return undefined;
      throw new SketchError(`'${key}' was not declared in this scope`);
    },
    has(target, key) {
      return typeof key === 'string' && Object.prototype.hasOwnProperty.call(target, key);
    },
  });
}
