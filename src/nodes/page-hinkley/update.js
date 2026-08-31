/**
 * @fileoverview Page-Hinkley Test update function — processes one observation.
 *
 * Implements the standard PHT sequential recurrence (Page 1954, Hinkley 1971):
 * 1. Update baseline estimate (running mean, or exponentially smoothed when
 *    halfLife is configured)
 * 2. Accumulate cumulative sum of deviations from baseline minus drift allowance
 * 3. Track running minimum of cumulative sum
 * 4. Detect shift when test statistic (cumSum - minCumSum) exceeds lambda
 *
 * On detection, cumSum and minCumSum reset to 0; mean and count continue
 * tracking the new regime. Triggers (if any) fire on detection.
 *
 * Design rationale — exponentially smoothed baseline vs exponentially smoothed
 * cumsum (as in river.drift.PageHinkley):
 *
 *   The composer applies exponential smoothing to the baseline mean, not the
 *   cumulative sum. This is deliberate for industrial streaming:
 *
 *   1. Non-stationary signals: Industrial sensors drift with operating
 *      conditions, ambient temperature, and equipment wear. A running mean
 *      of 10,000 samples is effectively a constant — useless as "current
 *      normal." An exponentially smoothed baseline tracks the actual
 *      operating point.
 *
 *   2. Undecayed evidence accumulation: The raw cumsum grows monotonically under
 *      a sustained shift — the mathematical foundation of the PHT.
 *      Exponentially smoothing the cumsum (river's approach) decays evidence
 *      over time; a gradual shift can decay away before reaching threshold.
 *
 *   3. Orthogonal tuning: halfLife controls baseline responsiveness;
 *      delta/lambda control detection sensitivity — independent knobs.
 *      river's alpha couples evidence decay with the effective detection
 *      window.
 *
 *   4. Architectural recovery: The control plane (controller node) explicitly
 *      resets baselines on confirmed change — clean, debuggable, no loss of
 *      detection power. river needs cumsum forgetting as a workaround.
 */

import { executeTriggers } from '../../core/utils/node/index.js';
import { logger } from '../../core/logger/index.js';

const update = function ( state, msg ) {
    if ( state.disable || state.pause ) return state;
    let xVal = msg[ state.x ];
    // Reset on each update
    state.inputValidationFailed = false;
    // Handle faults gracefully: ensure their isolation
    if ( !Number.isFinite( xVal ) ) {
        // Signals publishing NaN for all demanded `stats` in publishTo.
        state.inputValidationFailed = true;
        return state;
    }

    if ( state.detectDrop ) {
        xVal = -xVal;
    }

    // Resolve tunable parameters for this message
    try {
        state.delta = state.deltaFn( msg );
        state.lambda = state.lambdaFn( msg );
        if ( state.tunableErrorLogged ) state.tunableErrorLogged = false;
    } catch ( error ) {
        if ( !state.tunableErrorLogged ) {
            state.tunableErrorLogged = true;
            logger.error( `winkComposer/${state.nodeType}: tunable threw: ${error.message}` );
        }
    }

    state.count += 1;
    // Choose baseline update rule.
    if ( state.alpha === 0 ) {                // running mean
        state.mean += ( xVal - state.mean ) / state.count;
    } else if ( state.count === 1 ) {     // ES baseline: seed with first observation
        state.mean = xVal;
    } else {                             // ES baseline: exponential smoothing
        state.mean += state.alpha * ( xVal - state.mean );
    }

    // Page-Hinkley cumulative sum calculation.
    // Detects positive changes (increase in mean).
    state.cumSum += xVal - state.mean - state.delta;

    // Update running minimum.
    if ( state.cumSum < state.minCumSum ) {
        state.minCumSum = state.cumSum;
    }

    // Change detection: test statistic exceeds threshold.
    state.testStatistic = state.cumSum - state.minCumSum;
    state.shiftDetected = state.testStatistic > state.lambda;
    if ( state.shiftDetected ) {
        state.minCumSum = 0;
        state.cumSum = 0;

        // Trigger controls if present.
        executeTriggers( state );
    }

    return state;
}; // update()

export default update;

