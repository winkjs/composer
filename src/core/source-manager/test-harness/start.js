// core/source-manager/test-harness/start.js

/**
 * @fileoverview Synthetic source for end-to-end contract checks.
 *
 * testHarness invents messages on demand and feeds them to the
 * pipeline. It does not read from a file or a network — it is a
 * verification adapter, used by integration tests to push messages
 * through every sink and check that all sinks agree.
 *
 * Each generated message carries a running number `_harnessId` so
 * the cross-sink check tool can find the same message in every
 * sink, regardless of arrival order. Field values come from the
 * test author's `messageTemplate`. Tests can opt into a small set
 * of fuzz patterns that inject bad values every Nth message; with
 * fuzz on, the only check is "no adapter crashed".
 *
 * Adapter contract (ADR-018, source role):
 * - Every `onStatus` payload carries the uniform structured shape per
 *   ADR-018: `{status: 'green' | 'yellow' | 'red', connected,
 *   phase}`; the error path adds `error: {code, message}`. One payload
 *   rule, no exceptions (uniformity sweep, 2026-07-09).
 * - Lifecycle phases:
 *     `phase: 'starting'`   — harness is about to begin
 *     `phase: 'generating'` — first message about to be sent
 *     `phase: 'complete'`   — all messages sent (`connected: false`);
 *                             carries the uniform `count` of produced
 *                             messages (per ADR-018 there is no
 *                             onComplete callback)
 *     `phase: 'errored'`    — terminal red: the run loop failed and
 *                             generation stopped (the ADR-018 two-tier
 *                             rule)
 *     `phase: 'stopped'`    — yellow status when forced to stop
 *
 * `err.code` vocabulary (per-adapter, listed here per ADR-018):
 * - `INVALID_CONFIG`   — setup-time; bad messageTemplate or asset
 *                        class. Thrown synchronously from start().
 * - `GENERATOR_ERROR`  — runtime; a downstream `onMessage` call
 *                        threw inside the loop. Routed through
 *                        onStatus, not re-thrown. Narrowed by the
 *                        flow's dispatch guard (ADR-018): in a
 *                        flow, a pipeline fault is contained at the
 *                        flow's own chokepoint and reported as
 *                        MESSAGE_HANDLER_FAILED, so it never
 *                        reaches this loop. The code remains live
 *                        for direct callers of start() whose own
 *                        onMessage throws.
 * - `CALLBACK_FAILED`  — runtime; the user's `onStatus` itself threw
 *                        or rejected. The shared callback guard
 *                        contains the fault (ADR-018): generation
 *                        continues and each fault becomes one
 *                        classified console line. Fix the onStatus
 *                        handler; the line carries the fault detail.
 *
 * Design decisions date from 2026-04-29. The `messageTemplate` shape
 * is enforced at startup by `validate.js`; the per-field spec shape
 * is documented in `field-generator.js`.
 */

import { createPrng } from './prng.js';
import { generateField } from './field-generator.js';
import { applyFuzz, FUZZ_PATTERN_NAMES } from './fuzz.js';
import { validateMessageTemplate, validateAssetClass } from './validate.js';
import { wrapCallback } from '../../utils/callback-guard/index.js';
import { logger } from '../../logger/index.js';

/**
 * Console channel for the callback guard: one classified line in this
 * source's family. Receives an already-safe detail string, never the
 * raw thrown value.
 */
const reportCallbackFault = function ( severity, name, detail ) {
    logger.error( `winkComposer/testHarness: user callback ${name} failed [CALLBACK_FAILED]: ${detail}` );
}; // reportCallbackFault()

const DEFAULT_MESSAGE_COUNT = 1000;
const DEFAULT_INTERVAL_MS   = 0;
const DEFAULT_FUZZ_INTERVAL = 0;
const DEFAULT_STOP_TIMEOUT  = 5000;

/**
 * Starts the synthetic source.
 *
 * @param {Object}   config
 * @param {Object}   config.messageTemplate       - Required. Shape enforced by validate.js.
 * @param {Object}   config.assetClass            - Required. Must declare `_harnessId` as int64.
 * @param {Function} config.onMessage             - Required. Pipeline-injected handler.
 * @param {Function} [config.onStatus]            - Status callback (structured shape per ADR-018);
 *                                                  completion arrives as `{phase: 'complete', count}`.
 * @param {Function} [config.onShutdown]          - Pipeline shutdown hook (injected by runtime).
 * @param {boolean}  [config.shutdownOnComplete=true] - Auto-shutdown pipeline when generation ends.
 * @returns {Function} stopFn — accepts `{ timeout }`, returns Promise resolving when stopped.
 */
