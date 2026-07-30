# Feature Extraction

## digestMoments
Converts a compact moments digest (from an upstream `momentsDigest` node) into familiar statistics you can display, store, or feed to downstream nodes. Variance uses Bessel's correction by default (sample variance); skewness and kurtosis are computed from population moments. You only pay for the statistics you request.

**Type:** Per-field processing
**Mode:** Single only
**Stats:**

- `n` — sample count
- `mean` — arithmetic mean
- `variance` — sample variance (or population variance when `biased` is true)
- `stddev` — standard deviation
- `skew` — skewness (Fisher-Pearson corrected, needs ≥ 3 samples)
- `kurtosis` — excess kurtosis (bias corrected, needs ≥ 4 samples)
- `cv` — coefficient of variation (stddev ÷ |mean|)
- `min` — minimum value in the window
- `max` — maximum value in the window

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `biased` | boolean | `false` | Use population (biased) variance instead of sample |
| `epsilon` | number | `1e-12` | Numerical stability threshold for division |

**Note:** The input field name must match the prefix used by the upstream `momentsDigest` node — both nodes reference the same field name so the digest fields are found automatically.

```javascript
// Convert moments to statistics
.momentsDigest('tempDigest', 'temperature', { windowSize: 100 })
.digestMoments('tempStats', 'temperature', {
    mean: 'tempMean',
    variance: 'tempVar',
    stddev: 'tempStd',
    skew: 'tempSkew',
    kurtosis: 'tempKurt',
    cv: 'tempCV',
    min: 'tempMin',
    max: 'tempMax'
})
// Outputs: tempMean, tempVar, tempStd, tempSkew, tempKurt, tempCV, tempMin, tempMax

// Using biased (population) statistics
.digestMoments('popStats', 'pressure', {
    mean: 'pressureMean',
    variance: 'pressureVar'
}, { biased: true })
```

**Reset:** Not applicable — stateless.

---

## dwellTimeTracker
Evaluates a boolean condition on each message and tracks how long each state lasts. At the exact moment the state flips (true→false or false→true), the node reports how long the previous state persisted — in both time and sample count. Between transitions, these edge outputs are null. A non-null `dwellTime` means a transition just happened; combine with `active` to distinguish direction — `active` is `true` on a rising edge (just turned on) and `false` on a falling edge (just turned off).
**`#Detection`**

**Type:** Condition-based
**Mode:** Single only (evaluates predicate)
**Stats:**

