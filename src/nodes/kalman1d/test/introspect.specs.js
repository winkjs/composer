// Introspection metadata tests for kalman1d node.
// Covers supported stats, control methods, capabilities, and DSL metadata.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    getSupportedStats,
    getNodeType,
    getCapabilities,
    getSupportedControlMethods,
    getStatDescriptions,
    getDSLMetadata
} from '../index.js';

describe( 'Kalman 1d — introspect', function () {

    it( 'returns supported stats', function () {
        const stats = getSupportedStats();
        expect( stats ).to.deep.equal( [ 'filtered', 'variance', 'innovation', 'innovationGate' ] );
    } );

    it( 'returns defensive copies', function () {
        const stats1 = getSupportedStats();
        const stats2 = getSupportedStats();
        expect( stats1 ).to.not.equal( stats2 );
        expect( stats1 ).to.deep.equal( stats2 );
    } );

    it( 'returns node type', function () {
        expect( getNodeType() ).to.equal( 'Kalman 1d' );
    } );

    it( 'returns capabilities', function () {
        const caps = getCapabilities();
        expect( caps.description ).to.be.a( 'string' );
        expect( caps.features ).to.be.an( 'array' );
        expect( caps.features.length ).to.be.greaterThan( 0 );
    } );

    it( 'returns control methods', function () {
        const methods = getSupportedControlMethods();
        expect( methods ).to.have.property( 'reset' );
        expect( methods ).to.have.property( 'enable' );
        expect( methods ).to.have.property( 'disable' );
        expect( methods ).to.have.property( 'pause' );
        expect( methods ).to.have.property( 'unpause' );
    } );

    it( 'returns stat descriptions', function () {
        const descs = getStatDescriptions();
        expect( descs ).to.have.property( 'filtered' );
        expect( descs ).to.have.property( 'variance' );
        expect( descs ).to.have.property( 'innovation' );
        expect( descs ).to.have.property( 'innovationGate' );
    } );

    it( 'returns DSL metadata with buildSpec', function () {
        const meta = getDSLMetadata();
        expect( meta ).to.have.property( 'specSchema' );
        expect( meta ).to.have.property( 'buildSpec' );
        expect( meta ).to.have.property( 'crossFieldValidators' );
    } );

    it( 'buildSpec produces valid spec', function () {
        const meta = getDSLMetadata();
        const spec = meta.buildSpec(
            'kf', 'temperature',
            { filtered: { storeAs: 'tempEst' } },
            { sensorVariance: 4, control: 'power' }
        );

        expect( spec.nodeType ).to.equal( 'Kalman 1d' );
        expect( spec.name ).to.equal( 'kf' );
        expect( spec.from.x ).to.equal( 'temperature' );
        expect( spec.stats.filtered.storeAs ).to.equal( 'tempEst' );
        expect( spec.sensorVariance ).to.equal( 4 );
        expect( spec.control ).to.equal( 'power' );
    } );
} );
