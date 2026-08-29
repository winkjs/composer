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

import { wrapCallback, wrapTransform, TRANSFORM_THREW } from '../index.js';

const settle = function () {
    return new Promise( ( resolve ) => setImmediate( resolve ) );
};

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
