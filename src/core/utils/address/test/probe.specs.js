// core/utils/address/test/probe.specs.js

/**
 * @fileoverview Unit specs for the setup probe (ADR-030 item 4).
 *
 * The probe is a real TCP connection attempt per address, with a time
 * limit. An IP literal is probed once. A name is resolved with Node's
 * default lookup, every address in the resolver's order is probed one
 * at a time, and the probe passes only when every address answers.
 * That strict rule is the point: on the run-5 rig the first address
 * refused while the second answered, and the flow ran for 32 hours
 * before the name stopped working. The message names each address and
 * its result and, when one answered, the literal to set.
 *
 * The lookup and the connect are injectable, so every branch runs
 * against scripted sockets. Two cases use the real defaults against a
 * listener on 127.0.0.1, so the default wiring is exercised too.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { EventEmitter } from 'node:events';
import net from 'node:net';

import { classifyAddress } from '../index.js';
import { probeAddress, describeProbe, DEFAULT_PROBE_TIMEOUT_MS } from '../probe.js';

/**
 * A scripted socket. `script` is 'answers', 'hang', or
 * `{ error: <code or null> }`. The event fires on the next tick, as a
 * real socket would, and `setTimeout` is honoured only for 'hang'.
 */
const fakeSocket = function ( script, timeline, label ) {
    const socket = new EventEmitter();
    socket.destroy = sinon.stub().callsFake( () => timeline.push( `destroy ${label}` ) );
    socket.setTimeout = sinon.stub().callsFake( ( ms, onTimeout ) => {
        if ( script === 'hang' ) {
            setTimeout( onTimeout, ms );
        }
    } );
    setImmediate( () => {
        timeline.push( `settle ${label}` );
        if ( script === 'answers' ) {
            socket.emit( 'connect' );
            return;
        }
        if ( script === 'hang' ) {
            return;
        }
        const err = new Error( `scripted ${script.error}` );
        if ( script.error !== null ) {
            err.code = script.error;
        }
        socket.emit( 'error', err );
    } );
    return socket;
}; // fakeSocket()

/** Builds a connectFn that hands out scripted sockets by host. */
const scriptedConnect = function ( scriptsByHost, timeline = [] ) {
    const connectFn = sinon.stub().callsFake( ( { host, port } ) => {
        const label = `${host}:${port}`;
        timeline.push( `connect ${label}` );
        return fakeSocket( scriptsByHost[ host ], timeline, label );
    } );
    return { connectFn, timeline };
}; // scriptedConnect()

const lookupTo = function ( entries ) {
    return sinon.stub().resolves( entries );
};

const DUAL = [ { address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 } ];

describe( 'address probe — literals', function () {

    it( 'probes an IPv4 literal once, without a lookup, and passes when it answers', async function () {
        const { connectFn } = scriptedConnect( { '127.0.0.1': 'answers' } );
        const lookupFn = lookupTo( [] );
        const outcome = await probeAddress( classifyAddress( '127.0.0.1:9000', 'hostPort' ), { connectFn, lookupFn } );
        expect( outcome ).to.deep.equal( {
            ok: true,
            host: '127.0.0.1',
            port: 9000,
            attempts: [ { address: '127.0.0.1', family: 4, result: 'answers' } ]
        } );
        expect( lookupFn.called ).to.equal( false );
        expect( connectFn.calledOnce ).to.equal( true );
        expect( connectFn.firstCall.args[ 0 ] ).to.deep.equal( { host: '127.0.0.1', port: 9000 } );
    } );

    it( 'probes an IPv6 literal once on its bare host', async function () {
        const { connectFn } = scriptedConnect( { '::1': 'answers' } );
        const outcome = await probeAddress( classifyAddress( '[::1]:8812', 'hostPort' ), { connectFn, lookupFn: lookupTo( [] ) } );
        expect( outcome.ok ).to.equal( true );
        expect( outcome.attempts ).to.deep.equal( [ { address: '::1', family: 6, result: 'answers' } ] );
    } );

    it( 'fails a literal that refuses, and destroys the socket', async function () {
        const { connectFn, timeline } = scriptedConnect( { '127.0.0.1': { error: 'ECONNREFUSED' } } );
        const outcome = await probeAddress( classifyAddress( '127.0.0.1:9000', 'hostPort' ), { connectFn, lookupFn: lookupTo( [] ) } );
        expect( outcome.ok ).to.equal( false );
        expect( outcome.attempts[ 0 ].result ).to.equal( 'refused' );
        expect( timeline ).to.deep.equal( [ 'connect 127.0.0.1:9000', 'settle 127.0.0.1:9000', 'destroy 127.0.0.1:9000' ] );
    } );

} );

