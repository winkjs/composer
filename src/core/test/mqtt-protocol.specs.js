// core/test/mqtt-protocol.specs.js

/**
 * @fileoverview Tests for shared MQTT protocol invariants.
 *
 * These values are design decisions that must remain fixed for
 * interoperability between emitter and source managers.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';

import { WINK_NAMESPACE, MQTT_QOS, MQTT_PROTOCOL_V } from '../mqtt-protocol.js';

describe( 'mqtt-protocol', function () {

    // ========================================================================
    // WINK_NAMESPACE
    // ========================================================================

    describe( 'WINK_NAMESPACE', function () {

        it( 'exports an object with dedupId, timestamp, and version keys', function () {
            expect( WINK_NAMESPACE ).to.be.an( 'object' );
            expect( WINK_NAMESPACE ).to.have.property( 'dedupId', 'winkDedupId' );
            expect( WINK_NAMESPACE ).to.have.property( 'timestamp', 'winkTimestamp' );
            expect( WINK_NAMESPACE ).to.have.property( 'version', 'winkVersion' );
        } );

        it( 'has exactly three keys', function () {
            expect( Object.keys( WINK_NAMESPACE ) ).to.have.lengthOf( 3 );
        } );

    } );

    // ========================================================================
    // MQTT_QOS
    // ========================================================================

    describe( 'MQTT_QOS', function () {

        it( 'is 1 (at-least-once delivery)', function () {
            expect( MQTT_QOS ).to.equal( 1 );
        } );

    } );

    // ========================================================================
    // MQTT_PROTOCOL_V
    // ========================================================================

    describe( 'MQTT_PROTOCOL_V', function () {

        it( 'is 5 (MQTT v5)', function () {
            expect( MQTT_PROTOCOL_V ).to.equal( 5 );
        } );

    } );

} );
