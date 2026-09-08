// core/utils/callback-guard/test/callback-guard.specs.js

/**
 * @fileoverview Unit specs for the shared callback guard.
 *
 * The guard arms user-supplied callbacks so their faults cost the
 * callback's output, never the pipeline (ADR-018: a misbehaving user
 * callback never reaches transport code and never fails silently).
 * These specs pin the module's own contract; the per-adapter wiring
 * is pinned by src/core/test/callback-guard-contract.specs.js.
 *
 * The hardening cases matter most: the fault reporter itself must
 * survive `throw null`, a reasonless rejection, a throwing `message`
 * getter, and an error with no usable string form. A reporter that
 * throws while reporting would reintroduce the crash class the guard
 * exists to close.
 */

/* eslint-disable no-throw-literal */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';

import {
    wrapCallback,
    wrapTransform,
    TRANSFORM_THREW,
    FULL_FAULT_LINES_PER_EPISODE,
    FAULT_SUMMARY_INTERVAL_MS
} from '../index.js';

const settle = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
};

/** A fixed wall clock, so every duration has a value the spec can name. */
const NOW = 1735500000000;

describe( 'callback guard — wrapCallback', function () {

    const unhandled = [];
    const trap = function ( reason ) {
        unhandled.push( reason );
    };

    beforeEach( function () {
        unhandled.length = 0;
        process.on( 'unhandledRejection', trap );
    } );

    afterEach( function () {
        process.removeListener( 'unhandledRejection', trap );
        sinon.restore();
    } );

    describe( 'absent stays absent', function () {

        it( 'returns null for undefined', function () {
            expect( wrapCallback( undefined, { name: 'x', severity: 'red', report: () => null } ) ).to.equal( null );
        } );

        it( 'returns null for null', function () {
            expect( wrapCallback( null, { name: 'x', severity: 'red', report: () => null } ) ).to.equal( null );
        } );

        it( 'returns null for a non-function value', function () {
            expect( wrapCallback( 'log-it', { name: 'x', severity: 'red', report: () => null } ) ).to.equal( null );
        } );

    } );

    describe( 'the success path', function () {

        it( 'passes both arguments through untouched, by identity', function () {
            const fn = sinon.spy();
            const err = new Error( 'delivery lost' );
            const ctx = { topic: 't/1' };
            const wrapped = wrapCallback( fn, { name: 'onDeliveryFailure', severity: 'red', report: () => null } );
            wrapped( err, ctx );
            expect( fn.calledOnce ).to.equal( true );
            expect( fn.firstCall.args[ 0 ] ).to.equal( err );
            expect( fn.firstCall.args[ 1 ] ).to.equal( ctx );
        } );

        it( 'never calls report when the callback succeeds', function () {
            const report = sinon.spy();
            const wrapped = wrapCallback( () => 42, { name: 'onMetrics', severity: 'yellow', report } );
            wrapped( { delivered: 1 } );
            expect( report.called ).to.equal( false );
        } );

        it( 'never calls report when an async callback resolves', async function () {
            const report = sinon.spy();
            const wrapped = wrapCallback( () => Promise.resolve( 42 ), { name: 'onMetrics', severity: 'yellow', report } );
            wrapped( { delivered: 1 } );
            await settle();
            expect( report.called ).to.equal( false );
        } );

    } );

    describe( 'the sync fault face', function () {

        it( 'contains a throw and reports severity, name, and the message', function () {
            const report = sinon.spy();
            const wrapped = wrapCallback( () => {
                throw new Error( 'boom' );
            }, { name: 'onStatus', severity: 'red', report } );
            expect( () => wrapped( {} ) ).to.not.throw();
            expect( report.calledOnce ).to.equal( true );
            expect( report.firstCall.args ).to.deep.equal( [ 'red', 'onStatus', 'boom' ] );
        } );

        it( 'survives `throw null` — the detail reads "null"', function () {
            const report = sinon.spy();
            const wrapped = wrapCallback( () => {
                throw null;
            }, { name: 'onStatus', severity: 'red', report } );
            expect( () => wrapped( {} ) ).to.not.throw();
            expect( report.firstCall.args[ 2 ] ).to.equal( 'null' );
        } );

        it( 'survives a throwing `message` getter', function () {
            const report = sinon.spy();
            const hostile = Object.create( Error.prototype, {
                message: {
                    get () {
                        throw new Error( 'gotcha' );
                    }
                }
            } );
            const wrapped = wrapCallback( () => {
                throw hostile;
            }, { name: 'onStatus', severity: 'red', report } );
            expect( () => wrapped( {} ) ).to.not.throw();
            expect( report.calledOnce ).to.equal( true );
            expect( report.firstCall.args[ 2 ] ).to.equal( 'unprintable error' );
        } );

        it( 'survives an error with no string form at all', function () {
            const report = sinon.spy();
            // Object.create( null ) has no toString: String() throws.
            const wrapped = wrapCallback( () => {
                throw Object.create( null );
            }, { name: 'onStatus', severity: 'red', report } );
            expect( () => wrapped( {} ) ).to.not.throw();
            expect( report.firstCall.args[ 2 ] ).to.equal( 'unprintable error' );
        } );

    } );

    describe( 'the async fault face', function () {

        it( 'contains a rejected promise and reports once', async function () {
            const report = sinon.spy();
            const wrapped = wrapCallback(
                () => Promise.reject( new Error( 'late boom' ) ),
                { name: 'onDeliveryFailure', severity: 'red', report }
            );
            wrapped( new Error( 'cause' ), {} );
            await settle();
            expect( report.calledOnce ).to.equal( true );
            expect( report.firstCall.args ).to.deep.equal( [ 'red', 'onDeliveryFailure', 'late boom' ] );
            expect( unhandled.length ).to.equal( 0 );
        } );

        it( 'contains a reasonless rejection — the detail reads "undefined"', async function () {
            const report = sinon.spy();
            const wrapped = wrapCallback(
                () => Promise.reject(),
                { name: 'onError', severity: 'red', report }
            );
            wrapped( new Error( 'cause' ), {} );
            await settle();
            expect( report.firstCall.args[ 2 ] ).to.equal( 'undefined' );
            expect( unhandled.length ).to.equal( 0 );
        } );

        it( 'routes a custom thenable rejection through the same report', async function () {
            const report = sinon.spy();
            const thenable = {
                then ( _resolve, reject ) {
                    reject( new Error( 'thenable boom' ) );
                }
            };
            const wrapped = wrapCallback( () => thenable, { name: 'onStatus', severity: 'red', report } );
            wrapped( {} );
            await settle();
            expect( report.calledOnce ).to.equal( true );
            expect( report.firstCall.args[ 2 ] ).to.equal( 'thenable boom' );
        } );

        it( 'contains a thenable whose then itself throws', async function () {
            const report = sinon.spy();
            const thenable = {
                then () {
                    throw new Error( 'then blew up' );
                }
            };
            const wrapped = wrapCallback( () => thenable, { name: 'onStatus', severity: 'red', report } );
            expect( () => wrapped( {} ) ).to.not.throw();
            await settle();
            expect( report.calledOnce ).to.equal( true );
            expect( report.firstCall.args[ 2 ] ).to.equal( 'then blew up' );
        } );

        it( 'sinks a thenable whose then RETURNS a rejected promise (fresh-eyes find, 2026-08-28)', async function () {
            // A non-conforming thenable can ignore its handlers and hand
            // back a rejected promise instead. Discarding that return
            // used to leak it as an unhandled rejection.
            const report = sinon.spy();
            const thenable = {
                then () {
                    return Promise.reject( new Error( 'evil return' ) );
                }
            };
            const wrapped = wrapCallback( () => thenable, { name: 'onStatus', severity: 'red', report } );
            wrapped( {} );
            await settle();
            await settle();
            expect( report.calledOnce ).to.equal( true );
            expect( report.firstCall.args[ 2 ] ).to.equal( 'evil return' );
            expect( unhandled.length ).to.equal( 0 );
        } );

    } );

    describe( 'the reporter is throw-proof', function () {

        it( 'a throwing report on the sync face is contained with one last-resort console line', function () {
            const errorSpy = sinon.spy( console, 'error' );
            const wrapped = wrapCallback( () => {
                throw new Error( 'boom' );
            }, {
                name: 'onStatus',
                severity: 'red',
                report: () => {
                    throw new Error( 'reporter also broken' );
                }
            } );
            expect( () => wrapped( {} ) ).to.not.throw();
            errorSpy.restore();
            const lines = errorSpy.getCalls()
                .map( ( c ) => String( c.args[ 0 ] ) )
                .filter( ( l ) => l.includes( 'CALLBACK_FAILED' ) );
            expect( lines.length ).to.equal( 1 );
        } );

        it( 'a throwing report on the async face never becomes an unhandled rejection', async function () {
            const errorSpy = sinon.spy( console, 'error' );
            const wrapped = wrapCallback( () => Promise.reject( new Error( 'late boom' ) ), {
                name: 'onStatus',
                severity: 'red',
                report: () => {
                    throw new Error( 'reporter also broken' );
                }
            } );
            wrapped( {} );
            await settle();
            await settle();
            errorSpy.restore();
            expect( unhandled.length ).to.equal( 0 );
            const lines = errorSpy.getCalls()
                .map( ( c ) => String( c.args[ 0 ] ) )
                .filter( ( l ) => l.includes( 'CALLBACK_FAILED' ) );
            expect( lines.length ).to.equal( 1 );
        } );

    } );

    describe( 'the fault report is bounded per callback (ADR-029, the bounded loss line)', function () {

        let clock;

        beforeEach( function () {
            clock = sinon.useFakeTimers( { now: NOW } );
        } );

        afterEach( function () {
            clock.restore();
        } );

        const throwing = function ( report ) {
            return wrapCallback( () => {
                throw new Error( 'boom' );
            }, { name: 'onStatus', severity: 'red', report } );
        };

        /** Fires the wrapped callback `count` times, one per second. */
        const faultEverySecond = function ( wrapped, count ) {
            for ( let i = 0; i < count; i += 1 ) {
                wrapped( {} );
                clock.tick( 1000 );
            }
        }; // faultEverySecond()

        it( 'the first two faults of an episode report in full, the rest of the minute report nothing', function () {
            const report = sinon.spy();
            const wrapped = throwing( report );

            faultEverySecond( wrapped, 60 );

            expect( report.callCount ).to.equal( 2 );
            expect( report.firstCall.args ).to.deep.equal( [ 'red', 'onStatus', 'boom' ] );
            expect( report.secondCall.args ).to.deep.equal( [ 'red', 'onStatus', 'boom' ] );
        } );

        it( 'one summary per minute carries the count since the last line, on the same channel', function () {
            const report = sinon.spy();
            const wrapped = throwing( report );

            // Full lines at 0 s and 1 s. The 59 faults at 2 s to 60 s are
            // counted. The fault at 61 s is a minute after the last line,
            // so it reports the summary and is the 60th counted.
            faultEverySecond( wrapped, 62 );

            expect( report.callCount ).to.equal( 3 );
            expect( report.thirdCall.args ).to.deep.equal( [
                'red', 'onStatus', 'boom; 60 more fault(s) in the last 60 s'
            ] );
        } );

        it( 'a quiet minute ends the episode, so the next fault reports in full again', function () {
            const report = sinon.spy();
            const wrapped = throwing( report );

            faultEverySecond( wrapped, 2 );
            clock.tick( FAULT_SUMMARY_INTERVAL_MS );
            wrapped( {} );

            expect( report.callCount ).to.equal( 3 );
            expect( report.thirdCall.args ).to.deep.equal( [ 'red', 'onStatus', 'boom' ] );
        } );

        it( 'each wrapped callback has its own bound', function () {
            const reportA = sinon.spy();
            const reportB = sinon.spy();
            const a = throwing( reportA );
            const b = throwing( reportB );

            faultEverySecond( a, 10 );
            faultEverySecond( b, 10 );

            expect( reportA.callCount ).to.equal( 2 );
            expect( reportB.callCount ).to.equal( 2 );
        } );

        it( 'async faults share the same bound', async function () {
            const report = sinon.spy();
            const wrapped = wrapCallback(
                () => Promise.reject( new Error( 'late boom' ) ),
                { name: 'onMetrics', severity: 'yellow', report }
            );

            for ( let i = 0; i < 5; i += 1 ) {
                wrapped( {} );
                await clock.tickAsync( 1000 ); // eslint-disable-line no-await-in-loop
            }

            expect( report.callCount ).to.equal( 2 );
            expect( report.firstCall.args ).to.deep.equal( [ 'yellow', 'onMetrics', 'late boom' ] );
            expect( unhandled.length ).to.equal( 0 );
        } );

        it( 'a throwing report on the summary is contained like one on a full line', function () {
            const errorSpy = sinon.spy( console, 'error' );
            const wrapped = wrapCallback( () => {
                throw new Error( 'boom' );
            }, {
                name: 'onStatus',
                severity: 'red',
                report: () => {
                    throw new Error( 'reporter also broken' );
                }
            } );

            expect( () => faultEverySecond( wrapped, 62 ) ).to.not.throw();

            errorSpy.restore();
            const lines = errorSpy.getCalls()
                .map( ( c ) => String( c.args[ 0 ] ) )
                .filter( ( l ) => l.includes( 'CALLBACK_FAILED' ) );
            // Two full lines and one summary, each falling back once.
            expect( lines.length ).to.equal( 3 );
        } );

        it( 'exposes the bound as two constants', function () {
            expect( FULL_FAULT_LINES_PER_EPISODE ).to.equal( 2 );
            expect( FAULT_SUMMARY_INTERVAL_MS ).to.equal( 60000 );
        } );

    } );

} );