describe( 'address probe — names', function () {

    it( 'resolves with Node\'s default lookup, all addresses, no family or order forced', async function () {
        const lookupFn = lookupTo( DUAL );
        const { connectFn } = scriptedConnect( { '::1': 'answers', '127.0.0.1': 'answers' } );
        await probeAddress( classifyAddress( 'db.plant.local:9000', 'hostPort' ), { connectFn, lookupFn } );
        expect( lookupFn.calledOnce ).to.equal( true );
        expect( lookupFn.firstCall.args ).to.deep.equal( [ 'db.plant.local', { all: true } ] );
    } );

    it( 'probes every resolved address in resolver order, one at a time', async function () {
        const { connectFn, timeline } = scriptedConnect( { '::1': { error: 'ECONNREFUSED' }, '127.0.0.1': 'answers' } );
        await probeAddress( classifyAddress( 'db.plant.local:9000', 'hostPort' ), { connectFn, lookupFn: lookupTo( DUAL ) } );
        expect( timeline ).to.deep.equal( [
            'connect ::1:9000', 'settle ::1:9000', 'destroy ::1:9000',
            'connect 127.0.0.1:9000', 'settle 127.0.0.1:9000', 'destroy 127.0.0.1:9000'
        ] );
    } );

    it( 'fails when one resolved address refuses even though another answers (the rig\'s day 1)', async function () {
        const { connectFn } = scriptedConnect( { '::1': { error: 'ECONNREFUSED' }, '127.0.0.1': 'answers' } );
        const outcome = await probeAddress( classifyAddress( 'db.plant.local:9000', 'hostPort' ), { connectFn, lookupFn: lookupTo( DUAL ) } );
        expect( outcome.ok ).to.equal( false );
        expect( outcome.attempts ).to.deep.equal( [
            { address: '::1', family: 6, result: 'refused' },
            { address: '127.0.0.1', family: 4, result: 'answers' }
        ] );
    } );

    it( 'passes when every resolved address answers', async function () {
        const { connectFn } = scriptedConnect( { '::1': 'answers', '127.0.0.1': 'answers' } );
        const outcome = await probeAddress( classifyAddress( 'db.plant.local:9000', 'hostPort' ), { connectFn, lookupFn: lookupTo( DUAL ) } );
        expect( outcome.ok ).to.equal( true );
    } );

    it( 'fails without probing when the name does not resolve', async function () {
        const notFound = new Error( 'getaddrinfo ENOTFOUND db.plant.local' );
        notFound.code = 'ENOTFOUND';
        const { connectFn } = scriptedConnect( {} );
        const outcome = await probeAddress( classifyAddress( 'db.plant.local:9000', 'hostPort' ), { connectFn, lookupFn: sinon.stub().rejects( notFound ) } );
        expect( outcome ).to.deep.equal( { ok: false, host: 'db.plant.local', port: 9000, lookupError: 'ENOTFOUND', attempts: [] } );
        expect( connectFn.called ).to.equal( false );
    } );

    it( 'reports a lookup failure by its message when it carries no code', async function () {
        const { connectFn } = scriptedConnect( {} );
        const outcome = await probeAddress( classifyAddress( 'db.plant.local:9000', 'hostPort' ), { connectFn, lookupFn: sinon.stub().rejects( new Error( 'resolver down' ) ) } );
        expect( outcome.lookupError ).to.equal( 'resolver down' );
    } );

} );

