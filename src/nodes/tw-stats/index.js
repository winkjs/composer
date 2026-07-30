// nodes/tw-stats/index.js

/**
 * @fileoverview
 * TW Stats — Tumbling window statistics with Pébay's numerically stable
 * algorithm for incremental moment accumulation.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Replaces the two-node chain (momentsDigest → digestMoments) for the
 * common case of computing statistics over count-based tumbling windows.
 *
 * Key properties:
 * • O(1) memory per partition — no ring buffer; Pébay incremental accumulation
 * • Selective moment accumulation — maxMoment (1–4) resolved at init from
 *   demanded stats; if/then gating in update, not closures (100K-safe)
 * • Deferred stat conversion — moment-to-stat formulas applied only in
 *   publishTo on window completion or flush, not every update tick
 * • Invalid samples skipped (not counted); window fills with valid samples only
 * • Publishes on window completion or flush; scrubs to undefined on other ticks
 * • Supports windowSize from 4 to 1,000,000
 *
 * ────────────────────────────────────────────────────────────────────────
 * References
 * [1] Pébay, P. (2008). Formulas for robust, one-pass parallel computation
 *     of covariances and arbitrary-order statistical moments.
 *     Sandia Report SAND2008-6212.
 */

export { default as init } from './init.js';
export { default as update } from './update.js';
export { default as reset } from './reset.js';
export { default as recompute } from './recompute.js';
export { default as publishTo } from './publish-to.js';
export { default as flush } from './flush.js';
// Direct imports for common control functions
export { default as disable } from '../../core/utils/node/disable.js';
export { default as enable } from '../../core/utils/node/enable.js';
export { default as pause } from '../../core/utils/node/pause.js';
export { default as unpause } from '../../core/utils/node/unpause.js';
// Re-export everything from introspection.js
export * from './introspect.js';