describe( 'callback guard — wrapTransform', function () {

    afterEach( function () {
        sinon.restore();
    } );

    it( 'passes the return value through by identity', function () {
        const row = { id: 'a' };
        const out = { id: 'a', v: 1 };
        const guarded = wrapTransform( () => out, () => null );
        expect( guarded( row, 7 ) ).to.equal( out );
    } );

    it( 'passes null and undefined returns through untouched (the drop contract)', function () {
        const guarded = wrapTransform( () => null, () => null );
        expect( guarded( {}, 0 ) ).to.equal( null );
        const guarded2 = wrapTransform( () => undefined, () => null );
        expect( guarded2( {}, 0 ) ).to.equal( undefined );
    } );

    it( 'returns the sentinel on a throw and hands onFault a safe detail plus the context', function () {
        const onFault = sinon.spy();
        const guarded = wrapTransform( () => {
            throw new Error( 'bad row' );
        }, onFault );
        expect( guarded( {}, 'topic/9' ) ).to.equal( TRANSFORM_THREW );
        expect( onFault.calledOnce ).to.equal( true );
        expect( onFault.firstCall.args[ 0 ] ).to.equal( 'bad row' );
        expect( onFault.firstCall.args[ 1 ] ).to.equal( 'topic/9' );
    } );

    it( 'survives `throw null` from the transform', function () {
        const onFault = sinon.spy();
        const guarded = wrapTransform( () => {
            throw null;
        }, onFault );
        expect( guarded( {}, 3 ) ).to.equal( TRANSFORM_THREW );
        expect( onFault.firstCall.args[ 0 ] ).to.equal( 'null' );
    } );

    it( 'contains a throwing onFault with one last-resort console line', function () {
        const errorSpy = sinon.spy( console, 'error' );
        const guarded = wrapTransform( () => {
            throw new Error( 'bad row' );
        }, () => {
            throw new Error( 'reporter broken' );
        } );
        expect( guarded( {}, 1 ) ).to.equal( TRANSFORM_THREW );
        errorSpy.restore();
        const lines = errorSpy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'CALLBACK_FAILED' ) );
        expect( lines.length ).to.equal( 1 );
    } );

    it( 'exposes a frozen sentinel', function () {
        expect( Object.isFrozen( TRANSFORM_THREW ) ).to.equal( true );
    } );

} );
