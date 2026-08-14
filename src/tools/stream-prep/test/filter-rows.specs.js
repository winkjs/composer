// test/filter-rows.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { filterRows } from '../filter-rows.js';

// Anchor: 2026-08-13T00:00:00Z — see golden-truth-stream-prep.py §2/§3
// derivations (IST midnight 1786559400000 + 330 min = this UTC midnight).
const T0 = 1786579200000;

describe( 'filterRows', function () {

    // ── init validation ──────────────────────────────────────────

    describe( 'init validation', function () {

        it( 'throws when neither bound is given', function () {
            expect( () => filterRows() ).to.throw( 'winkComposer/filterRows: at least one of from/to is required.' );
            expect( () => filterRows( {} ) ).to.throw( 'at least one of from/to' );
        } );

        it( 'throws on an empty field name', function () {
            expect( () => filterRows( { field: '', from: 0 } ) ).to.throw( 'field must be a non-empty string' );
        } );

        it( 'throws on a non-finite numeric bound', function () {
            expect( () => filterRows( { from: Infinity } ) ).to.throw( 'from must be a finite epoch-ms number or a parseable date string' );
            expect( () => filterRows( { to: NaN } ) ).to.throw( 'to must be a finite epoch-ms number or a parseable date string' );
        } );

        it( 'throws on an unparseable string bound', function () {
            expect( () => filterRows( { from: 'not a date' } ) ).to.throw( 'from is not a parseable date string' );
        } );

        it( 'throws on a bound that is neither number nor string', function () {
            expect( () => filterRows( { from: true } ) ).to.throw( 'from must be a finite epoch-ms number or a parseable date string' );
        } );

        it( 'throws when from is later than to', function () {
            expect( () => filterRows( { from: 10, to: 5 } ) ).to.throw( 'from must not be later than to' );
        } );

    } );

    // ── window behavior ──────────────────────────────────────────

    describe( 'window behavior', function () {

        it( 'keeps a row inside the window and returns the same reference', function () {
            const transform = filterRows( { from: T0, to: T0 + 1000 } );
            const row = { timestamp: T0 + 500 };
            expect( transform( row ) === row ).to.equal( true );
        } );

        it( 'is inclusive at both bounds', function () {
            const transform = filterRows( { from: T0, to: T0 + 1000 } );
            expect( transform( { timestamp: T0 } ) ).to.not.equal( null );
            expect( transform( { timestamp: T0 + 1000 } ) ).to.not.equal( null );
        } );

        it( 'drops rows outside the window', function () {
            const transform = filterRows( { from: T0, to: T0 + 1000 } );
            expect( transform( { timestamp: T0 - 1 } ) ).to.equal( null );
            expect( transform( { timestamp: T0 + 1001 } ) ).to.equal( null );
        } );

        it( 'supports from-only and to-only windows', function () {
            const fromOnly = filterRows( { from: T0 } );
            expect( fromOnly( { timestamp: T0 - 1 } ) ).to.equal( null );
            expect( fromOnly( { timestamp: T0 + 1 } ) ).to.not.equal( null );
            const toOnly = filterRows( { to: T0 } );
            expect( toOnly( { timestamp: T0 + 1 } ) ).to.equal( null );
            expect( toOnly( { timestamp: T0 - 1 } ) ).to.not.equal( null );
        } );

        it( 'resolves ISO-string bounds at init', function () {
            const transform = filterRows( { from: '2026-08-13T00:00:00Z', to: '2026-08-13T00:00:01Z' } );
            expect( transform( { timestamp: T0 } ) ).to.not.equal( null );
            expect( transform( { timestamp: T0 + 1000 } ) ).to.not.equal( null );
            expect( transform( { timestamp: T0 + 1001 } ) ).to.equal( null );
        } );

        it( 'drops a row whose timestamp is not a finite number', function () {
            const transform = filterRows( { from: 0 } );
            expect( transform( { timestamp: NaN } ) ).to.equal( null );
            expect( transform( { timestamp: 'text' } ) ).to.equal( null );
            expect( transform( {} ) ).to.equal( null );
        } );

        it( 'reads a custom field name', function () {
            const transform = filterRows( { field: 'ts', from: T0 } );
            expect( transform( { ts: T0, timestamp: 0 } ) ).to.not.equal( null );
        } );

    } );

} );
