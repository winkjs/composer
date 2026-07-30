// core/test-utils/test/sealed-record.specs.js

/**
 * @fileoverview Unit tests for the sealed-record harness.
 *
 * The harness itself is under test here — before any sink is. It exists
 * to prove, mechanically, that a sink reads everything it needs from an
 * incoming record DURING its synchronous hot-path call and never touches
 * the record again after the call returns (ADR-023). These tests show the
 * harness can actually tell the two apart:
 *
 *   - a compliant consumer (reads only during the call) produces zero
 *     violations, and the harness shows the reads really happened;
 *   - a deferring consumer (keeps the reference, reads on a later tick)
 *     is flagged, with the offending key named.
 *
 * Without the second case the harness could pass everything and prove
 * nothing.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { makeSealedRecord } from '../sealed-record.js';

// Resolves after pending setImmediate callbacks have run — the window in
// which a deferring consumer would do its late read.
const tick = () => new Promise( ( resolve ) => setImmediate( resolve ) );

describe( 'sealed-record harness — makeSealedRecord()', function () {

    describe( 'transparency', function () {

        it( 'behaves like the underlying object for reads', function () {
            const { record } = makeSealedRecord( { a: 1, b: 'two' } );
            expect( record.a ).to.equal( 1 );
            expect( record.b ).to.equal( 'two' );
            expect( 'a' in record ).to.equal( true );
            expect( Object.keys( record ) ).to.deep.equal( [ 'a', 'b' ] );
        } );

        it( 'survives JSON serialization with the original content', function () {
            const { record } = makeSealedRecord( { a: 1, b: 'two' } );
            expect( JSON.parse( JSON.stringify( record ) ) ).to.deep.equal( { a: 1, b: 'two' } );
        } );
    } );

    describe( 'a compliant consumer', function () {

        it( 'produces zero violations and visible reads', async function () {
            const { record, seal, violations, reads } = makeSealedRecord( { a: 1, b: 2 } );

            // Reads happen inside the "call", before seal — like a sink
            // serializing the record before its write() returns.
            const copy = { a: record.a, b: record.b };
            seal();
            await tick();

            expect( copy ).to.deep.equal( { a: 1, b: 2 } );
            expect( violations.length ).to.equal( 0 );
            expect( reads.length >= 2 ).to.equal( true );
        } );

        it( 'counts enumeration during the call as reads, not violations', async function () {
            const { record, seal, violations, reads } = makeSealedRecord( { a: 1 } );

            Object.keys( record );
            seal();
            await tick();

            expect( violations.length ).to.equal( 0 );
            expect( reads.length >= 1 ).to.equal( true );
        } );
    } );

    describe( 'a deferring consumer', function () {

        it( 'is flagged when it reads a property after seal, naming the key', async function () {
            const { record, seal, violations } = makeSealedRecord( { a: 1, late: 42 } );

            // A non-compliant sink: keeps the reference and reads it on a
            // later tick, after its call has already returned.
            let lateValue = null;
            setImmediate( () => {
                lateValue = record.late;
            } );
            seal();
            await tick();

            expect( lateValue ).to.equal( 42 );
            expect( violations.length ).to.equal( 1 );
            expect( violations[ 0 ].key ).to.equal( 'late' );
            expect( violations[ 0 ].trap ).to.equal( 'get' );
        } );

        it( 'is flagged when it probes key presence after seal', function () {
            const { record, seal, violations } = makeSealedRecord( { a: 1 } );

            seal();
            const present = 'a' in record;

            expect( present ).to.equal( true );
            expect( violations.length ).to.equal( 1 );
            expect( violations[ 0 ].trap ).to.equal( 'has' );
        } );

        it( 'is flagged when it enumerates keys after seal', function () {
            const { record, seal, violations } = makeSealedRecord( { a: 1 } );

            seal();
            const keys = Object.keys( record );

            expect( keys ).to.deep.equal( [ 'a' ] );
            expect( violations.length >= 1 ).to.equal( true );
            expect( violations[ 0 ].trap ).to.equal( 'ownKeys' );
        } );
    } );

    describe( 'bookkeeping rules', function () {

        it( 'does not move pre-seal reads into violations, and seal is idempotent', async function () {
            const { record, seal, violations } = makeSealedRecord( { a: 1 } );

            const preSealValue = record.a;
            seal();
            seal();
            await tick();

            expect( preSealValue ).to.equal( 1 );
            expect( violations.length ).to.equal( 0 );
        } );

        it( 'ignores symbol-keyed probes entirely', function () {
            // Engine and inspection machinery probes symbols
            // (Symbol.toStringTag and friends); record columns are always
            // string-named, so symbol traffic is noise, not data reads.
            const { record, seal, violations, reads } = makeSealedRecord( { a: 1 } );

            const tag = record[ Symbol.toStringTag ];
            seal();
            const iterator = record[ Symbol.iterator ];

            expect( tag ).to.equal( undefined );
            expect( iterator ).to.equal( undefined );
            expect( reads.length ).to.equal( 0 );
            expect( violations.length ).to.equal( 0 );
        } );
    } );
} );
