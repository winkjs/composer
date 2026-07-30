/**
 * @fileoverview Static CPD Benchmark Flow using DSL
 *
 * Baseline benchmark for Change Point Detection pipeline with static parameters.
 * Uses the flow DSL for proper dogfooding.
 *
 * Pipeline: sanitize → median3 → esMean(fast) → esMean(slow) → diff →
 *           pageHinkley → persistenceCheck → controller
 */

import { flow } from '../src/flow/flow.js';

/**
 * Creates and returns a CPD pipeline handle for benchmarking.
 * @returns {Promise<Object>} Pipeline handle with processMessage, shutdown
 */
export const createPipeline = async function () {
    const pipeline = flow( 'cpd-static' )
        .assetId( 'id' )
        .sanitize( 'sane', 'temp',
            { failureReason: 'pcf' },
            { predicate: ( v, _msg ) => ( v <= 50000 ) }  // Allow for up to 20K partitions (max offset ~40K)
        )
        .median3( 'm3', 'temp', { median3: 'm3' } )
        .esMean( 'fast', 'm3', { mean: 'fast' }, { halfLife: 1.35 } )
        .esMean( 'slow', 'm3', { mean: 'slow' }, { halfLife: 13.5 } )
        .diff( 'diff', 'fast', 'slow', { diff: 'diff' } )
        .pageHinkley( 'ph', 'diff',
            { phShift: 'potentialChange' },
            { delta: 0.9, lambda: 10 }
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
            name: 'cpd-static',
            description: 'CPD with static parameters (baseline)',
            params: { delta: 0.9, lambda: 10 }
        }
    };
};
