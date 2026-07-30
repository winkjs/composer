# Understanding Composer

## 5-Minute Quick Start

Four nodes. That's all it takes to go from raw sensor data to confirmed, broadcast alerts.

**Step 1 — Smooth noisy data**

```javascript
.esMean('smooth', 'temperature', { mean: 'smoothTemp' }, { halfLife: 5 })
```

Reads `temperature` from each message, computes an exponentially smoothed mean, and adds `smoothTemp` to the message.

**Step 2 — Detect when it's too hot**

```javascript
.threshold('check', 'smoothTemp', { active: 'overheating' }, { mode: 'above', threshold: 80 })
```

Reads `smoothTemp` (added by step 1), adds `overheating: true` when above 80.

**Step 3 — Confirm it's not a fluke**

```javascript
.persistenceCheck('confirm',
    msg => msg.overheating === true,
    { persistenceConfirmed: 'confirmed' },
    { minVotes: 2, outOfTotal: 3 }
)
```

Only sets `confirmed: true` if overheating persists in at least 2 of the last 3 messages.

**Step 4 — Broadcast the alert**

```javascript
.emitIf('alert',
    msg => msg.confirmed === true,
    { target: 'mqtt', insightType: 'tempAlert' }
)
```

Sends a copy of the message to MQTT when confirmed.

**Put it together:**

```javascript
import { flow } from '@winkjs/composer';

flow('temperature-monitor')
    .esMean('smooth', 'temperature', { mean: 'smoothTemp' }, { halfLife: 5 })
    .threshold('check', 'smoothTemp', { active: 'overheating' },
        { mode: 'above', threshold: 80 })
    .persistenceCheck('confirm',
        msg => msg.overheating === true,
        { persistenceConfirmed: 'confirmed' },
        { minVotes: 2, outOfTotal: 3 })
    .emitIf('alert',
        msg => msg.confirmed === true,
        { target: 'mqtt', insightType: 'tempAlert' })
    .run();
```

Each node reads what previous nodes added and contributes its own fields — the message grows as it flows through the pipeline:

```text
Incoming:           { temperature: 92 }
After esMean:       { ..., smoothTemp: 88.5 }
After threshold:    { ..., overheating: true }
After persist..:    { ..., confirmed: true }
After emitIf:       → copy sent to MQTT
```

