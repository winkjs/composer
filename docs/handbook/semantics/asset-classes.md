# Asset Classes

An asset class represents an equipment type (industrial pump, vehicle, sensor array) with its associated columns and insight types.

## Structure

```json
{
    "name": "rwmPump",
    "description": "Reverse Water Motor pump system",
    "columns": {
        "timestamp": { "type": "timestamp", "description": "Message timestamp" },
        "pump_out_p": { "type": "float64", "unit": "bar", "description": "Outlet pressure" },
        "pump_t": { "type": "float64", "unit": "celsius", "description": "Pump temperature" },
        "is_washing": { "type": "bool", "description": "Washing state flag" }
    },
    "insightTypes": {
        "operational": {
            "columns": ["timestamp", "pump_out_p", "pump_t"],
            "designatedTimestamp": "timestamp"
        },
        "washing": {
            "columns": ["timestamp", "is_washing"],
            "designatedTimestamp": "timestamp"
        }
    }
}
```

## Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Valid identifier |
| `description` | string | No | Human-readable description |
| `columns` | object | Yes | Column definitions (at least one) — see [Columns](./columns.md) |
| `insightTypes` | object | Yes | Insight type definitions (**at least one** required) |

**Strict properties:** Only the properties above are allowed. Unknown properties are rejected.

## Column Keys

Column keys must be valid identifiers:
- Start with letter, underscore, or dollar sign
- Contain only letters, digits, underscores, dollar signs
- No spaces or special characters
- Examples: `pump_out_p`, `motorTemp`, `_internal`, `$computed`

## Insight Types

Insight types define subsets of columns for specific storage tables. Each insight type maps to a separate table in storage.

```json
{
    "insightTypes": {
        "operational": {
            "columns": ["timestamp", "pump_out_p", "pump_t", "motor_t"],
            "designatedTimestamp": "timestamp",
            "description": "Continuous operational data"
        }
    }
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `columns` | string[] | Yes | Non-empty array of column names |
| `designatedTimestamp` | string | Yes | Column for row timestamp (must be in columns) |
| `description` | string | No | Human-readable description |

**Validation Rules:**
- All columns must exist in asset class `columns`
- No duplicate columns within an insight type
- `designatedTimestamp` must be in the `columns` array
- `designatedTimestamp` column must have `type: "timestamp"`

Each insight table also carries one automatic column: `assetId` (a
SYMBOL). Composer fills it from the flow's `.assetId()` field. You
never declare it here, and a record field named `assetId` does not set
it. Declaring your own `assetId` column in an insight type fails at
startup with an `INVALID_CONFIG` error. A dictionary column named
`assetId` that no insight type persists is fine. See
[The `assetId` Column](../visualization.md#the-assetid-column).

## Validation Rules

| Rule | Error Pattern |
|------|---------------|
| Name is identifier | `Asset class name must be a valid identifier` |
| At least one column | `columns must have at least 1 property` |
| Column key is identifier | `Column key must be a valid identifier` |
| Insight type columns exist | `column 'X' not found in asset class columns` |
| No duplicate columns | `duplicate column 'X' in insightType` |
| designatedTimestamp in columns | `designatedTimestamp 'X' not in columns list` |
| designatedTimestamp is timestamp | `designatedTimestamp must reference timestamp column` |
| No duplicate names | `Duplicate asset class name 'X' found in 'path'` |
| enumRef exists | `enumRef 'X' not found in loaded enums` |

---

## Complete Example

### Industrial Pump Asset Class

```json
{
    "name": "industrialPump",
    "description": "Industrial high-pressure pump system",
    "columns": {
        "timestamp": {
            "type": "timestamp",
            "description": "Measurement timestamp (epoch ms)"
        },
        "outlet_pressure": {
            "type": "float64",
            "unit": "bar",
            "resolution": 0.1,
            "description": "Outlet pressure",
            "interpretation": [
                "Severity: higher values indicate pump strain",
                "Threshold: > 110 bar requires maintenance check"
            ],
            "physicalRange": { "min": 0, "max": 150 },
            "operational": {
                "criticalLow": 10,
                "warningLow": 20,
                "target": 80,
                "warningHigh": 110,
                "criticalHigh": 120,
                "hysteresis": 2
            },
            "specification": {
                "lowerSpecLimit": 60,
                "target": 80,
                "upperSpecLimit": 100
            }
        },
        "motor_temp": {
            "type": "float64",
            "unit": "celsius",
            "resolution": 0.5,
            "description": "Motor temperature",
            "interpretation": [
                "Severity: higher values indicate thermal stress",
                "Correlate: with outlet_pressure for load analysis"
            ],
            "physicalRange": { "min": -20, "max": 150 },
            "contexts": [
                {
                    "when": { "column": "operating_mode", "equals": 2 },
                    "operational": { "warningHigh": 85, "criticalHigh": 95 }
                },
                {
                    "when": "default",
                    "operational": { "warningHigh": 70, "criticalHigh": 80 }
                }
            ]
        },
        "operating_mode": {
            "type": "int64",
            "description": "Current operating mode",
            "enumRef": "operatingMode"
        },
        "fault_code": {
            "type": "int64",
            "description": "Active fault code (0 = no fault)",
            "enumRef": "faultCodes"
        }
    },
    "insightTypes": {
        "operational": {
            "columns": ["timestamp", "outlet_pressure", "motor_temp", "operating_mode"],
            "designatedTimestamp": "timestamp",
            "description": "Continuous operational telemetry"
        },
        "faults": {
            "columns": ["timestamp", "fault_code", "motor_temp", "outlet_pressure"],
            "designatedTimestamp": "timestamp",
            "description": "Fault event records"
        }
    }
}
```

### Associated Enums

```json
// enums/operating-mode.json
{
    "name": "operatingMode",
    "description": "Pump operating modes",
    "values": {
        "0": "Idle",
        "1": "Normal",
        "2": "High Load",
        "3": "Maintenance"
    }
}
```

```json
// enums/fault-codes.json
{
    "name": "faultCodes",
    "description": "Pump fault codes",
    "values": {
        "0": "No Fault",
        "1": "Over Temperature",
        "2": "Over Pressure",
        "3": "Vibration Alarm",
        "10": "Sensor Failure",
        "99": "Unknown Error"
    }
}
```