- `active` — current state of the condition (`true` or `false`)
- `dwellTime` — milliseconds the *previous* state lasted (null except at transitions)
- `dwellSamples` — number of samples in the *previous* state (null except at transitions)
- `dutyCycle` — fraction of time in the active state over one complete on/off cycle (null until both halves are seen)

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timestampField` | string | — | Field name for timestamp ([milliseconds since epoch](../understanding-composer.md#timestamps)); uses system time if omitted. Set this whenever you measure durations — see **Which clock?** below |
| `triggers` | array | — | Control signals to fire at a state transition — a list of `{ control, targets }`, the same shape a controller uses. See [controller](./orchestration.md#controller) |

**Which clock?** Without `timestampField`, the node measures time on the device's own clock. That clock can be corrected while a measurement is running — a device that reconnects after being offline gets snapped to true time by NTP, forwards or backwards. And replayed backlog (see [Resilience](../resilience.md)) arrives much faster than real time, so device-clock durations computed during a replay are wrong. Set `timestampField` whenever durations matter: each reading then carries its own time, so the measurement is exact during replay and immune to clock corrections. Two guards hold in either mode: a dwell is never negative — a backward clock step reports 0 — and a message whose timestamp field is missing or not a number is faulted for that one message while the measurement in progress continues.

**Edge detection:** Because `dwellTime` and `dwellSamples` are only populated at transitions, they naturally serve as edge detectors:

- **Persistent event**: Machine ran for 4.2 hours, then stopped → `dwellTime: 15120000`, `active: false`
- **Edge detection**: Pair with `emitIf` to broadcast only at transitions, not on every message
- **Semantic inversion**: At a falling edge, `active` is `false` — but for storage you often want the positive fact ("machine *was* running"). Chain with [`invertFlag`](./arithmetic.md#invertflag) to get `wasRunning: true`
- **Duty cycle**: After a complete on/off cycle, `dutyCycle` reports the percentage of time in the active state

```javascript
// Track machine running time — only fires dwellTime at transitions
.dwellTimeTracker('runtime',
    msg => msg.running,
    {
        active: 'isRunning',
        dwellTime: 'runDuration',
        dwellSamples: 'runSamples',
        dutyCycle: 'runPercentage'
    }
)
// Broadcast only when state changes (runDuration is non-null)
.emitIf('stateChange',
    msg => msg.runDuration !== null,
    { target: 'mqtt', insightType: 'machineState' }
)
```

**Error handling:** If the predicate throws an exception, the message is skipped (outputs marked invalid). The first error per episode is logged to console; repeated errors are suppressed until the predicate recovers. See [What Happens When a Predicate Throws](../flow-language.md#what-happens-when-a-predicate-throws).

**Reset:** Clears all tracking state — the node starts fresh as if no messages have been seen.

---

## esCorrelation
Measures how strongly two fields move together, using exponential weighting so recent samples matter more. Outputs a Pearson correlation between −1 (perfectly opposite) and +1 (perfectly aligned), plus optional r² and Fisher Z transform. If either field is invalid, the output is marked invalid.

**Type:** Field-pair
**Mode:** Single only (two fields)
**Stats:**

- `correlation` — Pearson correlation coefficient (−1 to +1)
- `covariance` — exponentially weighted covariance between the two fields
- `r2` — coefficient of determination (correlation²) — proportion of shared variance (0 to 1)
- `fisherZT` — Fisher Z transform of the correlation (requires `fisherZT: true` in options). Raw correlation compresses near ±1, making small changes hard to detect at extremes; Fisher Z spreads the scale for more uniform sensitivity — useful when feeding correlation into a downstream threshold node

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `halfLife` | number | `13.5` | Decay half-life in samples — after this many samples, older data carries half the weight |
| `minVariance` | number | `1e-12` | Floor for variance to avoid division by zero |
| `minSamples` | number | `10` | Samples needed before correlation is computed |
| `fisherZT` | boolean | `false` | Enable Fisher Z transformation (must be `true` to request `fisherZT` stat) |

```javascript
// Correlation between temperature and pressure
.esCorrelation('coupling', 'temperature', 'pressure', {
    correlation: 'tempPressCorr',
    r2: 'tempPressR2'
})
// Outputs: tempPressCorr, tempPressR2

