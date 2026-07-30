// core/semantics/loader.js

/**
 * @fileoverview Semantics Loader with Cross-Reference Validation
 *
 * Loads and validates semantics JSON files from a config directory.
 * Validation is performed in two phases:
 *
 * 1. Schema validation (via validateWithSchema)
 *    - Enum files validated against enumSchema
 *    - Asset class files validated against assetClassSchema
 *    - Column validation delegated to columnSchema via propertySchema
 *
 * 2. Cross-reference validation (this module)
 *    - enumRef → enum must exist
 *    - contexts[].when.column → column must exist in same asset class
 *    - insightTypes[].columns → all columns must exist in asset class (no duplicates)
 *
 * Fail-fast behavior: throws on first validation error.
 *
 * Platform notes:
 * - Glob patterns use POSIX separators (/) for cross-platform compatibility
 * - File lists are sorted for deterministic load order
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

// Standard error prefix for all semantic loader errors
const ERR_PREFIX = 'WinkComposer/semantics: ';
import { glob } from 'glob';
import { validateWithSchema } from '../utils/validate/index.js';
import {
    enumSchema,
    assetClassSchema,
    validLimitsMutualExclusivity,
    validLimitsHierarchy,
    validContextLimitsHierarchy
} from './schemas/index.js';
import { computeSemanticsDigest } from './digest.js';
import { createWarningCollector } from './warnings.js';

// ============================================================================
// CROSS-REFERENCE VALIDATION
// ============================================================================

/**
 * Validates that context.when.column references exist in the asset class.
 *
 * @param {string} assetClassName - Asset class name for error messages
 * @param {string} colName - Column name for error messages
 * @param {Array} contexts - Array of context entries
 * @param {Set} columnNames - Set of valid column names
 * @throws {Error} If a referenced column does not exist
 */
const validateContextColumnRefs = function ( assetClassName, colName, contexts, columnNames ) {
    for ( let j = 0; j < contexts.length; j += 1 ) {
        const ctx = contexts[ j ];
        // Only validate object-form when clauses (not "default" string)
        if ( ctx.when !== 'default' ) {
            const refColumn = ctx.when.column;
            if ( !columnNames.has( refColumn ) ) {
                throw new Error(
                    ERR_PREFIX + `AssetClass '${assetClassName}', column '${colName}', ` +
                    `context[${j}]: when.column '${refColumn}' not found in asset class`
                );
            }
        }
    }
};

/**
 * Validate all cross-references within an asset class.
 * Throws on first error for fail-fast behavior.
 *
 * Validates:
 * 1. Mutual exclusivity: contexts vs direct operational/specification
 * 2. Limits hierarchy: physicalRange ⊇ operational ⊇ specification
 * 3. Context limits hierarchy: physicalRange ⊇ ctx.operational ⊇ ctx.specification
 * 4. enumRef → enum exists in loaded enums
 * 5. contexts[].when.column → column exists in same asset class
 * 6. insightTypes[].columns → all exist in asset class
 *
 * @param {string} assetClassName - Name of the asset class
 * @param {Object} assetClass - Asset class definition
 * @param {Object} enums - Loaded enums object
 * @throws {Error} On validation failure
 */
