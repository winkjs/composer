// nodes/moments-digest/update.js

/**
 * @fileoverview
 * Moments Digest Update — Incremental moment accumulation with flush synchronization
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * Core Processing Logic
 * • Raw nodes: Process individual samples using Pébay's algorithm
 * • Cascade nodes: Merge moment sets from parent digests
 * • Window completion: Both node types publish on window completion
 * • Flush override: Immediate publish of partial windows
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * Flush Synchronization (Critical for Data Integrity)
 *
 * ROOT NODES:
 * • Handle flush in prelude (snapshot → reset → plan)
 * • Controller placement determines current message inclusion:
 *   - BEFORE: Exclude current (it starts next window)
 *   - AFTER: Include current (it's in the snapshot)
 * • Propagate x_flush signal to downstream cascades
 *
 * CASCADE NODES:
 * • Never snapshot/reset in prelude (only root does)
 * • Process parent's moments FIRST (if present)
 * • THEN check for flush signal to publish accumulated state
 * • This sequence ensures cascade includes exactly what root decided
 *
 * Key invariant: Cascades ingest whatever root published before responding
 * to flush. This prevents data loss regardless of controller placement.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * Execution Flow (per message)
 * 1. Process input (raw sample or parent moments)
 * 2. For cascades with flush signal: snapshot → reset after ingestion
 * 3. Check window completion (both node types)
 * 4. Plan publish if window complete or flush triggered
 */

/* eslint-disable camelcase */
import { copyFrom } from './copy-from.js';
import { prelude } from './prelude.js';
import reset from './reset.js';

// Pébay's algorithm for single value update
const updateFromRaw = function ( state, value ) {
    const n1 = state.n;
    state.n += 1;

    const delta = value - state.M1;
    const delta_n = delta / state.n;
    const delta_n2 = delta_n * delta_n;
    const term1 = delta * delta_n * n1;

    // Update moments
    state.M1 += delta_n;
    state.M4 += ( term1 * delta_n2 * ( ( state.n * state.n ) - ( 3 * state.n ) + 3 ) ) +
                ( 6 * delta_n2 * state.M2 ) - ( 4 * delta_n * state.M3 );
    state.M3 += ( term1 * delta_n * ( state.n - 2 ) ) - ( 3 * delta_n * state.M2 );
    state.M2 += term1;

    // Update min/max
    if ( value < state.min ) state.min = value;
    if ( value > state.max ) state.max = value;
}; // updateFromRaw()

// Combine moments from cascaded input
const updateFromCascade = function ( state, n, M1, M2, M3, M4, min, max ) {
    // Initialize combined state if first cascade
    if ( state.n === 0 ) {
        state.n = n;
        state.M1 = M1;
        state.M2 = M2;
        state.M3 = M3;
        state.M4 = M4;
        state.min = min;
        state.max = max;
        return;
    }

    // Combine using parallel moment algorithm
    const a_n = state.n;
    const a_M1 = state.M1;
    const a_M2 = state.M2;
    const a_M3 = state.M3;
    const a_M4 = state.M4;

    const combined_n = a_n + n;
    const delta = M1 - a_M1;
    const delta2 = delta * delta;
    const delta3 = delta * delta2;
    const delta4 = delta2 * delta2;

    state.M1 = ( ( a_n * a_M1 ) + ( n * M1 ) ) / combined_n;

    state.M2 = a_M2 + M2 +
                      ( delta2 * a_n * n / combined_n );

    state.M3 = a_M3 + M3 +
                      ( ( delta3 * a_n * n * ( a_n - n ) ) / ( combined_n * combined_n ) ) +
                      ( 3 * delta * ( ( a_n * M2 ) - ( n * a_M2 ) ) / combined_n );

    state.M4 = a_M4 + M4 +
                      ( delta4 * a_n * n * ( ( a_n * a_n ) - ( a_n * n ) + ( n * n ) ) / ( combined_n * combined_n * combined_n ) ) +
                      ( 6 * delta2 * ( ( a_n * a_n * M2 ) + ( n * n * a_M2 ) ) / ( combined_n * combined_n ) ) +
                      ( 4 * delta * ( ( a_n * M3 ) - ( n * a_M3 ) ) / combined_n );

    state.n = combined_n;

    // Update min/max
    if ( min < state.min ) state.min = min;
    if ( max > state.max ) state.max = max;
}; // updateFromCascade()

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;

    prelude( state, msg );

    // Reset on each update
    state.inputValidationFailed = false;

    if ( state.isCascading ) {
        // Extract ALL moments using pre-computed field names
        const fmap = state.fieldMap;

        // Always process parent's moments if available
        if ( msg[ fmap.n ] !== undefined ) {
            updateFromCascade(
                state,
                msg[ fmap.n ],
                msg[ fmap.M1 ],
                msg[ fmap.M2 ],
                msg[ fmap.M3 ],
                msg[ fmap.M4 ],
                msg[ fmap.min ],
                msg[ fmap.max ]
            );
            state.currentCount += 1;
        }

        // Handle flush signal (overrides window completion)
        if ( msg[ state.flushSignalKey ] === true && state.n > 0 ) {
            copyFrom( state, state.snapshot );
            state.planPublish = true;
            reset( state );
            return state;  // Skip window completion check
        }

        // Fall through to shared window completion logic
    } else {
        const xVal = msg[ state.x ];
        // Handle faults gracefully: ensure their isolation: applies to RAW updates only
        if ( !Number.isFinite( xVal ) ) {
            // Signals publishing NaN for all demanded `stats` in publishTo.
            state.inputValidationFailed = true;
            return state;
        }
        // Update using Pébay's algorithm
        updateFromRaw( state, xVal );
        // Increment window counter
        state.currentCount += 1;
    }

    // Epilogue: shared window completion logic
    state.windowComplete = state.currentCount >= state.windowSize;
    // End-of-window: schedule a publish (unless a flush snapshot is already planned)
    if ( state.windowComplete && ( !state.planPublish ) && ( !state.inputValidationFailed ) ) {
        // copy completed window
        copyFrom( state, state.snapshot );
        // Will publish snapshot this tick
        state.planPublish = true;
        // No flush propagation for plain window completion
        // Start next window cleanly
        reset( state );
    }

    return state;
}; // update()

export default update;
