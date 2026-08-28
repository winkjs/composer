// core/source-manager/mqtt/status.js

/**
 * @fileoverview Health and metrics reporter for the MQTT source.
 *
 * One small state machine owns everything the source tells the
 * outside world. client.js maps mqtt.js events onto reporter calls
 * 1:1; the reporter decides what is worth emitting and in what shape.
 * Splitting it out keeps the transport wiring and the reporting rules
 * separately testable — the specs drive this module with an injected
 * clock and no MQTT client at all.
 *
 * What it emits, on which channel:
 * - `onStatus` — the ADR-018 core payload `{status, connected,
 *   phase}` with `error: {code, message}` on the error path, plus
 *   this adapter's additions: `msSinceLastMsg`, and `note` on a
 *   forced stop.
 *   Emitted on every state TRANSITION (a change of the status /
 *   phase / error-code tuple — repeats are suppressed, so a retry
 *   storm cannot flood the channel), and once PER RECORD for every
 *   decode failure and every transform throw (ADR-018: a skipped
 *   record is never silent).
 * - `onMetrics` (optional) — a fresh snapshot of the monotonic
 *   counters `{delivered, skipped, decodeErrors, reconnects,
 *   dedupHits, dedupMisses, dedupBypassed, dedupCacheSize}`, emitted
 *   on every tick() (the client's 1 Hz cadence) and on every health
 *   transition. Consumers diff snapshots; nothing is ever reset.
 *   `delivered` means handed to the flow: a message the pipeline
 *   later failed on still counts here. Failure visibility belongs
 *   to the flow's MESSAGE_HANDLER_FAILED reports (ADR-018), not to
 *   this counter.
 *
 * Health rules (evaluated on events and on tick):
 * - RED    — a subscribe failure (connected but deaf — no retry
 *            happens until the next reconnect, so waiting for
 *            repetition could wait forever); or disconnected for
 *            more than DISCONNECT_RED_MS (strictly greater).
 * - YELLOW — offline / reconnecting (the ADR-018 two-tier rule: the
 *            phase says the source is still alive); or a decode-error
 *            ratio above 1 % over the last DECODE_RING_SIZE messages
 *            (strictly greater); or, when `expectedQuietPeriodMs` is
 *            configured, no packet for longer than that.
 * - GREEN  — otherwise.
 * Precedence is the order above; the first rule that matches names
 * the code.
 *
 * Hot-path allocation profile (ADR-018 zero-alloc — allocation only where
 * unavoidable, each residual stated):
 * - Counter bumps, ring writes, and the health evaluation are plain
 *   integer work on pre-allocated state; no per-message allocation
 *   in our code.
 * - Payloads ARE allocated at emission — transitions (rare by
 *   construction), per-record decode reports (mandated by ADR-018), and
 *   metrics snapshots (1 Hz). Snapshots are fresh objects because a
 *   consumer may retain them; mutating a shared one under the
 *   caller's feet is a footgun we refuse.
 * - `nowFn()` (Date.now) runs once per received message to feed the
 *   quiet-period clock — the same transient boxing the dedup cache
 *   already documents.
 *
 * Callers without an `onStatus` handler still see error-path
 * payloads via a classified `console.error` line (the CSV source's
 * fallback pattern); lifecycle payloads stay quiet.
 *
 *   ASSUMPTIONS
 *   -----------
 *   1. All reporter calls come from one event loop (mqtt.js event
 *      handlers plus one interval) — there is no locking.
 *   2. The clock (`nowFn`) moves forward; the time rules use plain
 *      subtraction.
 *
 *   LIMITATIONS
 *   -----------
 *   1. Transition suppression keys on (status, phase, error code) —
 *      a repeat of the same tuple with a DIFFERENT message text is
 *      not re-emitted. Deliberate: the tuple is what a consumer acts
 *      on, and re-emitting per text would let a retry storm flood
 *      the channel.
 *   2. Counters are plain JS numbers: exact to 2^53. At one million
 *      messages per second that is ~285 years of uptime — not the
 *      binding constraint.
 *
 * @see src/core/source-manager/mqtt/client.js - The transport wiring
 * @see ADR-018 - lifecycle phases, status shapes, error codes
 */

import {
    DISCONNECT_RED_MS,
    DECODE_RING_SIZE
} from './constants.js';
import { wrapCallback } from '../../utils/callback-guard/index.js';

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Throws a classified INVALID_CONFIG error (ADR-018 error vocabulary)
 * when `value` is present but not a function.
 *
 * @param {*} value - Candidate value
 * @param {string} name - Field name for the error message
 */