const validateCrossReferences = function ( assetClassName, assetClass, enums ) {
    const columnNames = new Set( Object.keys( assetClass.columns ) );

    // Validate each column's cross-references
    const columnEntries = Object.entries( assetClass.columns );
    for ( let i = 0; i < columnEntries.length; i += 1 ) {
        const [ colName, colSpec ] = columnEntries[ i ];

        // 1. Validate mutual exclusivity: contexts vs direct operational/specification
        if ( !validLimitsMutualExclusivity( colSpec ) ) {
            throw new Error(
                ERR_PREFIX + `AssetClass '${assetClassName}', column '${colName}': ` +
                'cannot have both contexts and direct operational/specification limits (mutually exclusive)'
            );
        }

        // 2. Validate limits hierarchy: physicalRange ⊇ operational ⊇ specification
        if ( !validLimitsHierarchy( colSpec ) ) {
            throw new Error(
                ERR_PREFIX + `AssetClass '${assetClassName}', column '${colName}': ` +
                'operational/specification limits exceed physicalRange bounds or specification exceeds operational bounds'
            );
        }

        // 3. Validate context limits hierarchy
        if ( !validContextLimitsHierarchy( colSpec ) ) {
            throw new Error(
                ERR_PREFIX + `AssetClass '${assetClassName}', column '${colName}': ` +
                'context limits exceed physicalRange bounds or context specification exceeds context operational bounds'
            );
        }

        // 4. Validate enumRef points to existing enum
        if ( colSpec.enumRef !== undefined && !enums[ colSpec.enumRef ] ) {
            throw new Error(
                ERR_PREFIX + `AssetClass '${assetClassName}', column '${colName}': ` +
                `enumRef '${colSpec.enumRef}' not found in loaded enums`
            );
        }

        // 5. Validate context.when.column exists in same asset class
        if ( colSpec.contexts && colSpec.contexts.length > 0 ) {
            validateContextColumnRefs( assetClassName, colName, colSpec.contexts, columnNames );
        }
    }

    // 6. Validate insightType columns exist and are unique
    // 7. Validate designatedTimestamp cross-references
    if ( assetClass.insightTypes ) {
        const insightTypeEntries = Object.entries( assetClass.insightTypes );
        for ( let i = 0; i < insightTypeEntries.length; i += 1 ) {
            const [ itName, itSpec ] = insightTypeEntries[ i ];
            const seenColumns = new Set();
            for ( let j = 0; j < itSpec.columns.length; j += 1 ) {
                const colName = itSpec.columns[ j ];
                // Check for duplicate column references
                if ( seenColumns.has( colName ) ) {
                    throw new Error(
                        ERR_PREFIX + `AssetClass '${assetClassName}', insightType '${itName}': ` +
                        `duplicate column '${colName}'`
                    );
                }
                seenColumns.add( colName );
                // Check column exists in asset class
                if ( !columnNames.has( colName ) ) {
                    throw new Error(
                        ERR_PREFIX + `AssetClass '${assetClassName}', insightType '${itName}': ` +
                        `column '${colName}' not found in asset class columns`
                    );
                }
            }

            // 7a. Validate designatedTimestamp is in columns list
            if ( !itSpec.columns.includes( itSpec.designatedTimestamp ) ) {
                throw new Error(
                    ERR_PREFIX + `AssetClass '${assetClassName}', insightType '${itName}': ` +
                    `designatedTimestamp '${itSpec.designatedTimestamp}' not in columns list`
                );
            }

            // 7b. Validate designatedTimestamp references a timestamp-type column
            const designatedTsColSpec = assetClass.columns[ itSpec.designatedTimestamp ];
            if ( !designatedTsColSpec || designatedTsColSpec.type !== 'timestamp' ) {
                throw new Error(
                    ERR_PREFIX + `AssetClass '${assetClassName}', insightType '${itName}': ` +
                    `designatedTimestamp '${itSpec.designatedTimestamp}' must reference a column with type 'timestamp'`
                );
            }
        }
    }
};

// ============================================================================
// NUMERIC TYPE CHECK
// ============================================================================

/**
 * Set of numeric column types.
 * @type {Set<string>}
 */
const NUMERIC_TYPES = new Set( [ 'float64', 'int64' ] );

// ============================================================================
// COMPLETENESS WARNING FUNCTIONS
// ============================================================================

/**
 * Check for columns missing interpretation (advisory).
 *
 * @param {string} assetClassName - Asset class name for warning messages
 * @param {Object} columns - Columns object
 * @param {Object} warningCollector - Warning collector with add() method
 */
const checkMissingInterpretation = function ( assetClassName, columns, warningCollector ) {
    const columnNames = Object.keys( columns );
    for ( let i = 0; i < columnNames.length; i += 1 ) {
        const colName = columnNames[ i ];
        const colSpec = columns[ colName ];
        const hasInterp = colSpec.interpretation && colSpec.interpretation.length > 0;
        if ( !hasInterp ) {
            warningCollector.add(
                `AssetClass '${assetClassName}', column '${colName}': missing interpretation`
            );
        }
    }
};

/**
 * Check for numeric columns missing physicalRange (advisory).
 *
 * @param {string} assetClassName - Asset class name for warning messages
 * @param {Object} columns - Columns object
 * @param {Object} warningCollector - Warning collector with add() method
 */