// With Fisher Z transform
.esCorrelation('coupling', 'temperature', 'pressure', {
    correlation: 'tempPressCorr',
    fisherZT: 'tempPressFisher'
}, { fisherZT: true })
```

**Reset:** Clears all learned statistics; the node needs `minSamples` messages before producing correlations again.

---

## esPairwiseCorrelation
Computes all pairwise correlations across a group of fields in a single pass. For N fields this produces N×(N−1)/2 pairs — for example, 4 fields [A, B, C, D] produce 6 pairs. Each output is a flat vector ordered by pairing the first field with every subsequent field, then the second with every subsequent, and so on: A-B, A-C, A-D, B-C, B-D, C-D. Accepts 2 to 12 fields. If any field in the group is invalid, all outputs are marked invalid.

**Type:** Field-Group
**Mode:** Multi only (field array)
**Stats:**

- `correlations` — array of Pearson correlation coefficients (−1 to +1), one per pair
- `covariances` — array of exponentially weighted covariances, one per pair
- `fisherZT` — array of Fisher Z transforms (requires `fisherZT: true` in options)
- `pairNames` — array of pair labels (e.g., `"temperature-pressure"`) for identification
- `varNames` — the original input field names in order

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `halfLife` | number | `13.5` | Decay half-life in samples — after this many samples, older data carries half the weight |
| `minVariance` | number | `1e-12` | Floor for variance to avoid division by zero |
| `minSamples` | number | `10` | Samples needed before correlations are computed |
| `fisherZT` | boolean | `false` | Enable Fisher Z transformation (must be `true` to request `fisherZT` stat) |

```javascript
// Analyze correlations between all sensor pairs
.esPairwiseCorrelation('matrix',
    ['temperature', 'pressure', 'flow', 'vibration'],
    {
        correlations: 'corrVector',    // Array of 6 correlation values
        covariances: 'covVector',      // Array of 6 covariance values
        pairNames: 'corrLabels',       // Array of 6 pair names
        varNames: 'inputVars'          // ['temperature', 'pressure', 'flow', 'vibration']
    }
)
```

**Reset:** Clears all learned statistics; the node needs `minSamples` messages before producing correlations again.

---

## swingWatch
Answers questions like: is this control loop swinging when it should hold steady? How many times did this signal dip today, and how deep? It watches one signal and reports each completed swing — a fall-and-recovery (a dip) or a rise-and-fall-back (a peak) — exactly once, after the signal turns back. The earliest possible report is one sample after the turning point, because the node waits for the next sample to prove the turning point was real. Each event carries the swing's size in the signal's own units, the value at the turning point, and how many samples back the turning point sits.

**Swing size:** the round trip the signal actually completed, measured from a turning point to the lower of the two rises that bound it. For a clean dip — 60 → 45 → 60 — both sides rise back to 60, and the size is the full depth: 60 − 45 = 15. For a steady oscillation this equals the peak-to-peak amplitude of each cycle: a control loop that oscillates over a 3-unit band produces swings of size 3. The rule matters when the sides are unequal. In 60 → 50 → 52 → 45 → 60, the small bounce at 50 is bounded by a rise to 60 on one side but only 52 on the other: its size is 52 − 50 = 2, not 10, because the signal came back only 2 before falling again — only the confirmed comeback counts. The full dip keeps its own size, 60 − 45 = 15. Every swing measured at its own scale is what lets one `threshold`, set in signal units, drop the bounces while keeping the dips — no smoothing needed. Peaks mirror all of this upside down. (The algorithm's literature calls this measure *topological persistence* — a height, not a duration.)

**Among the nodes you already know:** `threshold` fires on a *level* — the value is out of bounds right now. `persistenceCheck` confirms a *duration* — a condition has held often enough, long enough. swingWatch measures a *swing* — the signal went somewhere and came back, and this is how big the round trip was — at any operating level, fast or slow, as long as the whole swing fits inside the window. And where `driftWatch` catches slow one-way movement, swingWatch catches round trips: the two watch different failures in the same signal.
**`#Detection`**

**Type:** Per-field processing
**Mode:** Single only
**Stats:**

- `dipCompleted` — `true` on the tick a significant dip completes, `false` otherwise
- `dipValue` — value at the bottom of the completed dip (undefined when none completes this tick)
- `dipLag` — how many samples back the dip's bottom sits in the window
- `dipSize` — size of the completed dip: the depth of the round trip
- `peakCompleted` — `true` on the tick a significant peak completes
- `peakValue` — value at the top of the completed peak (undefined when none completes this tick)
- `peakLag` — how many samples back the peak's top sits in the window
- `peakSize` — size of the completed peak: the height of the round trip
- `swingsThisTick` — how many swings completed this tick (the detail fields above carry only the biggest)
- `swingRate` — cumulative swings per received sample; can exceed 1.0 in `direction: 'both'` when a tick completes both a dip and a peak

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `threshold` | number or function | required | Smallest swing size that counts, in signal units — smaller swings are ignored |
| `windowSize` | number | `100` | Samples in the sliding window (4–256) |
| `direction` | string | `'both'` | Which swings to detect: `'both'`, `'dips'`, or `'peaks'` |
| `minAbsoluteThreshold` | number | `0` | Floor on the raw value swing, so a quiet or flat signal produces no events |

