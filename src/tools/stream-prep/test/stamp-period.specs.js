// test/stamp-period.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { stampPeriod } from '../stamp-period.js';

describe( 'stampPeriod', function () {

    // ── init validation ──────────────────────────────────────────

    describe( 'init validation', function () {

        it( 'throws on a missing or unknown period', function () {
            expect( () => stampPeriod() ).to.throw( 'winkComposer/stampPeriod: period must be day or shift.' );
            expect( () => stampPeriod( { period: 'week' } ) ).to.throw( 'period must be day or shift' );
        } );

        it( 'rejects boundariesMin with period day', function () {
            expect( () => stampPeriod( { period: 'day', boundariesMin: [ 0 ] } ) ).to.throw( 'boundariesMin applies to shift only' );
        } );

        it( 'requires a valid schedule for period shift', function () {
            expect( () => stampPeriod( { period: 'shift' } ) ).to.throw( 'boundariesMin must be a non-empty array' );
            expect( () => stampPeriod( { period: 'shift', boundariesMin: [ 960, 480 ] } ) ).to.throw( 'boundariesMin must be strictly ascending' );
            expect( () => stampPeriod( { period: 'shift', boundariesMin: [ 1440 ] } ) ).to.throw( 'each boundary must be a minute-of-day in [0, 1440)' );
        } );

        it( 'validates field, target, and offsetMinutes', function () {
            expect( () => stampPeriod( { period: 'day', field: '' } ) ).to.throw( 'field must be a non-empty string' );
            expect( () => stampPeriod( { period: 'day', target: '' } ) ).to.throw( 'target must be a non-empty string' );
            expect( () => stampPeriod( { period: 'day', offsetMinutes: Infinity } ) ).to.throw( 'offsetMinutes must be a finite number' );
        } );

    } );

    // ── day keys — golden-truth-stream-prep.py §3 ────────────────

    describe( 'day keys', function () {

        it( 'stamps the local day index into the default dayKey target', function () {
            const transform = stampPeriod( { period: 'day', offsetMinutes: 330 } );
            expect( transform( { timestamp: 1786559400000 } ).dayKey ).to.equal( 20678 );    // IST 2026-08-13 00:00:00
            expect( transform( { timestamp: 1786559399000 } ).dayKey ).to.equal( 20677 );    // IST 2026-08-12 23:59:59
        } );

        it( 'matches the oracle at UTC and pre-epoch instants', function () {
            const transform = stampPeriod( { period: 'day' } );
            expect( transform( { timestamp: 1709208000000 } ).dayKey ).to.equal( 19782 );    // 2024-02-29 12:00 UTC
            expect( transform( { timestamp: -3600000 } ).dayKey ).to.equal( -1 );            // 1969-12-31 23:00 UTC
        } );

        it( 'honors a custom target and writes null on a bad clock', function () {
            const transform = stampPeriod( { period: 'day', target: 'd' } );
            const row = { timestamp: NaN };
            expect( transform( row ) === row ).to.equal( true );
            expect( row.d ).to.equal( null );
        } );

    } );

    // ── shift keys — golden-truth-stream-prep.py §4 ──────────────

    describe( 'shift keys', function () {

        it( 'stamps monotonic keys across shift and day boundaries', function () {
            const transform = stampPeriod( { period: 'shift', offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ] } );
            const cases = [
                [ 1786588140000, 62034 ],    // IST 07:59 — S1 of day 20678
                [ 1786588200000, 62035 ],    // IST 08:00 — S2 begins
                [ 1786645740000, 62036 ],    // IST 23:59 — S3
                [ 1786645800000, 62037 ]     // IST 00:00 next day — S1 of day 20679
            ];
            for ( let i = 0; i < cases.length; i += 1 ) {
                expect( transform( { timestamp: cases[ i ][ 0 ] } ).shiftKey ).to.equal( cases[ i ][ 1 ] );
            }
        } );

        it( 'wraps a pre-first-boundary time to the previous day\'s last shift', function () {
            // Schedule starting 06:00 IST: 05:00 belongs to yesterday's last
            // shift, so the key stays monotonic across midnight.
            const transform = stampPeriod( { period: 'shift', offsetMinutes: 330, boundariesMin: [ 360, 840, 1320 ] } );
            expect( transform( { timestamp: 1786577400000 } ).shiftKey ).to.equal( 62033 );    // IST 05:00
            expect( transform( { timestamp: 1786581000000 } ).shiftKey ).to.equal( 62034 );    // IST 06:00
            expect( transform( { timestamp: 1798743600000 } ).shiftKey ).to.equal( 62456 );    // IST 2027-01-01 00:30
        } );

        it( 'keys a pre-epoch instant (negative modulo wraps forward)', function () {
            // 1969-12-31 23:00 UTC — golden-truth-stream-prep.py §4 -> -1
            // (day -1, its S3 slot: (-1 * 3) + 2).
            const transform = stampPeriod( { period: 'shift', boundariesMin: [ 0, 480, 960 ] } );
            expect( transform( { timestamp: -3600000 } ).shiftKey ).to.equal( -1 );
        } );

        it( 'writes null on a bad clock and returns the same reference', function () {
            const transform = stampPeriod( { period: 'shift', boundariesMin: [ 0 ] } );
            const row = { timestamp: 'text' };
            expect( transform( row ) === row ).to.equal( true );
            expect( row.shiftKey ).to.equal( null );
        } );

        it( 'is immune to caller mutation of boundariesMin after init', function () {
            const boundariesMin = [ 0, 480, 960 ];
            const transform = stampPeriod( { period: 'shift', offsetMinutes: 330, boundariesMin } );
            boundariesMin[ 1 ] = 1;
            expect( transform( { timestamp: 1786588140000 } ).shiftKey ).to.equal( 62034 );
        } );

    } );

} );
