// core/emitter-manager/terminal/test/terminal-emitter.specs.js

/**
 * @fileoverview Functional tests for terminal emitter.
 *
 * Tests cover:
 * - Compact and verbose output modes
 * - Number formatting (integers, decimals, scientific)
 * - Value handling (null, boolean, string, objects)
 * - Prefix option
 * - Topic and timestamp display
 * - health reporting and shutdown behavior
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { id, createEmitter } from '../index.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

const captureConsole = function () {
    const logs = [];
    const stub = sinon.stub( console, 'log' ).callsFake( ( ...args ) => {
        logs.push( args.join( ' ' ) );
    } );
    return {
        logs,
        restore: () => stub.restore()
    };
};

// ============================================================================
// TESTS
// ============================================================================

describe( 'Terminal Emitter — Identity', function () {

    it( 'exports id as "terminal"', function () {
        expect( id ).to.equal( 'terminal' );
    } );

} );

describe( 'Terminal Emitter — createEmitter', function () {

    it( 'returns emitter with required methods', function () {
        const emitter = createEmitter();

        expect( emitter ).to.have.property( 'publishNow' ).that.is.a( 'function' );
        expect( emitter ).to.have.property( 'shutdown' ).that.is.a( 'function' );
        expect( emitter ).to.have.property( 'getPressure' ).that.is.a( 'function' );
    } );

    it( 'reports connected via getHealth (isConnected is retired — observers read health)', function () {
        const emitter = createEmitter();

        expect( emitter.getHealth().connected ).to.equal( true );
    } );

    it( 'shutdown returns a promise', async function () {
        const emitter = createEmitter();

        const result = emitter.shutdown();

        expect( result ).to.be.instanceOf( Promise );
        await result;  // Should resolve without error
    } );

    it( 'shutdown signature accepts the ADR-018 forms — no arg, {}, { timeout: N }', async function () {
        // Verify all three call shapes work. No-arg is the historical form;
        // {} and { timeout: N } are the new contract-aligned forms.
        const e1 = createEmitter();
        await e1.shutdown();

        const e2 = createEmitter();
        await e2.shutdown( {} );

        const e3 = createEmitter();
        await e3.shutdown( { timeout: 100 } );
    } );

    it( 'publishNow returns { ok: true } per ADR-018', function () {
        const capture = captureConsole();
        try {
            const emitter = createEmitter();

            const result = emitter.publishNow( 'topic', { value: 1 } );

            expect( result ).to.deep.equal( { ok: true } );
        } finally {
            capture.restore();
        }
    } );

    it( 'publishNow reuses the same result object on every call (zero allocation)', function () {
        const capture = captureConsole();
        try {
            const emitter = createEmitter();

            const r1 = emitter.publishNow( 'topic', { value: 1 } );
            const r2 = emitter.publishNow( 'topic', { value: 2 } );

            expect( r1 ).to.equal( r2 );
        } finally {
            capture.restore();
        }
    } );

    it( 'getPressure returns 0 (Terminal has no observable buffer)', function () {
        const emitter = createEmitter();

        expect( emitter.getPressure() ).to.equal( 0 );
    } );

    it( 'getHealth returns the uniform floor shape { status, connected, pressure }', function () {
        const emitter = createEmitter();

        expect( emitter ).to.have.property( 'getHealth' ).that.is.a( 'function' );
        expect( emitter.getHealth() ).to.deep.equal( { status: 'green', connected: true, pressure: 0 } );
    } );

    it( 'getHealth reuses the same singleton across calls (zero-alloc)', function () {
        const emitter = createEmitter();

        const h1 = emitter.getHealth();
        const h2 = emitter.getHealth();

        expect( h1 ).to.equal( h2 );
    } );

} );

describe( 'Terminal Emitter — Compact Mode (default)', function () {
    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    it( 'outputs header with timestamp and topic', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'test/topic', { value: 1 } );

        expect( capture.logs[ 0 ] ).to.include( 'test/topic' );
        expect( capture.logs[ 0 ] ).to.include( '──' );
    } );

    it( 'outputs key=value format', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { a: 1, b: 2 } );

        expect( capture.logs[ 1 ] ).to.include( 'a=1' );
        expect( capture.logs[ 1 ] ).to.include( 'b=2' );
    } );

    it( 'separates fields with double space', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { x: 1, y: 2 } );

        expect( capture.logs[ 1 ] ).to.match( /x=1\s{2}y=2/ );
    } );

    it( 'outputs blank line after message', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { a: 1 } );

        expect( capture.logs[ 2 ] ).to.equal( '' );
    } );

} );

describe( 'Terminal Emitter — Verbose Mode', function () {
    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    it( 'outputs pretty JSON when verbose=true', function () {
        const emitter = createEmitter( { verbose: true } );

        emitter.publishNow( 'topic', { a: 1, b: 'test' } );

        const jsonOutput = capture.logs[ 1 ];
        expect( jsonOutput ).to.include( '"a"' );
        expect( jsonOutput ).to.include( '"b"' );
        expect( () => JSON.parse( jsonOutput ) ).to.not.throw();
    } );

    it( 'formats JSON with indentation', function () {
        const emitter = createEmitter( { verbose: true } );

        emitter.publishNow( 'topic', { key: 'value' } );

        expect( capture.logs[ 1 ] ).to.include( '\n' );
    } );

} );

describe( 'Terminal Emitter — Number Formatting', function () {
    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    it( 'keeps integers as integers', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { count: 42 } );

        expect( capture.logs[ 1 ] ).to.include( 'count=42' );
        expect( capture.logs[ 1 ] ).to.not.include( '42.00' );
    } );

    it( 'formats decimals with 2 decimal places', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { value: 3.14159 } );

        expect( capture.logs[ 1 ] ).to.include( 'value=3.14' );
    } );

    it( 'strips trailing zeros from decimals', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { value: 5.10 } );

        expect( capture.logs[ 1 ] ).to.include( 'value=5.1' );
    } );

    it( 'uses scientific notation for very small values', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { tiny: 0.0001234 } );

        expect( capture.logs[ 1 ] ).to.match( /tiny=.*e-.*/ );
    } );

    it( 'handles zero correctly', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { zero: 0 } );

        expect( capture.logs[ 1 ] ).to.include( 'zero=0' );
    } );

    it( 'handles negative numbers', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { neg: -42.5 } );

        expect( capture.logs[ 1 ] ).to.include( 'neg=-42.5' );
    } );

} );

