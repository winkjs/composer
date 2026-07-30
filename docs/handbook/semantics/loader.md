# Loader & Digest

## loadSemantics()

Main entry point for loading semantics from a directory.

```javascript
import { loadSemantics } from '@winkjs/composer';

const semantics = await loadSemantics('./semantics', {
    assetClasses: ['pumpStats'],  // Optional: filter to specific asset classes
    version: '2.0.0',             // Optional: version for digest (default: '1.0.0')
    suppressWarnings: false,      // Optional: suppress completeness warnings
    onWarning: msg => log(msg)    // Optional: custom warning handler
});
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `configPath` | string | Yes | Path to semantics directory |
| `options.assetClasses` | string[] | No | Filter to load only these asset classes (strict: unknown names throw) |
| `options.version` | string | No | Version string for digest (default: `'1.0.0'`) |
| `options.suppressWarnings` | boolean | No | Suppress all completeness warnings (default: `false`) |
| `options.onWarning` | function | No | Custom warning handler `(msg) => void`. When omitted, warnings are logged to `console.warn` |

### Return Value

```javascript
{
    enums: {
        machineState: { name: 'machineState', values: {...} },
        ...
    },
    assetClasses: {
        rwmPump: { name: 'rwmPump', columns: {...}, insightTypes: {...} },
        ...
    },
    digest: {
        globalHash: 'a1b2c3...',      // SHA-256 of entire semantics
        enumsHash: 'd4e5f6...',       // SHA-256 of enums only
        assetHashes: {
            rwmPump: 'g7h8i9...'      // Per-asset-class hashes
        },
        version: '1.0.0'
    }
}
```

### Two-Phase Validation

**Phase 1: Schema Validation** (per-file)
- Enum files validated against enum schema
- Asset class files validated against asset class schema
- Column validation delegated to column schema

**Phase 2: Cross-Reference Validation** (after loading)
- `enumRef` → referenced enum must exist
- `contexts[].when.column` → referenced column must exist
- `insightTypes[].columns` → all columns must exist, no duplicates
- `insightTypes[].designatedTimestamp` → must be timestamp-type column

### Error Handling

The loader uses **fail-fast** behavior: throws on first validation error with detailed context.

```
WinkComposer/semantics: AssetClass 'pumpStats', column 'temperature':
  operational/specification limits exceed physicalRange bounds
```

Error patterns include:
- File path for parse errors
- Asset class name + column name for column errors
- Insight type name for insight type errors
- Specific validation rule violated

### Completeness Warnings

After validation succeeds, the loader runs advisory checks that emit **warnings** (non-blocking — they never fail the load). Use `suppressWarnings` or `onWarning` to control output.

| Warning | Condition |
|---------|-----------|
| Missing interpretation | Any column without an `interpretation` array |
| Missing physicalRange | Numeric column (`float64`, `int64`) without `physicalRange` |
| Missing unit | Numeric column without `unit` |
| Unreferenced enum | Enum not used by any column's `enumRef` across all asset classes |
| Unused column | Column not included in any `insightType` |
| Enum-like column | `int64` column with a small physicalRange (< 20) that has no `enumRef` |

Warnings help catch common oversights — a column that exists but appears in no insight type is likely a mistake, and a numeric column without a unit will lack context in MCP queries and dashboard displays.

---

## Semantic Digest

Digests provide SSOT verification for schema-semantics binding.

### Purpose

- Detect schema changes between versions
- Bind storage schemas to specific semantics
- Enable migration detection in storage adapters
- Version tracking for configuration management

### Digest Structure

```javascript
{
    globalHash: string,           // SHA-256 of {enums, assetClasses}
    enumsHash: string,            // SHA-256 of enums only
    assetHashes: {
        [assetClassName]: string  // Per-asset-class SHA-256
    },
    version: string               // User-provided version
}
```

### Canonicalization

Digests are **formatting-independent**:
- Object keys sorted alphabetically (recursive)
- Array order preserved (contexts are order-sensitive)
- All properties included (descriptions affect interpretation)

This ensures identical semantics produce identical hashes regardless of JSON formatting.

### Computing Custom Digests

```javascript
// Internal API — not available through '@winkjs/composer' package imports.
// Use a direct path from within the repository.
import { computeSemanticsDigest, canonicalize } from '../core/semantics/index.js';

const digest = computeSemanticsDigest(
    { enums, assetClasses },
    '2.0.0'  // Optional version
);

