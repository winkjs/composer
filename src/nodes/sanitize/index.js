/**
 * @fileoverview Sanitize Node - Universal data validation gate
 *
 * Validates data through configurable checks and maps invalid values to NaN.
 * This provides a universal invalid marker that downstream nodes can detect
 * with the fast check: value !== value
 *
 * Features:
 * - Range validation with per-parameter bounds
 * - Value list validation with allow/deny modes
 * - Custom predicate validation
 * - Works with both numeric and categorical data
 *
 * Configuration:
 * - ranges: Object mapping field names to {min, max} bounds
 * - valueList: Array of values to check against
 * - containsValidValues: false = deny list (default), true = allow list
 * - predicate: Optional function(value, msg) returning boolean
 *
 * Usage Examples:
 *
 * // Range validation (single field)
 * .sanitize('temperature', {
 *     ranges: {
 *         temperature: { min: -40, max: 150 }
 *     }
 * })
 *
 * // Multi-field with apply pattern
 * .sanitize('sensors', ['temperature', 'pressure', 'flow'], ['sanitized'], {
 *     ranges: {
 *         temperature: { min: -40, max: 150 },
 *         pressure: { min: 0, max: 200 },
 *         flow: { min: 0, max: 1000 }
 *     }
 * })
 *
 * // Deny list (blacklist) - common error codes
 * .sanitize('signal', {
 *     valueList: [32767, -9999, "ERROR", "N/A"],
 *     containsValidValues: false
 * })
 *
 * // Allow list (whitelist) - valid states only
 * .sanitize('state', {
 *     valueList: ["RUNNING", "IDLE", "STOPPED"],
 *     containsValidValues: true
 * })
 *
 * // Custom validation with predicate
 * .sanitize('reading', {
 *     predicate: (value, msg) => value > msg.ambient
 * })
 *
 * // Combined validation (checks in order: range, valueList, predicate)
 * .sanitize('sensor', {
 *     ranges: {
 *         sensor: { min: 0, max: 100 }
 *     },
 *     valueList: [32767, -9999],
 *     containsValidValues: false,
 *     predicate: (value, msg) => value !== msg.lastValue
 * })
 *
 * Failure Reporting:
 * - failureReason: 'range' | 'valueList' | 'predicate' | null
 * - failedValue: The value that failed validation
 *
 */

export { default as init } from './init.js';
export { default as update } from './update.js';
export { default as reset } from './reset.js';
export { default as recompute } from './recompute.js';
export { default as publishTo } from './publish-to.js';
// Direct imports for common control functions
export { default as disable } from '../../core/utils/node/disable.js';
export { default as enable } from '../../core/utils/node/enable.js';
export { default as pause } from '../../core/utils/node/pause.js';
export { default as unpause } from '../../core/utils/node/unpause.js';
// Re-export everything from introspection.js
export * from './introspect.js';
