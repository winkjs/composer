# Composition Patterns

## Common Recipes

Combine nodes into analytical pipelines:

| Pattern | Pipeline | Use Case |
|---------|----------|----------|
| Bearing failure | `butterworthFilter → esMean → threshold` | Vibration anomaly |
| Noise-tolerant alarm | `median3 → esMean → threshold` | Spike-resistant alerting |
| Drift detection | `esMean(fast) → esMean(slow) → diff → pageHinkley` | Gradual shift detection |
| Western Electric Rules | `esStats → persistenceCheck` | 2-of-3 beyond 2σ via zScore |
| Correlation drift | `esPairwiseCorrelation → vectorDistance → emitIf` | Multi-sensor relationship change |
| State-aware persistence | `dwellTimeTracker → invertFlag → persistIf` | Write on state exit, not entry |
| Operating-gated metric | `unbalance → threshold → emitIf` | Trust a relative metric only when running |
| Solo-channel fault | `forEach(swingWatch) → tally → emitIf` | One channel dips alone while weather moves all |

---

## Fanning a Chain Across Fields, Then Reducing

Array input fans **one** node across a field list — `['scb1', 'scb2'] → scb1_roc, scb2_roc`. When per-field detection needs **several** nodes, `forEach` fans the whole chain, one copy per field. A reduce node then folds the per-field results into a single answer.

```javascript
flow('strings')
    // Per field: rate of change, then a per-field "dropping" flag
    .forEach(['scb1', 'scb2', 'scb3'], (each) =>
        each
            .lag('lag', each.field, { delta: 'roc' })
            .threshold('drop', each.out('roc'),
                { active: 'isDropping' },
                { mode: 'below', threshold: -5 })
    )
    // Reduce: how many strings are dropping in this message?
    .tally('drops',
        ['scb1_isDropping', 'scb2_isDropping', 'scb3_isDropping'],
        { any: 'anyDropping', count: 'droppingCount' });
```

The fan and the reduce share one fixed naming rule. Each per-field flag is named `field_label` (`scb1_isDropping`), so the `tally` step can list those names exactly — no guessing, no configuration. That shared rule is what lets a fan feed a reduce. `tally` answers any / all / count over flag fields. `unbalance` is its numeric sibling — it measures spread across N numeric fields.

