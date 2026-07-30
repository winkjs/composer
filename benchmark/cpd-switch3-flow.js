/**
 * @fileoverview 3-Case Switch CPD Benchmark Flow using DSL
 *
 * Three specializations (temperature, pressure, vibration) to test whether
 * switch/case routing overhead scales with the number of cases.
 *
 * Pipeline per specialization:
 *   temperature: sanitize → median3 → esMean(fast) → esMean(slow) → diff →
 *                pageHinkley → persistenceCheck → controller
 *   pressure:    (identical 8-node chain)
 *   vibration:   (identical 8-node chain)
 *
 * Only temperature data is sent — the other two cases never execute.
 * This isolates the routing lookup cost from pipeline execution cost.
 */

import { flow } from '../src/flow/flow.js';

/**
 * Creates and returns a 3-case switch CPD pipeline handle for benchmarking.
 * @returns {Promise<Object>} Pipeline handle with processMessage, shutdown
 */
export const createPipeline = async function () {
    const pipeline = flow( 'cpd-switch3' )
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
            .break()

        // Vibration specialization
        .case( 'vibration' )
            .sanitize( 'vib_sane', 'value',
                { failureReason: 'vib_pcf' },
                { predicate: ( v, _msg ) => ( v <= 50000 ) }
            )
            .median3( 'vib_m3', 'value', { median3: 'vib_m3' } )
            .esMean( 'vib_fast', 'vib_m3', { mean: 'vib_fast' }, { halfLife: 1.35 } )
            .esMean( 'vib_slow', 'vib_m3', { mean: 'vib_slow' }, { halfLife: 13.5 } )
            .diff( 'vib_diff', 'vib_fast', 'vib_slow', { diff: 'vib_diff' } )
            .pageHinkley( 'vib_ph', 'vib_diff',
                { phShift: 'vib_potentialChange' },
                { delta: 0.9, lambda: 10 }
            )
            .persistenceCheck( 'vib_cpd',
                ( msg ) => msg.vib_potentialChange,
                { persistenceConfirmed: 'vib_changeDetected' }
            )
            .controller( 'vib_ctrl', [ {
                when: ( msg ) => msg.vib_changeDetected,
                triggers: [ { control: 'reset', targets: [ 'vib_fast', 'vib_slow' ] } ]
            } ] )
            .break();

    const handle = await pipeline.run();

    return {
        ...handle,
        meta: {
            name: 'cpd-switch3',
            description: 'CPD with 3-case switch (temperature + pressure + vibration)',
            params: { delta: 0.9, lambda: 10 },
            specializations: [ 'temperature', 'pressure', 'vibration' ]
        }
    };
};
