// flow/test/groupby.specs.js

/**
 * @fileoverview Tests for groupBy/endGroup DSL syntax for flow specialization.
 *
 * groupBy is syntactic sugar that expands to switch/case at build time,
 * providing a concise way to define identical pipelines with parameter variations.
 */

import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import sinon from 'sinon';
import { flow } from '../../composer.js';
import { lookupByField } from '../../core/tunable/helpers.js';

// ============================================================================
// TEST DATA
// ============================================================================
const GAUGE_RANGES = {
    oilPressure: { min: 0, max: 120 },
    engineRpm: { min: 0, max: 6000 },
    r2: { min: 0, max: 1 },
    x: { min: 0, max: 100 }
};

// ============================================================================
// .groupBy() METHOD
// ============================================================================
describe( 'flow — groupBy/endGroup: .groupBy()', function () {

    it( 'accepts field and values array and returns api for chaining', function () {
        const api = flow( 'groupByTest' )
            .groupBy( 'rpmBand', [ 'idle', 'cruise' ] );

        expect( api ).to.have.property( 'sanitize' );
        expect( api ).to.have.property( 'endGroup' );
    } );

    it( 'throws if field is not a string', function () {
        expect( () => flow( 'test' ).groupBy( 123, [ 'a', 'b' ] ) )
            .to.throw( '.groupBy() requires a non-empty string field name' );
    } );

    it( 'throws if field is empty string', function () {
        expect( () => flow( 'test' ).groupBy( '', [ 'a', 'b' ] ) )
            .to.throw( '.groupBy() requires a non-empty string field name' );
    } );

    it( 'throws if field is not a valid identifier (hyphen)', function () {
        expect( () => flow( 'test' ).groupBy( 'rpm-band', [ 'a', 'b' ] ) )
            .to.throw( /valid identifier/ );
    } );

    it( 'throws if field is not a valid identifier (space)', function () {
        expect( () => flow( 'test' ).groupBy( 'rpm band', [ 'a', 'b' ] ) )
            .to.throw( /valid identifier/ );
    } );

    it( 'throws if field is not a valid identifier (leading digit)', function () {
        expect( () => flow( 'test' ).groupBy( '1band', [ 'a', 'b' ] ) )
            .to.throw( /valid identifier/ );
    } );

    it( 'throws if values is not an array', function () {
        expect( () => flow( 'test' ).groupBy( 'field', 'notArray' ) )
            .to.throw( '.groupBy() requires at least 2 group values' );
    } );

    it( 'throws if values has less than 2 elements', function () {
        expect( () => flow( 'test' ).groupBy( 'field', [ 'only_one' ] ) )
            .to.throw( '.groupBy() requires at least 2 group values' );
    } );

    it( 'throws if values is empty', function () {
        expect( () => flow( 'test' ).groupBy( 'field', [] ) )
            .to.throw( '.groupBy() requires at least 2 group values' );
    } );

    it( 'throws if value is not string or number', function () {
        expect( () => flow( 'test' ).groupBy( 'field', [ 'a', { obj: 1 } ] ) )
            .to.throw( 'group value at index 1 must be a string or number' );
    } );

    it( 'throws on duplicate group value', function () {
        expect( () => flow( 'test' ).groupBy( 'field', [ 'idle', 'cruise', 'idle' ] ) )
            .to.throw( 'duplicate group value \'idle\'' );
    } );

    it( 'throws if called inside switch', function () {
        expect( () =>
            flow( 'test' )
                .switch( 'type' )
                .case( 'temp' )
                .groupBy( 'band', [ 'a', 'b' ] )
        ).to.throw( '.groupBy() cannot be used inside .switch()' );
    } );

    it( 'throws if called twice', function () {
        expect( () =>
            flow( 'test' )
                .groupBy( 'band1', [ 'a', 'b' ] )
                .sanitize( 'node', 'x', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
                .endGroup()
                .groupBy( 'band2', [ 'c', 'd' ] )
        ).to.throw( '.groupBy() can only be called once per flow' );
    } );

    it( 'throws if called after nodes', function () {
        expect( () =>
            flow( 'test' )
                .sanitize( 'node', 'x', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
                .groupBy( 'band', [ 'a', 'b' ] )
        ).to.throw( '.groupBy() cannot be called after nodes' );
    } );

    it( 'throws if groupBy field equals partition field', function () {
        expect( () =>
            flow( 'test' )
                .assetId( 'vehicleId' )
                .groupBy( 'vehicleId', [ 'a', 'b' ] )
        ).to.throw( 'partition field and groupBy field must be different' );
    } );

    it( 'accepts numeric group values', function () {
        const api = flow( 'test' )
            .groupBy( 'sensorId', [ 1, 2, 3 ] );

        expect( api ).to.have.property( 'endGroup' );
    } );

} );

// ============================================================================
// .endGroup() METHOD
// ============================================================================
describe( 'flow — groupBy/endGroup: .endGroup()', function () {

    it( 'throws if called without active groupBy', function () {
        expect( () => flow( 'test' ).endGroup() )
            .to.throw( '.endGroup() requires an active .groupBy()' );
    } );

    it( 'throws if template is empty', function () {
        expect( () =>
            flow( 'test' )
                .groupBy( 'band', [ 'a', 'b' ] )
                .endGroup()
        ).to.throw( '.groupBy() must contain at least one node before .endGroup()' );
    } );

    it( 'returns api for chaining to terminals', function () {
        const api = flow( 'test' )
            .groupBy( 'band', [ 'a', 'b' ] )
            .sanitize( 'node', 'x', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
            .endGroup();

        expect( api ).to.have.property( 'build' );
        expect( api ).to.have.property( 'run' );
        expect( api ).to.have.property( 'validate' );
    } );

} );

// ============================================================================
// MUTUAL EXCLUSION
// ============================================================================
describe( 'flow — groupBy/endGroup: mutual exclusion', function () {

    it( 'throws if .switch() called inside groupBy block', function () {
        expect( () =>
            flow( 'test' )
                .groupBy( 'band', [ 'a', 'b' ] )
                .switch( 'type' )
        ).to.throw( '.switch() cannot be used with .groupBy()' );
    } );

    it( 'throws if .switch() called after groupBy expansion', function () {
        expect( () =>
            flow( 'test' )
                .groupBy( 'band', [ 'a', 'b' ] )
                .sanitize( 'node', 'x', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
                .endGroup()
                .switch( 'type' )
        ).to.throw( '.switch() cannot be used with .groupBy()' );
    } );

} );

// ============================================================================
// EXPANSION BEHAVIOR
// ============================================================================
describe( 'flow — groupBy/endGroup: expansion', function () {

    it( 'expands template to multiple cases', function () {
        const info = flow( 'expansionTest' )
            .groupBy( 'rpmBand', [ 'idle', 'low', 'cruise' ] )
            .sanitize( 'node', 'oilPressure', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
            .endGroup()
            .inspect();

        expect( info.mode ).to.equal( 'multi-specialization' );
        expect( info.caseOrder ).to.deep.equal( [ 'idle', 'low', 'cruise' ] );
        expect( info.specializations.idle.nodes[ 0 ].name ).to.equal( 'idle_node' );
        expect( info.specializations.low.nodes[ 0 ].name ).to.equal( 'low_node' );
        expect( info.specializations.cruise.nodes[ 0 ].name ).to.equal( 'cruise_node' );
    } );

    it( 'prefixes all node names in template', function () {
        const info = flow( 'multiNodeTest' )
            .groupBy( 'band', [ 'a', 'b' ] )
            .sanitize( 'san', 'oilPressure', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
            .esMean( 'mean', 'oilPressure', { mean: 'smoothed' }, { halfLife: 10 } )
            .endGroup()
            .inspect();

        expect( info.specializations.a.nodes ).to.have.length( 2 );
        expect( info.specializations.a.nodes[ 0 ].name ).to.equal( 'a_san' );
        expect( info.specializations.a.nodes[ 1 ].name ).to.equal( 'a_mean' );
        expect( info.specializations.b.nodes[ 0 ].name ).to.equal( 'b_san' );
        expect( info.specializations.b.nodes[ 1 ].name ).to.equal( 'b_mean' );
    } );

    it( 'resolves lookupByField tunables', function () {
        const info = flow( 'tunableTest' )
            .groupBy( 'rpmBand', [ 'idle', 'cruise' ] )
            .pageHinkley( 'ph', 'r2',
                { phShift: 'shiftDetected', phMean: 'baseline' },
                {
                    delta: 0.01,
                    lambda: lookupByField( 'rpmBand', { idle: 3.4, cruise: 2.4 }, 2.0 ),
                    alpha: 0.02
                } )
            .endGroup()
            .inspect();

        // Verify expansion worked - specific lambda values checked via build()
        expect( info.specializations.idle.nodes[ 0 ].name ).to.equal( 'idle_ph' );
        expect( info.specializations.cruise.nodes[ 0 ].name ).to.equal( 'cruise_ph' );
    } );

    it( 'handles multiple nodes with tunables', function () {
        const info = flow( 'multiTunableTest' )
            .groupBy( 'rpmBand', [ 'idle', 'cruise' ] )
            .pageHinkley( 'ph1', 'r2',
                { phShift: 'shift1' },
                {
                    delta: 0.01,
                    lambda: lookupByField( 'rpmBand', { idle: 3.4, cruise: 2.4 }, 2.0 )
                } )
            .pageHinkley( 'ph2', 'r2',
                { phShift: 'shift2' },
                {
                    delta: 0.02,
                    lambda: lookupByField( 'rpmBand', { idle: 4.0, cruise: 3.0 }, 2.5 )
                } )
            .endGroup()
            .inspect();

        expect( info.specializations.idle.nodeCount ).to.equal( 2 );
        expect( info.specializations.idle.nodes[ 0 ].name ).to.equal( 'idle_ph1' );
        expect( info.specializations.idle.nodes[ 1 ].name ).to.equal( 'idle_ph2' );
    } );

} );

// ============================================================================
// COLLISION CHECKING
// ============================================================================
describe( 'flow — groupBy/endGroup: collision checking', function () {

    let consoleWarnStub;

    beforeEach( function () {
        consoleWarnStub = sinon.stub( console, 'warn' );
    } );

    afterEach( function () {
        consoleWarnStub.restore();
    } );

    it( 'throws on duplicate node names in template', function () {
        expect( () =>
            flow( 'test' )
                .groupBy( 'band', [ 'a', 'b' ] )
                .sanitize( 'node', 'oilPressure', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
                .sanitize( 'node', 'engineRpm', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
        ).to.throw( 'duplicate node' );
    } );

    it( 'does NOT warn on duplicate param names in groupBy (intentional)', function () {
        flow( 'test' )
            .groupBy( 'band', [ 'a', 'b' ] )
            .esMean( 'mean1', 'oilPressure', { mean: 'smoothed' }, { halfLife: 10 } )
            .esMean( 'mean2', 'engineRpm', { mean: 'smoothed' }, { halfLife: 10 } )  // Same storeAs
            .endGroup();

        // Should NOT have warned - duplicate params are intentional in groupBy
        expect( consoleWarnStub.called ).to.equal( false );
    } );

} );

// ============================================================================
// BUILD OUTPUT
// ============================================================================
describe( 'flow — groupBy/endGroup: .build()', function () {

    it( 'produces valid serialized output', function () {
        const output = flow( 'buildTest' )
            .groupBy( 'rpmBand', [ 'idle', 'cruise' ] )
            .sanitize( 'san', 'oilPressure', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
            .endGroup()
            .build();

        expect( output ).to.include( 'flowBySpecialization' );
        expect( output ).to.include( '\'idle\'' );
        expect( output ).to.include( '\'cruise\'' );
        expect( output ).to.include( 'idle_san' );
        expect( output ).to.include( 'cruise_san' );
    } );

    it( 'resolves tunables in serialized output', function () {
        const output = flow( 'tunableBuildTest' )
            .groupBy( 'rpmBand', [ 'idle', 'cruise' ] )
            .pageHinkley( 'ph', 'r2',
                { phShift: 'shiftDetected' },
                {
                    delta: 0.01,
                    lambda: lookupByField( 'rpmBand', { idle: 3.4, cruise: 2.4 }, 2.0 )
                } )
            .endGroup()
            .build();

        // Tunables should be resolved to concrete values
        expect( output ).to.include( '3.4' );
        expect( output ).to.include( '2.4' );
        // Should NOT include lookupByField function call
        expect( output ).to.not.include( 'lookupByField' );
    } );

} );

// ============================================================================
// VALIDATE
// ============================================================================
describe( 'flow — groupBy/endGroup: .validate()', function () {

    it( 'validates all expanded cases', async function () {
        const result = await flow( 'validateTest' )
            .groupBy( 'rpmBand', [ 'idle', 'cruise' ] )
            .sanitize( 'san', 'oilPressure', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
            .endGroup()
            .validate();

        expect( result.valid ).to.equal( true );
        expect( result.errors ).to.have.length( 0 );
    } );

} );

// ============================================================================
// COMPARISON WITH MANUAL SWITCH/CASE
// ============================================================================
describe( 'flow — groupBy/endGroup: equivalence to switch/case', function () {

    it( 'produces same structure as manual switch/case', function () {
        // Manual switch/case
        const manualInfo = flow( 'manual' )
            .switch( 'rpmBand' )
            .case( 'idle' )
                .sanitize( 'idle_san', 'oilPressure', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
                .break()
            .case( 'cruise' )
                .sanitize( 'cruise_san', 'oilPressure', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
                .break()
            .inspect();

        // groupBy sugar
        const groupByInfo = flow( 'groupBy' )
            .groupBy( 'rpmBand', [ 'idle', 'cruise' ] )
            .sanitize( 'san', 'oilPressure', { failureReason: 'reason' }, { ranges: GAUGE_RANGES } )
            .endGroup()
            .inspect();

        expect( groupByInfo.mode ).to.equal( manualInfo.mode );
        expect( groupByInfo.caseOrder ).to.deep.equal( manualInfo.caseOrder );
        expect( groupByInfo.specializations.idle.nodes[ 0 ].name )
            .to.equal( manualInfo.specializations.idle.nodes[ 0 ].name );
        expect( groupByInfo.specializations.cruise.nodes[ 0 ].name )
            .to.equal( manualInfo.specializations.cruise.nodes[ 0 ].name );
    } );

} );
