/**
 * @fileoverview 10-Case Switch CPD Benchmark Flow using DSL
 *
 * Ten specializations to test switch/case routing overhead at scale.
 * Only temperature data is sent — the other nine cases never execute.
 * This isolates the routing lookup cost from pipeline execution cost.
 *
 * Pipeline per specialization: sanitize → median3 → esMean(fast) →
 *   esMean(slow) → diff → pageHinkley → persistenceCheck → controller
 */

import { flow } from '../src/flow/flow.js';

const CASE_NAMES = [
    'temperature', 'pressure', 'vibration', 'humidity',
    'flowRate', 'voltage', 'current', 'torque',
    'speed', 'displacement'
];

/**
 * Builds an 8-node CPD chain for the given case prefix.
 * @param {Object} pipeline - Flow builder in case context
 * @param {string} prefix - Node name prefix (e.g. 'temp', 'pres')
 * @returns {Object} Pipeline with chain appended and .break() called
 */
const addCase = function ( pipeline, prefix ) {
    return pipeline
        .sanitize( `${prefix}_sane`, 'value',
            { failureReason: `${prefix}_pcf` },
            { predicate: ( v, _msg ) => ( v <= 50000 ) }
        )
        .median3( `${prefix}_m3`, 'value', { median3: `${prefix}_m3` } )
        .esMean( `${prefix}_fast`, `${prefix}_m3`, { mean: `${prefix}_fast` }, { halfLife: 1.35 } )
        .esMean( `${prefix}_slow`, `${prefix}_m3`, { mean: `${prefix}_slow` }, { halfLife: 13.5 } )
        .diff( `${prefix}_diff`, `${prefix}_fast`, `${prefix}_slow`, { diff: `${prefix}_diff` } )
        .pageHinkley( `${prefix}_ph`, `${prefix}_diff`,
            { phShift: `${prefix}_potentialChange` },
            { delta: 0.9, lambda: 10 }
        )
        .persistenceCheck( `${prefix}_cpd`,
            ( msg ) => msg[ `${prefix}_potentialChange` ],
            { persistenceConfirmed: `${prefix}_changeDetected` }
        )
        .controller( `${prefix}_ctrl`, [ {
            when: ( msg ) => msg[ `${prefix}_changeDetected` ],
            triggers: [ { control: 'reset', targets: [ `${prefix}_fast`, `${prefix}_slow` ] } ]
        } ] )
        .break();
};

const PREFIXES = [
    'temp', 'pres', 'vib', 'hum', 'flow',
    'volt', 'curr', 'torq', 'spd', 'disp'
];

/**
 * Creates and returns a 10-case switch CPD pipeline handle for benchmarking.
 * @returns {Promise<Object>} Pipeline handle with processMessage, shutdown
 */
export const createPipeline = async function () {
    let p = flow( 'cpd-switch10' )
        .assetId( 'id' )
        .switch( 'type' );

    for ( let i = 0; i < CASE_NAMES.length; i += 1 ) {
        p = p.case( CASE_NAMES[ i ] );
        p = addCase( p, PREFIXES[ i ] );
    }

    const handle = await p.run();

    return {
        ...handle,
        meta: {
            name: 'cpd-switch10',
            description: 'CPD with 10-case switch — routing scaling test',
            params: { delta: 0.9, lambda: 10 },
            specializations: CASE_NAMES
        }
    };
};
