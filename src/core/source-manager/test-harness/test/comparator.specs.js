// core/source-manager/test-harness/test/comparator.specs.js

/**
 * @fileoverview Tests for the cross-sink comparator.
 *
 * The comparator is a pure library — given the harness's ground-truth
 * inputs, crafted sink captures, and an asset class, it returns a
 * report. These tests cover:
 *  - parseTerminalOutput on real-shape stdout
 *  - indexById behaviour
 *  - compareCaptures reports across the rules: presence, exact match,
 *    resolution tolerance, fuzz skip, no-asset-class mode, NaN.
 */

/* eslint-disable no-underscore-dangle -- harness fields use a leading underscore by convention. */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { parseTerminalOutput, indexById, compareCaptures } from '../comparator.js';

const assetClass = {
    columns: {
        _harnessId: { type: 'int64' },
        temperature: { type: 'float64', resolution: 0.01 },
        rpm: { type: 'int64' },
        state: { type: 'string' },
        ts: { type: 'timestamp' }
    }
};

const buildTerminalText = function ( messages ) {
    // Mirrors the terminal emitter's verbose-mode format: a header
    // line, then JSON.stringify(msg, null, 2), then a blank line.
    return messages.map( function ( msg ) {
        return `── 12:00:00 ── topic ──\n${JSON.stringify( msg, null, 2 )}\n`;
    } ).join( '\n' );
};

describe( 'comparator — parseTerminalOutput', function () {

    it( 'returns one parsed message per pretty-JSON block', function () {
        const text = buildTerminalText( [
            { _harnessId: 1, temperature: 25.0, state: 'idle' },
            { _harnessId: 2, temperature: 26.0, state: 'run' }
        ] );
        const parsed = parseTerminalOutput( text );
        expect( parsed ).to.have.length( 2 );
        expect( parsed[ 0 ]._harnessId ).to.equal( 1 );
        expect( parsed[ 1 ]._harnessId ).to.equal( 2 );
    } );

    it( 'returns an empty array when the buffer has no messages', function () {
        expect( parseTerminalOutput( '' ) ).to.deep.equal( [] );
        expect( parseTerminalOutput( 'header line only\n' ) ).to.deep.equal( [] );
    } );

    it( 'tolerates header lines and blank lines between messages', function () {
        const text =
            '── 12:00:00 ── topic ──\n' +
            '{\n  "_harnessId": 1\n}\n' +
            '\n' +
            '── 12:00:01 ── topic ──\n' +
            '{\n  "_harnessId": 2\n}\n';
        const parsed = parseTerminalOutput( text );
        expect( parsed ).to.deep.equal( [
            { _harnessId: 1 },
            { _harnessId: 2 }
        ] );
    } );

} );

describe( 'comparator — indexById', function () {

    it( 'keys each message by its _harnessId', function () {
        const map = indexById( [
            { _harnessId: 1, x: 'a' },
            { _harnessId: 2, x: 'b' }
        ] );
        expect( map.size ).to.equal( 2 );
        expect( map.get( 1 ).x ).to.equal( 'a' );
        expect( map.get( 2 ).x ).to.equal( 'b' );
    } );

    it( 'skips messages with no _harnessId', function () {
        const map = indexById( [
            { _harnessId: 1, x: 'a' },
            { x: 'b' }
        ] );
        expect( map.size ).to.equal( 1 );
        expect( map.get( 1 ).x ).to.equal( 'a' );
    } );

} );

describe( 'comparator — compareCaptures (happy path)', function () {

    it( 'returns ok when every sink reflects the harness inputs', function () {
        const harnessInputs = [
            { _harnessId: 1, temperature: 25.00, rpm: 1000, state: 'idle', ts: 1700000000 },
            { _harnessId: 2, temperature: 25.50, rpm: 1100, state: 'run',  ts: 1700000001 }
        ];
        const report = compareCaptures( harnessInputs, {
            terminal: buildTerminalText( harnessInputs ),
            mqtt: harnessInputs,
            qdb: harnessInputs
        }, assetClass );

        expect( report.ok ).to.equal( true );
        expect( report.errors ).to.deep.equal( [] );
        expect( report.summary.messageCount ).to.equal( 2 );
        expect( report.summary.sinkCounts ).to.deep.equal( {
            terminal: 2, mqtt: 2, qdb: 2
        } );
    } );

    it( 'works with a subset of sinks (mqtt + qdb only)', function () {
        const harnessInputs = [ { _harnessId: 1, temperature: 25.00, rpm: 1000, state: 'idle', ts: 1700000000 } ];
        const report = compareCaptures( harnessInputs, {
            mqtt: harnessInputs,
            qdb: harnessInputs
        }, assetClass );

        expect( report.ok ).to.equal( true );
        expect( report.summary.sinkCounts ).to.deep.equal( { mqtt: 1, qdb: 1 } );
    } );

} );

