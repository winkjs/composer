// core/storage-manager/questdb/test/writers.specs.js

/**
 * @fileoverview Tests for QuestDB column writers.
 */

import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import sinon from 'sinon';

import { QUEST_WRITERS, writeAsString, createFloat64Writer } from '../writers.js';

describe( 'QuestDB Writers', function () {

    let mockSender;

    beforeEach( function () {
        mockSender = {
            floatColumn: sinon.stub(),
            intColumn: sinon.stub(),
            booleanColumn: sinon.stub(),
            stringColumn: sinon.stub(),
            timestampColumn: sinon.stub()
        };
    } );

    // ========================================================================
    // QUEST_WRITERS
    // ========================================================================

    describe( 'QUEST_WRITERS', function () {

        it( 'should have writers for all semantics COLUMN_TYPES', function () {
            const expectedTypes = [ 'float64', 'int64', 'bool', 'string', 'timestamp' ];
            for ( let i = 0; i < expectedTypes.length; i += 1 ) {
                expect( QUEST_WRITERS[ expectedTypes[ i ] ] ).to.be.a( 'function' );
            }
        } );

        it( 'should not have prototype pollution', function () {
            expect( QUEST_WRITERS.hasOwnProperty ).to.equal( undefined );
            expect( QUEST_WRITERS.constructor ).to.equal( undefined );
        } );

    } );

    // ========================================================================
    // float64 writer
    // ========================================================================

    describe( 'QUEST_WRITERS.float64', function () {

        it( 'should call sender.floatColumn with correct arguments', function () {
            QUEST_WRITERS.float64( mockSender, 'temperature', 23.5 );

            expect( mockSender.floatColumn.calledOnce ).to.equal( true );
            expect( mockSender.floatColumn.calledWith( 'temperature', 23.5 ) ).to.equal( true );
        } );

        it( 'should handle zero', function () {
            QUEST_WRITERS.float64( mockSender, 'value', 0 );

            expect( mockSender.floatColumn.calledWith( 'value', 0 ) ).to.equal( true );
        } );

        it( 'should handle negative values', function () {
            QUEST_WRITERS.float64( mockSender, 'delta', -15.75 );

            expect( mockSender.floatColumn.calledWith( 'delta', -15.75 ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // int64 writer
    // ========================================================================

    describe( 'QUEST_WRITERS.int64', function () {

        it( 'should call sender.intColumn with correct arguments', function () {
            QUEST_WRITERS.int64( mockSender, 'count', 42 );

            expect( mockSender.intColumn.calledOnce ).to.equal( true );
            expect( mockSender.intColumn.calledWith( 'count', 42 ) ).to.equal( true );
        } );

        it( 'should handle zero', function () {
            QUEST_WRITERS.int64( mockSender, 'value', 0 );

            expect( mockSender.intColumn.calledWith( 'value', 0 ) ).to.equal( true );
        } );

        it( 'should handle negative integers', function () {
            QUEST_WRITERS.int64( mockSender, 'offset', -100 );

            expect( mockSender.intColumn.calledWith( 'offset', -100 ) ).to.equal( true );
        } );

        it( 'should convert BigInt to Number', function () {
            QUEST_WRITERS.int64( mockSender, 'bigValue', BigInt( 12345 ) );

            expect( mockSender.intColumn.calledWith( 'bigValue', 12345 ) ).to.equal( true );
        } );

        it( 'should handle Number.MAX_SAFE_INTEGER', function () {
            QUEST_WRITERS.int64( mockSender, 'maxSafe', Number.MAX_SAFE_INTEGER );

            expect( mockSender.intColumn.calledWith( 'maxSafe', Number.MAX_SAFE_INTEGER ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // bool writer
    // ========================================================================

    describe( 'QUEST_WRITERS.bool', function () {

        it( 'should call sender.booleanColumn with true', function () {
            QUEST_WRITERS.bool( mockSender, 'active', true );

            expect( mockSender.booleanColumn.calledOnce ).to.equal( true );
            expect( mockSender.booleanColumn.calledWith( 'active', true ) ).to.equal( true );
        } );

        it( 'should call sender.booleanColumn with false', function () {
            QUEST_WRITERS.bool( mockSender, 'enabled', false );

            expect( mockSender.booleanColumn.calledWith( 'enabled', false ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // string writer
    // ========================================================================

    describe( 'QUEST_WRITERS.string', function () {

        it( 'should call sender.stringColumn with correct arguments', function () {
            QUEST_WRITERS.string( mockSender, 'name', 'sensor-01' );

            expect( mockSender.stringColumn.calledOnce ).to.equal( true );
            expect( mockSender.stringColumn.calledWith( 'name', 'sensor-01' ) ).to.equal( true );
        } );

        it( 'should handle empty string', function () {
            QUEST_WRITERS.string( mockSender, 'description', '' );

            expect( mockSender.stringColumn.calledWith( 'description', '' ) ).to.equal( true );
        } );

        it( 'should handle unicode strings', function () {
            QUEST_WRITERS.string( mockSender, 'label', 'Sensor 温度' );

            expect( mockSender.stringColumn.calledWith( 'label', 'Sensor 温度' ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // timestamp writer
    // ========================================================================

    describe( 'QUEST_WRITERS.timestamp', function () {

        it( 'should call sender.timestampColumn with ms unit', function () {
            const ts = Date.now();
            QUEST_WRITERS.timestamp( mockSender, 'lastUpdate', ts );

            expect( mockSender.timestampColumn.calledOnce ).to.equal( true );
            expect( mockSender.timestampColumn.calledWith( 'lastUpdate', ts, 'ms' ) ).to.equal( true );
        } );

        it( 'should handle epoch zero', function () {
            QUEST_WRITERS.timestamp( mockSender, 'created', 0 );

            expect( mockSender.timestampColumn.calledWith( 'created', 0, 'ms' ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // writeAsString fallback
    // ========================================================================

    describe( 'writeAsString', function () {

        it( 'should convert number to string', function () {
            writeAsString( mockSender, 'value', 123 );

            expect( mockSender.stringColumn.calledWith( 'value', '123' ) ).to.equal( true );
        } );

        it( 'should convert boolean to string', function () {
            writeAsString( mockSender, 'flag', true );

            expect( mockSender.stringColumn.calledWith( 'flag', 'true' ) ).to.equal( true );
        } );

        it( 'should pass string through', function () {
            writeAsString( mockSender, 'text', 'hello' );

            expect( mockSender.stringColumn.calledWith( 'text', 'hello' ) ).to.equal( true );
        } );

        it( 'should convert object to string', function () {
            writeAsString( mockSender, 'obj', { foo: 'bar' } );

            expect( mockSender.stringColumn.calledWith( 'obj', '[object Object]' ) ).to.equal( true );
        } );

        it( 'should convert null to string', function () {
            writeAsString( mockSender, 'empty', null );

            expect( mockSender.stringColumn.calledWith( 'empty', 'null' ) ).to.equal( true );
        } );

        it( 'should convert undefined to string', function () {
            writeAsString( mockSender, 'missing', undefined );

            expect( mockSender.stringColumn.calledWith( 'missing', 'undefined' ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // createFloat64Writer factory
    // ========================================================================

    describe( 'createFloat64Writer', function () {

        it( 'should return default writer for resolution=1', function () {
            const writer = createFloat64Writer( 1 );

            expect( writer ).to.equal( QUEST_WRITERS.float64 );
        } );

        it( 'should return default writer for undefined resolution', function () {
            const writer = createFloat64Writer( undefined );

            expect( writer ).to.equal( QUEST_WRITERS.float64 );
        } );

        it( 'should quantize to resolution=0.1', function () {
            const writer = createFloat64Writer( 0.1 );
            writer( mockSender, 'temp', 23.456 );

            expect( mockSender.floatColumn.calledWith( 'temp', 23.5 ) ).to.equal( true );
        } );

        it( 'should quantize to resolution=0.01', function () {
            const writer = createFloat64Writer( 0.01 );
            writer( mockSender, 'pressure', 95.555 );

            expect( mockSender.floatColumn.calledWith( 'pressure', 95.56 ) ).to.equal( true );
        } );

        it( 'should quantize to resolution=0.001', function () {
            const writer = createFloat64Writer( 0.001 );
            writer( mockSender, 'flow', 1.2345 );

            expect( mockSender.floatColumn.calledWith( 'flow', 1.235 ) ).to.equal( true );
        } );

        it( 'should quantize to coarse resolution=5', function () {
            const writer = createFloat64Writer( 5 );
            writer( mockSender, 'count', 23 );

            expect( mockSender.floatColumn.calledWith( 'count', 25 ) ).to.equal( true );
        } );

        it( 'should handle negative values', function () {
            const writer = createFloat64Writer( 0.1 );
            writer( mockSender, 'delta', -15.789 );

            expect( mockSender.floatColumn.calledWith( 'delta', -15.8 ) ).to.equal( true );
        } );

        it( 'should handle zero', function () {
            const writer = createFloat64Writer( 0.1 );
            writer( mockSender, 'value', 0 );

            expect( mockSender.floatColumn.calledWith( 'value', 0 ) ).to.equal( true );
        } );

        it( 'should preserve exact resolution multiples', function () {
            const writer = createFloat64Writer( 0.1 );
            writer( mockSender, 'exact', 10.1 );

            expect( mockSender.floatColumn.calledWith( 'exact', 10.1 ) ).to.equal( true );
        } );

        it( 'should round to nearest resolution step', function () {
            const writer = createFloat64Writer( 0.1 );

            writer( mockSender, 'below', 10.14 );
            expect( mockSender.floatColumn.calledWith( 'below', 10.1 ) ).to.equal( true );

            mockSender.floatColumn.resetHistory();

            writer( mockSender, 'above', 10.15 );
            expect( mockSender.floatColumn.calledWith( 'above', 10.2 ) ).to.equal( true );
        } );

    } );

} );
