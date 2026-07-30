// nodes/node-names.js

/**
 * @fileoverview Single source of truth for valid node names.
 *
 * Used for validation when nodes appear in DSL specs. Modules are
 * loaded lazily at runtime via load-node-module.js.
 *
 * Names are camelCase, matching DSL method names. Directory paths
 * are derived via toKebab() (e.g., 'esMean' -> 'es-mean').
 */

/**
 * Set of valid node names for O(1) lookup.
 * @type {Set<string>}
 */
export const NODE_NAMES = new Set( [
    'accumulate',
    'appraise',
    'butterworthFilter',
    'categorize',
    'controller',
    'diff',
    'digestMoments',
    'dwellTimeTracker',
    'emitIf',
    'esCorrelation',
    'esMean',
    'esPairwiseCorrelation',
    'esStats',
    'kalman1d',
    'invertFlag',
    'kernel',
    'lag',
    'median3',
    'pageHinkley',
    'passIf',
    'persistIf',
    'persistenceCheck',
    'processIndex',
    'ratio',
    'sanitize',
    'spikeGuard',
    'stateChangeDetector',
    'momentsDigest',
    'swStats',
    'swingWatch',
    'tally',
    'threshold',
    'transform',
    'trend',
    'twStats',
    'unbalance',
    'vectorDistance',
    'winnow'
] );

/**
 * Checks if a node name is valid.
 *
 * @param {string} name - camelCase node name
 * @returns {boolean} true if valid
 */
export const isValidNodeName = function ( name ) {
    return NODE_NAMES.has( name );
};

