import { validateWithSchema } from '../../core/utils/validate/index.js';
import { getDSLMetadata, getNodeType, DEFAULT_OPTIONS } from './introspect.js';
import { resolveNestedObject, resolveArray } from '../../core/utils/options/resolve-field-keyed.js';
import { asTunable } from '../../core/tunable/index.js';

const init = function ( spec ) {
    // Validate specification
    const metadata = getDSLMetadata();
    const validation = validateWithSchema(
        {
            ...metadata.specSchema,
            _crossFieldValidators: metadata.crossFieldValidators
        },
        spec,
        'spec'
    );
    validation.throwIfInvalid( getNodeType() );

    // Create state after validation passes
    const state = Object.create( null );

    // Ensure node is enabled by default
    state.disable = false;
    state.pause = false;

    // Core configuration
    state.x = spec.from.x;
    state.stats = spec.stats;

    // Pre-allocate failure reason strings (no allocations in hot path)
    state.REASON_RANGE = 'range';
    state.REASON_VALUE_LIST = 'valueList';
    state.REASON_PREDICATE = 'predicate';

    // Range configuration. Three shapes, all resolved by resolveNestedObject:
    //   Direct:      { ranges: { min: -40, max: 85 } }
    //   Field-keyed: { ranges: { temp: { min: -40, max: 85 } } }
    //   Tunable:     { ranges: lookupByField('shift', { day: {...}, night: {...} }, {...}) }
    if ( typeof spec.ranges === 'function' ) {
        // Dynamic ranges (tunable) - resolve at runtime
        state.rangesFn = spec.ranges;
        state.resolvedRangeSpec = null;  // Not yet resolved
        state.hasRange = true;
    } else {
        // Static ranges - resolve field-keying at init time
        const rangeSpec = resolveNestedObject( spec.ranges, state.x, [ 'min', 'max' ] );
        if ( rangeSpec ) {
            state.rangesFn = asTunable( rangeSpec );
            state.resolvedRangeSpec = rangeSpec;  // Known at init
            state.hasRange = true;
        } else {
            state.hasRange = false;
            state.rangesFn = null;
            state.resolvedRangeSpec = null;
        }
    }
    state.tunableErrorLogged = false;

    // Value list configuration (use Set for O(1) lookups)
    // Supports both direct: { valueList: [1, 2, 3] }
    // and field-keyed: { valueList: { temp: [1, 2], pressure: [3, 4] } }
    const valueListSpec = resolveArray( spec.valueList, state.x );
    const hasValueList = valueListSpec?.length > 0;
    state.valueSet = hasValueList ? new Set( valueListSpec ) : null;
    state.containsValidValues = spec.containsValidValues ?? DEFAULT_OPTIONS.containsValidValues;

    // Custom predicate
    state.predicate = spec.predicate || null;
    // Log suppression: one log per error episode; reset on recovery.
    state.predicateErrorLogged = false;

    // Node metadata
    state.nodeType = getNodeType();

    // Initialize stats (null = no failure)
    state.failureReason = null;
    state.failedValue = null;

    return state;
}; // init()

export default init;