const checkMissingPhysicalRange = function ( assetClassName, columns, warningCollector ) {
    const columnNames = Object.keys( columns );
    for ( let i = 0; i < columnNames.length; i += 1 ) {
        const colName = columnNames[ i ];
        const colSpec = columns[ colName ];
        if ( NUMERIC_TYPES.has( colSpec.type ) && !colSpec.physicalRange ) {
            warningCollector.add(
                `AssetClass '${assetClassName}', column '${colName}': numeric column missing physicalRange`
            );
        }
    }
};

/**
 * Check for numeric columns missing unit (advisory).
 *
 * @param {string} assetClassName - Asset class name for warning messages
 * @param {Object} columns - Columns object
 * @param {Object} warningCollector - Warning collector with add() method
 */
const checkMissingUnit = function ( assetClassName, columns, warningCollector ) {
    const columnNames = Object.keys( columns );
    for ( let i = 0; i < columnNames.length; i += 1 ) {
        const colName = columnNames[ i ];
        const colSpec = columns[ colName ];
        const hasUnit = colSpec.unit && colSpec.unit.length > 0;
        if ( NUMERIC_TYPES.has( colSpec.type ) && !hasUnit ) {
            warningCollector.add(
                `AssetClass '${assetClassName}', column '${colName}': numeric column missing unit`
            );
        }
    }
};

/**
 * Check for enums not referenced by any column (advisory).
 *
 * @param {Object} enums - Loaded enums object
 * @param {Object} assetClasses - Loaded asset classes object
 * @param {Object} warningCollector - Warning collector with add() method
 */
const checkUnreferencedEnums = function ( enums, assetClasses, warningCollector ) {
    const referencedEnums = new Set();

    // Collect all enumRef values from all asset classes
    const assetClassEntries = Object.entries( assetClasses );
    for ( let i = 0; i < assetClassEntries.length; i += 1 ) {
        const [ , assetClass ] = assetClassEntries[ i ];
        const columnNames = Object.keys( assetClass.columns );
        for ( let j = 0; j < columnNames.length; j += 1 ) {
            const colSpec = assetClass.columns[ columnNames[ j ] ];
            if ( colSpec.enumRef ) {
                referencedEnums.add( colSpec.enumRef );
            }
        }
    }

    // Check each enum for references
    const enumNames = Object.keys( enums );
    for ( let i = 0; i < enumNames.length; i += 1 ) {
        const enumName = enumNames[ i ];
        if ( !referencedEnums.has( enumName ) ) {
            warningCollector.add(
                `Enum '${enumName}': not referenced by any column`
            );
        }
    }
};

/**
 * Check for columns not used in any insightType (advisory).
 *
 * @param {string} assetClassName - Asset class name for warning messages
 * @param {Object} assetClass - Asset class definition
 * @param {Object} warningCollector - Warning collector with add() method
 */
const checkUnusedColumns = function ( assetClassName, assetClass, warningCollector ) {
    // Collect all columns used in insightTypes
    const usedColumns = new Set();
    if ( assetClass.insightTypes ) {
        const insightTypeEntries = Object.entries( assetClass.insightTypes );
        for ( let i = 0; i < insightTypeEntries.length; i += 1 ) {
            const [ , itSpec ] = insightTypeEntries[ i ];
            for ( let j = 0; j < itSpec.columns.length; j += 1 ) {
                usedColumns.add( itSpec.columns[ j ] );
            }
        }
    }

    // Check each column for usage
    const columnNames = Object.keys( assetClass.columns );
    for ( let i = 0; i < columnNames.length; i += 1 ) {
        const colName = columnNames[ i ];
        if ( !usedColumns.has( colName ) ) {
            warningCollector.add(
                `AssetClass '${assetClassName}', column '${colName}': not used in any insightType`
            );
        }
    }
};

/**
 * Check for int64 columns with small value sets that lack enumRef (advisory).
 * This helps identify columns that look like enums but aren't declared as such.
 *
 * Heuristic: if a column is int64 and has physicalRange with max-min < 20,
 * it may represent an enum-like state variable.
 *
 * @param {string} assetClassName - Asset class name for warning messages
 * @param {Object} columns - Columns object
 * @param {Object} warningCollector - Warning collector with add() method
 */
