// nodes/trend/init.js

import { validateWithSchema } from '../../core/utils/validate/index.js';
import { getDSLMetadata, getNodeType, DEFAULT_OPTIONS } from './introspect.js';
import { halfLifeToAlpha, halfLifeToWarmupSamples } from '../../core/utils/half-life/index.js';
import { resolveScalar } from '../../core/utils/options/resolve-field-keyed.js';
import { asTunable } from '../../core/tunable/index.js';

const init = function ( spec ) {
    // Validate specification
    const metadata = getDSLMetadata();
    const validation = validateWithSchema(
        {
            ...metadata.specSchema,
            _crossFieldValidators: metadata.crossFieldValidators
        },
        spec,
        'spec'
    );
    validation.throwIfInvalid( getNodeType() );

    // Create state after validation passes
    const state = Object.create( null );
    // Standard input parameter health flag during update: false means healthy
    state.inputValidationFailed = false;
    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Core configuration
    state.x = spec.from.x;
    state.stats = spec.stats;

    // Apply parameters with defaults (validation doesn't enforce them)
    // Supports direct, field-keyed, and tunable specification for tunable params
    const rocStatsHalfLifeSpec = resolveScalar( spec.rocStatsHalfLife, state.x );
    const rocThresholdSpec = resolveScalar( spec.rocThreshold, state.x );
    const speedUpSpec = resolveScalar( spec.speedUp, state.x );
    const warmupSamplesSpec = resolveScalar( spec.warmupSamples, state.x );

    // Structural params (affect derived values at init time)
    state.rocStatsHalfLife = rocStatsHalfLifeSpec ?? DEFAULT_OPTIONS.rocStatsHalfLife;
    state.rocAlpha = halfLifeToAlpha( state.rocStatsHalfLife );
    state.speedUp = speedUpSpec ?? DEFAULT_OPTIONS.speedUp;
    state.warmupSamples = warmupSamplesSpec ?? halfLifeToWarmupSamples( state.rocStatsHalfLife, 0.8 );
    state.warmupSamplesForAccel = Math.ceil( state.warmupSamples * 1.5 );

    // rocThreshold supports tunable for phase-dependent sensitivity
    state.rocThresholdFn = asTunable( rocThresholdSpec ?? DEFAULT_OPTIONS.rocThreshold );
    state.rocThreshold = DEFAULT_OPTIONS.rocThreshold;
    state.tunableErrorLogged = false;

    state.previousValue = null;

    // roc statistics
    state.rocMean = 0;
    state.rocVariance = 0;

    // Acceleration hint configuration
    if ( state.stats.accelerationHint ) {
        state.rocSmoothedFast = 0;
        state.accelAlpha = halfLifeToAlpha( state.rocStatsHalfLife / state.speedUp );
        state.accelerationHint = null;
    }

    // Tracking
    state.samples = 0;
    state.consistentSamples = 0;
    state.trend = 'learning';
    state.previousTrend = 'learning';
    state.confidence = 0;
    state.snr = 0;
    // accelThreshold is derived from rocThreshold at runtime (rocThreshold may be dynamic)

    // Node metadata
    state.nodeType = getNodeType();

    return state;
}; // init()

export default init;
