/**
 * @fileoverview Winnow Compression Benchmark Flow using DSL.
 *
 * Pipeline: median3 → kalman1d → esStats → trend → controller →
 *           winnow → passIf → kalman1d₂
 *
 * Uses the winnow node for trajectory-aware significance detection.
 * The passIf predicate is stateless (checks msg.store) — all
 * per-partition state lives in the winnow node.
 */

import { flow } from '../src/flow/flow.js';

/**
 * Creates and returns a compression pipeline handle for benchmarking.
 * @returns {Promise<Object>} Pipeline handle with processMessage, shutdown
 */
export const createPipeline = async function () {
    const pipeline = flow( 'compression-winnow' )
        .assetId( 'id' )

        .median3( 'med', 'value', { median3: 'smoothed' } )

        .kalman1d( 'kf', 'smoothed', {
            filtered: 'filtered',
            innovation: 'innovation',
            innovationGate: 'gate'
        }, {
            sensorVariance: 0.005,
            processVariance: 0.004,
            chi2Threshold: 6.63
        } )

        .esStats( 'stats', 'smoothed', {
            stdev: 'stdev',
            mean: 'mean'
        }, { halfLife: 50 } )

        .trend( 'slope', 'smoothed', {
            trend: 'trendDir',
            confidence: 'trendConf',
            rocMean: 'roc'
        }, {
            rocStatsHalfLife: 20,
            rocThreshold: 0.005,
            warmupSamples: 15
        } )

        .controller( 'ctrl', [ {
            when: ( msg ) => Number.isFinite( msg.gate ) && msg.gate > 6.63,
            triggers: [ { control: 'reset', targets: [ 'kf' ] } ]
        } ] )

        .winnow( 'compress', 'smoothed', {
            significant: 'store',
            deviation: 'dev',
            predicted: 'pred'
        }, {
            K: 2,
            tightenBase: 100,
            maxGap: 500,
            chi2Threshold: 6.63
        } )

        .passIf( 'gate', ( msg, counter ) => msg.store === true ) // eslint-disable-line no-unused-vars

        .kalman1d( 'kfSmooth', 'value', {
            filtered: 'storedValue'
        }, {
            sensorVariance: 0.005,
            processVariance: 0.5,
            chi2Threshold: 1000
        } );

    const handle = await pipeline.run();

    return {
        ...handle,
        meta: {
            name: 'compression-winnow',
            description: 'Compression with winnow node (8-node pipeline)',
            params: { K: 2, tightenBase: 100, maxGap: 500 }
        }
    };
};