describe( 'Terminal Emitter — Value Types', function () {
    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    it( 'displays null as "null"', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { empty: null } );

        expect( capture.logs[ 1 ] ).to.include( 'empty=null' );
    } );

    it( 'displays true boolean', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { flag: true } );

        expect( capture.logs[ 1 ] ).to.include( 'flag=true' );
    } );

    it( 'displays false boolean', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { flag: false } );

        expect( capture.logs[ 1 ] ).to.include( 'flag=false' );
    } );

    it( 'displays strings as-is', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { name: 'hello world' } );

        expect( capture.logs[ 1 ] ).to.include( 'name=hello world' );
    } );

    it( 'converts objects to string representation', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { obj: { nested: true } } );

        expect( capture.logs[ 1 ] ).to.include( 'obj=' );
    } );

} );

describe( 'Terminal Emitter — No Filtering', function () {
    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    it( 'shows all fields including nulls', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { a: 1, b: null, c: 3 } );

        expect( capture.logs[ 1 ] ).to.include( 'a=1' );
        expect( capture.logs[ 1 ] ).to.include( 'b=null' );
        expect( capture.logs[ 1 ] ).to.include( 'c=3' );
    } );

    it( 'shows all fields including false booleans', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { enabled: true, disabled: false } );

        expect( capture.logs[ 1 ] ).to.include( 'enabled=true' );
        expect( capture.logs[ 1 ] ).to.include( 'disabled=false' );
    } );

    it( 'shows internal fields like timestamp and partitionId', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { timestamp: 123456, partitionId: 'test', value: 1 } );

        expect( capture.logs[ 1 ] ).to.include( 'timestamp=123456' );
        expect( capture.logs[ 1 ] ).to.include( 'partitionId=test' );
        expect( capture.logs[ 1 ] ).to.include( 'value=1' );
    } );

} );

