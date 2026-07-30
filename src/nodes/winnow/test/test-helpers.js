// nodes/winnow/test/test-helpers.js

/**
 * @fileoverview Shared fixtures, spec factories, and utilities for
 * winnow node tests.
 */

import * as winnow from '../index.js';

// ── Spec Factories ─────────────────────────────────────────────────────────

/**
 * Returns a minimal valid spec with optional overrides.
 * Default stats: deviation, predicted, significant.
 */
export const baseSpec = function ( overrides ) {
    return Object.assign( {
        nodeType: 'Winnow',
        name: 'w',
        from: { x: 'value' },
        stats: {
            deviation: { storeAs: 'dev' },
            predicted: { storeAs: 'pred' },
            significant: { storeAs: 'sig' }
        }
    }, overrides );
};

/**
 * Returns a spec with bufferPrev enabled, xPrev/tPrev stats, and
 * a timestampField. Accepts optional overrides.
 */
export const bufferSpec = function ( overrides ) {
    return baseSpec( Object.assign( {
        bufferPrev: true,
        timestampField: 'ts',
        stats: {
            deviation: { storeAs: 'dev' },
            predicted: { storeAs: 'pred' },
            significant: { storeAs: 'sig' },
            xPrev: { storeAs: 'xp' },
            tPrev: { storeAs: 'tp' }
        }
    }, overrides ) );
};

// ── Message Factory ────────────────────────────────────────────────────────

/**
 * Creates a message with defaults for all upstream fields winnow reads.
 * @param {number} value - Primary input value.
 * @param {object} [extras] - Override or add fields.
 * @returns {object} Message object.
 */
export const makeMsg = function ( value, extras ) {
    return Object.assign(
        { value, stdev: 1.0, roc: 0, trendDir: 'stable', gate: 0 },
        extras
    );
};

// ── Feed Utility ───────────────────────────────────────────────────────────

/**
 * Feeds N messages through update+publishTo and returns the messages.
 * @param {object} state - Node state.
 * @param {number} n - Number of messages.
 * @param {function} msgFn - `(index) => message` factory.
 * @returns {object[]} Array of processed messages.
 */
export const feedN = function ( state, n, msgFn ) {
    const results = [];
    for ( let i = 0; i < n; i += 1 ) {
        const msg = msgFn( i );
        winnow.update( state, msg );
        winnow.publishTo( state, msg );
        results.push( msg );
    }
    return results;
};
