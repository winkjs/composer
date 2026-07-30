/**
 * @fileoverview Tunable CPD Benchmark Flow using DSL
 *
 * Benchmark for Change Point Detection pipeline with tunable (dynamic) parameters.
 * Compares overhead of tunable-wrapped parameters vs static baseline.
 *
 * Pipeline: sanitize → median3 → esMean(fast) → esMean(slow) → diff →
 *           pageHinkley → persistenceCheck → controller
 *
 * Tunable-enabled params:
 * - pageHinkley.delta: () => 0.9 (constant tunable)
 * - pageHinkley.lambda: () => 10 (constant tunable)
 */

import { flow } from '../src/flow/flow.js';

/**
 * Creates and returns a CPD pipeline handle with tunable parameters.
 * @returns {Promise<Object>} Pipeline handle with processMessage, shutdown
 */
export const createPipeline = async function () {
    // Tunables that return constant values (measures pure tunable overhead)
    const deltaFn = ( _msg ) => 0.9;
    const lambdaFn = ( _msg ) => 10;

    const pipeline = flow( 'cpd-tunable' )
        .assetId( 'id' )
        .sanitize( 'sane', 'temp',
            { failureReason: 'pcf' },
            { predicate: ( v, _msg ) => ( v <= 5000000 ) }  // Allow for up to 20K partitions (max offset ~40K)
        )
        .median3( 'm3', 'temp', { median3: 'm3' } )
        .esMean( 'fast', 'm3', { mean: 'fast' }, { halfLife: 1.35 } )
        .esMean( 'slow', 'm3', { mean: 'slow' }, { halfLife: 13.5 } )
        .diff( 'diff', 'fast', 'slow', { diff: 'diff' } )
        .pageHinkley( 'ph', 'diff',
            { phShift: 'potentialChange' },
            { delta: deltaFn, lambda: lambdaFn }
        )
        .persistenceCheck( 'cpd',
            ( msg ) => msg.potentialChange,
            { persistenceConfirmed: 'changeDetected' }
        )
        .controller( 'ctrl', [ {
            when: ( msg ) => msg.changeDetected,
            triggers: [ { control: 'reset', targets: [ 'fast', 'slow' ] } ]
        } ] );

    const handle = await pipeline.run();

    return {
        ...handle,
        meta: {
            name: 'cpd-tunable',
            description: 'CPD with tunable parameters (constant functions)',
            params: { delta: 'fn => 0.9', lambda: 'fn => 10' }
        }
    };
};
