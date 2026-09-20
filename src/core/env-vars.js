// core/env-vars.js

/* eslint-disable no-process-env */

import os from 'os';

import { classifyAddress, localhostRefusalDetail } from './utils/address/index.js';

// ============================================================================
// ENVIRONMENT VARIABLE DEFINITIONS
// ============================================================================

// Yield threshold parses with Number(), not parseInt(): 'Infinity' must map
// to Infinity — the documented never-yield sentinel (`.yield( { threshold:
// Infinity } )` uses the same value). An empty string is forced to NaN so
// validation fails fast; Number( '' ) would silently give 0, which means
// "breathe after every message" — not what an operator who set the variable
// to nothing intended.
const rawYieldMs = ( process.env.YIELD_TIME_THRESHOLD_MS ?? '500' ).trim();

// The log-level default depends on NODE_ENV, and the ENV_VARS object
// literal cannot read its own nodeEnv entry while it is being built.
// So NODE_ENV is resolved once here and used in both places (the same
// hoisting precedent as rawYieldMs above). Production defaults to
// 'info' so an edge box does not fill its journal with debug lines;
// everything else defaults to 'debug' for development visibility.
// ADR-028 records the logger architecture.
const rawNodeEnv = ( process.env.NODE_ENV ?? 'development' ).trim();

