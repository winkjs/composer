// core/wiring/test/assert-handle.specs.js

/**
 * @fileoverview Direct unit tests for the wire-time handle shape check.
 *
 * Tests cover both branches of the helper:
 * - non-object handle (null, undefined, primitive)
 * - missing or non-function required method
 *
 * Plus the success path (handle satisfies the floor — does not throw)
 * and a few signal-quality checks on the error message format.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { assertHandle } from '../assert-handle.js';

describe( 'assert-handle', function () {

    describe( 'success path (handle satisfies the floor)', function () {

        it( 'does not throw when all required methods are present and are functions', function () {
            const handle = {
                publishNow: function () { /* no-op */ },
                shutdown: function () { /* no-op */ },
                getHealth: function () { /* no-op */ }
            };

            expect( () => assertHandle( 'mock', handle, [ 'publishNow', 'shutdown', 'getHealth' ] ) )
                .to.not.throw();
        } );

        it( 'tolerates extra methods beyond the required floor', function () {
            // Adapter-specific extras (getStats, debug-only methods) are
            // explicitly allowed by ADR-018; the floor is a minimum, not
            // an exact match.
            const handle = {
                publishNow: function () { /* no-op */ },
                shutdown: function () { /* no-op */ },
                getHealth: function () { /* no-op */ },
                getPressure: function () { /* no-op */ },
                _debugInternals: function () { /* no-op */ }
            };

            expect( () => assertHandle( 'mock', handle, [ 'publishNow', 'shutdown', 'getHealth' ] ) )
                .to.not.throw();
        } );

        it( 'accepts an empty required-methods list (vacuously satisfied)', function () {
            // An adapter family with no required floor (hypothetical) would
            // pass any handle. Edge case — verifies the loop does not throw
            // on length 0.
            expect( () => assertHandle( 'mock', { foo: 'bar' }, [] ) ).to.not.throw();
        } );

    } );

    describe( 'non-object handle (factory returned the wrong shape)', function () {

        it( 'throws a descriptive error when the handle is null', function () {
            expect( () => assertHandle( 'mock', null, [ 'publishNow' ] ) )
                .to.throw( 'winkComposer/adapter: \'mock\' factory returned non-object handle' );
        } );

        it( 'throws when the handle is undefined', function () {
            expect( () => assertHandle( 'mock', undefined, [ 'publishNow' ] ) )
                .to.throw( 'winkComposer/adapter: \'mock\' factory returned non-object handle' );
        } );

        it( 'throws when the handle is a primitive (string)', function () {
            expect( () => assertHandle( 'mock', 'not-an-object', [ 'publishNow' ] ) )
                .to.throw( 'winkComposer/adapter: \'mock\' factory returned non-object handle' );
        } );

        it( 'throws when the handle is a primitive (number)', function () {
            expect( () => assertHandle( 'mock', 42, [ 'publishNow' ] ) )
                .to.throw( 'winkComposer/adapter: \'mock\' factory returned non-object handle' );
        } );

        it( 'includes the adapter id in the error message (operator can identify the misconfigured target)', function () {
            // Verify the format directly — operator debugging this in production
            // needs to know which target failed, not just "something failed."
            expect( () => assertHandle( 'mqtt-emitter-prod', null, [] ) )
                .to.throw( /'mqtt-emitter-prod'/ );
        } );

    } );

    describe( 'missing required method', function () {

        it( 'throws when a required method is missing from the handle', function () {
            const handle = {
                publishNow: function () { /* no-op */ },
                shutdown: function () { /* no-op */ }
                // getHealth deliberately omitted
            };

            expect( () => assertHandle( 'mock', handle, [ 'publishNow', 'shutdown', 'getHealth' ] ) )
                .to.throw( 'winkComposer/adapter: \'mock\' missing required method \'getHealth\'' );
        } );

        it( 'throws when a required method exists but is not a function', function () {
            const handle = {
                publishNow: function () { /* no-op */ },
                shutdown: 'not-a-function',  // wrong type
                getHealth: function () { /* no-op */ }
            };

            expect( () => assertHandle( 'mock', handle, [ 'publishNow', 'shutdown', 'getHealth' ] ) )
                .to.throw( 'winkComposer/adapter: \'mock\' missing required method \'shutdown\'' );
        } );

        it( 'fails fast on the first missing method (does not enumerate every gap)', function () {
            // Two methods missing; we expect to see only the FIRST one named.
            // Fail-fast is the right posture — one is enough to abort wiring,
            // and the operator fixes that one then re-runs.
            const handle = {
                publishNow: function () { /* no-op */ }
                // shutdown AND getHealth both missing
            };

            let thrown;
            try {
                assertHandle( 'mock', handle, [ 'publishNow', 'shutdown', 'getHealth' ] );
            } catch ( err ) {
                thrown = err;
            }

            expect( thrown ).to.be.an( 'error' );
            expect( thrown.message ).to.include( 'missing required method \'shutdown\'' );
            expect( thrown.message ).to.not.include( 'getHealth' );
        } );

        it( 'includes the method name in the error message', function () {
            // Operator needs to know which method to add — exact format check.
            const handle = { publishNow: function () { /* no-op */ }, shutdown: function () { /* no-op */ } };

            expect( () => assertHandle( 'X', handle, [ 'publishNow', 'shutdown', 'getHealth' ] ) )
                .to.throw( /missing required method 'getHealth'/ );
        } );

    } );

} );
