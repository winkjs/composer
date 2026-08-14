// src/composer.js

/**
 * @fileoverview Main entry point for @winkjs/composer.
 *
 * Provides flat exports for the DSL, source adapters, emitter adapters,
 * codecs, and tunable helpers.
 *
 * @example
 * import { flow, csv, mqttEmitter } from '@winkjs/composer';
 *
 * flow('myPipeline')
 *     .sanitize(...)
 *     .threshold(...)
 *     .source(csv, { path: './data.csv' })
 *     .emitter(mqttEmitter, { brokerUrl: 'mqtt://localhost' })
 *     .run();
 */

// DSL
export { flow } from './flow/flow.js';

// Headless driver — feed a flow that has no source (see docs/handbook/headless-flow.md)
export { headlessDriver } from './flow/driver.js';

// Emitters
export * as mqttEmitter from './core/emitter-manager/mqtt/index.js';
export * as terminal from './core/emitter-manager/terminal/index.js';

// Sources
export * as csv from './core/source-manager/csv/index.js';
export * as mqttSource from './core/source-manager/mqtt/index.js';

// Storage
export { default as questdbAdapter } from './core/storage-manager/questdb/index.js';

// Semantics
export { loadSemantics } from './core/semantics/loader.js';

// Codecs
export { jsonCodec, msgpackCodec } from './core/codec/index.js';

// Tunable helpers
export {
    lookupByField,
    pickByField,
    scaleBy,
    chooseWhen,
    clampTo,
    fromField,
    offsetBy
} from './core/tunable/helpers.js';

// Transform helpers
export {
    square,
    abs,
    sqrt,
    log,
    log10,
    reciprocal,
    negate
} from './nodes/transform/helpers.js';

// Training utilities
export {
    computeStandardParams,
    computeMinMaxParams,
    computeRobustParams,
    scale,
    standardize
} from './tools/training/scale.js';
export { sigmoid, train, predict, classify } from './tools/training/logistic.js';
export { confusionMatrix, classificationMetrics, sweepThresholds } from './tools/training/metrics.js';

// Stream-preparation utilities — ready-made functions for a source's
// `transform` option (see docs/handbook/stream-preparation.md)
export { coerceNumeric, coerceCell } from './tools/stream-prep/coerce-numeric.js';
export { normalizeTimestamp } from './tools/stream-prep/normalize-timestamp.js';
export { filterRows } from './tools/stream-prep/filter-rows.js';
export { labelShift, shiftLabelFor } from './tools/stream-prep/label-shift.js';
export { trackActivity } from './tools/stream-prep/track-activity.js';
export { stampPeriod } from './tools/stream-prep/stamp-period.js';