describe( 'address probe — the lookup has the same time limit as a connect', function () {

    // A stalled resolver pool held the run-5 rig's flushes open for
    // minutes (the 2026-09-07 getaddrinfo finding). The probe must not
    // inherit that wait: a lookup that does not answer within the time
    // limit fails the probe as a timeout, and no connect is attempted.

    let clock;

    beforeEach( function () {
        clock = sinon.useFakeTimers( { now: 1735500000000 } );
    } );

    afterEach( function () {
        clock.restore();
    } );

    it( 'a lookup that never answers fails as timeout at the limit, with no connect attempted', async function () {
        const { connectFn } = scriptedConnect( {} );
        const lookupFn = sinon.stub().returns( new Promise( () => undefined ) );
        let outcome = null;
        probeAddress( classifyAddress( 'db.plant.local:9000', 'hostPort' ), { connectFn, lookupFn, timeoutMs: 2000 } )
            .then( ( result ) => {
                outcome = result;
            } );

        await clock.tickAsync( 1999 );
        expect( outcome ).to.equal( null );

        await clock.tickAsync( 1 );
        expect( outcome ).to.deep.equal( { ok: false, host: 'db.plant.local', port: 9000, lookupError: 'timeout', attempts: [] } );
        expect( connectFn.called ).to.equal( false );
    } );

    it( 'a lookup that answers in time clears its timer, so nothing is left to hold the process', async function () {
        const { connectFn } = scriptedConnect( { '127.0.0.1': 'answers' } );
        const lookupFn = lookupTo( [ { address: '127.0.0.1', family: 4 } ] );
        let outcome = null;
        probeAddress( classifyAddress( 'db.plant.local:9000', 'hostPort' ), { connectFn, lookupFn } )
            .then( ( result ) => {
                outcome = result;
            } );

        await clock.tickAsync( 10 );

        expect( outcome.ok ).to.equal( true );
        expect( clock.countTimers() ).to.equal( 0 );
    } );

    it( 'a lookup that fails in time clears its timer too', async function () {
        const notFound = new Error( 'nope' );
        notFound.code = 'ENOTFOUND';
        const { connectFn } = scriptedConnect( {} );
        let outcome = null;
        probeAddress( classifyAddress( 'db.plant.local:9000', 'hostPort' ), { connectFn, lookupFn: sinon.stub().rejects( notFound ) } )
            .then( ( result ) => {
                outcome = result;
            } );

        await clock.tickAsync( 10 );

        expect( outcome.lookupError ).to.equal( 'ENOTFOUND' );
        expect( clock.countTimers() ).to.equal( 0 );
    } );

} );

describe( 'address probe — socket outcomes', function () {

    it( 'reports a socket that never answers as timeout, within the time limit, and destroys it', async function () {
        const { connectFn, timeline } = scriptedConnect( { '127.0.0.1': 'hang' } );
        const outcome = await probeAddress( classifyAddress( '127.0.0.1:9000', 'hostPort' ), { connectFn, lookupFn: lookupTo( [] ), timeoutMs: 5 } );
        expect( outcome.attempts[ 0 ].result ).to.equal( 'timeout' );
        expect( timeline[ timeline.length - 1 ] ).to.equal( 'destroy 127.0.0.1:9000' );
    } );

    it( 'maps ETIMEDOUT to timeout and keeps any other Node code as is', async function () {
        const timedOut = scriptedConnect( { '127.0.0.1': { error: 'ETIMEDOUT' } } );
        const noRoute = scriptedConnect( { '127.0.0.1': { error: 'EHOSTUNREACH' } } );
        const a = await probeAddress( classifyAddress( '127.0.0.1:9000', 'hostPort' ), { connectFn: timedOut.connectFn, lookupFn: lookupTo( [] ) } );
        const b = await probeAddress( classifyAddress( '127.0.0.1:9000', 'hostPort' ), { connectFn: noRoute.connectFn, lookupFn: lookupTo( [] ) } );
        expect( a.attempts[ 0 ].result ).to.equal( 'timeout' );
        expect( b.attempts[ 0 ].result ).to.equal( 'EHOSTUNREACH' );
    } );

    it( 'reports an error without a code as error', async function () {
        const { connectFn } = scriptedConnect( { '127.0.0.1': { error: null } } );
        const outcome = await probeAddress( classifyAddress( '127.0.0.1:9000', 'hostPort' ), { connectFn, lookupFn: lookupTo( [] ) } );
        expect( outcome.attempts[ 0 ].result ).to.equal( 'error' );
    } );

    it( 'settles once: a late error after connect changes nothing and destroys nothing twice', async function () {
        const timeline = [];
        let socket;
        const connectFn = sinon.stub().callsFake( () => {
            socket = fakeSocket( 'answers', timeline, 'x' );
            return socket;
        } );
        const outcome = await probeAddress( classifyAddress( '127.0.0.1:9000', 'hostPort' ), { connectFn, lookupFn: lookupTo( [] ) } );
        const late = new Error( 'late' );
        late.code = 'ECONNRESET';
        socket.emit( 'error', late );
        expect( outcome.attempts[ 0 ].result ).to.equal( 'answers' );
        expect( socket.destroy.calledOnce ).to.equal( true );
    } );

    it( 'defaults to a two-second limit per address', function () {
        expect( DEFAULT_PROBE_TIMEOUT_MS ).to.equal( 2000 );
    } );

    it( 'uses the real connect by default: a listener on 127.0.0.1 answers, a closed port refuses', async function () {
        const server = net.createServer();
        await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
        const { port } = server.address();
        const live = await probeAddress( classifyAddress( `127.0.0.1:${port}`, 'hostPort' ) );
        await new Promise( ( resolve ) => server.close( resolve ) );
        const dead = await probeAddress( classifyAddress( `127.0.0.1:${port}`, 'hostPort' ) );
        expect( live.ok ).to.equal( true );
        expect( dead.ok ).to.equal( false );
        expect( dead.attempts[ 0 ].result ).to.equal( 'refused' );
    } );

} );

