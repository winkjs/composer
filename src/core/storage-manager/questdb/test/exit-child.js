// core/storage-manager/questdb/test/exit-child.js

/**
 * @fileoverview The child process of `slow-questdb-exit.specs.js`. It
 * proves, or disproves, that a process can exit on its own after the
 * QuestDB adapter shuts down. It never calls `process.exit`. Whether
 * the process ends once its work is done is what the parent measures.
 *
 * The child is only the application. The parent owns the network: the
 * TCP proxy the adapter is built through, and whatever replaces it. So
 * a dead endpoint stays dead after the child has returned, the way a
 * wedged or stopped server would.
 *
 * Two scenarios. `clean` is the production shape: the adapter runs
 * straight at QuestDB, sends one flush, and shuts down clean. `outage`
 * builds the adapter through the parent's proxy, sends one flush
 * through it, and prints a ready line. The parent then takes the proxy
 * away, in the shape its leg needs, and writes `go` on the child's
 * stdin. The child writes rows, lets the flush timer start a send into
 * the outage, and with that send in flight calls `shutdown()` with a
 * short budget.
 *
 * Either way the child then prints one marker line and returns. With
 * the standard-library transport the adapter destroys its agent at the
 * end of the drain, which ends a request still on the socket, and the
 * process exits (ADR-029). With undici and a refused connection, the
 * client's retry loop keeps the process alive.
 *
 * Arguments, in order: the transport (`stdlib` or `undici`), the
 * scenario (`clean` or `outage`), the ILP port to build against, and
 * the PostgreSQL address.
 */

import { createQuestDBStorage } from '../index.js';

const [ transport, scenario, ilpPortArg, pgUrl ] = process.argv.slice( 2 );
const ILP_PORT = parseInt( ilpPortArg, 10 );

/** Rows written into the outage; the count the marker reports in flight. */
const ROWS_INTO_THE_OUTAGE = 10;

/** Long enough for one flush timer tick at the interval below. */
const FLUSH_INTERVAL_MS = 200;
const WAIT_FOR_THE_TICK_MS = 300;

/** The drain budget for the outage, shorter than the request timeout on purpose. */
const OUTAGE_SHUTDOWN_BUDGET_MS = 300;

/** The drain budget for the clean scenario, generous. */
const CLEAN_SHUTDOWN_BUDGET_MS = 5000;

const ASSET_CLASS = {
    name: 'exitchild',
    columns: {
        ts: { type: 'timestamp' },
        temp: { type: 'float64' }
    },
    insightTypes: {
        monitoring: {
            columns: [ 'ts', 'temp' ],
            designatedTimestamp: 'ts'
        }
    }
};

const sleep = function ( ms ) {
    return new Promise( function ( resolve ) {
        setTimeout( resolve, ms );
    } );
}; // sleep()

/**
 * Prints one line the parent parses.
 *
 * @param {string} marker - `EXIT_CHILD_READY` or `EXIT_CHILD`
 * @param {Object} fields - What the line carries
 */
const print = function ( marker, fields ) {
    console.log( JSON.stringify( { marker, transport, scenario, ...fields, at: Date.now() } ) );
}; // print()

/**
 * Resolves when the parent writes `go`. The stdin stream is destroyed
 * afterwards, so it cannot hold the process open once the work is done.
 *
 * @returns {Promise<void>}
 */
const waitForGo = function () {
    return new Promise( function ( resolve ) {
        process.stdin.once( 'data', function () {
            process.stdin.destroy();
            resolve();
        } );
    } );
}; // waitForGo()

/**
 * Builds the adapter at the ILP port with the transport under test.
 *
 * @returns {Promise<Object>} The storage handle
 */
const buildStorage = function () {
    return createQuestDBStorage( ASSET_CLASS, `exit_${transport}_${scenario}_${Date.now()}`, {
        ilpUrl: `127.0.0.1:${ILP_PORT}`,
        pgUrl,
        stdlibHttp: transport === 'stdlib',
        flushRows: 1000,
        flushIntervalMs: FLUSH_INTERVAL_MS,
        requestTimeout: 2000,
        retryTimeout: 500
    } );
}; // buildStorage()

/**
 * Shuts the adapter down and reports how it ended.
 *
 * @param {Object} storage - The storage handle
 * @param {number} budgetMs - The drain budget
 * @returns {Promise<{outcome: string, shutdownMs: number}>} The classified outcome and its duration
 */
const shutDown = async function ( storage, budgetMs ) {
    const started = Date.now();
    let outcome = 'clean';
    try {
        await storage.shutdown( { timeout: budgetMs } );
    } catch ( err ) {
        outcome = err.code;
    }
    return { outcome, shutdownMs: Date.now() - started };
}; // shutDown()

/**
 * The production shape: straight at QuestDB, one flush, a clean shutdown.
 *
 * @returns {Promise<Object>} The marker fields
 */
const runClean = async function () {
    const storage = await buildStorage();
    storage.write( 'monitoring', { ts: Date.now(), temp: 1 }, 'p1' );
    await storage.flush();
    const ended = await shutDown( storage, CLEAN_SHUTDOWN_BUDGET_MS );
    return { inFlightRows: 0, ...ended };
}; // runClean()

/**
 * A send into the parent's outage when shutdown runs.
 *
 * @returns {Promise<Object>} The marker fields
 */
const runOutage = async function () {
    const storage = await buildStorage();

    // One send through the proxy proves the path before the outage.
    storage.write( 'monitoring', { ts: Date.now(), temp: 1 }, 'p1' );
    await storage.flush();
    print( 'EXIT_CHILD_READY', {} );
    await waitForGo();

    for ( let i = 0; i < ROWS_INTO_THE_OUTAGE; i += 1 ) {
        storage.write( 'monitoring', { ts: Date.now(), temp: i }, 'p1' );
    }
    await sleep( WAIT_FOR_THE_TICK_MS );
    const inFlightRows = storage.getHealth().inFlightRows;

    const ended = await shutDown( storage, OUTAGE_SHUTDOWN_BUDGET_MS );
    return { inFlightRows, ...ended };
}; // runOutage()

const main = async function () {
    const fields = ( scenario === 'clean' ) ? await runClean() : await runOutage();
    print( 'EXIT_CHILD', fields );
}; // main()

main().catch( function ( err ) {
    print( 'EXIT_CHILD', { error: err.message } );
} );
