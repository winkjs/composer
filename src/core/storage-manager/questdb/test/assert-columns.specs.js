// core/storage-manager/questdb/test/assert-columns.specs.js

/**
 * @fileoverview Unit tests for the QuestDB-side column-fact assertions.
 *
 * Covers every branch of `assertColumnFacts`:
 * - happy path (all columns valid)
 * - missing column.type → INVALID_CONFIG
 * - column.type not in DDL_TYPES → INVALID_CONFIG
 * - null/undefined column entry → INVALID_CONFIG with helpful message
 * - float64 column with resolution > 0 → passes
 * - float64 column with resolution undefined → passes (writer passthrough)
 * - float64 column with resolution = 0 / negative / non-finite / non-number
 *   → INVALID_CONFIG
 * - non-float64 columns: resolution is not checked (only float64 quantizes)
 * - empty columns object → no-op (nothing to walk)
 *
 * Tests the function in isolation so we don't have to drive every edge
 * case through the heavier `createStorage` path.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { assertColumnFacts } from '../assert-columns.js';

describe( 'assertColumnFacts', function () {

    // ========================================================================
    // HAPPY PATH
    // ========================================================================

    describe( 'happy path', function () {

        it( 'accepts a fully-formed asset class with mixed column types', function () {
            const assetClass = {
                columns: {
                    ts: { type: 'timestamp' },
                    pressure: { type: 'float64', resolution: 0.1 },
                    motorRpm: { type: 'int64' },
                    isRunning: { type: 'bool' },
                    label: { type: 'string' }
                }
            };

            expect( () => assertColumnFacts( assetClass ) ).to.not.throw();
        } );

        it( 'accepts float64 columns without declared resolution (passthrough)', function () {
            // Per writers.js:54 — undefined resolution is treated the same
            // as resolution=1: no quantization, write the value as-is.
            // This is intentional behaviour, not a bug; the assertion
            // must allow it.
            const assetClass = {
                columns: {
                    temp: { type: 'float64' }
                }
            };

            expect( () => assertColumnFacts( assetClass ) ).to.not.throw();
        } );

        it( 'accepts an empty columns object', function () {
            // Edge case: an asset class with no columns is structurally
            // unusual but the assertion has nothing to walk. No-op, no
            // throw. The semantics schema rejects this earlier; we are
            // defensive here, not opinionated.
            const assetClass = { columns: {} };

            expect( () => assertColumnFacts( assetClass ) ).to.not.throw();
        } );

        it( 'tolerates columns absent on assetClass (treats as empty)', function () {
            // Defensive: if someone passes an asset class with no `columns`
            // property at all, we walk an empty Object.create(null) rather
            // than crashing on `.columns` access.
            const assetClass = {};

            expect( () => assertColumnFacts( assetClass ) ).to.not.throw();
        } );

    } );

    // ========================================================================
    // TYPE VIOLATIONS
    // ========================================================================

    describe( 'invalid or missing type', function () {

        it( 'throws INVALID_CONFIG when a column has no type', function () {
            const assetClass = {
                columns: {
                    mystery: { description: 'no type set' }
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.message ).to.include( 'column \'mystery\'' );
            expect( thrown.message ).to.include( 'invalid or missing type' );
        } );

        it( 'throws INVALID_CONFIG when type is not a key in DDL_TYPES', function () {
            // QuestDB knows how to write float64/int64/bool/string/timestamp.
            // A type semantics knows about but QuestDB does not (e.g.,
            // a future 'float32') would silently coerce to VARCHAR via
            // ensure-tables.js's getDDLType() fallback. This catches it.
            const assetClass = {
                columns: {
                    sensor: { type: 'float32' }
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.message ).to.include( 'column \'sensor\'' );
            expect( thrown.message ).to.include( 'type \'float32\'' );
            expect( thrown.message ).to.include( 'expected one of:' );
        } );

        it( 'throws when a column entry is null', function () {
            // Defensive: caller bug, but we surface it clearly rather
            // than crashing on a null-property access.
            const assetClass = {
                columns: {
                    bad: null
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.message ).to.include( 'column \'bad\'' );
        } );

        it( 'throws when a column entry is undefined', function () {
            const assetClass = {
                columns: {
                    bad: undefined
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        } );

        it( 'throws on the FIRST violation (does not enumerate every gap)', function () {
            // Two bad columns; assertion reports the first one and stops.
            // Same fail-fast pattern as assertHandle. Caller fixes the
            // first error and rediscovers the second on rerun if it still
            // exists.
            const assetClass = {
                columns: {
                    first: { type: 'unknownType' },
                    second: { type: 'alsoUnknown' }
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.message ).to.include( 'column \'first\'' );
            expect( thrown.message ).to.not.include( 'column \'second\'' );
        } );

    } );

    // ========================================================================
    // RESOLUTION VIOLATIONS (float64 only)
    // ========================================================================

    describe( 'float64 resolution', function () {

        it( 'throws INVALID_CONFIG when float64 resolution is zero', function () {
            // invResolution = 1 / 0 = Infinity → every value would multiply
            // to Infinity then round to Infinity. Silent corruption.
            const assetClass = {
                columns: {
                    pressure: { type: 'float64', resolution: 0 }
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.message ).to.include( 'column \'pressure\'' );
            expect( thrown.message ).to.include( 'resolution' );
            expect( thrown.message ).to.include( 'positive finite number' );
        } );

        it( 'throws when float64 resolution is negative', function () {
            const assetClass = {
                columns: {
                    pressure: { type: 'float64', resolution: -0.1 }
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.message ).to.include( 'column \'pressure\'' );
            expect( thrown.message ).to.include( 'resolution is \'-0.1\'' );
        } );

        it( 'throws when float64 resolution is NaN', function () {
            // typeof NaN === 'number', so the typeof check passes; but
            // Number.isFinite(NaN) === false catches it.
            const assetClass = {
                columns: {
                    pressure: { type: 'float64', resolution: NaN }
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        } );

        it( 'throws when float64 resolution is Infinity', function () {
            const assetClass = {
                columns: {
                    pressure: { type: 'float64', resolution: Infinity }
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        } );

        it( 'throws when float64 resolution is a string', function () {
            // No silent coercion — '0.1' looks like a number to a casual
            // reader but is a different type and we'd be tolerating sloppy
            // data shape if we accepted it.
            const assetClass = {
                columns: {
                    pressure: { type: 'float64', resolution: '0.1' }
                }
            };
            let thrown;

            try {
                assertColumnFacts( assetClass );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        } );

        it( 'allows non-float64 columns to have any resolution value (it is ignored)', function () {
            // The check is conditional on type === 'float64' because only
            // the float64 writer reads resolution. Other types may carry
            // a resolution field for other purposes (e.g., display
            // hinting); we don't enforce QDB-specific rules on it.
            const assetClass = {
                columns: {
                    label: { type: 'string', resolution: 'silly value' },
                    count: { type: 'int64', resolution: -5 }
                }
            };

            expect( () => assertColumnFacts( assetClass ) ).to.not.throw();
        } );

    } );

} );
