// core/source-manager/test-harness/index.js

/**
 * @fileoverview testHarness Source Adapter.
 *
 * A synthetic source used by integration tests to push messages
 * through every sink and check that all sinks agree. The harness
 * does not read from a file or a network — it invents messages on
 * demand from a test-author-supplied `messageTemplate`.
 *
 * Each generated message carries a running number `_harnessId` so
 * the cross-sink check tool can match the same message in every
 * sink, regardless of arrival order.
 *
 * Built native to ADR-018's source role — same
 * `stopFn({ timeout })` shape as CSV and MQTT sources, structured
 * `onStatus` lifecycle phases, classified `err.code` on setup
 * throws (`INVALID_CONFIG`). Module exports follow the contract: `id`,
 * `configSchema`, `start`, `durabilityClass`, and the default
 * aggregate referencing the same constants.
 *
 * Durability (ADR-018): `'best-effort'` — the harness keeps no recovery
 * state; a crashed run is simply re-generated (same seed, same
 * messages).
 *
 * @example
 *   import { flow, testHarness } from '@winkjs/composer';
 *
 *   const assetClass = {
 *       columns: {
 *           _harnessId:  { type: 'int64' },
 *           temperature: { type: 'float64', resolution: 0.01 }
 *       }
 *   };
 *
 *   flow( 'check' )
 *       .assetClass( assetClass )
 *       .source( testHarness, {
 *           messageTemplate: {
 *               seed: 42,
 *               messageCount: 100,
 *               fields: {
 *                   temperature: { type: 'float64', range: [ 20, 30 ], resolution: 0.01 }
 *               }
 *           },
 *           assetClass
 *       } )
 *       .run();
 */

import { start } from './start.js';
import { MESSAGE_TEMPLATE_SCHEMA, ASSET_CLASS_SCHEMA } from './validate.js';

/**
 * Source identifier — used by the flow runtime for lookup.
 * @type {string}
 */
export const id = 'testHarness';

/**
 * Crash-survival class per ADR-018. For a source the value describes
 * the input it can recover after a disconnect: the harness recovers
 * nothing — a crashed run is re-generated deterministically.
 * @type {string}
 */
export const durabilityClass = 'best-effort';

/**
 * Schema for the harness's public config — the `messageTemplate`
 * and `assetClass` it accepts, plus the caller-suppliable `onStatus`
 * and `shutdownOnComplete`. Exposed for DSL-time validation.
 *
 * `_propertyNames` rejects unknown keys at DSL time (the validator's
 * only unknown-key mechanism, validate.js:68-77) — added by the
 * 2026-07-09 uniformity sweep. The retired `onComplete` key is
 * rejected here: completion travels `onStatus` as
 * `{phase: 'complete', count}` per ADR-018. Runtime-injected
 * callbacks (`onMessage`, `onShutdown`) are deliberately absent.
 *
 * The harness's runtime entry (`start`) re-validates with
 * `validateMessageTemplate` and `validateAssetClass` so any
 * problem fails at startup with classified `err.code`.
 */
export const configSchema = {
    _propertyNames: [
        'messageTemplate',
        'assetClass',
        'onStatus',
        'shutdownOnComplete'
    ],
    messageTemplate: {
        type: 'object',
        required: true,
        properties: MESSAGE_TEMPLATE_SCHEMA
    },
    assetClass: {
        type: 'object',
        required: true,
        properties: ASSET_CLASS_SCHEMA
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
    }
};

export { start };

export default { id, configSchema, durabilityClass, start };
