# Columns

Columns define individual measurements or computed values within an asset class. Each column has a type and optional metadata for validation, display, and analytics.

## Column Types

| Type | Description | Storage |
|------|-------------|---------|
| `float64` | 64-bit floating point | QuestDB DOUBLE |
| `int64` | 64-bit integer | QuestDB LONG |
| `string` | Text string | QuestDB STRING |
| `bool` | Boolean value | QuestDB BOOLEAN |
| `timestamp` | Unix epoch milliseconds | QuestDB TIMESTAMP |

## Basic Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | string | (required) | One of the column types above |
| `unit` | string | `""` | Engineering unit (e.g., "bar", "°C", "mm/s") |
| `resolution` | number | `1` | Measurement resolution (must be positive) |
| `description` | string | `""` | Human-readable description |
| `interpretation` | string[] | `[]` | Natural language guidance for LLM consumers (see [below](#interpretation-arrays-llm-native)) |
| `hysteresis` | number | `0` | Column-level deadband for threshold transitions (non-negative) |
| `enumRef` | string | — | Reference to enum name for value labels |

**Strict properties:** Only the properties above plus `physicalRange`, `operational`, `specification`, and `contexts` (documented in following sections) are allowed. Unknown properties are rejected.

**Hysteresis precedence:** When hysteresis appears at both column level and inside `operational`, the operational value takes priority: `operational.hysteresis` → `column.hysteresis` → `0`.

## Example Column

```json
{
    "pump_out_p": {
        "type": "float64",
        "unit": "bar",
        "resolution": 0.1,
        "description": "Outlet pressure",
        "physicalRange": { "min": 0, "max": 120 }
    }
}
```

## Interpretation Arrays (LLM-Native)

The `interpretation` property is an **array of natural language strings** providing guidance to LLM consumers about how to interpret values. Default is empty array `[]`.

**Recommended prefixes** (convention, not validated):

| Prefix | Purpose | Example |
|--------|---------|---------|
| `Severity:` | How to interpret magnitude | `"Severity: higher values indicate degradation"` |
| `Threshold:` | Key boundaries | `"Threshold: > 100 bar requires maintenance"` |
| `Correlate:` | Related metrics | `"Correlate: with motor_temp for root cause"` |
| `Trend:` | Temporal patterns | `"Trend: increasing rate suggests wear"` |
| `Pattern:` | Multi-signal signatures | `"Pattern: spikes with fault_code indicate issue"` |
| `Action:` | Recommended response | `"Action: alert operator if sustained"` |
| `Context:` | Domain background | `"Context: normal range varies by operating mode"` |

**Example:**
```json
{
    "outlet_pressure": {
        "type": "float64",
        "unit": "bar",
        "interpretation": [
            "Severity: higher values indicate pump strain",
            "Threshold: > 110 bar requires immediate attention",
            "Correlate: with motor_temp to assess system health"
        ]
    }
}
```

---

## Three-Tier Limit Hierarchy

Composer enforces a nested limit hierarchy for robust validation:

```
physicalRange (outer boundary - sensor limits)
  └── operational (middle - safe operating range)
        └── specification (inner - process capability)
```

### Physical Range

Defines the physical sensor bounds. Values outside this range indicate sensor failure or data corruption.

```json
{
    "physicalRange": {
        "min": 0,
        "max": 120
    }
}
```

**Validation Rules:**
- Both `min` and `max` required
- `min < max` (strictly less than)
- Both must be finite numbers (not NaN or Infinity)

### Operational Limits

Defines safe operating ranges with warning and critical thresholds. Uses intuitive naming (not hiHi/loLo).

```json
{
    "operational": {
        "criticalLow": 5,
        "warningLow": 10,
        "target": 50,
        "warningHigh": 90,
        "criticalHigh": 95,
        "hysteresis": 2
    }
}
```

| Property | Description |
|----------|-------------|
| `criticalLow` | Minimum safe operating value |
| `warningLow` | Below this triggers warning |
| `target` | Ideal operating value |
| `warningHigh` | Above this triggers warning |
| `criticalHigh` | Maximum safe operating value |
| `hysteresis` | Deadband for chatter-free transitions |

**Validation Rules:**
- All properties optional but must be in ascending order when present
- `criticalLow ≤ warningLow ≤ target ≤ warningHigh ≤ criticalHigh`
- Adjacent values can be equal
- All must be finite numbers
- If `physicalRange` exists: operational limits must be within `[min, max]`

### Specification Limits

Defines process capability limits for SPC/SQC analysis.

```json
{
    "specification": {
        "lowerSpecLimit": 20,
        "target": 50,
        "upperSpecLimit": 80
    }
}
```

| Property | Description |
|----------|-------------|
| `lowerSpecLimit` | Lower Specification Limit |
| `target` | Target value |
| `upperSpecLimit` | Upper Specification Limit |

**Validation Rules:**
- `lowerSpecLimit < upperSpecLimit` (strictly)
- `target` must be between `lowerSpecLimit` and `upperSpecLimit` (inclusive) if present
- All must be finite numbers
- If `physicalRange` exists: specification limits must be within `[min, max]`
- If `operational` exists: `lowerSpecLimit ≥ criticalLow` and `upperSpecLimit ≤ criticalHigh`

---

## Context-Dependent Limits

Some measurements have different "normal" depending on what the equipment is doing. A diesel engine's oil pressure of 150 kPa is healthy at idle but dangerously low at 3000 RPM. A motor temperature of 90 °C is fine under heavy load but alarming during idle. Rather than picking one set of limits and accepting false alarms in every other mode, you declare separate limits for each operating context.

### When to Use Contexts

Use **direct limits** when a column's safe range is the same regardless of operating mode:

```json
{
    "coolant_level": {
        "type": "float64",
        "unit": "liters",
        "physicalRange": { "min": 0, "max": 25 },
        "operational": { "warningLow": 8, "criticalLow": 5 }
    }
}
```

Use **contexts** when the same measurement needs different thresholds, specifications, or interpretive guidance depending on another column's value:

```json
{
    "oil_pressure": {
        "type": "float64",
        "unit": "kPa",
        "physicalRange": { "min": 0, "max": 800 },
        "contexts": [
            {
                "when": { "column": "rpm_band", "equals": 0 },
                "operational": { "warningLow": 80, "criticalLow": 50, "target": 155 },
                "interpretation": [
                    "Context: Engine at idle (800-1000 RPM), oil pressure naturally low",
                    "Action: Only alert if sustained below 50 kPa"
                ]
            },
            {
                "when": { "column": "rpm_band", "oneOf": [1, 2] },
                "operational": { "warningLow": 200, "criticalLow": 150, "target": 350 },
                "interpretation": [
                    "Context: Mid to high RPM — pump should deliver full pressure",
                    "Action: Pressure below 150 kPa at these speeds indicates pump wear or oil degradation"
                ]
            },
            {
                "when": "default",
                "operational": { "warningLow": 100, "criticalLow": 60 },
                "interpretation": [
                    "Context: RPM band unknown — use conservative limits"
                ]
            }
        ]
    }
}
```

In this example, the same `oil_pressure` column has three different alarm profiles. An MCP query can select the right context by checking `rpm_band`; a dashboard can display the active limits; an LLM can use the per-context interpretation to explain why a reading is or isn't concerning.

### Mutual Exclusivity

A column cannot have both direct limits (`operational`/`specification`) and a `contexts` array. Choose one approach — the loader rejects a column that uses both.

### Context Structure

Each context entry needs a `when` clause and at least one of `operational`, `specification`, or `interpretation`.

**Allowed properties per context:** `when`, `operational`, `specification`, `interpretation`. Unknown properties are rejected.

### When Clause Operators

The `when` clause determines which context applies. It references another column in the same asset class:

| Operator | Description | Example |
|----------|-------------|---------|
| `equals` | Exact match against a single value | `{ "column": "rpm_band", "equals": 0 }` |
| `oneOf` | Match any value in a set | `{ "column": "rpm_band", "oneOf": [1, 2] }` |
| `"default"` | Fallback when no other context matches | `{ "when": "default", ... }` |

Values in `equals` and `oneOf` can be any JSON primitive (number, string, boolean, null). Use the **runtime type** of the referenced column — for an `int64` column, use numbers (`0`, `1`, `2`), not strings (`"idle"`, `"running"`).

### Context Resolution

- Contexts are evaluated in **array order** — the first match wins
- At most **one** `"default"` context is allowed per column
- Place specific conditions first, `"default"` last
- The referenced column (`when.column`) must exist in the same asset class
- The `physicalRange` (if present) still applies across all contexts — context limits must stay within the physical range

## Validation Rules

| Rule | Error Pattern |
|------|---------------|
| Type is valid | `Column type must be one of: float64, int64, string, bool, timestamp` |
| Resolution positive | `resolution must be a positive number` |
| Hysteresis non-negative | `hysteresis must be a non-negative finite number` |
| Physical range valid | `min must be less than max` |
| Operational order | `operational limits must be in ascending order` |
| Specification order | `lowerSpecLimit must be less than upperSpecLimit` |
| Hierarchy respected | `operational/specification limits exceed physicalRange bounds` |
| Mutual exclusivity | `cannot have both contexts and direct operational/specification limits` |
| Context column exists | `context when.column 'X' not found in asset class` |
| Single default context | `at most one default context allowed` |
