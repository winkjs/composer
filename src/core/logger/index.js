// core/logger/index.js

/**
 * @fileoverview The framework's logging facade. Every production
 * log line goes through one small object with four methods: debug,
 * info, warn, and error. Each method takes a message string and an
 * optional flat fields object. The transport behind the facade —
 * where a record actually goes — is picked once at startup from
 * COMPOSER_LOGGER, and the lowest level that prints is picked from
 * COMPOSER_LOG_LEVEL. ADR-028 records the design.
 *
 * Three guarantees shape the code:
 *
 * - **Zero cost when suppressed.** Levels below the threshold are
 *   resolved at build time: every suppressed method IS one shared
 *   empty function. No comparison, no allocation, no argument
 *   inspection happens on a suppressed call. JavaScript still
 *   evaluates the arguments themselves, so a hot-path call site
 *   guards a fields literal with the precomputed `debugOn` or
 *   `infoOn` boolean instead of relying on the no-op.
 * - **A log call never throws.** Logging exists to report faults,
 *   so it must not create them. A broken transport, a bad level
 *   name, or unserializable fields each degrade to a working
 *   console line. The last-resort line interpolates nothing.
 * - **Stream identity.** The console transport mirrors each level
 *   to the same console method a raw call would have used, and the
 *   json transport keeps the same stderr/stdout split. A line
 *   never moves between streams because the facade arrived.
 *
 * There is deliberately no file transport: journald, kubelet, and
 * logrotate own files in every deployment shape (ADR-028 records
 * the rejection and the escape hatches).
 */

import { ENV_VARS } from '../env-vars.js';

// Level order: a method emits when its rank is at or above the
// configured threshold. Internal constant keys — a plain literal.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Which console method carries each level. error and warn go to
// stderr, info and debug to stdout — the same split raw calls had.
const CONSOLE_METHODS = { debug: 'log', info: 'log', warn: 'warn', error: 'error' };

// The one shared no-op every suppressed method resolves to.
const NO_OP = function () { /* the shared suppressed-level sink */ };

/**
 * Stringify a fields object without ever throwing. Circular or
 * otherwise unserializable fields become a quoted placeholder, so
 * the surrounding line stays valid.
 *
 * @param {*} value - The fields value to render.
 * @returns {string} JSON text, or the placeholder literal.
 */
const safeStringify = function ( value ) {
    try {
        return JSON.stringify( value );
    } catch {
        return '"[unserializable fields]"';
    }
}; // safeStringify()

const consoleTransport = {
    emit: function ( level, msg, fields ) {
        const line = ( fields === undefined ) ? msg : ( msg + ' ' + safeStringify( fields ) );
        console[ CONSOLE_METHODS[ level ] ]( line );
    }
};

const jsonTransport = {
    emit: function ( level, msg, fields ) {
        let line;
        try {
            // JSON.stringify drops a fields key holding undefined,
            // so the no-fields record needs no separate branch.
            line = JSON.stringify( { level, msg, fields } );
        } catch {
            line = JSON.stringify( { level, msg, fields: '[unserializable fields]' } );
        }
        console[ CONSOLE_METHODS[ level ] ]( line );
    }
};

const silentTransport = {
    emit: NO_OP
};

// The env-selectable transports. The mqtt transport joins this map
// when ADR-029 lands.
const transports = {
    console: consoleTransport,
    json: jsonTransport,
    silent: silentTransport
};

/**
 * Create an in-memory transport for specs. Each instance records
 * `{ level, msg, fields }` per emission and can be reset. Never
 * selectable through COMPOSER_LOGGER.
 *
 * @returns {object} `{ emit, records, reset }`.
 */
const createMemoryTransport = function () {
    const records = [];
    return {
        records,
        reset: function () {
            records.length = 0;
        },
        emit: function ( level, msg, fields ) {
            records.push( { level, msg, fields } );
        }
    };
}; // createMemoryTransport()

/**
 * Build a logger over a transport at a level. Methods are
 * precompiled here: suppressed levels become the shared no-op, and
 * active levels close over the transport. Invalid inputs fall back
 * to a working console logger with one warning line — building a
 * logger never throws, because logging must not crash its host.
 *
 * @param {object} transport - An object with `emit( level, msg, fields )`.
 * @param {string} levelName - One of debug, info, warn, error.
 * @returns {object} `{ debug, info, warn, error, debugOn, infoOn, level }`.
 */
const buildLogger = function ( transport, levelName ) {
    let safeTransport = transport;
    if ( !transport || typeof transport.emit !== 'function' ) {
        console.warn( 'winkComposer/logger: transport has no emit function — falling back to console' );
        safeTransport = consoleTransport;
    }

    let safeLevel = levelName;
    if ( LEVELS[ safeLevel ] === undefined ) {
        console.warn( 'winkComposer/logger: unknown log level — falling back to info' );
        safeLevel = 'info';
    }

    const threshold = LEVELS[ safeLevel ];

    const makeMethod = function ( name ) {
        if ( LEVELS[ name ] < threshold ) {
            return NO_OP;
        }
        return function ( msg, fields ) {
            try {
                safeTransport.emit( name, msg, fields );
            } catch {
                // Last resort, interpolation-free: a broken
                // transport must not crash the host process.
                console.error( 'winkComposer/logger: transport emit failed — record dropped' );
            }
        };
    };

    return {
        debug: makeMethod( 'debug' ),
        info: makeMethod( 'info' ),
        warn: makeMethod( 'warn' ),
        error: makeMethod( 'error' ),
        debugOn: ( threshold <= LEVELS.debug ),
        infoOn: ( threshold <= LEVELS.info ),
        level: safeLevel
    };
}; // buildLogger()

// The default instance every production module imports. ENV_VARS
// validated both values at startup, so the fallbacks above are a
// second line of defense, not the expected path.
const logger = buildLogger( transports[ ENV_VARS.logger ], ENV_VARS.logLevel );

export { logger, buildLogger, createMemoryTransport, transports };
