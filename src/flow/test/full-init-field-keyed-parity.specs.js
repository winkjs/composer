// flow/test/full-init-field-keyed-parity.specs.js

/**
 * @fileoverview Full-init per-field-map parity — cross-field validators must accept a
 * per-field map.
 *
 * A "per-field map" is an option written as a map from field name to that field's value,
 * e.g. { temp: 5 } instead of the plain 5. The shared runtime resolvers read either form.
 *
 * A node's setup runs two kinds of check. Per-OPTION checks look at one option's value;
 * field-keyed-contract.specs.js already proves those accept a per-field map. CROSS-FIELD
 * checks look at several options together (e.g. "min must be less than max"); they run
 * only during a node's full init(). The bug this guards: a cross-field check that reads a
 * per-field map as if it were a plain value, and so mishandles it. Four nodes had it —
 * categorize, pageHinkley, sanitize, threshold.
 *
 * "Parity" here means: a value the node accepts in direct form, it must also accept when
 * the same value is written as a per-field map. The sweep below builds every node twice
 * through the real flow API — once direct, once per-field-map — and fails if the direct
 * form builds but the per-field-map form is rejected. When the direct form itself can't
 * be placed in the node (some options exclude each other), there is nothing to compare,
 * so that option is passed over; the floor guard below makes sure enough options are
 * still genuinely compared.
 *
 * The sweep catches the common failure: a check that REJECTS a valid per-field map. Two
 * shapes need an explicit case after it, because a generic valid-only sweep can't reach
 * them:
 *   - pageHinkley's rule compares two options and only runs when both are set (option
 *     defaults are not applied before cross-field checks run), so the sweep's single
 *     injected option leaves the other unset and the rule never fires. Its block sets
 *     both.
 *   - threshold's rule is written as a guard ("if min >= max, reject"). A raw read of a
 *     per-field map compares object against object, gets NaN, and the guard is skipped —
 *     so an INVALID spec is silently ACCEPTED, which a valid-only check cannot see. Its
 *     block asserts an invalid per-field-map combo is rejected.
 *
 * Out of scope: the silent-accept direction for any option other than threshold's
 * min/max (it needs a node-specific invalid fixture); what a node computes once built
 * (that is a round-trip test); and tunable-function option forms (every cross-field
 * check defers functions).
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { flow } from '../../composer.js';
import * as nodes from '../../nodes/index.js';
import { GOOD, BUILD_FIXTURES, buildArgs, inputFor, discoverFieldKeyedOptions } from './node-build-helpers.js';

// True if the node builds through the flow API with these args, false if the build
// throws. The flow wraps any build failure with "Failed to process".
const builds = function ( node, args ) {
    try {
        flow( 't' )[ node ]( ...args );
        return true;
    } catch {
        return false;
    }
};

describe( 'full-init per-field-map parity (cross-field validators accept a per-field map)', function () {

    const discovered = discoverFieldKeyedOptions();

    // Build every option both ways during setup, before any test runs. Each result holds
    // whether the direct form built and whether the per-field-map form built. This runs
    // here, not inside the per-option tests, because Mocha runs a suite's own tests before
    // its nested suites — so a count incremented inside the per-option tests would not be
    // ready when the floor guard (a sibling test) reads it.
    const results = discovered.map( ( { nodeName, option } ) => {
        const key = `${nodeName}.${option}`;
        const schema = nodes[ nodeName ].getDSLMetadata().specSchema;
        const baseFx = BUILD_FIXTURES[ nodeName ] || {};
        // Key the map by the field the node reads, so the resolver finds the value and the
        // cross-field check runs on it.
        const field = inputFor( schema, baseFx );
        const good = GOOD[ key ];

        const directArgs = buildArgs( nodeName, { ...baseFx, options: { ...baseFx.options, [ option ]: good } } );
        const fkArgs = buildArgs( nodeName, { ...baseFx, options: { ...baseFx.options, [ option ]: { [ field ]: good } } } );

        return { key, directOk: builds( nodeName, directArgs ), fkOk: builds( nodeName, fkArgs ) };
    } );
    // Options where the direct form built, so the parity comparison was real (not passed
    // over for a mutual-exclusion clash).
    const exercised = results.filter( ( r ) => r.directOk ).length;

    it( 'discovers the per-field-map options (floor guard, not vacuous)', function () {
        expect( discovered.length ).to.be.greaterThan( 35 );
    } );

    it( 'compared parity on enough options (floor guard, not hollowed out)', function () {
        // Some options can't sit in their node alongside the others without tripping a
        // mutual-exclusion rule (kernel preset vs kernel; butterworth's single-cutoff
        // rule; threshold's mode forbidding min/max). For those the direct form does not
        // build, so the comparison is passed over. ~32 of 37 options are compared today;
        // the few that aren't are either presence-only checks (kernel, butterworth) or
        // covered by the explicit blocks below (threshold). This floor stops the sweep
        // from quietly comparing nothing.
        expect( exercised ).to.be.greaterThan( 27 );
    } );

    results.forEach( ( { key, directOk, fkOk } ) => {

        describe( key, function () {

            it( 'per-field-map form is accepted wherever the direct form is', function () {
                const bug = directOk && !fkOk;
                expect(
                    bug,
                    `${key}: the direct form builds but the per-field-map form is rejected — a cross-field validator likely reads the option as a raw value instead of resolving it per field`
                ).to.equal( false );
            } );

        } );

    } );

    describe( 'pageHinkley cross-field rule (delta < lambda * 0.1, both fields set)', function () {

        // This rule only runs when delta AND lambda are both present, so set both and
        // write one as a per-field map. A raw read would compute object < number, get
        // NaN, and wrongly reject the valid spec.
        it( 'accepts delta as a per-field map (lambda present)', function () {
            const args = buildArgs( 'pageHinkley', { options: { delta: { fx: 0.5 }, lambda: 50 } } );
            expect( () => flow( 't' ).pageHinkley( ...args ) ).to.not.throw();
        } );

        it( 'accepts lambda as a per-field map (delta present)', function () {
            const args = buildArgs( 'pageHinkley', { options: { delta: 0.5, lambda: { fx: 50 } } } );
            expect( () => flow( 't' ).pageHinkley( ...args ) ).to.not.throw();
        } );

    } );

    describe( 'threshold cross-field rule (min < max in inside mode)', function () {

        // The min < max rule runs only in inside/outside mode and is written as a guard.
        // A raw read of a per-field map gives NaN, the guard is skipped, and an invalid
        // spec is silently accepted. So the discriminating case is an INVALID combo that
        // must be rejected in per-field-map form. The direct invalid case below confirms
        // the rule fires at all; the valid case confirms a good map is still accepted.
        it( 'rejects an invalid direct min/max (the rule fires)', function () {
            const args = buildArgs( 'threshold', { options: { mode: 'inside', min: 100, max: 0 } } );
            expect( () => flow( 't' ).threshold( ...args ) ).to.throw( /Failed to process/ );
        } );

        it( 'rejects an invalid per-field-map min/max (the discriminating case)', function () {
            const args = buildArgs( 'threshold', { options: { mode: 'inside', min: { fx: 100 }, max: { fx: 0 } } } );
            expect( () => flow( 't' ).threshold( ...args ) ).to.throw( /Failed to process/ );
        } );

        it( 'accepts a valid per-field-map min/max', function () {
            const args = buildArgs( 'threshold', { options: { mode: 'inside', min: { fx: 0 }, max: { fx: 100 } } } );
            expect( () => flow( 't' ).threshold( ...args ) ).to.not.throw();
        } );

    } );

    describe( 'cross-field validators actually run on the per-field-map form (negative control)', function () {

        // Build sanitize with a ranges map keyed by a field the node does not read. Each
        // entry is a valid range, so per-option validation passes and the cross-field
        // checks run; sanitize's rule "the ranges map must include the field this node
        // reads" then rejects. This proves the full-init path reaches and can fail a
        // cross-field validator — without it, the sweep above could pass while never
        // running a single cross-field rule.
        it( 'rejects sanitize ranges keyed by a field the node does not read', function () {
            const args = buildArgs( 'sanitize', { options: { ranges: { notMyField: { min: 0, max: 100 } } } } );
            expect( () => flow( 't' ).sanitize( ...args ) ).to.throw( /Failed to process/ );
        } );

    } );

} );