**Dynamic parameters:** `threshold` accepts a function, so you can set the swing-size bar from a live statistic — a common pattern is `k × σ` from an upstream `esStats`. See [Dynamic Options](../flow-language.md#dynamic-options).

**Per-field values:** `threshold` and `windowSize` also accept a per-field map (one value per field) for `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

```javascript
// Report significant peaks in vibration, ignoring small ripples
.swingWatch('vibPeaks', 'vibration',
    {
        peakCompleted: 'peakDone',
        peakSize: 'peakProminence',
        peakLag: 'peakSamplesAgo'
    },
    { threshold: 3.0, windowSize: 128, direction: 'peaks' }
)
// Outputs: peakDone (true when a peak completes), peakProminence, peakSamplesAgo

// Adaptive bar: only peaks that stand out by 3 standard deviations
.esStats('stats', 'vibration', { stdev: 'vibStd' })
.swingWatch('vibPeaks', 'vibration',
    { peakCompleted: 'peakDone', peakSize: 'peakProminence' },
    { threshold: ( msg ) => 3 * msg.vibStd }
)
```

**Reset:** Clears the window and all completion history; detection restarts once the window refills.

**Where it earns its keep:**

- Counting oscillations. A badly tuned control loop *hunts*: it overshoots its target, corrects too far, and repeats. Each hunting cycle is one completed swing. The daily event count is a direct health measure for the loop, and the swing sizes are the cycle amplitudes.
- Turning a dense signal into sparse events. Each significant swing becomes one event carrying its size and timing. Events are cheap to persist and easy to combine downstream.
- Recording transients. A dip or peak is reported once, with its depth, after the signal recovers.

**Boundaries — each follows from how the node works:**

- Drift is invisible to it. A slow move in one direction never turns, so it never completes a swing. Use `driftWatch` or `trend` for the level axis; the two views cover different failures in the same signal.
- The window bounds the slowest countable swing. A swing wider than the window never completes — it does not arrive late; it never arrives. At a 5-second cadence a 256-sample window spans 21 minutes, so a 30-minute hunting cycle is invisible. Averaged to 1-minute samples, a 240-sample window spans four hours, and the same cycle is counted. See the subsampling recipe below.
- The biggest swing in view is reported from its far side. A swing completes by pairing its turning point against a bigger neighbour, so the single deepest dip (and highest peak) in the window stays silent until something bigger bounds it. Signals with many swings in view pair everything and never notice. An isolated dip on a clean baseline is where it shows: with `direction: 'dips'` alone the dip can pass unreported. Run `direction: 'both'` — the interrupted baseline then reports it as a completed peak whose size is the dip's depth, provided the baseline's own high point sits inside the window.
- It confirms; it does not warn. A completion arrives after the signal has turned back, which is too late to act during the excursion. Use `threshold` for alarms that must fire while the value is out of bounds.
- A fixed `threshold` transfers only between channels of similar size. The same fractional disturbance makes a bigger swing on a bigger signal, so one absolute bar over-counts large channels and under-counts small ones. Across unequal channels, set `threshold` per field (a map or a function), or normalize the signal upstream.
- One shared influence fires every channel at once. Weather over a solar field, or a load change on a production line, moves all channels together, and each channel then completes its own event. To isolate the one channel that misbehaves alone, use the coincidence pattern: [Solo Events Under a Shared Influence](../composition-patterns.md#solo-events-under-a-shared-influence).

**Counting slow swings — subsample first:**

```javascript
// 5 s samples in; one mean per minute out; swings counted over a 4 h band
.twStats('minute', 'tempC', { mean: 'tempMean1m' }, { windowSize: 12 })
.swingWatch('swings', 'tempMean1m',
    { dipCompleted: 'swingDone', dipSize: 'swingSize' },
    { threshold: 2, windowSize: 240, direction: 'both' })
```

No gate is needed between the two nodes: `twStats` clears its outputs between window completions, and swingWatch skips non-numeric input, so it consumes exactly one mean per completed window. Averaging shaves sharp turning points slightly and hides swings faster than one coarse sample. To watch two timescales, run two swingWatch instances at two cadences.

---

## lag
Compares the current value with a historical value from a configurable number of samples ago. You can request any combination of the seven statistics below from a single node — they share one ring buffer.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**

- `delta` — difference: current − lagged
- `ratio` — current ÷ lagged (invalid if lagged is zero)
- `roc` — rate of change as a fraction: (current − lagged) ÷ lagged (invalid if lagged is zero)
- `slope` — time-normalized change: (current − lagged) ÷ (t − t_lag) — requires `timestamp` option (invalid if timestamps are equal)
- `logReturn` — continuously compounded return: ln(current ÷ lagged) — both values must be positive
- `cumDelta` — running sum of deltas, useful for integration-style accumulation
- `xLag` — the value from `lag` samples ago (the historical value itself); invalid during the first `lag` samples while the buffer fills

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `lag` | number | `1` | Samples to look back (integer ≥ 1) |
| `absolute` | boolean | `false` | Always return positive values for delta and slope |
| `timestamp` | string | — | Field name for timestamps ([milliseconds since epoch](../understanding-composer.md#timestamps); required when requesting slope) |

```javascript
// Simple delta (backwards compatible)
.lag('change', 'temperature',
    { delta: 'tempChange' },
    { lag: 5 }
)
// Output: tempChange (current - 5 samples ago)

// Multiple statistics from single buffer
.lag('analysis', 'price',
    { delta: 'change', roc: 'pctChange', logReturn: 'lr' },
    { lag: 1 }
)
// Outputs: change, pctChange, lr

// With slope (requires timestamp)
.lag('velocity', 'position',
    { slope: 'speed', delta: 'displacement' },
    { timestamp: 'ts' }
)
// Outputs: speed, displacement

// Multi-field
.lag('changes', ['temperature', 'pressure'],
    { delta: 'change' },
    { lag: 10 }
)
// Outputs: temperature_change, pressure_change
```

**Per-field values:** `lag` also accepts a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Reset behavior:** When `cumDelta` is requested, a reset preserves the ring buffer so the first post-reset delta bridges the boundary without a gap — only `cumDelta` resets to 0 (new integration baseline). Without `cumDelta`, a reset clears the ring buffer entirely and all stats restart as invalid.

---

## momentsDigest
Collects values one at a time and summarizes each window of `windowSize` samples into a compact digest — seven numbers that capture the sample count, central moments (M1–M4), min, and max. When the window fills, the digest is output and a new window begins. Between windows the output fields are cleared, so downstream nodes only see fresh data on window completion.

The digest is compact but lossless: a downstream `digestMoments` node can reconstruct mean, variance, stddev, skewness, kurtosis, and CV from these seven numbers. This means you can summarize thousands of samples, transfer a tiny digest across the network, and still recover the full statistical picture at the destination.

**Cascade mode** lets you see both the forest and the trees from a single data stream. Instead of consuming raw samples, a cascade node merges digest summaries from an upstream `momentsDigest` — building coarser summaries from finer ones.

Consider monitoring a CNC spindle vibration sampled at 100 Hz. You need second-level summaries for real-time anomaly alerts, minute-level for an operator dashboard, and hour-level for shift reports:

```text
100 Hz stream
  → [momentsDigest: 100 samples]  → per-second stats  → anomaly alerts
        ↓ digest
  → [momentsDigest: 60, cascade]  → per-minute stats  → dashboard
        ↓ digest
  → [momentsDigest: 60, cascade]  → per-hour stats    → shift reports
```

Each level builds on the previous level's 7-number digest. Different consumers get different time resolutions from the same raw stream — and in layered flows, only the compact digests travel over the network, not the raw samples.

**Practical limit:** The combination formula is algebraically exact, but floating-point rounding accumulates at each cascade level — particularly for higher-order moments used in skewness and kurtosis. Keep the cascade chain to three levels (one root + two cascades) for reliable results.

**Flush:** A controller can trigger `flush` to force immediate output of whatever has accumulated, even if the window isn't full — useful for time-bounded reporting or graceful shutdown.

**Type:** Per-field processing
**Mode:** Single only
**Stats:** Auto-generated from the input field name: `{field}_n`, `{field}_M1`, `{field}_M2`, `{field}_M3`, `{field}_M4`, `{field}_min`, `{field}_max`

- `n` — sample count in the window
- `M1` — mean (first moment)
- `M2` — second central moment (used to derive variance)
- `M3` — third central moment (used to derive skewness)
- `M4` — fourth central moment (used to derive kurtosis)
- `min`, `max` — minimum and maximum values in the window

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `windowSize` | number | `100` | Samples per window (4–1024) |
| `cascade` | boolean | `false` | Merge digests from an upstream momentsDigest instead of raw samples |

**Note:** No stats parameter needed — outputs are auto-generated from the input field name.

```javascript
// Aggregate temperature over 60 samples
.momentsDigest('tempDigest', 'temperature', { windowSize: 60 })
// Outputs: temperature_n, temperature_M1 (mean), temperature_M2, temperature_M3,
//          temperature_M4, temperature_min, temperature_max
// Plus: msg.tempDigest = true on window completion

// Cascaded aggregation (e.g., minute-level from second-level)
.momentsDigest('minuteStats', 'temperature', { windowSize: 60, cascade: true })
```

**Per-field values:** `windowSize` also accepts a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Reset:** Clears all accumulated moments and restarts the window from zero.

---

## stateChangeDetector
Similar to `dwellTimeTracker` but for categorical fields rather than a boolean predicate. Monitors one or more field values (string, number, or boolean) directly, with built-in debounce — the new value must persist for `debounce` consecutive samples before the transition is confirmed. This filters out brief spikes and noise. At each confirmed transition, the node reports how long the previous state lasted, using the same non-null edge detection pattern: a non-null `dwellTime` means a transition just happened.
**`#Detection`**

**Type:** Field-Group
**Mode:** Multi only (monitors field group)
**Stats:**

- `dwellTime` — milliseconds the *previous* state lasted (null except at confirmed transitions)
- `dwellSamples` — number of samples in the *previous* state (null except at confirmed transitions)

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debounce` | number | `3` | Consecutive samples in the new state required before confirming a change |
| `changeMode` | string | `'any'` | `'any'` triggers when any field changes; `'all'` requires all fields to change together |
| `timestampField` | string | — | Field name for timestamp ([milliseconds since epoch](../understanding-composer.md#timestamps)); uses system time if omitted. Set this whenever you measure durations — see **Which clock?** below |

**Which clock?** The same rule as `dwellTimeTracker`: without `timestampField`, dwell is measured on the device's own clock, which NTP can correct mid-measurement and which reads replayed backlog at replay speed rather than real time. Set `timestampField` whenever the dwell values matter. Two guards hold in either mode: a dwell is never negative — a backward clock step reports 0 — and a message whose timestamp field is missing or not a number is faulted for that one message while the measurement in progress continues.

**Debounced edge detection:** Like `dwellTimeTracker`, `dwellTime` and `dwellSamples` are null between transitions and only report values at a confirmed state change. The difference: `stateChangeDetector` waits for `debounce` consecutive samples in the new state before confirming — rejecting brief spikes and noise:

```text
Samples:  A  A  A  B  A  A  B  B  B  B  B  ...
                   ↑        ↑        ↑
                  spike     start    confirmed (debounce=3)
                 (rejected)          dwellTime = time in state A
```

```javascript
// Detect operating mode changes — ignore brief spikes
.stateChangeDetector('modeChange',
    ['machineState', 'qualityLevel'],
    {
        dwellTime: 'previousModeDuration',
        dwellSamples: 'previousModeSamples'
    },
    { changeMode: 'any', debounce: 3 }
)
// previousModeDuration is non-null only at confirmed transitions
```

**Reset:** Clears the remembered state and all counters; the next message is treated as the first.

---

## tally
Reduces several flag fields of one message to a single logical answer at each tick — is any flag true, are all of them true, and how many are true. It is the logical sibling of `unbalance`: where `unbalance` measures the spread across N numeric fields, `tally` reduces N boolean fields. Flags are read by truthiness, so `null`, `undefined`, `false`, and `0` all count as not-true. A `NaN` flag is the one fault it recognises, and it propagates as `NaN` to every output, so a broken input never reads as a clean `false`.

**Type:** Field-Group
**Mode:** Multi only (field array)
**Stats:**

- `any` — `true` if at least one input flag is truthy
- `all` — `true` only if every input flag is truthy
- `count` — how many input flags are truthy

**Options:** None

```javascript
// Fan a per-channel check across sensors, then reduce the flags.
// The fan names each flag field_label (e.g. scb1_isLow), so tally can list them exactly.
.threshold('low', ['scb1', 'scb2', 'scb3'],
    { active: 'isLow' },
    { mode: 'below', threshold: 5 }
)
.tally('lowFlags', ['scb1_isLow', 'scb2_isLow', 'scb3_isLow'], {
    any: 'anyLow',
    count: 'lowCount'
})
// Outputs: anyLow (true if any channel is low), lowCount
```

**See also:** `unbalance` — the numeric sibling, for spread across N number fields at a tick. `ratio` — the two-field numeric member of the same family.

**Reset:** Not applicable — each message is computed fresh.

---

## trend
Detects whether a signal is rising, falling, or holding steady. Tracks the smoothed rate of change and classifies it against a threshold — rates below the threshold are `'stable'`, rates above are `'rising'` or `'falling'` depending on direction. Each classification comes with a confidence score (0–1) that reflects signal clarity, persistence, and distance from the decision boundary.
**`#Detection`**

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**

- `trend` — current classification: `'learning'`, `'stable'`, `'rising'`, or `'falling'`
- `confidence` — how certain the classification is (0–1); grows with signal-to-noise ratio, how long the trend has held, and how far the rate sits from the threshold
- `rocMean` — the smoothed rate of change (mean of sample-to-sample differences)
- `accelerationHint` — optional: `'likely_accelerating'`, `'likely_decelerating'`, or null — only fires when the signal is clearly speeding up or slowing down

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rocStatsHalfLife` | number | `9` | Half-life (in samples) for smoothing the rate — controls how quickly the trend responds to changes |
| `rocThreshold` | number or function | `0.1` | Smoothed rate below this is classified as stable; set slightly above the noise level of the rate signal |
| `warmupSamples` | number | derived | Samples before classification begins — defaults to a value derived from `rocStatsHalfLife` (minimum 3) |
| `speedUp` | number | `2` | Fast-to-slow smoothing ratio for acceleration detection (1.5–3) |

**Dynamic parameters:** `rocThreshold` accepts a function for phase-dependent sensitivity. See [Dynamic Options](../flow-language.md#dynamic-options).

**Per-field values:** `rocStatsHalfLife`, `rocThreshold`, `warmupSamples`, and `speedUp` also accept a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Error handling:** If a tunable function throws, the node continues with the last successfully resolved value. The first error per episode is logged to console; subsequent errors are suppressed until the tunable recovers. See [What Happens When a Tunable Throws](../flow-language.md#what-happens-when-a-tunable-throws).

```javascript
// Single field
.trend('direction', 'temperature',
    { trend: 'tempTrend', confidence: 'trendConf', rocMean: 'tempRate' },
    { rocThreshold: 0.5 }
)
// Outputs: tempTrend ('learning'|'stable'|'rising'|'falling'), trendConf (0-1), tempRate

// Dynamic threshold based on operating phase
.trend('direction', 'temperature',
    { trend: 'tempTrend' },
    { rocThreshold: ( msg ) => msg.phase === 'warmup' ? 0.5 : 0.1 }
)

// Multi-field
.trend('trends', ['temperature', 'pressure'],
    { trend: 'trend', rocMean: 'roc' },
    { rocStatsHalfLife: 15 }
)
// Outputs: temperature_trend, temperature_roc, pressure_trend, pressure_roc
```

**Reset:** Returns to `'learning'` state; the node re-learns the rate statistics from scratch.

---

## unbalance
Measures how far apart several channels are when they should read the same — three phase currents, redundant sensors, battery-pack cells, parallel pumps sharing a load — at a single tick, with no memory of the past. A fan-in reduce: many magnitude fields in (two or more, unique), a few summary numbers out. The arithmetic is domain-agnostic: it does not know whether it is reading volts, degrees, or litres per second. By default, if any input is invalid (NaN or ±Infinity), every output is marked invalid — an incomplete set is an undefined cross-field metric, not a partial one. The opt-in `skipOnNaN` mode instead reports over the channels that are present (see **Options**).

**Type:** Field-Group
**Mode:** Multi only (field array)
**Stats:**

- `mean` — arithmetic mean of the N inputs
- `min` — smallest input
- `max` — largest input
- `range` — `max − min` (peak-to-peak spread)
- `maxDev` — largest absolute distance of any input from the mean
- `unbalance` — `( maxDev / |mean| ) × 100`: the spread as a percent of the mean. With three-phase quantities this is NEMA percent unbalance (and IEEE PVUR). NaN when `|mean|` is below `1e-12`, while the spread stats stay valid — which lets the node serve signed, centered-at-zero signals
- `worstIndex` — zero-based index of the most-deviating input (**which** channel)
- `worstDev` — signed distance of that worst input from the mean (**which** direction)
- `presentCount` — how many channels reported (were finite) this tick. Always the real count, even on a blanked tick, because it describes the input, not the result. Use it with `skipOnNaN` to gate on coverage

**Options:**

- `skipOnNaN` (boolean, default `false`) — by default any missing channel blanks every metric, which is the safe choice for a fixed, required set like three-phase A/B/C. Set `true` for a *population of equals* (battery cells, parallel pumps, redundant sensors), where one channel dropping out should not blind the metric: it then computes over the channels present.
- `minPresent` (integer ≥ 2, default 2) — in skip mode, the fewest channels that must be present to compute; below it the tick blanks. It is an absolute count, not a percentage. At large widths, raise it to a count that is meaningful for the array — the default of 2 is permissive, because a spread over two survivors of ninety reads as "balanced".

```javascript
// Electrical — NEMA current unbalance, end to end
.unbalance('phaseBalance', ['currentP1', 'currentP2', 'currentP3'], {
    mean: 'iMean',
    unbalance: 'currentUnbalance',
    worstIndex: 'worstPhaseIdx',
    worstDev: 'worstPhaseDev'
})
// Outputs: iMean, currentUnbalance (percent), worstPhaseIdx, worstPhaseDev
```

**Operating precondition:** `unbalance` is a *relative* metric: it divides the spread by the mean. It means something only when the channels are energized and loaded. An idle or off machine reads small sensor noise, which inflates the percentage into a large, meaningless value. Gate it on an operating signal rather than reading it blindly, and store the operating flag beside the value so idle stays distinct from a sensor fault. See the [operating-gated metric recipe](../composition-patterns.md#operating-gated-metric).

**Skip mode catches nothing on its own:** `skipOnNaN` makes `unbalance` *ignore* a missing channel — it does not report that the channel went missing. Pair it with a per-channel check elsewhere: `sanitize` for an out-of-range value, a freeze guard for a stuck one, a presence or dropout check for a channel that stops reporting. `presentCount` then tells a downstream node how many reported, so it can gate on coverage.

**As `appraise` evidence:** `appraise` learns each source's normal range during its burn-in calibration. A feed that is *already* imbalanced then — a stuck CT, a standing fault — is learned as the baseline and reads "Normal", so the chronic fault stays hidden. The operating gate does not catch this (the feed is running, just permanently skewed); calibrate on data known to be healthy.

**See also:** `vectorDistance` — use `unbalance` for one field-group at a tick (it computes the mean internally); use `vectorDistance` for the distance between two independent, pre-assembled vectors.

**Reset:** Not applicable — each message is computed fresh.

---

## vectorDistance
Measures how different two vectors are, computing up to five distance metrics in a single pass. The two input fields must contain arrays of the same length with all finite values; if either is missing or malformed, the output is marked invalid. Works with any numeric vectors — correlation snapshots, feature vectors, histograms, embeddings.

**Type:** Field-pair
**Mode:** Single only (operates on two vector fields)
**Stats:**

- `mad` — mean absolute distance: average element-wise difference (0 = identical)
- `rms` — root mean square distance: like MAD but emphasizes larger differences (0 = identical)
- `maximum` — largest single element difference (L∞ norm)
- `cosine` — cosine distance (0 = same direction, 2 = opposite direction)
- `angular` — angle between the two vectors in radians (0 = same direction, π = opposite)

**Options:** None

```javascript
// Detect when sensor relationships shift:
// A fast-tracking correlation vector vs a slow-moving baseline.
// When they diverge, something has changed in the process.
.esPairwiseCorrelation('current',
    ['temperature', 'pressure', 'flow'],
    { correlations: 'fastCorr' },
    { halfLife: 10 }
)
.esPairwiseCorrelation('baseline',
    ['temperature', 'pressure', 'flow'],
    { correlations: 'slowCorr' },
    { halfLife: 100 }
)
.vectorDistance('drift', 'fastCorr', 'slowCorr', {
    rms: 'correlationDrift',
    cosine: 'patternShift'
})
// correlationDrift rising = relationships are changing
// patternShift near 0 = normal, approaching 2 = relationships have reversed

// Compare feature vectors
.vectorDistance('change', 'currentFeatures', 'referenceFeatures', {
    mad: 'meanChange',
    angular: 'angleChange'
})
```

**See also:** `unbalance` — for disparity within a single field-group at a tick (it computes the mean internally), rather than the distance between two pre-assembled vectors.

**Reset:** Not applicable — each message is computed fresh.
