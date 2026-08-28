// flow/test/driver.specs.js

/**
 * @fileoverview Tests for the headless-flow driver (flow/driver.js).
 *
 * Unit tests drive a stub handle so every branch — sync success, sync fault,
 * yield success, yield fault, sync vs async source, and the input guards — is
 * exercised deterministically. One integration test drives a real headless flow
 * end to end and confirms the package export.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { flow, headlessDriver } from '../../composer.js';

// A handle whose processMessage always succeeds synchronously (the hot path).
const okHandle = function () {
    return {
        processMessage: function () {
            return undefined;
        }
    };
};

// A handle that maps msg.kind to a behavior, so one source can exercise every
// per-message path: synchronous success and fault, yield success and fault.
const scriptedHandle = function () {
    return {
        processMessage: function ( msg ) {
            if ( msg.kind === 'syncFault' ) {
                throw new Error( `syncFault:${msg.id}` );
            }
            if ( msg.kind === 'yieldOk' ) {
                return Promise.resolve();
            }
            if ( msg.kind === 'yieldFault' ) {
                return Promise.reject( new Error( `yieldFault:${msg.id}` ) );
            }
            return undefined;
        }
    };
};

describe( 'headlessDriver — construction', function () {

    it( 'throws when handle is null', function () {
        expect( function () {
            headlessDriver( null );
        } ).to.throw( TypeError );
    } );

    it( 'throws when handle has no processMessage', function () {
        expect( function () {
            headlessDriver( {} );
        } ).to.throw( TypeError );
    } );

    it( 'throws when onError is given but is not a function', function () {
        expect( function () {
            headlessDriver( okHandle(), { onError: 123 } );
        } ).to.throw( TypeError );
    } );

    it( 'returns feedOne and feedAll functions', function () {
        const driver = headlessDriver( okHandle() );
        expect( typeof driver.feedOne ).to.equal( 'function' );
        expect( typeof driver.feedAll ).to.equal( 'function' );
    } );

} );

describe( 'headlessDriver.feedOne', function () {

    it( 'returns undefined on synchronous success', function () {
        const driver = headlessDriver( okHandle() );
        expect( driver.feedOne( { id: 1 } ) ).to.equal( undefined );
    } );

    it( 'routes a synchronous fault to onError and does not throw', function () {
        const boom = new Error( 'sync boom' );
        const onError = sinon.spy();
        const handle = {
            processMessage: function () {
                throw boom;
            }
        };
        const driver = headlessDriver( handle, { onError } );
        const msg = { id: 2 };
        expect( driver.feedOne( msg ) ).to.equal( undefined );
        expect( onError.calledOnceWithExactly( boom, msg ) ).to.equal( true );
    } );

    it( 'returns a Promise on the yield tick and does not call onError on success', async function () {
        const onError = sinon.spy();
        const handle = {
            processMessage: function () {
                return Promise.resolve();
            }
        };
        const driver = headlessDriver( handle, { onError } );
        const ret = driver.feedOne( { id: 3 } );
        expect( ret ).to.be.instanceOf( Promise );
        await ret;
        expect( onError.called ).to.equal( false );
    } );

    it( 'routes a yield-path fault to onError; the returned Promise does not reject', async function () {
        const boom = new Error( 'yield boom' );
        const onError = sinon.spy();
        const handle = {
            processMessage: function () {
                return Promise.reject( boom );
            }
        };
        const driver = headlessDriver( handle, { onError } );
        const msg = { id: 4 };
        const ret = driver.feedOne( msg );
        await ret; // must resolve, not reject
        expect( onError.calledOnceWithExactly( boom, msg ) ).to.equal( true );
    } );

    it( 'uses the default logger when no onError is given', function () {
        const boom = new Error( 'default-logged' );
        const handle = {
            processMessage: function () {
                throw boom;
            }
        };
        const stub = sinon.stub( console, 'error' );
        try {
            headlessDriver( handle ).feedOne( { id: 5 } );
            expect( stub.calledOnce ).to.equal( true );
        } finally {
            stub.restore();
        }
    } );

} );

describe( 'headlessDriver.feedAll', function () {

    it( 'throws when source is null', async function () {
        const driver = headlessDriver( okHandle() );
        let err = null;
        try {
            await driver.feedAll( null );
        } catch ( e ) {
            err = e;
        }
        expect( err ).to.be.instanceOf( TypeError );
    } );

    it( 'throws when source is not iterable', async function () {
        const driver = headlessDriver( okHandle() );
        let err = null;
        try {
            await driver.feedAll( 123 );
        } catch ( e ) {
            err = e;
        }
        expect( err ).to.be.instanceOf( TypeError );
    } );

    it( 'returns zero counts for an empty source', async function () {
        const driver = headlessDriver( okHandle() );
        const result = await driver.feedAll( [] );
        expect( result ).to.deep.equal( { processed: 0, failed: 0 } );
    } );

    it( 'processes a sync array, counting successes and faults across every path', async function () {
        const onError = sinon.spy();
        const driver = headlessDriver( scriptedHandle(), { onError } );
        const result = await driver.feedAll( [
            { id: 1, kind: 'ok' },
            { id: 2, kind: 'syncFault' },
            { id: 3, kind: 'yieldOk' },
            { id: 4, kind: 'yieldFault' }
        ] );
        expect( result ).to.deep.equal( { processed: 2, failed: 2 } );
        expect( onError.callCount ).to.equal( 2 );
    } );

    it( 'processes an async iterable, counting successes and faults across every path', async function () {
        const onError = sinon.spy();
        const gen = async function *() {
            yield { id: 1, kind: 'ok' };
            yield { id: 2, kind: 'yieldOk' };
            yield { id: 3, kind: 'syncFault' };
            yield { id: 4, kind: 'yieldFault' };
        };
        const driver = headlessDriver( scriptedHandle(), { onError } );
        const result = await driver.feedAll( gen() );
        expect( result ).to.deep.equal( { processed: 2, failed: 2 } );
        expect( onError.callCount ).to.equal( 2 );
    } );

    it( 'feeds sequentially — never more than one message in flight, order preserved', async function () {
        let active = 0;
        let maxActive = 0;
        const order = [];
        const handle = {
            processMessage: function ( msg ) {
                active += 1;
                maxActive = Math.max( maxActive, active );
                return Promise.resolve().then( function () {
                    order.push( msg.id );
                    active -= 1;
                } );
            }
        };
        const driver = headlessDriver( handle );
        await driver.feedAll( [ { id: 1 }, { id: 2 }, { id: 3 } ] );
        expect( maxActive ).to.equal( 1 );
        expect( order ).to.deep.equal( [ 1, 2, 3 ] );
    } );

} );

describe( 'headlessDriver — integration with a real flow', function () {

    let handle = null;

    afterEach( async function () {
        if ( handle && handle.shutdown ) {
            await handle.shutdown();
            handle = null;
        }
    } );

    it( 'drives a real headless flow end to end', async function () {
        handle = await flow( 'driverIntegration' )
            .assetId( 'id' )
            .esMean( 'm', 'value', { mean: 'avg' }, { halfLife: 5 } )
            .run();

        const driver = headlessDriver( handle );
        const msgs = [
            { id: 'a', value: 10 },
            { id: 'a', value: 10 },
            { id: 'b', value: 50 }
        ];
        const result = await driver.feedAll( msgs );

        expect( result ).to.deep.equal( { processed: 3, failed: 0 } );
        // EWMA seeds at the first value: a constant-10 stream stays 10.
        expect( msgs[ 0 ].avg ).to.equal( 10 );
        expect( Number.isFinite( msgs[ 2 ].avg ) ).to.equal( true );
    } );

} );

describe( 'headlessDriver — a broken onError is contained (ADR-018: the fault reporter must not become the fault)', function () {

    // The driver promises: a fault never interrupts the feed. Before
    // the callback guard, the promise held for NODE faults but not
    // for a fault inside the user's own onError — a throwing handler
    // aborted feedAll mid-stream, and a rejecting one became an
    // unhandled rejection.

    const settle = function () {
        return new Promise( ( resolve ) => setImmediate( resolve ) );
    };

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

    const throwingOnError = function () {
        throw new Error( 'handler down' );
    };

    const guardLines = function ( spy ) {
        return spy.getCalls()
            .map( ( c ) => String( c.args[ 0 ] ) )
            .filter( ( l ) => l.includes( 'CALLBACK_FAILED' ) && l.includes( 'onError' ) );
    };

    it( 'feedOne sync-fault path: still returns undefined, one classified line', function () {
        const driver = headlessDriver( scriptedHandle(), { onError: throwingOnError } );
        const spy = sinon.spy( console, 'error' );
        const out = driver.feedOne( { kind: 'syncFault', id: 1 } );
        spy.restore();
        expect( out ).to.equal( undefined );
        expect( guardLines( spy ).length ).to.equal( 1 );
        expect( guardLines( spy )[ 0 ] ).to.include( 'handler down' );
    } );

    it( 'feedOne yield-fault path: the returned Promise still never rejects', async function () {
        const driver = headlessDriver( scriptedHandle(), { onError: throwingOnError } );
        const spy = sinon.spy( console, 'error' );
        await driver.feedOne( { kind: 'yieldFault', id: 2 } );
        spy.restore();
        expect( guardLines( spy ).length ).to.equal( 1 );
        expect( unhandled.length ).to.equal( 0 );
    } );

    it( 'feedAll over a sync source: the loop reaches the end with truthful counters', async function () {
        const driver = headlessDriver( scriptedHandle(), { onError: throwingOnError } );
        const spy = sinon.spy( console, 'error' );
        const result = await driver.feedAll( [
            { kind: 'ok', id: 1 },
            { kind: 'syncFault', id: 2 },
            { kind: 'ok', id: 3 }
        ] );
        spy.restore();
        expect( result ).to.deep.equal( { processed: 2, failed: 1 } );
        expect( guardLines( spy ).length ).to.equal( 1 );
    } );

    it( 'feedAll over an async source: same containment', async function () {
        const driver = headlessDriver( scriptedHandle(), { onError: throwingOnError } );
        const source = ( async function *() {
            yield { kind: 'ok', id: 1 };
            yield { kind: 'syncFault', id: 2 };
            yield { kind: 'ok', id: 3 };
        }() );
        const spy = sinon.spy( console, 'error' );
        const result = await driver.feedAll( source );
        spy.restore();
        expect( result ).to.deep.equal( { processed: 2, failed: 1 } );
        expect( guardLines( spy ).length ).to.equal( 1 );
    } );

    it( 'an async onError that rejects never becomes an unhandled rejection', async function () {
        const driver = headlessDriver( scriptedHandle(), {
            onError: () => Promise.reject( new Error( 'late handler down' ) )
        } );
        const spy = sinon.spy( console, 'error' );
        const result = await driver.feedAll( [
            { kind: 'syncFault', id: 1 },
            { kind: 'ok', id: 2 }
        ] );
        await settle();
        await settle();
        spy.restore();
        expect( result ).to.deep.equal( { processed: 1, failed: 1 } );
        expect( guardLines( spy ).length ).to.equal( 1 );
        expect( unhandled.length ).to.equal( 0 );
    } );

} );
