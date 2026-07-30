/**
 * @fileoverview Dual CPD Benchmark Flow — NaN Propagation Test
 *
 * Two CPD pipelines (temp + pressure) in a single linear chain.
 * Only temp data arrives — pressure nodes idle via NaN propagation.
 * Measures the cost of idle nodes in a shared pipeline.
 *
 * Pipeline: sanitize → median3 → esMean(fast) → esMean(slow) → diff →
 *           pageHinkley → persistenceCheck → controller →
 *           p_sanitize → p_median3 → p_esMean(p_fast) → p_esMean(p_slow) →
 *           p_diff → p_pageHinkley → p_persistenceCheck → p_controller
 */

import { flow } from '../src/flow/flow.js';

/**
 * Creates and returns a dual CPD pipeline handle for benchmarking.
 * @returns {Promise<Object>} Pipeline handle with processMessage, shutdown
 */
export const createPipeline = async function () {
    const pipeline = flow( 'cpd-dual' )
        .assetId( 'id' )
        // ================================================================
        // Temp pipeline (8 nodes) — active, processes temp data
        // ================================================================
        .sanitize( 'sane', 'temp',
            { failureReason: 'pcf' },
            { predicate: ( v, _msg ) => ( v <= 50000 ) }
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
        } ] )
        // ================================================================
        // Pressure pipeline (8 nodes) — idle, msg.pressure is undefined
        // NaN propagation: Number.isFinite(undefined) → false → skip
        // ================================================================
        .sanitize( 'p_sane', 'pressure',
            { failureReason: 'p_pcf' },
            { predicate: ( v, _msg ) => ( v <= 50000 ) }
        )
        .median3( 'p_m3', 'pressure', { median3: 'p_m3' } )
        .esMean( 'p_fast', 'p_m3', { mean: 'p_fast' }, { halfLife: 1.35 } )
        .esMean( 'p_slow', 'p_m3', { mean: 'p_slow' }, { halfLife: 13.5 } )
        .diff( 'p_diff', 'p_fast', 'p_slow', { diff: 'p_diff' } )
        .pageHinkley( 'p_ph', 'p_diff',
            { phShift: 'p_potentialChange' },
            { delta: 0.9, lambda: 10 }
        )
        .persistenceCheck( 'p_cpd',
            ( msg ) => msg.p_potentialChange,
            { persistenceConfirmed: 'p_changeDetected' }
        )
        .controller( 'p_ctrl', [ {
            when: ( msg ) => msg.p_changeDetected,
            triggers: [ { control: 'reset', targets: [ 'p_fast', 'p_slow' ] } ]
        } ] );

    const handle = await pipeline.run();

    return {
        ...handle,
        meta: {
            name: 'cpd-dual',
            description: 'CPD dual pipeline — NaN propagation overhead test',
            params: { delta: 0.9, lambda: 10 },
            nodes: 16
        }
    };
};
