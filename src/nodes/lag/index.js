// nodes/lag/index.js

/**
 * @fileoverview Exports for the lag node.
 *
 * The lag node computes five lag-based statistics: delta, ratio, roc,
 * slope, and logReturn. This replaces and extends the former delta node.
 *
 * @see ADR-004 for patterns
 */

export { default as init } from './init.js';
export { default as update } from './update.js';
export { default as reset } from './reset.js';
export { default as recompute } from './recompute.js';
export { default as publishTo } from './publish-to.js';
export { default as disable } from '../../core/utils/node/disable.js';
export { default as enable } from '../../core/utils/node/enable.js';
export { default as pause } from '../../core/utils/node/pause.js';
export { default as unpause } from '../../core/utils/node/unpause.js';
export * from './introspect.js';