**Ready for more?** Jump to [Complete Examples](#complete-examples) or explore the [Node Catalog](./nodes/index.md).

---

## Overview

WinkComposer provides composable nodes for building real-time streaming analytics. Each node has a specific purpose in your pipeline:

- **Signal Conditioning**: Clean and prepare raw sensor data
- **Feature Extraction**: Derive meaningful patterns and statistics
- **Arithmetic**: Perform basic mathematical operations
- **Detection**: Identify anomalies, thresholds, and state changes
- **Intelligence**: Fuse evidence, estimate hidden state, and detect anomalies that simpler nodes miss
- **Flow Control**: Filter and route messages
- **Observability**: Monitor and broadcast pipeline behavior
- **Orchestration**: Coordinate node behavior dynamically

## How Messages Flow

### Pipeline Diagram Symbols

Throughout this document, pipeline diagrams use these symbols:

```text
◆ = Processing (active)    □ = Disabled (via controller)
⊗ = Filter (passIf)        ◇ = Controller
╦ = Emission (emitIf)
```

### How Each Node Enriches the Message

A message enters the pipeline and visits each node in order. At each node, the node reads fields from the message, computes results, and adds new fields onto the same message for downstream nodes to use:

```text
msg→ [◆ esMean] → [◆ threshold] → [◆ persistenceCheck] → [╦ emitIf]
      │                │                │                     │ ↓
      reads: temp      reads: avg       reads: overheating    reads: confirmed
      adds: avg        adds:            adds: confirmed       broadcasts to MQTT
                       overheating
```

> [!NOTE]
> `emitIf` broadcasts a copy to an external system but does not stop the flow — if more nodes followed, the message would continue through them unchanged.

### Three Things That Can Happen

| What happens | When | What downstream nodes see |
|-------------|------|--------------------------|
| **Process** | Node is active | Message enriched with new fields, continues forward |
| **Disabled** | Node is turned off (via controller) | Message passes through unchanged — node does nothing |
| **Filtered** | `passIf` predicate returns false | Message **stops** — downstream nodes never see it |

### How a Disabled Node Differs from a Filter

When a node is **disabled** (by a controller), it acts as if it doesn't exist — the message passes through with no change and continues to the next node. When a **filter** (`passIf`) rejects a message, the message is dropped entirely and no downstream node ever sees it.

## Timestamps

> [!IMPORTANT]
> Every timestamp in WinkComposer — whether it comes from your data or is generated internally — must be an integer representing **milliseconds since January 1, 1970 (UTC)**. Getting this wrong will produce silently incorrect durations, dwell times, and storage records.

### Why Milliseconds Since Epoch

A millisecond epoch timestamp is a single number — like `1735500000000` — that identifies an exact instant in time. It has no timezone, no format ambiguity, and no parsing overhead. The same number means the same moment whether the pipeline runs in Tokyo, London, or New York. Timezones only matter when you *display* a timestamp to a human; the analytics pipeline never does that.

This is also what JavaScript's `Date.now()` returns, so it works naturally with the language.

### What You Need to Do

If your messages include a timestamp field (for dwell time tracking, state change detection, time-based slope, or storage), make sure the value is **milliseconds since epoch**:

```javascript
// Already correct — no conversion needed
{ ts: Date.now() }                     // 1735500000000 (13 digits)
{ ts: 1735500000000 }                  // From a system that already uses epoch ms

// Needs conversion — seconds (10 digits) must be multiplied by 1000
{ ts: 1735500000 }                     // This is seconds, not milliseconds
{ ts: 1735500000 * 1000 }              // Now it's milliseconds

// Needs conversion — ISO string must be parsed
{ ts: '2024-12-30T00:00:00Z' }         // String, not a number
{ ts: Date.parse( '2024-12-30T00:00:00Z' ) }  // Parsed to milliseconds
```

**Quick check:** if your timestamp has **13 digits**, it's milliseconds. If it has **10 digits**, it's seconds — multiply by 1000.

### What Happens If You Don't Provide a Timestamp

Nodes that need timing — like `dwellTimeTracker` and `stateChangeDetector` — accept an optional `timestampField` option. When omitted, they use the system clock (`Date.now()`) automatically. This is fine when messages arrive in real time. But if you're replaying historical data or processing batched records, you **must** provide a timestamp field so that durations reflect the original event times, not the replay clock.

### Where Timestamps Are Used

| Node / Component | What It Uses the Timestamp For |
|------------------|-------------------------------|
| `dwellTimeTracker` | How long a condition has been active (dwell time, duty cycle) |
| `stateChangeDetector` | How long the current state has lasted (dwell time since last transition) |
| `lag` | Time-normalized slope: (value change) ÷ (time change) |
| `persistIf` | Row timestamp written to storage (QuestDB) |
| Time-sliding windows | Evicting entries older than the configured duration |

All of these compute **differences between timestamps** — subtracting one from another to get a duration. If timestamps are in the wrong unit, every duration will be wrong by a factor of 1000.

## Built-in Resilience

This section covers how a pipeline handles bad data. For keeping a
deployment running through restarts and outages — sessions, brokers,
and recovery — see the [Resilience](./resilience.md) guide.

### What Happens When Input Is Bad

Streaming data is messy. Sensors go offline (missing or invalid values), PLCs emit sentinel values (-9999, 65535), division by zero produces meaningless results, and startup transients mean the first few readings can't be trusted. WinkComposer handles this at two levels:

**First line of defense — the `sanitize` node.** Place it at the start of your pipeline to catch bad data before it enters the computation chain. It validates against configured ranges, value lists, or custom predicates — and marks failures as invalid for all downstream nodes:

```javascript
.sanitize('check', 'temperature', { failureReason: 'tempErr' }, {
    ranges: { temperature: { min: -40, max: 150 } }    // PLC sentinel -9999 → marked invalid
})
```

**Safety net — automatic invalid-value propagation.** Every computational node validates its input. When a node encounters a bad value (missing, out of range, or the result of a failed upstream computation), it skips its own computation and marks all its outputs as invalid. Downstream nodes see the invalid marker, trigger their own validation, and propagate it further — a controlled cascade, not a crash. On the next valid message, nodes resume normal computation automatically. No reset or intervention needed.

In **multi-field mode**, each field is processed by its own isolated node instance. If one sensor produces bad data, only that sensor's outputs are marked invalid — the other sensors continue computing normally:

```text
temperature: 92.5    → esMean computes → smoothTemp: 88.3
pressure: (invalid)  → esMean skips    → smoothPres: (invalid)
vibration: 0.42      → esMean computes → smoothVib: 0.41
```

### One Flow Per Process

A flow is designed to own its process. When you call `.run()`, it registers signal handlers for graceful shutdown. This means one running flow per process:

- Use `.assetId()` for per-asset isolation (sensors, machines, pumps)
- Use `.switch()`/`.case()` for specialized pipelines within one flow
- Use separate processes for truly independent flows

This keeps operations simple: one flow, one process, clear ownership.

### What Happens When User Functions Throw

You pass functions into the pipeline in two ways: as **predicates** that decide what happens — like the condition in `emitIf` or `passIf` — and as **tunables** that adapt options at runtime — like a `threshold` that varies by operating mode. Both are guarded, and every node follows the same pattern: catch the exception, continue processing, log once per error episode.

**Predicates:** Each node handles the exception according to its role — a gate like `passIf` drops the message, a side-effect node like `emitIf` skips the emission, a controller skips the failing condition and tries the next one. The first error per episode is logged to console; repeated errors are suppressed until the predicate recovers. See [What Happens When a Predicate Throws](./flow-language.md#what-happens-when-a-predicate-throws) for per-node details.

**Tunables:** When a dynamic option function throws, the node continues with the last successfully resolved value. If no previous value exists (first message), the node falls back to a safe default. Logging follows the same episode-based pattern — one log per error episode, not one per message. See [What Happens When a Tunable Throws](./flow-language.md#what-happens-when-a-tunable-throws) for details.

**Reset:** When a controller resets a node, the error suppression also clears. If the same error happens again after the reset, a fresh entry is logged — confirming that the reset did not resolve the problem.

### Pipeline Isolation — One Flow, Independent State Per Asset

When you configure `.assetId( 'machineId' )`, each unique asset gets its own complete pipeline instance — with independent buffers, counters, smoothing history, and threshold state. You write one flow definition; the framework creates isolated instances on demand as new assets appear:

```text
machineId: 'pump-A'  →  [esMean state A] → [threshold state A] → ...
machineId: 'pump-B'  →  [esMean state B] → [threshold state B] → ...
machineId: 'pump-C'  →  [esMean state C] → [threshold state C] → ...
```

Each asset lives in its own world — independent smoothing history, independent threshold state, independent controller decisions. Combined with the invalid-value handling above, this means a misbehaving sensor on one asset cannot corrupt another asset's analytics. A single message stream can carry data from hundreds of assets, and each one gets clean, dedicated analytics as if it had its own pipeline.

---

## Complete Examples

These examples build on the patterns introduced in [Quick Start](#5-minute-quick-start) — combining multiple nodes into production pipelines.

### Industrial Pump Monitor

```javascript
import { flow } from '@winkjs/composer';

const SENSOR_RANGES = {
    inlet_pressure: { min: 0, max: 10 },      // Bar
    outlet_pressure: { min: 0, max: 120 },    // Bar
    pump_temp: { min: 0, max: 100 },          // Celsius
    motor_temp: { min: 0, max: 100 },         // Celsius
    vibration_rms: { min: 0, max: 25 }        // mm/s RMS
};

const pumpMonitor = flow('pump-health')
    // 1. Validate sensors (multi-field with auto-naming)
    .sanitize('validate',
        ['inlet_pressure', 'outlet_pressure', 'pump_temp', 'motor_temp', 'vibration_rms'],
        { failureReason: 'fault', failedValue: 'value' },
        { ranges: SENSOR_RANGES }
    )
    // Creates: inlet_pressure_fault, inlet_pressure_value, etc.

    // 2. Check for any sensor fault (condition-based, single mode)
    .persistenceCheck('fault-confirm',
        msg => msg.inlet_pressure_fault || msg.outlet_pressure_fault ||
               msg.pump_temp_fault || msg.motor_temp_fault || msg.vibration_rms_fault,
        { persistenceConfirmed: 'sensorFaultConfirmed' },
        { minVotes: 2, outOfTotal: 3 }
    )
    // Creates: sensorFaultConfirmed (direct naming)

    // 3. Track fault duration (condition-based, single mode)
    .dwellTimeTracker('fault-timer',
        msg => msg.sensorFaultConfirmed,
        {
            active: 'faultActive',
            dwellTime: 'faultDuration',
            dutyCycle: 'faultPercentage'
        }
    )
    // Creates: faultActive, faultDuration, faultPercentage (direct naming)

    // 4. Calculate differential pressure (field-pair, single mode)
    .diff('pressure', 'outlet_pressure', 'inlet_pressure', {
        diff: 'differentialPressure'
    })
    // Creates: differentialPressure (direct naming)

    // 5. Detect washing cycles (single field)
    .threshold('washing', 'differentialPressure',
        { active: 'washingActive' },
        { mode: 'above', threshold: 72, hysteresis: 6 }
    )
    // Creates: washingActive (direct naming)

    // 6. Track washing duration (condition-based, single mode)
    .dwellTimeTracker('wash-timer',
        msg => msg.washingActive,
        {
            dwellTime: 'washDuration',
            dutyCycle: 'washPercentage'
        }
    )
    // Creates: washDuration, washPercentage (direct naming)

    // 7. Emit status updates (condition-based)
    .emitIf('broadcast-status',
        msg => msg.washDuration !== null || msg.faultDuration !== null,
        {
            target: 'mqtt',
            insightType: 'pumpStatus',
            topic: 'pumps/{id}/status'
        }
    )

    .run();
```

### Key Takeaways from This Example

1. **Multi-field with auto-naming**: `sanitize` takes an array of fields and names each output as `field_label`
2. **Single field with direct naming**: All other nodes use direct field names and output exactly what's specified
3. **Auto-naming only affects multi-field**: The `field_label` rule applies to the sanitize outputs; single-field nodes use the exact name you give
4. **Condition-based nodes**: Always single mode, always direct naming
5. **Clear progression**: Validate → Detect → Confirm → Track → Broadcast

---

## Key Principles

1. **Messages flow forward** — each node reads, computes, and adds fields; the message grows as it moves through the pipeline
2. **Nodes adapt** — controllers enable, disable, and reset other nodes based on conditions, so the pipeline responds to what the data is telling it
3. **Assets are isolated** — each sensor, machine, or device gets independent state; a bad reading from one can never corrupt another
4. **Clean data first** — `sanitize` at the front of the pipeline catches bad values before they spread; the safety net catches anything it misses
5. **Observe without disrupting** — `emitIf` and `persistIf` send copies to external systems while the message continues unchanged
6. **Scale with layers** — the same `flow()` and the same nodes work at every level, from a single sensor to plant-wide analytics
7. **Define data once** — semantics are the single source of truth for column types, units, limits, and storage schemas
8. **Timestamps are milliseconds since epoch** — a single timezone-free number that means the same instant everywhere; wrong units silently corrupt every duration calculation
