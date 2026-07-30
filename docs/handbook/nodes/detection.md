# Detection

## pageHinkley
Detects when a signal's average has shifted — a step change in the typical value. The node learns a running baseline and accumulates deviations from it. When the accumulated deviation exceeds a threshold, it reports a shift and starts watching for the next one. The baseline continues learning throughout.

By default detects upward shifts (the signal increased). Use `detectDrop` to detect downward shifts instead.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**

- `phShift` — `true` on the message where a shift is detected, `false` otherwise
- `phMean` — the current baseline value the node has learned
- `phTestStatistic` — how far the signal has drifted from the baseline (higher = closer to triggering)

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `delta` | number or function | `0.005` | Allowable drift per sample — higher values tolerate more drift before flagging |
| `lambda` | number or function | `45` | How much accumulated drift triggers detection — higher values mean fewer false alarms but slower detection |
| `halfLife` | number | — | Baseline tracking speed. Omit for a running average of all samples; set a positive half-life (in samples) to switch to exponential weighting that adapts faster to recent values |
| `detectDrop` | boolean | `false` | Detect downward shifts instead of upward |
| `minWarmUpSamples` | number | `10` | Number of samples to learn the baseline before detection begins |

**Dynamic parameters:** `delta` and `lambda` accept functions for signal-adaptive change detection. See [Dynamic Options](../flow-language.md#dynamic-options).

**Per-field values:** `delta`, `lambda`, and `halfLife` also accept a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Error handling:** If a tunable function throws, the node continues with the last successfully resolved value. The first error per episode is logged to console; subsequent errors are suppressed until the tunable recovers. See [What Happens When a Tunable Throws](../flow-language.md#what-happens-when-a-tunable-throws).

```javascript
// Detect mean shift in sensor
.pageHinkley('drift', 'sensor',
    { phShift: 'sensorDrift', phMean: 'baseline' },
    { lambda: 50, delta: 0.01 }
)

// Dynamic sensitivity based on noise level
.pageHinkley('drift', 'sensor',
    { phShift: 'sensorDrift' },
    { delta: ( msg ) => msg.noiseLevel * 0.001, lambda: 50 }
)

// Multi-field
.pageHinkley('drift', ['sensor1', 'sensor2'],
    { phShift: 'shifted' },
    { detectDrop: true }
)
// Outputs: sensor1_shifted, sensor2_shifted
```

**Reset:** Clears the baseline and all detection state; the node re-learns the signal from scratch.

---

## persistenceCheck
Confirms that a condition is genuinely persistent, not just a momentary spike. You provide a condition (as a function) and the node checks whether it holds true for at least `minVotes` times within a window of `outOfTotal` consecutive messages. Only then does it confirm.

After confirmation, the voting window resets and a new round begins. If the condition cannot possibly reach enough votes in the remaining window, the node resets early rather than waiting.

**Type:** Condition-based
**Mode:** Single only (evaluates predicate)
**Stats:**

- `persistenceConfirmed` — `true` on the message where the condition met the vote threshold, `false` otherwise

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minVotes` | number | `3` | How many messages must satisfy the condition to confirm |
| `outOfTotal` | number | `5` | Size of the voting window — must be ≥ `minVotes` |
| `triggers` | array | — | Control signals to fire when the check confirms — a list of `{ control, targets }`, the same shape a controller uses. See [controller](./orchestration.md#controller) |

```javascript
.persistenceCheck('confirm-fault',
    msg => msg.temperature > 80 || msg.pressure > 100,
    { persistenceConfirmed: 'faultConfirmed' },
    { minVotes: 2, outOfTotal: 3 }
)
// Output: faultConfirmed
```

**Error handling:** If the predicate throws an exception, the message is treated as a non-vote (condition not met). The first error per episode is logged to console; repeated errors are suppressed until the predicate recovers. See [What Happens When a Predicate Throws](../flow-language.md#what-happens-when-a-predicate-throws).

**Reset:** Clears the vote counts and starts a fresh voting window.

---

## processIndex
**`#FeatureExtraction`**

Measures how well a process stays within specification limits. Takes a mean and a standard deviation (from upstream nodes like esMean and esStats) and computes how much margin the process has from each limit. The result is a capability index — higher values mean better controlled.

Whether this represents Cpk or Ppk depends on how the upstream statistics were computed: short-term windowed statistics give Cpk, long-term statistics give Ppk.

**Type:** Field-pair
**Mode:** Single only (takes mean field and stddev field)
**Stats:**

- `index` — overall capability index (minimum of upper and lower for two-sided specs)
- `upper` — how far the mean sits below the upper limit, in units of 3 × stddev
- `lower` — how far the mean sits above the lower limit, in units of 3 × stddev
- `status` — `'capable'`, `'marginal'`, or `'incapable'` based on the index value

**Formulas:**
- upper = (upperSpecLimit − mean) / (3 × stddev)
- lower = (mean − lowerSpecLimit) / (3 × stddev)
- index = min(upper, lower) for two-sided specs

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `upperSpecLimit` | number | — | Upper specification limit (at least one limit required) |
| `lowerSpecLimit` | number | — | Lower specification limit (at least one limit required) |
| `maxIndex` | number | `12` | Cap the index value when standard deviation is near zero |
| `capableThreshold` | number | `1.33` | Index at or above this is classified as `'capable'` |
| `marginalThreshold` | number | `1.0` | Index at or above this (but below capable) is `'marginal'`; below is `'incapable'` |
| `epsilon` | number | `1e-12` | Floor on the standard deviation to avoid division by zero when the process is nearly flat |

```javascript
// Two-sided specification limits
.processIndex('tempCapability', 'tempMean', 'tempStddev', {
    index: 'tempCpk',
    upper: 'tempCpkU',
    lower: 'tempCpkL',
    status: 'tempCapStatus'
}, { upperSpecLimit: 100, lowerSpecLimit: 20 })
// Outputs: tempCpk, tempCpkU, tempCpkL, tempCapStatus ('capable'|'marginal'|'incapable')

// One-sided (upper limit only)
.processIndex('tempLimit', 'tempMean', 'tempStddev', {
    index: 'tempPpk',
    status: 'tempStatus'
}, { upperSpecLimit: 95 })
// Outputs: tempPpk, tempStatus
```

**Reset:** Not applicable — stateless.

---

## threshold
Checks whether a value is above, below, inside, or outside a boundary. Outputs `true` when the condition is met, `false` otherwise. Fires triggers only on the rising edge — the transition from inactive to active.

Invalid values are ignored; the previous active/inactive state persists until a valid value arrives.

**Modes:**

| Mode | Activates when |
|------|---------------|
| `above` | value ≥ threshold |
| `below` | value ≤ threshold |
| `inside` | min ≤ value ≤ max |
| `outside` | value < min or value > max |

**Hysteresis** prevents rapid toggling when a signal hovers near a boundary. For example, in `above` mode with threshold 85 and hysteresis 2: activates at 85, won't deactivate until the value drops below 83.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**

- `active` — `true` when the condition is currently met, `false` otherwise

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | string | required | `'above'`, `'below'`, `'inside'`, `'outside'` |
| `threshold` | number or function | — | Boundary value for above/below modes |
| `min` | number or function | — | Lower bound for inside/outside modes |
| `max` | number or function | — | Upper bound for inside/outside modes |
| `hysteresis` | number or function | `0` | Deadband width — how far the value must cross back before deactivating |
| `triggers` | array | — | Control signals to fire on the rising edge (inactive→active) — a list of `{ control, targets }`, the same shape a controller uses. See [controller](./orchestration.md#controller) |

**Dynamic parameters:** `threshold`, `min`, `max`, and `hysteresis` accept functions for adaptive behavior. See [Dynamic Options](../flow-language.md#dynamic-options).

**Per-field values:** `threshold`, `min`, `max`, and `hysteresis` also accept a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Error handling:** If a tunable function throws, the node continues with the last successfully resolved value. The first error per episode is logged to console; subsequent errors are suppressed until the tunable recovers. See [What Happens When a Tunable Throws](../flow-language.md#what-happens-when-a-tunable-throws).

```javascript
// Above mode: activates when value >= threshold
.threshold('hot', 'temperature',
    { active: 'overheating' },
    { mode: 'above', threshold: 85, hysteresis: 2 }
)

// Inside mode: activates when min <= value <= max
.threshold('normal', 'pressure',
    { active: 'inRange' },
    { mode: 'inside', min: 10, max: 50 }
)

// Dynamic threshold based on learned baseline
.threshold('adaptive', 'temperature',
    { active: 'overheating' },
    { mode: 'above', threshold: ( msg ) => msg.baseline + 10, hysteresis: 2 }
)

// Multi-field
.threshold('alerts', ['temperature', 'pressure'],
    { active: 'alarm' },
    { mode: 'above', threshold: 100 }
)
// Outputs: temperature_alarm, pressure_alarm
```

**Reset:** Clears the active state; the node starts fresh as if no value has been seen.

---

## winnow
A trajectory-aware significance detector. From the last point it kept, it projects where the signal should be heading and fires only when the signal strays beyond an adaptive, self-tightening band. The name comes from winnowing grain from chaff: it keeps the samples that carry new information and drops the redundant ones. It reads slope, noise, direction, and a step-change gate from upstream nodes by field name — it does not compute them itself, so pair it with the nodes that do (`lag` for slope, `esStats` for noise, `trend` for direction, `kalman1d` for the step gate). Missing any of those inputs is fine: without them the band reduces to a flat deadband, and the node still works with less anticipation.

Typical pairings: `passIf` on its `significant` output to compress a stream, `emitIf` to gate edge-to-cloud traffic, or `threshold` on its `deviation` output for adaptive alarming.

**Type:** Per-field processing
**Mode:** Single only
**Stats:**

- `deviation` — how far the signal sits from its projected trajectory (always published)
- `predicted` — where the trajectory says the signal should be
- `significant` — `true` when the signal strays beyond the adaptive band, `false` otherwise
- `xPrev` — the previous tick's input value; non-NaN only on a step-gate keep, and only when `bufferPrev` is `true`
- `tPrev` — the previous tick's timestamp; non-NaN only on a step-gate keep, and requires both `bufferPrev: true` and `timestampField`

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `K` | number or function | `2` | Sensitivity: the band is `K` × the upstream noise floor — higher `K` keeps fewer points |
| `tightenBase` | number | `100` | How fast the band narrows as a segment grows — larger values tighten more slowly |
| `maxGap` | number | `500` | Force a point through after this many samples, so long flat runs still emit |
| `slopeField` | string | `'roc'` | Message field holding the rate of change (from an upstream `lag` or `kernel`) |
| `noiseField` | string | `'stdev'` | Message field holding the noise floor (from an upstream `esStats` or `swStats`) |
| `dirField` | string | `'trendDir'` | Message field holding trend direction (from an upstream `trend`) |
| `gateField` | string | `'gate'` | Message field holding a step-change gate (from an upstream `kalman1d`) |
| `chi2Threshold` | number | `6.63` | Chi-squared value above which the step gate counts as a genuine step |
| `bufferPrev` | boolean | `false` | Keep a one-sample buffer so `xPrev`/`tPrev` can publish on step-gate keeps |
| `timestampField` | string | — | Field name for timestamps ([milliseconds since epoch](../understanding-composer.md#timestamps)); required for `tPrev` |

**Dynamic parameters:** `K` accepts a function, so sensitivity can track an operating mode or a live statistic. See [Dynamic Options](../flow-language.md#dynamic-options).

**Per-field values:** `K`, `tightenBase`, `maxGap`, and `chi2Threshold` also accept a per-field map (one value per field) for `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

```javascript
// Compress a noisy stream: keep only the points that carry new information.
.esStats('noise', 'pressure', { stdev: 'pStdev' })
.lag('rate', 'pressure', { roc: 'pRoc' })
.winnow('sig', 'pressure',
    { significant: 'keep', deviation: 'dev' },
    { K: 2.5, noiseField: 'pStdev', slopeField: 'pRoc' }
)
.passIf('compress', ( msg ) => msg.keep === true)
// Only significant samples continue downstream
```

**Reset:** Clears the anchor and accumulated state; the next point becomes the new anchor.