describe( 'address probe — describeProbe', function () {

    it( 'names each address and its result and the literal to set, bracketing IPv6', async function () {
        const { connectFn } = scriptedConnect( { '::1': { error: 'ECONNREFUSED' }, '127.0.0.1': 'answers' } );
        const address = classifyAddress( 'db.plant.local:9000', 'hostPort' );
        const outcome = await probeAddress( address, { connectFn, lookupFn: lookupTo( DUAL ) } );
        expect( describeProbe( outcome, 'ilpUrl', address ) ).to.equal(
            '[::1]:9000 refused, 127.0.0.1:9000 answers; set ilpUrl to 127.0.0.1:9000'
        );
    } );

    it( 'suggests the answering address even when it is IPv6', async function () {
        const { connectFn } = scriptedConnect( { '::1': 'answers', '127.0.0.1': { error: 'ECONNREFUSED' } } );
        const address = classifyAddress( 'db.plant.local:8812', 'hostPort' );
        const outcome = await probeAddress( address, { connectFn, lookupFn: lookupTo( DUAL ) } );
        expect( describeProbe( outcome, 'pgUrl', address ) ).to.equal(
            '[::1]:8812 answers, 127.0.0.1:8812 refused; set pgUrl to [::1]:8812'
        );
    } );

    it( 'lists the results with no suggestion when nothing answered', async function () {
        const { connectFn } = scriptedConnect( { '::1': { error: 'ECONNREFUSED' }, '127.0.0.1': 'hang' } );
        const address = classifyAddress( 'db.plant.local:9000', 'hostPort' );
        const outcome = await probeAddress( address, { connectFn, lookupFn: lookupTo( DUAL ), timeoutMs: 5 } );
        expect( describeProbe( outcome, 'ilpUrl', address ) ).to.equal( '[::1]:9000 refused, 127.0.0.1:9000 timeout' );
    } );

    it( 'lists the results with no suggestion when the probe passed', async function () {
        const { connectFn } = scriptedConnect( { '127.0.0.1': 'answers' } );
        const address = classifyAddress( '127.0.0.1:9000', 'hostPort' );
        const outcome = await probeAddress( address, { connectFn, lookupFn: lookupTo( [] ) } );
        expect( describeProbe( outcome, 'ilpUrl', address ) ).to.equal( '127.0.0.1:9000 answers' );
    } );

    it( 'describes a name that did not resolve', async function () {
        const notFound = new Error( 'nope' );
        notFound.code = 'ENOTFOUND';
        const address = classifyAddress( 'db.plant.local:9000', 'hostPort' );
        const outcome = await probeAddress( address, { connectFn: scriptedConnect( {} ).connectFn, lookupFn: sinon.stub().rejects( notFound ) } );
        expect( describeProbe( outcome, 'ilpUrl', address ) ).to.equal( '\'db.plant.local\' did not resolve (ENOTFOUND)' );
    } );

} );
