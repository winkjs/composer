/**
 * @fileoverview Switch/Case CPD Benchmark Flow using DSL
 *
 * Benchmark for multi-specialization flows where the same partition receives
 * messages of different types (temperature and pressure). Tests the two-level
 * lookup: partitionId → specializationType → graph.
 *
 * Pipeline per specialization:
 *   temperature: sanitize → median3 → esMean(fast) → esMean(slow) → diff →
 *                pageHinkley → persistenceCheck → controller
 *   pressure:    sanitize → median3 → esMean(fast) → esMean(slow) → diff →
 *                pageHinkley → persistenceCheck → controller
 *
 * Both pipelines are identical except for node names and field references.
 * This tests specialization routing overhead, not pipeline differences.
 */

import { flow } from '../src/flow/flow.js';

/**
 * Creates and returns a multi-specialization CPD pipeline handle for benchmarking.
 * @returns {Promise<Object>} Pipeline handle with processMessage, shutdown
 */
export const createPipeline = async function () {
    const pipeline = flow( 'cpd-switch' )
        .assetId( 'id' )
        .switch( 'type' )

        // Temperature specialization
        .case( 'temperature' )
            .sanitize( 'temp_sane', 'value',
                { failureReason: 'temp_pcf' },
                { predicate: ( v, _msg ) => ( v <= 50000 ) }
            )
            .median3( 'temp_m3', 'value', { median3: 'temp_m3' } )
            .esMean( 'temp_fast', 'temp_m3', { mean: 'temp_fast' }, { halfLife: 1.35 } )
            .esMean( 'temp_slow', 'temp_m3', { mean: 'temp_slow' }, { halfLife: 13.5 } )
            .diff( 'temp_diff', 'temp_fast', 'temp_slow', { diff: 'temp_diff' } )
            .pageHinkley( 'temp_ph', 'temp_diff',
                { phShift: 'temp_potentialChange' },
                { delta: 0.9, lambda: 10 }
            )
            .persistenceCheck( 'temp_cpd',
                ( msg ) => msg.temp_potentialChange,
                { persistenceConfirmed: 'temp_changeDetected' }
            )
            .controller( 'temp_ctrl', [ {
                when: ( msg ) => msg.temp_changeDetected,
                triggers: [ { control: 'reset', targets: [ 'temp_fast', 'temp_slow' ] } ]
            } ] )
            .break()

        // Pressure specialization
        .case( 'pressure' )
            .sanitize( 'pres_sane', 'value',
                { failureReason: 'pres_pcf' },
                { predicate: ( v, _msg ) => ( v <= 50000 ) }
            )
            .median3( 'pres_m3', 'value', { median3: 'pres_m3' } )
            .esMean( 'pres_fast', 'pres_m3', { mean: 'pres_fast' }, { halfLife: 1.35 } )
            .esMean( 'pres_slow', 'pres_m3', { mean: 'pres_slow' }, { halfLife: 13.5 } )
            .diff( 'pres_diff', 'pres_fast', 'pres_slow', { diff: 'pres_diff' } )
            .pageHinkley( 'pres_ph', 'pres_diff',
                { phShift: 'pres_potentialChange' },
                { delta: 0.9, lambda: 10 }
            )
            .persistenceCheck( 'pres_cpd',
                ( msg ) => msg.pres_potentialChange,
                { persistenceConfirmed: 'pres_changeDetected' }
            )
            .controller( 'pres_ctrl', [ {
                when: ( msg ) => msg.pres_changeDetected,
                triggers: [ { control: 'reset', targets: [ 'pres_fast', 'pres_slow' ] } ]
            } ] )
            .break();

    const handle = await pipeline.run();

    return {
        ...handle,
        meta: {
            name: 'cpd-switch',
            description: 'CPD with switch/case specialization (temperature + pressure)',
            params: { delta: 0.9, lambda: 10 },
            specializations: [ 'temperature', 'pressure' ]
        }
    };
};
