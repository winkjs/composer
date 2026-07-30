# Enums

Enums provide human-readable labels for column values, enabling semantic display of numeric or coded data.

## Structure

```json
{
    "name": "machineState",
    "description": "Machine operating states",
    "values": {
        "0": "Idle",
        "1": "Running",
        "2": "Maintenance",
        "3": "Error"
    }
}
```

## Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Valid identifier (no spaces, starts with letter/underscore) |
| `description` | string | No | Human-readable description |
| `values` | object | Yes | Key-value mapping (at least one entry) |

**Strict properties:** Only the properties above are allowed. Unknown properties are rejected.

## Valid Enum Keys

Enum keys can be one of three types:

| Key Type | Examples | Use Case |
|----------|----------|----------|
| **Numeric strings** | `"0"`, `"42"`, `"-1"`, `"3.14"` | int64/float64 columns |
| **Boolean strings** | `"true"`, `"false"` | bool columns |
| **Identifiers** | `"idle"`, `"RUNNING"`, `"state_1"` | string columns |

**Important**: Only canonical numeric forms are accepted:
- Valid: `"0"`, `"3.14"`, `"-1"`
- Invalid: `"01"` (leading zero), `"007"`, `"+1"`, `"1."`, `".5"`

## Invalid Enum Keys

The following are rejected:
- Empty strings
- Strings with whitespace
- Special characters: `"@#$%"`, `"has-dash"`, `"has.dot"`
- Non-canonical numbers: `"01"`, `"00"`, `"+1"`
- Mixed alphanumeric starting with digit: `"123abc"`

## Enum Values

All values must be non-empty strings. Values can contain spaces and special characters for display purposes:

```json
{
    "values": {
        "0": "Idle State",
        "1": "Running - Normal",
        "2": "Error (Critical)"
    }
}
```

## Validation Rules

| Rule | Error Pattern |
|------|---------------|
| Name is identifier | `Enum name must be a valid identifier` |
| At least one value | `values must have at least 1 property` |
| Key is valid | `Enum key must be numeric, boolean, or identifier` |
| Value is non-empty string | `Enum value must be non-empty string` |
| No duplicate names | `Duplicate enum name 'X' found in 'path'` |

## Examples

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
