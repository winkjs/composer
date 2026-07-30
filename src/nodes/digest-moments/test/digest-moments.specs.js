/* eslint-disable no-unused-expressions */
/**
 * Comprehensive test suite for digestMoments node.
 * Tests conversion of raw moments to displayable statistics.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as digestMoments from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';
import {
    computeVariance,
    computeCV,
    computeSkew,
    computeKurtosis
} from '../formulas.js';

// Helper function to create test messages with moments from momentsDigest
const createMomentsMessage = function ( prefix, values ) {
    const msg = Object.create( null );
    msg[ prefix + '_n' ] = values.n;
    msg[ prefix + '_M1' ] = values.M1;
    msg[ prefix + '_M2' ] = values.M2;
    if ( values.M3 !== undefined ) msg[ prefix + '_M3' ] = values.M3;
    if ( values.M4 !== undefined ) msg[ prefix + '_M4' ] = values.M4;
    if ( values.min !== undefined ) msg[ prefix + '_min' ] = values.min;
    if ( values.max !== undefined ) msg[ prefix + '_max' ] = values.max;
    return msg;
};

describe( 'DigestMoments Node', function () {
    describe( 'Basic functionality', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'stats',
                from: { x: 'vibSD' },
                stats: {
                    mean: { storeAs: 'vibMean' },
                    variance: { storeAs: 'vibVar' },
                    stddev: { storeAs: 'vibStd' }
                }
            };
            state = digestMoments.init( spec );
        } );

        it( 'computes mean from M1', function () {
            const msg = createMomentsMessage( 'vibSD', { n: 10, M1: 42.5, M2: 100 } );
            digestMoments.update( state, msg );
            expect( state.mean ).to.equal( 42.5 );
        } );

        it( 'computes sample variance correctly', function () {
            // M2 = 90, n = 10, sample variance = 90 / 9 = 10
            const msg = createMomentsMessage( 'vibSD', { n: 10, M1: 50, M2: 90 } );
            digestMoments.update( state, msg );
            expect( state.variance ).to.equal( 10 );
        } );

        it( 'computes stddev correctly', function () {
            // variance = 10, stddev = sqrt(10) ≈ 3.162
            const msg = createMomentsMessage( 'vibSD', { n: 10, M1: 50, M2: 90 } );
            digestMoments.update( state, msg );
            expect( state.stddev ).to.be.closeTo( Math.sqrt( 10 ), 1e-10 );
        } );
    } );

    describe( 'Biased variance mode', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'biasedStats',
                from: { x: 'temp' },
                biased: true,
                stats: { variance: { storeAs: 'popVar' } }
            };
            state = digestMoments.init( spec );
        } );

        it( 'computes population variance with biased=true', function () {
            // M2 = 90, n = 10, population variance = 90 / 10 = 9
            const msg = createMomentsMessage( 'temp', { n: 10, M1: 50, M2: 90 } );
            digestMoments.update( state, msg );
            expect( state.variance ).to.equal( 9 );
        } );
    } );

    describe( 'All statistics', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'allStats',
                from: { x: 'data' },
                stats: {
                    mean: { storeAs: 'avg' },
                    variance: { storeAs: 'var' },
                    stddev: { storeAs: 'std' },
                    cv: { storeAs: 'cv' },
                    skew: { storeAs: 'skew' },
                    kurtosis: { storeAs: 'kurt' },
                    min: { storeAs: 'minVal' },
                    max: { storeAs: 'maxVal' }
                }
            };
            state = digestMoments.init( spec );
        } );

        it( 'computes all stats with valid moments', function () {
            const msg = createMomentsMessage( 'data', {
                n: 100,
                M1: 50,
                M2: 1000,    // variance = 1000/99 ≈ 10.1, m2 = 10
                M3: 500,     // m3 = 5
                M4: 30000,   // m4 = 300
                min: 20,
                max: 80
            } );
            digestMoments.update( state, msg );

            expect( state.mean ).to.equal( 50 );
            expect( state.variance ).to.be.closeTo( 1000 / 99, 1e-10 );
            expect( state.stddev ).to.be.closeTo( Math.sqrt( 1000 / 99 ), 1e-10 );
            expect( Number.isFinite( state.cv ) ).to.be.true;
            expect( Number.isFinite( state.skew ) ).to.be.true;
            expect( Number.isFinite( state.kurtosis ) ).to.be.true;
            expect( state.min ).to.equal( 20 );
            expect( state.max ).to.equal( 80 );
        } );

        it( 'computes cv correctly', function () {
            const msg = createMomentsMessage( 'data', {
                n: 100, M1: 50, M2: 1000, M3: 0, M4: 0, min: 0, max: 100
            } );
            digestMoments.update( state, msg );

            // CV = stddev / |mean|
            const stddev = Math.sqrt( 1000 / 99 );
            expect( state.cv ).to.be.closeTo( stddev / 50, 1e-10 );
        } );
    } );

    describe( 'Edge cases - n < 2', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'edgeCase',
                from: { x: 'sensor' },
                stats: {
                    mean: { storeAs: 'avg' },
                    variance: { storeAs: 'var' },
                    stddev: { storeAs: 'std' },
                    skew: { storeAs: 'skew' },
                    kurtosis: { storeAs: 'kurt' }
                }
            };
            state = digestMoments.init( spec );
        } );

        it( 'returns NaN for variance when n=1', function () {
            const msg = createMomentsMessage( 'sensor', { n: 1, M1: 42, M2: 0 } );
            digestMoments.update( state, msg );
            expect( state.mean ).to.equal( 42 );
            expect( Number.isNaN( state.variance ) ).to.be.true;
            expect( Number.isNaN( state.stddev ) ).to.be.true;
        } );

        it( 'returns NaN for higher moments when n<2', function () {
            const msg = createMomentsMessage( 'sensor', { n: 1, M1: 42, M2: 0 } );
            digestMoments.update( state, msg );
            expect( Number.isNaN( state.skew ) ).to.be.true;
            expect( Number.isNaN( state.kurtosis ) ).to.be.true;
        } );
    } );

    describe( 'Edge cases - variance near zero', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'zeroVar',
                from: { x: 'const' },
                stats: {
                    variance: { storeAs: 'var' },
                    skew: { storeAs: 'skew' },
                    kurtosis: { storeAs: 'kurt' }
                }
            };
            state = digestMoments.init( spec );
        } );

        it( 'returns zero variance for constant values', function () {
            // M2 ≈ 0 means all values are the same
            const msg = createMomentsMessage( 'const', { n: 100, M1: 42, M2: 1e-15 } );
            digestMoments.update( state, msg );
            expect( state.variance ).to.equal( 0 );
        } );

        it( 'returns NaN for skew when variance < epsilon', function () {
            const msg = createMomentsMessage( 'const', { n: 100, M1: 42, M2: 1e-15, M3: 0 } );
            digestMoments.update( state, msg );
            expect( Number.isNaN( state.skew ) ).to.be.true;
        } );

        it( 'returns NaN for kurtosis when variance < epsilon', function () {
            const msg = createMomentsMessage( 'const', { n: 100, M1: 42, M2: 1e-15, M4: 0 } );
            digestMoments.update( state, msg );
            expect( Number.isNaN( state.kurtosis ) ).to.be.true;
        } );
    } );

    describe( 'Edge cases - mean near zero', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'zeroMean',
                from: { x: 'centered' },
                stats: { cv: { storeAs: 'cv' } }
            };
            state = digestMoments.init( spec );
        } );

        it( 'returns NaN for cv when mean < epsilon', function () {
            const msg = createMomentsMessage( 'centered', { n: 100, M1: 1e-15, M2: 100 } );
            digestMoments.update( state, msg );
            expect( Number.isNaN( state.cv ) ).to.be.true;
        } );
    } );

    describe( 'Custom epsilon', function () {
        it( 'uses custom epsilon for numerical stability', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'customEps',
                from: { x: 'data' },
                epsilon: 1e-6,  // Higher threshold
                stats: { cv: { storeAs: 'cv' } }
            };
            const state = digestMoments.init( spec );

            // Mean of 1e-8 should trigger NaN with epsilon=1e-6
            const msg = createMomentsMessage( 'data', { n: 100, M1: 1e-8, M2: 100 } );
            digestMoments.update( state, msg );
            expect( Number.isNaN( state.cv ) ).to.be.true;
        } );
    } );

    describe( 'Invalid input handling', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'validator',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            state = digestMoments.init( spec );
        } );

        it( 'sets inputValidationFailed on invalid inputs (NaN, Infinity, missing)', function () {
            // NaN in n
            digestMoments.update( state, createMomentsMessage( 'sensor', { n: NaN, M1: 42, M2: 100 } ) );
            expect( state.inputValidationFailed ).to.be.true;
            // NaN in M1
            digestMoments.update( state, createMomentsMessage( 'sensor', { n: 10, M1: NaN, M2: 100 } ) );
            expect( state.inputValidationFailed ).to.be.true;
            // NaN in M2
            digestMoments.update( state, createMomentsMessage( 'sensor', { n: 10, M1: 42, M2: NaN } ) );
            expect( state.inputValidationFailed ).to.be.true;
            // Infinity
            digestMoments.update( state, createMomentsMessage( 'sensor', { n: 10, M1: Infinity, M2: 100 } ) );
            expect( state.inputValidationFailed ).to.be.true;
            // Missing field
            digestMoments.update( state, createMomentsMessage( 'sensor', { n: 10 } ) );
            expect( state.inputValidationFailed ).to.be.true;
        } );

        it( 'recovers from invalid input', function () {
            digestMoments.update( state, createMomentsMessage( 'sensor', { n: NaN, M1: 42, M2: 100 } ) );
            expect( state.inputValidationFailed ).to.be.true;
            digestMoments.update( state, createMomentsMessage( 'sensor', { n: 10, M1: 50, M2: 100 } ) );
            expect( state.inputValidationFailed ).to.be.false;
            expect( state.mean ).to.equal( 50 );
        } );
    } );

    describe( 'n pass-through', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'nPassThru',
                from: { x: 'sensor' },
                stats: { n: { storeAs: 'sampleCount' }, mean: { storeAs: 'avg' } }
            };
            state = digestMoments.init( spec );
        } );

        it( 'passes through n value', function () {
            const msg = createMomentsMessage( 'sensor', { n: 42, M1: 50, M2: 100 } );
            digestMoments.update( state, msg );
            expect( state.n ).to.equal( 42 );
        } );

        it( 'publishes n to configured storeAs field', function () {
            const msg = createMomentsMessage( 'sensor', { n: 100, M1: 50, M2: 100 } );
            digestMoments.update( state, msg );
            const output = Object.create( null );
            digestMoments.publishTo( state, output );
            expect( output.sampleCount ).to.equal( 100 );
        } );

        it( 'initializes state.n slot when n stat requested', function () {
            expect( state.n ).to.satisfy( ( v ) => Number.isNaN( v ) );
        } );

        it( 'does not initialize state.n when n stat not requested', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'noN',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const noNState = digestMoments.init( spec );
            expect( noNState.n ).to.be.undefined;
        } );
    } );

    describe( 'Min/max pass-through', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'minmax',
                from: { x: 'sensor' },
                stats: { min: { storeAs: 'lo' }, max: { storeAs: 'hi' } }
            };
            state = digestMoments.init( spec );
        } );

        it( 'passes through min and max', function () {
            const msg = createMomentsMessage( 'sensor', {
                n: 10, M1: 50, M2: 100, min: 25, max: 75
            } );
            digestMoments.update( state, msg );
            expect( state.min ).to.equal( 25 );
            expect( state.max ).to.equal( 75 );
        } );

        it( 'returns NaN for invalid min', function () {
            const msg = createMomentsMessage( 'sensor', {
                n: 10, M1: 50, M2: 100, min: NaN, max: 75
            } );
            digestMoments.update( state, msg );
            expect( Number.isNaN( state.min ) ).to.be.true;
            expect( state.max ).to.equal( 75 );
        } );

        it( 'returns NaN for missing max', function () {
            const msg = createMomentsMessage( 'sensor', {
                n: 10, M1: 50, M2: 100, min: 25
                // max not set
            } );
            digestMoments.update( state, msg );
            expect( state.min ).to.equal( 25 );
            expect( Number.isNaN( state.max ) ).to.be.true;
        } );
    } );

    describe( 'Publishing', function () {
        it( 'publishes stats to configured storeAs fields', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'pub',
                from: { x: 'data' },
                stats: {
                    mean: { storeAs: 'outMean' },
                    stddev: { storeAs: 'outStd' }
                }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'data', { n: 10, M1: 42, M2: 90 } );
            digestMoments.update( state, msg );

            const output = Object.create( null );
            digestMoments.publishTo( state, output );
            expect( output.outMean ).to.equal( 42 );
            expect( output.outStd ).to.be.closeTo( Math.sqrt( 10 ), 1e-10 );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'nanPub',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: NaN, M1: 42, M2: 100 } );
            digestMoments.update( state, msg );

            const output = Object.create( null );
            digestMoments.publishTo( state, output );
            expect( Number.isNaN( output.avg ) ).to.be.true;
        } );

        it( 'does not publish when disabled', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'disabledPub',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: 10, M1: 42, M2: 100 } );
            digestMoments.update( state, msg );
            state.disable = true;

            const output = Object.create( null );
            digestMoments.publishTo( state, output );
            expect( output.avg ).to.be.undefined;
        } );
    } );

    describe( 'Disable functionality', function () {
        it( 'skips update when disabled', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'disableTest',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = digestMoments.init( spec );

            let msg = createMomentsMessage( 'sensor', { n: 10, M1: 42, M2: 100 } );
            digestMoments.update( state, msg );
            expect( state.mean ).to.equal( 42 );

            state.disable = true;

            msg = createMomentsMessage( 'sensor', { n: 10, M1: 99, M2: 100 } );
            digestMoments.update( state, msg );
            expect( state.mean ).to.equal( 42 ); // Unchanged

            state.disable = false;
            msg = createMomentsMessage( 'sensor', { n: 10, M1: 50, M2: 100 } );
            digestMoments.update( state, msg );
            expect( state.mean ).to.equal( 50 );
        } );
    } );

    describe( 'Reset and Recompute', function () {
        it( 'reset returns true (stateless node)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'resetTest',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = digestMoments.init( spec );
            expect( digestMoments.reset( state ) ).to.be.true;
        } );

        it( 'recompute returns true (stateless node)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'recomputeTest',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = digestMoments.init( spec );
            expect( digestMoments.recompute( state ) ).to.be.true;
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid specs', function () {
            // invalid nodeType
            expect( () => digestMoments.init( { nodeType: 'INVALID', name: 'test', from: { x: 'sensor' }, stats: { mean: { storeAs: 'avg' } } } ) ).to.throw();
            // invalid name
            expect( () => digestMoments.init( { nodeType: 'Digest Moments', name: '123-invalid', from: { x: 'sensor' }, stats: { mean: { storeAs: 'avg' } } } ) ).to.throw();
            // missing from.x
            expect( () => digestMoments.init( { nodeType: 'Digest Moments', name: 'test', from: {}, stats: { mean: { storeAs: 'avg' } } } ) ).to.throw();
            // from.x with spaces
            expect( () => digestMoments.init( { nodeType: 'Digest Moments', name: 'test', from: { x: 'bad field' }, stats: { mean: { storeAs: 'avg' } } } ) ).to.throw();
            // missing stats
            expect( () => digestMoments.init( { nodeType: 'Digest Moments', name: 'test', from: { x: 'sensor' } } ) ).to.throw();
            // unsupported stat
            expect( () => digestMoments.init( { nodeType: 'Digest Moments', name: 'test', from: { x: 'sensor' }, stats: { rms: { storeAs: 'out' } } } ) ).to.throw();
        } );

        it( 'accepts valid specs with various options', function () {
            // minimal spec
            expect( () => digestMoments.init( { nodeType: 'Digest Moments', name: 'valid', from: { x: 'sensor' }, stats: { mean: { storeAs: 'avg' } } } ) ).to.not.throw();
            // full spec with all options
            const fullSpec = {
                nodeType: 'Digest Moments',
                name: 'full',
                from: { x: 'sensor' },
                biased: true,
                epsilon: 1e-10,
                stats: { mean: { storeAs: 'avg' }, variance: { storeAs: 'var' }, stddev: { storeAs: 'std' }, cv: { storeAs: 'cv' }, skew: { storeAs: 'skew' }, kurtosis: { storeAs: 'kurt' }, min: { storeAs: 'minVal' }, max: { storeAs: 'maxVal' } }
            };
            expect( () => digestMoments.init( fullSpec ) ).to.not.throw();
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'getNodeType and getSupportedStats', function () {
            expect( getNodeType() ).to.equal( 'Digest Moments' );
            const stats = getSupportedStats();
            expect( stats ).to.include.members( [ 'n', 'mean', 'variance', 'stddev', 'skew', 'kurtosis', 'cv', 'min', 'max' ] );
            // Returns a copy (mutation safe)
            stats.push( 'mutation' );
            expect( getSupportedStats() ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions, getSupportedControlMethods, getCapabilities', function () {
            const desc = getStatDescriptions();
            expect( desc ).to.have.property( 'n' ).that.is.a( 'string' );
            expect( desc ).to.have.property( 'mean' ).that.is.a( 'string' );
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'enable' );
            expect( methods ).to.have.property( 'disable' );
            const cap = getCapabilities();
            expect( cap ).to.have.property( 'description' ).that.is.a( 'string' );
            expect( cap ).to.have.property( 'features' ).that.is.an( 'array' );
        } );

        it( 'getDSLMetadata and DEFAULT_OPTIONS', function () {
            const dsl = getDSLMetadata();
            expect( dsl ).to.have.property( 'specSchema' );
            expect( dsl ).to.have.property( 'buildSpec' );
            expect( DEFAULT_OPTIONS ).to.deep.equal( { biased: false, epsilon: 1e-12 } );
        } );
    } );

    describe( 'DSL buildSpec', function () {
        it( 'builds basic spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'myStats',
                'vibSD',
                { mean: { storeAs: 'vibMean' } },
                {}
            );

            expect( spec.nodeType ).to.equal( 'Digest Moments' );
            expect( spec.name ).to.equal( 'myStats' );
            expect( spec.from ).to.deep.equal( { x: 'vibSD' } );
            expect( spec.stats.mean.storeAs ).to.equal( 'vibMean' );
        } );

        it( 'builds spec with options', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'biasedStats',
                'temp',
                { variance: { storeAs: 'popVar' } },
                { biased: true, epsilon: 1e-6 }
            );

            expect( spec.biased ).to.equal( true );
            expect( spec.epsilon ).to.equal( 1e-6 );
        } );
    } );

    describe( 'Formula helpers', function () {
        it( 'computeVariance: sample and population variance', function () {
            expect( computeVariance( 90, 10, false ) ).to.equal( 10 );  // sample
            expect( computeVariance( 90, 10, true ) ).to.equal( 9 );    // population
        } );

        it( 'computeCV: normal and edge cases', function () {
            expect( computeCV( 5, 50, 1e-12 ) ).to.equal( 0.1 );
            expect( Number.isNaN( computeCV( 5, 1e-15, 1e-12 ) ) ).to.be.true;  // mean near zero
        } );

        it( 'computeSkew: normal, NaN, and edge cases', function () {
            const result = computeSkew( 100, 100, 10, 1e-12 );
            expect( result ).to.be.closeTo( 1 / Math.pow( 10, 1.5 ), 1e-10 );
            expect( Number.isNaN( computeSkew( NaN, 100, 10, 1e-12 ) ) ).to.be.true;  // invalid M3
            expect( computeSkew( 100, 100, 1e-20, 1e-12 ) ).to.equal( 0 );  // denom < eps
        } );

        it( 'computeKurtosis: normal, NaN, and edge cases', function () {
            const expected = ( ( 300 / 100 ) / ( 10 * 10 ) ) - 3;
            expect( computeKurtosis( 300, 100, 10, 1e-12 ) ).to.be.closeTo( expected, 1e-10 );
            expect( Number.isNaN( computeKurtosis( NaN, 100, 10, 1e-12 ) ) ).to.be.true;  // invalid M4
            expect( computeKurtosis( 300, 100, 1e-20, 1e-12 ) ).to.equal( -3 );  // denom < eps
        } );
    } );

    describe( 'Only requested stats computed', function () {
        it( 'only initializes requested stat slots', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'partial',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = digestMoments.init( spec );

            expect( state.mean ).to.satisfy( ( v ) => Number.isNaN( v ) );
            expect( state.variance ).to.be.undefined;
            expect( state.stddev ).to.be.undefined;
            expect( state.skew ).to.be.undefined;
            expect( state.kurtosis ).to.be.undefined;
        } );
    } );

    describe( 'Branch coverage - setVarianceStatsNaN', function () {
        it( 'sets NaN for variance/stddev but not cv when cv not requested (n<2)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'noCv',
                from: { x: 'sensor' },
                stats: {
                    variance: { storeAs: 'var' },
                    stddev: { storeAs: 'std' }
                    // cv NOT requested
                }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: 1, M1: 42, M2: 100 } );
            digestMoments.update( state, msg );

            expect( Number.isNaN( state.variance ) ).to.be.true;
            expect( Number.isNaN( state.stddev ) ).to.be.true;
            expect( state.cv ).to.be.undefined;
        } );

        it( 'sets NaN for skew/kurtosis but not cv when cv not requested (n<2)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'noCV2',
                from: { x: 'sensor' },
                stats: {
                    skew: { storeAs: 'skew' },
                    kurtosis: { storeAs: 'kurt' }
                }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: 1, M1: 42, M2: 100 } );
            digestMoments.update( state, msg );

            expect( Number.isNaN( state.skew ) ).to.be.true;
            expect( Number.isNaN( state.kurtosis ) ).to.be.true;
        } );

        it( 'sets NaN for cv when cv IS requested and n<2 (TRUE branch)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'cvNaN',
                from: { x: 'sensor' },
                stats: { cv: { storeAs: 'cv' } }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: 1, M1: 42, M2: 100 } );
            digestMoments.update( state, msg );

            expect( Number.isNaN( state.cv ) ).to.be.true;
        } );
    } );

    describe( 'Branch coverage - m2 < eps block', function () {
        it( 'sets variance=0 but skips stddev/cv when not requested (m2<eps)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'varOnly',
                from: { x: 'sensor' },
                stats: {
                    variance: { storeAs: 'var' }
                    // stddev and cv NOT requested
                }
            };
            const state = digestMoments.init( spec );

            // m2 = 1e-15/100 = 1e-17 < epsilon (1e-12)
            const msg = createMomentsMessage( 'sensor', { n: 100, M1: 42, M2: 1e-15 } );
            digestMoments.update( state, msg );

            expect( state.variance ).to.equal( 0 );
            expect( state.stddev ).to.be.undefined;
            expect( state.cv ).to.be.undefined;
        } );

        it( 'sets variance=0, skew=NaN but skips cv when not requested (m2<eps)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'varSkew',
                from: { x: 'sensor' },
                stats: {
                    variance: { storeAs: 'var' },
                    skew: { storeAs: 'skew' }
                    // cv NOT requested
                }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: 100, M1: 42, M2: 1e-15, M3: 0 } );
            digestMoments.update( state, msg );

            expect( state.variance ).to.equal( 0 );
            expect( Number.isNaN( state.skew ) ).to.be.true;
            expect( state.cv ).to.be.undefined;
        } );

        it( 'sets stddev=0 when requested and m2<eps (TRUE branch)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'stdZero',
                from: { x: 'sensor' },
                stats: { stddev: { storeAs: 'std' } }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: 100, M1: 42, M2: 1e-15 } );
            digestMoments.update( state, msg );

            expect( state.stddev ).to.equal( 0 );
        } );

        it( 'sets cv=NaN when requested and m2<eps (TRUE branch)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'cvNaN',
                from: { x: 'sensor' },
                stats: { cv: { storeAs: 'cv' } }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: 100, M1: 42, M2: 1e-15 } );
            digestMoments.update( state, msg );

            expect( Number.isNaN( state.cv ) ).to.be.true;
        } );

        it( 'sets kurtosis=NaN when requested and m2<eps (TRUE branch)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'kurtNaN',
                from: { x: 'sensor' },
                stats: { kurtosis: { storeAs: 'kurt' } }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: 100, M1: 42, M2: 1e-15, M4: 0 } );
            digestMoments.update( state, msg );

            expect( Number.isNaN( state.kurtosis ) ).to.be.true;
        } );
    } );

    describe( 'Branch coverage - partial stats', function () {
        it( 'publishes only mean (covers FALSE branches for all other stats)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'meanOnly',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = digestMoments.init( spec );
            const msg = createMomentsMessage( 'sensor', { n: 10, M1: 42, M2: 100 } );
            digestMoments.update( state, msg );
            const output = Object.create( null );
            digestMoments.publishTo( state, output );
            expect( output.avg ).to.equal( 42 );
            expect( output ).to.not.have.property( 'var' );
        } );

        it( 'publishes each stat individually (covers TRUE branches)', function () {
            // Test variance
            let spec = { nodeType: 'Digest Moments', name: 'v', from: { x: 's' }, stats: { variance: { storeAs: 'v' } } };
            let state = digestMoments.init( spec );
            digestMoments.update( state, createMomentsMessage( 's', { n: 10, M1: 42, M2: 90 } ) );
            let out = Object.create( null );
            digestMoments.publishTo( state, out );
            expect( out.v ).to.equal( 10 );

            // Test stddev
            spec = { nodeType: 'Digest Moments', name: 'sd', from: { x: 's' }, stats: { stddev: { storeAs: 'sd' } } };
            state = digestMoments.init( spec );
            digestMoments.update( state, createMomentsMessage( 's', { n: 10, M1: 42, M2: 90 } ) );
            out = Object.create( null );
            digestMoments.publishTo( state, out );
            expect( out.sd ).to.be.closeTo( Math.sqrt( 10 ), 1e-10 );

            // Test cv
            spec = { nodeType: 'Digest Moments', name: 'c', from: { x: 's' }, stats: { cv: { storeAs: 'c' } } };
            state = digestMoments.init( spec );
            digestMoments.update( state, createMomentsMessage( 's', { n: 10, M1: 50, M2: 90 } ) );
            out = Object.create( null );
            digestMoments.publishTo( state, out );
            expect( Number.isFinite( out.c ) ).to.be.true;

            // Test skew
            spec = { nodeType: 'Digest Moments', name: 'sk', from: { x: 's' }, stats: { skew: { storeAs: 'sk' } } };
            state = digestMoments.init( spec );
            digestMoments.update( state, createMomentsMessage( 's', { n: 100, M1: 50, M2: 1000, M3: 500 } ) );
            out = Object.create( null );
            digestMoments.publishTo( state, out );
            expect( Number.isFinite( out.sk ) ).to.be.true;

            // Test kurtosis
            spec = { nodeType: 'Digest Moments', name: 'k', from: { x: 's' }, stats: { kurtosis: { storeAs: 'k' } } };
            state = digestMoments.init( spec );
            digestMoments.update( state, createMomentsMessage( 's', { n: 100, M1: 50, M2: 1000, M4: 30000 } ) );
            out = Object.create( null );
            digestMoments.publishTo( state, out );
            expect( Number.isFinite( out.k ) ).to.be.true;

            // Test min
            spec = { nodeType: 'Digest Moments', name: 'mi', from: { x: 's' }, stats: { min: { storeAs: 'mi' } } };
            state = digestMoments.init( spec );
            digestMoments.update( state, createMomentsMessage( 's', { n: 10, M1: 50, M2: 100, min: 25 } ) );
            out = Object.create( null );
            digestMoments.publishTo( state, out );
            expect( out.mi ).to.equal( 25 );

            // Test max
            spec = { nodeType: 'Digest Moments', name: 'ma', from: { x: 's' }, stats: { max: { storeAs: 'ma' } } };
            state = digestMoments.init( spec );
            digestMoments.update( state, createMomentsMessage( 's', { n: 10, M1: 50, M2: 100, max: 75 } ) );
            out = Object.create( null );
            digestMoments.publishTo( state, out );
            expect( out.ma ).to.equal( 75 );
        } );

        it( 'returns early when only mean/min/max requested (no variance stats)', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'noVariance',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' }, min: { storeAs: 'lo' }, max: { storeAs: 'hi' } }
            };
            const state = digestMoments.init( spec );
            const msg = createMomentsMessage( 'sensor', { n: 10, M1: 42, M2: 100, min: 20, max: 60 } );
            digestMoments.update( state, msg );
            expect( state.mean ).to.equal( 42 );
            expect( state.min ).to.equal( 20 );
            expect( state.max ).to.equal( 60 );
            expect( state.variance ).to.be.undefined;
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'pauseTest',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = digestMoments.init( spec );

            const msg1 = createMomentsMessage( 'sensor', { n: 10, M1: 42, M2: 100 } );
            digestMoments.update( state, msg1 );
            expect( state.mean ).to.equal( 42 );

            state.pause = true;
            const msg2 = createMomentsMessage( 'sensor', { n: 10, M1: 99, M2: 100 } );
            digestMoments.update( state, msg2 );

            expect( state.mean ).to.equal( 42 );
        } );

        it( 'publishes when paused', function () {
            const spec = {
                nodeType: 'Digest Moments',
                name: 'pausePub',
                from: { x: 'sensor' },
                stats: { mean: { storeAs: 'avg' } }
            };
            const state = digestMoments.init( spec );

            const msg = createMomentsMessage( 'sensor', { n: 10, M1: 42, M2: 100 } );
            digestMoments.update( state, msg );

            state.pause = true;
            const output = Object.create( null );
            digestMoments.publishTo( state, output );

            expect( output.avg ).to.equal( 42 );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );
} );
