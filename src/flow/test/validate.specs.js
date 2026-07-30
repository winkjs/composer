// flow/test/validate.specs.js

/**
 * @fileoverview Tests for flow validation module.
 *
 * Specifically tests:
 * - validateInsightTypeReferences() for asset class validation
 * - validateFlow() and validateFlowOrThrow() integration
 */

/* eslint-disable no-unused-expressions */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validateFlow, validateFlowOrThrow } from '../validate.js';

// Minimal mock node modules for validation (just need getNodeType and getSupportedControlMethods)
const mockNodeModules = {
    persistIf: {
        getNodeType: () => 'Persist If',
        getSupportedControlMethods: () => ( {} )
    },
    esMean: {
        getNodeType: () => 'ES Mean',
        getSupportedControlMethods: () => ( { reset: 'Resets state' } )
    }
};

// Mock storage adapter that mirrors QuestDB's declaration:
// declares semanticsRequirement.assetClass.required, so the
// capability-driven check fires when no .assetClass() is supplied.
// Used in the modules-keyed-by-id map shape that validateFlow accepts.
const questdbModule = {
    semanticsRequirement: {
        assetClass: {
            required: true,
            fields: [ 'name', 'columns', 'insightTypes' ]
        }
    }
};
const questdbModuleMap = { questdb: questdbModule };

