// nodes/appraise/init.js

/**
 * @fileoverview Initializes the two-layer SNN appraise node state.
 *
 * Validates the spec, resolves deviation type indices and parameters into
 * typed arrays, pre-allocates all typed arrays for L1 receptor neurons
 * (membranes, spikes, fired, charges, rates) and L2 decision neuron
 * (membrane, tau, theta). Computes signed weight infrastructure
 * (absWeights, totalAbsWeight) and calibration parameters
 * (warmupSamples, cTarget). All allocation happens here —
 * the hot path is zero-alloc.
 *
 * @see ADR-004
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { DEVIATION_TYPE_INDEX } from './deviation.js';
import { computeWarmupSamples, deriveCTarget } from './calibrate.js';

/**
 * Initializes the appraise node state from a validated spec.
 *
 * @param {Object} spec - Node specification
 * @param {string} spec.name - Unique node identifier
 * @param {Object} spec.from - Input field specification
 * @param {string[]} spec.from.x - Source field names (ordered)
 * @param {Object} spec.sources - Per-source config keyed by field name (signed weights)
 * @param {number} spec.halfLife - L1 decay half-life (same units as timestamps)
 * @param {number} [spec.l2HalfLife] - L2 decay half-life (defaults to max L1 tau * ln2)
 * @param {number} [spec.messageRate=1] - Messages per timestamp unit (for warmup calc)
 * @param {Object} spec.thresholds - Classification thresholds
 * @param {Object} spec.stats - Output statistics configuration
 * @returns {Object} Initialized state object
 */
const init = function ( spec ) {
    validateSpec( spec, introspect );

    const state = Object.create( null );
    const fields = spec.from.x;
    const configs = spec.sources;
    const n = fields.length;

    // ── Standard Flags ──────────────────────────────────────────────────────
    state.inputValidationFailed = false;
    state.disable = false;
    state.pause = false;

    // ── Configuration from Spec ─────────────────────────────────────────────
    state.stats = spec.stats;
    state.sourceCount = n;

    // ── Deviation Type Dispatch (module-level pure functions, no closures) ───
    state.deviationTypes = new Uint8Array( n );
    state.deviationP1 = new Float64Array( n );
    state.deviationP2 = new Float64Array( n );
    state.sourceFields = new Array( n );

    // ── Pre-build Per-Source Field Names (zero string ops in hot path) ────
    const chargePrefix = spec.stats.charge ? spec.stats.charge.storeAs : null;
    const ratePrefix = spec.stats.rate ? spec.stats.rate.storeAs : null;
    state.chargeFields = chargePrefix ? new Array( n ) : null;
    state.rateFields = ratePrefix ? new Array( n ) : null;

    for ( let i = 0; i < n; i += 1 ) {
        const fieldName = fields[ i ];
        const cfg = configs[ fieldName ];
        state.sourceFields[ i ] = fieldName;
        state.deviationTypes[ i ] = DEVIATION_TYPE_INDEX[ cfg.deviation ];

        if ( cfg.deviation === 'highExceedance' || cfg.deviation === 'lowExceedance' ) {
            state.deviationP1[ i ] = cfg.baseline;
        } else if ( cfg.deviation === 'bandExceedance' ) {
            state.deviationP1[ i ] = cfg.band.lower;
            state.deviationP2[ i ] = cfg.band.upper;
        }
        // identity, absolute: p1=0, p2=0 (Float64Array default)

        if ( chargePrefix ) state.chargeFields[ i ] = chargePrefix + '_' + fieldName;
        if ( ratePrefix ) state.rateFields[ i ] = ratePrefix + '_' + fieldName;
    }

    // ── Per-Source Config (pre-compiled) ─────────────────────────────────────
    state.thetas = new Float64Array( n );
    state.weights = new Float64Array( n );
    state.absWeights = new Float64Array( n );

    let totalAbsWeight = 0;
    for ( let i = 0; i < n; i += 1 ) {
        const cfg = configs[ fields[ i ] ];
        state.thetas[ i ] = cfg.theta;
        state.weights[ i ] = cfg.weight;
        state.absWeights[ i ] = Math.abs( cfg.weight );
        totalAbsWeight += state.absWeights[ i ];
    }
    state.totalAbsWeight = totalAbsWeight;

    // ── Pre-compute Per-Source Decay Constants ───────────────────────────────
    const globalTau = spec.halfLife / Math.LN2;
    state.taus = new Float64Array( n );

    let uniform = true;
    let maxTau = 0;
    for ( let i = 0; i < n; i += 1 ) {
        const hl = configs[ fields[ i ] ].halfLife;
        state.taus[ i ] = ( hl === undefined ) ? globalTau : ( hl / Math.LN2 );
        if ( state.taus[ i ] !== globalTau ) uniform = false;
        if ( state.taus[ i ] > maxTau ) maxTau = state.taus[ i ];
    }
    state.uniformDecay = uniform;

    // Pre-allocate for non-uniform path (zero-alloc hot path)
    state.decayFactors = new Float64Array( n );

    // ── L1 LIF State ────────────────────────────────────────────────────────
    state.membranes = new Float64Array( n );
    state.spikes = new Float64Array( n );
    state.fired = new Uint8Array( n );

    // ── L1 BLI State (intensity explanation) ────────────────────────────────
    state.charges = new Float64Array( n );

    // ── L1 Rate State (persistence explanation) ─────────────────────────────
    state.rates = new Float64Array( n );

    // ── L2 Decision Neuron ──────────────────────────────────────────────────
    const l2Tau = spec.l2HalfLife ?
        ( spec.l2HalfLife / Math.LN2 ) :
        maxTau;
    state.l2Tau = l2Tau;
    state.l2Membrane = 0;
    state.l2Theta = 1.0; // placeholder until calibrated

    // ── Calibration ─────────────────────────────────────────────────────────
    const messageRate = spec.messageRate || 1.0;
    state.calibrating = true;
    state.warmupSamples = computeWarmupSamples( l2Tau, messageRate );
    state.messageCount = 0;
    state.cTarget = deriveCTarget( spec.thresholds.monitor.at );

    // ── Threshold Configuration ─────────────────────────────────────────────
    // Sorted ascending for classification loop
    state.thresholdLevels = [
        { at: spec.thresholds.monitor.at, name: 'Monitor', action: spec.thresholds.monitor.action },
        { at: spec.thresholds.degraded.at, name: 'Degraded', action: spec.thresholds.degraded.action },
        { at: spec.thresholds.critical.at, name: 'Critical', action: spec.thresholds.critical.action }
    ];

    // ── Timing State ────────────────────────────────────────────────────────
    state.lastTimestamp = 0;
    state.hasReceivedMessage = false;

    // ── Combined Score & Classification ─────────────────────────────────────
    state.combined = 0;
    state.stateName = 'Normal';

    // ── Constants ───────────────────────────────────────────────────────────
    state.VTH = 1.0;
    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;
