import { validators } from '../../core/utils/validate/index.js';
import { resolveNestedObject, resolveArray } from '../../core/utils/options/resolve-field-keyed.js';

/** Single source of truth for what this plugin can do */
const SUPPORTED_STATS = [
    'failureReason',
    'failedValue'
];

/** Human-readable descriptions (for introspection) */
const STAT_DESCRIPTIONS = {
    failureReason: 'Type of validation failure: "range", "valueList", or "predicate" (null if valid)',
    failedValue: 'The value that failed validation (null if valid)'
};

/** Control methods available for triggers */
const SUPPORTED_CONTROL_METHODS = {
    reset: 'Clears accumulated state and restarts computation',
    enable: 'Enables node processing',
    disable: 'Disables node processing',
    pause: 'Pauses node processing while keeping state visible',
    unpause: 'Resumes node processing after pause'
};

/** The type of this node */
const NODE_TYPE = 'Sanitize';

/** Node capabilities for documentation */
const CAPABILITIES = {
    description: 'Universal data validation gate mapping invalid values to NaN',
    features: [
        'Range-based validation with per-parameter bounds',
        'Value list validation with allow/deny modes',
        'Custom predicate validation',
        'Works with numeric and categorical data',
        'Universal NaN invalid marker for downstream checking'
    ]
};

// Export functions for accessing metadata
export const getSupportedStats = () => SUPPORTED_STATS.slice();
export const getStatDescriptions = () => ( { ...STAT_DESCRIPTIONS } );
export const getSupportedControlMethods = () => ( { ...SUPPORTED_CONTROL_METHODS } );
export const getNodeType = () => NODE_TYPE;
export const getCapabilities = () => ( { ...CAPABILITIES, features: CAPABILITIES.features.slice() } );

// Spec default values
export const DEFAULT_OPTIONS = {
    valueList: [],
    containsValidValues: false  // false = deny list, true = allow list
};

/** Parameters that support tunable (dynamic) values */
export const TUNABLE_PARAMS = [ 'ranges' ];

// DSL Metadata for transpilation
const DSL_METADATA = {
    specSchema: {
        nodeType: {
            type: 'string',
            required: true,
            value: NODE_TYPE
        },
        name: {
            type: 'string',
            required: true,
            validator: validators.identifier,
            error: 'Name must be a valid identifier'
        },
        from: {
            type: 'object',
            required: true,
            properties: {
                x: {
                    type: 'string',
                    required: true,
                    validator: validators.noSpaces,
                    error: 'Field name cannot contain spaces'
                }
            }
        },
        stats: {
            type: 'object',
            required: true,
            minProperties: 1,
            propertyNames: SUPPORTED_STATS,
            propertySchema: {
                type: 'object',
                properties: {
                    storeAs: {
                        type: 'string',
                        required: true,
                        validator: validators.identifier,
                        error: 'storeAs must be a valid identifier'
                    }
                }
            }
        },
        ranges: {
            type: 'nestedObjectOrFunctionOrFieldKeyed',
            required: false,
            // Accepts three shapes the runtime resolver already handles:
            //   direct       { min: 0, max: 100 }
            //   field-keyed  { temp: { min: -40, max: 85 }, ... }
            //   tunable      (msg) => ({ min: msg.lo, max: msg.hi })
            // The inner shape below (both bounds required, numeric) is read by
            // the type validator; min <= max is checked in a cross-field rule.
            properties: {
                min: { type: 'number', required: true },
                max: { type: 'number', required: true }
            }
        },
        valueList: {
            type: 'arrayOrFieldKeyed',
            required: false,
            default: DEFAULT_OPTIONS.valueList,
            itemSchema: {
                type: 'any'  // Can be numbers, strings, booleans, etc.
            },
            // eslint-disable-next-line no-self-compare
            validator: ( arr ) => !Array.isArray( arr ) || arr.every( ( x ) => x === x ) // reject NaN
        },
        containsValidValues: {
            type: 'boolean',
            required: false,
            default: DEFAULT_OPTIONS.containsValidValues
        },
        predicate: {
            type: 'function',
            required: false,
            arity: 2,
            error: 'Predicate must accept (value, msg) parameters'
        }
    },

    crossFieldValidators: [
        {
            fields: [ 'ranges', 'valueList', 'predicate' ],
            validator: ( spec ) => {
                // ranges can be a function (tunable) or object (direct or field-keyed)
                const hasRanges = typeof spec.ranges === 'function' ||
                    ( spec.ranges && Object.keys( spec.ranges ).length > 0 );
                // Resolve valueList for the node's field so a direct array and a
                // field-keyed map both count as "a method was provided".
                const valueList = resolveArray( spec.valueList, spec.from?.x );
                const hasValueList = Array.isArray( valueList ) && valueList.length > 0;
                const hasPredicate = typeof spec.predicate === 'function';
                return hasRanges || hasValueList || hasPredicate;
            },
            error: 'Must provide at least one validation method: ranges, valueList, or predicate'
        },
        {
            fields: [ 'from.x', 'ranges' ],
            validator: ( spec ) => {
                // If ranges is a function, validation deferred to runtime
                if ( typeof spec.ranges === 'function' ) return true;
                // No ranges specified — nothing to check here
                if ( !spec.ranges || Object.keys( spec.ranges ).length === 0 ) {
                    return true;
                }
                // A direct range resolves for this field; a field-keyed map must
                // carry an entry for it. Use the same resolver the runtime uses
                // so validation and runtime agree on what "resolves" means.
                return resolveNestedObject( spec.ranges, spec.from.x, [ 'min', 'max' ] ) !== undefined;
            },
            error: 'Ranges must be a direct { min, max } or a per-field map that includes the field this node reads'
        },
        {
            fields: [ 'ranges' ],
            validator: ( spec ) => {
                // If ranges is a function, validation deferred to runtime
                if ( typeof spec.ranges === 'function' ) return true;
                if ( !spec.ranges ) return true;
                // A direct range carries min/max itself; a field-keyed map carries
                // one range per field. Check min <= max on whichever shape was given.
                const isDirect = ( 'min' in spec.ranges ) || ( 'max' in spec.ranges );
                const ranges = isDirect ? [ spec.ranges ] : Object.values( spec.ranges );
                return ranges.every( ( range ) => range.min <= range.max );
            },
            error: 'Range min must be less than or equal to max'
        }
    ],

    buildSpec: ( name, x, stats, options ) => ( {
            nodeType: NODE_TYPE,
            name,
            from: { x },
            stats,
            ...options
    } ),

};

export const getDSLMetadata = () => ( { ...DSL_METADATA } );
