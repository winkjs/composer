// core/semantics/index.js

/**
 * @fileoverview Semantics Layer for @winkjs/composer
 *
 * Provides semantic metadata for columns, asset classes, and insight types.
 * Loaded from JSON configuration files and used for:
 * - Column validation (physicalRange, operational limits)
 * - Data projection (insightType → column subset)
 * - Threshold configuration (context-dependent limits)
 * - LLM/dashboard context (units, descriptions)
 *
 * Usage:
 * ```javascript
 * import { loadSemantics } from './core/semantics/index.js';
 *
 * const semantics = await loadSemantics( './config/semantics' );
 * const { enums, assetClasses } = semantics;
 * ```
 */

// ============================================================================
// LOADER
// ============================================================================

export {
    loadSemantics,
    loadEnums,
    loadAssetClasses,
    loadJsonFile,
    validateCrossReferences
} from './loader.js';

// ============================================================================
// DIGEST
// ============================================================================

export {
    computeSemanticsDigest,
    canonicalize
} from './digest.js';

// ============================================================================
// WARNINGS
// ============================================================================

export {
    WARNING_PREFIX,
    defaultOnWarning,
    createWarningCollector
} from './warnings.js';

// ============================================================================
// SCHEMAS
// ============================================================================

export {
    // Enum schema
    enumSchema,
    validEnumKeys,
    validEnumValues,

    // Column schema
    columnSchema,
    validPhysicalRange,
    validOperational,
    validSpecification,
    validWhen,
    validContext,
    validContexts,
    validColumnType,
    validInterpretation,
    validLimitsMutualExclusivity,
    COLUMN_TYPES,
    COLUMN_DEFAULTS,

    // Asset class schema
    assetClassSchema,
    insightTypeSchema,
    validColumnsStructure,
    validInsightType,
    validInsightTypes
} from './schemas/index.js';