describe( 'Terminal Emitter — Prefix Option', function () {
    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    it( 'prepends prefix to header line', function () {
        const emitter = createEmitter( { prefix: '[TEST]' } );

        emitter.publishNow( 'topic', { a: 1 } );

        expect( capture.logs[ 0 ] ).to.match( /^\[TEST\] ──/ );
    } );

    it( 'works without prefix (default)', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { a: 1 } );

        expect( capture.logs[ 0 ] ).to.match( /^──/ );
    } );

    it( 'handles empty prefix', function () {
        const emitter = createEmitter( { prefix: '' } );

        emitter.publishNow( 'topic', { a: 1 } );

        expect( capture.logs[ 0 ] ).to.match( /^──/ );
    } );

} );

describe( 'Terminal Emitter — Verbose Number Formatting', function () {
    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    it( 'formats decimals in verbose mode too', function () {
        const emitter = createEmitter( { verbose: true } );

        emitter.publishNow( 'topic', { value: 3.14159 } );

        const json = JSON.parse( capture.logs[ 1 ] );
        expect( json.value ).to.equal( 3.14 );
    } );

    it( 'keeps integers in verbose mode', function () {
        const emitter = createEmitter( { verbose: true } );

        emitter.publishNow( 'topic', { count: 42 } );

        const json = JSON.parse( capture.logs[ 1 ] );
        expect( json.count ).to.equal( 42 );
    } );

} );

describe( 'Terminal Emitter — Custom Precision', function () {
    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    it( 'uses default precision of 2', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', { value: 3.14159265 } );

        expect( capture.logs[ 1 ] ).to.include( 'value=3.14' );
    } );

    it( 'respects precision=4 for decimals', function () {
        const emitter = createEmitter( { precision: 4 } );

        emitter.publishNow( 'topic', { value: 3.14159265 } );

        expect( capture.logs[ 1 ] ).to.include( 'value=3.1416' );
    } );

    it( 'respects precision=0 for rounding to integers', function () {
        const emitter = createEmitter( { precision: 0 } );

        emitter.publishNow( 'topic', { value: 3.7 } );

        expect( capture.logs[ 1 ] ).to.include( 'value=4' );
    } );

    it( 'applies precision to scientific notation', function () {
        const emitter = createEmitter( { precision: 4 } );

        emitter.publishNow( 'topic', { tiny: 0.0001234567 } );

        expect( capture.logs[ 1 ] ).to.match( /tiny=1\.2346e-4/ );
    } );

    it( 'applies precision in verbose mode', function () {
        const emitter = createEmitter( { verbose: true, precision: 3 } );

        emitter.publishNow( 'topic', { value: 2.71828 } );

        const json = JSON.parse( capture.logs[ 1 ] );
        expect( json.value ).to.equal( 2.718 );
    } );

    it( 'does not affect integers regardless of precision', function () {
        const emitter = createEmitter( { precision: 4 } );

        emitter.publishNow( 'topic', { count: 42 } );

        expect( capture.logs[ 1 ] ).to.include( 'count=42' );
        expect( capture.logs[ 1 ] ).to.not.include( '42.0000' );
    } );

} );

describe( 'Terminal Emitter — Empty Message', function () {
    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    it( 'handles empty message object', function () {
        const emitter = createEmitter();

        emitter.publishNow( 'topic', {} );

        expect( capture.logs[ 0 ] ).to.include( 'topic' );
        expect( capture.logs[ 1 ] ).to.equal( '' );  // No fields
    } );

    it( 'handles empty message in verbose mode', function () {
        const emitter = createEmitter( { verbose: true } );

        emitter.publishNow( 'topic', {} );

        expect( capture.logs[ 1 ] ).to.equal( '{}' );
    } );

} );


// ============================================================================
// RESOLUTION-AWARE FORMATTING (assetClass-driven)
// ============================================================================

