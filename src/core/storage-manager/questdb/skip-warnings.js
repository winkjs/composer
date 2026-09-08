// core/storage-manager/questdb/skip-warnings.js

/**
 * @fileoverview How a skipped value is reported.
 *
 * The persist plan checks every value before a row opens. A value that
 * fails its check is skipped, and the skip is reported through
 * `onWarning`: a column skip lands the column as NULL, a bad designated
 * timestamp skips the whole row. This module builds the functions the
 * plan calls at those two sites. It owns the wording of the lines, the
 * default handler, and the bound on that default.
 *
 * Why the default is bounded (ADR-029, the same rule as the flush loss
 * line). A dead sensor publishes NaN in one column on every row. That
 * is one warning line per row for as long as the sensor is dead: one
 * line a second for a whole night, in a log nobody can read. So the
 * default handler is bounded per column. The first two skips of an
 * episode print in full. Later skips are counted, and one summary
 * line prints per minute with the count, the latest reason, and the
 * latest asset. A quiet minute on that column ends the episode. Rows
 * skipped for a bad designated timestamp share one bound per insight
 * type.
 *
 * The bound is on the default only. A user `onWarning` hears every
 * skip with the full line, because the flow chose to listen. A user
 * handler that throws is strict mode (ADR-027): the throw is the
 * instruction that rejects the row, so it must reach the plan
 * unchanged. Neither is bounded.
 *
 * Nothing here runs on the happy path. The plan calls a warning only
 * when a value failed its check, and a counted skip allocates nothing:
 * the line is rendered only when it prints.
 *
 * @see ADR-027
 * @see ADR-029
 */

import { createLineBound } from '../../utils/line-rate/index.js';
import { logger } from '../../logger/index.js';

/**
 * The bound on the default warning (see the file header). The values
 * match the flush loss line in flush-engine.js, so an operator reads
 * one rhythm.
 */
const FULL_WARNING_LINES_PER_EPISODE = 2;
const WARNING_SUMMARY_INTERVAL_MS = 60000;

/**
 * Default warning handler for invalid column values: one `logger.warn`
 * line in winkComposer format. The skip sites reach it through the
 * per-column line bound (see the file header), so under a streak it
 * prints the first two skips in full and then one summary per minute.
 *
 * Validation behavior:
 * - null/undefined columns: skip column only (QuestDB stores NULL)
 * - NaN/Infinity in numeric columns: skip column only (QuestDB stores NULL)
 * - Wrong-typed column values (e.g. a number where the column is string-typed):
 *   skip column only, never coerce — the warning names the expected and
 *   received types
 * - Invalid designatedTimestamp: skip entire row
 *
 * For strict mode (throw on any invalid), provide:
 *   { onWarning: (msg) => { throw new Error(msg); } }
 *
 * Future extension: return value may control skip-row vs skip-column behavior.
 *
 * @param {string} message - Warning message describing the issue
 */
const defaultOnWarning = function ( message ) {
    logger.warn( `winkComposer/questdb: ${message}` );
}; // defaultOnWarning()

/**
 * Builds the reason text for a value that failed its phase-1 acceptance
 * check. Called only on the rare skip path, so its allocations are
 * acceptable (same budget as the error returns in index.js).
 *
 * @param {*} rawValue - the rejected value
 * @param {boolean} isNumeric - whether the column type is numeric
 * @param {string} expectedType - declared column type, named in the message
 * @returns {string} plain reason text for the skip warning
 */
const skipReason = function ( rawValue, isNumeric, expectedType ) {
    if ( rawValue === null ) return 'null';
    if ( rawValue === undefined ) return 'undefined';
    if ( isNumeric && typeof rawValue === 'number' ) {
        if ( Number.isNaN( rawValue ) ) return 'NaN';
        // A finite number can only be rejected by the integer-required
        // types (int64/timestamp/designated timestamp) — float64 accepts
        // every finite number.
        return Number.isFinite( rawValue ) ? 'non-integer' : 'non-finite';
    }
    return `wrong-typed (expected ${expectedType}, received ${typeof rawValue})`;
}; // skipReason()

