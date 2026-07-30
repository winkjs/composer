/**
 * @fileoverview Shared fixtures for the unbalance node tests — a prototype-free
 * message builder, a closeness check, the canonical output-field names, and
 * spec/run factories. Keeps each spec file focused on its own concern with no
 * duplicated boilerplate.
 */

import * as ub from '../index.js';

/** Tolerance for golden-truth comparisons (acceptance target: < 1e-9). */
export const EPS = 1e-9;

export const isClose = function ( a, b, eps = EPS ) {
    return Math.abs( a - b ) <= eps;
};

/** The output field name (storeAs) used for each stat across the tests. */
export const STORE = {
    mean: 'oMean',
    min: 'oMin',
    max: 'oMax',
    range: 'oRange',
    maxDev: 'oMaxDev',
    unbalance: 'oUnbalance',
    worstIndex: 'oWorstIndex',
    worstDev: 'oWorstDev',
    presentCount: 'oPresentCount'
};

/**
 * The eight computed cross-field metrics. presentCount is deliberately not here —
 * it is a count of the input, not a metric, so it follows its own rule (always
 * the real count, never blanked) and is requested explicitly where it is tested.
 */
export const METRIC_STATS = [
    'mean', 'min', 'max', 'range', 'maxDev', 'unbalance', 'worstIndex', 'worstDev'
];

/** Build the metric output map (a fresh object each call). */
export const allStatsOutputs = function () {
    const out = {};
    for ( let i = 0; i < METRIC_STATS.length; i += 1 ) {
        out[ METRIC_STATS[ i ] ] = { storeAs: STORE[ METRIC_STATS[ i ] ] };
    }
    return out;
};

/**
 * Build a valid spec for the given fields and stats (defaults to all metrics).
 * Extra options ( skipOnNaN, minPresent ) are spread in when provided.
 */
export const specFor = function ( fields, stats, options ) {
    return {
        nodeType: 'Unbalance',
        name: 'ubTest',
        from: { x: fields },
        stats: stats || allStatsOutputs(),
        ...( options || {} )
    };
};

/** Prototype-free message from field names and values. */
export const msgFrom = function ( fields, values ) {
    const m = Object.create( null );
    for ( let i = 0; i < fields.length; i += 1 ) {
        m[ fields[ i ] ] = values[ i ];
    }
    return m;
};

/** init -> update( values ) -> publishTo into a fresh message. */
export const runOnce = function ( fields, values, stats, options ) {
    const state = ub.init( specFor( fields, stats, options ) );
    ub.update( state, msgFrom( fields, values ) );
    const msg = Object.create( null );
    ub.publishTo( state, msg );
    return { state, msg };
};
