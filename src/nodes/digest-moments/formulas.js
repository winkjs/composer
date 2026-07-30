// nodes/digest-moments/formulas.js

/**
 * @fileoverview Re-exports shared statistical formulas.
 *
 * The canonical implementations live in core/utils/stats/formulas.js.
 * This re-export preserves the local import path used by digest-moments/update.js.
 *
 * @see core/utils/stats/formulas.js
 */

export { computeVariance, computeCV, computeSkew, computeKurtosis } from '../../core/utils/stats/formulas.js';
