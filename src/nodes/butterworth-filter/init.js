/**
 * @fileoverview Initialization for butterworth-filter node.
 *
 * Validates the spec, computes 2nd-order Butterworth coefficients via the
 * bilinear transform with frequency pre-warping, and returns fully
 * initialized state. Supports lowpass/highpass, three cutoff specification
 * methods, cascade adjustment, and DC initialization for transient reduction.
 */

import { validateSpec } from '../../core/utils/node/index.js';
import * as introspect from './introspect.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';

const init = function ( spec ) {
    validateSpec( spec, introspect );

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Extract field name
    state.x = spec.from.x;

    // Apply defaults from introspect (validation doesn't enforce them)
    // Supports both direct and field-keyed specification for tunable params
    const filterTypeSpec = resolveScalar( spec.filterType, state.x );
    state.filterType = filterTypeSpec ?? introspect.DEFAULT_OPTIONS.filterType;
    state.acceptNumericalRisk = spec.acceptNumericalRisk ?? introspect.DEFAULT_OPTIONS.acceptNumericalRisk;

    // Extract sample rate (required field, validated by schema)
    const sampleRateHz = spec.sampleRateHz;
    const nyquistHz = sampleRateHz / 2;

    // Resolve tunable params (supports field-keying)
    const cutoffHzSpec = resolveScalar( spec.cutoffHz, state.x );
    const settlingTimeMsSpec = resolveScalar( spec.settlingTimeMs, state.x );
    const cutoffRatioSpec = resolveScalar( spec.cutoffRatio, state.x );

    // Determine cutoff frequency from various possible inputs
    let cutoffHz;
    let configIntent = 'direct';

    if ( cutoffHzSpec ) {
        // Direct specification
        cutoffHz = cutoffHzSpec;

    } else if ( settlingTimeMsSpec && spec.sampleRateHz ) {
        // Calculate from settling time requirement
        // For 2nd order Butterworth: settling time ≈ 4 / (2π * fc) for 98% settling
        const settlingTimeSec = settlingTimeMsSpec / 1000;
        cutoffHz = 4 / ( 2 * Math.PI * settlingTimeSec );
        configIntent = 'settling-time';

    } else if ( cutoffRatioSpec ) {
        // Relative to Nyquist
        cutoffHz = cutoffRatioSpec * nyquistHz;
        configIntent = 'ratio';
    }

    // Adjust for cascading if specified
    let cascadeAdjustment = 1;
    if ( spec.adjustForCascade && spec.adjustForCascade > 1 ) {
        // For N cascaded stages to have -3dB at fc:
        // Each stage needs fc * 2^(1/N - 1)
        cascadeAdjustment = Math.pow( 2, ( 1 / spec.adjustForCascade ) - 1 );
        cutoffHz /= cascadeAdjustment;
        configIntent += '-cascade-adjusted';
    }

    // Validate the computed cutoff
    if ( cutoffHz <= 0 || cutoffHz >= nyquistHz ) {
        throw new RangeError(
            `Computed cutoff ${cutoffHz.toFixed(1)}Hz is outside valid range (0, ${nyquistHz}Hz)`
        );
    }

    // Warn about potential numerical issues
    const normalizedCutoff = cutoffHz / nyquistHz;
    if ( normalizedCutoff < 0.001 && !state.acceptNumericalRisk ) {
        console.warn( `Very low cutoff (${cutoffHz.toFixed(3)}Hz) may cause numerical instability` );
    }

    // Store configuration for reference
    state.config = {
        cutoffHz,
        sampleRateHz,
        normalizedCutoff,
        intent: configIntent,
        cascadeAdjustment,
        dcEstimate: spec.dcEstimate  // Store for reset functionality
    };

    // Calculate filter coefficients using bilinear transform
    // Pre-warp the frequency to compensate for bilinear transform warping
    const wc = ( Math.PI * normalizedCutoff ) / 2;  // Bilinear pre-warp: tan(π·fc/fs)
    const warpedWc = Math.tan( wc );                // Pre-warped cutoff frequency

    // Butterworth prototype has Q = 1/√2 for maximally flat response
    const Q = 1 / Math.sqrt( 2 );

    // Bilinear transform coefficients
    const K = warpedWc;
    const K2 = K * K;
    const norm = 1 / ( K2 + ( K / Q ) + 1 );

    if ( state.filterType === 'lowpass' ) {
        // H(s) = 1 / (s² + s/Q + 1) -> H(z) via bilinear transform
        state.b0 = K2 * norm;
        state.b1 = 2 * K2 * norm;
        state.b2 = K2 * norm;
        state.a1 = 2 * ( K2 - 1 ) * norm;
        state.a2 = ( K2 - ( K / Q ) + 1 ) * norm;
    } else { // highpass
        // H(s) = s² / (s² + s/Q + 1) -> H(z) via bilinear transform
        state.b0 = norm;
        state.b1 = -2 * norm;
        state.b2 = norm;
        state.a1 = 2 * ( K2 - 1 ) * norm;
        state.a2 = ( K2 - ( K / Q ) + 1 ) * norm;
    }

    // Validate filter stability (poles inside unit circle)
    /* c8 ignore next 5 -- defensive: bilinear transform produces stable coefficients for valid Nyquist-bounded cutoff */
    if ( Math.abs( state.a2 ) >= 1 ) {
        throw new Error(
            `Filter unstable: coefficient a2 (${state.a2.toFixed(4)}) is outside stability bounds`
        );
    }

    /* c8 ignore next 5 -- defensive: same Nyquist guard prevents a1 stability violation */
    if ( Math.abs( state.a1 ) >= 1 + state.a2 ) {
        throw new Error(
            `Filter unstable: coefficient a1 (${state.a1.toFixed(4)}) violates stability condition |a1| < 1 + a2`
        );
    }

    // State variables for Direct Form II
    state.z1 = 0;
    state.z2 = 0;

    // CRITICAL: Initialize output storage for publishTo()
    // This ensures edge cases (NaN/Inf) work correctly on first call
    state.output = 0;

    // Initialization strategy
    if ( spec.initStrategy === 'dc' && spec.dcEstimate !== undefined ) {
        // Initialize DF2T state to steady-state for known DC level.
        // At steady state with constant input D: output = D·G, z1 = G·D - b0·D,
        // z2 = b2·D - a2·G·D, where G = H(1) = Σb / (1 + a1 + a2).
        const dcGain = ( state.b0 + state.b1 + state.b2 ) / ( 1 + state.a1 + state.a2 );
        if ( Math.abs( dcGain ) > 1e-10 ) {
            const steadyOutput = spec.dcEstimate * dcGain;
            state.z1 = steadyOutput - ( state.b0 * spec.dcEstimate );
            state.z2 = ( state.b2 * spec.dcEstimate ) - ( state.a2 * steadyOutput );
            state.output = steadyOutput;
        }
    }

    // Auto-compute performance characteristics
    state.performance = {
        multipliesPerSample: 5,
        addsPerSample: 4,
        memoryBytes: 56, // 7 Float64s (6 coeffs + 2 state + 1 output)
        // Group delay approximation at cutoff (in samples)
        groupDelaySamples: Math.round( 0.5 / ( Math.PI * normalizedCutoff ) ),
        // Settling time to 98% (in samples)
        settlingTimeSamples: Math.round( 4 / ( 2 * Math.PI * normalizedCutoff ) ),
        // Useful for debugging
        actualCutoffHz: cutoffHz,
        normalizedCutoff: normalizedCutoff
    };

    // Output configuration
    state.stats = spec.stats;
    state.nodeType = introspect.getNodeType();

    return state;
}; // init()

export default init;
