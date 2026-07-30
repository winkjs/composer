# Intelligence

Nodes that build internal models and reason from data — evidence fusion, state estimation, and anomaly detection that simpler threshold-based nodes cannot achieve. Where Detection nodes check conditions against fixed or adaptive boundaries, Intelligence nodes learn structure from the data and quantify surprise against that learned model.

## appraise
**`#Detection`**

Fuses evidence from multiple detection signals into a single conviction score. Each signal feeds an L1 receptor neuron that processes deviations from expected behavior; the L2 decision neuron accumulates weighted synaptic current and converts it to a conviction via Michaelis-Menten readout. Conviction is classified against configurable thresholds into states: Normal, Monitor, Degraded, or Critical.

During burn-in, each source learns its own normalization threshold (Theta) from the baseline distribution. After calibration completes, thresholds are frozen and the node begins classifying.

Signed weights allow excitatory (positive) and inhibitory (negative) synapses — at least one source must have a positive weight.

**Type:** Multi-source (`from.x` string array)
**Mode:** Single only
**Stats:**

- `combined` — conviction score [0, 1) via Michaelis-Menten readout
- `state` — threshold classification label: `'Normal'`, `'Monitor'`, `'Degraded'`, or `'Critical'`
- `charge` — per-source accumulated intensity (published as `{storeAs}_{sourceField}` scalars)
- `rate` — per-source firing rate (published as `{storeAs}_{sourceField}` scalars)
- `membrane` — L2 decision neuron raw membrane potential
- `calibrating` — burn-in calibration active flag (boolean)

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sources` | object | required | Per-source config keyed by field name from `from.x` — each with `deviation`, `theta`, `weight`, and optional per-source `halfLife` (see below) |
| `halfLife` | number | required | L1 decay half-life — controls how quickly evidence fades |
| `l2HalfLife` | number | max of L1 taus | L2 decision neuron decay half-life — typically longer than L1 |
| `messageRate` | number | `1` | Messages per timestamp unit (for warmup calculation) |
| `thresholds` | object | required | Classification levels: `{ monitor: { at, action }, degraded: { at, action }, critical: { at, action } }` — values must be ordered: monitor.at < degraded.at < critical.at |

**Deviation types** (one per source):

| Type | What It Measures | Use When |
|------|-----------------|----------|
| `identity` | Raw value as deviation — no transformation | Signal is already a non-negative badness metric with zero baseline |
| `absolute` | Absolute value of input | Both positive and negative deviations are bad |
| `highExceedance` | How far above `baseline` the value sits | Only values above a threshold are bad (requires `baseline`) |
| `lowExceedance` | How far below `baseline` the value sits | Only values below a threshold are bad (requires `baseline`) |
| `bandExceedance` | Distance outside `band: { lower, upper }` range | Normal is a range; either direction is bad (requires `band`) |

**Reset:** Clears all charges and membrane potential; resets state to Normal.

### Tuning the Appraise Node

The integrator accumulates continuously. With streaming data and a halfLife of hours, even small injections compound into large charges. Every source must produce **exactly zero injection during normal operation** — any non-zero baseline leaks into a false charge.

**Setting baseline:** Use the upstream node's decision boundary. For a Page Hinkley source, set `baseline` to the PH node's `lambda` (below lambda, the PH test hasn't fired — no shift detected). For a trend source, set `baseline` to the trend node's `rocThreshold` (below threshold, trend classifies "stable").

**Setting theta:** This is the Michaelis-Menten half-saturation constant — the deviation value at which the normalised output equals 0.5. Set it to the typical exceedance magnitude when the source is active. Too large and the source contributes nothing; too small and it saturates immediately.

**Choosing good sources:** Look for signals that are zero during baseline, monotonically increasing with severity, and reflecting sustained conditions rather than single-sample events. PH test statistic, EWM rate of change (`rocMean`), and SNR in dB work well. Avoid direction-agnostic confidence (high during "stable"), per-sample breakout scores (`envScore`), and non-monotonic indicators (crest factor).

```javascript
// Bearing health assessment: 3 evidence sources
.appraise( 'health',
    [ 'rmsZScore', 'kurtTrend', 'phShift' ],
    {
        combined: 'conviction', state: 'healthState',
        charge: 'charge', rate: 'rate'
    },
    {
        sources: {
            rmsZScore: { deviation: 'highExceedance', baseline: 0, theta: 2, weight: 1 },
            kurtTrend: { deviation: 'identity', theta: 0.5, weight: 0.6 },
            phShift:   { deviation: 'identity', theta: 0.5, weight: 0.8 }
        },
        halfLife: 20,
        thresholds: {
            monitor:  { at: 0.3, action: 'log' },
            degraded: { at: 0.6, action: 'alert' },
            critical: { at: 0.85, action: 'shutdown' }
        }
    }
)
// Outputs: conviction (0-1), healthState ('Normal'|'Monitor'|'Degraded'|'Critical'),
//          charge_rmsZScore, charge_kurtTrend, charge_phShift,
//          rate_rmsZScore, rate_kurtTrend, rate_phShift
```

---

## kalman1d
**`#SignalConditioning`**

Bayesian state estimation for noisy streaming data. The node predicts the next state using a linear model, compares the prediction with the actual measurement, and updates its estimate optimally. The key insight: the innovation signal — the gap between prediction and reality — is a first-class output that quantifies surprise. Feed it to downstream nodes (appraise, esStats, threshold) for anomaly detection. The chi-squared gate classifies each measurement as normal or outlier with known false-alarm rates.

