// core/wiring/test/wire-semantics.specs.js

/**
 * @fileoverview Unit tests for the wire-semantics helper.
 *
 * Covers every branch of `applySemanticsRequirement`:
 * - adapter declares nothing → no-op
 * - adapter declares assetClass.required + runtime supplied → slice injected
 * - adapter declares assetClass.required + runtime missing → throws MISSING_ASSET_CLASS
 * - adapter declares assetClass (not required) + runtime missing → no-op (no throw)
 * - adapter declares assetClass (not required) + runtime supplied → slice injected
 * - sliceAssetClass: produces fresh prototype-less object containing only requested fields
 * - sliceAssetClass: missing source field comes through as undefined
 * - sliceAssetClass: source object is not mutated
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { applySemanticsRequirement, sliceAssetClass } from '../wire-semantics.js';

describe( 'wire-semantics', function () {

    // ========================================================================
    // sliceAssetClass — pure helper for top-level field projection
    // ========================================================================

    describe( 'sliceAssetClass', function () {

        const fullAssetClass = {
            name: 'pump',
            description: 'industrial pump',
            columns: { ts: { type: 'timestamp' }, temp: { type: 'float64', resolution: 0.1 } },
            insightTypes: { monitoring: { columns: [ 'ts', 'temp' ], designatedTimestamp: 'ts' } }
        };

        it( 'returns an object containing exactly the requested fields', function () {
            const slice = sliceAssetClass( fullAssetClass, [ 'name', 'columns', 'insightTypes' ] );

            expect( Object.keys( slice ).sort() ).to.deep.equal(
                [ 'columns', 'insightTypes', 'name' ]
            );
            expect( slice.name ).to.equal( 'pump' );
            expect( slice.columns ).to.equal( fullAssetClass.columns );
            expect( slice.insightTypes ).to.equal( fullAssetClass.insightTypes );
        } );

        it( 'omits fields not requested', function () {
            const slice = sliceAssetClass( fullAssetClass, [ 'name', 'columns', 'insightTypes' ] );

            expect( slice ).to.not.have.property( 'description' );
        } );

        it( 'returns prototype-less object (Object.create(null))', function () {
            const slice = sliceAssetClass( fullAssetClass, [ 'name' ] );

            // Prototype-less object has no inherited methods / properties.
            // Defensive choice — adapter declaration could in principle name
            // a field like '__proto__', and Object.create(null) treats that
            // as a regular property assignment rather than mutating prototype.
            expect( Object.getPrototypeOf( slice ) ).to.equal( null );
        } );

        it( 'represents missing source fields as undefined (not error)', function () {
            const slice = sliceAssetClass( fullAssetClass, [ 'name', 'thisFieldDoesNotExist' ] );

            expect( slice.name ).to.equal( 'pump' );
            expect( slice.thisFieldDoesNotExist ).to.equal( undefined );
        } );

        it( 'does not mutate the source assetClass', function () {
            const sourceBefore = JSON.stringify( fullAssetClass );

            sliceAssetClass( fullAssetClass, [ 'name', 'columns' ] );

            expect( JSON.stringify( fullAssetClass ) ).to.equal( sourceBefore );
        } );

        it( 'returns an empty prototype-less object when fields list is empty', function () {
            const slice = sliceAssetClass( fullAssetClass, [] );

            expect( Object.keys( slice ) ).to.deep.equal( [] );
            expect( Object.getPrototypeOf( slice ) ).to.equal( null );
        } );

    } );

    // ========================================================================
    // applySemanticsRequirement — read declaration, validate, inject slice
    // ========================================================================

    describe( 'applySemanticsRequirement', function () {

        const sampleAssetClass = {
            name: 'pump',
            description: 'industrial pump',
            columns: { ts: { type: 'timestamp' } },
            insightTypes: { monitoring: { columns: [ 'ts' ], designatedTimestamp: 'ts' } }
        };

        it( 'returns false and no-ops when adapter declares no semanticsRequirement', function () {
            const adapter = { id: 'noDeclaration' };
            const effectiveConfig = { someUserField: 'x' };

            const handled = applySemanticsRequirement( 'noDeclaration', adapter, sampleAssetClass, effectiveConfig );

            expect( handled ).to.equal( false );
            expect( effectiveConfig ).to.deep.equal( { someUserField: 'x' } );
        } );

        it( 'returns false when semanticsRequirement is an empty object', function () {
            // Empty `{}` declaration is equivalent to "no declaration" — adapter
            // explicitly opts in to the mechanism but declares no specific
            // capability. No-op.
            const adapter = { id: 'emptyDeclaration', semanticsRequirement: {} };
            const effectiveConfig = {};

            const handled = applySemanticsRequirement( 'emptyDeclaration', adapter, sampleAssetClass, effectiveConfig );

            expect( handled ).to.equal( false );
            expect( effectiveConfig ).to.deep.equal( {} );
        } );

        it( 'injects sliced assetClass when declared+required and runtime supplies it', function () {
            const adapter = {
                id: 'questdb',
                semanticsRequirement: {
                    assetClass: { required: true, fields: [ 'name', 'columns', 'insightTypes' ] }
                }
            };
            const effectiveConfig = { ilpUrl: 'localhost:9000' };

            const handled = applySemanticsRequirement( 'questdb', adapter, sampleAssetClass, effectiveConfig );

            expect( handled ).to.equal( true );
            expect( effectiveConfig.assetClass ).to.not.equal( undefined );
            expect( effectiveConfig.assetClass.name ).to.equal( 'pump' );
            expect( effectiveConfig.assetClass.columns ).to.equal( sampleAssetClass.columns );
            expect( effectiveConfig.assetClass.insightTypes ).to.equal( sampleAssetClass.insightTypes );
            expect( effectiveConfig.assetClass ).to.not.have.property( 'description' );
            // Pre-existing user config preserved
            expect( effectiveConfig.ilpUrl ).to.equal( 'localhost:9000' );
        } );

        it( 'injects sliced assetClass when declared (not required) and runtime supplies it', function () {
            const adapter = {
                id: 'terminal',
                semanticsRequirement: {
                    assetClass: { required: false, fields: [ 'columns' ] }
                }
            };
            const effectiveConfig = {};

            const handled = applySemanticsRequirement( 'terminal', adapter, sampleAssetClass, effectiveConfig );

            expect( handled ).to.equal( true );
            expect( effectiveConfig.assetClass ).to.not.equal( undefined );
            expect( Object.keys( effectiveConfig.assetClass ) ).to.deep.equal( [ 'columns' ] );
            expect( effectiveConfig.assetClass.columns ).to.equal( sampleAssetClass.columns );
        } );

        it( 'throws MISSING_ASSET_CLASS when declared+required but runtime is null', function () {
            const adapter = {
                id: 'questdb',
                semanticsRequirement: {
                    assetClass: { required: true, fields: [ 'name', 'columns', 'insightTypes' ] }
                }
            };
            const effectiveConfig = {};
            let thrown;

            try {
                applySemanticsRequirement( 'questdb', adapter, null, effectiveConfig );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'MISSING_ASSET_CLASS' );
            expect( thrown.message ).to.include( 'questdb' );
            expect( thrown.message ).to.include( 'add .assetClass(assetClassDef)' );
            // No injection happened
            expect( effectiveConfig ).to.not.have.property( 'assetClass' );
        } );

        it( 'throws MISSING_ASSET_CLASS when declared+required but runtime is undefined', function () {
            // Same path as null — both signal "flow author did not call .assetClass()"
            const adapter = {
                id: 'questdb',
                semanticsRequirement: {
                    assetClass: { required: true, fields: [ 'name' ] }
                }
            };
            let thrown;

            try {
                applySemanticsRequirement( 'questdb', adapter, undefined, {} );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.code ).to.equal( 'MISSING_ASSET_CLASS' );
        } );

        it( 'returns true and no-injects when declared (not required) and runtime is null', function () {
            // Optional declaration + missing runtime: declaration was honored,
            // there was just nothing to inject. Adapter sees no assetClass on
            // its config and is responsible for handling that gracefully.
            const adapter = {
                id: 'terminal',
                semanticsRequirement: {
                    assetClass: { required: false, fields: [ 'columns' ] }
                }
            };
            const effectiveConfig = { precision: 2 };

            const handled = applySemanticsRequirement( 'terminal', adapter, null, effectiveConfig );

            expect( handled ).to.equal( true );
            expect( effectiveConfig ).to.deep.equal( { precision: 2 } );
            expect( effectiveConfig ).to.not.have.property( 'assetClass' );
        } );

        it( 'tolerates assetClass declaration with missing fields array (treats as empty)', function () {
            // Defensive: an adapter that declares `assetClass: { required: true }`
            // without a fields array is valid (declares "I need an assetClass to
            // exist but I read nothing specific"). Slice is empty.
            const adapter = {
                id: 'weird',
                semanticsRequirement: {
                    assetClass: { required: true }
                }
            };
            const effectiveConfig = {};

            const handled = applySemanticsRequirement( 'weird', adapter, sampleAssetClass, effectiveConfig );

            expect( handled ).to.equal( true );
            expect( effectiveConfig.assetClass ).to.not.equal( undefined );
            expect( Object.keys( effectiveConfig.assetClass ) ).to.deep.equal( [] );
        } );

        it( 'preserves any pre-existing effectiveConfig.assetClass when declaration is absent', function () {
            // No declaration → no-op, even if effectiveConfig already had an
            // assetClass set somehow (e.g., legacy fallback path during the
            // wire-storages transition window). The helper does not touch what
            // it didn't put there.
            const adapter = { id: 'noDeclaration' };
            const preExisting = { name: 'preExisting' };
            const effectiveConfig = { assetClass: preExisting };

            const handled = applySemanticsRequirement( 'noDeclaration', adapter, sampleAssetClass, effectiveConfig );

            expect( handled ).to.equal( false );
            expect( effectiveConfig.assetClass ).to.equal( preExisting );
        } );

    } );

} );
