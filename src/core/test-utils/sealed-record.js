// core/test-utils/sealed-record.js

/**
 * @fileoverview Test harness that proves a sink consumes a record
 * synchronously.
 *
 * ADR-023 obliges every sink to read everything it needs from an incoming
 * message before its hot-path call returns, and never to keep the
 * reference for a later read. With a reused record (the handbook's
 * record-reuse pattern, and the future declarative shaping), a late read
 * would see a LATER message's values — silently corrupted data. This
 * harness makes that rule testable: wrap a record, hand it to the sink,
 * seal it the moment the call returns, and any read arriving after the
 * seal is recorded as a violation.
 *
 * Violations are RECORDED, never thrown. A late read typically happens
 * inside the sink's own async callback; a throw there would surface as an
 * unhandled rejection instead of a clean assertion failure. Tests seal,
 * await a tick, then assert `violations` is empty.
 *
 * Symbol-keyed accesses are ignored on purpose: engines and inspection
 * tools probe symbols (Symbol.toStringTag and friends), while record
 * columns are always string-named. Counting symbol traffic would produce
 * false violations that have nothing to do with data reads.
 */

/**
 * Wraps a plain record in a Proxy that logs every read and, once sealed,
 * records further reads as violations.
 *
 * @param {Object} fields - Column values the record carries.
 * @returns {{record: Object, seal: Function, violations: Array, reads: Array}}
 *   `record` behaves exactly like `fields`; `seal()` marks the moment the
 *   sink's call returned (idempotent); `reads` holds `{trap, key}` entries
 *   logged before the seal, `violations` the ones logged after it.
 */
const makeSealedRecord = function ( fields ) {
    const reads = [];
    const violations = [];
    let sealed = false;

    const log = function ( trap, key ) {
        if ( typeof key === 'symbol' ) {
            return;
        }
        const entry = { trap, key };
        if ( sealed ) {
            violations.push( entry );
        } else {
            reads.push( entry );
        }
    }; // log()

    const record = new Proxy( fields, {
        get: function ( target, key, receiver ) {
            log( 'get', key );
            return Reflect.get( target, key, receiver );
        },
        has: function ( target, key ) {
            log( 'has', key );
            return Reflect.has( target, key );
        },
        ownKeys: function ( target ) {
            log( 'ownKeys', null );
            return Reflect.ownKeys( target );
        },
        getOwnPropertyDescriptor: function ( target, key ) {
            log( 'getOwnPropertyDescriptor', key );
            return Reflect.getOwnPropertyDescriptor( target, key );
        }
    } );

    const seal = function () {
        sealed = true;
    }; // seal()

    return { record, seal, violations, reads };
}; // makeSealedRecord()

export { makeSealedRecord };
