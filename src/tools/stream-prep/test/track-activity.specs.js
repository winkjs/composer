// test/track-activity.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { trackActivity } from '../track-activity.js';

// Full-output factory used by the behavior traces. Expected values in the
// traces are hand-derived from the stated state model (hold `active` for
// windowSec after the last observed change; evidence-based start).
const fullTracker = function ( windowSec, extra ) {
    const opts = Object.assign( {
        from: 'p',
        windowSec,
        writes: { active: 'act', activeFor: 'actFor', sinceActivity: 'since', activeStart: 'actStart' }
    }, extra );
    return trackActivity( opts );
};

describe( 'trackActivity', function () {

    // ── init validation ──────────────────────────────────────────

    describe( 'init validation', function () {

        it( 'throws on a missing or empty from', function () {
            expect( () => trackActivity() ).to.throw( 'winkComposer/trackActivity: from must be a field name or a non-empty array of field names.' );
            expect( () => trackActivity( { windowSec: 10, writes: { active: 'a' } } ) ).to.throw( 'from must be a field name or a non-empty array of field names' );
            expect( () => trackActivity( { from: '', windowSec: 10, writes: { active: 'a' } } ) ).to.throw( 'from must be a non-empty field name' );
            expect( () => trackActivity( { from: [], windowSec: 10, writes: { active: 'a' } } ) ).to.throw( 'from must be a field name or a non-empty array' );
            expect( () => trackActivity( { from: [ 'p', '' ], windowSec: 10, writes: { active: 'a' } } ) ).to.throw( 'every from field must be a non-empty string' );
        } );

        it( 'throws on an invalid windowSec', function () {
            expect( () => trackActivity( { from: 'p', writes: { active: 'a' } } ) ).to.throw( 'windowSec must be a finite number' );
            expect( () => trackActivity( { from: 'p', windowSec: 0, writes: { active: 'a' } } ) ).to.throw( 'windowSec must be a positive number' );
            expect( () => trackActivity( { from: 'p', windowSec: -5, writes: { active: 'a' } } ) ).to.throw( 'windowSec must be a positive number' );
        } );

        it( 'throws on an invalid epsilon', function () {
            expect( () => trackActivity( { from: 'p', windowSec: 10, epsilon: -0.1, writes: { active: 'a' } } ) ).to.throw( 'epsilon must be a non-negative number' );
            expect( () => trackActivity( { from: 'p', windowSec: 10, epsilon: '0.1', writes: { active: 'a' } } ) ).to.throw( 'epsilon must be a finite number' );
        } );

        it( 'throws on an invalid timestampField', function () {
            expect( () => trackActivity( { from: 'p', windowSec: 10, timestampField: '', writes: { active: 'a' } } ) ).to.throw( 'timestampField must be a non-empty string' );
        } );

        it( 'throws on invalid writes', function () {
            expect( () => trackActivity( { from: 'p', windowSec: 10 } ) ).to.throw( 'writes must be an object naming at least one output' );
            expect( () => trackActivity( { from: 'p', windowSec: 10, writes: [] } ) ).to.throw( 'writes must be an object' );
            expect( () => trackActivity( { from: 'p', windowSec: 10, writes: {} } ) ).to.throw( 'writes must name at least one of' );
            expect( () => trackActivity( { from: 'p', windowSec: 10, writes: { running: 'r' } } ) ).to.throw( 'unknown write \'running\'' );
            expect( () => trackActivity( { from: 'p', windowSec: 10, writes: { active: '' } } ) ).to.throw( 'writes.active must be a non-empty field name' );
        } );

    } );

    // ── the state model, traced ──────────────────────────────────

    describe( 'state model', function () {

        it( 'walks the reference trace: seed, rise, hold, boundary, fall, re-rise', function () {
            const transform = fullTracker( 10 );    // window 10000 ms

            // t=0: first value seeds the baseline — no change observed yet.
            let row = transform( { timestamp: 0, p: 1 } );
            expect( row.act ).to.equal( false );
            expect( row.actFor ).to.equal( 0 );
            expect( row.since ).to.equal( null );
            expect( row.actStart ).to.equal( null );

            // t=1000: same value — still no evidence of activity.
            row = transform( { timestamp: 1000, p: 1 } );
            expect( row.act ).to.equal( false );

            // t=2000: change — the active run begins now.
            row = transform( { timestamp: 2000, p: 2 } );
            expect( row.act ).to.equal( true );
            expect( row.actFor ).to.equal( 0 );
            expect( row.since ).to.equal( 0 );
            expect( row.actStart ).to.equal( 2000 );

            // t=5000: no change, inside the window — run continues.
            row = transform( { timestamp: 5000, p: 2 } );
            expect( row.act ).to.equal( true );
            expect( row.actFor ).to.equal( 3000 );
            expect( row.since ).to.equal( 3000 );

            // t=12000: exactly windowMs since the last change — still active
            // (the hold is inclusive).
            row = transform( { timestamp: 12000, p: 2 } );
            expect( row.act ).to.equal( true );
            expect( row.actFor ).to.equal( 10000 );

            // t=12001: one ms past the window — idle; activeStart HOLDS.
            row = transform( { timestamp: 12001, p: 2 } );
            expect( row.act ).to.equal( false );
            expect( row.actFor ).to.equal( 0 );
            expect( row.since ).to.equal( 10001 );
            expect( row.actStart ).to.equal( 2000 );

            // t=13000: change — a new run starts, activeStart moves.
            row = transform( { timestamp: 13000, p: 3 } );
            expect( row.act ).to.equal( true );
            expect( row.actStart ).to.equal( 13000 );
        } );

        it( 'never claims active without observed evidence', function () {
            const transform = fullTracker( 10 );
            for ( let t = 0; t <= 50000; t += 5000 ) {
                expect( transform( { timestamp: t, p: 7 } ).act ).to.equal( false );
            }
        } );

        it( 'gates numeric jitter with epsilon (strictly-greater rule)', function () {
            const transform = fullTracker( 10, { epsilon: 0.5 } );
            transform( { timestamp: 0, p: 1.0 } );
            expect( transform( { timestamp: 1000, p: 1.4 } ).act ).to.equal( false );     // |0.4| <= 0.5
            expect( transform( { timestamp: 2000, p: 1.9 } ).act ).to.equal( false );     // |0.5| == epsilon — not a change
            expect( transform( { timestamp: 3000, p: 2.5 } ).act ).to.equal( true );      // |0.6| > 0.5
        } );

        it( 'treats null/undefined/NaN as no value: baseline undisturbed', function () {
            const transform = fullTracker( 10 );
            transform( { timestamp: 0, p: 1 } );
            expect( transform( { timestamp: 1000, p: NaN } ).act ).to.equal( false );
            expect( transform( { timestamp: 2000, p: null } ).act ).to.equal( false );
            expect( transform( { timestamp: 3000 } ).act ).to.equal( false );
            // The value returns unchanged — still not a change vs the baseline.
            expect( transform( { timestamp: 4000, p: 1 } ).act ).to.equal( false );
            // A real change is still caught against the surviving baseline.
            expect( transform( { timestamp: 5000, p: 2 } ).act ).to.equal( true );
        } );

        it( 'reads any one of several watched fields as activity', function () {
            const transform = trackActivity( {
                from: [ 'a', 'b' ], windowSec: 10, writes: { active: 'act' }
            } );
            transform( { timestamp: 0, a: 1, b: 1 } );
            expect( transform( { timestamp: 1000, a: 1, b: 2 } ).act ).to.equal( true );
        } );

        it( 'compares non-numeric values strictly', function () {
            const transform = fullTracker( 10 );
            transform( { timestamp: 0, p: 'stopped' } );
            expect( transform( { timestamp: 1000, p: 'running' } ).act ).to.equal( true );
        } );

    } );

    // ── contract details ─────────────────────────────────────────

    describe( 'contract', function () {

        it( 'writes null to configured outputs on a bad clock, without advancing state', function () {
            const transform = fullTracker( 10 );
            transform( { timestamp: 0, p: 1 } );
            transform( { timestamp: 1000, p: 2 } );    // active run starts
            const bad = transform( { p: 3 } );          // no timestamp
            expect( bad.act ).to.equal( null );
            expect( bad.actFor ).to.equal( null );
            expect( bad.since ).to.equal( null );
            expect( bad.actStart ).to.equal( null );
            // State survives: the bad-clock message returned before the
            // comparison loop, so its p: 3 was never seeded — the baseline is
            // still 2, and the run is still inside the window.
            expect( transform( { timestamp: 2000, p: 2 } ).act ).to.equal( true );
        } );

        it( 'stamps only the configured outputs', function () {
            const transform = trackActivity( { from: 'p', windowSec: 10, writes: { active: 'act' } } );
            const row = transform( { timestamp: 0, p: 1 } );
            expect( row.act ).to.equal( false );
            expect( 'actFor' in row ).to.equal( false );
            expect( 'since' in row ).to.equal( false );
        } );

        it( 'supports the dead-sensor read: sinceActivity as the only output', function () {
            const transform = trackActivity( { from: 'p', windowSec: 10, writes: { sinceActivity: 'since' } } );
            transform( { timestamp: 0, p: 1 } );
            transform( { timestamp: 1000, p: 2 } );
            const row = transform( { timestamp: 61000, p: 2 } );
            expect( row.since ).to.equal( 60000 );
            expect( 'act' in row ).to.equal( false );
        } );

        it( 'mutates in place and returns the same reference', function () {
            const transform = fullTracker( 10 );
            const row = { timestamp: 0, p: 1 };
            expect( transform( row ) === row ).to.equal( true );
        } );

        it( 'reads a custom timestampField', function () {
            const transform = trackActivity( { from: 'p', windowSec: 10, timestampField: 'ts', writes: { active: 'act' } } );
            transform( { ts: 0, p: 1 } );
            expect( transform( { ts: 1000, p: 2 } ).act ).to.equal( true );
        } );

    } );

} );
