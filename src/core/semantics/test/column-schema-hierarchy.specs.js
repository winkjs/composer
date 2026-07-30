// src/core/semantics/test/column-schema-hierarchy.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    validLimitsMutualExclusivity,
    validLimitsHierarchy,
    validContextLimitsHierarchy
} from '../schemas/index.js';

describe( 'Column Schema Limits & Hierarchy Validators', function () {

    // ========================================================================
    // MUTUAL EXCLUSIVITY
    // ========================================================================

    describe( 'validLimitsMutualExclusivity', function () {

        it( 'should accept column with only direct operational', function () {
            const column = {
                type: 'float64',
                operational: { warningHigh: 80 }
            };
            expect( validLimitsMutualExclusivity( column ) ).to.equal( true );
        } );

        it( 'should accept column with only direct specification', function () {
            const column = {
                type: 'float64',
                specification: { lowerSpecLimit: 90, upperSpecLimit: 110 }
            };
            expect( validLimitsMutualExclusivity( column ) ).to.equal( true );
        } );

        it( 'should accept column with both direct operational and specification', function () {
            const column = {
                type: 'float64',
                operational: { warningHigh: 80 },
                specification: { lowerSpecLimit: 90, upperSpecLimit: 110 }
            };
            expect( validLimitsMutualExclusivity( column ) ).to.equal( true );
        } );

        it( 'should accept column with only contexts', function () {
            const column = {
                type: 'float64',
                contexts: [
                    { when: { column: 'state', equals: 1 }, operational: { warningHigh: 80 } }
                ]
            };
            expect( validLimitsMutualExclusivity( column ) ).to.equal( true );
        } );

        it( 'should accept column with physicalRange and contexts', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                contexts: [
                    { when: { column: 'state', equals: 1 }, operational: { warningHigh: 80 } }
                ]
            };
            expect( validLimitsMutualExclusivity( column ) ).to.equal( true );
        } );

        it( 'should accept column with no limits', function () {
            const column = { type: 'float64' };
            expect( validLimitsMutualExclusivity( column ) ).to.equal( true );
        } );

        it( 'should accept column with empty contexts array', function () {
            const column = {
                type: 'float64',
                operational: { warningHigh: 80 },
                contexts: []
            };
            expect( validLimitsMutualExclusivity( column ) ).to.equal( true );
        } );

        it( 'should reject column with contexts AND direct operational', function () {
            const column = {
                type: 'float64',
                operational: { warningHigh: 80 },
                contexts: [
                    { when: { column: 'state', equals: 1 }, operational: { warningHigh: 60 } }
                ]
            };
            expect( validLimitsMutualExclusivity( column ) ).to.equal( false );
        } );

        it( 'should reject column with contexts AND direct specification', function () {
            const column = {
                type: 'float64',
                specification: { lowerSpecLimit: 90, upperSpecLimit: 110 },
                contexts: [
                    { when: { column: 'state', equals: 1 }, operational: { warningHigh: 60 } }
                ]
            };
            expect( validLimitsMutualExclusivity( column ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // LIMITS HIERARCHY
    // ========================================================================

    describe( 'validLimitsHierarchy', function () {

        // Valid cases
        it( 'should accept column with no limits', function () {
            const column = { type: 'float64' };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept column with only physicalRange', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept column with only operational', function () {
            const column = {
                type: 'float64',
                operational: { warningHigh: 80 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept column with only specification', function () {
            const column = {
                type: 'float64',
                specification: { lowerSpecLimit: 90, upperSpecLimit: 110 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept operational within physicalRange', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                operational: { criticalLow: 10, warningHigh: 80, criticalHigh: 90 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept specification within physicalRange', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 200 },
                specification: { lowerSpecLimit: 90, target: 100, upperSpecLimit: 110 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept specification within operational (no physicalRange)', function () {
            const column = {
                type: 'float64',
                operational: { criticalLow: 0, criticalHigh: 100 },
                specification: { lowerSpecLimit: 10, upperSpecLimit: 90 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept all three tiers with valid hierarchy', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 200 },
                operational: { criticalLow: 10, criticalHigh: 190 },
                specification: { lowerSpecLimit: 20, upperSpecLimit: 180 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept operational at physicalRange boundary', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                operational: { criticalLow: 0, criticalHigh: 100 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept specification at operational boundary', function () {
            const column = {
                type: 'float64',
                operational: { criticalLow: 10, criticalHigh: 90 },
                specification: { lowerSpecLimit: 10, upperSpecLimit: 90 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( true );
        } );

        // Invalid cases - operational exceeds physicalRange
        it( 'should reject operational criticalLow below physicalRange min', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                operational: { criticalLow: -10 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( false );
        } );

        it( 'should reject operational criticalHigh above physicalRange max', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                operational: { criticalHigh: 110 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( false );
        } );

        it( 'should reject operational target outside physicalRange', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                operational: { target: 150 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( false );
        } );

        // Invalid cases - specification exceeds physicalRange
        it( 'should reject specification lowerSpecLimit below physicalRange min', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                specification: { lowerSpecLimit: -5, upperSpecLimit: 50 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( false );
        } );

        it( 'should reject specification upperSpecLimit above physicalRange max', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                specification: { lowerSpecLimit: 50, upperSpecLimit: 150 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( false );
        } );

        // Invalid cases - specification exceeds operational (no physicalRange)
        it( 'should reject specification lowerSpecLimit below operational criticalLow', function () {
            const column = {
                type: 'float64',
                operational: { criticalLow: 20, criticalHigh: 80 },
                specification: { lowerSpecLimit: 10, upperSpecLimit: 70 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( false );
        } );

        it( 'should reject specification upperSpecLimit above operational criticalHigh', function () {
            const column = {
                type: 'float64',
                operational: { criticalLow: 20, criticalHigh: 80 },
                specification: { lowerSpecLimit: 30, upperSpecLimit: 90 }
            };
            expect( validLimitsHierarchy( column ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // CONTEXT LIMITS HIERARCHY
    // ========================================================================

    describe( 'validContextLimitsHierarchy', function () {

        // Valid cases
        it( 'should accept column with no contexts', function () {
            const column = { type: 'float64' };
            expect( validContextLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept column with empty contexts array', function () {
            const column = {
                type: 'float64',
                contexts: []
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept context operational within physicalRange', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { warningHigh: 80, criticalHigh: 90 }
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept context specification within physicalRange', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 200 },
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        specification: { lowerSpecLimit: 90, upperSpecLimit: 110 }
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept context specification within context operational', function () {
            const column = {
                type: 'float64',
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { criticalLow: 10, criticalHigh: 90 },
                        specification: { lowerSpecLimit: 20, upperSpecLimit: 80 }
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( true );
        } );

        it( 'should accept multiple valid contexts', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                contexts: [
                    {
                        when: { column: 'state', equals: 0 },
                        operational: { warningHigh: 20 }
                    },
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { warningHigh: 80 }
                    },
                    {
                        when: 'default',
                        operational: { warningHigh: 50 }
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( true );
        } );

        // Invalid cases - context operational exceeds physicalRange
        it( 'should reject context operational exceeding physicalRange', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { criticalHigh: 110 }
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( false );
        } );

        it( 'should reject context operational below physicalRange', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { criticalLow: -10 }
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( false );
        } );

        // Invalid cases - context specification exceeds physicalRange
        it( 'should reject context specification exceeding physicalRange', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        specification: { lowerSpecLimit: 40, upperSpecLimit: 150 }
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( false );
        } );

        // Invalid cases - context specification exceeds context operational
        it( 'should reject context spec lowerSpecLimit below context operational criticalLow', function () {
            const column = {
                type: 'float64',
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { criticalLow: 20, criticalHigh: 80 },
                        specification: { lowerSpecLimit: 10, upperSpecLimit: 70 }
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( false );
        } );

        it( 'should reject context spec upperSpecLimit above context operational criticalHigh', function () {
            const column = {
                type: 'float64',
                contexts: [
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { criticalLow: 20, criticalHigh: 80 },
                        specification: { lowerSpecLimit: 30, upperSpecLimit: 90 }
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( false );
        } );

        // Mixed valid and invalid contexts
        it( 'should reject if any context violates hierarchy', function () {
            const column = {
                type: 'float64',
                physicalRange: { min: 0, max: 100 },
                contexts: [
                    {
                        when: { column: 'state', equals: 0 },
                        operational: { warningHigh: 50 }  // valid
                    },
                    {
                        when: { column: 'state', equals: 1 },
                        operational: { warningHigh: 150 }  // invalid
                    }
                ]
            };
            expect( validContextLimitsHierarchy( column ) ).to.equal( false );
        } );

    } );

} );
