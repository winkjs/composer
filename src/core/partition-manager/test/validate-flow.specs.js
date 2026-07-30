// core/partition-manager/test/validate-flow.specs.js

/**
 * @fileoverview Fail-fast validation specs for validate-flow.js.
 *
 * Covers every branch of the documented contract (see validate-flow.js):
 * each of the five accepted fields, the `_propertyNames` whitelist that
 * catches typos, the `Infinity` / zero edge cases on yieldThreshold,
 * and the root-level pre-check for non-object flow shapes.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { init } from '../index.js';
import { validateFlow } from '../validate-flow.js';
import { mockEsMean } from './test-helpers.js';

// Minimal well-formed flow used by "accepts" cases.
const wellFormedFlow = function () {
    return {
        partitionField: null,
        specializationField: null,
        specsBySpecialization: {
            0: [ { name: 'ewma', nodeType: 'ES Mean' } ]
        },
        nodeModules: { esMean: mockEsMean },
        yieldThreshold: 10000
    };
}; // wellFormedFlow()

describe( 'Partition Manager — validate-flow', function () {

    describe( 'well-formed flows', function () {

        it( 'accepts a minimal single-partition flow', function () {
            expect( () => validateFlow( wellFormedFlow() ) ).to.not.throw();
        } );

        it( 'accepts a string partitionField', function () {
            const flow = wellFormedFlow();
            flow.partitionField = 'sensorId';
            expect( () => validateFlow( flow ) ).to.not.throw();
        } );

        it( 'accepts a string specializationField', function () {
            const flow = wellFormedFlow();
            flow.specializationField = 'sensorType';
            flow.specsBySpecialization = {
                temperature: [ { name: 'tempEwma', nodeType: 'ES Mean' } ]
            };
            expect( () => validateFlow( flow ) ).to.not.throw();
        } );

        it( 'accepts yieldThreshold = 0 (yield every message)', function () {
            const flow = wellFormedFlow();
            flow.yieldThreshold = 0;
            expect( () => validateFlow( flow ) ).to.not.throw();
        } );

        it( 'accepts yieldThreshold = Infinity (never yield sentinel)', function () {
            const flow = wellFormedFlow();
            flow.yieldThreshold = Infinity;
            expect( () => validateFlow( flow ) ).to.not.throw();
        } );

        it( 'accepts multi-specialization specsBySpecialization', function () {
            const flow = wellFormedFlow();
            flow.specializationField = 'type';
            flow.specsBySpecialization = {
                alpha: [ { name: 'a1', nodeType: 'ES Mean' } ],
                beta: [ { name: 'b1', nodeType: 'ES Mean' }, { name: 'b2', nodeType: 'ES Mean' } ]
            };
            expect( () => validateFlow( flow ) ).to.not.throw();
        } );

    } );

    describe( 'root-level shape', function () {

        it( 'rejects null flow', function () {
            expect( () => validateFlow( null ) )
                .to.throw( TypeError, /flow: Expected object, got null/ );
        } );

        it( 'rejects undefined flow', function () {
            expect( () => validateFlow( undefined ) )
                .to.throw( TypeError, /flow: Expected object, got undefined/ );
        } );

        it( 'rejects non-object flow (number)', function () {
            expect( () => validateFlow( 42 ) )
                .to.throw( TypeError, /flow: Expected object, got number/ );
        } );

        it( 'rejects non-object flow (string)', function () {
            expect( () => validateFlow( 'oops' ) )
                .to.throw( TypeError, /flow: Expected object, got string/ );
        } );

        it( 'rejects array flow', function () {
            expect( () => validateFlow( [] ) )
                .to.throw( TypeError, /flow: Expected object, got array/ );
        } );

    } );

    describe( 'partitionField', function () {

        it( 'rejects missing key', function () {
            const flow = wellFormedFlow();
            delete flow.partitionField;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /flow\.partitionField: Required field missing/ );
        } );

        it( 'rejects non-string non-null value', function () {
            const flow = wellFormedFlow();
            flow.partitionField = 42;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /partitionField must be null or a non-empty string/ );
        } );

        it( 'rejects empty string', function () {
            const flow = wellFormedFlow();
            flow.partitionField = '';
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /partitionField must be null or a non-empty string/ );
        } );

    } );

    describe( 'specializationField', function () {

        it( 'rejects missing key', function () {
            const flow = wellFormedFlow();
            delete flow.specializationField;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /flow\.specializationField: Required field missing/ );
        } );

        it( 'rejects non-string non-null value', function () {
            const flow = wellFormedFlow();
            flow.specializationField = 42;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /specializationField must be null or a non-empty string/ );
        } );

        it( 'rejects empty string', function () {
            const flow = wellFormedFlow();
            flow.specializationField = '';
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /specializationField must be null or a non-empty string/ );
        } );

    } );

    describe( 'specsBySpecialization', function () {

        it( 'rejects missing key', function () {
            const flow = wellFormedFlow();
            delete flow.specsBySpecialization;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /flow\.specsBySpecialization: Required field missing/ );
        } );

        it( 'rejects null', function () {
            const flow = wellFormedFlow();
            flow.specsBySpecialization = null;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /specsBySpecialization must be a non-null object/ );
        } );

        it( 'rejects empty object', function () {
            const flow = wellFormedFlow();
            flow.specsBySpecialization = {};
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /specsBySpecialization must be a non-null object/ );
        } );

        it( 'rejects empty spec array for a specialization', function () {
            const flow = wellFormedFlow();
            flow.specsBySpecialization = { 0: [] };
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /specsBySpecialization must be a non-null object/ );
        } );

        it( 'rejects non-array value for a specialization', function () {
            const flow = wellFormedFlow();
            flow.specsBySpecialization = { 0: 'oops' };
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /specsBySpecialization must be a non-null object/ );
        } );

        it( 'rejects array-typed specsBySpecialization', function () {
            const flow = wellFormedFlow();
            flow.specsBySpecialization = [ [ { name: 'ewma', nodeType: 'ES Mean' } ] ];
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /specsBySpecialization must be a non-null object/ );
        } );

        it( 'rejects primitive (non-object) specsBySpecialization', function () {
            const flow = wellFormedFlow();
            flow.specsBySpecialization = 42;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /specsBySpecialization must be a non-null object/ );
        } );

    } );

    describe( 'nodeModules', function () {

        it( 'rejects missing key', function () {
            const flow = wellFormedFlow();
            delete flow.nodeModules;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /flow\.nodeModules: Required field missing/ );
        } );

        it( 'rejects null', function () {
            const flow = wellFormedFlow();
            flow.nodeModules = null;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /flow\.nodeModules: Expected object, got null/ );
        } );

        it( 'rejects non-object value', function () {
            const flow = wellFormedFlow();
            flow.nodeModules = 'esMean';
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /flow\.nodeModules: Expected object, got string/ );
        } );

    } );

    describe( 'yieldThreshold', function () {

        it( 'rejects missing key', function () {
            const flow = wellFormedFlow();
            delete flow.yieldThreshold;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /flow\.yieldThreshold: Required field missing/ );
        } );

        it( 'rejects negative number', function () {
            const flow = wellFormedFlow();
            flow.yieldThreshold = -1;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /yieldThreshold must be a number >= 0/ );
        } );

        it( 'rejects string', function () {
            const flow = wellFormedFlow();
            flow.yieldThreshold = 'fast';
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /flow\.yieldThreshold: Expected number/ );
        } );

        it( 'rejects NaN', function () {
            const flow = wellFormedFlow();
            flow.yieldThreshold = NaN;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /yieldThreshold/ );
        } );

    } );

    describe( 'unknown-key rejection', function () {

        it( 'rejects typo such as yieldThreshhold', function () {
            const flow = wellFormedFlow();
            flow.yieldThreshhold = 100;
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /Unknown property 'yieldThreshhold'/ );
        } );

        it( 'rejects multiple unknown keys and names them', function () {
            const flow = wellFormedFlow();
            flow.unexpected = true;
            flow.anotherUnknown = 'x';
            expect( () => validateFlow( flow ) )
                .to.throw( TypeError, /Unknown property 'unexpected'[\s\S]*Unknown property 'anotherUnknown'/ );
        } );

    } );

    describe( 'aggregated error reporting', function () {

        it( 'surfaces multiple violations in a single thrown error', function () {
            const flow = {
                partitionField: 42,
                specializationField: '',
                specsBySpecialization: {},
                nodeModules: null,
                yieldThreshold: -5
            };
            let caught;
            try {
                validateFlow( flow );
            } catch ( e ) {
                caught = e;
            }
            expect( caught instanceof TypeError ).to.equal( true );
            expect( caught.message ).to.include( 'partitionField must be null or a non-empty string' );
            expect( caught.message ).to.include( 'specializationField must be null or a non-empty string' );
            expect( caught.message ).to.include( 'specsBySpecialization must be a non-null object' );
            expect( caught.message ).to.include( 'nodeModules' );
            expect( caught.message ).to.include( 'yieldThreshold must be a number >= 0' );
        } );

    } );

    describe( 'integration with init()', function () {

        it( 'init() throws TypeError for a malformed flow', function () {
            expect( () => init( { partitionField: 42 } ) )
                .to.throw( TypeError );
        } );

        it( 'init() returns composerState for a well-formed flow', function () {
            const state = init( wellFormedFlow() );
            expect( state.partitionSpecializations instanceof Map ).to.equal( true );
            expect( typeof state.partitionState.lastYield ).to.equal( 'number' );
        } );

        it( 'init() seeds an empty backpressureAwareSinks registry on partitionState (forward-compat with the pressure-aware yield design, ADR-020 Draft)', function () {
            // The partition manager owns the registry shape (empty
            // Object.create(null) at startup). flow/run.js populates it
            // after init by querying the wire-emitters and wire-storages
            // registries. The pressure-aware yield decision (ADR-020,
            // Draft) will iterate the populated registry when it lands;
            // nothing reads it yet.
            const state = init( wellFormedFlow() );
            const registry = state.partitionState.backpressureAwareSinks;

            expect( registry ).to.not.equal( undefined );
            // Object.create(null) — no inherited prototype chain (avoids
            // surprises when keys come from runtime config).
            expect( Object.getPrototypeOf( registry ) ).to.equal( null );
            // Empty at construction; populated by flow/run.js post-init.
            expect( Object.keys( registry ) ).to.have.lengthOf( 0 );
        } );

    } );

} );
