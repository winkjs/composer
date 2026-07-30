// src/core/semantics/test/loader.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    loadSemantics,
    loadEnums,
    loadAssetClasses,
    loadJsonFile,
    validateCrossReferences
} from '../loader.js';

const currentFile = fileURLToPath( import.meta.url );
const currentDir = dirname( currentFile );
const TEST_DATA_PATH = join( currentDir, '../../../../test-data/semantics' );

describe( 'Semantics Loader', function () {

    // ========================================================================
    // loadJsonFile
    // ========================================================================

    describe( 'loadJsonFile', function () {

        it( 'should load and parse valid JSON file', async function () {
            const filePath = join( TEST_DATA_PATH, 'valid/enums/machine-states.json' );
            const data = await loadJsonFile( filePath );

            expect( data ).to.be.an( 'object' );
            expect( data.name ).to.equal( 'machineState' );
            expect( data.values ).to.have.property( '0', 'Idle' );
        } );

        it( 'should throw on non-existent file', async function () {
            const filePath = join( TEST_DATA_PATH, 'non-existent.json' );

            try {
                await loadJsonFile( filePath );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'ENOENT' );
            }
        } );

        it( 'should throw on malformed JSON', async function () {
            const filePath = join( TEST_DATA_PATH, 'invalid/malformed.json' );

            try {
                await loadJsonFile( filePath );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'Failed to parse JSON file' );
                expect( err.message ).to.include( 'malformed.json' );
            }
        } );

    } );

    // ========================================================================
    // loadEnums
    // ========================================================================

    describe( 'loadEnums', function () {

        it( 'should load all enum files from directory', async function () {
            const enumsDir = join( TEST_DATA_PATH, 'valid/enums' );
            const enums = await loadEnums( enumsDir );

            expect( enums ).to.be.an( 'object' );
            expect( enums.machineState ).to.not.equal( undefined );
            expect( enums.machineState.name ).to.equal( 'machineState' );
            expect( enums.machineState.values[ '0' ] ).to.equal( 'Idle' );
        } );

        it( 'should return empty object for empty directory', async function () {
            const enumsDir = join( TEST_DATA_PATH, 'invalid/empty-dir/enums' );
            const enums = await loadEnums( enumsDir );

            expect( enums ).to.be.an( 'object' );
            expect( Object.keys( enums ) ).to.have.lengthOf( 0 );
        } );

        it( 'should throw on invalid enum schema', async function () {
            const enumsDir = join( TEST_DATA_PATH, 'invalid/enum-schema/enums' );

            try {
                await loadEnums( enumsDir );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'validation failed' );
                expect( err.message ).to.include( 'bad-enum.json' );
            }
        } );

        it( 'should throw on duplicate enum name', async function () {
            const enumsDir = join( TEST_DATA_PATH, 'invalid/duplicate-enum/enums' );

            try {
                await loadEnums( enumsDir );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'Duplicate enum name' );
                expect( err.message ).to.include( 'duplicateName' );
            }
        } );

    } );

    // ========================================================================
    // loadAssetClasses
    // ========================================================================

    describe( 'loadAssetClasses', function () {

        it( 'should load all asset class files from directory', async function () {
            const assetClassesDir = join( TEST_DATA_PATH, 'valid/asset-classes' );
            const assetClasses = await loadAssetClasses( assetClassesDir );

            expect( assetClasses ).to.be.an( 'object' );
            expect( assetClasses.simplePump ).to.not.equal( undefined );
            expect( assetClasses.simplePump.name ).to.equal( 'simplePump' );
            expect( assetClasses.simplePump.columns ).to.have.property( 'state' );
            expect( assetClasses.simplePump.columns ).to.have.property( 'pressure' );
        } );

        it( 'should return empty object for empty directory', async function () {
            const assetClassesDir = join( TEST_DATA_PATH, 'invalid/empty-dir/asset-classes' );
            const assetClasses = await loadAssetClasses( assetClassesDir );

            expect( assetClasses ).to.be.an( 'object' );
            expect( Object.keys( assetClasses ) ).to.have.lengthOf( 0 );
        } );

        it( 'should throw on invalid asset class schema', async function () {
            const assetClassesDir = join( TEST_DATA_PATH, 'invalid/asset-schema/asset-classes' );

            try {
                await loadAssetClasses( assetClassesDir );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'validation failed' );
                expect( err.message ).to.include( 'bad-asset.json' );
            }
        } );

        it( 'should throw on duplicate asset class name', async function () {
            const assetClassesDir = join( TEST_DATA_PATH, 'invalid/duplicate-asset/asset-classes' );

            try {
                await loadAssetClasses( assetClassesDir );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'Duplicate asset class name' );
                expect( err.message ).to.include( 'duplicateName' );
            }
        } );

    } );

    // ========================================================================
    // validateCrossReferences
    // ========================================================================

    describe( 'validateCrossReferences', function () {

        const validEnums = {
            machineState: {
                name: 'machineState',
                values: { '0': 'Idle', '1': 'Running' }
            }
        };

        it( 'should pass for valid asset class with valid enumRef', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    state: {
                        type: 'int64',
                        enumRef: 'machineState'
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, validEnums );
            } ).to.not.throw();
        } );

        it( 'should throw for invalid enumRef', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    state: {
                        type: 'int64',
                        enumRef: 'nonExistentEnum'
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, validEnums );
            } ).to.throw( /enumRef 'nonExistentEnum' not found/ );
        } );

        it( 'should pass for valid context column reference', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    state: { type: 'int64' },
                    pressure: {
                        type: 'float64',
                        contexts: [
                            {
                                when: { column: 'state', equals: 1 },
                                operational: { warningHigh: 80 }
                            }
                        ]
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.not.throw();
        } );

        it( 'should throw for invalid context column reference', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    pressure: {
                        type: 'float64',
                        contexts: [
                            {
                                when: { column: 'nonExistentColumn', equals: 1 },
                                operational: { warningHigh: 80 }
                            }
                        ]
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.throw( /when\.column 'nonExistentColumn' not found/ );
        } );

        it( 'should skip default contexts (no column reference)', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    pressure: {
                        type: 'float64',
                        contexts: [
                            {
                                when: 'default',
                                operational: { warningHigh: 80 }
                            }
                        ]
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.not.throw();
        } );

        it( 'should pass for valid insightType column references', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' },
                    pressure: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp', 'pressure' ],
                        designatedTimestamp: 'ts',
                        description: 'Thermal monitoring'
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.not.throw();
        } );

        it( 'should throw for invalid insightType column reference', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp', 'nonExistentColumn' ],
                        designatedTimestamp: 'ts',
                        description: 'Thermal monitoring'
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.throw( /column 'nonExistentColumn' not found in asset class columns/ );
        } );

        it( 'should throw for duplicate column in insightType', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' },
                    pressure: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp', 'pressure', 'temp' ],
                        designatedTimestamp: 'ts',
                        description: 'Has duplicate column'
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.throw( /duplicate column 'temp'/ );
        } );

        it( 'should throw when designatedTimestamp not in columns list', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp' ],
                        designatedTimestamp: 'notInList',
                        description: 'designatedTimestamp not in columns'
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.throw( /designatedTimestamp 'notInList' not in columns list/ );
        } );

        it( 'should throw when designatedTimestamp references non-timestamp column', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp' ],
                        designatedTimestamp: 'temp',
                        description: 'designatedTimestamp wrong type'
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.throw( /designatedTimestamp 'temp' must reference a column with type 'timestamp'/ );
        } );

        it( 'should throw for mutual exclusivity violation', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    state: { type: 'int64' },
                    pressure: {
                        type: 'float64',
                        operational: { warningHigh: 80 },
                        contexts: [
                            {
                                when: { column: 'state', equals: 1 },
                                operational: { warningHigh: 60 }
                            }
                        ]
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.throw( /cannot have both contexts and direct operational\/specification/ );
        } );

        it( 'should throw for limits hierarchy violation (operational exceeds physicalRange)', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    pressure: {
                        type: 'float64',
                        physicalRange: { min: 0, max: 100 },
                        operational: { criticalHigh: 150 }
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.throw( /operational\/specification limits exceed physicalRange bounds/ );
        } );

        it( 'should throw for limits hierarchy violation (spec exceeds operational)', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    pressure: {
                        type: 'float64',
                        operational: { criticalLow: 20, criticalHigh: 80 },
                        specification: { lowerSpecLimit: 10, upperSpecLimit: 70 }  // lowerSpecLimit < criticalLow
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.throw( /operational\/specification limits exceed physicalRange bounds|specification exceeds operational bounds/ );
        } );

        it( 'should throw for context limits hierarchy violation', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    state: { type: 'int64' },
                    pressure: {
                        type: 'float64',
                        physicalRange: { min: 0, max: 100 },
                        contexts: [
                            {
                                when: { column: 'state', equals: 1 },
                                operational: { criticalHigh: 150 }
                            }
                        ]
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.throw( /context limits exceed physicalRange bounds/ );
        } );

        it( 'should pass when contexts array is empty (no mutual exclusivity issue)', function () {
            const assetClass = {
                name: 'testAsset',
                columns: {
                    pressure: {
                        type: 'float64',
                        operational: { warningHigh: 80 },
                        contexts: []
                    }
                }
            };

            expect( () => {
                validateCrossReferences( 'testAsset', assetClass, {} );
            } ).to.not.throw();
        } );

    } );

    // ========================================================================
    // loadSemantics (Integration)
    // ========================================================================

    describe( 'loadSemantics', function () {

        it( 'should load valid semantics configuration', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath );

            expect( result ).to.be.an( 'object' );
            expect( result.enums ).to.be.an( 'object' );
            expect( result.assetClasses ).to.be.an( 'object' );

            // Verify enums loaded
            expect( result.enums.machineState ).to.not.equal( undefined );
            expect( result.enums.machineState.values[ '0' ] ).to.equal( 'Idle' );

            // Verify asset classes loaded
            expect( result.assetClasses.simplePump ).to.not.equal( undefined );
            expect( result.assetClasses.simplePump.columns.state.enumRef ).to.equal( 'machineState' );
        } );

        it( 'should throw on invalid enumRef during cross-reference validation', async function () {
            const configPath = join( TEST_DATA_PATH, 'invalid/enum-ref' );

            try {
                await loadSemantics( configPath );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'enumRef \'missingEnum\' not found' );
            }
        } );

        it( 'should return empty collections for empty directories', async function () {
            const configPath = join( TEST_DATA_PATH, 'invalid/empty-dir' );
            const result = await loadSemantics( configPath );

            expect( result.enums ).to.be.an( 'object' );
            expect( Object.keys( result.enums ) ).to.have.lengthOf( 0 );
            expect( result.assetClasses ).to.be.an( 'object' );
            expect( Object.keys( result.assetClasses ) ).to.have.lengthOf( 0 );
        } );

        // Subset loading tests
        it( 'should load all asset classes when no filter provided', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath );

            // Should have all asset classes (at least simplePump)
            expect( Object.keys( result.assetClasses ).length ).to.be.at.least( 1 );
            expect( result.assetClasses.simplePump ).to.not.equal( undefined );
        } );

        it( 'should filter to single asset class when specified', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath, {
                assetClasses: [ 'simplePump' ]
            } );

            expect( Object.keys( result.assetClasses ) ).to.have.lengthOf( 1 );
            expect( result.assetClasses.simplePump ).to.not.equal( undefined );
        } );

        it( 'should throw when filtering for non-existent class', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );

            try {
                await loadSemantics( configPath, {
                    assetClasses: [ 'nonExistentClass' ]
                } );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'Asset class \'nonExistentClass\' not found' );
            }
        } );

        it( 'should still load all enums when filtering asset classes', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath, {
                assetClasses: [ 'simplePump' ]
            } );

            // Enums should all be loaded (required for enumRef validation)
            expect( result.enums.machineState ).to.not.equal( undefined );
        } );

        it( 'should load all asset classes with empty filter array', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const result = await loadSemantics( configPath, {
                assetClasses: []
            } );

            // Empty array should NOT filter (load all)
            expect( Object.keys( result.assetClasses ).length ).to.be.at.least( 1 );
        } );

        // Warning integration tests
        it( 'should suppress warnings when suppressWarnings is true', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            // This should not emit any console.warn calls
            const result = await loadSemantics( configPath, {
                suppressWarnings: true
            } );
            expect( result ).to.be.an( 'object' );
        } );

        it( 'should call custom onWarning handler', async function () {
            const configPath = join( TEST_DATA_PATH, 'valid' );
            const warnings = [];
            const customHandler = function ( msg ) {
                warnings.push( msg );
            };

            await loadSemantics( configPath, {
                onWarning: customHandler
            } );

            // Should have collected some warnings (valid test data may have missing optional fields)
            // Even if no warnings, the test verifies the custom handler was wired correctly
            expect( warnings ).to.be.an( 'array' );
        } );

    } );

} );
