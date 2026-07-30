/* eslint-disable no-unused-expressions */
/**
 * Comprehensive test suite for ratio node.
 * Tests two-field ratio computation (x / y) with optional log scale.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import * as ratio from '../index.js';
import {
    getDSLMetadata,
    getSupportedStats,
    getStatDescriptions,
    getSupportedControlMethods,
    getNodeType,
    getCapabilities,
    DEFAULT_OPTIONS
} from '../introspect.js';

// Helper function to create test messages
const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

describe( 'Ratio Node', function () {
    describe( 'Linear ratio (default)', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'scale',
                from: { x: 'actual', y: 'reference' },
                stats: { ratio: { storeAs: 'scaleFactor' } }
            };
            state = ratio.init( spec );
        } );

        it( 'computes ratio greater than 1', function () {
            ratio.update( state, createMessage( { actual: 100, reference: 50 } ) );
            expect( state.ratio ).to.equal( 2 );
        } );

        it( 'computes ratio less than 1', function () {
            ratio.update( state, createMessage( { actual: 25, reference: 100 } ) );
            expect( state.ratio ).to.equal( 0.25 );
        } );

        it( 'computes ratio equal to 1', function () {
            ratio.update( state, createMessage( { actual: 50, reference: 50 } ) );
            expect( state.ratio ).to.equal( 1 );
        } );

        it( 'handles negative numerator', function () {
            ratio.update( state, createMessage( { actual: -20, reference: 10 } ) );
            expect( state.ratio ).to.equal( -2 );
        } );

        it( 'handles negative denominator', function () {
            ratio.update( state, createMessage( { actual: 20, reference: -10 } ) );
            expect( state.ratio ).to.equal( -2 );
        } );

        it( 'handles both negative', function () {
            ratio.update( state, createMessage( { actual: -20, reference: -10 } ) );
            expect( state.ratio ).to.equal( 2 );
        } );

        it( 'handles zero numerator', function () {
            ratio.update( state, createMessage( { actual: 0, reference: 100 } ) );
            expect( state.ratio ).to.equal( 0 );
        } );
    } );

    describe( 'Linear ratio with scaleBy', function () {
        it( 'computes scaled ratio', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'scaled',
                from: { x: 'a', y: 'b' },
                scaleBy: 100,
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 10, b: 5 } ) );
            expect( state.ratio ).to.equal( 200 );
        } );

        it( 'applies fractional scaleBy', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'fractional',
                from: { x: 'a', y: 'b' },
                scaleBy: 0.001,
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 50, b: 10 } ) );
            expect( state.ratio ).to.be.closeTo( 0.005, 1e-15 );
        } );

        it( 'preserves sign with negative numerator', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'negNum',
                from: { x: 'a', y: 'b' },
                scaleBy: 3600,
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: -10, b: 5 } ) );
            expect( state.ratio ).to.equal( -7200 );
        } );

        it( 'preserves sign with negative denominator', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'negDen',
                from: { x: 'a', y: 'b' },
                scaleBy: 3600,
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 10, b: -5 } ) );
            expect( state.ratio ).to.equal( -7200 );
        } );

        it( 'default scaleBy produces unscaled ratio', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'defaultScale',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 10, b: 5 } ) );
            expect( state.ratio ).to.equal( 2 );
        } );

        it( 'returns NaN with scaleBy when denominator below minY', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'scaleMinY',
                from: { x: 'a', y: 'b' },
                scaleBy: 3600,
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 100, b: 0 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );
    } );

    describe( 'Division by zero protection', function () {
        it( 'returns NaN for zero denominator with default minY', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'divZero',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 100, b: 0 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );

        it( 'returns NaN for very small denominator', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'smallY',
                from: { x: 'a', y: 'b' },
                minY: 1e-6,
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 100, b: 1e-7 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );

        it( 'allows small but acceptable denominator', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'acceptableY',
                from: { x: 'a', y: 'b' },
                minY: 1e-6,
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 100, b: 1e-5 } ) );
            expect( state.ratio ).to.be.closeTo( 1e7, 1e2 );
        } );

        it( 'returns NaN for negative small denominator', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'negSmall',
                from: { x: 'a', y: 'b' },
                minY: 1e-6,
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 100, b: -1e-7 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );

        it( 'uses custom minY threshold', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'customMinY',
                from: { x: 'a', y: 'b' },
                minY: 0.1,
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            // Should reject y=0.05 (below minY=0.1)
            ratio.update( state, createMessage( { a: 100, b: 0.05 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );

            // Should accept y=0.2 (above minY=0.1)
            ratio.update( state, createMessage( { a: 100, b: 0.2 } ) );
            expect( state.ratio ).to.equal( 500 );
        } );
    } );

    describe( 'Log scale (dB)', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'snr',
                from: { x: 'signal', y: 'noise' },
                logScale: true,
                stats: { ratio: { storeAs: 'snrDB' } }
            };
            state = ratio.init( spec );
        } );

        it( 'computes 0 dB for equal values', function () {
            ratio.update( state, createMessage( { signal: 100, noise: 100 } ) );
            expect( state.ratio ).to.be.closeTo( 0, 1e-10 );
        } );

        it( 'computes positive dB for signal > noise', function () {
            ratio.update( state, createMessage( { signal: 100, noise: 10 } ) );
            // 20 * log10(100/10) = 20 * log10(10) = 20 dB
            expect( state.ratio ).to.be.closeTo( 20, 1e-10 );
        } );

        it( 'computes negative dB for signal < noise', function () {
            ratio.update( state, createMessage( { signal: 10, noise: 100 } ) );
            // 20 * log10(10/100) = 20 * log10(0.1) = -20 dB
            expect( state.ratio ).to.be.closeTo( -20, 1e-10 );
        } );

        it( 'computes correct dB for 2:1 ratio', function () {
            ratio.update( state, createMessage( { signal: 2, noise: 1 } ) );
            // 20 * log10(2) ≈ 6.02 dB
            expect( state.ratio ).to.be.closeTo( 20 * Math.log10( 2 ), 1e-10 );
        } );

        it( 'computes correct dB for 10:1 ratio', function () {
            ratio.update( state, createMessage( { signal: 1000, noise: 100 } ) );
            expect( state.ratio ).to.be.closeTo( 20, 1e-10 );
        } );

        it( 'returns NaN for negative signal', function () {
            ratio.update( state, createMessage( { signal: -10, noise: 100 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );

        it( 'returns NaN for negative noise', function () {
            ratio.update( state, createMessage( { signal: 100, noise: -10 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );

        it( 'returns NaN for zero signal', function () {
            ratio.update( state, createMessage( { signal: 0, noise: 100 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );

        it( 'returns NaN for zero noise', function () {
            ratio.update( state, createMessage( { signal: 100, noise: 0 } ) );
            expect( Number.isNaN( state.ratio ) ).to.equal( true );
        } );
    } );

    describe( 'Invalid input handling', function () {
        let state;

        beforeEach( function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'validator',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            state = ratio.init( spec );
        } );

        it( 'sets inputValidationFailed on NaN in x', function () {
            ratio.update( state, createMessage( { a: NaN, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on NaN in y', function () {
            ratio.update( state, createMessage( { a: 10, b: NaN } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on Infinity in x', function () {
            ratio.update( state, createMessage( { a: Infinity, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on -Infinity in y', function () {
            ratio.update( state, createMessage( { a: 10, b: -Infinity } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on undefined', function () {
            ratio.update( state, createMessage( { a: undefined, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on null', function () {
            ratio.update( state, createMessage( { a: 10, b: null } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on string', function () {
            ratio.update( state, createMessage( { a: 'bad', b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'sets inputValidationFailed on missing field', function () {
            ratio.update( state, createMessage( { a: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );
        } );

        it( 'recovers from invalid input', function () {
            ratio.update( state, createMessage( { a: NaN, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            ratio.update( state, createMessage( { a: 20, b: 10 } ) );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.ratio ).to.equal( 2 );
        } );
    } );

    describe( 'Publishing', function () {
        it( 'publishes ratio to configured storeAs field', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'pub',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'myRatio' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 100, b: 25 } ) );

            const output = Object.create( null );
            ratio.publishTo( state, output );
            expect( output.myRatio ).to.equal( 4 );
        } );

        it( 'publishes scaled ratio to configured storeAs field', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'scaledPub',
                from: { x: 'a', y: 'b' },
                scaleBy: 3600,
                stats: { ratio: { storeAs: 'speed' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 10, b: 5 } ) );

            const output = Object.create( null );
            ratio.publishTo( state, output );
            expect( output.speed ).to.equal( 7200 );
        } );

        it( 'publishes NaN when inputValidationFailed', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'nanPub',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: NaN, b: 10 } ) );

            const output = Object.create( null );
            ratio.publishTo( state, output );
            expect( Number.isNaN( output.out ) ).to.equal( true );
        } );

        it( 'does not publish when disabled', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'disabledPub',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 50, b: 10 } ) );
            state.disable = true;

            const output = Object.create( null );
            ratio.publishTo( state, output );
            expect( output.out ).to.be.undefined;
        } );
    } );

    describe( 'Disable functionality', function () {
        it( 'skips update when disabled', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'disableTest',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 100, b: 50 } ) );
            expect( state.ratio ).to.equal( 2 );

            state.disable = true;

            ratio.update( state, createMessage( { a: 200, b: 50 } ) );
            expect( state.ratio ).to.equal( 2 ); // Unchanged

            state.disable = false;
            ratio.update( state, createMessage( { a: 30, b: 10 } ) );
            expect( state.ratio ).to.equal( 3 );
        } );
    } );

    describe( 'Reset and Recompute', function () {
        it( 'reset returns true', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'resetTest',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );
            expect( ratio.reset( state ) ).to.equal( true );
        } );

        it( 'recompute returns true', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'recomputeTest',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );
            expect( ratio.recompute( state ) ).to.equal( true );
        } );
    } );

    describe( 'Edge cases', function () {
        it( 'handles very small ratios', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'tiny',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 1e-10, b: 1 } ) );
            expect( state.ratio ).to.equal( 1e-10 );
        } );

        it( 'handles very large ratios', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'large',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 1e15, b: 1 } ) );
            expect( state.ratio ).to.equal( 1e15 );
        } );

        it( 'defaults logScale to false', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'defaultLog',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );
            expect( state.logScale ).to.equal( false );
        } );

        it( 'defaults scaleBy to 1', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'defaultScaleBy',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );
            expect( state.scaleBy ).to.equal( 1 );
        } );

        it( 'defaults minY to 1e-10', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'defaultMinY',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );
            expect( state.minY ).to.equal( 1e-10 );
        } );
    } );

    describe( 'Spec validation', function () {
        it( 'rejects invalid nodeType', function () {
            const badSpec = {
                nodeType: 'INVALID',
                name: 'test',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid name', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: '123-invalid',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing from.x', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects missing from.y', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'a' },
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects same field for x and y', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'same', y: 'same' },
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects from.x with spaces', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'bad field', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects negative minY', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'a', y: 'b' },
                minY: -1,
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects scaleBy of zero', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'a', y: 'b' },
                scaleBy: 0,
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects negative scaleBy', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'a', y: 'b' },
                scaleBy: -1,
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects non-numeric scaleBy', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'a', y: 'b' },
                scaleBy: 'abc',
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects logScale and scaleBy together', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'a', y: 'b' },
                logScale: true,
                scaleBy: 3600,
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'accepts scaleBy alone', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'scaleOnly',
                from: { x: 'a', y: 'b' },
                scaleBy: 3600,
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( spec ) ).to.not.throw();
        } );

        it( 'accepts fractional scaleBy', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'fracScale',
                from: { x: 'a', y: 'b' },
                scaleBy: 0.001,
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( spec ) ).to.not.throw();
        } );

        it( 'accepts logScale alone without conflict', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'logOnly',
                from: { x: 'a', y: 'b' },
                logScale: true,
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( spec ) ).to.not.throw();
        } );

        it( 'rejects missing stats', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'a', y: 'b' }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects unsupported stat', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'a', y: 'b' },
                stats: { diff: { storeAs: 'out' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'rejects invalid storeAs', function () {
            const badSpec = {
                nodeType: 'Ratio',
                name: 'test',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: '123-invalid' } }
            };
            expect( () => ratio.init( badSpec ) ).to.throw();
        } );

        it( 'accepts valid spec with defaults', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'valid',
                from: { x: 'signal', y: 'noise' },
                stats: { ratio: { storeAs: 'snr' } }
            };
            expect( () => ratio.init( spec ) ).to.not.throw();
        } );

        it( 'accepts valid spec with all options', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'complete',
                from: { x: 'signal', y: 'noise' },
                logScale: true,
                minY: 0.001,
                stats: { ratio: { storeAs: 'snrDB' } }
            };
            expect( () => ratio.init( spec ) ).to.not.throw();
        } );

        it( 'accepts minY of zero', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'zeroMinY',
                from: { x: 'a', y: 'b' },
                minY: 0,
                stats: { ratio: { storeAs: 'out' } }
            };
            expect( () => ratio.init( spec ) ).to.not.throw();
        } );
    } );

    describe( 'Introspect accessors', function () {
        it( 'returns expected node type', function () {
            expect( getNodeType() ).to.equal( 'Ratio' );
        } );

        it( 'getSupportedStats returns a copy', function () {
            const stats = getSupportedStats();
            expect( stats ).to.be.an( 'array' );
            expect( stats ).to.include( 'ratio' );

            stats.push( 'mutation' );
            const stats2 = getSupportedStats();
            expect( stats2 ).to.not.include( 'mutation' );
        } );

        it( 'getStatDescriptions returns descriptions', function () {
            const desc = getStatDescriptions();
            expect( desc ).to.be.an( 'object' );
            expect( desc ).to.have.property( 'ratio' ).that.is.a( 'string' );
        } );

        it( 'getSupportedControlMethods returns control methods', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.be.an( 'object' );
            expect( methods ).to.have.property( 'reset' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'enable' ).that.is.a( 'string' );
            expect( methods ).to.have.property( 'disable' ).that.is.a( 'string' );
        } );

        it( 'getCapabilities returns capabilities', function () {
            const cap = getCapabilities();
            expect( cap ).to.be.an( 'object' );
            expect( cap ).to.have.property( 'description' ).that.is.a( 'string' );
            expect( cap ).to.have.property( 'features' ).that.is.an( 'array' );
        } );

        it( 'getDSLMetadata returns metadata', function () {
            const dsl = getDSLMetadata();
            expect( dsl ).to.be.an( 'object' );
            expect( dsl ).to.have.property( 'specSchema' );
            expect( dsl ).to.have.property( 'buildSpec' );
        } );

        it( 'DEFAULT_OPTIONS has expected values', function () {
            expect( DEFAULT_OPTIONS ).to.have.property( 'logScale' ).that.equals( false );
            expect( DEFAULT_OPTIONS ).to.have.property( 'minY' ).that.equals( 1e-10 );
            expect( DEFAULT_OPTIONS ).to.have.property( 'scaleBy' ).that.equals( 1 );
        } );
    } );

    describe( 'Pause/Unpause control', function () {
        it( 'skips update when paused', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'pauseTest',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 100, b: 50 } ) );
            expect( state.ratio ).to.equal( 2 );

            state.pause = true;

            ratio.update( state, createMessage( { a: 200, b: 50 } ) );
            expect( state.ratio ).to.equal( 2 );
        } );

        it( 'publishes when paused', function () {
            const spec = {
                nodeType: 'Ratio',
                name: 'pausePub',
                from: { x: 'a', y: 'b' },
                stats: { ratio: { storeAs: 'out' } }
            };
            const state = ratio.init( spec );

            ratio.update( state, createMessage( { a: 100, b: 25 } ) );

            state.pause = true;

            const output = Object.create( null );
            ratio.publishTo( state, output );

            expect( output.out ).to.not.equal( undefined );
        } );

        it( 'pause/unpause control methods exist', function () {
            const methods = getSupportedControlMethods();
            expect( methods ).to.have.property( 'pause' );
            expect( methods ).to.have.property( 'unpause' );
        } );
    } );

    describe( 'DSL buildSpec', function () {
        it( 'builds basic spec', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'scale',
                'actual',
                'reference',
                { ratio: { storeAs: 'scaleFactor' } },
                {}
            );

            expect( spec.nodeType ).to.equal( 'Ratio' );
            expect( spec.name ).to.equal( 'scale' );
            expect( spec.from ).to.deep.equal( { x: 'actual', y: 'reference' } );
            expect( spec.stats.ratio.storeAs ).to.equal( 'scaleFactor' );
        } );

        it( 'builds spec with logScale option', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'snr',
                'signal',
                'noise',
                { ratio: { storeAs: 'snrDB' } },
                { logScale: true }
            );

            expect( spec.logScale ).to.equal( true );
        } );

        it( 'builds spec with minY option', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'safeRatio',
                'a',
                'b',
                { ratio: { storeAs: 'out' } },
                { minY: 0.01 }
            );

            expect( spec.minY ).to.equal( 0.01 );
        } );

        it( 'builds spec with scaleBy option', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'speed',
                'dist',
                'time',
                { ratio: { storeAs: 'kmh' } },
                { scaleBy: 3600 }
            );

            expect( spec.scaleBy ).to.equal( 3600 );
        } );

        it( 'builds spec with all options', function () {
            const dsl = getDSLMetadata();
            const spec = dsl.buildSpec(
                'full',
                'signal',
                'noise',
                { ratio: { storeAs: 'snrDB' } },
                { logScale: true, minY: 0.001 }
            );

            expect( spec.logScale ).to.equal( true );
            expect( spec.minY ).to.equal( 0.001 );
        } );
    } );
} );
