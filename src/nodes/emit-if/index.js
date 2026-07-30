/**
 * @fileoverview Public API for emitIf node
 */

export { default as init } from './init.js';
export { default as update } from './update.js';
export { default as reset } from './reset.js';
export { default as recompute } from './recompute.js';
export { default as publishTo } from './publish-to.js';
// Re-export everything from introspection
export * from './introspect.js';

// Note: Control signals (disable/enable/pause/unpause) are intentionally
// not exported. emitIf is a side-effect terminal node — it should always
// process when the pipeline runs. Use predicate logic for conditional
// emission. Consistent with persist-if (peer terminal node).