describe( 'Terminal Emitter — semanticsRequirement export', function () {

    it( 'exports semanticsRequirement of the documented shape', async function () {
        const mod = await import( '../index.js' );

        // The wiring layer reads this declaration to decide what slice
        // of the asset class to inject. Terminal opts in optionally
        // (`required: false`) and reads only the columns map.
        expect( mod.semanticsRequirement ).to.deep.equal( {
            assetClass: {
                required: false,
                fields: [ 'columns' ]
            }
        } );
    } );

} );

describe( 'Terminal Emitter — Resolution-aware formatting (with assetClass)', function () {

    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    // The assetClass shape that wire-emitters injects: { columns: {...} }.
    // Terminal reads it as config.assetClass.columns.
    const assetClassWithResolutions = {
        columns: {
            // resolution: 0.001 → 3 decimal places (overrides global precision)
            pressure: { type: 'float64', resolution: 0.001 },
            // resolution: 0.1 → 1 decimal place (overrides global precision)
            temperature: { type: 'float64', resolution: 0.1 },
            // No resolution → fall back to global precision
            vibration: { type: 'float64' },
            // Non-float64 type → resolution ignored even if present
            rpm: { type: 'int64', resolution: 0.5 }
        }
    };

    it( 'formats per-column at the declared resolution (compact mode)', function () {
        // Global precision is 2 decimal places; overridden per-column.
        const emitter = createEmitter( { precision: 2, assetClass: assetClassWithResolutions } );

        emitter.publishNow( 'sensors', {
            pressure: 23.4567,    // resolution 0.001 → 23.457
            temperature: 87.65    // resolution 0.1   → 87.7
        } );

        const fieldsLine = capture.logs[ 1 ];
        expect( fieldsLine ).to.include( 'pressure=23.457' );
        expect( fieldsLine ).to.include( 'temperature=87.7' );
    } );

    it( 'formats per-column at the declared resolution (verbose mode)', function () {
        const emitter = createEmitter( {
            verbose: true,
            precision: 2,
            assetClass: assetClassWithResolutions
        } );

        emitter.publishNow( 'sensors', {
            pressure: 23.4567,
            temperature: 87.65
        } );

        const json = capture.logs[ 1 ];
        const parsed = JSON.parse( json );
        expect( parsed.pressure ).to.equal( 23.457 );
        expect( parsed.temperature ).to.equal( 87.7 );
    } );

    it( 'falls back to global precision for float64 columns without declared resolution', function () {
        // `vibration` is float64 but has no resolution declared. Falls
        // back to the global precision (2). 8.91234 → 8.91.
        const emitter = createEmitter( { precision: 2, assetClass: assetClassWithResolutions } );

        emitter.publishNow( 'sensors', {
            vibration: 8.91234
        } );

        expect( capture.logs[ 1 ] ).to.include( 'vibration=8.91' );
    } );

    it( 'falls back to global precision for fields not in the asset class columns map', function () {
        // `computedField` was added by a downstream node and is not in
        // the asset class. The formatter looks it up, finds nothing,
        // falls back to global precision.
        const emitter = createEmitter( { precision: 4, assetClass: assetClassWithResolutions } );

        emitter.publishNow( 'derived', {
            computedField: 0.123456789
        } );

        expect( capture.logs[ 1 ] ).to.include( 'computedField=0.1235' );
    } );

    it( 'preserves legacy behaviour when no asset class is supplied', function () {
        // Legacy callers do not pass `assetClass`. Behaviour must
        // be exactly the same as before — global precision applied to
        // every float column.
        const emitter = createEmitter( { precision: 3 } );

        emitter.publishNow( 'legacy', {
            pressure: 23.4567,
            temperature: 87.65
        } );

        const fieldsLine = capture.logs[ 1 ];
        expect( fieldsLine ).to.include( 'pressure=23.457' );
        expect( fieldsLine ).to.include( 'temperature=87.65' );
    } );

    it( 'throws INVALID_CONFIG when a float64 column has invalid resolution', function () {
        // Defensive validation per ADR-018's adapter–semantics alignment: a
        // float64 column with a malformed resolution corrupts every
        // value. assertColumnFacts catches it at startup.
        const badAsset = {
            columns: {
                pressure: { type: 'float64', resolution: 0 }
            }
        };
        let thrown;

        try {
            createEmitter( { assetClass: badAsset } );
        } catch ( err ) {
            thrown = err;
        }

        expect( thrown ).to.be.an( 'error' );
        expect( thrown.code ).to.equal( 'INVALID_CONFIG' );
        expect( thrown.message ).to.include( 'column \'pressure\'' );
    } );

    it( 'ignores resolution on non-float64 columns', function () {
        // `rpm` is int64 but the assetClass declares a resolution for
        // it. Terminal does not quantize integers; the resolution is
        // dead weight, not an error. Integer values still pass through
        // the formatter as-is.
        const emitter = createEmitter( { precision: 2, assetClass: assetClassWithResolutions } );

        emitter.publishNow( 'engine', {
            rpm: 3500
        } );

        expect( capture.logs[ 1 ] ).to.include( 'rpm=3500' );
    } );

} );