const checkEnumLikeColumnsWithoutEnumRef = function ( assetClassName, columns, warningCollector ) {
    const MAX_ENUM_RANGE = 20;  // Threshold for "small value set"

    const columnNames = Object.keys( columns );
    for ( let i = 0; i < columnNames.length; i += 1 ) {
        const colName = columnNames[ i ];
        const colSpec = columns[ colName ];

        // Only check int64 columns without enumRef that have physicalRange
        if ( colSpec.type === 'int64' && !colSpec.enumRef && colSpec.physicalRange ) {
            const range = colSpec.physicalRange.max - colSpec.physicalRange.min;
            if ( range >= 0 && range < MAX_ENUM_RANGE ) {
                warningCollector.add(
                    `AssetClass '${assetClassName}', column '${colName}': int64 column with small range ` +
                    `(${colSpec.physicalRange.min}-${colSpec.physicalRange.max}) may need enumRef`
                );
            }
        }
    }
};

// ============================================================================
// FILE LOADING
// ============================================================================

/**
 * Load and parse a JSON file.
 *
 * @param {string} filePath - Path to JSON file
 * @returns {Promise<Object>} Parsed JSON object
 * @throws {Error} On file read or parse failure
 */
const loadJsonFile = async function ( filePath ) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- exported helper; the function itself does not validate path provenance, callers do. Current callers (lines ~393, ~433) pass filePaths from glob over composer-configured enumsDir; any future caller must ensure the same before invoking.
    const content = await readFile( filePath, 'utf8' );
    try {
        return JSON.parse( content );
    } catch ( err ) {
        throw new Error( ERR_PREFIX + `Failed to parse JSON file '${filePath}': ${err.message}` );
    }
};

/**
 * Load all enum files from a directory.
 *
 * @param {string} enumsDir - Path to enums directory
 * @returns {Promise<Object>} Map of enum name to enum definition
 * @throws {Error} On validation failure
 */
const loadEnums = async function ( enumsDir ) {
    // Use POSIX separators for cross-platform glob compatibility
    const pattern = `${enumsDir}/*.json`;
    // Sort for deterministic load order
    const files = ( await glob( pattern ) ).sort();

    const enums = Object.create( null );

    for ( let i = 0; i < files.length; i += 1 ) {
        const filePath = files[ i ];
        const data = await loadJsonFile( filePath ); // eslint-disable-line no-await-in-loop

        // Validate against enum schema
        const validation = validateWithSchema( enumSchema, data, `enum file '${basename( filePath )}'` );
        if ( !validation.valid ) {
            throw new Error(
                ERR_PREFIX + `Enum file '${filePath}' validation failed:\n  - ${validation.errors.join( '\n  - ' )}`
            );
        }

        // Check for duplicate enum names
        if ( enums[ data.name ] ) {
            throw new Error(
                ERR_PREFIX + `Duplicate enum name '${data.name}' found in '${filePath}'`
            );
        }

        enums[ data.name ] = data;
    }

    return enums;
};

/**
 * Load all asset class files from a directory.
 *
 * @param {string} assetClassesDir - Path to asset-classes directory
 * @returns {Promise<Object>} Map of asset class name to definition
 * @throws {Error} On validation failure
 */
const loadAssetClasses = async function ( assetClassesDir ) {
    // Use POSIX separators for cross-platform glob compatibility
    const pattern = `${assetClassesDir}/*.json`;
    // Sort for deterministic load order
    const files = ( await glob( pattern ) ).sort();

    const assetClasses = Object.create( null );

    for ( let i = 0; i < files.length; i += 1 ) {
        const filePath = files[ i ];
        const data = await loadJsonFile( filePath ); // eslint-disable-line no-await-in-loop

        // Validate against asset class schema (includes column validation via propertySchema)
        const validation = validateWithSchema( assetClassSchema, data, `asset class file '${basename( filePath )}'` );
        if ( !validation.valid ) {
            throw new Error(
                ERR_PREFIX + `Asset class file '${filePath}' validation failed:\n  - ${validation.errors.join( '\n  - ' )}`
            );
        }

        // Check for duplicate asset class names
        if ( assetClasses[ data.name ] ) {
            throw new Error(
                ERR_PREFIX + `Duplicate asset class name '${data.name}' found in '${filePath}'`
            );
        }

        assetClasses[ data.name ] = data;
    }

    return assetClasses;
};

