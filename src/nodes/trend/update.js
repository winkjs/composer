// nodes/trend/update.js

import { computeConfidence } from './compute-confidence.js';
import { logger } from '../../core/logger/index.js';

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    const xVal = msg[ state.x ];
    // Reset on each update
    state.inputValidationFailed = false;
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( xVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    state.samples += 1;

    if ( state.previousValue === null ) {
        state.previousValue = xVal;
        // This ensures the first roc value is a real one and not 0.
        return state;
    }

    // Step 1: Lag(1) for roc
    const roc = xVal - state.previousValue;
    state.previousValue = xVal;

    // Step 2: Track roc statistics
    const rocResidual = roc - state.rocMean;
    state.rocMean += ( state.rocAlpha * rocResidual );
    state.rocVariance += ( state.rocAlpha * ( ( rocResidual * rocResidual ) - state.rocVariance ) );

    // Step 3: Track roc at a faster roc for acceleration hint
    if ( state.stats.accelerationHint ) {
        state.rocSmoothedFast += ( state.accelAlpha * ( roc - state.rocSmoothedFast ) );
    }

    // Step 4: Classification
    state.previousTrend = state.trend;

    // Resolve rocThreshold tunable for this message
    try {
        // If tunable throws, last good value is retained.
        state.rocThreshold = state.rocThresholdFn( msg );
        if ( state.tunableErrorLogged ) state.tunableErrorLogged = false;
    } catch ( error ) {
        if ( !state.tunableErrorLogged ) {
            state.tunableErrorLogged = true;
            logger.error( `winkComposer/${state.nodeType}: tunable threw: ${error.message}` );
        }
    }

    if ( state.samples < state.warmupSamples ) {
        state.trend = 'learning';
    } else if ( Math.abs( state.rocMean ) < state.rocThreshold ) {
        state.trend = 'stable';
    } else {
        state.trend = state.rocMean > 0 ? 'rising' : 'falling';
    }

    // Track consistency
    if ( state.trend === state.previousTrend ) {
        state.consistentSamples += 1;
    } else {
        state.consistentSamples = 0;
    }

    // Step 5: Confidence computation
    state.confidence = computeConfidence( state );

    // Step 6: Acceleration hint
    if ( state.stats.accelerationHint && ( state.samples > ( state.warmupSamplesForAccel ) ) ) {
        // fast > mean ⇒ likely_accelerating
        const accelProxy = state.rocSmoothedFast - state.rocMean;

        // Basic SNR & persistence gates
        const passesSNR = state.snr >= 1.5;   // require decent roc SNR
        const accelThreshold = 0.75 * state.rocThreshold;  // derive from current rocThreshold
        const passesBand = Math.abs( accelProxy ) >= accelThreshold;  // ignore tiny curvature
        const persistent = state.consistentSamples >= 3;    // brief dwell

        if ( passesSNR && passesBand && persistent ) {
            state.accelerationHint = ( accelProxy > 0 ) ? 'likely_accelerating' : 'likely_decelerating';
        } else {
            state.accelerationHint = null;
        }
    }

    return state;
}; // update()

export default update;
