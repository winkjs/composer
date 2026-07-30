// core/source-manager/csv/index.js

/**
 * @fileoverview CSV Source Adapter.
 *
 * Streams a CSV file row by row to the pipeline. Each row becomes one
 * message. Useful for replaying recorded data through a flow under test
 * conditions, or for one-shot batch jobs that consume a file and stop.
 *
 * Adapter contract (ADR-018):
 * - Module-level exports: `id`, `configSchema`, `start`,
 *   `durabilityClass`, and the default aggregate referencing the same
 *   constants.
 * - `start( config )` returns a `stopFn({ timeout })`.
 * - Lifecycle and error contract details: see `start.js` file header.
 *
 * Durability (ADR-018): `'best-effort'` — the source keeps no recovery state
 * of its own. The file itself is replayable, so a caller can re-run the
 * stream after a crash, but the adapter does not resume mid-file.
 *
 * `configSchema` declares the user-supplied config fields. The flow
 * runtime calls `validateWithSchema( csv.configSchema, sourceConfig )`
 * at DSL time (in `flow.source()`), so typos and bad types are caught
 * before the flow ever runs. Per ADR-018 the schema is authoritative
 * for the fields it covers; `start.js` does not re-enforce them.
 *
 * Runtime-injected callbacks (`onMessage`, `onShutdown`) are not part
 * of `configSchema` — they are added to the config by the wiring layer
 * at start time, not by the user.
 *
 * @example
 *   import { flow, csv } from '@winkjs/composer';
 *
 *   flow( 'demo' )
 *       .source( csv, {
 *           path: './sensor-data.csv',
 *           delayMs: 100
 *       } )
 *       .run();
 */

import { validators } from '../../utils/validate/index.js';
import { start } from './start.js';

/**
 * Source identifier — used by the flow registry and error messages.
 * @type {string}
 */
export const id = 'csv';

/**
 * Crash-survival class per ADR-018. For a source the value describes
 * the input it can recover after a disconnect: CSV recovers nothing
 * itself — the caller replays the file.
 * @type {string}
 */
export const durabilityClass = 'best-effort';

/**
 * Validates that a value is either a number or a non-empty string.
 * Used by `startMsgId` and `endMsgId`, which accept either an index
 * (number) or a row-id field value (typically a string).
 *
 * @param {*} value
 * @returns {boolean}
 */
const isNumberOrNonEmptyString = function ( value ) {
    if ( typeof value === 'number' && Number.isFinite( value ) ) return true;
    if ( typeof value === 'string' && value.length > 0 ) return true;
    return false;
};

/**
 * Schema for the CSV source's user-supplied config. Consumed by the
 * flow runtime (`flow.source()` → `validateWithSchema`) at DSL time.
 *
 * Required:
 * - `path` — file system path to the CSV file.
 *
 * Optional:
 * - `delayMs` — pause between messages, in milliseconds. Default 0.
 * - `dynamicTyping` — auto-cast values to numbers / booleans / null.
 *   Default true.
 * - `transform` — function( row ) → row, applied before `onMessage`;
 *   returning null/undefined drops the row (counted in `skipped`).
 *   A throw skips that one row with a per-record CALLBACK_FAILED
 *   report and the stream continues. Uniform with the MQTT source.
 * - `onStatus` — observability callback (the ADR-018 status shape).
 *   Completion arrives here as `{phase: 'complete', count, skipped}` —
 *   the retired `onComplete` key is rejected as unknown (completion
 *   travels onStatus per ADR-018).
 * - `shutdownOnComplete` — whether the source signals end-of-stream by
 *   triggering pipeline shutdown. Default true. (Inside a flow, the
 *   runtime overrides this to false and orchestrates the ordered drain
 *   itself; the option serves direct callers — ADR-018's flow-layer split.)
 * - `idField` — column name to use for `startMsgId` / `endMsgId`
 *   matching. When omitted, the row index (0-based) is used.
 * - `startMsgId`, `endMsgId` — inclusive range bounds. Number when
 *   matching against the row index; string when matching against an
 *   `idField` value.
 *
 * @type {Object}
 */
export const configSchema = {
    // Unknown keys throw at DSL time — the only unknown-key rejection
    // mechanism the validator has (validate.js:68-77). onMessage and
    // onShutdown are runtime-injected, so they are deliberately absent.
    _propertyNames: [
        'path',
        'delayMs',
        'dynamicTyping',
        'transform',
        'onStatus',
        'shutdownOnComplete',
        'idField',
        'startMsgId',
        'endMsgId'
    ],
    path: {
        type: 'string',
        required: true,
        validator: validators.nonEmptyString,
        error: 'path must be a non-empty string (file system path to the CSV file)'
    },
    delayMs: {
        type: 'number',
        required: false,
        validator: validators.nonNegativeFinite,
        error: 'delayMs must be a non-negative finite number'
    },
    dynamicTyping: {
        type: 'boolean',
        required: false,
        error: 'dynamicTyping must be a boolean'
    },
    transform: {
        type: 'function',
        required: false,
        error: 'transform must be a function( row ) returning a row (or null/undefined to drop)'
    },
    onStatus: {
        type: 'function',
        required: false,
        error: 'onStatus must be a function'
    },
    shutdownOnComplete: {
        type: 'boolean',
        required: false,
        error: 'shutdownOnComplete must be a boolean'
    },
    idField: {
        type: 'string',
        required: false,
        validator: validators.nonEmptyString,
        error: 'idField must be a non-empty string (CSV column name)'
    },
    startMsgId: {
        required: false,
        validator: isNumberOrNonEmptyString,
        error: 'startMsgId must be a finite number or a non-empty string'
    },
    endMsgId: {
        required: false,
        validator: isNumberOrNonEmptyString,
        error: 'endMsgId must be a finite number or a non-empty string'
    }
};

export { start };

export default { id, configSchema, durabilityClass, start };