const ENV_VARS = {
    // Core Configuration
    edgeDeviceId: ( process.env.EDGE_DEVICE_ID ?? os.hostname() ).trim(),
    nodeEnv: rawNodeEnv,

    // Logging (ADR-028). 'logger' picks the transport the facade
    // writes through; 'logLevel' picks the lowest level that prints.
    logger: ( process.env.COMPOSER_LOGGER ?? 'console' ).trim(),
    logLevel: ( process.env.COMPOSER_LOG_LEVEL ?? ( ( rawNodeEnv === 'production' ) ? 'info' : 'debug' ) ).trim(),

    // Partition Management (see ADR-016)
    maxPartitionsAllowed: parseInt( process.env.COMPOSER_MAX_PARTITIONS_ALLOWED ?? '10000', 10 ),

    // Fault containment (ADR-018 — the flow runtime owns per-message
    // dispatch failure). This many CONSECUTIVE message failures stop
    // the flow in the terminal 'errored' phase; one success resets
    // the count. The same value caps a partition's consecutive
    // creation failures before it is quarantined. A run of failures
    // means something systemic; one bad message costs only itself.
    messageFailureThreshold: parseInt( process.env.COMPOSER_MESSAGE_FAILURE_THRESHOLD ?? '5', 10 ),

    // STORAGE_DIR retired 2026-07-09 — the emitter's LevelDB store
    // (removed by ADR-021) was the only thing that ever wrote there.
    // A future WAL adapter defines its own disk-path configuration.

    // Flow lifecycle — top-level forced-shutdown timeout (process layer)
    // Bounds the entire `handle.shutdown()` drain. If `shutdown-manager`
    // doesn't see graceful completion within this many milliseconds, it
    // logs and force-exits with code 1 (vs 0 on graceful). Matches
    // Kubernetes' default `terminationGracePeriodSeconds` of 30. See
    // ADR-018 (flow lifecycle and signal handling).
    shutdownForceTimeoutMs: parseInt( process.env.SHUTDOWN_FORCE_TIMEOUT_MS ?? '30000', 10 ),

    // Flow yield — default time threshold between deliberate event-loop
    // breaths (ADR-024). Matters only to callers that wait on
    // `processMessage` (file replays, testHarness, the headless driver):
    // for them the yield tick is the only planned chance for sink flush
    // timers and socket I/O to run. 500 ms is half the tightest background
    // timer it must not starve (QUESTDB_FLUSH_INTERVAL_MS, default 1000).
    // Per-flow override: `.yield( { threshold } )`. Infinity = never yield.
    yieldTimeThresholdMs: rawYieldMs === '' ? NaN : Number( rawYieldMs ),

    // MQTT Configuration
    mqttBrokerUrl: ( process.env.MQTT_BROKER_URL ?? 'mqtt://127.0.0.1:1883' ).trim(),
    mqttMsgExpiry: parseInt( process.env.MQTT_MSG_EXPIRY ?? '3600', 10 ),
    mqttKeepalive: parseInt( process.env.MQTT_KEEPALIVE ?? '60', 10 ),
    mqttReconnectMs: parseInt( process.env.MQTT_RECONNECT_MS ?? '5000', 10 ),
    mqttConnectTimeoutMs: parseInt( process.env.MQTT_CONNECT_TIMEOUT_MS ?? '30000', 10 ),
    // How long the MQTT emitter factory waits at startup for the
    // broker's first connection acknowledgment before handing the
    // flow its handle anyway (recovering posture — the wait expiring
    // is not an error). 0 disables the wait. Per-emitter override:
    // the `connectGraceMs` config key.
    mqttConnectGraceMs: parseInt( process.env.MQTT_CONNECT_GRACE_MS ?? '500', 10 ),
    mqttSessionExpiryS: parseInt( process.env.MQTT_SESSION_EXPIRY_S ?? '604800', 10 ),
    mqttMaxQueueSize: parseInt( process.env.MQTT_MAX_QUEUE_SIZE ?? '10000', 10 ),
    // MQTT_MAX_QUEUE_BYTES retired with the emitter's disk store
    // (ADR-021) — the in-memory emitter bounds memory by count alone.
    // MQTT_DEDUP_WINDOW (count-only dedup) retired 2026-07-09 by
    // ADR-022 — the source dedup cache is now time-bounded AND
    // count-capped, with its own two variables below.
    mqttSourceDedupWindowMs: parseInt( process.env.MQTT_SOURCE_DEDUP_WINDOW_MS ?? '120000', 10 ),
    mqttSourceDedupMaxEntries: parseInt( process.env.MQTT_SOURCE_DEDUP_MAX_ENTRIES ?? '65536', 10 ),

    // QuestDB Configuration. The address defaults are loopback literals,
    // never the name `localhost` (ADR-030). A name can resolve to two
    // addresses, `::1` and `127.0.0.1`, and QuestDB may listen on only
    // one; the run-5 soak lost its write path for four hours that way.
    // The `hostPort` and `mqttUrl` validators below refuse `localhost`
    // outright, so a deployment that sets it stops here, at import.
    questdbIlpUrl: ( process.env.QUESTDB_ILP_URL ?? '127.0.0.1:9000' ).trim(),
    questdbPgUrl: ( process.env.QUESTDB_PG_URL ?? '127.0.0.1:8812' ).trim(),
    // Optional QuestDB settings (undefined if not set)
    questdbMaxBufSize: process.env.QUESTDB_MAX_BUF_SIZE ?
        parseInt( process.env.QUESTDB_MAX_BUF_SIZE, 10 ) : undefined,
    questdbRetryTimeout: process.env.QUESTDB_RETRY_TIMEOUT ?
        parseInt( process.env.QUESTDB_RETRY_TIMEOUT, 10 ) : undefined,

    // QuestDB flush settings owned by composer (ADR-029). Each carries a
    // value only when the operator set one. The adapter's option
    // resolver supplies the defaults and derives the ceiling and the
    // deadline from the values that won, so a fixed default here would
    // fight a threshold raised in the flow's config.
    questdbFlushRows: process.env.QUESTDB_FLUSH_ROWS ?
        parseInt( process.env.QUESTDB_FLUSH_ROWS, 10 ) : undefined,
    questdbFlushIntervalMs: process.env.QUESTDB_FLUSH_INTERVAL_MS ?
        parseInt( process.env.QUESTDB_FLUSH_INTERVAL_MS, 10 ) : undefined,
    questdbBufferCeilingRows: process.env.QUESTDB_BUFFER_CEILING_ROWS ?
        parseInt( process.env.QUESTDB_BUFFER_CEILING_ROWS, 10 ) : undefined,
    questdbFlushDeadlineMs: process.env.QUESTDB_FLUSH_DEADLINE_MS ?
        parseInt( process.env.QUESTDB_FLUSH_DEADLINE_MS, 10 ) : undefined,

    // QuestDB transport settings (ADR-029). QUESTDB_STDLIB_HTTP takes
    // the client's own words for `stdlib_http`, `on` or `off`. The
    // adapter's option resolver maps them to a boolean and supplies the
    // default, so each field here carries a value only when set.
    questdbStdlibHttp: process.env.QUESTDB_STDLIB_HTTP ?
        process.env.QUESTDB_STDLIB_HTTP.trim() : undefined,
    questdbRequestTimeout: process.env.QUESTDB_REQUEST_TIMEOUT ?
        parseInt( process.env.QUESTDB_REQUEST_TIMEOUT, 10 ) : undefined,
    questdbInitBufSize: process.env.QUESTDB_INIT_BUF_SIZE ?
        parseInt( process.env.QUESTDB_INIT_BUF_SIZE, 10 ) : undefined,

    // QuestDB Credentials
    questdbDatabase: ( process.env.QUESTDB_DATABASE ?? 'qdb' ).trim(),
    questdbUser: ( process.env.QUESTDB_USER ?? 'admin' ).trim(),
    questdbPassword: process.env.QUESTDB_PASSWORD ?? 'quest'
};