describe( 'comparator — compareCaptures (presence)', function () {

    it( 'reports a missing message per sink', function () {
        const harnessInputs = [
            { _harnessId: 1, temperature: 25.00, rpm: 1000, state: 'idle', ts: 1700000000 },
            { _harnessId: 2, temperature: 25.50, rpm: 1100, state: 'run',  ts: 1700000001 }
        ];
        const qdbOnlyOne = [ harnessInputs[ 0 ] ];
        const report = compareCaptures( harnessInputs, {
            terminal: buildTerminalText( harnessInputs ),
            mqtt: harnessInputs,
            qdb: qdbOnlyOne
        }, assetClass );

        expect( report.ok ).to.equal( false );
        expect( report.errors ).to.have.length( 1 );
        expect( report.errors[ 0 ] ).to.contain( 'harnessId=2' );
        expect( report.errors[ 0 ] ).to.contain( 'missing from qdb' );
    } );

} );

describe( 'comparator — compareCaptures (resolution tolerance)', function () {

    it( 'passes when float values agree on the declared resolution grid', function () {
        const harnessInputs = [ { _harnessId: 1, temperature: 25.79, rpm: 1000, state: 'idle', ts: 1 } ];
        // QDB rounds at storage; the value lands on the same grid step.
        const qdbMessages = [ { _harnessId: 1, temperature: 25.79000001, rpm: 1000, state: 'idle', ts: 1 } ];
        const report = compareCaptures( harnessInputs, {
            terminal: buildTerminalText( harnessInputs ),
            qdb: qdbMessages
        }, assetClass );

        expect( report.ok ).to.equal( true );
    } );

    it( 'fails when a sink lands on a different grid step from the harness', function () {
        const harnessInputs = [ { _harnessId: 1, temperature: 25.78, rpm: 1000, state: 'idle', ts: 1 } ];
        const qdbMessages = [ { _harnessId: 1, temperature: 25.79, rpm: 1000, state: 'idle', ts: 1 } ];
        const report = compareCaptures( harnessInputs, {
            qdb: qdbMessages
        }, assetClass );

        expect( report.ok ).to.equal( false );
        expect( report.errors ).to.have.length( 1 );
        expect( report.errors[ 0 ] ).to.contain( 'column \'temperature\'' );
        expect( report.errors[ 0 ] ).to.contain( 'harness sent 25.78' );
        expect( report.errors[ 0 ] ).to.contain( 'qdb saw 25.79' );
        expect( report.errors[ 0 ] ).to.contain( 'declared resolution: 0.01' );
        expect( report.errors[ 0 ] ).to.contain( 'beyond resolution' );
    } );

} );

describe( 'comparator — compareCaptures (exact match)', function () {

    it( 'reports a string mismatch', function () {
        const harnessInputs = [ { _harnessId: 1, temperature: 25.0, rpm: 1000, state: 'idle', ts: 1 } ];
        const qdbMessages = [ { _harnessId: 1, temperature: 25.0, rpm: 1000, state: 'run', ts: 1 } ];
        const report = compareCaptures( harnessInputs, {
            qdb: qdbMessages
        }, assetClass );

        expect( report.ok ).to.equal( false );
        expect( report.errors ).to.have.length( 1 );
        expect( report.errors[ 0 ] ).to.contain( 'column \'state\'' );
        expect( report.errors[ 0 ] ).to.contain( 'harness sent "idle"' );
        expect( report.errors[ 0 ] ).to.contain( 'qdb saw "run"' );
    } );

    it( 'reports an integer mismatch', function () {
        const harnessInputs = [ { _harnessId: 1, temperature: 25.0, rpm: 1000, state: 'idle', ts: 1 } ];
        const qdbMessages = [ { _harnessId: 1, temperature: 25.0, rpm: 1001, state: 'idle', ts: 1 } ];
        const report = compareCaptures( harnessInputs, {
            qdb: qdbMessages
        }, assetClass );

        expect( report.ok ).to.equal( false );
        expect( report.errors ).to.have.length( 1 );
        expect( report.errors[ 0 ] ).to.contain( 'column \'rpm\'' );
    } );

    it( 'reports a timestamp mismatch', function () {
        const harnessInputs = [ { _harnessId: 1, temperature: 25.0, rpm: 1000, state: 'idle', ts: 1 } ];
        const qdbMessages = [ { _harnessId: 1, temperature: 25.0, rpm: 1000, state: 'idle', ts: 2 } ];
        const report = compareCaptures( harnessInputs, {
            qdb: qdbMessages
        }, assetClass );

        expect( report.ok ).to.equal( false );
        expect( report.errors[ 0 ] ).to.contain( 'column \'ts\'' );
    } );

} );

