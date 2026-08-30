# Flow Language

The Flow Language is a declarative DSL for composing analytics pipelines. Everything starts with `flow()` and chains naturally.

## Anatomy of a Flow

Every pipeline starts with `flow()` and ends with a terminal method. In between, there are two phases — **configuration** (infrastructure setup) and **nodes** (analytics logic):

```javascript
flow( 'pipeline-name' )

    // ── Configuration phase (optional, must come before nodes) ──
    .assetId( 'machineId' )             // each unique value gets its own pipeline instance
    .source( adapter, config )          // data source
    .emitter( adapter, config )         // output destination
    .storage( adapter, config )         // persistence
    .assetClass( definition )           // semantics for storage schema

    // ── Node phase (analytics, in processing order) ──
    .esMean( ... )
    .threshold( ... )
    .emitIf( ... )

    // ── Terminal ──
    .run()        // wire and start immediately
```

**Key rules:**
- Configuration methods must appear **before** any node — the Flow Language enforces this at build time
- Nodes execute in the order you write them — each reads fields added by earlier nodes
- `.run()` wires sources, emitters, storage, and starts the pipeline
- The source decides how the flow ends: a finite source (CSV, testHarness) ends on its own and the flow shuts down automatically; an infinite source (MQTT) runs until you stop it — see [Finite and infinite sources](./nodes/configuration.md#finite-and-infinite-sources)

The simplest possible flow has zero configuration and one node:

```javascript
flow( 'minimal' )
    .esMean( 'smooth', 'temperature', { mean: 'avg' } )
    .run();
```

## Semantics

As your pipeline grows, you add configuration. Semantics enter the flow through `.assetClass()` — they are the single source of truth for what your data means: column types, units, physical ranges, operational limits, and which columns belong to each storage table (`insightType`). The key design principle is that **facts live in semantics, decisions live in flows** — a column's physical range is a fact; the threshold that triggers an alert is a decision. Nodes don't consult semantics at runtime, but everything downstream does: the storage layer uses them to create schemas, the MCP server uses them to answer queries, and dashboards use them to render context-aware visualizations. See [Semantics Reference](./semantics/index.md).

## Layered Flows — Hierarchical Composition

Flows can feed into other flows, building a hierarchy where each layer produces higher-level insights. A **local flow** processes raw sensor data — smoothing, detecting, and emitting digests via MQTT. An **aggregate flow** subscribes to those digests, combines results from multiple assets, and persists to a database:

```text
Local flow                Aggregate flow
──────────                ──────────────
sensor data               MQTT digests
  → smooth                  → digestMoments
  → detect                  → trend detection
  → emitIf (MQTT) ──────►  → persistIf (QuestDB)
```

Both are ordinary flows — same nodes, same configuration pattern. Each layer can run anywhere (edge device, cloud, or both). The real power is composition: each layer produces higher-level insights that the next layer can build on, multiplying what a single flow could achieve alone.

## Anatomy of a Node Call

Most nodes follow this signature:

```javascript
.nodeType( name, inputField, stats, options )
//          ↑        ↑         ↑       ↑
//     unique    what to    what to   tuning
//     name      read       compute   knobs
```

```javascript
.esMean('smooth', 'temperature', { mean: 'tempAvg' }, { halfLife: 5 })
```

Variations exist — field-pair nodes take two input fields, condition nodes take a predicate instead of input/stats — but the pattern is consistent. The subsections below explain each part.

## Dynamic Options

Any option that accepts a static value can also accept a **function**. The function receives the current message and returns the resolved value — evaluated fresh on every message:

```javascript
// Static — same threshold for every message
.threshold('check', 'temp', { active: 'hot' }, { threshold: 80 })

// Tunable — threshold adapts per message
.threshold('check', 'temp', { active: 'hot' }, {
    threshold: ( msg ) => msg.baseline + 10
})
```

This means pipelines adapt to context — operating mode, shift, sensor type, learned baselines — without restart.

### Built-in Helpers

Composer provides helpers for common patterns. Each helper returns a function that works anywhere a static value is accepted:

| Helper | What It Does | Example |
|--------|-------------|---------|
| `lookupByField( field, map, default )` | Map a message field to a value | `lookupByField( 'shift', { day: 35, night: 30 }, 32 )` |
| `scaleBy( field, factor, offset, step )` | Scale a message field | `scaleBy( 'stdev', 0.5 )` → `stdev * 0.5` |
| `fromField( field, default )` | Read a field directly | `fromField( 'learnedBaseline', 50 )` |
| `chooseWhen( predicate, ifTrue, ifFalse )` | Conditional value | `chooseWhen( msg => msg.isWarmup, 100, 78 )` |
| `clampTo( field, min, max )` | Clamp a field to a range | `clampTo( 'requested', 10, 100 )` |
| `offsetBy( field, offset )` | Add an offset to a field | `offsetBy( 'baseline', 10 )` |

### Real-World Example

WiFi RSSI thresholds that vary by protocol — each message carries its own protocol type, and the threshold adapts:

```javascript
import { lookupByField } from '@winkjs/composer';

.threshold('rssiAlert', 'rssi', { active: 'rssi_low' }, {
    threshold: lookupByField( 'protocolType', {
        '802.11ac': -70,
        '802.11n': -75
    }, -75 )
})
```

Individual node entries flag tunable-capable options in plain text: the option's Type column reads `number or function`, and a **Dynamic parameters** note below the table names them.

### What Happens When a Tunable Throws

Dynamic option functions can throw at runtime — for example, if a message lacks an expected field. Composer handles this gracefully:

- **Last good value:** The node continues with the last successfully resolved value. The throwing call is simply skipped — the node processes the message using whatever value worked last.
- **First-message edge case:** If the function throws before any value has been resolved, the node falls back to a safe default — it either stays inactive until the function succeeds or marks its outputs as invalid, depending on the node.
- **Log suppression:** The first error per episode is logged to console. Subsequent errors are suppressed until the function succeeds again (recovery), preventing console flooding at high message rates.
- **Automatic recovery:** When the function succeeds again, the node resumes normal operation. A new error episode will be logged if the function fails again later.
- **Reset:** A controller-triggered reset also clears the suppression. If the tunable still throws after the reset, a fresh error is logged.

Static values (`threshold: 80`) cannot throw, so the guard only activates for user-supplied functions.

## Node Names

The first argument to every node is its **name** — a unique identifier within the pipeline:

```javascript
.esMean('smooth', 'temperature', { mean: 'tempAvg' })
//       ↑
//  node name — must be unique across the pipeline
```

Node names serve two purposes:
- **Identity**: Each name must be unique — duplicates cause a build error
- **Targeting**: Controllers reference nodes by name to send control signals (e.g., enable, disable, reset)

```javascript
.esMean('smooth', 'vibration', { mean: 'smoothVib' })           // node named 'smooth'
.esStats('stats', 'vibration', { stdev: 'vibStd' })             // node named 'stats'
.controller('ctrl', [{
    when: msg => msg.anomaly === true,
    triggers: [{ control: 'reset', targets: ['smooth', 'stats'] }]
//                                            ↑ references nodes by name
}])
```

## Choosing What Each Node Computes and Adds to the Message

Every node can compute one or more statistics — you choose which ones you want via the stats object. Each requested stat becomes a new field on the message, available to all downstream nodes. Keys choose **what to compute**, values choose **what to call it**:

```javascript
.esMean('smooth', 'temperature', { mean: 'tempAvg' })
//                                  ↑         ↑
//                            compute mean   call it 'tempAvg'
```

Request multiple outputs from one node:

```javascript
.esStats('monitor', 'temperature', { mean: 'avg', stdev: 'std', zScore: 'z' })
// Message gets three new fields: avg, std, z
```

Each node reads fields already on the message — including fields written by upstream nodes — and adds its own. The message grows as it flows:

```javascript
.esMean('smooth', 'temperature', { mean: 'smoothTemp' }, { halfLife: 5 })
.esStats('monitor', 'smoothTemp', { stdev: 'tempStd', zScore: 'tempZ' })
.threshold('check', 'tempZ', { active: 'anomaly' }, { mode: 'above', threshold: 3 })
```

```text
Incoming:         { temperature: 92 }
After esMean:     { temperature: 92, smoothTemp: 88.5 }
                                     ↑ reads temperature
After esStats:    { ..., smoothTemp: 88.5, tempStd: 2.1, tempZ: 1.7 }
                                           ↑ reads smoothTemp
After threshold:  { ..., tempZ: 1.7, anomaly: false }
                                     ↑ reads tempZ
```

## Critical Concept: Single vs Multi-Field Processing

Composer nodes can process fields in two modes, and understanding this distinction is essential:

### Single Field Mode (String Input)
Pass a single field name as a **string**. You specify the exact output name:

```javascript
// Single field - YOU control the output name directly
.esMean('baseline', 'temperature', { mean: 'tempBaseline' }, { halfLife: 10 })
// Output field: tempBaseline (exactly what you specified)

.threshold('check', 'pressure', { active: 'highPressure' })
// Output field: highPressure (exactly what you specified)
```

**Key Points:**
- Input: String field name
- Output: Exactly what you specify in the stats object
- Use when: You want precise control over output names

### Multi-Field Mode (Array Input)
Pass several field names as an **array**. The node runs once per field, and each output is named `field_label` — the input field, an underscore, then the label you gave in the stats object:

```javascript
// Multi-field — each output is named field_label automatically
.esMean('smooth', ['temperature', 'pressure'], { mean: 'smoothed' }, { halfLife: 10 })
// adds: temperature_smoothed, pressure_smoothed

.sanitize('validate',
    ['inlet_pressure', 'outlet_pressure'],  // array = multi-field
    { failureReason: 'error', failedValue: 'value' }
)
// adds: inlet_pressure_error, inlet_pressure_value,
//       outlet_pressure_error, outlet_pressure_value
```

This is the one naming rule for every fan. It is fixed — there is nothing to configure. A predictable name is what lets a later node read `inlet_pressure_error` without guessing it.

The label is the **value** you write in the stats object, not the key:

```javascript
.sanitize('check', ['temp'], { failureReason: 'invalid' })
// the label is 'invalid' (the value), not 'failureReason' (the key)
// adds: temp_invalid
```

**Key Points:**
- Input: array of field names
- Output: built automatically as `field_label`
- Use when: processing several fields with consistent naming

## Repeating a Chain Across Fields with forEach

Array input runs **one** node once per field. To run a **chain** of several nodes once per field, use `forEach`. You write the chain once; each field gets its own copy.

```javascript
flow('strings')
    .forEach(['scb1', 'scb2', 'scb3'], (each) =>
        each
            .lag('lag', each.field, { delta: 'roc' })       // adds scb1_roc, scb2_roc, ...
            .threshold('drop', each.out('roc'),             // reads this field's own roc
                { active: 'isDropping' },
                { mode: 'below', threshold: -5 })
    );
// builds the lag → threshold pair for scb1, scb2, and scb3
```

The callback receives an `each` object:

- `each.field` — the current field (`scb1`, then `scb2`, then `scb3`).
- `each.out( label )` — the name a step produced for this field, under the same `field_label` rule (`scb1_roc`, and so on). Steps run left to right, so a step can read what the step before it added.

Everything `forEach` does happens when the flow is built. The repeated chain is identical to one written by hand. It adds nothing to the per-message path. If you ask for a label no step produced, the flow fails to build. A typo shows up immediately, not at the first message.

When a test needs a produced name, read it once into a constant after its step, then use that constant inside the test:

```javascript
.forEach(['scb1', 'scb2'], (each) => {
    const chain = each.lag('lag', each.field, { delta: 'roc' });
    const roc = each.out('roc');            // 'scb1_roc' / 'scb2_roc', fixed at build time
    return chain.persistenceCheck('fault',
        (msg) => msg[roc] < -5,
        { persistenceConfirmed: 'confirmed' },
        { outOfTotal: 3 });
});
```

### Per-Field Option Values with pickByField

Inside a `forEach`, `pickByField` gives each field its own option value, taken from a map. The choice is made when the flow is built, so it costs nothing per message:

```javascript
import { pickByField } from '@winkjs/composer';

.forEach(['scb1', 'scb2'], (each) =>
    each.threshold('drop', each.field,
        { active: 'isDropping' },
        { mode: 'below', threshold: pickByField({ scb1: -5, scb2: -8 }) })
);
// scb1 tests against -5, scb2 against -8
```

If a field is missing from the map, the flow fails to build.

## Option Value Shapes

Most node options can be written in three shapes. A node entry marks which shapes an option accepts; the rules below are the same everywhere.

**1. Direct — one value for the field this node reads.** The common case.

```javascript
.esMean('smooth', 'temperature', { mean: 'avg' }, { halfLife: 10 })
```

**2. Per-field map — a map from field name to value, one entry per field.** Useful when one shared options object configures several single-field nodes, or in a `forEach` fan where each copy reads a different field. The node picks the entry for the field it reads.

```javascript
// One node, two fields — each field gets its own halfLife.
// 'temp' smooths over a short window, 'pressure' over a long one.
.esMean('smooth', ['temp', 'pressure'], { mean: 'avg' }, {
    halfLife: { temp: 5, pressure: 20 }
})
```

So `halfLife: { temp: 5, pressure: 20 }` is a per-field map: the `temp` instance uses `5`, the `pressure` instance uses `20`. A plain `halfLife: 10` (shape 1) would apply `10` to both.

The map must include an entry for the field the node reads. If it does not, the node falls back to that option's default (and where the option is required, the build fails). A per-field map is read once, when the flow is built — it costs nothing per message.

(In option type names and validation errors this shape is called *field-keyed* — it is the same thing, named after the map's keys.)

**3. Tunable — a function evaluated fresh on every message.** For values that change with context. See [Dynamic Options](#dynamic-options).

```javascript
.threshold('check', 'temp', { active: 'hot' }, { threshold: ( msg ) => msg.baseline + 10 })
```

The three shapes combine. A per-field map can hold a function for one field and a static value for another (`{ temp: 5, pressure: ( msg ) => msg.limit }`). Inside a `forEach`, the `pickByField` helper is the per-field map written as a fan convenience — `pickByField({ scb1: -5, scb2: -8 })` resolves to the entry for each fanned field (see [Per-Field Option Values with pickByField](#per-field-option-values-with-pickbyfield)).

Each field in multi-field mode gets independent state, namespaced control signals, and isolated failure handling. A processing error on one field does not affect others.

## Node Processing Types

Beyond single/multi-field modes, nodes have different processing behaviors:

| Type | Description | Example |
|------|-------------|---------|
| **Per-field** | Each field processed independently | `.esMean()`, `.threshold()` |
| **Field-pair** | Operates between exactly two fields | `.diff()`, `.ratio()` |
| **Field-Group** | Analyzes multiple fields together | `.esPairwiseCorrelation()` |
| **Condition** | Evaluates boolean expressions | `.passIf()`, `.persistenceCheck()` |
| **Control** | Orchestrates other nodes | `.controller()` |

### Per-Field Processing

These nodes process each field independently. Supports both single and multi-field modes:

```javascript
// Single field - direct naming
.esMean('avg', 'temperature', { mean: 'avgTemp' })
// Output: avgTemp

// Multi-field - names built automatically as field_label
.esMean('avg', ['temperature', 'pressure'], { mean: 'avg' })
// adds: temperature_avg, pressure_avg
```

**Nodes supporting per-field processing:**
- Signal Conditioning: `esMean`, `median3`, `sanitize`, `butterworthFilter`, `kernel`
- Feature Extraction: `lag`, `momentsDigest`, `trend`
- Detection: `threshold`, `pageHinkley`

### Field-Pair Operations

These operate between exactly two fields. Always single mode (no arrays):

```javascript
// Calculate difference between two fields
.diff('delta', 'outlet_pressure', 'inlet_pressure', { diff: 'pressureDrop' })
// Output: pressureDrop

// Calculate ratio
.ratio('efficiency', 'output_power', 'input_power', { ratio: 'powerEfficiency' })
// Output: powerEfficiency

// Correlation between two fields
.esCorrelation('coupling', 'temp', 'pressure', { correlation: 'tempPressCorr' })
// Output: tempPressCorr
```

### Field-Group Analysis

These analyze multiple fields **as one group**:

```javascript
// Compute all pairwise correlations
.esPairwiseCorrelation('matrix',
    ['temperature', 'pressure', 'flow'],  // Analyzes as a group
    {
        correlations: 'sensorCorr',       // Vector of all correlations
        pairNames: 'corrLabels'           // "temp-pressure", "temp-flow", etc.
    }
)
// Outputs: sensorCorr (array), corrLabels (array)

// Monitor multiple states together
.stateChangeDetector('monitor',
    ['machineState', 'qualityLevel'],     // Watches as a group
    { dwellTime: 'stateTime' },
    { changeMode: 'any' }                 // Trigger on any change
)
```
> [!NOTE]
> Group analyzers emit shared outputs; naming policy does not apply.

### Condition-Based Processing

These evaluate predicates on messages and compute stats from the result:

```javascript
// Track binary conditions
.dwellTimeTracker('uptime', msg => msg.running, {
    dwellTime: 'runDuration',
    dutyCycle: 'runPercentage'
})
// Output: runDuration, runPercentage

// Confirm persistence (2-of-3 voting)
.persistenceCheck('stable',
    msg => msg.temperature > 80,
    { persistenceConfirmed: 'overheating' },
    { minVotes: 2, outOfTotal: 3 }
)
// Output: overheating
```

### Control Flow

Orchestrate other nodes without processing data:

```javascript
.controller('adaptive', [{
    when: msg => msg.vibration > 2.5,
    triggers: [
        { control: 'enable', targets: ['esStats', 'correlation'] },  // targets by node name
        { control: 'reset', targets: ['baseline'] }                  // 'baseline' is an esMean node name
    ]
}])
```

### What Happens When a Predicate Throws

Predicate functions can throw at runtime — for example, if a message lacks a field the predicate reads. Every predicate-using node catches the exception and handles it according to its role:

| Node | On exception | Effect |
|------|-------------|--------|
| **passIf** | Message dropped | Same as returning `false` — downstream nodes never see the message |
| **persistenceCheck** | Treated as non-vote | The message doesn't count toward confirmation |
| **dwellTimeTracker** | Outputs marked invalid | No state transition is recorded |
| **controller** | Condition skipped | Remaining conditions still evaluate (first-match-wins) |
| **emitIf** | Emission skipped | Emits a status signal to the target; recovers automatically |
| **persistIf** | Write skipped | First error per episode logged; subsequent suppressed until recovery |
| **sanitize** (custom predicate) | Value treated as invalid | Same as predicate returning `false` |

All predicate exceptions are logged to `console.error` — once per error episode, not once per message. On recovery (successful predicate call), the suppression resets so the next episode is logged. A controller-triggered reset also clears the suppression.

No predicate exception ever crashes the pipeline or affects other assets.

---

## Quick Decision Guide

### When to Use Single vs Multi-Field

**Use Single Field Mode when:**
- You need specific, custom output names
- Processing fields that require different configurations
- Building precise business logic
- Working with computed fields from previous nodes

**Use Multi-Field Mode when:**
- Applying the same operation to multiple raw sensors
- Want consistent naming across similar fields
- Processing sensor arrays with identical configuration
- Initial data validation and conditioning

### Which Node Type to Choose

| If you need to... | Use this node type | Example |
|-------------------|-------------------|---------|
| Process each field the same way | Per-field | `esMean`, `threshold` |
| Compare two fields | Field-pair | `diff`, `ratio` |
| Analyze relationships | Field-Group | `esPairwiseCorrelation` |
| Filter or route messages | Condition | `passIf`, `emitIf` |
| Track binary states | `dwellTimeTracker` | Running/stopped |
| Track categorical changes | `stateChangeDetector` | State machines |
| Coordinate nodes | Control | `controller` |

