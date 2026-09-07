// core/storage-manager/questdb/test/slow-questdb-exit.specs.js

/**
 * @fileoverview Live proof that a process exits on its own after the
 * QuestDB adapter shuts down, with a flush still on the wire, and that
 * one outage shape keeps a process alive on the client's undici
 * transport (ADR-029). Hardening tier: needs a live QuestDB.
 *
 * Why a child process. Whether a process ends is a fact about the whole
 * process, and a test cannot watch its own exit. So each leg spawns
 * `exit-child.js`. The child builds the adapter, prints one marker line
 * once its shutdown call has returned, and then does nothing more. It
 * never calls `process.exit`. The parent times the gap from the marker
 * to the child's exit.
 *
 * The network belongs to this spec, not to the child. The child is
 * built through a TCP proxy this spec runs. Once the child reports
 * ready, the spec takes the proxy away in one of two shapes and tells
 * the child to go. A black hole is a server that accepts the
 * connection and never answers, a wedged server. A refused port is a
 * stopped server. Both shapes stay as they are until the leg ends. An
 * earlier draft had the child close its own hole before returning.
 * Undici then saw "other side closed", settled, and exited, and the
 * leg proved nothing.
 *
 * Six legs, three per transport. The clean legs run straight at
 * QuestDB, the production shape. The outage legs have a send on the
 * wire, or just failed, when shutdown runs with a short budget.
 *
 * - Standard library, black hole: shutdown times out, the drain
 *   destroys the agent, that ends the request, and the process exits.
 *   This is the exit guarantee the transport default buys.
 * - Standard library, refused port: the send fails at once, its rows
 *   are reported lost, and shutdown finds nothing left to drain. The
 *   marker says `clean`, or `DELIVERY_FAILED` when the flush timer had
 *   not yet run at shutdown. Either way the process exits.
 * - Undici, black hole: shutdown times out. The client's abort fires
 *   at `retryTimeout` while an attempt is waiting for headers, that
 *   attempt fails, and the process exits.
 * - Undici, refused port: shutdown times out and the process never
 *   exits. The refused connect is retried without end, and the abort
 *   lands during the retry backoff, where undici issue #4244 leaves it
 *   unwired. This spec kills the child. The leg pins the hazard the
 *   handbook names.
 *
 * The exit bound is 2 seconds from the marker. Measured on the M4 on
 * 2026-09-06: 2 to 8 ms on every exiting leg. The bound leaves room for
 * a loaded CM5 and stays far below the refused shape, which never ends.
 */

import { expect } from 'chai';
import { describe, it, afterEach } from 'mocha';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { startProxy, stopProxy, startBlackHole } from '../../../test-utils/tcp-proxy.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const QUESTDB_PG_URL    = process.env.QUESTDB_PG_URL  || '127.0.0.1:8812'; // eslint-disable-line no-process-env
const QUESTDB_REAL_PORT = parseInt(
    ( process.env.QUESTDB_ILP_URL || '127.0.0.1:9000' ).split( ':' )[ 1 ], // eslint-disable-line no-process-env
    10
);
const PROXY_PORT        = 19004;

/** The child must exit within this long of its marker. */
const EXIT_BOUND_MS = 2000;

/** How long the undici child is given to prove it does not exit. */
const ALIVE_CHECK_MS = 5000;

/** The child must print each expected line within this long, or the leg fails. */
const LINE_BUDGET_MS = 20000;

const CHILD_SCRIPT = path.join( path.dirname( fileURLToPath( import.meta.url ) ), 'exit-child.js' );

// ============================================================================
// HELPERS
// ============================================================================

const sleep = function ( ms ) {
    return new Promise( function ( resolve ) {
        setTimeout( resolve, ms );
    } );
}; // sleep()