// ============================================================================
// VALIDATORS
// ============================================================================
const validators = {
    edgeDeviceId: function ( value ) {
        if ( !value ) return 'Cannot be empty';
        if ( !( /^[\w\-\/.]+$/ ).test( value ) ) {
            return `Invalid characters for MQTT topic: "${value}"`;
        }
        return null;
    },

    nodeEnv: function ( value ) {
        const validEnvs = [ 'development', 'production', 'test' ];
        if ( !validEnvs.includes( value ) ) {
            return `Must be one of ${validEnvs.join( ', ' )}, got: "${value}"`;
        }
        return null;
    },

    logger: function ( value ) {
        const validTransports = [ 'console', 'json', 'silent' ];
        if ( !validTransports.includes( value ) ) {
            return `Must be one of ${validTransports.join( ', ' )}, got: "${value}"`;
        }
        return null;
    },

    logLevel: function ( value ) {
        const validLevels = [ 'debug', 'info', 'warn', 'error' ];
        if ( !validLevels.includes( value ) ) {
            return `Must be one of ${validLevels.join( ', ' )}, got: "${value}"`;
        }
        return null;
    },

    mqttMsgExpiry: function ( value, originalEnv ) {
        if ( isNaN( value ) || value <= 0 ) {
            return `Must be positive integer, got: "${originalEnv}"`;
        }
        return null;
    },

    positiveInt: function ( value, originalEnv ) {
        if ( isNaN( value ) || value <= 0 ) {
            return `Must be positive integer, got: "${originalEnv}"`;
        }
        return null;
    },

    // host:port, with the port required. Accepts a name, an IPv4
    // literal, or a bracketed IPv6 literal (`[::1]:8812`). Refuses
    // `localhost` in every spelling (ADR-030); the shared helper is the
    // one check the adapter schema and factory layers use too.
    hostPort: function ( value ) {
        if ( !value ) return 'Cannot be empty';
        const address = classifyAddress( value, 'hostPort' );
        if ( ( address.kind === 'unparsed' ) || ( address.port === undefined ) ) {
            return `Must be host:port format, got: "${value}"`;
        }
        if ( address.kind === 'localhost' ) {
            return localhostRefusalDetail( address );
        }
        return null;
    },

    questdbStdlibHttp: function ( value ) {
        if ( value === undefined ) return null;
        const validWords = [ 'on', 'off' ];
        if ( !validWords.includes( value ) ) {
            return `Must be one of ${validWords.join( ', ' )}, got: "${value}"`;
        }
        return null;
    },

    positiveIntOrUndefined: function ( value, originalEnv ) {
        if ( value === undefined ) return null;
        if ( isNaN( value ) || value <= 0 ) {
            return `Must be positive integer, got: "${originalEnv}"`;
        }
        return null;
    },

    nonNegativeInt: function ( value, originalEnv ) {
        if ( isNaN( value ) || value < 0 ) {
            return `Must be non-negative integer, got: "${originalEnv}"`;
        }
        return null;
    },

    nonNegativeNumberOrInfinity: function ( value, originalEnv ) {
        if ( isNaN( value ) || value < 0 ) {
            return `Must be a non-negative number or Infinity, got: "${originalEnv}"`;
        }
        return null;
    },

    nonEmptyString: function ( value ) {
        if ( !value || value.trim() === '' ) {
            return `Cannot be empty, got: "${value}"`;
        }
        return null;
    },

    // A broker URL. The scheme check comes first; then `localhost` is
    // refused (ADR-030). A URL the parser cannot read is left to the
    // MQTT library, which reports its own error.
    mqttUrl: function ( value ) {
        if ( !value ) return 'Cannot be empty';
        if ( !value.startsWith( 'mqtt://' ) && !value.startsWith( 'mqtts://' ) ) {
            return `Must start with 'mqtt://' or 'mqtts://', got: "${value}"`;
        }
        const address = classifyAddress( value, 'url' );
        if ( address.kind === 'localhost' ) {
            return localhostRefusalDetail( address );
        }
        return null;
    }
};