See [Flow Language — Repeating a Chain Across Fields](./flow-language.md#repeating-a-chain-across-fields-with-foreach) for the `forEach` construct.

---

## Solo Events Under a Shared Influence

A shared influence is a cause that moves every channel at the same time — a cloud passing over a solar field, a load change on a production line. An event detector on each channel fires for the shared cause exactly as it fires for a genuine per-channel fault. Event rate alone cannot separate the two, because the shared cause dominates the count on every channel.

Coincidence separates them. The channels of one asset ride the same message, so their events land on the same tick. A shared cause completes events on many channels together; a fault completes an event on one channel alone. Fan the detector across the channels, count the flags, and keep only the solo events:

```javascript
flow('strings')
    // Per channel: one completed dip = one event, with its depth
    .forEach(['scb1', 'scb2', 'scb3'], (each) =>
        each.swingWatch('dip', each.field,
            { dipCompleted: 'dipDone', dipSize: 'dipDepth' },
            { threshold: 4, windowSize: 120, direction: 'dips' })
    )
    // Reduce: how many channels completed a dip on this tick?
    .tally('dips',
        ['scb1_dipDone', 'scb2_dipDone', 'scb3_dipDone'],
        { count: 'dipCount' });
```

A solo event on `scb2` is a tick where `scb2_dipDone` is `true` while `dipCount` is `1`. Route it with `emitIf`, or persist it with `persistIf`. The solo count per day is the per-channel fault signal; the shared events cancel out of it by construction, with no threshold tuning against the weather.

---

## Adaptive Diagnostics (saves ~95% compute)

All nodes start active. To keep expensive nodes dormant until needed, pair them with a controller that disables them when the triggering condition is absent. On the very first message, the non-anomaly condition matches and the controller disables the expensive nodes:

```javascript
.esMean('smooth', 'vibration', { mean: 'smoothVib' }, { halfLife: 5 })
.threshold('detect', 'smoothVib', { active: 'anomaly' },
    { mode: 'above', threshold: 2.5 })
.controller('adaptive', [
    {
        when: msg => msg.anomaly === true,
        triggers: [
            { control: 'enable', targets: ['stats', 'correlation'] },
            { control: 'reset', targets: ['stats'] }
        ]
    },
    {
        when: msg => msg.anomaly === false,
        triggers: [{ control: 'disable', targets: ['stats', 'correlation'] }]
    }
])
.esStats('stats', 'vibration',
    { mean: 'vibMean', stdev: 'vibStd' }, { halfLife: 20 })
.esCorrelation('correlation', 'vibration', 'temperature',
    { correlation: 'vibTempCorr' })
```

```text
Normal:  msg→ [◆ esMean] → [◆ threshold] → [◇ controller] → [□ esStats] → [□ esCorrelation]
Anomaly: msg→ [◆ esMean] → [◆ threshold] → [◇ controller] → [◆ esStats] → [◆ esCorrelation]
```

---

## Operating-Gated Metric

A *relative* metric divides one quantity by another. `unbalance` percent divides the spread by the mean; a ratio and a coefficient of variation have the same shape. The result means something only when the divisor is well above the small readings sensors give when nothing is running — offset, leakage, standby draw. When the equipment is idle or off, both the spread and the mean are that small noise, so their ratio is large but meaningless. The metric reads highest exactly when there is nothing to measure.

The metric node is not the place to fix this. It computes faithfully; the fix belongs outside it. Decide once whether the equipment is operating, then let each consumer act on that single decision.

```javascript
// 1. Compute the metric. Its mean doubles as the "is it running" proxy.
.unbalance('phaseBalance', ['currentP1', 'currentP2', 'currentP3'], {
    mean: 'iMean',
    unbalance: 'currentUnbalance'
})

// 2. Derive a steady operating flag. Hysteresis stops the flag flipping on and
//    off when the proxy sits near the floor.
.threshold('operating', 'iMean', { active: 'isOperating' }, {
    mode: 'above',
    threshold: 5,      // amps — a deployment knob, set above the idle noise floor
    hysteresis: 1
})

// 3. Act only when operating AND unbalanced. A dropped sensor is excluded
//    automatically: currentUnbalance is NaN, and NaN > limit is false.
.emitIf('unbalAlert',
    msg => msg.isOperating === true && msg.currentUnbalance > 2,
    { target: 'mqtt', insightType: 'currentUnbalance' })
```

These advisories cover the rest:

- **Storage.** Use the same predicate on `persistIf` to store only meaningful readings. Or store `currentUnbalance` with `isOperating` next to it, so a reader can tell idle (flag false) from a sensor fault (value NaN).
- **Signed signals.** The `mean` proxy works for quantities that stay one sign — currents, flows, absolute temperatures. For a signal that crosses zero, such as active power, a small mean is normal operation, not idle. There, point `threshold` at an independent running signal: a breaker status, total power, or RPM.
- **Evidence for `appraise`.** If this metric feeds `appraise`, also pause it while `isOperating` is false, so idle noise is never learned as the baseline. That is a controller, exactly like [Adaptive Diagnostics](#adaptive-diagnostics-saves-95-compute) above.
- **Calibration trap.** Gating handles *idle* noise; it does not handle a *chronic* imbalance. `appraise` learns each source's normal range during its burn-in calibration, so a feed that is already imbalanced then — a stuck CT, a standing fault — is learned as the baseline and reads "Normal" ever after. Calibrate `appraise` on data known to be healthy.
- **Missing channels.** The three phases here are a fixed, required set, so `unbalance`'s default — blank every output when one channel is missing — is correct, and it keeps the behaviour this alert relies on (`currentUnbalance` is `NaN` when a sensor drops, and `NaN > 2` is false). For a *population of equals* (cells, pumps, redundant sensors) where one dropout should not blind the metric, set `skipOnNaN: true` so it reports over the channels present. See the [`unbalance` reference](./nodes/feature-extraction.md#unbalance).

To serve machines of different sizes from one flow, make the floor a tunable instead of the constant shown above — for example, a fraction of each machine's rated current. See [Dynamic Options](./flow-language.md#dynamic-options).

---

## Downsampling for Storage

Collect raw samples into compact digests, then persist only when a window completes:

```javascript
.momentsDigest('digest', 'temperature', { windowSize: 60 })
.digestMoments('stats', 'temperature', {
    mean: 'tempMean', stddev: 'tempStd', min: 'tempMin', max: 'tempMax'
})
.persistIf('save', msg => msg.digest === true, {
    storageName: 'questdb', insightType: 'minuteStats'
})
```

For multi-level aggregation (seconds → minutes → hours), chain with `cascade: true`:

```javascript
.momentsDigest('perSecond', 'temperature', { windowSize: 100 })
.momentsDigest('perMinute', 'temperature', { windowSize: 60, cascade: true })
```

---

## Choosing the Right Tool

These four mechanisms control what happens in your pipeline. They look similar but serve different purposes:

### passIf — Drop messages that shouldn't continue

Use when you want to **remove** messages from the pipeline entirely. Downstream nodes never see dropped messages.

**Good for:**
- Quality gates — only pass messages with valid data
- Sampling — pass every Nth message to reduce volume
- Startup warmup — skip the first N messages while sensors stabilize

```javascript
.passIf('quality', msg => msg.confidence > 0.9)
.passIf('downsample', ( msg, counter ) => counter % 100 === 0)
```

### emitIf — Broadcast without disrupting the flow

Use when you want to **send a copy** of the message to an external system (MQTT, terminal) while the original continues through the pipeline unchanged.

**Good for:**
- Alerts — broadcast when a condition is detected
- Telemetry — send periodic status updates
- Debugging — tap into the pipeline to see what's happening

```javascript
.emitIf('alert', msg => msg.faultConfirmed, {
    target: 'mqtt', insightType: 'faultAlert'
})
```

### controller — Change how the pipeline behaves

Use when you want to **turn nodes on or off**, reset their state, or flush accumulated data. The controller reads the message but doesn't change it — it sends signals to other nodes.

**Good for:**
- Adaptive computation — enable expensive analysis only during anomalies
- State machines — switch between operational modes
- Coordinated resets — clear state across multiple nodes at once

```javascript
.controller('adaptive', [{
    when: msg => msg.anomaly,
    triggers: [{ control: 'enable', targets: ['stats', 'corr'] }]
}])
```

### disable vs passIf — The key difference

| | `passIf` (filter) | `disable` (via controller) |
|-|-------------------|---------------------------|
| **Scope** | One message at a time | All messages while disabled |
| **Message fate** | Dropped — gone forever | Passes through unchanged |
| **Downstream impact** | Downstream sees nothing | Downstream sees the original message |
| **Reversible?** | No — need a new message | Yes — `enable` signal resumes processing |
| **When to use** | Bad data, sampling | Suspend expensive computation |

**Rule of thumb:** If you want to stop *messages*, use `passIf`. If you want to stop *computation*, use a controller with `disable`.

---

## Built-in Error Handling

All user-supplied functions — predicates and tunables — are guarded. A throwing function never crashes the pipeline or takes down monitoring for other assets.

| Function type | On exception | Recovery |
|---------------|-------------|----------|
| **Predicate** (passIf, emitIf, persistIf, etc.) | Treated as `false` / skipped / invalid depending on node role | Automatic on next successful call; also cleared on reset |
| **Tunable** (threshold, pageHinkley, etc.) | Last known-good value is retained | Automatic on next successful call; also cleared on reset |

Errors are logged to console once per episode — not once per message — to prevent flooding at high message rates.

See [What Happens When User Functions Throw](./understanding-composer.md#what-happens-when-user-functions-throw), [What Happens When a Predicate Throws](./flow-language.md#what-happens-when-a-predicate-throws), and [What Happens When a Tunable Throws](./flow-language.md#what-happens-when-a-tunable-throws).

---

## Pipeline Ordering Guidelines

The order you place nodes matters. Here are common patterns:

1. **Clean first** — `sanitize` at the start catches bad data before it propagates
2. **Smooth before detect** — `esMean` or `median3` before `threshold` reduces false alarms
3. **Confirm before act** — `persistenceCheck` before `emitIf` avoids alerting on transients
4. **Controller before targets** — controllers can only target nodes that appear **after** them
5. **Observe last** — `emitIf` and `persistIf` near the end see the fully enriched message
