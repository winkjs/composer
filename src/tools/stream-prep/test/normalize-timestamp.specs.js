// test/normalize-timestamp.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { normalizeTimestamp } from '../normalize-timestamp.js';

describe( 'normalizeTimestamp', function () {

    // ── init validation ──────────────────────────────────────────

    describe( 'init validation', function () {

        it( 'throws on empty field or target', function () {
            expect( () => normalizeTimestamp( { field: '' } ) ).to.throw( 'winkComposer/normalizeTimestamp: field must be a non-empty string.' );
            expect( () => normalizeTimestamp( { target: '' } ) ).to.throw( 'target must be a non-empty string' );
        } );

        it( 'throws on an unknown unit', function () {
            expect( () => normalizeTimestamp( { unit: 'sec' } ) ).to.throw( 'unit must be one of ms, s, auto (got sec)' );
        } );

        it( 'rejects a prototype-chain unit key (constructor)', function () {
            // CONVERTERS is Object.create( null ), so 'constructor' cannot
            // resolve through the prototype chain to a function.
            expect( () => normalizeTimestamp( { unit: 'constructor' } ) ).to.throw( 'unit must be one of ms, s, auto' );
        } );

        it( 'rejects unit alongside pattern', function () {
            expect( () => normalizeTimestamp( { unit: 'ms', pattern: 'YYYY-MM-DD HH:mm:ss' } ) ).to.throw( 'unit and pattern are mutually exclusive' );
        } );

        it( 'rejects offsetMinutes without pattern', function () {
            expect( () => normalizeTimestamp( { offsetMinutes: 330 } ) ).to.throw( 'offsetMinutes applies to pattern only' );
        } );

        it( 'rejects an unsupported pattern', function () {
            expect( () => normalizeTimestamp( { pattern: 'DD/MM/YYYY' } ) ).to.throw( 'the supported pattern is \'YYYY-MM-DD HH:mm:ss\'' );
        } );

        it( 'rejects a non-finite offsetMinutes', function () {
            expect( () => normalizeTimestamp( { pattern: 'YYYY-MM-DD HH:mm:ss', offsetMinutes: NaN } ) ).to.throw( 'offsetMinutes must be a finite number' );
        } );

    } );

    // ── unit modes ───────────────────────────────────────────────

    describe( 'unit modes', function () {

        it( 'ms: numbers and numeric strings pass as epoch ms', function () {
            const transform = normalizeTimestamp( { unit: 'ms' } );
            expect( transform( { timestamp: 1755043200000 } ).timestamp ).to.equal( 1755043200000 );
            expect( transform( { timestamp: '1755043200000' } ).timestamp ).to.equal( 1755043200000 );
        } );

        it( 's: epoch seconds multiply by exactly 1000 — see golden-truth-stream-prep.py §5', function () {
            const transform = normalizeTimestamp( { unit: 's' } );
            expect( transform( { timestamp: 1755043200 } ).timestamp ).to.equal( 1755043200000 );
            expect( transform( { timestamp: 0 } ).timestamp ).to.equal( 0 );
            expect( transform( { timestamp: -1 } ).timestamp ).to.equal( -1000 );
            expect( transform( { timestamp: 1755043200.5 } ).timestamp ).to.equal( 1755043200500 );
        } );

        it( 's: an empty cell becomes NaN, not epoch 0', function () {
            const transform = normalizeTimestamp( { unit: 's' } );
            expect( Number.isNaN( transform( { timestamp: '' } ).timestamp ) ).to.equal( true );
            expect( Number.isNaN( transform( { timestamp: null } ).timestamp ) ).to.equal( true );
        } );

        it( 'auto: numbers pass through, ISO strings parse', function () {
            const transform = normalizeTimestamp();
            expect( transform( { timestamp: 123 } ).timestamp ).to.equal( 123 );
            expect( transform( { timestamp: '2026-08-13T00:00:00Z' } ).timestamp ).to.equal( 1786579200000 );
        } );

        it( 'auto: unparseable text becomes NaN', function () {
            const transform = normalizeTimestamp();
            expect( Number.isNaN( transform( { timestamp: 'garbage' } ).timestamp ) ).to.equal( true );
        } );

        it( 'writes to a separate target when configured', function () {
            const transform = normalizeTimestamp( { field: 'ts', target: 'timestamp', unit: 's' } );
            const row = { ts: 10 };
            transform( row );
            expect( row.timestamp ).to.equal( 10000 );
            expect( row.ts ).to.equal( 10 );
        } );

        it( 'mutates in place and returns the same reference', function () {
            const transform = normalizeTimestamp( { unit: 'ms' } );
            const row = { timestamp: 5 };
            expect( transform( row ) === row ).to.equal( true );
        } );

    } );

    // ── pattern mode — golden truth from golden-truth-stream-prep.py §1 ──

    describe( 'pattern mode', function () {

        const at = function ( offsetMinutes ) {
            return normalizeTimestamp( { pattern: 'YYYY-MM-DD HH:mm:ss', offsetMinutes } );
        };

        it( 'parses the historian shape under an IST offset', function () {
            expect( at( 330 )( { timestamp: '2026-04-07 09:15:00' } ).timestamp ).to.equal( 1775533500000 );
        } );

        it( 'parses the same text as UTC at offset 0 (the default)', function () {
            const transform = normalizeTimestamp( { pattern: 'YYYY-MM-DD HH:mm:ss' } );
            expect( transform( { timestamp: '2026-04-07 09:15:00' } ).timestamp ).to.equal( 1775553300000 );
        } );

        it( 'handles leap days exactly: divisible-by-4 and 400-rule years', function () {
            expect( at( 0 )( { timestamp: '2024-02-29 23:59:59' } ).timestamp ).to.equal( 1709251199000 );
            expect( at( 0 )( { timestamp: '2000-02-29 12:00:00' } ).timestamp ).to.equal( 951825600000 );
        } );

        it( 'handles year boundaries under an offset', function () {
            expect( at( 330 )( { timestamp: '2026-12-31 23:59:59' } ).timestamp ).to.equal( 1798741799000 );
            expect( at( 330 )( { timestamp: '2026-01-01 00:00:00' } ).timestamp ).to.equal( 1767205800000 );
        } );

        it( 'handles pre-epoch instants (negative epoch ms)', function () {
            expect( at( 0 )( { timestamp: '1969-12-31 23:59:59' } ).timestamp ).to.equal( -1000 );
        } );

        it( 'reads a fraction: ms kept, further digits truncated', function () {
            expect( at( 0 )( { timestamp: '2026-08-13 07:05:09.5' } ).timestamp ).to.equal( 1786604709500 );
            expect( at( 0 )( { timestamp: '2026-08-13 07:05:09.123' } ).timestamp ).to.equal( 1786604709123 );
            expect( at( 0 )( { timestamp: '2026-08-13 07:05:09.123456' } ).timestamp ).to.equal( 1786604709123 );
        } );

        it( 'rejects impossible dates and times — golden-truth-stream-prep.py §1r', function () {
            const transform = at( 0 );
            const rejects = [
                '2023-02-29 10:00:00', '2100-02-29 10:00:00',
                '2026-13-01 10:00:00', '2026-00-10 10:00:00',
                '2026-04-31 10:00:00', '2026-04-07 24:00:00',
                '2026-04-07 09:60:00', '2026-04-07 09:15:60'
            ];
            for ( let i = 0; i < rejects.length; i += 1 ) {
                expect( Number.isNaN( transform( { timestamp: rejects[ i ] } ).timestamp ) ).to.equal( true );
            }
        } );

        it( 'rejects wrong layouts and non-strings', function () {
            const transform = at( 0 );
            const rejects = [
                '2026/04/07 09:15:00', '2026-04-07T09:15:00',
                '2026-04-07 09:15', '2026-04-07 09:15:00Z',
                '2026-04-07 09:15:00.', '2026-04-07 09:15:00.12a',
                '2026-O4-07 09:15:00'
            ];
            for ( let i = 0; i < rejects.length; i += 1 ) {
                expect( Number.isNaN( transform( { timestamp: rejects[ i ] } ).timestamp ) ).to.equal( true );
            }
            expect( Number.isNaN( transform( { timestamp: 1755043200000 } ).timestamp ) ).to.equal( true );
            expect( Number.isNaN( transform( { timestamp: null } ).timestamp ) ).to.equal( true );
        } );

    } );

} );
