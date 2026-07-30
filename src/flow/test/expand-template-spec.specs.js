// flow/test/expand-template-spec.specs.js

/**
 * @fileoverview Unit tests for expand-template-spec.js
 *
 * Tests the template expansion logic used during groupBy expansion.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { expandTemplateSpec, prefixTriggerTargets } from '../expand-template-spec.js';

describe( 'expandTemplateSpec', function () {

    // Helper to create a lookupByField tunable
    const createLookupByField = function ( field, map, defaultVal ) {
        const fn = ( msg ) => map[ msg[ field ] ] ?? defaultVal;
        fn.semantics = {
            type: 'lookupByField',
            field,
            map,
            default: defaultVal
        };
        return fn;
    };

    describe( 'node name prefixing', function () {

        it( 'prefixes node name with group value', function () {
            const template = { name: 'corr', nodeType: 'esCorrelation' };
            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );
            expect( result.name ).to.equal( 'idle_corr' );
        } );

        it( 'handles numeric group values', function () {
            const template = { name: 'node', nodeType: 'esMean' };
            const result = expandTemplateSpec( template, 0, 'protocolType' );
            expect( result.name ).to.equal( '0_node' );
        } );

    } );

    describe( 'tunable resolution', function () {

        it( 'resolves matching lookupByField tunable', function () {
            const tunable = createLookupByField( 'rpmBand', {
                idle: 3.4,
                cruise: 2.4
            }, 2.0 );

            const template = {
                name: 'ph',
                options: { lambda: tunable }
            };

            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );
            expect( result.options.lambda ).to.equal( 3.4 );
        } );

        it( 'preserves non-matching tunable', function () {
            const tunable = createLookupByField( 'tempRegime', {
                warm: 0.02
            }, 0.03 );

            const template = {
                name: 'ph',
                options: { alpha: tunable }
            };

            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );
            expect( result.options.alpha ).to.equal( tunable );
        } );

    } );

    describe( 'trigger target prefixing', function () {

        it( 'prefixes direct trigger targets', function () {
            const template = {
                name: 'controller',
                triggers: [
                    { control: 'reset', targets: [ 'corr', 'ph' ] },
                    { control: 'disable', targets: [ 'alert' ] }
                ]
            };

            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );

            expect( result.triggers[ 0 ].targets ).to.deep.equal( [ 'idle_corr', 'idle_ph' ] );
            expect( result.triggers[ 1 ].targets ).to.deep.equal( [ 'idle_alert' ] );
        } );

        it( 'prefixes controller logic triggers', function () {
            const template = {
                name: 'ctrl',
                logic: [
                    {
                        when: ( msg ) => msg.alert,
                        triggers: [ { control: 'reset', targets: [ 'stats', 'detector' ] } ]
                    },
                    {
                        when: ( msg ) => msg.shutdown,
                        triggers: [ { control: 'disable', targets: [ 'all' ] } ]
                    }
                ]
            };

            const result = expandTemplateSpec( template, 'cruise', 'rpmBand' );

            expect( result.logic[ 0 ].triggers[ 0 ].targets ).to.deep.equal( [ 'cruise_stats', 'cruise_detector' ] );
            expect( result.logic[ 1 ].triggers[ 0 ].targets ).to.deep.equal( [ 'cruise_all' ] );
        } );

        it( 'handles empty triggers array', function () {
            const template = { name: 'node', triggers: [] };
            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );
            expect( result.triggers ).to.deep.equal( [] );
        } );

        it( 'handles missing triggers', function () {
            const template = { name: 'node' };
            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );
            expect( result.triggers ).to.equal( undefined );
        } );

    } );

    describe( 'storeAs preservation', function () {

        it( 'does NOT prefix storeAs values', function () {
            const template = {
                name: 'corr',
                stats: {
                    r2: { storeAs: 'r2' },
                    correlation: { storeAs: 'correlation' }
                }
            };

            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );

            expect( result.stats.r2.storeAs ).to.equal( 'r2' );
            expect( result.stats.correlation.storeAs ).to.equal( 'correlation' );
        } );

    } );

    describe( 'deep cloning', function () {

        it( 'creates independent copy of nested objects', function () {
            const template = {
                name: 'node',
                options: { nested: { value: 42 } }
            };

            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );

            result.options.nested.value = 99;
            expect( template.options.nested.value ).to.equal( 42 );
        } );

        it( 'preserves function references', function () {
            const predicate = ( msg ) => msg.shiftDetected;
            const template = {
                name: 'alert',
                predicate
            };

            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );
            expect( result.predicate ).to.equal( predicate );
        } );

    } );

    describe( 'complete expansion example', function () {

        it( 'expands oil pressure template correctly', function () {
            const lambdaTunable = createLookupByField( 'rpmBand', {
                idle: 3.4,
                low: 3.2,
                cruise: 2.4
            }, 2.0 );

            const template = {
                nodeType: 'pageHinkley',
                name: 'ph',
                from: { x: 'r2' },
                stats: {
                    phShift: { storeAs: 'shiftDetected' },
                    phMean: { storeAs: 'baselineR2' }
                },
                options: {
                    delta: 0.01,
                    lambda: lambdaTunable,
                    alpha: 0.02,
                    detectDrop: true
                },
                triggers: [
                    { control: 'reset', targets: [ 'corr' ] }
                ]
            };

            const result = expandTemplateSpec( template, 'idle', 'rpmBand' );

            // Name prefixed
            expect( result.name ).to.equal( 'idle_ph' );

            // Tunable resolved
            expect( result.options.lambda ).to.equal( 3.4 );

            // Static options preserved
            expect( result.options.delta ).to.equal( 0.01 );
            expect( result.options.alpha ).to.equal( 0.02 );
            expect( result.options.detectDrop ).to.equal( true );

            // storeAs NOT prefixed
            expect( result.stats.phShift.storeAs ).to.equal( 'shiftDetected' );
            expect( result.stats.phMean.storeAs ).to.equal( 'baselineR2' );

            // Trigger targets prefixed
            expect( result.triggers[ 0 ].targets ).to.deep.equal( [ 'idle_corr' ] );

            // Original unchanged
            expect( template.name ).to.equal( 'ph' );
            expect( typeof template.options.lambda ).to.equal( 'function' );
        } );

    } );

} );

describe( 'prefixTriggerTargets', function () {

    it( 'mutates spec in place', function () {
        const spec = {
            triggers: [ { control: 'reset', targets: [ 'a' ] } ]
        };

        prefixTriggerTargets( spec, 'test' );

        expect( spec.triggers[ 0 ].targets ).to.deep.equal( [ 'test_a' ] );
    } );

    it( 'handles trigger without targets array', function () {
        const spec = {
            triggers: [ { control: 'enable' } ]
        };

        // Should not throw
        prefixTriggerTargets( spec, 'test' );
        expect( spec.triggers[ 0 ].targets ).to.equal( undefined );
    } );

    it( 'handles non-array triggers', function () {
        const spec = { triggers: null };
        // Should not throw
        prefixTriggerTargets( spec, 'test' );
    } );

} );
