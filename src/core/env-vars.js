// core/env-vars.js

/* eslint-disable no-process-env */

import os from 'os';

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

const ENV_VARS = {
    // Core Configuration
    edgeDeviceId: ( process.env.EDGE_DEVICE_ID ?? os.hostname() ).trim(),
    nodeEnv: ( process.env.NODE_ENV ?? 'development' ).trim(),

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
    // timer it must not starve (QUESTDB_IDLE_FLUSH_CHECK_MS, 1000).
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

    // QuestDB Configuration
    questdbIlpUrl: ( process.env.QUESTDB_ILP_URL ?? 'localhost:9000' ).trim(),
    questdbPgUrl: ( process.env.QUESTDB_PG_URL ?? 'localhost:8812' ).trim(),
    questdbFlushMode: ( process.env.QUESTDB_FLUSH_MODE ?? 'auto' ).trim(),
    questdbIdleFlushAfterMs: parseInt( process.env.QUESTDB_IDLE_FLUSH_AFTER_MS ?? '5000', 10 ),
    questdbIdleFlushCheckMs: parseInt( process.env.QUESTDB_IDLE_FLUSH_CHECK_MS ?? '1000', 10 ),
    // Optional QuestDB settings (undefined if not set)
    questdbAutoFlushRows: process.env.QUESTDB_AUTO_FLUSH_ROWS ?
        parseInt( process.env.QUESTDB_AUTO_FLUSH_ROWS, 10 ) : undefined,
    questdbAutoFlushIntervalMs: process.env.QUESTDB_AUTO_FLUSH_INTERVAL_MS ?
        parseInt( process.env.QUESTDB_AUTO_FLUSH_INTERVAL_MS, 10 ) : undefined,
    questdbMaxBufSize: process.env.QUESTDB_MAX_BUF_SIZE ?
        parseInt( process.env.QUESTDB_MAX_BUF_SIZE, 10 ) : undefined,
    questdbRetryTimeout: process.env.QUESTDB_RETRY_TIMEOUT ?
        parseInt( process.env.QUESTDB_RETRY_TIMEOUT, 10 ) : undefined,

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

    hostPort: function ( value ) {
        if ( !value ) return 'Cannot be empty';
        // Match host:port pattern (host can be hostname or IP)
        const hostPortRegex = /^[\w.\-]+:\d+$/;
        if ( !hostPortRegex.test( value ) ) {
            return `Must be host:port format, got: "${value}"`;
        }
        return null;
    },

    questdbFlushMode: function ( value ) {
        const validModes = [ 'auto', 'manual' ];
        if ( !validModes.includes( value ) ) {
            return `Must be one of ${validModes.join( ', ' )}, got: "${value}"`;
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

    mqttUrl: function ( value ) {
        if ( !value ) return 'Cannot be empty';
        if ( !value.startsWith( 'mqtt://' ) && !value.startsWith( 'mqtts://' ) ) {
            return `Must start with 'mqtt://' or 'mqtts://', got: "${value}"`;
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
    { field: 'questdbFlushMode', validator: validators.questdbFlushMode, label: 'QUESTDB_FLUSH_MODE' },
    { field: 'questdbIdleFlushAfterMs', validator: validators.nonNegativeInt, originalEnv: 'QUESTDB_IDLE_FLUSH_AFTER_MS' },
    { field: 'questdbIdleFlushCheckMs', validator: validators.positiveInt, originalEnv: 'QUESTDB_IDLE_FLUSH_CHECK_MS' },
    { field: 'questdbAutoFlushRows', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_AUTO_FLUSH_ROWS' },
    { field: 'questdbAutoFlushIntervalMs', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_AUTO_FLUSH_INTERVAL_MS' },
    { field: 'questdbMaxBufSize', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_MAX_BUF_SIZE' },
    { field: 'questdbRetryTimeout', validator: validators.positiveIntOrUndefined, originalEnv: 'QUESTDB_RETRY_TIMEOUT' },
    // QuestDB Credentials
    { field: 'questdbDatabase', validator: validators.nonEmptyString, label: 'QUESTDB_DATABASE' },
    { field: 'questdbUser', validator: validators.nonEmptyString, label: 'QUESTDB_USER' }
    // questdbPassword: no validation — allows empty for passwordless auth
];

// ============================================================================
// VALIDATION RUNNER
// ============================================================================
const validate = function () {
    const errors = [];

    // Run each validator
    for ( const config of validationConfig ) {
        const value = ENV_VARS[ config.field ];
        const originalEnv = config.originalEnv ? process.env[ config.originalEnv ] : value;
        const label = config.label || config.field.toUpperCase().replace( /([a-z])([A-Z])/g, '$1_$2' );

        const error = config.validator( value, originalEnv || value, label );
        if ( error ) {
            errors.push( `${label}: ${error}` );
        }
    }

    // Fail fast with clear error message
    if ( errors.length > 0 ) {
        console.error( 'composer: Environment variable validation failed:' );
        errors.forEach( ( err ) => console.error( `   - ${err}` ) );
        process.exit( 1 ); // eslint-disable-line no-process-exit
    }
}; // validate()

// Run validation immediately on import
validate();

export { ENV_VARS, validators };