/**
 * Spawns the child for one leg. Returns the handle, a promise per
 * marker line, and a promise for the exit. A line that does not arrive
 * within the budget kills the child and rejects its promise.
 *
 * @param {string} transport - `'stdlib'` or `'undici'`
 * @param {string} scenario - `'clean'` or `'outage'`
 * @param {number} ilpPort - The port the child builds against
 * @returns {{child: Object, lineOf: function, exited: Promise<{code: number|null, signal: string|null, at: number}>}}
 */
const spawnChild = function ( transport, scenario, ilpPort ) {
    const child = spawn( process.execPath, [
        CHILD_SCRIPT, transport, scenario, String( ilpPort ), QUESTDB_PG_URL
    ], { stdio: [ 'pipe', 'pipe', 'pipe' ] } );

    const seen = [];
    const waiters = [];
    let stdout = '';
    let stderr = '';

    const wake = function () {
        waiters.splice( 0 ).forEach( function ( notify ) {
            notify();
        } );
    }; // wake()

    child.stderr.on( 'data', function ( chunk ) {
        stderr += chunk.toString();
    } );
    child.stdout.on( 'data', function ( chunk ) {
        stdout += chunk.toString();
        const lines = stdout.split( '\n' );
        stdout = lines.pop();
        for ( const line of lines ) {
            if ( line.includes( '"marker"' ) ) {
                seen.push( { parsed: JSON.parse( line ), at: Date.now() } );
            }
        }
        wake();
    } );

    const exited = new Promise( function ( resolve ) {
        child.on( 'exit', function ( code, signal ) {
            resolve( { code, signal, at: Date.now() } );
            wake();
        } );
    } );

    /**
     * Resolves with the named marker line and the time it arrived.
     *
     * @param {string} marker - The marker to wait for
     * @returns {Promise<{parsed: Object, at: number}>}
     */
    const lineOf = function ( marker ) {
        return new Promise( function ( resolve, reject ) {
            const budget = setTimeout( function () {
                child.kill( 'SIGKILL' );
                reject( new Error( `no ${marker} from the ${transport} ${scenario} child within ${LINE_BUDGET_MS} ms; stderr: ${stderr}` ) );
            }, LINE_BUDGET_MS );
            const check = function () {
                const found = seen.find( function ( entry ) {
                    return entry.parsed.marker === marker;
                } );
                if ( found !== undefined ) {
                    clearTimeout( budget );
                    if ( found.parsed.error !== undefined ) {
                        child.kill( 'SIGKILL' );
                        reject( new Error( `the ${transport} ${scenario} child failed: ${found.parsed.error}` ) );
                        return;
                    }
                    resolve( found );
                    return;
                }
                if ( child.exitCode !== null ) {
                    clearTimeout( budget );
                    reject( new Error( `the ${transport} ${scenario} child exited (${child.exitCode}) before ${marker}; stderr: ${stderr}` ) );
                    return;
                }
                waiters.push( check );
            };
            check();
        } );
    }; // lineOf()

    return { child, lineOf, exited };
}; // spawnChild()

/**
 * Runs the outage scenario up to the marker. The child is built
 * through the proxy. Then the proxy goes away in the given shape, and
 * the child goes. The caller stops a black hole when its leg ends.
 *
 * @param {string} transport - The transport under test
 * @param {string} shape - `'hole'` for a server that never answers, `'refused'` for a closed port
 * @returns {Promise<{run: Object, marker: Object, hole: Object|null}>}
 */
const runIntoOutage = async function ( transport, shape ) {
    const proxy = await startProxy( PROXY_PORT, QUESTDB_REAL_PORT );
    const run = spawnChild( transport, 'outage', PROXY_PORT );
    await run.lineOf( 'EXIT_CHILD_READY' );

    await stopProxy( proxy );
    const hole = ( shape === 'hole' ) ? await startBlackHole( PROXY_PORT ) : null;
    run.child.stdin.write( 'go\n' );

    const marker = await run.lineOf( 'EXIT_CHILD' );
    return { run, marker, hole };
}; // runIntoOutage()

/**
 * Asserts the child exited on its own, code 0, within the bound.
 *
 * @param {Object} run - The spawned child
 * @param {{parsed: Object, at: number}} marker - The child's marker line
 * @param {string} label - The leg, for the printed line
 */
