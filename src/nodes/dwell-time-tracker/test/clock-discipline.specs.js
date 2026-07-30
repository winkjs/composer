// nodes/dwell-time-tracker/test/clock-discipline.specs.js

/**
 * @fileoverview Dwell Time Tracker — which clock supplies the dwell
 * measurement, and what happens when that clock misbehaves.
 *
 * The tracker already carries both ADR-004 guards this suite pins:
 * the finite-timestamp fault (update.js:37-41) and the
 * negative-dwell clamp (update.js:74). These tests hold them in
 * place and prove message-time mode is exact at replay speed.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import sinon from 'sinon';
import * as dwellTimeTracker from '../index.js';

const createMessage = function ( values ) {
    const msg = Object.create( null );
    Object.keys( values ).forEach( ( key ) => {
        msg[ key ] = values[ key ];
    } );
    return msg;
};

const makeSpec = function ( extra = {} ) {
    return {
        nodeType: 'Dwell Time Tracker',
        name: 'clockSpec',
        predicate: ( msg ) => msg.on,
        stats: {
            dwellTime: { storeAs: 'dwell' },
            dutyCycle: { storeAs: 'duty' }
        },
        ...extra
    };
};

describe( 'Dwell Time Tracker — clock discipline', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'measures dwell from the device clock when no timestampField is set', function () {
        let fakeNow = 100000;
        sinon.stub( Date, 'now' ).callsFake( () => fakeNow );

        const state = dwellTimeTracker.init( makeSpec() );
        dwellTimeTracker.update( state, createMessage( { on: false } ) );

        fakeNow = 160000;
        dwellTimeTracker.update( state, createMessage( { on: true } ) );

        expect( state.dwellTime ).to.equal( 60000 );
    } );

    it( 'clamps a backward clock step to 0 — the existing guard stays', function () {
        let fakeNow = 100000;
        sinon.stub( Date, 'now' ).callsFake( () => fakeNow );

        const state = dwellTimeTracker.init( makeSpec() );
        dwellTimeTracker.update( state, createMessage( { on: false } ) );

        // An NTP correction snaps the clock 60 s backwards while the
        // measurement is in progress.
        fakeNow = 40000;
        dwellTimeTracker.update( state, createMessage( { on: true } ) );

        expect( state.dwellTime ).to.equal( 0 );
    } );

    it( 'reads time from the message and never from the device clock', function () {
        // If the node consulted Date.now, this absurd value would
        // leak into the measurement.
        sinon.stub( Date, 'now' ).returns( 9_000_000_000_000 );

        const state = dwellTimeTracker.init( makeSpec( { timestampField: 'ts' } ) );
        dwellTimeTracker.update( state, createMessage( { on: false, ts: 1000 } ) );
        dwellTimeTracker.update( state, createMessage( { on: true, ts: 61000 } ) );

        expect( state.dwellTime ).to.equal( 60000 );
    } );

    it( 'computes replay-speed dwell and duty cycle identical to a real-time run', function () {
        // Two minutes off, one minute on, replayed in a tight loop.
        // Expected values are the timestamp deltas, hard-coded:
        // off-dwell 120000 ms, on-dwell 60000 ms, duty cycle
        // 60000 / 180000.
        const state = dwellTimeTracker.init( makeSpec( { timestampField: 'ts' } ) );

        dwellTimeTracker.update( state, createMessage( { on: false, ts: 0 } ) );
        dwellTimeTracker.update( state, createMessage( { on: true, ts: 120000 } ) );
        expect( state.dwellTime ).to.equal( 120000 );

        dwellTimeTracker.update( state, createMessage( { on: false, ts: 180000 } ) );
        expect( state.dwellTime ).to.equal( 60000 );
        expect( state.dutyCycle ).to.be.closeTo( 0.3333333333333333, 1e-12 );
    } );
} );
