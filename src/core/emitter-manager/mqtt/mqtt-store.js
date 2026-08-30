// core/emitter-manager/mqtt/mqtt-store.js

/**
 * @fileoverview MQTT.js-Compatible Store with Pressure Monitoring
 *
 * DORMANT (ADR-021, 2026-07-09): not wired into the emitter. mqtt.js
 * loses QoS-1 messages on every connection acceptance when its outgoing
 * store is asynchronous (the erase-then-rebuild gap — ADR-021
 * has the diagnosis and the measured loss-vs-latency curve), so the
 * emitter runs the client's default synchronous memory store instead.
 * This module and its specs are kept intact as the starting point for
 * the composer-owned WAL successor that restores crash durability
 * truthfully — outside mqtt.js, where the connack race cannot reach it.
 *
 * Packaging note (2026-08-22): this file is excluded from the npm
 * package, and classic-level is a devDependency. Consumers cannot
 * reach this module — the package exports only its root — and should
 * not download native binaries for dormant code. The WAL successor
 * promotes whatever store dependency it adopts back to dependencies.
 *
 * DESIGN DECISIONS:
 *
 * 1. DUAL KEY STORAGE
 *    - Metadata (JSON) and payload (Buffer) stored separately
 *    - Prevents Buffer corruption through JSON serialization
 *    - Enables efficient metrics calculation without loading payloads
 *
 * 2. CIRCUIT BREAKER PATTERN
 *    - Opens after 5 consecutive failures
 *    - Auto-recovery attempt after 60 seconds
 *    - Prevents cascade failures from corrupted storage
 *
 * 3. PRESSURE MONITORING
 *    - Two limits: message count (10,000) and bytes (50MB)
 *    - Configurable per deployment environment
 *    - Triggers backpressure at 80% for early warning
 *
 * 4. EVENTUALLY CONSISTENT METRICS
 *    - Metrics lag behind actual state by milliseconds
 *    - Acceptable for monitoring, NOT for control decisions
 *    - Trade-off: Simpler async model over perfect accuracy
 *
 * 5. ITERATOR SAFETY
 *    - Always close iterators in finally blocks
 *    - Prevents LevelDB handle leaks
 *    - Critical for long-running edge deployments
 *
 * 6. DRIVER-AGNOSTIC MISSING-KEY HANDLING
 *    - `abstract-level`'s contract for missing keys has shifted across
 *      versions: some throw `LEVEL_NOT_FOUND`, some resolve with
 *      `undefined`. Both are valid per the spec; a single store
 *      implementation must handle either.
 *    - Each `db.get()` call site normalises **both** forms inline —
 *      `undefined` from the resolve path AND `LEVEL_NOT_FOUND` from
 *      the catch path are treated as "not present". Inline (rather
 *      than helper-wrapped) to avoid an extra Promise allocation per
 *      call on the hot path (every PUBACK fires `del()`; ~10 k/s on
 *      RPi-class hardware would otherwise add ~30 KB/s of Promise
 *      churn for no functional benefit).
 *    - Without this normalisation, a missing-key `get()` would
 *      TypeError inside the `.then()` handler (`undefined.payload =
 *      ...`), trip the circuit breaker after 5 misses, and surface as
 *      a `TypeError` to the caller instead of the documented
 *      `(null, null)`.
 *
 * LIMITATIONS:
 * - Metrics are not real-time (fire-and-forget consequence)
 * - No automatic eviction when full (by design - preserve data)
 *
 * @module mqtt-store
 */

import { ClassicLevel } from 'classic-level';
import { Readable } from 'stream';
import {
    STORE_CONFIG,
    DEFAULT_MAX_QUEUE_SIZE,
    DEFAULT_MAX_QUEUE_BYTES,
    QUEUE_CRITICAL_THRESHOLD,
    MQTT_INFLIGHT_ID_LIMIT
} from './constants.js';

/**
 * `LEVEL_NOT_FOUND` err.code as a module-level constant — referenced from
 * each `db.get()` call site's catch handler when normalising the driver's
 * missing-key shape. See file-header design decision #6.
 */
const ERR_LEVEL_NOT_FOUND = 'LEVEL_NOT_FOUND';

/**
 * Singleton empty payload reused on every orphan-meta replay (createStream
 * fallback when the PAYL row is missing). Avoids `Buffer.alloc(0)` per
 * push on the replay path. Buffers from `Buffer.alloc(0)` are immutable
 * for practical purposes (zero length); safe to share.
 */
const EMPTY_PAYLOAD = Buffer.alloc( 0 );

/**
 * Create MQTT.js-compatible store with metrics
 *
 * @param {string} path - Storage directory path
 * @param {Object} [options] - Optional configuration
 * @returns {Object} Store interface for MQTT.js
 */
