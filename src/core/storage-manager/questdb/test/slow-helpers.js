// core/storage-manager/questdb/test/slow-helpers.js

/**
 * @fileoverview Shared helpers for the QuestDB hardening specs that
 * drive a live flow through the TCP proxy: QuestDB availability and
 * row counts over the PostgreSQL wire, a harness asset class and
 * message template, health polling, console capture, and memory
 * sampling with medians. Every helper here is a copy of what the
 * older hardening specs carry inline; the new specs import it.
 *
 * Memory sampling calls `global.gc()` when the runner exposes it (the
 * hardening script passes `--expose-gc`), so heap readings are
 * comparable between samples. Each sample records whether it ran.
 */

/* eslint-disable no-process-env, no-await-in-loop */

import pg from 'pg';

export const QUESTDB_PG_URL    = process.env.QUESTDB_PG_URL  || '127.0.0.1:8812';
export const QUESTDB_REAL_PORT = parseInt(
    ( process.env.QUESTDB_ILP_URL || '127.0.0.1:9000' ).split( ':' )[ 1 ],
    10
);

/** The harness asset class every live leg persists: id, partition, time, value. */
export const buildAssetClass = function ( name ) {
    return {
        name,
        columns: {
            _harnessId: { type: 'int64' },
            partitionId: { type: 'string' },
            ts: { type: 'timestamp' },
            value: { type: 'float64', resolution: 0.01 }
        },
        insightTypes: {
            samples: {
                columns: [ '_harnessId', 'partitionId', 'ts', 'value' ],
                designatedTimestamp: 'ts'
            }
        }
    };
};

/** A harness template for `messageCount` rows, one every `intervalMs`. */
export const buildMessageTemplate = function ( partitionId, messageCount, intervalMs ) {
    return {
        seed: 1,
        messageCount,
        intervalMs,
        fields: {
            partitionId: { type: 'string', values: [ partitionId ] },
            ts: { type: 'timestamp', mode: 'monotonic-ms', seedValue: Date.now() },
            value: { type: 'float64', range: [ 0, 100 ], resolution: 0.01 }
        }
    };
};

// ============================================================================
// QDB / pg HELPERS
// ============================================================================

const pgConfig = function ( extra ) {
    const [ host, port ] = QUESTDB_PG_URL.split( ':' );
    return {
        host,
        port: parseInt( port, 10 ),
        database: 'qdb',
        user: 'admin',
        password: process.env.QUESTDB_PASSWORD ?? 'quest',
        ...extra
    };
};

export const isQuestDBAvailable = async function () {
    const client = new pg.Client( pgConfig( { connectionTimeoutMillis: 3000 } ) );
    try {
        await client.connect();
        await client.query( 'SELECT 1' );
        await client.end();
        return true;
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        return false;
    }
};

export const createPgClient = async function () {
    const client = new pg.Client( pgConfig( {} ) );
    await client.connect();
    return client;
};

export const dropTable = async function ( client, tableName ) {
    try {
        await client.query( `DROP TABLE IF EXISTS ${tableName}` );
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        /* best-effort */
    }
};

export const countRows = async function ( client, tableName ) {
    try {
        const result = await client.query( `SELECT count() FROM ${tableName}` );
        return parseInt( result.rows[ 0 ][ 'count()' ], 10 );
    } catch ( _err ) { // eslint-disable-line no-unused-vars
        return 0;
    }
};

// ============================================================================
// TIMING, HEALTH, CONSOLE
// ============================================================================

export const sleep = function ( ms ) {
    return new Promise( function ( resolve ) {
        setTimeout( resolve, ms );
    } );
};

/**
 * Polls `getHealth()` until `predicate` holds or `maxMs` passes.
 * Returns the last reading either way; the caller asserts on it.
 */
export const waitForHealth = async function ( storage, predicate, maxMs ) {
    const start = Date.now();
    let health = storage.getHealth();
    while ( !predicate( health ) && ( ( Date.now() - start ) < maxMs ) ) {
        await sleep( 50 );
        health = storage.getHealth();
    }
    return health;
};

/**
 * Captures the facade's warn and error lines while still printing
 * them. The lines are the event-driven record of every edge the
 * adapter passed, so the assertions can name them in order.
 */
export const captureConsole = function () {
    const lines = [];
    const wrap = function ( level, original ) {
        return function ( ...args ) {
            lines.push( { level, text: String( args[ 0 ] ) } );
            original.apply( console, args );
        };
    };
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = wrap( 'warn', originalWarn );
    console.error = wrap( 'error', originalError );
    return {
        lines,
        restore: function () {
            console.warn = originalWarn;
            console.error = originalError;
        }
    };
}; // captureConsole()

/** The adapter's own lines from a capture, in order. */
export const adapterLinesOf = function ( lines ) {
    return lines.filter( ( l ) => l.text.includes( 'winkComposer/questdb' ) );
};

// ============================================================================
// MEMORY SAMPLING
// ============================================================================

export const median = function ( values ) {
    const sorted = [ ...values ].sort( ( a, b ) => a - b );
    const mid = Math.floor( sorted.length / 2 );
    return ( sorted.length % 2 === 1 ) ? sorted[ mid ] : ( ( sorted[ mid - 1 ] + sorted[ mid ] ) / 2 );
};

/** Runs a full collection when the runner exposes it; says whether it did. */
export const gcIfExposed = function () {
    if ( typeof global.gc === 'function' ) {
        global.gc();
        return true;
    }
    return false;
};

/** One reading of health and memory, taken together. */
export const takeSample = function ( storage ) {
    const gcRan = gcIfExposed();
    const memory = process.memoryUsage();
    return {
        at: Date.now(),
        health: storage.getHealth(),
        rss: memory.rss,
        heap: memory.heapUsed,
        gcRan
    };
};

export const formatMb = function ( bytes ) {
    return `${( bytes / ( 1024 * 1024 ) ).toFixed( 1 )} MB`;
};