// For custom canonicalization
const canonical = canonicalize(myObject);
```

---

## Flow Integration

Semantics integrate with the Flow Language through three methods: `.assetClass()`, `.storage()`, and `.persistIf()`.

### Basic Integration Pattern

```javascript
import { flow, questdbAdapter, loadSemantics } from '@winkjs/composer';

// Load semantics
const semantics = await loadSemantics('./semantics');
const assetClass = semantics.assetClasses.rwmPump;

// Build pipeline
const handle = await flow('pump-monitor')
    // Register asset class
    .assetClass(assetClass)

    // Register storage adapter (tablePrefix defaults to assetClass.name → 'rwmPump')
    .storage(questdbAdapter, {
        ilpUrl: 'localhost:9000',   // QuestDB ILP endpoint
        pgUrl: 'localhost:8812'     // QuestDB PostgreSQL endpoint
    })

    // Isolate state per asset
    .assetId('assetId')

    // Pipeline nodes...
    .threshold('detect', 'pump_out_p', { active: 'washing' }, { mode: 'above', threshold: 78 })

    // Conditional persistence
    .persistIf('save',
        msg => Number.isFinite(msg.pump_out_p),
        {
            storageName: 'questdb',       // References storage adapter
            insightType: 'operational',    // Must match assetClass.insightTypes key
            timestampField: 'timestamp'   // Optional: field for row timestamp
        }
    )

    .run();
```

### Table Naming Convention

Storage tables are named: `{tablePrefix}_{insightType}`. The table prefix defaults to `assetClass.name`; override it by passing `tablePrefix` in `.storage()` config.

| Asset Class | Table Prefix | Insight Type | Table Name |
|-------------|--------------|--------------|------------|
| rwmPump | rwmPump (default) | operational | rwmPump_operational |
| rwmPump | rwmPump (default) | washing | rwmPump_washing |
| rwmPump | factory1 (override) | operational | factory1_operational |

### persistIf Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `storageName` | string | Yes | References registered storage adapter ID |
| `insightType` | string | Yes | Must match key in `assetClass.insightTypes` |
| `timestampField` | string | No | Message field for row timestamp ([milliseconds since epoch](../understanding-composer.md#timestamps)) |

---

## Complete Flow Integration Example

```javascript
import { flow, csv, questdbAdapter, loadSemantics } from '@winkjs/composer';

// Load semantics
const semanticsPath = './semantics';
const semantics = await loadSemantics(semanticsPath);
const assetClass = semantics.assetClasses.industrialPump;

console.log(`Loaded asset class: ${assetClass.name}`);
console.log(`Insight types: ${Object.keys(assetClass.insightTypes).join(', ')}`);
console.log(`Digest: ${semantics.digest.globalHash.slice(0, 16)}...`);

// Build pipeline
const handle = await flow('pump-analytics')
    // Semantics & storage configuration
    .assetClass(assetClass)
    .storage(questdbAdapter, {
        tablePrefix: 'factory1',
        ilpUrl: 'localhost:9000',
        pgUrl: 'localhost:8812'
    })
    .assetId('pumpId')

    // Data source
    .source(csv, {
        path: './pump-data.csv',
        transform: (row) => ({
            pumpId: row.pump_id,
            timestamp: Date.parse(row.timestamp),
            outlet_pressure: parseFloat(row.pressure),
            motor_temp: parseFloat(row.temperature),
            operating_mode: parseInt(row.mode, 10)
        })
    })

    // Analytics pipeline
    .sanitize('validate', ['outlet_pressure', 'motor_temp'],
        { failureReason: 'error' },
        { ranges: {
            outlet_pressure: { min: 0, max: 150 },
            motor_temp: { min: -20, max: 150 }
        }})

    .threshold('highPressure', 'outlet_pressure',
        { active: 'pressureAlarm' },
        { mode: 'above', threshold: 110, hysteresis: 5 })

    .threshold('highTemp', 'motor_temp',
        { active: 'tempAlarm' },
        { mode: 'above', threshold: 80, hysteresis: 3 })

    // Persist operational data
    .persistIf('saveOperational',
        (msg) => msg.outlet_pressure_error === null,
        {
            storageName: 'questdb',
            insightType: 'operational',
            timestampField: 'timestamp'
        })

    // Persist fault events
    .persistIf('saveFaults',
        (msg) => msg.pressureAlarm || msg.tempAlarm,
        {
            storageName: 'questdb',
            insightType: 'faults',
            timestampField: 'timestamp'
        })

    .run();

console.log(`Pipeline running: ${handle.flowName}`);
console.log('Tables created:');
console.log('  - factory1_operational');
console.log('  - factory1_faults');
```
