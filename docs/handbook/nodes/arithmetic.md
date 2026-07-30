# Arithmetic

## accumulate
Accumulates numeric values into a running sum. Each valid message adds its value to the total; invalid values are skipped without affecting the sum.

Works naturally with controller disable/enable for conditional accumulation — while disabled, the sum freezes; when re-enabled, it continues from where it left off.

**Type:** Per-field processing
**Mode:** Single only
**Stats:** `sum`
**Options:** None
**Reset:** Sum returns to zero; accumulation starts fresh.

```javascript
// Running sum of energy consumption
.accumulate('total', 'energyDelta', { sum: 'totalEnergy' })
// Output: totalEnergy (running sum)

// Conditional accumulation with controller
.controller('gate', [{
    when: msg => msg.machineRunning,
    triggers: [{ control: 'enable', targets: ['counter'] }]
}, {
    when: msg => !msg.machineRunning,
    triggers: [{ control: 'disable', targets: ['counter'] }]
}])
.accumulate('counter', 'productCount', { sum: 'totalProducts' })
// Output: totalProducts (only accumulates when machine is running)
```

---

## diff
Subtracts the second field from the first. If either field is invalid, the result is marked invalid.

**Type:** Field-pair
**Mode:** Single only
**Stats:** `diff`
**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `absolute` | boolean | `false` | Always return a positive difference |

**Reset:** Not applicable — stateless.

```javascript
.diff('pressure-drop', 'outlet_pressure', 'inlet_pressure', {
    diff: 'differentialPressure'
})
// Output: differentialPressure

// Absolute difference (always positive)
.diff('gap', 'sensorA', 'sensorB', {
    diff: 'sensorGap'
}, { absolute: true })
// Output: sensorGap (always >= 0)
```

---

## invertFlag
Inverts a boolean field in the message. Also works with truthy/falsy values — `0` becomes `true`, `1` becomes `false`. If the input is missing, the result is marked invalid.

**Type:** Per-field processing
**Mode:** Single only
**Stats:** `inverted`
**Options:** None
**Reset:** Not applicable — stateless.

**Why it matters:** `dwellTimeTracker` fires at the transition edge — but the `active` flag reflects the *new* state. When a wash cycle ends, `active` becomes `false`. For storage and downstream analytics, you want the positive fact: "a wash *did* happen." `invertFlag` produces that semantic correction:

```javascript
// dwellTimeTracker fires at wash-end: isWashing=false, washDuration=42000
.dwellTimeTracker('washTimer', msg => msg.pressure > 70, {
    active: 'isWashing',
    dwellTime: 'washDuration'
})
// Invert: wasWashing=true — "yes, a wash cycle just completed"
.invertFlag('invert', 'isWashing', { inverted: 'wasWashing' })
// Persist the completed wash cycle with its duration
.persistIf('saveWash',
    msg => msg.washDuration !== null,
    { insightType: 'washCycleStats' }
)
```

---

## ratio
Divides the first field by the second. If the denominator is too close to zero (below `minY`), the result is marked invalid. If either field is invalid, the result is marked invalid.

**Type:** Field-pair
**Mode:** Single only
**Stats:** `ratio`
**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logScale` | boolean | `false` | Output in decibels: 20 × log₁₀(x/y) — both values must be positive |
| `scaleBy` | number | `1` | Linear multiplier applied to result (ignored when `logScale` is true) |
| `minY` | number | `1e-10` | Denominator below this value produces an invalid result |

**Reset:** Not applicable — stateless.

```javascript
.ratio('efficiency', 'output_power', 'input_power', {
    ratio: 'powerEfficiency'
})
// Output: powerEfficiency

// How clean is the sensor reading?
// Compares smoothed signal strength to noise level in decibels.
// 20 dB = signal is 10× stronger than noise (clean)
//  0 dB = signal equals noise (unreliable)
.ratio('quality', 'signalLevel', 'noiseLevel', {
    ratio: 'sensorSNR'
}, { logScale: true })
// Output: sensorSNR (higher dB = cleaner signal)
```

---

## transform
Applies a user-supplied pure function to each sample. The function is fixed at initialization — it runs on every valid input and the result flows downstream. If the input is invalid, the node flags and skips. If the function itself produces an invalid result (e.g., square root of a negative number), the output is marked invalid but the node stays healthy — downstream nodes handle it through normal invalid-value propagation.

Composer ships with pre-built helpers for common transformations: `square`, `abs`, `sqrt`, `log`, `log10`, `reciprocal`, `negate`. Import them alongside the flow DSL.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:** `result`
**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `using` | function | required | Pure function applied to each value: `result = using(x)` |

**Reset:** Not applicable — stateless.

```javascript
// Convert RMS acceleration to energy (square it)
.transform('energy', 'rmsAccel',
    { result: 'vibEnergy' },
    { using: ( x ) => x * x }
)
// Output: vibEnergy

// Using a built-in helper
.transform('logPressure', 'pressure',
    { result: 'logP' },
    { using: log10 }
)
// Output: logP

// Multi-field — same function applied to each
.transform('squared', ['temperature', 'pressure'],
    { result: 'sq' },
    { using: square }
)
// Outputs: temperature_sq, pressure_sq
```
