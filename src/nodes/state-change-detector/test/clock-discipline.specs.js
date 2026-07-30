// nodes/state-change-detector/test/clock-discipline.specs.js

/**
 * @fileoverview State Change Detector — which clock supplies the
 * dwell measurement, and what happens when that clock misbehaves.
 *
 * Covers, per ADR-004 fault handling:
 * - message-time mode (`timestampField`) reads time from the message
 *   and never from the device clock, so dwell values are exact
 *   during high-speed replay and immune to NTP corrections;
 * - wall-clock mode clamps an impossible negative dwell to 0 (a
 *   backward clock step landing mid-measurement), matching
 *   dwellTimeTracker's guard;
 * - a non-finite message timestamp faults that one message
 *   (`inputValidationFailed`) without corrupting the measurement in
 *   progress.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import * as stateChangeDetector from '../index.js';

const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

// debounce 1 confirms a change on its first differing sample — the
// timing math is the subject here, not the debounce filter.
const makeSpec = function ( extra = {} ) {
    return {
        nodeType: 'State Change Detector',
        name: 'clockSpec',
        from: { x: [ 'mode' ] },
        debounce: 1,
        stats: {
            dwellTime: { storeAs: 'modeDwell' },
            dwellSamples: { storeAs: 'modeSamples' }
        },
        ...extra
    };
};

describe( 'State Change Detector — clock discipline', function () {

    afterEach( function () {
        sinon.restore();
    } );

    describe( 'wall-clock mode (no timestampField)', function () {

        it( 'measures dwell from the device clock', function () {
            let fakeNow = 100000;
            sinon.stub( Date, 'now' ).callsFake( () => fakeNow );

            const state = stateChangeDetector.init( makeSpec() );
            stateChangeDetector.update( state, createMessage( { mode: 'run' } ) );

            fakeNow = 160000;
            stateChangeDetector.update( state, createMessage( { mode: 'stop' } ) );

            expect( state.dwellTime ).to.equal( 60000 );
        } );

        it( 'clamps a backward clock step to 0 — a dwell is never negative', function () {
            let fakeNow = 100000;
            sinon.stub( Date, 'now' ).callsFake( () => fakeNow );

            const state = stateChangeDetector.init( makeSpec() );
            stateChangeDetector.update( state, createMessage( { mode: 'run' } ) );

            // An NTP correction snaps the clock 60 s backwards while
            // the measurement is in progress.
            fakeNow = 40000;
            stateChangeDetector.update( state, createMessage( { mode: 'stop' } ) );

            expect( state.dwellTime ).to.equal( 0 );
        } );
    } );

    describe( 'message-time mode (timestampField)', function () {

        it( 'reads time from the message and never from the device clock', function () {
            // If the node consulted Date.now, this absurd value would
            // leak into the measurement.
            sinon.stub( Date, 'now' ).returns( 9_000_000_000_000 );

            const state = stateChangeDetector.init( makeSpec( { timestampField: 'ts' } ) );
            stateChangeDetector.update( state, createMessage( { mode: 'run', ts: 1000 } ) );
            stateChangeDetector.update( state, createMessage( { mode: 'stop', ts: 61000 } ) );

            expect( state.dwellTime ).to.equal( 60000 );
        } );

        it( 'computes replay-speed dwell values identical to a real-time run', function () {
            // An "hour" of messages replayed in a tight loop. The
            // expected dwells are the timestamp deltas, hard-coded.
            const state = stateChangeDetector.init( makeSpec( { timestampField: 'ts' } ) );
            const dwells = [];

            const feed = [
                { mode: 'run', ts: 0 },
                { mode: 'run', ts: 60000 },
                { mode: 'stop', ts: 3600000 },
                { mode: 'stop', ts: 3660000 },
                { mode: 'run', ts: 7200000 }
            ];
            for ( const values of feed ) {
                stateChangeDetector.update( state, createMessage( values ) );
                if ( state.dwellTime !== null ) {
                    dwells.push( state.dwellTime );
                }
            }

            expect( dwells ).to.deep.equal( [ 3600000, 3600000 ] );
        } );

        it( 'faults a message whose timestamp is missing, without breaking the measurement', function () {
            const state = stateChangeDetector.init( makeSpec( { timestampField: 'ts' } ) );
            stateChangeDetector.update( state, createMessage( { mode: 'run', ts: 1000 } ) );

            // ts missing: this ONE message is faulted per ADR-004...
            stateChangeDetector.update( state, createMessage( { mode: 'run' } ) );
            expect( state.inputValidationFailed ).to.equal( true );

            // ...and the measurement in progress is untouched: the
            // next good message still measures from the original start.
            stateChangeDetector.update( state, createMessage( { mode: 'stop', ts: 61000 } ) );
            expect( state.inputValidationFailed ).to.equal( false );
            expect( state.dwellTime ).to.equal( 60000 );
        } );

        it( 'faults a non-numeric timestamp the same way', function () {
            const state = stateChangeDetector.init( makeSpec( { timestampField: 'ts' } ) );
            stateChangeDetector.update( state, createMessage( { mode: 'run', ts: 1000 } ) );

            stateChangeDetector.update( state, createMessage( { mode: 'stop', ts: 'yesterday' } ) );
            expect( state.inputValidationFailed ).to.equal( true );
            expect( state.dwellTime ).to.equal( null );
        } );
    } );
} );