export const createMQTTStore = function ( path, options = {} ) {
    // Configurable limits with defaults. maxQueueSize is clamped to the
    // MQTT id-space ceiling — see MQTT_INFLIGHT_ID_LIMIT in constants.js
    // for the full rationale. Clamped loudly, not silently: the operator
    // asked for capacity the protocol cannot provide.
    const requestedQueueSize = options.maxQueueSize || DEFAULT_MAX_QUEUE_SIZE;
    if ( requestedQueueSize > MQTT_INFLIGHT_ID_LIMIT ) {
        console.warn(
            `winkComposer/mqttStore: maxQueueSize ${requestedQueueSize} exceeds the MQTT ` +
            `16-bit packet-id space; clamped to ${MQTT_INFLIGHT_ID_LIMIT}`
        );
    }
    const limits = {
        maxQueueSize: Math.min( requestedQueueSize, MQTT_INFLIGHT_ID_LIMIT ),
        maxQueueBytes: options.maxQueueBytes || DEFAULT_MAX_QUEUE_BYTES
    };

    // Open without global encoding
    const db = new ClassicLevel( path, {
        compression: STORE_CONFIG.compression,
        cacheSize: STORE_CONFIG.cacheSize
    } );

    // Key prefixes for metadata and payloads
    const META = 'pkt:m:';     // JSON metadata
    const PAYL = 'pkt:p:';     // Buffer payload

    // Closed-once latch — see `close()` for rationale.
    let closed = false;

    // Metrics for pressure monitoring
    const metrics = {
        messageCount: 0,
        totalBytes: 0,
        errors: 0,
        lastError: null
    };

    // Circuit breaker for store failures
    const circuitBreaker = {
        failures: 0,
        lastFailure: 0,
        state: 'CLOSED',  // CLOSED, OPEN, HALF_OPEN

        recordSuccess: function () {
            this.failures = 0;
            this.state = 'CLOSED';
        },

        recordFailure: function () {
            this.failures += 1;
            this.lastFailure = Date.now();

            if ( this.failures >= 5 ) {
                this.state = 'OPEN';
                // Use unref() so this timer doesn't keep the process alive
                setTimeout( () => {
                    this.state = 'HALF_OPEN';
                }, 60000 ).unref();  // Try again after 1 minute
            }
        },

        canAttempt: function () {
            return this.state !== 'OPEN';
        }
    };

    /**
     * Initialize metrics from existing store contents.
     *
     * Race-aware: the put()/del() paths now do **optimistic increment**
     * (so `getPressure()` is accurate at the call site for backpressure).
     * If a put() fires during this scan, our snapshot is stale by the
     * time it lands. Detect that by comparing `metrics.messageCount`
     * before and after the iteration: if it changed, the optimistic
     * counter has already been moved by concurrent ops, so we ADD what
     * we found rather than overwrite.
     */
    const initMetrics = async function () {
        let count = 0;
        let bytes = 0;
        let iter = null;

        const beforeCount = metrics.messageCount;
        const beforeBytes = metrics.totalBytes;

        try {
            iter = db.iterator( {
                gte: META,
                lt: META + '\xFF',
                valueEncoding: 'json'
            } );

            for await ( const [ key, meta ] of iter ) { // eslint-disable-line no-unused-vars
                count += 1;
                bytes += meta.size || 0;
            }

            // Concurrent put detection — if the optimistic counter
            // moved while we scanned, accumulate rather than overwrite.
            // Slight overestimate (concurrent puts may also be visible
            // in the scan and double-counted), but that biases toward
            // earlier pre-flight reject — safer than under-counting.
            if ( metrics.messageCount === beforeCount && metrics.totalBytes === beforeBytes ) {
                metrics.messageCount = count;
                metrics.totalBytes = bytes;
            } else {
                metrics.messageCount += count;
                metrics.totalBytes += bytes;
            }

            if ( options.debug && count > 0 ) {
                console.log( `Store initialized with ${count} messages (${bytes} bytes)` );
            }
        } catch ( err ) {
            if ( err.code !== 'LEVEL_NOT_FOUND' && options.debug ) {
                console.error( 'Failed to initialize metrics:', err.message );
            }
        } finally {
            if ( iter ) {
                await iter.close();
            }
        }
    };

    // Initialize metrics on startup
    initMetrics().catch( () => { /* Noop */ } );

    /**
     * MQTT.js store interface
     */
    const store = {
        put: ( packet, cb ) => {
            if ( !packet || packet.qos === 0 ) {
                setImmediate( cb );
                return;
            }

            // Check circuit breaker
            if ( !circuitBreaker.canAttempt() ) {
                const err = new Error( 'Store circuit breaker OPEN' );
                err.code = 'CIRCUIT_OPEN';
                setImmediate( cb, err );
                return;
            }

            const mid = packet.messageId;
            if ( !mid ) {
                setImmediate( cb, new Error( 'Missing messageId' ) );
                return;
            }

            // Check message count pressure
            if ( metrics.messageCount >= limits.maxQueueSize ) {
                const err = new Error( 'QUEUE_FULL' );
                err.code = 'QUEUE_FULL';
                err.pressure = 1.0;
                metrics.errors += 1;
                metrics.lastError = err.code;
                setImmediate( cb, err );
                return;
            }

            // Ensure payload is a Buffer
            const payloadBuf = Buffer.isBuffer( packet.payload ) ?
                packet.payload :
                Buffer.from( packet.payload || [] );

            // Check byte pressure
            if ( metrics.totalBytes + payloadBuf.length > limits.maxQueueBytes ) {
                const err = new Error( 'STORAGE_FULL' );
                err.code = 'STORAGE_FULL';
                err.pressure = 1.0;
                metrics.errors += 1;
                metrics.lastError = err.code;
                setImmediate( cb, err );
                return;
            }

            // Separate metadata from payload
            const meta = {
                cmd: packet.cmd || 'publish',
                messageId: mid,
                topic: packet.topic,
                qos: packet.qos,
                retain: !!packet.retain,
                dup: !!packet.dup,
                properties: packet.properties || {},
                size: payloadBuf.length,
                ts: Date.now()
            };

            // **Optimistic increment** — increment metrics BEFORE the
            // async db.batch so `getPressure()` is accurate at the
            // call site. Without this, pressure lags the real
            // in-flight count by one db.batch cycle, and `publishNow`'s
            // pre-flight reject (`pressure >= 0.9`) can't keep mqtt.js
            // from overshooting the store cap. Empirically that lag
            // caused ~14 k of 50 k messages to be lost in sustained
            // burst tests. Rollback in the .catch path keeps
            // metrics consistent on failure.
            metrics.messageCount += 1;
            metrics.totalBytes += payloadBuf.length;

            // Atomic batch write
            db.batch( [
                { type: 'put', key: META + mid, value: meta, valueEncoding: 'json' },
                { type: 'put', key: PAYL + mid, value: payloadBuf, valueEncoding: 'buffer' }
            ] )
                .then( () => {
                    circuitBreaker.recordSuccess();
                    setImmediate( cb );
                } )
                .catch( ( err ) => {
                    // Rollback the optimistic increment — the message
                    // never landed in the store.
                    metrics.messageCount -= 1;
                    metrics.totalBytes -= payloadBuf.length;
                    metrics.errors += 1;
                    metrics.lastError = err.message;
                    circuitBreaker.recordFailure();
                    setImmediate( cb, err );
                } );
        },

        get: ( packet, cb ) => {
            const mid = packet && packet.messageId;
            if ( !mid ) {
                setImmediate( cb, null, null );
                return;
            }

            if ( !circuitBreaker.canAttempt() ) {
                setImmediate( cb, new Error( 'Store circuit breaker OPEN' ) );
                return;
            }

            // Normalise driver missing-key shape inline (header design
            // decision 6):
            // `undefined` from the resolve path AND `LEVEL_NOT_FOUND`
            // from the catch path are both treated as "not present".
            // Inline rather than helper-wrapped to avoid an extra Promise
            // allocation per call on the hot path.
            Promise.all( [
                db.get( META + mid, { valueEncoding: 'json' } ),
                db.get( PAYL + mid, { valueEncoding: 'buffer' } )
            ] )
                .then( ( [ meta, payload ] ) => {
                    if ( meta === undefined ) {
                        circuitBreaker.recordSuccess();
                        setImmediate( cb, null, null );
                        return;
                    }
                    // Payload may be `undefined` for orphaned meta — leave
                    // the field unset; mqtt.js tolerates it.
                    if ( payload !== undefined ) meta.payload = payload;
                    circuitBreaker.recordSuccess();
                    setImmediate( cb, null, meta );
                } )
                .catch( ( err ) => {
                    if ( err && err.code === ERR_LEVEL_NOT_FOUND ) {
                        circuitBreaker.recordSuccess();
                        setImmediate( cb, null, null );
                        return;
                    }
                    circuitBreaker.recordFailure();
                    setImmediate( cb, err );
                } );
        },

        del: ( packet, cb ) => {
            const mid = packet && packet.messageId;
            if ( !mid ) {
                setImmediate( cb );
                return;
            }

            // Read meta first (for size accounting), then batch-delete
            // both keys. Missing meta ⇒ idempotent no-op. Driver shape
            // normalised inline (header design decision 6) — `undefined`
            // resolve and
            // `LEVEL_NOT_FOUND` throw are both treated as "not present".
            //
            // **Optimistic decrement** — symmetric with put()'s
            // optimistic increment. Updates metrics BEFORE the async
            // db.batch so `getPressure()` reflects the impending
            // del() call site. Rollback in the .catch path keeps
            // metrics consistent on failure.
            db.get( META + mid, { valueEncoding: 'json' } )
                .then( ( meta ) => {
                    if ( meta === undefined ) {
                        circuitBreaker.recordSuccess();
                        setImmediate( cb );
                        return undefined;
                    }
                    const decBytes = meta.size || 0;
                    metrics.messageCount = Math.max( 0, metrics.messageCount - 1 );
                    metrics.totalBytes = Math.max( 0, metrics.totalBytes - decBytes );
                    return db.batch( [
                        { type: 'del', key: META + mid },
                        { type: 'del', key: PAYL + mid }
                    ] ).then( () => {
                        circuitBreaker.recordSuccess();
                        setImmediate( cb );
                    } ).catch( ( err ) => {
                        // Rollback the optimistic decrement — the
                        // delete didn't actually land.
                        metrics.messageCount += 1;
                        metrics.totalBytes += decBytes;
                        throw err;
                    } );
                } )
                .catch( ( err ) => {
                    if ( err && err.code === ERR_LEVEL_NOT_FOUND ) {
                        circuitBreaker.recordSuccess();
                        setImmediate( cb );
                        return;
                    }
                    circuitBreaker.recordFailure();
                    setImmediate( cb, err );
                } );
        },

        createStream: () => {
            let iterator = null;

            const stream = new Readable( {
                objectMode: true,

                async read () {
                    try {
                        if ( !iterator ) {
                            iterator = db.iterator( {
                                gte: META,
                                lt: META + '\xFF',
                                valueEncoding: 'json'
                            } );
                        }

                        const result = await iterator.next();

                        if ( result === undefined ) {
                            this.push( null );
                            await iterator.close();
                            iterator = null;
                            return;
                        }

                        const [ key, meta ] = result;
                        const mid = key.slice( META.length );

                        // Driver missing-key shape normalised inline
                        // (header design decision 6) — `undefined`
                        // resolve and `LEVEL_NOT_FOUND` throw both fall
                        // back to an empty payload.
                        let payload;
                        try {
                            payload = await db.get( PAYL + mid, { valueEncoding: 'buffer' } );
                        } catch ( err ) {
                            if ( err && err.code !== ERR_LEVEL_NOT_FOUND ) {
                                this.destroy( err );
                                return;
                            }
                            payload = undefined;
                        }
                        meta.payload = payload === undefined ? EMPTY_PAYLOAD : payload;
                        meta.dup = true;
                        this.push( meta );
                    } catch ( err ) {
                        this.destroy( err );
                    }
                },

                async destroy ( err, callback ) {
                    if ( iterator ) {
                        try {
                            await iterator.close();
                        } catch ( closeErr ) { // eslint-disable-line no-unused-vars
                            // Ignore close errors
                        }
                    }
                    callback( err );
                }
            } );

            return stream;
        },

        close: ( cb ) => {
            // Idempotent: mqtt.js's `closeStores` calls us during
            // `client.end()`, AND the emitter's shutdown path may call
            // us again. Double-closing a LevelDB triggers "Database is
            // not open" errors that surface as phantom DELIVERY_FAILED
            // on every in-flight publish. Short-circuit subsequent calls.
            if ( closed ) {
                if ( cb ) setImmediate( cb );
                return;
            }
            closed = true;
            db.close()
                .then( () => cb && cb() )
                .catch( ( err ) => cb && cb( err ) );
        }
    };

    /**
     * Get current pressure (0.0 to 1.0)
     */
    const getPressure = function () {
        const countPressure = Math.min( 1.0, metrics.messageCount / limits.maxQueueSize );
        const bytePressure = Math.min( 1.0, metrics.totalBytes / limits.maxQueueBytes );
        return Math.max( countPressure, bytePressure );
    };

    /**
     * Get health status
     */
    const getHealthStatus = function () {
        if ( circuitBreaker.state === 'OPEN' ) {
            return 'CRITICAL';
        }

        const pressure = getPressure();
        if ( pressure > QUEUE_CRITICAL_THRESHOLD ) {
            return 'RED';
        } else if ( pressure > 0.5 ) {
            return 'YELLOW';
        }
        return 'GREEN';
    };

    return {
        store,
        getPressure,
        getHealthStatus,
        getMetrics: () => ( { ...metrics } ),
        getCircuitState: () => circuitBreaker.state,
        db
    };
}; // createMQTTStore()