describe( 'validate.js', function () {

    // ========================================================================
    // validateInsightTypeReferences - Phase 4 validation
    // ========================================================================

    describe( 'validateInsightTypeReferences', function () {

        it( 'returns valid when no persistIf nodes exist', function () {
            const specs = [
                { nodeType: 'ES Mean', name: 'mean1' }
            ];

            const result = validateFlow( 'test', specs, mockNodeModules, {}, {}, null );

            expect( result.valid ).to.be.true;
            expect( result.errors ).to.be.empty;
        } );

        it( 'returns valid when assetClass is supplied but no persistIf nodes use insightType', function () {
            // Edge case: assetClass present (so the capability-driven check
            // is satisfied) AND zero persistIf+insightType nodes. The
            // insightType cross-ref function early-returns since there's
            // nothing to cross-reference.
            const specs = [
                { nodeType: 'ES Mean', name: 'mean1' },
                { nodeType: 'Persist If', name: 'persist1', storageName: 'questdb' }
                // No insightType on the persistIf
            ];
            const assetClass = {
                name: 'pump',
                insightTypes: { mon: { columns: [ 'ts' ], designatedTimestamp: 'ts' } }
            };

            const result = validateFlow( 'test', specs, mockNodeModules, {}, questdbModuleMap, assetClass );

            expect( result.valid ).to.be.true;
            expect( result.errors ).to.be.empty;
        } );

        it( 'returns valid when no registered storage requires an asset class', function () {
            // Contrapositive: a storage adapter that does NOT
            // declare semanticsRequirement.assetClass.required can be
            // registered without an .assetClass() call. The capability-
            // driven check only fires for adapters that opt in.
            const specs = [
                { nodeType: 'Persist If', name: 'persist1', storageName: 'plainStorage' }
            ];
            const plainStorageMap = { plainStorage: { /* no semanticsRequirement */ } };

            const result = validateFlow( 'test', specs, mockNodeModules, {}, plainStorageMap, null );

            expect( result.valid ).to.be.true;
            expect( result.errors ).to.be.empty;
        } );

        it( 'returns error when a storage declares assetClass.required but no .assetClass() supplied', function () {
            // Capability-driven check: the requirement comes from
            // the storage adapter's semanticsRequirement declaration, not
            // from the persistIf node. Error message names the adapter and
            // its kind so the operator knows what to fix.
            const specs = [
                { nodeType: 'Persist If', name: 'saveData', insightType: 'operational', storageName: 'questdb' }
            ];

            const result = validateFlow( 'test', specs, mockNodeModules, {}, questdbModuleMap, null );

            expect( result.valid ).to.be.false;
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( 'storage \'questdb\'' );
            expect( result.errors[ 0 ] ).to.include( 'semanticsRequirement.assetClass.required' );
            expect( result.errors[ 0 ] ).to.include( 'add .assetClass(assetClassDef)' );
        } );

        it( 'returns error when insightType not found in asset class', function () {
            const specs = [
                { nodeType: 'Persist If', name: 'saveData', insightType: 'diagnostics', storageName: 'questdb' }
            ];

            const assetClass = {
                name: 'pumpSystem',
                insightTypes: {
                    operational: { columns: [ 'ts' ], designatedTimestamp: 'ts' },
                    electrical: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const result = validateFlow( 'test', specs, mockNodeModules, {}, questdbModuleMap, assetClass );

            expect( result.valid ).to.be.false;
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( 'saveData' );
            expect( result.errors[ 0 ] ).to.include( 'diagnostics' );
            expect( result.errors[ 0 ] ).to.include( 'pumpSystem' );
            expect( result.errors[ 0 ] ).to.include( 'operational, electrical' );
        } );

        it( 'returns error with "none defined" when asset class has empty insightTypes', function () {
            const specs = [
                { nodeType: 'Persist If', name: 'saveData', insightType: 'operational', storageName: 'questdb' }
            ];

            const assetClass = {
                name: 'emptyAsset',
                insightTypes: {}
            };

            const result = validateFlow( 'test', specs, mockNodeModules, {}, questdbModuleMap, assetClass );

            expect( result.valid ).to.be.false;
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( 'none defined' );
        } );

        it( 'returns error with "none defined" when asset class has no insightTypes property', function () {
            const specs = [
                { nodeType: 'Persist If', name: 'saveData', insightType: 'operational', storageName: 'questdb' }
            ];

            const assetClass = {
                name: 'noInsightTypesAsset'
                // insightTypes property is missing
            };

            const result = validateFlow( 'test', specs, mockNodeModules, {}, questdbModuleMap, assetClass );

            expect( result.valid ).to.be.false;
            expect( result.errors ).to.have.lengthOf( 1 );
            expect( result.errors[ 0 ] ).to.include( 'none defined' );
        } );

        it( 'returns valid when insightType exists in asset class', function () {
            const specs = [
                { nodeType: 'Persist If', name: 'saveData', insightType: 'operational', storageName: 'questdb' }
            ];

            const assetClass = {
                name: 'pumpSystem',
                insightTypes: {
                    operational: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const result = validateFlow( 'test', specs, mockNodeModules, {}, questdbModuleMap, assetClass );

            expect( result.valid ).to.be.true;
            expect( result.errors ).to.be.empty;
        } );

        it( 'validates multiple persistIf nodes with different insightTypes', function () {
            const specs = [
                { nodeType: 'Persist If', name: 'saveOperational', insightType: 'operational', storageName: 'questdb' },
                { nodeType: 'Persist If', name: 'saveWashing', insightType: 'washing', storageName: 'questdb' }
            ];

            const assetClass = {
                name: 'rwmPump',
                insightTypes: {
                    operational: { columns: [ 'ts' ], designatedTimestamp: 'ts' },
                    washing: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const result = validateFlow( 'test', specs, mockNodeModules, {}, questdbModuleMap, assetClass );

            expect( result.valid ).to.be.true;
            expect( result.errors ).to.be.empty;
        } );

        it( 'reports error for each invalid insightType in multiple persistIf nodes', function () {
            const specs = [
                { nodeType: 'Persist If', name: 'save1', insightType: 'invalid1', storageName: 'questdb' },
                { nodeType: 'Persist If', name: 'save2', insightType: 'invalid2', storageName: 'questdb' }
            ];

            const assetClass = {
                name: 'pumpSystem',
                insightTypes: {
                    operational: { columns: [ 'ts' ], designatedTimestamp: 'ts' }
                }
            };

            const result = validateFlow( 'test', specs, mockNodeModules, {}, questdbModuleMap, assetClass );

            expect( result.valid ).to.be.false;
            expect( result.errors ).to.have.lengthOf( 2 );
            expect( result.errors[ 0 ] ).to.include( 'invalid1' );
            expect( result.errors[ 1 ] ).to.include( 'invalid2' );
        } );

    } );

    // ========================================================================
    // validateFlowOrThrow
    // ========================================================================

    describe( 'validateFlowOrThrow', function () {

        it( 'does not throw when validation passes', function () {
            const specs = [
                { nodeType: 'ES Mean', name: 'mean1' }
            ];

            expect( () => {
                validateFlowOrThrow( 'test', specs, mockNodeModules, {}, {}, null );
            } ).to.not.throw();
        } );

        it( 'throws with formatted error list when validation fails', function () {
            const specs = [
                { nodeType: 'Persist If', name: 'saveData', insightType: 'operational', storageName: 'questdb' }
            ];

            expect( () => {
                validateFlowOrThrow( 'myFlow', specs, mockNodeModules, {}, questdbModuleMap, null );
            } ).to.throw( /Flow 'myFlow' validation failed/ );
        } );

        it( 'includes all errors in thrown exception', function () {
            const specs = [
                { nodeType: 'Persist If', name: 'save1', insightType: 'invalid1', storageName: 'questdb' },
                { nodeType: 'Persist If', name: 'save2', insightType: 'invalid2', storageName: 'questdb' }
            ];

            const assetClass = {
                name: 'pumpSystem',
                insightTypes: { operational: { columns: [ 'ts' ], designatedTimestamp: 'ts' } }
            };

            try {
                validateFlowOrThrow( 'multiError', specs, mockNodeModules, {}, questdbModuleMap, assetClass );
                expect.fail( 'Should have thrown' );
            } catch ( err ) {
                expect( err.message ).to.include( 'invalid1' );
                expect( err.message ).to.include( 'invalid2' );
                expect( err.message ).to.include( '  - ' ); // Formatted list
            }
        } );

        it( 'throws when a storage declares assetClass.required but no .assetClass() supplied', function () {
            // Capability-driven check (modules-aware). The error
            // names the adapter that declared the requirement; persistIf
            // is no longer mentioned because the requirement isn't its.
            const specs = [
                { nodeType: 'Persist If', name: 'persist', insightType: 'data', storageName: 'questdb' }
            ];

            expect( () => {
                validateFlowOrThrow( 'noAssetClass', specs, mockNodeModules, {}, questdbModuleMap, null );
            } ).to.throw( /storage 'questdb' declares semanticsRequirement\.assetClass\.required/ );
        } );

    } );

} );
