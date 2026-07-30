// src/core/semantics/test/column-schema.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    columnSchema,
    validPhysicalRange,
    validOperational,
    validSpecification,
    validWhen,
    validContext,
    validContexts,
    validColumnType,
    validInterpretation,
    COLUMN_TYPES,
    COLUMN_DEFAULTS
} from '../schemas/index.js';
import { validateWithSchema } from '../../utils/validate/index.js';

describe( 'Column Schema Validators', function () {

    // ========================================================================
    // BASIC COLUMN VALIDATORS
    // ========================================================================

    describe( 'validColumnType', function () {

        it( 'should accept all valid column types', function () {
            COLUMN_TYPES.forEach( ( type ) => {
                expect( validColumnType( type ) ).to.equal( true );
            } );
        } );

        it( 'should reject invalid types', function () {
            expect( validColumnType( 'invalid' ) ).to.equal( false );
            expect( validColumnType( 'number' ) ).to.equal( false );
            expect( validColumnType( '' ) ).to.equal( false );
        } );

    } );

    describe( 'validInterpretation', function () {

        it( 'should accept empty array', function () {
            expect( validInterpretation( [] ) ).to.equal( true );
        } );

        it( 'should accept array with single string', function () {
            expect( validInterpretation( [ 'Severity: higher is worse' ] ) ).to.equal( true );
        } );

        it( 'should accept array with multiple strings', function () {
            const interps = [
                'Severity: higher values indicate more severe glitches',
                'Threshold: > 30 bar indicates communication dropout',
                'Correlate: with washCycleStats by timestamp'
            ];
            expect( validInterpretation( interps ) ).to.equal( true );
        } );

        it( 'should reject non-array values', function () {
            expect( validInterpretation( 'string' ) ).to.equal( false );
            expect( validInterpretation( 123 ) ).to.equal( false );
            expect( validInterpretation( null ) ).to.equal( false );
            expect( validInterpretation( undefined ) ).to.equal( false );
            expect( validInterpretation( {} ) ).to.equal( false );
        } );

        it( 'should reject array with empty string', function () {
            expect( validInterpretation( [ 'valid', '' ] ) ).to.equal( false );
            expect( validInterpretation( [ '' ] ) ).to.equal( false );
        } );

        it( 'should reject array with non-string elements', function () {
            expect( validInterpretation( [ 'valid', 123 ] ) ).to.equal( false );
            expect( validInterpretation( [ 'valid', null ] ) ).to.equal( false );
            expect( validInterpretation( [ 'valid', {} ] ) ).to.equal( false );
        } );

    } );

    describe( 'hysteresis (via columnSchema)', function () {

        it( 'should accept valid hysteresis value', function () {
            const column = { type: 'float64', hysteresis: 5 };
            const result = validateWithSchema( columnSchema, column, 'test' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should accept zero hysteresis', function () {
            const column = { type: 'float64', hysteresis: 0 };
            const result = validateWithSchema( columnSchema, column, 'test' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should accept small decimal hysteresis', function () {
            const column = { type: 'float64', hysteresis: 0.5 };
            const result = validateWithSchema( columnSchema, column, 'test' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should reject negative hysteresis', function () {
            const column = { type: 'float64', hysteresis: -1 };
            const result = validateWithSchema( columnSchema, column, 'test' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'non-negative finite' );
        } );

        it( 'should reject Infinity hysteresis', function () {
            const column = { type: 'float64', hysteresis: Infinity };
            const result = validateWithSchema( columnSchema, column, 'test' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'non-negative finite' );
        } );

        it( 'should reject NaN hysteresis', function () {
            const column = { type: 'float64', hysteresis: NaN };
            const result = validateWithSchema( columnSchema, column, 'test' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'hysteresis' );
        } );

        it( 'should default to zero when not specified', function () {
            expect( COLUMN_DEFAULTS.hysteresis ).to.equal( 0 );
        } );

    } );

    // ========================================================================
    // RANGE & LIMITS VALIDATORS
    // ========================================================================

    describe( 'validPhysicalRange', function () {

        it( 'should accept valid range with min < max', function () {
            expect( validPhysicalRange( { min: 0, max: 100 } ) ).to.equal( true );
            expect( validPhysicalRange( { min: -50, max: 50 } ) ).to.equal( true );
        } );

        it( 'should reject min >= max', function () {
            expect( validPhysicalRange( { min: 100, max: 100 } ) ).to.equal( false );
            expect( validPhysicalRange( { min: 100, max: 50 } ) ).to.equal( false );
        } );

        it( 'should reject non-finite numbers', function () {
            expect( validPhysicalRange( { min: Infinity, max: 100 } ) ).to.equal( false );
            expect( validPhysicalRange( { min: 0, max: NaN } ) ).to.equal( false );
        } );

        it( 'should reject missing properties', function () {
            expect( validPhysicalRange( { min: 0 } ) ).to.equal( false );
            expect( validPhysicalRange( { max: 100 } ) ).to.equal( false );
        } );

        it( 'should reject non-objects', function () {
            expect( validPhysicalRange( null ) ).to.equal( false );
            expect( validPhysicalRange( 'range' ) ).to.equal( false );
        } );

    } );

    describe( 'validOperational', function () {

        it( 'should accept valid operational limits in ascending order', function () {
            const ops = {
                criticalLow: 10,
                warningLow: 20,
                target: 50,
                warningHigh: 80,
                criticalHigh: 90
            };
            expect( validOperational( ops ) ).to.equal( true );
        } );

        it( 'should accept partial limits', function () {
            expect( validOperational( { warningHigh: 80 } ) ).to.equal( true );
            expect( validOperational( { criticalLow: 10, criticalHigh: 90 } ) ).to.equal( true );
        } );

        it( 'should accept equal adjacent limits', function () {
            const ops = { warningLow: 50, target: 50, warningHigh: 50 };
            expect( validOperational( ops ) ).to.equal( true );
        } );

        it( 'should reject limits out of order', function () {
            const ops = { warningLow: 80, warningHigh: 20 };
            expect( validOperational( ops ) ).to.equal( false );
        } );

        it( 'should accept valid hysteresis', function () {
            expect( validOperational( { warningHigh: 80, hysteresis: 5 } ) ).to.equal( true );
            expect( validOperational( { warningHigh: 80, hysteresis: 0 } ) ).to.equal( true );
        } );

        it( 'should reject negative hysteresis', function () {
            expect( validOperational( { warningHigh: 80, hysteresis: -1 } ) ).to.equal( false );
        } );

        it( 'should reject NaN hysteresis', function () {
            expect( validOperational( { warningHigh: 80, hysteresis: NaN } ) ).to.equal( false );
        } );

        it( 'should reject Infinity hysteresis', function () {
            expect( validOperational( { warningHigh: 80, hysteresis: Infinity } ) ).to.equal( false );
        } );

        it( 'should reject non-finite numbers', function () {
            expect( validOperational( { warningHigh: Infinity } ) ).to.equal( false );
            expect( validOperational( { target: NaN } ) ).to.equal( false );
        } );

        it( 'should reject non-objects', function () {
            expect( validOperational( null ) ).to.equal( false );
            expect( validOperational( 'ops' ) ).to.equal( false );
        } );

    } );

    describe( 'validSpecification', function () {

        it( 'should accept valid specification with lowerSpecLimit < target < upperSpecLimit', function () {
            const spec = { lowerSpecLimit: 90, target: 100, upperSpecLimit: 110 };
            expect( validSpecification( spec ) ).to.equal( true );
        } );

        it( 'should accept partial specification', function () {
            expect( validSpecification( { lowerSpecLimit: 90, upperSpecLimit: 110 } ) ).to.equal( true );
            expect( validSpecification( { target: 100 } ) ).to.equal( true );
        } );

        it( 'should reject lowerSpecLimit >= upperSpecLimit', function () {
            expect( validSpecification( { lowerSpecLimit: 110, upperSpecLimit: 90 } ) ).to.equal( false );
            expect( validSpecification( { lowerSpecLimit: 100, upperSpecLimit: 100 } ) ).to.equal( false );
        } );

        it( 'should reject target outside lowerSpecLimit/upperSpecLimit', function () {
            expect( validSpecification( { lowerSpecLimit: 90, target: 80, upperSpecLimit: 110 } ) ).to.equal( false );
            expect( validSpecification( { lowerSpecLimit: 90, target: 120, upperSpecLimit: 110 } ) ).to.equal( false );
        } );

        it( 'should accept target at boundary', function () {
            expect( validSpecification( { lowerSpecLimit: 90, target: 90, upperSpecLimit: 110 } ) ).to.equal( true );
            expect( validSpecification( { lowerSpecLimit: 90, target: 110, upperSpecLimit: 110 } ) ).to.equal( true );
        } );

        it( 'should reject non-finite numbers', function () {
            expect( validSpecification( { lowerSpecLimit: NaN } ) ).to.equal( false );
        } );

        it( 'should reject null', function () {
            expect( validSpecification( null ) ).to.equal( false );
        } );

        it( 'should reject non-objects', function () {
            expect( validSpecification( 'string' ) ).to.equal( false );
            expect( validSpecification( 123 ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // CONTEXT VALIDATORS
    // ========================================================================

    describe( 'validWhen', function () {

        it( 'should accept "default" string', function () {
            expect( validWhen( 'default' ) ).to.equal( true );
        } );

        it( 'should accept equals with numeric value', function () {
            expect( validWhen( { column: 'state', equals: 0 } ) ).to.equal( true );
            expect( validWhen( { column: 'state', equals: 42 } ) ).to.equal( true );
        } );

        it( 'should accept equals with string value', function () {
            expect( validWhen( { column: 'mode', equals: 'idle' } ) ).to.equal( true );
            expect( validWhen( { column: 'mode', equals: 'RUNNING' } ) ).to.equal( true );
        } );

        it( 'should accept equals with boolean value', function () {
            expect( validWhen( { column: 'active', equals: true } ) ).to.equal( true );
            expect( validWhen( { column: 'active', equals: false } ) ).to.equal( true );
        } );

        it( 'should accept equals with null value', function () {
            expect( validWhen( { column: 'value', equals: null } ) ).to.equal( true );
        } );

        it( 'should accept oneOf with array of primitives', function () {
            expect( validWhen( { column: 'state', oneOf: [ 1, 2, 3 ] } ) ).to.equal( true );
            expect( validWhen( { column: 'mode', oneOf: [ 'a', 'b' ] } ) ).to.equal( true );
            expect( validWhen( { column: 'mixed', oneOf: [ 1, 'two', true, null ] } ) ).to.equal( true );
        } );

        it( 'should reject empty column name', function () {
            expect( validWhen( { column: '', equals: 1 } ) ).to.equal( false );
        } );

        it( 'should reject missing column', function () {
            expect( validWhen( { equals: 1 } ) ).to.equal( false );
        } );

        it( 'should reject missing operator', function () {
            expect( validWhen( { column: 'state' } ) ).to.equal( false );
        } );

        it( 'should reject multiple operators', function () {
            expect( validWhen( { column: 'state', equals: 1, oneOf: [ 1, 2 ] } ) ).to.equal( false );
        } );

        it( 'should reject empty oneOf array', function () {
            expect( validWhen( { column: 'state', oneOf: [] } ) ).to.equal( false );
        } );

        it( 'should reject oneOf with non-primitive values', function () {
            expect( validWhen( { column: 'state', oneOf: [ { a: 1 } ] } ) ).to.equal( false );
            expect( validWhen( { column: 'state', oneOf: [ [ 1, 2 ] ] } ) ).to.equal( false );
        } );

        it( 'should reject equals with non-primitive value', function () {
            expect( validWhen( { column: 'state', equals: { a: 1 } } ) ).to.equal( false );
            expect( validWhen( { column: 'state', equals: [ 1, 2 ] } ) ).to.equal( false );
        } );

        it( 'should reject non-object/non-default values', function () {
            expect( validWhen( null ) ).to.equal( false );
            expect( validWhen( 123 ) ).to.equal( false );
            expect( validWhen( 'other' ) ).to.equal( false );
        } );

    } );

    describe( 'validContext', function () {

        it( 'should accept context with operational limits', function () {
            const ctx = {
                when: { column: 'state', equals: 1 },
                operational: { warningHigh: 80 }
            };
            expect( validContext( ctx ) ).to.equal( true );
        } );

        it( 'should accept context with specification limits', function () {
            const ctx = {
                when: { column: 'state', equals: 1 },
                specification: { lowerSpecLimit: 90, upperSpecLimit: 110 }
            };
            expect( validContext( ctx ) ).to.equal( true );
        } );

        it( 'should accept context with both operational and specification', function () {
            const ctx = {
                when: { column: 'state', equals: 1 },
                operational: { warningHigh: 80 },
                specification: { lowerSpecLimit: 90, upperSpecLimit: 110 }
            };
            expect( validContext( ctx ) ).to.equal( true );
        } );

        it( 'should accept context with interpretation only', function () {
            const ctx = {
                when: { column: 'state', equals: 0 },
                interpretation: [ 'Severity: higher is worse' ]
            };
            expect( validContext( ctx ) ).to.equal( true );
        } );

        it( 'should accept context with interpretation and operational', function () {
            const ctx = {
                when: { column: 'state', equals: 0 },
                interpretation: [ 'Severity: higher is worse' ],
                operational: { warningHigh: 10 }
            };
            expect( validContext( ctx ) ).to.equal( true );
        } );

        it( 'should accept default context', function () {
            const ctx = {
                when: 'default',
                operational: { warningHigh: 80 }
            };
            expect( validContext( ctx ) ).to.equal( true );
        } );

        it( 'should reject context without operational, specification, or interpretation', function () {
            const ctx = { when: { column: 'state', equals: 1 } };
            expect( validContext( ctx ) ).to.equal( false );
        } );

        it( 'should reject invalid when clause', function () {
            const ctx = {
                when: { column: 'state' },  // missing operator
                operational: { warningHigh: 80 }
            };
            expect( validContext( ctx ) ).to.equal( false );
        } );

        it( 'should reject invalid operational', function () {
            const ctx = {
                when: { column: 'state', equals: 1 },
                operational: { warningLow: 100, warningHigh: 50 }  // out of order
            };
            expect( validContext( ctx ) ).to.equal( false );
        } );

        it( 'should reject invalid specification', function () {
            const ctx = {
                when: { column: 'state', equals: 1 },
                specification: { lowerSpecLimit: 110, upperSpecLimit: 90 }  // lowerSpecLimit > upperSpecLimit
            };
            expect( validContext( ctx ) ).to.equal( false );
        } );

        it( 'should reject invalid interpretation', function () {
            const ctx = {
                when: { column: 'state', equals: 1 },
                interpretation: 'invalid_interpretation'
            };
            expect( validContext( ctx ) ).to.equal( false );
        } );

        it( 'should reject non-objects', function () {
            expect( validContext( null ) ).to.equal( false );
            expect( validContext( 'context' ) ).to.equal( false );
        } );

    } );

    describe( 'validContexts', function () {

        it( 'should accept array of valid contexts', function () {
            const contexts = [
                { when: { column: 'state', equals: 0 }, operational: { warningHigh: 10 } },
                { when: { column: 'state', equals: 1 }, operational: { warningHigh: 80 } },
                { when: 'default', operational: { warningHigh: 50 } }
            ];
            expect( validContexts( contexts ) ).to.equal( true );
        } );

        it( 'should accept empty array', function () {
            expect( validContexts( [] ) ).to.equal( true );
        } );

        it( 'should reject array with invalid context', function () {
            const contexts = [
                { when: { column: 'state', equals: 0 }, operational: { warningHigh: 10 } },
                { when: 'invalid' }  // invalid
            ];
            expect( validContexts( contexts ) ).to.equal( false );
        } );

        it( 'should reject non-arrays', function () {
            expect( validContexts( null ) ).to.equal( false );
            expect( validContexts( {} ) ).to.equal( false );
        } );

        it( 'should accept single default context', function () {
            const contexts = [
                { when: { column: 'state', equals: 0 }, operational: { warningHigh: 10 } },
                { when: 'default', operational: { warningHigh: 50 } }
            ];
            expect( validContexts( contexts ) ).to.equal( true );
        } );

        it( 'should reject multiple default contexts', function () {
            const contexts = [
                { when: 'default', operational: { warningHigh: 50 } },
                { when: { column: 'state', equals: 1 }, operational: { warningHigh: 80 } },
                { when: 'default', operational: { warningHigh: 60 } }  // second default
            ];
            expect( validContexts( contexts ) ).to.equal( false );
        } );

        it( 'should accept zero default contexts', function () {
            const contexts = [
                { when: { column: 'state', equals: 0 }, operational: { warningHigh: 10 } },
                { when: { column: 'state', equals: 1 }, operational: { warningHigh: 80 } }
            ];
            expect( validContexts( contexts ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // CONSTANTS
    // ========================================================================

    describe( 'Constants', function () {

        it( 'should export expected column types', function () {
            expect( COLUMN_TYPES ).to.include( 'float64' );
            expect( COLUMN_TYPES ).to.include( 'int64' );
            expect( COLUMN_TYPES ).to.include( 'string' );
            expect( COLUMN_TYPES ).to.include( 'bool' );
            expect( COLUMN_TYPES ).to.include( 'timestamp' );
        } );

        it( 'should have expected defaults', function () {
            expect( COLUMN_DEFAULTS.unit ).to.equal( '' );
            expect( COLUMN_DEFAULTS.resolution ).to.equal( 1 );
            expect( COLUMN_DEFAULTS.interpretation ).to.deep.equal( [] );
            expect( COLUMN_DEFAULTS.hysteresis ).to.equal( 0 );
        } );

    } );

} );
