// nodes/appraise/index.js

/**
 * @fileoverview Appraise node module exports.
 *
 * Two-layer SNN that accumulates evidence from multiple detection signals
 * into a stable conviction score. L1 receptor neurons (LIF + BLI + Rate)
 * feed an L2 decision neuron with signed weights (excitatory/inhibitory)
 * and MM readout. Burn-in calibration derives Theta from warmup baseline.
 *
 * @see ADR-004
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