export const start = function ( config ) {
    const {
        messageTemplate,
        assetClass,
        onMessage,
        onStatus = null,
        onShutdown = null,
        shutdownOnComplete = true
    } = config;

    // Setup-time validation. Both throw INVALID_CONFIG on any
    // problem, listing every issue found.
    validateMessageTemplate( messageTemplate );
    validateAssetClass( assetClass );

    if ( typeof onMessage !== 'function' ) {
        const err = new Error( 'winkComposer/testHarness: onMessage must be a function' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    // The guard below turns a non-function into null (absent). So a
    // misconfigured handler must be rejected here, loudly, before the
    // wrap can silently erase it. Null stays legal as "no handler".
    if ( onStatus !== null && typeof onStatus !== 'function' ) {
        const err = new Error( 'winkComposer/testHarness: onStatus must be a function' );
        err.code = 'INVALID_CONFIG';
        throw err;
    }

    // Pull out template options with defaults.
    const seed         = messageTemplate.seed;
    const messageCount = messageTemplate.messageCount ?? DEFAULT_MESSAGE_COUNT;
    const intervalMs   = messageTemplate.intervalMs   ?? DEFAULT_INTERVAL_MS;
    const fuzzInterval = messageTemplate.fuzzInterval ?? DEFAULT_FUZZ_INTERVAL;
    const fuzzTarget   = messageTemplate.fuzzTarget   ?? null;
    const fields       = messageTemplate.fields;
    const fieldNames   = Object.keys( fields );

    // Stop / finished bookkeeping. `finished` resolves when the run
    // loop fully exits (success or error) — the stop function races
    // it against the timeout, mirroring CSV's shape (ADR-018).
    const prng = createPrng( seed );
    let stopped = false;
    let sentCount = 0;
    let resolveFinished;
    const finished = new Promise( ( resolve ) => {
        resolveFinished = resolve;
    } );

    // The user's onStatus is armed once by the shared callback guard
    // (ADR-018). A throw or rejection inside it becomes one classified
    // CALLBACK_FAILED console line, and generation continues. Absent
    // stays null, so the no-handler console fallback below keeps its
    // exact meaning.
    const safeOnStatus = wrapCallback( onStatus, {
        name: 'onStatus', severity: 'red', report: reportCallbackFault
    } );

    if ( safeOnStatus ) safeOnStatus( {
        status: 'green',
        connected: true,
        phase: 'starting',
        messageCount,
        fuzzInterval
    } );

    const run = async function () {
        if ( safeOnStatus ) safeOnStatus( {
            status: 'green',
            connected: true,
            phase: 'generating'
        } );

        for ( let i = 1; i <= messageCount; i += 1 ) {
            if ( stopped ) break;

            const msg = Object.create( null );
            msg._harnessId = i;  // eslint-disable-line no-underscore-dangle

            for ( const name of fieldNames ) {
                msg[ name ] = generateField( fields[ name ], prng, i, intervalMs );
            }

            // Fuzz: inject one bad value every Nth message.
            if ( fuzzInterval > 0 && i % fuzzInterval === 0 ) {
                const fuzzNumber = i / fuzzInterval;
                const patternIndex = ( fuzzNumber - 1 ) % FUZZ_PATTERN_NAMES.length;
                applyFuzz( msg, fuzzTarget, fields[ fuzzTarget ], patternIndex );
            }

            // eslint-disable-next-line no-await-in-loop -- Source must wait for the consumer before sending the next message; flooding the consumer would defeat the purpose of an integration check.
            await onMessage( msg );
            sentCount = i;

            if ( intervalMs > 0 && !stopped ) {
                // eslint-disable-next-line no-await-in-loop -- Paced send between messages is part of the contract for tests that exercise idle-flush timing.
                await new Promise( ( r ) => setTimeout( r, intervalMs ) );
            }
        }

        // Completion travels onStatus with the uniform `count` field
        // (per ADR-018 there is no onComplete callback).
        if ( safeOnStatus ) safeOnStatus( {
            status: 'green',
            connected: false,
            phase: 'complete',
            count: sentCount
        } );

        if ( shutdownOnComplete && onShutdown ) {
            await onShutdown();
        }
    };

    // Kick off. Failures inside the loop come from a downstream
    // onMessage handler (the harness itself has no transport that
    // can fail). Route through onStatus so the test sees the error
    // without losing it. Always resolve `finished` so stop() can
    // wait on it.
    run().catch( ( err ) => {
        const message = ( err && err.message ) ? err.message : String( err );
        if ( safeOnStatus ) {
            // Terminal red: generation stopped. Uniform payload with
            // phase 'errored' per the ADR-018 two-tier rule.
            safeOnStatus( {
                status: 'red',
                connected: false,
                phase: 'errored',
                error: { code: 'GENERATOR_ERROR', message }
            } );
        } else {
            logger.error( `winkComposer/testHarness: generator failed [GENERATOR_ERROR]: ${message}` );
        }
    } ).finally( () => {
        resolveFinished();
    } );

    // Stop function with `{ timeout }` symmetry per ADR-018.
    //
    // What it does:
    //  - Asks the loop to stop at the next message by setting `stopped`.
    //  - Waits for the loop to finish. If it finishes within `timeout`
    //    ms, the stop returns right away.
    //  - If the loop is stuck inside an `await onMessage(msg)` that
    //    never returns, the time budget runs out. The stop returns
    //    anyway so the rest of the shutdown can proceed.
    //  - When the budget runs out, sends a yellow status so callers
    //    can see the stop was forced rather than clean.
    //
    // The timer is `unref()`ed so it does not keep Node alive while
    // the loop is finishing in time.
    return function ( { timeout = DEFAULT_STOP_TIMEOUT } = {} ) {
        stopped = true;
        return new Promise( ( resolve ) => {
            let settled = false;
            let forceTimer = null;
            const settle = function () {

                /* c8 ignore next -- defensive: in normal lifecycle, settle is invoked exactly once (timer fires OR finished resolves; clean path clears the timer before it can fire). The guard protects against a race that requires both paths to fire concurrently, which has no producer in the current design. */
                if ( settled ) return;
                settled = true;
                if ( forceTimer ) clearTimeout( forceTimer );
                resolve();
            };
            forceTimer = setTimeout( () => {
                if ( safeOnStatus ) {
                    safeOnStatus( {
                        status: 'yellow',
                        connected: false,
                        phase: 'stopped',
                        note: `Stop took longer than ${timeout}ms — forced.`
                    } );
                }
                settle();
            }, timeout );
            forceTimer.unref();
            finished.then( settle, settle );
        } );
    };
};