const expectExit = async function ( run, marker, label ) {
    const exit = await run.exited;
    expect( exit.code, 'exit code' ).to.equal( 0 );
    expect( exit.at - marker.at, 'ms from marker to exit' ).to.be.at.most( EXIT_BOUND_MS );
    console.log( `      ${label}: ${marker.parsed.outcome} in ${marker.parsed.shutdownMs} ms, exit ${exit.at - marker.at} ms after the marker` );
}; // expectExit()

// ============================================================================
// TESTS
// ============================================================================

describe( 'QuestDB adapter — the process exits after shutdown (ADR-029)', function () {

    // The undici refused leg waits ALIVE_CHECK_MS for a child that never
    // exits, longer than mocha's default of two seconds.
    this.timeout( 60000 ); // eslint-disable-line no-invalid-this

    let hole = null;

    afterEach( async function () {
        if ( hole !== null ) {
            await stopProxy( hole );
            hole = null;
        }
    } );

    describe( 'standard-library transport, the default', function () {

        it( 'clean shutdown straight at QuestDB: the process exits on its own', async function () {
            const run = spawnChild( 'stdlib', 'clean', QUESTDB_REAL_PORT );
            const marker = await run.lineOf( 'EXIT_CHILD' );

            expect( marker.parsed.outcome ).to.equal( 'clean' );
            await expectExit( run, marker, 'stdlib clean' );
        } );

        it( 'a send into a black hole: shutdown times out, the process still exits', async function () {
            const leg = await runIntoOutage( 'stdlib', 'hole' );
            hole = leg.hole;

            expect( leg.marker.parsed.outcome ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( leg.marker.parsed.inFlightRows ).to.be.greaterThan( 0 );
            await expectExit( leg.run, leg.marker, 'stdlib black hole' );
        } );

        it( 'a send to a refused port: it fails at once, and the process exits', async function () {
            const leg = await runIntoOutage( 'stdlib', 'refused' );

            expect( [ 'clean', 'DELIVERY_FAILED' ] ).to.include( leg.marker.parsed.outcome );
            expect( leg.marker.parsed.inFlightRows ).to.equal( 0 );
            await expectExit( leg.run, leg.marker, 'stdlib refused' );
        } );

    } );

    describe( 'undici transport, opted in with stdlibHttp: false', function () {

        it( 'clean shutdown straight at QuestDB: the process exits on its own', async function () {
            const run = spawnChild( 'undici', 'clean', QUESTDB_REAL_PORT );
            const marker = await run.lineOf( 'EXIT_CHILD' );

            expect( marker.parsed.outcome ).to.equal( 'clean' );
            await expectExit( run, marker, 'undici clean' );
        } );

        it( 'a send into a black hole: the abort ends the attempt, the process exits', async function () {
            const leg = await runIntoOutage( 'undici', 'hole' );
            hole = leg.hole;

            expect( leg.marker.parsed.outcome ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( leg.marker.parsed.inFlightRows ).to.be.greaterThan( 0 );
            await expectExit( leg.run, leg.marker, 'undici black hole' );
        } );

        it( 'a send to a refused port: shutdown times out and the process never exits', async function () {
            const leg = await runIntoOutage( 'undici', 'refused' );

            expect( leg.marker.parsed.outcome ).to.equal( 'SHUTDOWN_TIMEOUT' );
            expect( leg.marker.parsed.inFlightRows ).to.be.greaterThan( 0 );

            await sleep( ALIVE_CHECK_MS );
            expect( leg.run.child.exitCode, `alive ${ALIVE_CHECK_MS} ms after the marker` ).to.equal( null );

            leg.run.child.kill( 'SIGKILL' );
            const exit = await leg.run.exited;
            expect( exit.signal ).to.equal( 'SIGKILL' );
            console.log( `      undici refused: still alive ${ALIVE_CHECK_MS} ms after the marker, killed` );
        } );

    } );

} );