// ============================================================================
// VALIDATION CONFIGURATION
// ============================================================================
const validationConfig = [
    { field: 'edgeDeviceId', validator: validators.edgeDeviceId },
    { field: 'nodeEnv', validator: validators.nodeEnv },
    { field: 'logger', validator: validators.logger, label: 'COMPOSER_LOGGER' },
    { field: 'logLevel', validator: validators.logLevel, label: 'COMPOSER_LOG_LEVEL' },
    { field: 'maxPartitionsAllowed', validator: validators.positiveInt, originalEnv: 'COMPOSER_MAX_PARTITIONS_ALLOWED' },
    { field: 'messageFailureThreshold', validator: validators.positiveInt, originalEnv: 'COMPOSER_MESSAGE_FAILURE_THRESHOLD' },
    { field: 'yieldTimeThresholdMs', validator: validators.nonNegativeNumberOrInfinity, originalEnv: 'YIELD_TIME_THRESHOLD_MS' },
    { field: 'mqttBrokerUrl', validator: validators.mqttUrl, label: 'MQTT_BROKER_URL' },
    { field: 'mqttMsgExpiry', validator: validators.mqttMsgExpiry, originalEnv: 'MQTT_MSG_EXPIRY' },
    { field: 'mqttKeepalive', validator: validators.positiveInt, originalEnv: 'MQTT_KEEPALIVE' },
    { field: 'mqttReconnectMs', validator: validators.positiveInt, originalEnv: 'MQTT_RECONNECT_MS' },
    { field: 'mqttConnectTimeoutMs', validator: validators.positiveInt, originalEnv: 'MQTT_CONNECT_TIMEOUT_MS' },
    { field: 'mqttConnectGraceMs', validator: validators.nonNegativeInt, originalEnv: 'MQTT_CONNECT_GRACE_MS' },
    { field: 'mqttSessionExpiryS', validator: validators.positiveInt, originalEnv: 'MQTT_SESSION_EXPIRY_S' },
    { field: 'mqttMaxQueueSize', validator: validators.positiveInt, originalEnv: 'MQTT_MAX_QUEUE_SIZE' },
    { field: 'mqttSourceDedupWindowMs', validator: validators.positiveInt, originalEnv: 'MQTT_SOURCE_DEDUP_WINDOW_MS' },
    { field: 'mqttSourceDedupMaxEntries', validator: validators.positiveInt, originalEnv: 'MQTT_SOURCE_DEDUP_MAX_ENTRIES' },
    // QuestDB Configuration
    { field: 'questdbIlpUrl', validator: validators.hostPort, label: 'QUESTDB_ILP_URL' },
    { field: 'questdbPgUrl', validator: validators.hostPort, label: 'QUESTDB_PG_URL' },
    { field: 'questdbMaxBufSize', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_MAX_BUF_SIZE' },
    { field: 'questdbRetryTimeout', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_RETRY_TIMEOUT' },
    { field: 'questdbFlushRows', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_FLUSH_ROWS' },
    { field: 'questdbFlushIntervalMs', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_FLUSH_INTERVAL_MS' },
    { field: 'questdbBufferCeilingRows', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_BUFFER_CEILING_ROWS' },
    { field: 'questdbFlushDeadlineMs', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_FLUSH_DEADLINE_MS' },
    { field: 'questdbStdlibHttp', validator: validators.questdbStdlibHttp, label: 'QUESTDB_STDLIB_HTTP' },
    { field: 'questdbRequestTimeout', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_REQUEST_TIMEOUT' },
    { field: 'questdbInitBufSize', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_INIT_BUF_SIZE' },
    // QuestDB Credentials
    { field: 'questdbDatabase', validator: validators.nonEmptyString, label: 'QUESTDB_DATABASE' },
    { field: 'questdbUser', validator: validators.nonEmptyString, label: 'QUESTDB_USER' }
    // questdbPassword: no validation — allows empty for passwordless auth
];

// The five QuestDB flush variables 0.7.0 deprecated and 0.8.0 removed
// (ADR-029 item 10). A deployment that still sets one stops here, at
// import, and the failure line names what to do instead. Ignoring the
// variable would let an operator believe a setting took effect.
const REMOVED_ENV_VARS = [
    { name: 'QUESTDB_FLUSH_MODE', action: 'delete it, composer owns every flush' },
    { name: 'QUESTDB_IDLE_FLUSH_AFTER_MS', action: 'delete it, composer owns every flush' },
    { name: 'QUESTDB_IDLE_FLUSH_CHECK_MS', action: 'use QUESTDB_FLUSH_INTERVAL_MS' },
    { name: 'QUESTDB_AUTO_FLUSH_ROWS', action: 'use QUESTDB_FLUSH_ROWS' },
    { name: 'QUESTDB_AUTO_FLUSH_INTERVAL_MS', action: 'delete it, composer owns every flush' }
];

// ============================================================================
// VALIDATION RUNNER
// ============================================================================
const validate = function () {
    const errors = [];

    // A removed variable is refused by name, even when empty, so a
    // leftover line in an env file is found.
    for ( const removed of REMOVED_ENV_VARS ) {
        if ( process.env[ removed.name ] !== undefined ) {
            errors.push( `${removed.name}: Removed in 0.8.0; ${removed.action}` );
        }
    }

    // Run each validator
    for ( const config of validationConfig ) {
        const value = ENV_VARS[ config.field ];
        const originalEnv = config.originalEnv ? process.env[ config.originalEnv ] : value;
        // The label is the variable name as the operator typed it. A row
        // that records the variable uses it; otherwise the name is
        // derived from the field, inserting the underscores BEFORE
        // uppercasing (the other order finds no boundaries and printed
        // QUESTDBRETRYTIMEOUT until 2026-09-05).
        const label = config.label ||
            config.originalEnv ||
            config.field.replace( /([a-z])([A-Z])/g, '$1_$2' ).toUpperCase();

        const error = config.validator( value, originalEnv || value, label );
        if ( error ) {
            errors.push( `${label}: ${error}` );
        }
    }

    // Fail fast with clear error message
    if ( errors.length > 0 ) {
        console.error( 'winkComposer/envVars: Environment variable validation failed:' ); // eslint-disable-line no-console -- bootstrap failure runs before any logger can exist
        errors.forEach( ( err ) => console.error( `   - ${err}` ) ); // eslint-disable-line no-console -- bootstrap failure runs before any logger can exist
        process.exit( 1 ); // eslint-disable-line no-process-exit
    }
}; // validate()

// Run validation immediately on import
validate();

export { ENV_VARS, validators };
