import { describe, it } from 'mocha';
// @fileoverview
// Golden-truth validation against GUDHI 3.12.0 — the canonical topological
// data analysis library (INRIA). The JSON fixture is generated out-of-band
// by golden-truth-swing-watch.py; this spec reads the JSON only.
//
// For each section we run the node with windowSize = signal.length, feed all
// samples, and compare the final pair set against GUDHI's reference
// persistences. This is an INDEPENDENT reference — it replaces the prior
// in-tree JS oracle (batch-persistence-pairs.js), which was JS-to-JS.

import { expect } from 'chai';
import { readFileSync } from 'fs';
import * as swingWatch from '../index.js';

const goldenTruth = JSON.parse( readFileSync(
    new URL( './golden-truth-swing-watch.json', import.meta.url ),
    'utf8'
) );

// Run the node in batch mode: windowSize = N, feed all samples, extract the
// persistence arrays from state after the final update.
const runBatch = function ( signal, threshold ) {
    const spec = {
        nodeType: 'Swing Watch',
        name: 'gt',
        from: { x: 'v' },
        stats: { dipCompleted: { storeAs: 'me' }, peakCompleted: { storeAs: 'xe' } },
        threshold,
        windowSize: signal.length
    };
    const state = swingWatch.init( spec );
    for ( let i = 0; i < signal.length; i += 1 ) {
        swingWatch.update( state, { v: signal[ i ] } );
    }
    const minP = [];
    for ( let i = 0; i < state.minPairCount; i += 1 ) minP.push( state.minPersArr[ i ] );
    const maxP = [];
    for ( let i = 0; i < state.maxPairCount; i += 1 ) maxP.push( state.maxPersArr[ i ] );
    minP.sort( ( a, b ) => ( a - b ) );
    maxP.sort( ( a, b ) => ( a - b ) );
    return { minP, maxP, minPairCount: state.minPairCount, maxPairCount: state.maxPairCount };
};

describe( 'swingWatch golden-truth cross-validation (GUDHI)', function () {
    for ( const [ key, section ] of Object.entries( goldenTruth.sections ) ) {
        it( `${key}: pair counts and persistences match GUDHI`, function () {
            const result = runBatch( section.signal, section.threshold );
            expect( result.minPairCount ).to.equal( section.minPairCount );
            expect( result.maxPairCount ).to.equal( section.maxPairCount );
            expect( result.minP.length ).to.equal( section.minPersistencesSorted.length );
            expect( result.maxP.length ).to.equal( section.maxPersistencesSorted.length );
            for ( let i = 0; i < result.minP.length; i += 1 ) {
                expect( result.minP[ i ] ).to.be.closeTo(
                    section.minPersistencesSorted[ i ], 1e-9 );
            }
            for ( let i = 0; i < result.maxP.length; i += 1 ) {
                expect( result.maxP[ i ] ).to.be.closeTo(
                    section.maxPersistencesSorted[ i ], 1e-9 );
            }
        } );
    }

    it( 'fixture metadata records GUDHI version', function () {
        // eslint-disable-next-line no-underscore-dangle
        expect( goldenTruth._meta.gudhi_version ).to.be.a( 'string' );
    } );
} );
