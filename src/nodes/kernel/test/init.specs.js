// Initialization and spec validation tests for kernel node.

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init } from '../index.js';
import { PRESET_SPEC, CUSTOM_SPEC } from './test-helpers.js';

describe( 'Kernel — init', function () {

    describe( 'state shape', function () {
        it( 'initializes with preset kernel', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'smoother',
                from: { x: 'value' },
                preset: 'smooth3',
                stats: { filtered: { storeAs: 'smoothed' } }
            } );

            expect( state.nodeType ).to.equal( 'Kernel' );
            expect( state.presetName ).to.equal( 'smooth3' );
            expect( state.kernelLength ).to.equal( 3 );
        } );

        it( 'initializes with custom kernel', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'custom',
                from: { x: 'value' },
                kernel: [ 0.2, 0.6, 0.2 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            expect( state.presetName ).to.equal( 'userDefined' );
            expect( state.kernelLength ).to.equal( 3 );
        } );

        it( 'reverses kernel for efficient convolution', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 1, 2, 3 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            expect( state.kernel ).to.deep.equal( [ 3, 2, 1 ] );
        } );

        it( 'initializes result to 0', function () {
            const state = init( PRESET_SPEC );
            expect( state.result ).to.equal( 0 );
        } );

        it( 'initializes disable to false', function () {
            const state = init( PRESET_SPEC );
            expect( state.disable ).to.equal( false );
        } );

        it( 'initializes inputValidationFailed to false', function () {
            const state = init( PRESET_SPEC );
            expect( state.inputValidationFailed ).to.equal( false );
        } );
    } );

    describe( 'spec validation', function () {
        it( 'throws on missing nodeType', function () {
            expect( () => init( {
                name: 'test',
                from: { x: 'value' },
                preset: 'smooth3',
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /Required field missing/ );
        } );

        it( 'throws on wrong nodeType', function () {
            expect( () => init( {
                nodeType: 'WrongType',
                name: 'test',
                from: { x: 'value' },
                preset: 'smooth3',
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /nodeType/ );
        } );

        it( 'throws on missing name', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                from: { x: 'value' },
                preset: 'smooth3',
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /Required field missing/ );
        } );

        it( 'throws on invalid name', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: '123-invalid',
                from: { x: 'value' },
                preset: 'smooth3',
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /valid identifier/ );
        } );

        it( 'throws on missing from.x', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: {},
                preset: 'smooth3',
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /Required field missing/ );
        } );

        it( 'throws on from.x with spaces', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'bad field' },
                preset: 'smooth3',
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /cannot contain spaces/ );
        } );

        it( 'throws when neither preset nor kernel provided', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /either preset or kernel/ );
        } );

        it( 'throws when both preset and kernel provided', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                preset: 'smooth3',
                kernel: [ 0.2, 0.6, 0.2 ],
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /either preset or kernel/ );
        } );

        it( 'throws on invalid preset name', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                preset: 'invalidPreset',
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /Preset must be one of/ );
        } );

        it( 'throws on kernel with fewer than 2 elements', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 1 ],
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /array of 2-100 numbers/ );
        } );

        it( 'throws on kernel that is not an array', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: 42,
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /Expected array/ );
        } );

        it( 'throws on kernel with more than 100 elements', function () {
            const bigKernel = new Array( 101 ).fill( 1 / 101 );
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: bigKernel,
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /array of 2-100 numbers/ );
        } );

        it( 'throws on kernel containing Infinity', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                kernel: [ 0.5, Infinity, 0.5 ],
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /array of 2-100 numbers/ );
        } );

        it( 'throws on missing stats', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                preset: 'smooth3'
            } ) ).to.throw( /Required field missing/ );
        } );

        it( 'throws on invalid stat name', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'value' },
                preset: 'smooth3',
                stats: { invalidStat: { storeAs: 'result' } }
            } ) ).to.throw( /Unknown property|Invalid property/ );
        } );

        it( 'accepts valid spec with preset', function () {
            const state = init( PRESET_SPEC );
            expect( state.nodeType ).to.equal( 'Kernel' );
        } );

        it( 'accepts valid spec with custom kernel', function () {
            const state = init( CUSTOM_SPEC );
            expect( state.nodeType ).to.equal( 'Kernel' );
        } );
    } );

    describe( 'field-keying support', function () {
        it( 'accepts direct preset value', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'temp' },
                preset: 'smooth3',
                stats: { filtered: { storeAs: 'result' } }
            } );

            expect( state.presetName ).to.equal( 'smooth3' );
        } );

        it( 'accepts a field-keyed preset, resolving the node\'s field', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'temp' },
                preset: { temp: 'sg5', pressure: 'smooth3' },
                stats: { filtered: { storeAs: 'result' } }
            } );

            expect( state.presetName ).to.equal( 'sg5' );
        } );

        it( 'rejects a field-keyed preset with an unknown name', function () {
            expect( () => init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'temp' },
                preset: { temp: 'nope' },
                stats: { filtered: { storeAs: 'result' } }
            } ) ).to.throw( /Preset must be one of/ );
        } );

        it( 'accepts direct kernel array', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'temp' },
                kernel: [ 0.2, 0.6, 0.2 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            expect( state.kernelLength ).to.equal( 3 );
        } );

        it( 'accepts a field-keyed kernel, resolving the node\'s field', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'temp' },
                kernel: { temp: [ 0.1, 0.2, 0.7 ], pressure: [ 0.5, 0.5 ] },
                stats: { filtered: { storeAs: 'result' } }
            } );

            // Resolves temp's kernel and reverses it for convolution
            expect( state.kernelLength ).to.equal( 3 );
            expect( state.kernel ).to.deep.equal( [ 0.7, 0.2, 0.1 ] );
        } );

        it( 'reverses custom kernel correctly', function () {
            const state = init( {
                nodeType: 'Kernel',
                name: 'test',
                from: { x: 'temp' },
                kernel: [ 1, 2, 3 ],
                stats: { filtered: { storeAs: 'result' } }
            } );

            // Kernel is reversed for efficient convolution
            expect( state.kernel ).to.deep.equal( [ 3, 2, 1 ] );
        } );
    } );

} );
