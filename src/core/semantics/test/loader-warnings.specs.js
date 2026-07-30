// src/core/semantics/test/loader-warnings.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    checkMissingInterpretation,
    checkMissingPhysicalRange,
    checkMissingUnit,
    checkUnreferencedEnums,
    checkUnusedColumns,
    checkEnumLikeColumnsWithoutEnumRef
} from '../loader.js';
import { createWarningCollector } from '../warnings.js';

describe( 'Completeness Warning Functions', function () {

    // ========================================================================
    // checkMissingInterpretation
    // ========================================================================

    describe( 'checkMissingInterpretation', function () {

        it( 'should warn for column without interpretation', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                temp: { type: 'float64' }
            };
            checkMissingInterpretation( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 1 );
            expect( collector.getWarnings()[ 0 ] ).to.include( 'missing interpretation' );
        } );

        it( 'should warn for column with empty interpretation array', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                temp: { type: 'float64', interpretation: [] }
            };
            checkMissingInterpretation( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 1 );
        } );

        it( 'should not warn for column with interpretation', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                temp: { type: 'float64', interpretation: [ 'Higher is worse' ] }
            };
            checkMissingInterpretation( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should warn for each column missing interpretation', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                temp: { type: 'float64' },
                pressure: { type: 'float64' },
                name: { type: 'string', interpretation: [ 'Asset identifier' ] }
            };
            checkMissingInterpretation( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 2 );
        } );

    } );

    // ========================================================================
    // checkMissingPhysicalRange
    // ========================================================================

    describe( 'checkMissingPhysicalRange', function () {

        it( 'should warn for float64 column without physicalRange', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                temp: { type: 'float64' }
            };
            checkMissingPhysicalRange( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 1 );
            expect( collector.getWarnings()[ 0 ] ).to.include( 'missing physicalRange' );
        } );

        it( 'should warn for int64 column without physicalRange', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                count: { type: 'int64' }
            };
            checkMissingPhysicalRange( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 1 );
        } );

        it( 'should not warn for numeric column with physicalRange', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                temp: { type: 'float64', physicalRange: { min: 0, max: 100 } }
            };
            checkMissingPhysicalRange( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should not warn for non-numeric columns', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                name: { type: 'string' },
                active: { type: 'bool' },
                ts: { type: 'timestamp' }
            };
            checkMissingPhysicalRange( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

    } );

    // ========================================================================
    // checkMissingUnit
    // ========================================================================

    describe( 'checkMissingUnit', function () {

        it( 'should warn for float64 column without unit', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                temp: { type: 'float64' }
            };
            checkMissingUnit( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 1 );
            expect( collector.getWarnings()[ 0 ] ).to.include( 'missing unit' );
        } );

        it( 'should warn for numeric column with empty unit', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                temp: { type: 'float64', unit: '' }
            };
            checkMissingUnit( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 1 );
        } );

        it( 'should not warn for numeric column with unit', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                temp: { type: 'float64', unit: 'C' }
            };
            checkMissingUnit( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should not warn for non-numeric columns', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                name: { type: 'string' },
                active: { type: 'bool' },
                ts: { type: 'timestamp' }
            };
            checkMissingUnit( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

    } );

    // ========================================================================
    // checkUnreferencedEnums
    // ========================================================================

    describe( 'checkUnreferencedEnums', function () {

        it( 'should warn for enum not referenced by any column', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const enums = {
                machineState: { name: 'machineState', values: { 0: 'Idle', 1: 'Running' } }
            };
            const assetClasses = {
                pump: {
                    columns: {
                        temp: { type: 'float64' }
                    }
                }
            };
            checkUnreferencedEnums( enums, assetClasses, collector );
            expect( collector.count() ).to.equal( 1 );
            expect( collector.getWarnings()[ 0 ] ).to.include( 'not referenced' );
        } );

        it( 'should not warn for referenced enum', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const enums = {
                machineState: { name: 'machineState', values: { 0: 'Idle', 1: 'Running' } }
            };
            const assetClasses = {
                pump: {
                    columns: {
                        state: { type: 'int64', enumRef: 'machineState' }
                    }
                }
            };
            checkUnreferencedEnums( enums, assetClasses, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should check across multiple asset classes', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const enums = {
                machineState: { name: 'machineState', values: { 0: 'Idle', 1: 'Running' } },
                alertType: { name: 'alertType', values: { 0: 'Info', 1: 'Warning' } }
            };
            const assetClasses = {
                pump: {
                    columns: {
                        state: { type: 'int64', enumRef: 'machineState' }
                    }
                },
                motor: {
                    columns: {
                        temp: { type: 'float64' }
                    }
                }
            };
            checkUnreferencedEnums( enums, assetClasses, collector );
            expect( collector.count() ).to.equal( 1 );
            expect( collector.getWarnings()[ 0 ] ).to.include( 'alertType' );
        } );

        it( 'should not warn when no enums defined', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            checkUnreferencedEnums( {}, { pump: { columns: {} } }, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

    } );

    // ========================================================================
    // checkUnusedColumns
    // ========================================================================

    describe( 'checkUnusedColumns', function () {

        it( 'should warn for column not used in any insightType', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const assetClass = {
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' },
                    unusedCol: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp' ],
                        designatedTimestamp: 'ts'
                    }
                }
            };
            checkUnusedColumns( 'testAsset', assetClass, collector );
            expect( collector.count() ).to.equal( 1 );
            expect( collector.getWarnings()[ 0 ] ).to.include( 'unusedCol' );
            expect( collector.getWarnings()[ 0 ] ).to.include( 'not used in any insightType' );
        } );

        it( 'should not warn for columns used in insightTypes', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const assetClass = {
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp' ],
                        designatedTimestamp: 'ts'
                    }
                }
            };
            checkUnusedColumns( 'testAsset', assetClass, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should check across multiple insightTypes', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const assetClass = {
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' },
                    pressure: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp' ],
                        designatedTimestamp: 'ts'
                    },
                    pressure: {
                        columns: [ 'ts', 'pressure' ],
                        designatedTimestamp: 'ts'
                    }
                }
            };
            checkUnusedColumns( 'testAsset', assetClass, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should warn for all unused columns', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const assetClass = {
                columns: {
                    ts: { type: 'timestamp' },
                    unused1: { type: 'float64' },
                    unused2: { type: 'float64' }
                },
                insightTypes: {
                    basic: {
                        columns: [ 'ts' ],
                        designatedTimestamp: 'ts'
                    }
                }
            };
            checkUnusedColumns( 'testAsset', assetClass, collector );
            expect( collector.count() ).to.equal( 2 );
        } );

    } );

    // ========================================================================
    // checkEnumLikeColumnsWithoutEnumRef
    // ========================================================================

    describe( 'checkEnumLikeColumnsWithoutEnumRef', function () {

        it( 'should warn for int64 column with small range without enumRef', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                state: {
                    type: 'int64',
                    physicalRange: { min: 0, max: 5 }
                }
            };
            checkEnumLikeColumnsWithoutEnumRef( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 1 );
            expect( collector.getWarnings()[ 0 ] ).to.include( 'may need enumRef' );
        } );

        it( 'should not warn for int64 column with enumRef', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                state: {
                    type: 'int64',
                    physicalRange: { min: 0, max: 5 },
                    enumRef: 'machineState'
                }
            };
            checkEnumLikeColumnsWithoutEnumRef( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should not warn for int64 column with large range', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                count: {
                    type: 'int64',
                    physicalRange: { min: 0, max: 1000 }
                }
            };
            checkEnumLikeColumnsWithoutEnumRef( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should not warn for int64 column without physicalRange', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                count: { type: 'int64' }
            };
            checkEnumLikeColumnsWithoutEnumRef( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should not warn for float64 columns', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                ratio: {
                    type: 'float64',
                    physicalRange: { min: 0, max: 1 }
                }
            };
            checkEnumLikeColumnsWithoutEnumRef( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

        it( 'should warn for range exactly at threshold', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                state: {
                    type: 'int64',
                    physicalRange: { min: 0, max: 19 }  // range = 19, < 20 threshold
                }
            };
            checkEnumLikeColumnsWithoutEnumRef( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 1 );
        } );

        it( 'should not warn for range at threshold boundary', function () {
            const collector = createWarningCollector( { suppressWarnings: true } );
            const columns = {
                state: {
                    type: 'int64',
                    physicalRange: { min: 0, max: 20 }  // range = 20, == threshold
                }
            };
            checkEnumLikeColumnsWithoutEnumRef( 'testAsset', columns, collector );
            expect( collector.count() ).to.equal( 0 );
        } );

    } );

} );
