/**
 * @fileoverview Field-keyed option contract — the class-closing guard.
 *
 * Many node options accept a value in three shapes: direct (one value for the
 * field the node reads), field-keyed (a map { field: value } with one entry per
 * field), and — for some — a tunable function. The shared runtime resolvers accept
 * all three. Validation must accept exactly the same shapes.
 *
 * This test discovers EVERY field-keyed-capable option across EVERY node from the
 * node metadata, and asserts the contract for each:
 *
 *   1. A direct value that validates, written as a field-keyed map of the same
 *      value, must also validate (parity).
 *   2. A bad field-keyed entry must be rejected, with the failing field named in
 *      the error path.
 *
 * Discovery is automatic: any option whose schema type name contains 'FieldKeyed'
 * is included. A discovered option with no fixture entry FAILS the test — so a new
 * field-keyed option cannot be added without also pinning its contract here. This
 * is the test whose absence let a whole class of validation bugs live: a custom
 * validator that ran on the whole field-keyed map instead of per entry (see
 * runCustomValidator in core/utils/validate/helpers.js).
 *
 * This test checks each option on its own (validateField). The companion sweep
 * full-init-field-keyed-parity.specs.js checks the same options through a node's
 * full init, where cross-field validators run. The shared inventory — GOOD,
 * the discovery loop — lives in flow/test/node-build-helpers.js.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { validateField } from '../../core/utils/validate/helpers.js';
import { GOOD, BAD, discoverFieldKeyedOptions } from '../../flow/test/node-build-helpers.js';

// The arbitrary field name a field-keyed map is keyed by in these checks. The type
// validator walks every entry, so the key value itself does not matter.
const KEY = 'fieldA';

describe( 'field-keyed option contract (every node, every field-keyed option)', function () {

    // Build the work list: one entry per discovered field-keyed-capable option.
    const discovered = discoverFieldKeyedOptions();

    it( 'discovers at least the known field-keyed options', function () {
        // A floor guard: if discovery silently finds nothing (e.g. a refactor breaks
        // metadata access), this fails instead of the suite passing vacuously.
        expect( discovered.length ).to.be.greaterThan( 20 );
    } );

    discovered.forEach( ( { nodeName, option, schema } ) => {
        const key = `${nodeName}.${option}`;

        describe( key, function () {

            it( 'has a contract fixture (good value)', function () {
                expect(
                    Object.prototype.hasOwnProperty.call( GOOD, key ),
                    `No contract fixture for ${key}. Add a known-good value to GOOD in node-build-helpers.js.`
                ).to.equal( true );
            } );

            it( 'accepts the direct form (fixture sanity)', function () {
                if ( !Object.prototype.hasOwnProperty.call( GOOD, key ) ) return;
                const errors = validateField( GOOD[ key ], schema, `spec.${option}` );
                expect( errors, errors.join( '; ' ) ).to.deep.equal( [] );
            } );

            it( 'accepts the same value written field-keyed (parity)', function () {
                if ( !Object.prototype.hasOwnProperty.call( GOOD, key ) ) return;
                const fieldKeyed = { [ KEY ]: GOOD[ key ] };
                const errors = validateField( fieldKeyed, schema, `spec.${option}` );
                expect( errors, errors.join( '; ' ) ).to.deep.equal( [] );
            } );

            it( 'rejects a bad field-keyed entry, naming the field', function () {
                const badValue = Object.prototype.hasOwnProperty.call( BAD, key ) ? BAD[ key ] : {};
                const fieldKeyed = { [ KEY ]: badValue };
                const errors = validateField( fieldKeyed, schema, `spec.${option}` );
                expect( errors.length ).to.be.greaterThan( 0 );
                expect( errors.join( '; ' ) ).to.include( KEY );
            } );

        } );
    } );

} );
