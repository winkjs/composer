# Semantics

Composer's semantics system provides a declarative metadata layer that defines data schemas, validation rules, and storage integration. Semantics serve as the Single Source of Truth (SSOT) for:

- **Column definitions**: Data types, units, physical ranges, operational limits
- **Asset classes**: Equipment types with their associated measurements
- **Insight types**: Column groupings for storage tables
- **Enumerations**: Human-readable labels for categorical values

## Facts, Not Decisions

Semantics describe **facts** about your data, never **decisions** about what to do with it. A column's physical range is a fact; the threshold that fires an alert is a decision. The two stay independent — the fact describes the equipment, the decision drives the logic in a flow.

| Semantics (facts) | Flow language (decisions) |
|-------------------|---------------------------|
| Outlet pressure is measured in bar | Alert when pressure exceeds 110 bar |
| Temperature range is −40 to 150 °C | Switch to high-temp mode above 85 °C |
| Vibration is measured in mm/s RMS | Flag a bearing degraded when the trend slope exceeds 0.02 |
| Pump status codes: 0 = Idle, 1 = Running | Only process messages where status is Running |

A pump's outlet pressure might carry a specification limit of 90 bar — a fact about the equipment. A flow might use a threshold of 110 bar to detect a high-pressure event — a decision about when to act. The two never collide, because they live in different places. Nodes do not read semantics while running; everything downstream does — the storage layer builds schemas from them, the MCP server answers queries with them, and dashboards render limits and labels from them.

## Why Semantics Matter

1. **Schema Validation**: Catch configuration errors at load time, not runtime
2. **Type Safety**: Ensure columns have correct types for storage adapters
3. **SSOT Binding**: Semantic digests enable schema-to-semantics verification
4. **Documentation**: Self-documenting data models with units and descriptions
5. **Context-Aware Limits**: Different operational bounds for different operating modes

## Architecture

Semantics are a shared metadata layer consumed by multiple subsystems of composer:

```text
semantics/
├── enums/              # Enumeration definitions
│   └── *.json
└── asset-classes/      # Asset class definitions
    └── *.json
              ↓
        loadSemantics()
              ↓
    { enums, assetClasses, digest }
              ↓
    ┌─────────┼──────────────────┐
    │         │                  │
    ▼         ▼                  ▼
  Flow DSL   MCP Server       Dashboard
  .assetClass()  catalog,        column units,
  .storage()     enrichment,     limit display,
  .persistIf()   SQL examples    context labels
    │
    ▼
  Storage Tables
  {tablePrefix}_{insightType}
```

- **Flow DSL** — wires columns to storage tables, validates types, applies limit semantics
- **MCP Server** — generates query catalogs, enriches results with units and descriptions, builds SQL examples from column metadata
- **Dashboard** — displays units, labels, operational limits, and context-dependent thresholds

## In This Section

| Document | What It Covers |
|----------|---------------|
| [Enums](./enums.md) | Enumeration definitions — human-readable labels for categorical values |
| [Columns](./columns.md) | Column types, properties, limits hierarchy, context-dependent limits |
| [Asset Classes](./asset-classes.md) | Equipment types, insight types, complete examples |
| [Loader](./loader.md) | `loadSemantics()` API, digest, validation, flow integration |

## See Also

- [Configuration Nodes](../nodes/configuration.md) — Source, emitter, storage, and other config methods
- [Flow Language](../flow-language.md#semantics) — How semantics fit into the flow
- [Nodes Reference](../nodes/observability.md#persistif) — `persistIf` node for storage
