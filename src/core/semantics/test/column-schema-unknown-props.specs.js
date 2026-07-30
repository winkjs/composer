// src/core/semantics/test/column-schema-unknown-props.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    columnSchema,
    validWhen
} from '../schemas/index.js';
import { validateWithSchema } from '../../utils/validate/index.js';

describe( 'Column Schema Unknown Property Detection', function () {

    // ========================================================================
    // UNKNOWN PROPERTY DETECTION
    // ========================================================================

    describe( 'Unknown Property Detection', function () {

        it( 'should accept column with all known properties', function () {
            const column = {
                type: 'float64',
                unit: 'kPa',
                resolution: 0.1,
                description: 'Test column',
                interpretation: [ 'Severity: higher is worse' ],
                hysteresis: 5,
                physicalRange: { min: 0, max: 100 },
                operational: { warningHigh: 80 }
            };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should accept minimal column with only required type', function () {
            const column = { type: 'float64' };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should reject column with unknown property', function () {
            const column = {
                type: 'float64',
                unknownProp: 'should cause error'
            };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Unknown property \'unknownProp\'' );
        } );

        it( 'should reject column with typo in property name', function () {
            const column = {
                type: 'float64',
                physcalRange: { min: 0, max: 100 }  // typo: physcalRange instead of physicalRange
            };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'physcalRange' );
        } );

        it( 'should reject column with multiple unknown properties', function () {
            const column = {
                type: 'float64',
                extra1: 'bad',
                extra2: 'also bad'
            };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.length ).to.be.at.least( 2 );
        } );

        it( 'should accept column with enumRef', function () {
            const column = {
                type: 'string',
                enumRef: 'tempRegime'
            };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should accept column with contexts', function () {
            const column = {
                type: 'float64',
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { warningHigh: 80 }
                    }
                ]
            };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should accept column with specification', function () {
            const column = {
                type: 'float64',
                specification: { lowerSpecLimit: 90, upperSpecLimit: 110 }
            };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should reject unknown property in context entry', function () {
            const column = {
                type: 'float64',
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { warningHigh: 80 },
                        unknownField: 'should cause error'
                    }
                ]
            };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'unknownField' );
        } );

        it( 'should reject context with typo in property name', function () {
            const column = {
                type: 'float64',
                contexts: [
                    {
                        wehn: { column: 'state', equals: 1 },  // typo: wehn instead of when
                        operational: { warningHigh: 80 }
                    }
                ]
            };
            const result = validateWithSchema( columnSchema, column, 'column' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'wehn' ) ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // NESTED WHEN CLAUSE UNKNOWN PROPERTY DETECTION
    // ========================================================================

    describe( 'When Clause Unknown Property Detection', function () {

        it( 'should reject unknown property in when clause', function () {
            const when = {
                column: 'state',
                equals: 1,
                unknownField: 'should cause error'
            };
            expect( validWhen( when ) ).to.equal( false );
        } );

        it( 'should reject when clause with typo in property name', function () {
            const when = {
                colunm: 'state',  // typo: colunm instead of column
                equals: 1
            };
            expect( validWhen( when ) ).to.equal( false );
        } );

        it( 'should reject when clause with invalid operator name', function () {
            const when = {
                column: 'state',
                equal: 1  // typo: equal instead of equals
            };
            expect( validWhen( when ) ).to.equal( false );
        } );

        it( 'should accept valid when clause with equals', function () {
            const when = {
                column: 'state',
                equals: 1
            };
            expect( validWhen( when ) ).to.equal( true );
        } );

        it( 'should accept valid when clause with oneOf', function () {
            const when = {
                column: 'state',
                oneOf: [ 1, 2, 3 ]
            };
            expect( validWhen( when ) ).to.equal( true );
        } );

    } );

} );