const assertOptionalFunction = function ( value, name ) {
    if ( value !== undefined && value !== null && typeof value !== 'function' ) {
        const err = new Error( `WinkComposer/mqtt-source: ${name} must be a function` );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
};

// ============================================================================
// STATUS REPORTER FACTORY
// ============================================================================

/**
 * Create the source's status/metrics reporter.
 *
 * @param {Object} [options={}] - Reporter options
 * @param {function} [options.onStatus] - Structured status callback
 * @param {function} [options.onMetrics] - Counter-snapshot callback
 * @param {number} [options.expectedQuietPeriodMs] - Opt-in quiet rule:
 *   yellow when no packet arrives for longer than this
 * @param {function} [options.dedupSizeFn] - Live dedup-cache size read
 * @param {function} [options.nowFn=Date.now] - Clock source. Injection
 *   point for deterministic tests; production uses the default
 * @returns {Object} Reporter with lifecycle notes, hot-path counters,
 *   tick and snapshot
 */
const createStatusReporter = function ( options = {} ) {
    if ( typeof options !== 'object' || options === null ) {
        const err = new Error( 'WinkComposer/mqtt-source: status reporter options must be an object' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    const {
        onStatus = null,
        onMetrics = null,
        expectedQuietPeriodMs = null,
        dedupSizeFn = null,
        nowFn = Date.now
    } = options;

    assertOptionalFunction( onStatus, 'onStatus' );
    assertOptionalFunction( onMetrics, 'onMetrics' );
    assertOptionalFunction( dedupSizeFn, 'dedupSizeFn' );
    if ( typeof nowFn !== 'function' ) {
        const err = new Error( 'WinkComposer/mqtt-source: nowFn must be a function' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }
    if ( expectedQuietPeriodMs !== null &&
         ( typeof expectedQuietPeriodMs !== 'number' ||
           expectedQuietPeriodMs < 1 ||
           !Number.isInteger( expectedQuietPeriodMs ) ) ) {
        const err = new Error( 'WinkComposer/mqtt-source: expectedQuietPeriodMs must be a positive integer' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    // ── Connection & phase state ─────────────────────────────────────
    const startedAt = nowFn();
    let phase = 'starting';
    let connected = false;
    let disconnectedAt = startedAt;      // Outage clock; reset on each fresh disconnect
    let lastReceivedAt = startedAt;      // Any packet counts — even a duplicate
    let connectCount = 0;
    let subscribeFailed = false;
    let lastSubscribeError = null;
    let lastConnectError = null;

    // ── Monotonic counters (bumped inline, never reset) ──────────────
    let delivered = 0;
    let skipped = 0;
    let decodeErrors = 0;
    let reconnects = 0;
    let dedupHits = 0;
    let dedupMisses = 0;
    let dedupBypassed = 0;

    // ── Decode-outcome ring: last DECODE_RING_SIZE results ───────────
    // Pre-allocated once; 1 = decode failure, 0 = success.
    const ring = new Uint8Array( DECODE_RING_SIZE );
    let ringSum = 0;
    let ringIdx = 0;
    let ringCount = 0;

    // ── Emission de-duplication state ────────────────────────────────
    let lastStatus = null;
    let lastPhase = null;
    let lastCode = null;

    /**
     * Record one decode outcome in the ring.
     *
     * @param {number} isError - 1 for a decode failure, 0 for success
     */
    const ringPush = function ( isError ) {
        ringSum -= ring[ ringIdx ];
        ring[ ringIdx ] = isError;
        ringSum += isError;
        ringIdx = ( ringIdx + 1 ) % DECODE_RING_SIZE;
        if ( ringCount < DECODE_RING_SIZE ) {
            ringCount += 1;
        }
    };

    /**
     * Build a fresh counter snapshot. Fresh per call — consumers may
     * retain it.
     *
     * @returns {Object} Monotonic counters + live dedup cache size
     */
    const snapshot = function () {
        return {
            delivered,
            skipped,
            decodeErrors,
            reconnects,
            dedupHits,
            dedupMisses,
            dedupBypassed,
            dedupCacheSize: dedupSizeFn ? dedupSizeFn() : 0
        };
    };

    // Both user callbacks are armed by the shared callback guard —
    // validated raw above, wrapped here, once (ADR-018: a misbehaving
    // user callback never reaches transport code and never fails
    // silently). A broken onStatus reports to the console in this
    // adapter's classified line family; it cannot report through
    // itself. A broken onMetrics reports as a yellow payload through
    // emitStatus below — the channel every per-record fault already
    // uses — so a flow or dashboard sees it where it watches.
    const safeOnStatus = wrapCallback( onStatus, {
        name: 'onStatus',
        severity: 'red',
        report: function ( severity, name, detail ) {
            console.error( `MQTT source error [CALLBACK_FAILED]: user callback ${name} failed: ${detail}` );
        }
    } );

    /**
     * Route a status payload: to the caller's handler when supplied;
     * otherwise error-path payloads go to a classified console.error
     * (never silent — ADR-018's two-party rule) and lifecycle
     * payloads stay quiet.
     *
     * @param {Object} payload - The structured status payload
     */
    const emitStatus = function ( payload ) {
        if ( safeOnStatus ) {
            safeOnStatus( payload );
        } else if ( payload.error ) {
            console.error( `MQTT source error [${payload.error.code}]: ${payload.error.message}` );
        }
    };

    // The metrics fault payload allocates on the failure path only;
    // `connected` and `phase` read the reporter's live state at fault
    // time, so the report tells the truth about the moment it fired.
    const safeOnMetrics = wrapCallback( onMetrics, {
        name: 'onMetrics',
        severity: 'yellow',
        report: function ( severity, name, detail ) {
            emitStatus( {
                status: 'yellow',
                connected,
                phase,
                error: {
                    code: 'CALLBACK_FAILED',
                    message: `user callback ${name} failed: ${detail}`
                }
            } );
        }
    } );

    /**
     * Emit a metrics snapshot when the caller asked for one.
     */
    const emitMetrics = function () {
        if ( safeOnMetrics ) {
            safeOnMetrics( snapshot() );
        }
    };

    /**
     * The health rules, in precedence order. Returns the status and
     * leaves the matching code in `healthCode` (closure variable, so
     * the no-emission path allocates nothing).
     *
     * @param {number} now - Current timestamp
     * @returns {string} 'green' | 'yellow' | 'red'
     */
    let healthCode = null;
    const computeHealth = function ( now ) {
        healthCode = null;
        if ( phase === 'stopped' ) {
            return 'green';
        }
        if ( subscribeFailed ) {
            healthCode = 'SUBSCRIBE_FAILED';
            return 'red';
        }
        if ( !connected && ( ( now - disconnectedAt ) > DISCONNECT_RED_MS ) ) {
            healthCode = 'CONNECTION_LOST';
            return 'red';
        }
        if ( phase === 'offline' || phase === 'reconnecting' ) {
            healthCode = lastConnectError === null ? null : 'CONNECT_FAILED';
            return 'yellow';
        }
        if ( lastConnectError !== null ) {
            healthCode = 'CONNECT_FAILED';
            return 'yellow';
        }
        if ( ( ringSum * 100 ) > ringCount ) {
            healthCode = 'DECODE_ERROR';
            return 'yellow';
        }
        if ( expectedQuietPeriodMs !== null &&
             ( ( now - lastReceivedAt ) > expectedQuietPeriodMs ) ) {
            healthCode = 'QUIET_PERIOD_EXCEEDED';
            return 'yellow';
        }
        return 'green';
    };

    /**
     * Human message for a health code, built only at emission time.
     *
     * @param {string} code - The health code being emitted
     * @param {number} now - Current timestamp
     * @returns {string} Operator-facing message
     */
    const healthMessage = function ( code, now ) {
        if ( code === 'SUBSCRIBE_FAILED' ) {
            return lastSubscribeError;
        }
        if ( code === 'CONNECTION_LOST' ) {
            return `not connected for ${now - disconnectedAt}ms (red threshold ${DISCONNECT_RED_MS}ms)`;
        }
        if ( code === 'CONNECT_FAILED' ) {
            return lastConnectError;
        }
        if ( code === 'DECODE_ERROR' ) {
            return `decode-error ratio above 1% over the last ${ringCount} messages`;
        }
        // QUIET_PERIOD_EXCEEDED — the only code left.
        return `no message received for ${now - lastReceivedAt}ms (expected quiet period ${expectedQuietPeriodMs}ms)`;
    };

    /**
     * Re-derive health and emit ONE status (plus a metrics snapshot)
     * when the (status, phase, code) tuple changed. The no-change
     * path is allocation-free.
     */
    const evaluate = function () {
        const now = nowFn();
        const status = computeHealth( now );
        if ( status === lastStatus && phase === lastPhase && healthCode === lastCode ) {
            return;
        }
        lastStatus = status;
        lastPhase = phase;
        lastCode = healthCode;

        const payload = {
            status,
            connected,
            phase,
            msSinceLastMsg: now - lastReceivedAt
        };
        if ( healthCode !== null ) {
            payload.error = { code: healthCode, message: healthMessage( healthCode, now ) };
        }
        emitStatus( payload );
        emitMetrics();
    };

    return {
        // ── Lifecycle notes (each may emit one transition) ───────────

        /** Factory finished; the transport is coming up. */
        starting: function () {
            evaluate();
        },

        /** The transport connected. Counts re-connections; running
         *  is declared by subscribed(), not here. */
        connected: function () {
            connected = true;
            connectCount += 1;
            if ( connectCount > 1 ) {
                reconnects += 1;
            }
            lastConnectError = null;
        },

        /** Subscription acknowledged — the source is producing. */
        subscribed: function () {
            subscribeFailed = false;
            lastSubscribeError = null;
            phase = 'running';
            evaluate();
        },

        /**
         * Subscription refused. Red immediately: there is no retry
         * between reconnects, so a deaf-but-connected source would
         * stay deaf forever while looking healthy.
         *
         * @param {Error} err - The subscribe error
         */
        subscribeFailed: function ( err ) {
            subscribeFailed = true;
            lastSubscribeError = err.message;
            evaluate();
        },

        /** The transport dropped. Starts the outage clock; a stale
         *  subscribe failure died with the connection. */
        offline: function () {
            if ( connected ) {
                disconnectedAt = nowFn();
            }
            connected = false;
            subscribeFailed = false;
            lastSubscribeError = null;
            phase = 'offline';
            evaluate();
        },

        /** The library started a reconnect attempt. */
        reconnecting: function () {
            phase = 'reconnecting';
            evaluate();
        },

        /**
         * A transport-level error. Stored, not emitted directly —
         * evaluate() attaches it as CONNECT_FAILED, so a retry storm
         * of identical failures emits once.
         *
         * @param {Error} err - The transport error
         */
        connectError: function ( err ) {
            lastConnectError = err.message;
            evaluate();
        },

        /** Clean stop finished. */
        stopped: function () {
            if ( phase === 'stopped' ) {
                return;
            }
            phase = 'stopped';
            connected = false;
            evaluate();
        },

        /**
         * The stop's time budget ran out and the socket was forced
         * closed. Reported with the sources' shared `note` convention
         * (CSV and testHarness use the same wording).
         *
         * @param {number} timeoutMs - The exceeded budget
         */
        stopForced: function ( timeoutMs ) {
            phase = 'stopped';
            connected = false;
            const now = nowFn();
            lastStatus = 'yellow';
            lastPhase = 'stopped';
            lastCode = null;
            emitStatus( {
                status: 'yellow',
                connected: false,
                phase: 'stopped',
                msSinceLastMsg: now - lastReceivedAt,
                note: `Stop took longer than ${timeoutMs}ms — forced.`
            } );
            emitMetrics();
        },

        // ── Hot-path counters (integer bumps; no allocation) ─────────

        /** A duplicate was dropped. Still counts as arrival. */
        dupSkipped: function () {
            dedupHits += 1;
            skipped += 1;
            lastReceivedAt = nowFn();
            evaluate();
        },

        /** A message arrived with no dedup id — the cache was bypassed. */
        bypassed: function () {
            dedupBypassed += 1;
        },

        /** A fresh dedup id was accepted into the cache. */
        idAccepted: function () {
            dedupMisses += 1;
        },

        /** A payload decoded cleanly. Heals a stored transport error —
         *  data flowing is proof the transport works. */
        decodeOk: function () {
            lastReceivedAt = nowFn();
            lastConnectError = null;
            ringPush( 0 );
            evaluate();
        },

        /**
         * A payload could not be decoded. Emits the mandated
         * per-record report (ADR-018: skip, classify, continue — never
         * silent), then re-evaluates the ratio rule.
         *
         * @param {string} detail - Operator-facing description
         */
        decodeFailed: function ( detail ) {
            decodeErrors += 1;
            skipped += 1;
            lastReceivedAt = nowFn();
            ringPush( 1 );
            emitStatus( {
                status: 'yellow',
                connected,
                phase,
                msSinceLastMsg: 0,
                error: { code: 'DECODE_ERROR', message: detail }
            } );
            evaluate();
        },

        /** The user's transform returned null/undefined — dropped.
         *  An intentional drop, so it counts but does not report. */
        transformDropped: function () {
            skipped += 1;
        },

        /**
         * The user's transform threw. Emits the mandated per-record
         * report (skip, classify, continue — the transform contract,
         * source-transform-uniformity 2026-07-11), classified as
         * CALLBACK_FAILED: user code, never a transport failure. No
         * evaluate() — a transform throw feeds no health rule, so
         * there is no transition to re-derive.
         *
         * @param {string} detail - Operator-facing description
         */
        transformFailed: function ( detail ) {
            skipped += 1;
            emitStatus( {
                status: 'yellow',
                connected,
                phase,
                msSinceLastMsg: 0,
                error: { code: 'CALLBACK_FAILED', message: detail }
            } );
        },

        /** A message reached the pipeline's onMessage. */
        delivered: function () {
            delivered += 1;
        },

        // ── Cadence & introspection ──────────────────────────────────

        /** One heartbeat: re-check the time rules, emit metrics. */
        tick: function () {
            evaluate();
            emitMetrics();
        },

        snapshot
    };
};

// ============================================================================
// EXPORTS
// ============================================================================

export { createStatusReporter };
