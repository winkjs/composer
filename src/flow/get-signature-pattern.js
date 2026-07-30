import { SIGNATURE_PATTERNS } from './consts.js';

export const getSignaturePattern = function ( schema ) {
    // Controller node
    if ( !schema.from && schema.logic ) return SIGNATURE_PATTERNS.nameLogic;

    // Pure predicate based nodes (no inputs)
    if ( !schema.from && schema.predicate ) {
        return schema.stats?.required ?
            // e.g. presistenceCheck
            SIGNATURE_PATTERNS.namePredicateOutputsOptions :
            // e.f. PassIf
            SIGNATURE_PATTERNS.namePredicateOptions;
    }

    // Input-based nodes
    const props = schema.from?.properties;
    // This schema has no `from`, `logic`, or `predicate`, so its shape is not one we
    // recognize. Return `unknown` so make-node-method.js can raise its clear "unknown
    // signature pattern" error, instead of crashing on `props.x` below with a raw
    // TypeError.
    if ( !props ) return SIGNATURE_PATTERNS.unknown;
    if ( props.x && !props.y && !schema.stats ) return SIGNATURE_PATTERNS.nameXOptions; // momentsDigest: outputs are implied
    // Single input node i.e. only `x` e.g. delta
    if ( props.x && !props.y ) return SIGNATURE_PATTERNS.nameXOutputsOptions;
    // Dual input node i.e. `x` and `y` e.g. diff
    if ( props.x && props.y ) return SIGNATURE_PATTERNS.nameXYOutputsOptions;

    // Unable to determine signature pattern
    return SIGNATURE_PATTERNS.unknown;
}; // getSignaturePattern()
