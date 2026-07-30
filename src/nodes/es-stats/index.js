/**
 * @fileoverview Barrel module for the esStats node.
 *
 * Re-exports the standard node lifecycle methods (init, update, reset,
 * recompute, publishTo), shared control signals (disable, enable, pause,
 * unpause), and all introspection metadata.
 */
// nodes/es-stats/index.js

export { default as init } from './init.js';
export { default as update } from './update.js';
export { default as reset } from './reset.js';
export { default as recompute } from './recompute.js';
export { default as publishTo } from './publish-to.js';
// Direct imports for common control functions
export { default as disable } from '../../core/utils/node/disable.js';
export { default as enable } from '../../core/utils/node/enable.js';
export { default as pause } from '../../core/utils/node/pause.js';
export { default as unpause } from '../../core/utils/node/unpause.js';
// Re-export everything from introspection.js
export * from './introspect.js';