// ============================================================================
// CROSS-SINK CONSISTENCY
// ============================================================================
//
// Proves that for the same input value and the same declared resolution,
// terminal's formatted output and QDB's quantized written value are
// numerically equivalent. This is the unit-level proof of the alignment
// claim — same logical value renders as the same number in both sinks.
//
// The testHarness can run a richer end-to-end version (real flow, real
// subscriber, real database query). This test guarantees the formula
// agreement at the level of one shared input, without the harness
// infrastructure.

describe( 'Terminal Emitter — Cross-sink consistency with QuestDB writer', function () {

    let capture;

    beforeEach( function () {
        capture = captureConsole();
    } );

    afterEach( function () {
        capture.restore();
    } );

    // Captures the value QDB's writer would have sent to its ILP sender.
    // Same shape as the real Sender's `floatColumn` callback so we can
    // pass this mock directly to the writer under test.
    const captureQdbWritten = function ( resolution, value ) {
        let captured;
        const mockSender = {
            floatColumn: function ( _name, v ) {
                captured = v;
            }
        };
        // Lazy-import the QDB writer factory so the cross-sink test
        // does not pollute terminal's regular import surface.
        return import( '../../../storage-manager/questdb/writers.js' ).then( ( mod ) => {
            const writer = mod.createFloat64Writer( resolution );
            writer( mockSender, 'col', value );
            return captured;
        } );
    };

    // Captures what terminal writes for the same value under the same
    // resolution, by reading back the formatted line from the captured
    // stdout. Returns the parsed number.
    const captureTerminalWritten = function ( resolution, value ) {
        const emitter = createEmitter( {
            verbose: true,
            assetClass: {
                columns: {
                    col: { type: 'float64', resolution }
                }
            }
        } );
        emitter.publishNow( 'topic', { col: value } );
        const json = capture.logs[ 1 ];
        return JSON.parse( json ).col;
    };

    const cases = [
        // [ resolution, value, comment ]
        [ 0.001, 23.4567,    'three decimal places, value off-grid' ],
        [ 0.001, 23.456,     'three decimal places, value on-grid' ],
        [ 0.1,   87.65,      'one decimal place, mid-step' ],
        [ 0.1,   87.7,       'one decimal place, on-grid' ],
        [ 0.01,  -42.345,    'negative value, two decimal places' ],
        [ 0.01,  0.005,      'small positive at half-step' ],
        [ 5,     1234,       'whole-number resolution > 1, integer-shaped value' ],
        [ 0.0001, 0.12345678, 'very fine resolution' ]
    ];

    cases.forEach( ( [ resolution, value, comment ] ) => {
        it( `same output for value=${value} resolution=${resolution} (${comment})`, async function () {
            const qdbWritten = await captureQdbWritten( resolution, value );
            const terminalWritten = captureTerminalWritten( resolution, value );

            // Numerically equivalent — identical when both sinks use the
            // same Math.round + toFixed formula. If they ever diverge,
            // this test localises the bug to whichever side broke the
            // shared formula.
            expect( terminalWritten ).to.equal( qdbWritten );
        } );
    } );

} );
