// core/emitter-manager/terminal/test/assert-columns.specs.js

/**
 * @fileoverview Unit tests for terminal's column-fact assertions.
 *
 * Covers every branch of `assertColumnFacts`:
 * - happy path (mixed types, resolution present and absent)
 * - non-float64 columns with resolution: ignored (no throw)
 * - missing column.type with resolution: ignored (no throw)
 * - float64 column with no resolution: passthrough OK
 * - float64 column with valid resolution: OK
 * - float64 column with zero / negative / NaN / Infinity / string
 *   resolution: throws INVALID_CONFIG
 * - null / non-object column entry: skipped defensively (no throw)
 * - empty / absent columns map: no-op (no throw)
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { assertColumnFacts } from '../assert-columns.js';

describe( 'assertColumnFacts (terminal)', function () {

    describe( 'happy path', function () {

        it( 'accepts a mixed-type column map with valid resolutions', function () {
            const columns = {
                ts: { type: 'timestamp' },
                pressure: { type: 'float64', resolution: 0.1 },
                motorRpm: { type: 'int64' },
                isRunning: { type: 'bool' },
                label: { type: 'string' }
            };

            expect( () => assertColumnFacts( columns ) ).to.not.throw();
        } );

        it( 'accepts float64 columns without declared resolution (passthrough)', function () {
            // Same shape as QDB: absent resolution means "use the global
            // precision". The assertion only fires when resolution is
            // PRESENT and invalid.
            const columns = {
                temp: { type: 'float64' }
            };

            expect( () => assertColumnFacts( columns ) ).to.not.throw();
        } );

        it( 'accepts an empty columns map', function () {
            expect( () => assertColumnFacts( {} ) ).to.not.throw();
        } );

        it( 'accepts a null columns argument (defensive)', function () {
            // Defensive: terminal might receive an asset class with no
            // columns property in some edge case; we no-op rather than
            // crash on a `.keys` access.
            expect( () => assertColumnFacts( null ) ).to.not.throw();
            expect( () => assertColumnFacts( undefined ) ).to.not.throw();
        } );

        it( 'ignores resolution on non-float64 columns', function () {
            // Resolution only applies to float64 quantization; on other
            // types it is dead weight, not a hard error. The column is
            // still usable for display.
            const columns = {
                count: { type: 'int64', resolution: 'silly value' },
                label: { type: 'string', resolution: -5 }
            };

            expect( () => assertColumnFacts( columns ) ).to.not.throw();
        } );

        it( 'ignores resolution on columns with no type field', function () {
            // Same reasoning: terminal does not require columns to have
            // a type (unlike QDB). Resolution without type is dead
            // weight; we do not throw.
            const columns = {
                mystery: { resolution: 0.1 }
            };

            expect( () => assertColumnFacts( columns ) ).to.not.throw();
        } );

    } );

    describe( 'invalid resolution on float64 columns', function () {

        it( 'throws INVALID_CONFIG when resolution is zero', function () {
            const columns = {
                pressure: { type: 'float64', resolution: 0 }
            };
            let thrown;

            try {
                assertColumnFacts( columns );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
            expect( thrown.message ).to.include( 'column \'pressure\'' );
            expect( thrown.message ).to.include( 'resolution' );
            expect( thrown.message ).to.include( 'positive finite number' );
        } );

        it( 'throws when resolution is negative', function () {
            const columns = {
                pressure: { type: 'float64', resolution: -0.1 }
            };
            let thrown;

            try {
                assertColumnFacts( columns );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        } );

        it( 'throws when resolution is NaN', function () {
            const columns = {
                pressure: { type: 'float64', resolution: NaN }
            };
            let thrown;

            try {
                assertColumnFacts( columns );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        } );

        it( 'throws when resolution is Infinity', function () {
            const columns = {
                pressure: { type: 'float64', resolution: Infinity }
            };
            let thrown;

            try {
                assertColumnFacts( columns );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        } );

        it( 'throws when resolution is a string', function () {
            const columns = {
                pressure: { type: 'float64', resolution: '0.1' }
            };
            let thrown;

            try {
                assertColumnFacts( columns );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        } );

        it( 'throws on the first violation (does not enumerate every gap)', function () {
            const columns = {
                first: { type: 'float64', resolution: 0 },
                second: { type: 'float64', resolution: -1 }
            };
            let thrown;

            try {
                assertColumnFacts( columns );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.message ).to.include( 'column \'first\'' );
            expect( thrown.message ).to.not.include( 'column \'second\'' );
        } );

    } );

    describe( 'defensive shape handling', function () {

        it( 'skips a null column entry without throwing', function () {
            const columns = {
                bad: null,
                good: { type: 'float64', resolution: 0.1 }
            };

            expect( () => assertColumnFacts( columns ) ).to.not.throw();
        } );

        it( 'skips a non-object column entry without throwing', function () {
            const columns = {
                bad: 'not an object',
                good: { type: 'float64', resolution: 0.1 }
            };

            expect( () => assertColumnFacts( columns ) ).to.not.throw();
        } );

    } );

} );
