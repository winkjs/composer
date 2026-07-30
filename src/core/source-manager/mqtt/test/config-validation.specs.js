// core/source-manager/mqtt/test/config-validation.specs.js

/* eslint-disable no-empty-function, no-underscore-dangle */

/**
 * @fileoverview MQTT source — declarative configSchema validation
 * (ADR-018: the schema is authoritative).
 *
 * The schema is authoritative at DSL time: `flow.source()` calls
 * `validateWithSchema( adapter.configSchema, sourceConfig )` before the
 * flow ever runs, so typos, missing required fields, and bad types are
 * caught at definition time. Unknown keys are rejected via the schema's
 * `_propertyNames` list — the only unknown-key mechanism the validator
 * has (validate.js:68-77).
 *
 * `onMessage` and `onShutdown` are deliberately NOT in the schema: the
 * flow runtime injects them after DSL validation. A user who passes
 * `onMessage` in flow config would see it silently overwritten — the
 * unknown-key rejection turns that mistake into a fail-fast error.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import mqttSource, { configSchema } from '../index.js';
import { validateWithSchema } from '../../../utils/validate/index.js';
import { flow } from '../../../../flow/flow.js';

// A minimal config that must validate clean.
const VALID_MINIMAL = { brokerUrl: 'mqtt://localhost:1883', topics: 'edge/+/enriched' };

describe( 'MQTT Source — configSchema (ADR-018)', function () {

    describe( 'schema shape', function () {

        it( 'is exported as a non-empty object', function () {
            expect( typeof configSchema ).to.equal( 'object' );
            expect( configSchema === null ).to.equal( false );
            expect( Object.keys( configSchema ).length ).to.be.greaterThan( 0 );
        } );

        it( '_propertyNames lists exactly the schema field names', function () {
            // Self-consistency: every declared field is an allowed key and
            // vice versa, so the schema cannot drift from its own key list.
            const fieldNames = Object.keys( configSchema )
                .filter( ( key ) => !key.startsWith( '_' ) )
                .sort();
            const allowed = [ ...configSchema._propertyNames ].sort();
            expect( allowed ).to.deep.equal( fieldNames );
        } );

        it( 'does not declare runtime-injected callbacks (onMessage, onShutdown)', function () {
            expect( '_propertyNames' in configSchema ).to.equal( true );
            expect( configSchema._propertyNames.includes( 'onMessage' ) ).to.equal( false );
            expect( configSchema._propertyNames.includes( 'onShutdown' ) ).to.equal( false );
        } );
    } );

    describe( 'accepts valid configs', function () {

        it( 'minimal config (brokerUrl + topics)', function () {
            const result = validateWithSchema( configSchema, VALID_MINIMAL, 'source' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'full config with every optional field', function () {
            const result = validateWithSchema( configSchema, {
                brokerUrl: 'mqtt://localhost:1883',
                topics: [ 'topic/one', 'topic/two' ],
                codec: { unpack: () => ( {} ) },
                transform: ( msg ) => msg,
                dedupWindowMs: 60000,
                dedupMaxEntries: 4096,
                clientId: 'agg-01',
                cleanStart: false,
                onStatus: () => {},
                onMetrics: () => {},
                expectedQuietPeriodMs: 30000,
                mqttConnectFn: () => {}
            }, 'source' );
            expect( result.valid ).to.equal( true );
        } );
    } );

    describe( 'rejects missing required fields', function () {

        it( 'missing brokerUrl', function () {
            const result = validateWithSchema( configSchema, { topics: 't' }, 'source' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'brokerUrl' ) ) ).to.equal( true );
        } );

        it( 'missing topics', function () {
            const result = validateWithSchema( configSchema, { brokerUrl: 'mqtt://x' }, 'source' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'topics' ) ) ).to.equal( true );
        } );
    } );

    describe( 'rejects unknown keys (typo protection)', function () {

        it( 'flags \'brokerURL\' (case typo) as an unknown property', function () {
            const result = validateWithSchema( configSchema, {
                brokerURL: 'mqtt://x',
                topics: 't'
            }, 'source' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'brokerURL\'' ) ) ).to.equal( true );
        } );

        it( 'flags \'dedupWindow\' (wrong name) as an unknown property', function () {
            const result = validateWithSchema( configSchema, {
                ...VALID_MINIMAL,
                dedupWindow: 64
            }, 'source' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'dedupWindow\'' ) ) ).to.equal( true );
        } );

        it( 'flags retired \'dedupWindowSize\' (removed by ADR-022) as an unknown property', function () {
            const result = validateWithSchema( configSchema, {
                ...VALID_MINIMAL,
                dedupWindowSize: 64
            }, 'source' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'Unknown property \'dedupWindowSize\'' ) ) ).to.equal( true );
        } );
    } );

    describe( 'rejects bad values', function () {

        it( 'empty brokerUrl', function () {
            const result = validateWithSchema( configSchema, { brokerUrl: '', topics: 't' }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'topics as a number', function () {
            const result = validateWithSchema( configSchema, { brokerUrl: 'mqtt://x', topics: 42 }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'topics as an empty array', function () {
            const result = validateWithSchema( configSchema, { brokerUrl: 'mqtt://x', topics: [] }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'topics as an array containing an empty string', function () {
            const result = validateWithSchema( configSchema, { brokerUrl: 'mqtt://x', topics: [ 'ok', '' ] }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'dedupWindowMs zero', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, dedupWindowMs: 0 }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'dedupWindowMs fractional', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, dedupWindowMs: 1.5 }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'dedupMaxEntries zero', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, dedupMaxEntries: 0 }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'dedupMaxEntries fractional', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, dedupMaxEntries: 1.5 }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'clientId with spaces', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, clientId: 'bad id' }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'codec without an unpack() function', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, codec: { pack: () => {} } }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'transform as a non-function', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, transform: 'no' }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'cleanStart as a string', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, cleanStart: 'yes' }, 'source' );
            expect( result.valid ).to.equal( false );
        } );

        it( 'onMetrics as a non-function', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, onMetrics: true }, 'source' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.match( /onMetrics/ );
        } );

        it( 'expectedQuietPeriodMs zero', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, expectedQuietPeriodMs: 0 }, 'source' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.match( /expectedQuietPeriodMs/ );
        } );

        it( 'expectedQuietPeriodMs fractional', function () {
            const result = validateWithSchema( configSchema, { ...VALID_MINIMAL, expectedQuietPeriodMs: 0.5 }, 'source' );
            expect( result.valid ).to.equal( false );
        } );
    } );

    describe( 'DSL-time enforcement (flow.source hook)', function () {

        it( 'flow.source() rejects a config missing brokerUrl', function () {
            expect( () => flow( 'schema-test' ).source( mqttSource, { topics: 't' } ) )
                .to.throw( /brokerUrl/ );
        } );

        it( 'flow.source() rejects an unknown config key', function () {
            expect( () => flow( 'schema-test' ).source( mqttSource, {
                brokerUrl: 'mqtt://x',
                topics: 't',
                brokerURL: 'mqtt://typo'
            } ) ).to.throw( /Unknown property 'brokerURL'/ );
        } );

        it( 'flow.source() accepts a valid config', function () {
            const api = flow( 'schema-test' ).source( mqttSource, VALID_MINIMAL );
            expect( api ).to.have.property( 'build' );
        } );
    } );

} );