Two operating modes handle outliers differently:
- **Exclude mode** (default): Rejected measurements do not update the estimate — the filter coasts on its model. Use when outliers are sensor glitches that should be ignored.
- **Follow mode**: On outlier detection, the filter reinitializes to the new measurement. Use when genuine step changes (setpoint adjustments, mode transitions) must be tracked immediately.

The innovation and gate statistics are always computed and published, regardless of the gate decision — downstream nodes always see the reality signal.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**

- `filtered` — optimal state estimate (the Kalman-filtered value)
- `variance` — estimation uncertainty — grows during prediction, shrinks on update
- `innovation` — prediction error (signed): how far the measurement deviated from expectation. Near zero during normal operation; spikes on genuine anomalies or sensor faults
- `innovationGate` — chi-squared statistic: unitless anomaly score directly thresholdable with known false-alarm rates (e.g., > 6.63 = 99% confidence outlier)

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sensorVariance` | number | `1` | Measurement noise (R) — how noisy the sensor is |
| `processVariance` | number | `0.01` | Process noise ratio (Q/R) — how much the true state can change between samples |
| `chi2Threshold` | number | `6.63` | Outlier gate (chi-squared with 1 degree of freedom); 6.63 = 99% confidence |
| `followMode` | boolean | `false` | `true`: reinitialize on outlier; `false`: reject and coast |
| `stateTransition` | number | `1` | State evolution coefficient (F); 1 = random walk (most common) |
| `measurement` | number | `1` | Observation model coefficient (H); 1 = direct measurement |
| `controlModel` | number | `0` | Control input coefficient (G); 0 = no control input |
| `control` | string | — | Optional field name for a control input — any causal influence (fuel rate, setpoint, current) |
| `varianceLimit` | number | `100` | Maximum variance as ratio of R — bounds uncertainty growth during extended prediction |

**Per-field values:** `sensorVariance`, `processVariance`, `chi2Threshold`, and `controlModel` also accept a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Reset:** Clears estimate and uncertainty; next measurement auto-initializes.

### Tuning kalman1d

**Q/R ratio (`processVariance`):** Controls the balance between trusting the model and trusting the measurement. Low Q/R (0.001) produces heavy smoothing — the filter trusts its model and changes slowly. High Q/R (0.1) follows measurements closely — less smoothing but faster response. Start with 0.01 and adjust: if the filtered signal lags behind real changes, increase; if it's too noisy, decrease.

**Gate threshold (`chi2Threshold`):** Determines the false-alarm rate for outlier detection. Common choices:

| Threshold | Confidence | False-alarm rate | Use when |
|-----------|-----------|------------------|----------|
| 3.84 | 95% | 1 in 20 samples | Sensitive — catch most anomalies, tolerate some false alarms |
| 6.63 | 99% | 1 in 100 samples | Balanced — standard choice for most applications |
| 10.83 | 99.9% | 1 in 1000 samples | Conservative — only flag clear outliers |

**When to use follow mode:** Enable when the process has legitimate step changes that should be tracked immediately (setpoint adjustments, mode transitions, batch changes). In follow mode, the filter reinitializes when it detects an outlier — it assumes the jump is real and adapts. Disable (default) when outliers are sensor glitches or transient noise.

**Control input:** The `control` option names any field that causally influences the measurement. This is not limited to actuator commands — fuel consumption affects exhaust temperature, occupancy affects HVAC load, current affects motor temperature. When a control input is provided, the filter accounts for its effect during prediction, so the innovation reflects only *unexpected* variation.

### Composition patterns

The innovation signal is the bridge between filtering and detection:

```javascript
// Pattern 1: kalman1d → threshold (direct outlier detection)
.kalman1d('smooth', 'pressure',
    { filtered: 'estPressure', innovationGate: 'pGate' },
    { sensorVariance: 4, processVariance: 0.001 }
)
.threshold('outlier', 'pGate',
    { active: 'pressureOutlier' },
    { mode: 'above', threshold: 6.63 }
)

// Pattern 2: kalman1d → appraise (evidence fusion)
// Innovation feeds appraise as one of several evidence sources
.kalman1d('model', 'vibration',
    { innovation: 'vibSurprise', innovationGate: 'vibGate' },
    { processVariance: 0.01 }
)
.appraise('health', [
    { from: 'vibGate', deviation: 'highExceedance',
      baseline: 3.84, theta: 5, weight: 1.0 },
    // ... other sources
], { ... })

// Pattern 3: kalman1d → esStats (monitor model quality)
// Track the innovation's statistics — a well-tuned filter has
// zero-mean, white innovation
.kalman1d('filter', 'temperature',
    { filtered: 'estTemp', innovation: 'tempResidual' },
    { sensorVariance: 2, processVariance: 0.005 }
)
.esStats('residualStats', 'tempResidual',
    { mean: 'residualMean', stdev: 'residualStd' },
    { halfLife: 50 }
)
// residualMean drifting from zero → model mismatch
// residualStd growing → process is changing
```

```javascript
// Control-aware prediction — compensate for known inputs
.kalman1d('fuel', 'exhaustTemp',
    { filtered: 'estExhaust', innovation: 'residual' },
    { control: 'fuelRate', controlModel: 0.5, processVariance: 0.1 }
)
// The filter accounts for fuel rate changes —
// innovation reflects only unexpected variation
```
