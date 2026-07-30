// core/storage-manager/questdb/ensure-tables.js

/**
 * @fileoverview DDL generation and table creation for QuestDB.
 *
 * Creates tables from semantics definition via PostgreSQL wire protocol.
 * Tables are named `{tablePrefix}_{insightType}` with:
 * - assetId as SYMBOL (indexed dimension, mapped from internal partitionId)
 * - designatedTimestamp as designated TIMESTAMP for partitioning
 * - All columns from insightType with mapped types
 *
 * WAL tables (default in modern QuestDB) require partitioning.
 * Uses PARTITION BY DAY unless specified otherwise.
 *
 * `err.code` (setup-time throws per ADR-018 fail-fast setup):
 * - `SCHEMA_ERROR` — DDL CREATE TABLE failed for a non-already-exists
 *   reason. The original PG error message is wrapped in a friendlier
 *   table-named context. Distinct from `INVALID_CONFIG` because the
 *   failure originates from QuestDB's PG-wire response, not from our
 *   pre-validation of caller-supplied config.
 *
 * @see https://questdb.com/docs/reference/sql/create-table/
 * @see docs/architecture/storage-layer.md
 */

// ============================================================================
// DDL TYPE MAPPING
// ============================================================================

/**
 * Semantics column type to QuestDB DDL type mapping.
 *
 * @type {Object.<string, string>}
 */
const DDL_TYPES = Object.create( null );
DDL_TYPES.float64 = 'DOUBLE';
DDL_TYPES.int64 = 'LONG';
DDL_TYPES.bool = 'BOOLEAN';
DDL_TYPES.string = 'VARCHAR';
DDL_TYPES.timestamp = 'TIMESTAMP';

/**
 * Get QuestDB DDL type for a semantics column type.
 * Falls back to VARCHAR for unknown types.
 *
 * @param {string} semanticsType - Column type from semantics
 * @returns {string} QuestDB DDL type
 */
const getDDLType = function ( semanticsType ) {
    return DDL_TYPES[ semanticsType ] || 'VARCHAR';
};

// ============================================================================
// DDL GENERATION
// ============================================================================

/**
 * Generate CREATE TABLE IF NOT EXISTS statement for an insightType.
 *
 * Table structure:
 * - assetId: SYMBOL (indexed dimension for partition isolation)
 * - columns from insightType with mapped types
 * - designatedTimestamp as designated TIMESTAMP
 * - PARTITION BY for WAL table support
 *
 * @param {string} tableName - Full table name (prefix_insightType)
 * @param {Object} insightTypeSpec - InsightType specification with columns and designatedTimestamp
 * @param {Object} columns - Column definitions from asset class
 * @param {Object} [options] - DDL options
 * @param {string} [options.partitionBy='DAY'] - Partition interval (HOUR, DAY, WEEK, MONTH, YEAR)
 * @returns {string} CREATE TABLE statement
 */
const generateCreateTableDDL = function ( tableName, insightTypeSpec, columns, options = {} ) {
    const { partitionBy = 'DAY' } = options;
    const { columns: colNames, designatedTimestamp } = insightTypeSpec;

    const columnDefs = [];

    // assetId as SYMBOL (indexed dimension, mapped from internal partitionId).
    // A declared column with the same name cannot reach this point:
    // buildPersistPlans rejects it (INVALID_CONFIG), and it always runs
    // before table creation.
    columnDefs.push( 'assetId SYMBOL' );

    // Add each column from insightType
    for ( let i = 0; i < colNames.length; i += 1 ) {
        const colName = colNames[ i ];
        const colSpec = columns[ colName ];
        const ddlType = colSpec ? getDDLType( colSpec.type ) : 'VARCHAR';

        columnDefs.push( `${colName} ${ddlType}` );
    }

    // Build CREATE TABLE statement
    // timestamp() marks designatedTimestamp for ILP
    const ddl =
        `CREATE TABLE IF NOT EXISTS ${tableName} (\n` +
        `    ${columnDefs.join( ',\n    ' )}\n` +
        `) timestamp(${designatedTimestamp}) PARTITION BY ${partitionBy};`;

    return ddl;
};

/**
 * Generate DDL statements for all insightTypes in an asset class.
 *
 * @param {Object} assetClass - Asset class definition
 * @param {string} tablePrefix - Prefix for table names
 * @param {Object} [options] - DDL options
 * @returns {Array<{tableName: string, ddl: string}>} Array of table DDL info
 */
const generateAllTablesDDL = function ( assetClass, tablePrefix, options = {} ) {
    const insightTypes = assetClass.insightTypes || Object.create( null );
    const columns = assetClass.columns;
    const results = [];

    const insightTypeNames = Object.keys( insightTypes );

    for ( let i = 0; i < insightTypeNames.length; i += 1 ) {
        const itName = insightTypeNames[ i ];
        const itSpec = insightTypes[ itName ];
        const tableName = tablePrefix + '_' + itName;

        const ddl = generateCreateTableDDL( tableName, itSpec, columns, options );
        results.push( { tableName, ddl } );
    }

    return results;
};

// ============================================================================
// TABLE CREATION
// ============================================================================

/**
 * Ensure all tables exist for an asset class.
 * Creates tables via PostgreSQL wire protocol if they don't exist.
 *
 * @param {Object} pgClient - PostgreSQL client (connected)
 * @param {Object} assetClass - Asset class definition
 * @param {string} tablePrefix - Prefix for table names
 * @param {Object} [options] - Options
 * @param {string} [options.partitionBy='DAY'] - Partition interval
 * @returns {Promise<Array<{tableName: string, created: boolean}>>} Results
 */
const ensureTables = async function ( pgClient, assetClass, tablePrefix, options = {} ) {
    const ddlInfos = generateAllTablesDDL( assetClass, tablePrefix, options );
    const results = [];

    for ( let i = 0; i < ddlInfos.length; i += 1 ) {
        const { tableName, ddl } = ddlInfos[ i ];

        try {
            await pgClient.query( ddl ); // eslint-disable-line no-await-in-loop
            results.push( { tableName, created: true } );
        } catch ( err ) {
            // Table might already exist (IF NOT EXISTS handles this)
            // But log unexpected errors
            if ( !err.message.includes( 'already exists' ) ) {
                // Per ADR-018, setup-time throws carry classified err.code.
                // SCHEMA_ERROR (not INVALID_CONFIG) because the failure
                // originates from QuestDB's PG-wire DDL response, not from
                // our pre-validation of caller-supplied config.
                const wrapped = new Error(
                    `Failed to create table '${tableName}': ${err.message}`
                );
                wrapped.code = 'SCHEMA_ERROR';
                throw wrapped;
            }
            results.push( { tableName, created: false } );
        }
    }

    return results;
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
    DDL_TYPES,
    getDDLType,
    generateCreateTableDDL,
    generateAllTablesDDL,
    ensureTables
};