describe( 'comparator — compareCaptures (fuzz messages skip value compare)', function () {

    it( 'does not flag value differences on a fuzz message', function () {
        // The harness sent NaN as a fuzz pattern; QDB stored null.
        // Without the fuzz skip, this would be flagged.
        const harnessInputs = [ {
            _harnessId: 1,
            _harnessFuzzPattern: 'NaN',
            temperature: NaN,
            rpm: 1000,
            state: 'idle',
            ts: 1
        } ];
        const fuzzQdb = [ {
            _harnessId: 1,
            _harnessFuzzPattern: 'NaN',
            temperature: null,
            rpm: 1000,
            state: 'idle',
            ts: 1
        } ];
        const report = compareCaptures( harnessInputs, {
            qdb: fuzzQdb
        }, assetClass );

        expect( report.ok ).to.equal( true );
    } );

    it( 'still reports a presence failure for fuzz messages', function () {
        const harnessInputs = [ {
            _harnessId: 1,
            _harnessFuzzPattern: 'null',
            temperature: null,
            rpm: 1000,
            state: 'idle',
            ts: 1
        } ];
        // Missing from qdb entirely.
        const report = compareCaptures( harnessInputs, {
            qdb: []
        }, assetClass );

        expect( report.ok ).to.equal( false );
        expect( report.errors[ 0 ] ).to.contain( 'missing from qdb' );
    } );

} );

describe( 'comparator — compareCaptures (single sink edge cases)', function () {

    it( 'returns ok when only one sink is checked and it agrees with the harness', function () {
        const harnessInputs = [ { _harnessId: 1, temperature: 25.0, rpm: 1000, state: 'idle', ts: 1 } ];
        const report = compareCaptures( harnessInputs, { mqtt: harnessInputs }, assetClass );
        expect( report.ok ).to.equal( true );
    } );

    it( 'handles empty harness inputs and empty captures cleanly', function () {
        const report = compareCaptures( [], {
            terminal: '',
            mqtt: [],
            qdb: []
        }, assetClass );
        expect( report.ok ).to.equal( true );
        expect( report.summary.messageCount ).to.equal( 0 );
    } );

    it( 'works with no asset class (only presence is checked)', function () {
        // Without an asset class, no column list to walk. Sinks just
        // need to carry every harness id.
        const harnessInputs = [ { _harnessId: 1, temperature: 25.0 } ];
        const report = compareCaptures( harnessInputs, { mqtt: harnessInputs }, null );
        expect( report.ok ).to.equal( true );
    } );

    it( 'works with no harness inputs and no captures', function () {
        const report = compareCaptures( null, {}, null );
        expect( report.ok ).to.equal( true );
        expect( report.summary.messageCount ).to.equal( 0 );
    } );

} );

describe( 'comparator — compareCaptures (corrupt or unusual data)', function () {

    it( 'reports a mismatch when a sink stored a non-number in a float column', function () {
        const harnessInputs = [ { _harnessId: 1, temperature: 25.0, rpm: 1000, state: 'idle', ts: 1 } ];
        const qdbMessages = [ { _harnessId: 1, temperature: 'not-a-number', rpm: 1000, state: 'idle', ts: 1 } ];
        const report = compareCaptures( harnessInputs, { qdb: qdbMessages }, assetClass );
        expect( report.ok ).to.equal( false );
        expect( report.errors[ 0 ] ).to.contain( 'column \'temperature\'' );
    } );

    it( 'reports a mismatch when one side holds NaN and the other does not', function () {
        // Non-fuzz message; one side has NaN. This must surface.
        const harnessInputs = [ { _harnessId: 1, temperature: 25.0, rpm: 1000, state: 'idle', ts: 1 } ];
        const qdbMessages = [ { _harnessId: 1, temperature: NaN, rpm: 1000, state: 'idle', ts: 1 } ];
        const report = compareCaptures( harnessInputs, { qdb: qdbMessages }, assetClass );
        expect( report.ok ).to.equal( false );
        expect( report.errors[ 0 ] ).to.contain( 'column \'temperature\'' );
    } );

    it( 'passes when both sides hold NaN in the same column (non-fuzz path)', function () {
        // Non-fuzz, both sides NaN — harness asserts equality of NaN-ness.
        const harnessInputs = [ { _harnessId: 1, temperature: NaN, rpm: 1000, state: 'idle', ts: 1 } ];
        const qdbMessages = [ { _harnessId: 1, temperature: NaN, rpm: 1000, state: 'idle', ts: 1 } ];
        const report = compareCaptures( harnessInputs, { qdb: qdbMessages }, assetClass );
        expect( report.ok ).to.equal( true );
    } );

    it( 'handles NaN in a column with no resolution tolerance (e.g., int64)', function () {
        // The temperature column has resolution → goes through the
        // grid-snap path. The rpm column does not, so NaN-checking
        // happens in the plain equality path. Both sides NaN must
        // pass; one side NaN must fail.
        const bothNaN = compareCaptures(
            [ { _harnessId: 1, temperature: 25.0, rpm: NaN, state: 'idle', ts: 1 } ],
            { qdb: [ { _harnessId: 1, temperature: 25.0, rpm: NaN, state: 'idle', ts: 1 } ] },
            assetClass
        );
        expect( bothNaN.ok ).to.equal( true );

        const oneSideNaN = compareCaptures(
            [ { _harnessId: 1, temperature: 25.0, rpm: 1000, state: 'idle', ts: 1 } ],
            { qdb: [ { _harnessId: 1, temperature: 25.0, rpm: NaN, state: 'idle', ts: 1 } ] },
            assetClass
        );
        expect( oneSideNaN.ok ).to.equal( false );
        expect( oneSideNaN.errors[ 0 ] ).to.contain( 'column \'rpm\'' );
    } );

} );
