// nodes/appraise/update.js

/**
 * @fileoverview Hot path for two-layer SNN appraise node message processing.
 *
 * Pipeline per message:
 *   1. Guard / validate timestamp
 *   2. Compute decay factors (L1 uniform or per-source, L2 single)
 *   3. L1 receptor loop: deviation -> normalise -> processReceptor (LIF+BLI+Rate)
 *   4. L2 decision: synaptic current -> membrane update
 *   5. Calibration check (burn-in Theta derivation)
 *   6. MM readout -> conviction
 *   7. Threshold classification
 *
 * Zero allocation. All arrays and objects are pre-allocated in init.
 * Missing source fields cause pure decay (no injection) on that source.
 *
 * @see ADR-004
 */

import { computeDeviation } from './deviation.js';
import { normalise } from './integrate.js';
import { processReceptor, decayReceptor } from './receptor.js';
import { computeSynapticCurrent, updateMembrane, readout } from './decision.js';
import { checkCalibration } from './calibrate.js';

/**
 * Processes a message through the two-layer SNN pipeline.
 *
 * @param {Object} state - Node state from init()
 * @param {Object} msg - Incoming message with field values and timestamp
 * @returns {Object} Updated state
 */
const update = function ( state, msg ) {
    // Guard: skip if disabled
    if ( state.disable || state.pause ) return state;

    // Extract timestamp
    const timestamp = msg.timestamp;

    // Reset health flag
    state.inputValidationFailed = false;

    // Validate timestamp
    if ( !Number.isFinite( timestamp ) ) {
        state.inputValidationFailed = true;
        return state;
    }

    // ── Compute Decay ───────────────────────────────────────────────────────
    const isFirst = !state.hasReceivedMessage;
    const dt = timestamp - state.lastTimestamp;
    state.lastTimestamp = timestamp;
    state.hasReceivedMessage = true;
    state.messageCount += 1;

    // ── L1 Per-Source Receptor Loop ─────────────────────────────────────────
    const thetas = state.thetas;
    const fields = state.sourceFields;
    const types = state.deviationTypes;
    const dp1 = state.deviationP1;
    const dp2 = state.deviationP2;
    const n = state.sourceCount;

    if ( state.uniformDecay ) {
        // Fast path: single decay factor for all L1 sources
        const decayFactor = isFirst ? 1 : Math.exp( -dt / state.taus[ 0 ] );

        for ( let i = 0; i < n; i += 1 ) {
            const raw = msg[ fields[ i ] ];
            if ( Number.isFinite( raw ) ) {
                const norm = normalise( computeDeviation( types[ i ], raw, dp1[ i ], dp2[ i ] ), thetas[ i ] );
                processReceptor( state, i, norm, decayFactor );
            } else {
                decayReceptor( state, i, decayFactor );
            }
        }
    } else {
        // Per-source path: each source decays at its own rate
        const taus = state.taus;
        const decayFactors = state.decayFactors;

        if ( isFirst ) {
            decayFactors.fill( 1 );
        } else {
            for ( let i = 0; i < n; i += 1 ) {
                decayFactors[ i ] = Math.exp( -dt / taus[ i ] );
            }
        }

        for ( let i = 0; i < n; i += 1 ) {
            const raw = msg[ fields[ i ] ];
            if ( Number.isFinite( raw ) ) {
                const norm = normalise( computeDeviation( types[ i ], raw, dp1[ i ], dp2[ i ] ), thetas[ i ] );
                processReceptor( state, i, norm, decayFactors[ i ] );
            } else {
                decayReceptor( state, i, decayFactors[ i ] );
            }
        }
    }

    // ── L2 Decision Neuron ──────────────────────────────────────────────────
    const l2DecayFactor = isFirst ? 1 : Math.exp( -dt / state.l2Tau );
    const current = computeSynapticCurrent(
        state.spikes, state.weights, state.totalAbsWeight, n
    );
    state.l2Membrane = updateMembrane( state.l2Membrane, current, l2DecayFactor );

    // ── Calibration Check ───────────────────────────────────────────────────
    if ( state.calibrating ) {
        checkCalibration( state );
    }

    // ── Conviction Readout ──────────────────────────────────────────────────
    state.combined = readout( state.l2Membrane, state.l2Theta );

    // ── Threshold Classification ────────────────────────────────────────────
    const levels = state.thresholdLevels;
    state.stateName = 'Normal';
    for ( let i = levels.length - 1; i >= 0; i -= 1 ) {
        if ( state.combined >= levels[ i ].at ) {
            state.stateName = levels[ i ].name;
            break;
        }
    }

    return state;
}; // update()

export default update;
