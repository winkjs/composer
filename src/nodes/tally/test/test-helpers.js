/**
 * @fileoverview Shared fixtures for the tally node tests — a prototype-free
 * message builder, the canonical output-field names, and spec/run factories.
 * Keeps each spec file focused on its own concern with no duplicated boilerplate.
 */

import * as tally from '../index.js';

/** The output field name (storeAs) used for each stat across the tests. */
export const STORE = {
    any: 'oAny',
    all: 'oAll',
    count: 'oCount'
};

/** Build the full three-stat output map (a fresh object each call). */
export const allStatsOutputs = function () {
    const out = {};
    const names = Object.keys( STORE );
    for ( let i = 0; i < names.length; i += 1 ) {
        out[ names[ i ] ] = { storeAs: STORE[ names[ i ] ] };
    }
    return out;
};

/** Build a valid spec for the given fields and stats (defaults to all three). */
export const specFor = function ( fields, stats ) {
    return {
        nodeType: 'Tally',
        name: 'tallyTest',
        from: { x: fields },
        stats: stats || allStatsOutputs()
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
export const runOnce = function ( fields, values, stats ) {
    const state = tally.init( specFor( fields, stats ) );
    tally.update( state, msgFrom( fields, values ) );
    const msg = Object.create( null );
    tally.publishTo( state, msg );
    return { state, msg };
};