/**
 * Builds the warning function for one skip site. With a user
 * `onWarning`, every skip reaches it with the full line. With the
 * default, the line bound applies. Both renderers run only when a line
 * prints, so a counted skip allocates nothing.
 *
 * @param {Function|undefined} providedOnWarning - The user's handler, or undefined for the default
 * @param {Function} fullLine - `( rawValue, partitionId ) => string`, without the brand prefix
 * @param {Function} summaryLine - `( count, seconds, rawValue, partitionId ) => string`, without the brand prefix
 * @returns {Function} `( rawValue, partitionId ) => void`
 */
const makeSkipWarning = function ( providedOnWarning, fullLine, summaryLine ) {
    if ( providedOnWarning !== undefined ) {
        return function ( rawValue, partitionId ) {
            providedOnWarning( fullLine( rawValue, partitionId ) );
        };
    }
    return createLineBound( {
        fullLines: FULL_WARNING_LINES_PER_EPISODE,
        intervalMs: WARNING_SUMMARY_INTERVAL_MS,
        printFull: function ( rawValue, partitionId ) {
            defaultOnWarning( fullLine( rawValue, partitionId ) );
        },
        printSummary: function ( count, seconds, rawValue, partitionId ) {
            defaultOnWarning( summaryLine( count, seconds, rawValue, partitionId ) );
        }
    } );
}; // makeSkipWarning()

/**
 * Builds the skip warning for one column of one insight type.
 *
 * @param {Function|undefined} providedOnWarning - The user's handler, or undefined for the default
 * @param {string} insightTypeName - Named in every line
 * @param {string} columnName - The column the skip is about
 * @param {boolean} isNumeric - Whether the column type is numeric, for the reason text
 * @param {string} columnType - The declared column type, for the reason text
 * @returns {Function} `( rawValue, partitionId ) => void`
 */
const makeColumnWarning = function ( providedOnWarning, insightTypeName, columnName, isNumeric, columnType ) {
    return makeSkipWarning(
        providedOnWarning,
        ( rawValue, partitionId ) => (
            `column '${columnName}' is ${skipReason( rawValue, isNumeric, columnType )} ` +
            `in insightType '${insightTypeName}' (asset: ${partitionId}) — column skipped`
        ),
        ( count, seconds, rawValue, partitionId ) => (
            `column '${columnName}' skipped in ${count} more row(s) of insightType '${insightTypeName}' ` +
            `in the last ${seconds} s (latest: ${skipReason( rawValue, isNumeric, columnType )}, asset: ${partitionId})`
        )
    );
}; // makeColumnWarning()

/**
 * Builds the row-skip warning of one insight type, for a designated
 * timestamp that is missing or not an integer.
 *
 * @param {Function|undefined} providedOnWarning - The user's handler, or undefined for the default
 * @param {string} insightTypeName - Named in every line
 * @param {string} designatedTimestamp - The timestamp column, named in every line
 * @returns {Function} `( tsValue, partitionId ) => void`
 */
const makeRowWarning = function ( providedOnWarning, insightTypeName, designatedTimestamp ) {
    return makeSkipWarning(
        providedOnWarning,
        ( tsValue, partitionId ) => (
            `designatedTimestamp '${designatedTimestamp}' is ${skipReason( tsValue, true, 'timestamp' )} ` +
            `in insightType '${insightTypeName}' (asset: ${partitionId}) - row skipped`
        ),
        ( count, seconds, tsValue, partitionId ) => (
            `${count} more row(s) of insightType '${insightTypeName}' skipped for designatedTimestamp ` +
            `'${designatedTimestamp}' in the last ${seconds} s (latest: ${skipReason( tsValue, true, 'timestamp' )}, ` +
            `asset: ${partitionId})`
        )
    );
}; // makeRowWarning()

export {
    defaultOnWarning,
    makeColumnWarning,
    makeRowWarning,
    FULL_WARNING_LINES_PER_EPISODE,
    WARNING_SUMMARY_INTERVAL_MS
};
