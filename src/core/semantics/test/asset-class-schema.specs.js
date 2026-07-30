// src/core/semantics/test/asset-class-schema.specs.js

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    assetClassSchema,
    validColumnsStructure,
    validInsightType,
    validInsightTypes
} from '../schemas/index.js';
import { validateWithSchema } from '../../utils/validate/index.js';

describe( 'Asset Class Schema Validators', function () {

    // ========================================================================
    // validColumnsStructure
    // ========================================================================

    describe( 'validColumnsStructure', function () {

        it( 'should accept valid columns object with identifier keys', function () {
            const columns = {
                temperature: { type: 'float64' },
                pressure: { type: 'float64' }
            };
            expect( validColumnsStructure( columns ) ).to.equal( true );
        } );

        it( 'should accept single column', function () {
            const columns = { temp: { type: 'float64' } };
            expect( validColumnsStructure( columns ) ).to.equal( true );
        } );

        it( 'should reject empty object', function () {
            expect( validColumnsStructure( {} ) ).to.equal( false );
        } );

        it( 'should reject null', function () {
            expect( validColumnsStructure( null ) ).to.equal( false );
        } );

        it( 'should reject non-object', function () {
            expect( validColumnsStructure( 'string' ) ).to.equal( false );
            expect( validColumnsStructure( 123 ) ).to.equal( false );
        } );

        it( 'should reject invalid identifier keys', function () {
            const columns = { '123invalid': { type: 'float64' } };
            expect( validColumnsStructure( columns ) ).to.equal( false );
        } );

        it( 'should reject keys with spaces', function () {
            const columns = { 'has space': { type: 'float64' } };
            expect( validColumnsStructure( columns ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // validInsightType
    // ========================================================================

    describe( 'validInsightType', function () {

        it( 'should accept valid insightType with columns array and designatedTimestamp', function () {
            const spec = { columns: [ 'ts', 'temp', 'pressure' ], designatedTimestamp: 'ts' };
            expect( validInsightType( spec ) ).to.equal( true );
        } );

        it( 'should accept insightType with single column', function () {
            const spec = { columns: [ 'ts' ], designatedTimestamp: 'ts' };
            expect( validInsightType( spec ) ).to.equal( true );
        } );

        it( 'should reject null', function () {
            expect( validInsightType( null ) ).to.equal( false );
        } );

        it( 'should reject non-object', function () {
            expect( validInsightType( 'string' ) ).to.equal( false );
        } );

        it( 'should reject missing columns', function () {
            expect( validInsightType( {} ) ).to.equal( false );
        } );

        it( 'should reject empty columns array', function () {
            const spec = { columns: [] };
            expect( validInsightType( spec ) ).to.equal( false );
        } );

        it( 'should reject non-array columns', function () {
            const spec = { columns: 'temp' };
            expect( validInsightType( spec ) ).to.equal( false );
        } );

        it( 'should reject non-string column names', function () {
            const spec = { columns: [ 123 ] };
            expect( validInsightType( spec ) ).to.equal( false );
        } );

        it( 'should reject empty string column names', function () {
            const spec = { columns: [ '' ] };
            expect( validInsightType( spec ) ).to.equal( false );
        } );

        it( 'should reject missing designatedTimestamp', function () {
            const spec = { columns: [ 'ts', 'temp' ] };
            expect( validInsightType( spec ) ).to.equal( false );
        } );

        it( 'should reject null designatedTimestamp', function () {
            const spec = { columns: [ 'ts', 'temp' ], designatedTimestamp: null };
            expect( validInsightType( spec ) ).to.equal( false );
        } );

        it( 'should reject non-string designatedTimestamp', function () {
            const spec = { columns: [ 'ts', 'temp' ], designatedTimestamp: 123 };
            expect( validInsightType( spec ) ).to.equal( false );
        } );

        it( 'should reject empty string designatedTimestamp', function () {
            const spec = { columns: [ 'ts', 'temp' ], designatedTimestamp: '' };
            expect( validInsightType( spec ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // validInsightTypes
    // ========================================================================

    describe( 'validInsightTypes', function () {

        it( 'should accept valid insightTypes object', function () {
            const insightTypes = {
                thermal: { columns: [ 'ts', 'temp', 'pressure' ], designatedTimestamp: 'ts' },
                electrical: { columns: [ 'ts', 'voltage', 'current' ], designatedTimestamp: 'ts' }
            };
            expect( validInsightTypes( insightTypes ) ).to.equal( true );
        } );

        it( 'should accept empty insightTypes object', function () {
            expect( validInsightTypes( {} ) ).to.equal( true );
        } );

        it( 'should reject null', function () {
            expect( validInsightTypes( null ) ).to.equal( false );
        } );

        it( 'should reject non-object', function () {
            expect( validInsightTypes( 'string' ) ).to.equal( false );
        } );

        it( 'should reject invalid insightType name (not identifier)', function () {
            const insightTypes = { '123invalid': { columns: [ 'temp' ] } };
            expect( validInsightTypes( insightTypes ) ).to.equal( false );
        } );

        it( 'should reject invalid insightType entry', function () {
            const insightTypes = { thermal: { columns: [] } };
            expect( validInsightTypes( insightTypes ) ).to.equal( false );
        } );

    } );

    // ========================================================================
    // Unknown Property Detection
    // ========================================================================

    describe( 'Unknown Property Detection', function () {

        it( 'should accept valid asset class with all known properties', function () {
            const validAssetClass = {
                name: 'testAsset',
                description: 'A test asset class',
                columns: {
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: { columns: [ 'temp' ], designatedTimestamp: 'temp' }
                }
            };
            const result = validateWithSchema( assetClassSchema, validAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should accept valid asset class without optional description', function () {
            const validAssetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                }
            };
            const result = validateWithSchema( assetClassSchema, validAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should reject asset class with unknown property', function () {
            const invalidAssetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                },
                unknownProperty: 'should cause error'
            };
            const result = validateWithSchema( assetClassSchema, invalidAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Unknown property \'unknownProperty\'' );
        } );

        it( 'should reject asset class with inline enums property', function () {
            // The key case for this rule: inline enums are not allowed —
            // enums are separate shared definitions that columns point at
            // via `enumRef`, never defined inside an asset class.
            const invalidAssetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' }
                },
                enums: {
                    tempRegime: {
                        values: [ 'cold', 'warm', 'hot' ]
                    }
                }
            };
            const result = validateWithSchema( assetClassSchema, invalidAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'Unknown property \'enums\'' );
        } );

        it( 'should reject asset class with multiple unknown properties', function () {
            const invalidAssetClass = {
                name: 'testAsset',
                columns: {
                    temp: { type: 'float64' }
                },
                extra1: 'bad',
                extra2: 'also bad'
            };
            const result = validateWithSchema( assetClassSchema, invalidAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.length ).to.be.at.least( 2 );
        } );

        it( 'should reject unknown property in insightType entry', function () {
            const invalidAssetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp' ],
                        designatedTimestamp: 'ts',
                        unknownField: 'should cause error'
                    }
                }
            };
            const result = validateWithSchema( assetClassSchema, invalidAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'unknownField' );
        } );

        it( 'should accept insightType with optional description', function () {
            const validAssetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columns: [ 'ts', 'temp' ],
                        designatedTimestamp: 'ts',
                        description: 'Thermal monitoring'
                    }
                }
            };
            const result = validateWithSchema( assetClassSchema, validAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should reject insightType with typo in property name', function () {
            const invalidAssetClass = {
                name: 'testAsset',
                columns: {
                    ts: { type: 'timestamp' },
                    temp: { type: 'float64' }
                },
                insightTypes: {
                    thermal: {
                        columsn: [ 'ts', 'temp' ],  // typo: columsn instead of columns
                        designatedTimestamp: 'ts'
                    }
                }
            };
            const result = validateWithSchema( assetClassSchema, invalidAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( false );
            expect( result.errors.some( ( e ) => e.includes( 'columsn' ) ) ).to.equal( true );
        } );

    } );

    // ========================================================================
    // insightTypes Required
    // ========================================================================

    describe( 'insightTypes Required', function () {

        it( 'should reject asset class without insightTypes', function () {
            const invalidAssetClass = {
                name: 'testAsset',
                columns: {
                    temp: { type: 'float64' }
                }
            };
            const result = validateWithSchema( assetClassSchema, invalidAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'insightTypes' );
        } );

        it( 'should reject asset class with empty insightTypes', function () {
            const invalidAssetClass = {
                name: 'testAsset',
                columns: {
                    temp: { type: 'float64' }
                },
                insightTypes: {}
            };
            const result = validateWithSchema( assetClassSchema, invalidAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'insightTypes' );
        } );

        it( 'should accept asset class with at least one insightType', function () {
            const validAssetClass = {
                name: 'testAsset',
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
            const result = validateWithSchema( assetClassSchema, validAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( true );
        } );

        it( 'should include asset class name in error path', function () {
            const invalidAssetClass = {
                name: 'testAsset',
                columns: {
                    temp: { type: 'float64' }
                }
            };
            const result = validateWithSchema( assetClassSchema, invalidAssetClass, 'assetClass' );
            expect( result.valid ).to.equal( false );
            expect( result.errors[ 0 ] ).to.include( 'assetClass' );
        } );

    } );

} );