// ============================================================================
// MAIN LOADER
// ============================================================================

/**
 * Load semantics from a config directory with full validation.
 *
 * Directory structure expected:
 * configPath/
 * ├── enums/
 * │   └── *.json
 * └── asset-classes/
 *     └── *.json
 *
 * Validation phases:
 * 1. Load and parse JSON files
 * 2. Schema validation (enum, asset-class, column)
 * 3. Cross-reference validation (enumRef, context columns, insightType columns)
 * 4. Completeness warnings (missing interpretation, physicalRange, unit, etc.)
 *
 * @param {string} configPath - Path to semantics config directory
 * @param {Object} [options] - Loading options
 * @param {string[]} [options.assetClasses] - Filter to load only these asset classes by name
 * @param {string} [options.version] - Semantic version string for digest (default: '1.0.0')
 * @param {boolean} [options.suppressWarnings=false] - Suppress all completeness warnings
 * @param {Function} [options.onWarning] - Custom warning handler (msg) => void
 * @returns {Promise<Object>} { enums, assetClasses, digest }
 * @throws {Error} Fail-fast on any validation error
 */
const loadSemantics = async function ( configPath, options = {} ) {
    const {
        assetClasses: filterNames,
        suppressWarnings = false,
        onWarning
    } = options;

    // Create warning collector for completeness checks
    const warningCollector = createWarningCollector( { suppressWarnings, onWarning } );

    // Phase 1-2: Load and validate individual files (schema validation)
    // Use POSIX separators for cross-platform compatibility
    const enumsDir = `${configPath}/enums`;
    const assetClassesDir = `${configPath}/asset-classes`;

    // Always load all enums (required for enumRef validation)
    const enums = await loadEnums( enumsDir );

    // Load all asset classes, then filter if requested
    let assetClasses = await loadAssetClasses( assetClassesDir );

    // Apply filter if provided (strict: unknown names throw)
    if ( filterNames && filterNames.length > 0 ) {
        const filtered = Object.create( null );
        for ( let i = 0; i < filterNames.length; i += 1 ) {
            const name = filterNames[ i ];
            if ( !assetClasses[ name ] ) {
                throw new Error(
                    ERR_PREFIX + `Asset class '${name}' not found in loaded definitions`
                );
            }
            filtered[ name ] = assetClasses[ name ];
        }
        assetClasses = filtered;
    }

    // Phase 3: Cross-reference validation (only on filtered subset)
    const assetClassEntries = Object.entries( assetClasses );
    for ( let i = 0; i < assetClassEntries.length; i += 1 ) {
        const [ name, assetClass ] = assetClassEntries[ i ];
        validateCrossReferences( name, assetClass, enums );
    }

    // Phase 4: Completeness warnings (advisory, non-blocking)
    for ( let i = 0; i < assetClassEntries.length; i += 1 ) {
        const [ name, assetClass ] = assetClassEntries[ i ];
        checkMissingInterpretation( name, assetClass.columns, warningCollector );
        checkMissingPhysicalRange( name, assetClass.columns, warningCollector );
        checkMissingUnit( name, assetClass.columns, warningCollector );
        checkUnusedColumns( name, assetClass, warningCollector );
        checkEnumLikeColumnsWithoutEnumRef( name, assetClass.columns, warningCollector );
    }
    checkUnreferencedEnums( enums, assetClasses, warningCollector );

    // Emit accumulated warnings
    warningCollector.emit();

    // Phase 5: Compute semantic digest
    const digest = computeSemanticsDigest(
        { enums, assetClasses },
        options.version || '1.0.0'
    );

    return { enums, assetClasses, digest };
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
    loadSemantics,
    loadEnums,
    loadAssetClasses,
    loadJsonFile,
    validateCrossReferences,
    // Completeness warning functions (used internally, exported for testing)
    checkMissingInterpretation,
    checkMissingPhysicalRange,
    checkMissingUnit,
    checkUnreferencedEnums,
    checkUnusedColumns,
    checkEnumLikeColumnsWithoutEnumRef
};

export default loadSemantics;
