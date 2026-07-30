# Signal Conditioning

## butterworthFilter
A 2nd-order Butterworth filter that smooths or separates frequency content in real-time streaming data. Lowpass mode removes high-frequency noise (vibration ripple, electrical interference); highpass mode removes slow drift (thermal creep, DC offset). The filter uses a Direct Form II implementation with denormal flushing for sustained numerical performance.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**
- `filtered` — the filtered signal

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `filterType` | string | `'lowpass'` | `'lowpass'` or `'highpass'` |
| `sampleRateHz` | number | required | Sample rate in Hz |
| `cutoffHz` | number | - | Cutoff frequency in Hz |
| `settlingTimeMs` | number | - | Settling time in ms (alternative to cutoffHz) |
| `cutoffRatio` | number | - | Ratio of Nyquist frequency, 0–1 (alternative to cutoffHz) |
| `adjustForCascade` | number | - | Pre-compensate cutoff for an n-stage cascade (integer ≥ 2) |
| `initStrategy` | string | - | `'dc'` to pre-load filter state, reducing startup transient |
| `dcEstimate` | number | - | Expected DC value (required when initStrategy is `'dc'`) |
| `acceptNumericalRisk` | boolean | `false` | Allow extreme cutoff ratios that may cause instability |

**Note:** Specify exactly one of `cutoffHz`, `settlingTimeMs`, or `cutoffRatio`.

**Per-field values:** `filterType`, `cutoffHz`, `settlingTimeMs`, and `cutoffRatio` also accept a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Reset:** Clears filter delay elements. If a DC estimate is configured, re-initializes to the DC steady state.

```javascript
// Lowpass with cutoff frequency
.butterworthFilter('smooth', 'vibration',
    { filtered: 'cleanVibration' },
    { sampleRateHz: 1000, cutoffHz: 50 }
)

// Highpass to remove DC offset
.butterworthFilter('ac', 'sensor',
    { filtered: 'acSignal' },
    { filterType: 'highpass', sampleRateHz: 100, cutoffHz: 0.5 }
)

// Specify by settling time
.butterworthFilter('fast', 'temp',
    { filtered: 'smoothTemp' },
    { sampleRateHz: 10, settlingTimeMs: 500 }
)

// DC-aware initialization
.butterworthFilter('filter', 'pressure',
    { filtered: 'filtered' },
    { sampleRateHz: 100, cutoffHz: 5, initStrategy: 'dc', dcEstimate: 101.3 }
)
```

---

## categorize
**`#FeatureExtraction`**

Assigns a numeric value to a named category by comparing it against a sorted list of thresholds. Values below the first threshold fall into the first category, values between the first and second fall into the second, and so on. Produces both the category name (a string for display) and a zero-based index (a number for efficient downstream comparisons).

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**
- `category` — assigned category name (string)
- `index` — zero-based category index (number: 0, 1, 2, ...)

**Reset:** Not applicable — stateless. Each message recomputes the category.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `thresholds` | array or function | required | Array of numbers in ascending order |
| `categories` | array | required | Labels (length = thresholds.length + 1) |

**Dynamic parameters:** `thresholds` accepts a function for operating-mode-based category boundaries. See [Dynamic Options](../flow-language.md#dynamic-options).

**Per-field values:** `thresholds` and `categories` also accept a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Error handling:** If a tunable function throws, the node continues with the last successfully resolved thresholds. If no previous value exists (first message), outputs are marked invalid. The first error per episode is logged to console; subsequent errors are suppressed until the tunable recovers. See [What Happens When a Tunable Throws](../flow-language.md#what-happens-when-a-tunable-throws).

```javascript
// Single field
.categorize('level', 'temperature',
    { category: 'tempLevel', index: 'tempLevelIdx' },
    {
        thresholds: [10, 20, 30, 40],
        categories: ['Very Low', 'Low', 'Normal', 'High', 'Very High']
    }
)
// Outputs: tempLevel (string), tempLevelIdx (0-4)

// Dynamic thresholds based on operating mode
const MODE_THRESHOLDS = { production: [50, 80], startup: [20, 40] };
.categorize('level', 'power',
    { category: 'level' },
    {
        thresholds: ( msg ) => MODE_THRESHOLDS[ msg.mode ] ?? [50, 80],
        categories: ['low', 'normal', 'high']
    }
)

// Multi-field
.categorize('levels', ['temperature', 'pressure'],
    { category: 'level', index: 'levelIdx' },
    { thresholds: [10, 20, 30], categories: ['Low', 'Normal', 'High', 'Critical'] }
)
// Outputs: temperature_level, temperature_levelIdx, pressure_level, pressure_levelIdx
```

---

## esMean
Smooths a signal exponentially, giving recent values more weight than older ones. Controlled by a half-life: after that many samples, a past value's influence has halved. The first value initializes the estimate; subsequent values blend in smoothly. With `adaptiveHalfLife` enabled, the smoothing speeds up automatically when the signal surprises (jumps away from the estimate) and returns to the base rate when the signal is calm.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**
- `mean` — exponentially smoothed mean

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `halfLife` | number | `3.1` | Decay half-life in samples — after this many samples, a past value's influence has halved |
| `adaptiveHalfLife` | boolean | `false` | When enabled, smoothing speeds up on surprise and returns to the base rate when the signal is calm |

**Per-field values:** `halfLife` also accepts a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Reset:** Clears the estimate and restores the base smoothing rate. The next value re-initializes the estimate.

```javascript
// Single field — direct naming
.esMean('baseline', 'temperature', { mean: 'tempBaseline' })
// Output: tempBaseline

// Multi-field — auto-naming
.esMean('baseline', ['temp', 'pressure'], { mean: 'baseline' })
// Outputs: temp_baseline, pressure_baseline

// Adaptive — tracks sudden shifts faster, smooths steady signals slower
.esMean('adaptive', 'vibration', { mean: 'vibSmooth' },
    { halfLife: 5, adaptiveHalfLife: true }
)
```

---

## esStats
**`#FeatureExtraction`**

Computes exponentially weighted statistics from a single input field. Request only the stats you need — the node has two internal computation paths and only activates the path(s) required:

```text
              ┌─── Core Path (Welford's) ─────────────────────────┐
              │  mean, variance, stdev  →  snrDB, cv  →  zScore   │
  value  ─────┤                                                    │──→ message
              │  floor, ceiling  →  envelope, mid  →  envScore     │
              └─── Envelope Path (fast-attack / slow-release) ────┘
```

Both paths share the same `halfLife`. If you request stats from both groups, both paths run. If you only need mean and stdev, the envelope path never executes.

**Type:** Per-field processing
**Mode:** Single or Multi-field

**Stats — Core Path:**

These use Welford's algorithm for numerically stable exponential smoothing.

| Stat | What It Measures |
|------|-----------------|
| `mean` | Exponentially smoothed average — recent values weigh more than older ones |
| `variance` | Smoothed variance (unbiased by default; see `biased` option) |
| `stdev` | Standard deviation (square root of variance) |
| `snrDB` | Signal-to-noise ratio in dB: `20 × log10(|mean| / stdev)`. High = clean signal, low = noisy. Capped at 60 dB when stdev approaches zero |
| `cv` | Coefficient of variation: `stdev / |mean|`. How much the signal varies relative to its average — 0.01 means 1% variation |
| `zScore` | How many standard deviations the current value is from the mean. Computed **before** the current value is blended in, so it measures surprise against the established baseline |

**Stats — Envelope Path:**

These track the signal's recent bounds using fast-attack / slow-release: new extremes are captured instantly, then the boundary slowly relaxes back when values return toward center.

| Stat | What It Measures |
|------|-----------------|
| `floor` | Recent minimum — drops instantly on a new low, relaxes back exponentially (per `halfLife`) when values recover |
| `ceiling` | Recent maximum — jumps instantly on a new high, relaxes back exponentially (per `halfLife`) when values recede |
| `envelope` | Envelope width: `ceiling − floor`. How wide the signal has been swinging recently |
| `mid` | Envelope midpoint: `(floor + ceiling) / 2` |
| `envScore` | Where the current value sits within the envelope: 0 = center, ±1 = boundary, beyond ±1 = breakout. Like zScore but envelope-based. Also computed **before** the value is incorporated |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `halfLife` | number | `10` | Decay half-life in samples — after this many samples, a past value's influence has halved |
| `biased` | boolean | `false` | When true, use population variance; when false, apply Bessel's correction for unbiased estimation |

**Warmup:** No output for the first 3 samples while the baseline is established.

**Per-field values:** `halfLife` also accepts a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Reset:** Clears all statistics, weight accumulator, and sample counter. The next 3 samples re-establish the baseline before outputs resume.

```javascript
// Core statistics only — envelope path stays inactive
.esStats('stats', 'temperature',
    { mean: 'avgTemp', stdev: 'stdTemp' },
    { halfLife: 20 }
)

// Envelope tracking only — core path stays inactive
.esStats('envelope', 'signal',
    { floor: 'sigFloor', ceiling: 'sigCeil', envelope: 'sigEnv' }
)

// Anomaly detection — both paths activate
// zScore and envScore use the pre-update baseline
.esStats('anomaly', 'sensor',
    { mean: 'avg', zScore: 'sensorZ', envScore: 'sensorEnvScore' }
)

// Signal quality
.esStats('quality', 'reading',
    { snrDB: 'signalQuality', cv: 'variation' }
)

// Multi-field
.esStats('stats', ['temperature', 'pressure'],
    { mean: 'avg', stdev: 'std' },
    { halfLife: 15 }
)
// Outputs: temperature_avg, temperature_std, pressure_avg, pressure_std
```

---

## kernel
Applies a weighted sum (convolution) over a sliding window. Choose from 19 built-in presets for common operations — smoothing, derivatives, spike detection, trend extraction — or supply a custom weight array. The node waits until the window is full before producing output; earlier messages pass through without a result.
**`#FeatureExtraction`** **`#Detection`**

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**
- `filtered` — result of the convolution (weighted sum over the window)

**Reset:** Clears the sliding window. The node waits for the window to fill again before producing output.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `preset` | string | - | Named preset kernel (see below) |
| `kernel` | array | - | Custom weights array (must sum to 1 for smoothing) |

**Note:** Specify exactly one of `preset` or `kernel`.

**Per-field values:** `preset` and `kernel` also accept a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Available Presets (19):**

| Category | Preset | Size | Description |
|----------|--------|------|-------------|
| **Smoothing** | `smooth3` | 3 | Simple weighted average `[0.25, 0.5, 0.25]` |
| | `smooth5` | 5 | Wider smoothing `[0.1, 0.2, 0.4, 0.2, 0.1]` |
| | `debounce5` | 5 | Alias for smooth5 |
| | `envelope` | 5 | Envelope tracking `[0.1, 0.15, 0.5, 0.15, 0.1]` |
| **Derivatives** | `rate` | 2 | First difference `[-1, 1]` |
| | `rate3` | 3 | Centered first derivative `[-1, 0, 1]` |
| | `accel` | 3 | Second derivative `[1, -2, 1]` |
| | `jerk` | 4 | Third derivative `[-1, 3, -3, 1]` |
| **Savitzky-Golay** | `sg5` | 5 | Quadratic smoothing (5-point) |
| | `sg7` | 7 | Quadratic smoothing (7-point) |
| | `sgRate5` | 5 | SG first derivative `[-0.2, -0.1, 0, 0.1, 0.2]` |
| **Binomial** | `binomial5` | 5 | Gaussian approximation (5-point) |
| | `binomial7` | 7 | Gaussian approximation (7-point) |
| **Detection** | `spike3` | 3 | Spike/outlier detection `[-1, 2, -1]` |
| | `edge5` | 5 | Edge enhancement `[-1, -1, 5, -1, -1]` |
| | `impulse` | 5 | Impulse detection `[0.25, -1, 1.5, -1, 0.25]` |
| **Mechanical** | `shock` | 3 | Shock detection (same as accel) |
| | `volatility` | 3 | Volatility measure (same as spike3) |
| | `momentum5` | 5 | Momentum indicator `[-0.3, -0.1, 0, 0.1, 0.3]` |

```javascript
// Single field with preset
.kernel('smooth', 'signal',
    { filtered: 'smoothedSignal' },
    { preset: 'smooth5' }
)
// Output: smoothedSignal

// Rate of change with Savitzky-Golay
.kernel('deriv', 'position',
    { filtered: 'velocity' },
    { preset: 'sgRate5' }
)

// Multi-field with custom kernel
.kernel('derive', ['position', 'velocity'],
    { filtered: 'derivative' },
    { kernel: [-1, 0, 1] }  // Simple derivative
)
// Outputs: position_derivative, velocity_derivative
```

---

## median3
A three-point median filter for removing single-sample spikes with minimal lag. Each output is the median of the last three values — spikes that only affect one sample are eliminated because the median ignores the outlier. During the first two messages, the node gracefully degrades: one value produces a passthrough, two values produce their average.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**
- `median3` — median of the last 3 values

**Options:** None
**Reset:** No-op — the three-value window is not cleared. Old values are overwritten within three messages.

```javascript
// Single field
.median3('clean', 'vibration', { median3: 'cleanVibration' })
// Output: cleanVibration

// Multi-field
.median3('clean', ['vibration', 'acceleration'], { median3: 'clean' })
// Outputs: vibration_clean, acceleration_clean
```

---

## sanitize
The first line of defense in a pipeline. Validates each value against up to three rules — range bounds, an allow/deny list, and a custom predicate — checked in that order. The first rule that fails marks the value as invalid on the message itself, so every downstream node sees it as invalid and isolates the damage to that one field. Also reports why the value failed and what the original value was.
**`#Detection`**

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**
- `failureReason` — which rule failed: `"range"`, `"valueList"`, or `"predicate"` (null when valid)
- `failedValue` — the original value that failed validation (null when valid)

**Reset:** Clears failure tracking. Validation is per-message, so reset has no effect on subsequent results.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ranges` | object or function | - | A direct `{ min, max }` for the field this node reads, or `{ field: { min, max } }` per-field bounds |
| `valueList` | array | `[]` | List of values for allow/deny validation |
| `containsValidValues` | boolean | `false` | `true` = allow list, `false` = deny list |
| `predicate` | function | - | Custom validator `(value, msg) => boolean` |

**Note:** At least one validation method must be specified.

**Dynamic parameters:** `ranges` accepts a function for shift/mode-based validity ranges. See [Dynamic Options](../flow-language.md#dynamic-options).

**Per-field values:** `ranges` and `valueList` also accept a per-field map (one entry per field) for multi-field and `forEach` pipelines; `ranges` additionally accepts a direct `{ min, max }`. See [Option value shapes](../flow-language.md#option-value-shapes).

**Error handling:** If the ranges tunable throws, the node continues with the last successfully resolved ranges (range check is skipped if no previous value exists). If the custom predicate throws, the value is treated as invalid. All errors are logged once per error episode — repeated errors are suppressed until recovery. See [What Happens When a Tunable Throws](../flow-language.md#what-happens-when-a-tunable-throws).

```javascript
// Range validation (per-field map — the range is keyed by the field name)
.sanitize('validate', 'temperature',
    { failureReason: 'error', failedValue: 'bad' },
    { ranges: { temperature: { min: -40, max: 150 } } }
)

// Direct range — one { min, max } for the single field this node reads.
// Reads cleanly inside a forEach fan, where each copy reads one field.
.sanitize('validate', 'temperature',
    { failureReason: 'error' },
    { ranges: { min: -40, max: 150 } }
)

// Dynamic ranges based on shift
const SHIFT_RANGES = { day: { min: 20, max: 35 }, night: { min: 15, max: 30 } };
.sanitize('validate', 'temperature',
    { failureReason: 'error' },
    { ranges: ( msg ) => SHIFT_RANGES[ msg.shift ] ?? { min: 15, max: 35 } }
)

// Value list (deny mode - reject these values)
.sanitize('filter', 'status',
    { failureReason: 'reason' },
    { valueList: [-999, 0], containsValidValues: false }
)

// Value list (allow mode - only accept these values)
.sanitize('filter', 'machineState',
    { failureReason: 'reason' },
    { valueList: ['running', 'stopped', 'maintenance'], containsValidValues: true }
)

// Custom predicate
.sanitize('custom', 'reading',
    { failureReason: 'error' },
    { predicate: (value, msg) => value > 0 && value < msg.maxAllowed }
)

// Multi-field with ranges
.sanitize('validate', ['inlet', 'outlet'],
    { failureReason: 'error' },
    { ranges: { inlet: { min: 0, max: 10 }, outlet: { min: 0, max: 120 } } }
)
```

---

## spikeGuard
Detects and cleans single-sample spikes using a 3-sample sliding window. Unlike median3, also reports spike detection with signed magnitude. During the first two messages the node passes through the raw value with no detection.
**`#Detection`**

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**
- `clean` — cleaned value (median of the 3-sample window)
- `detected` — boolean: true when a spike is detected
- `magnitude` — signed deviation of the spike from the expected value (negative = dip, positive = surge, zero = no spike)

**Reset:** Clears the sliding window and resets detection state. The first two messages after reset pass through with no detection.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `threshold` | number | required | Minimum deviation from BOTH neighbors to detect spike |

**Core Algorithm:**
In a 3-sample window `[left, middle, right]`:
- **Spike**: middle differs from BOTH left and right by > threshold
- **Transition**: middle differs from only ONE neighbor (not a spike)

This elegantly discriminates spikes from state transitions without lookahead or buffering.

**Magnitude Interpretation:**
- **Negative** = dip (dropout, sensor went low)
- **Positive** = surge (noise spike, sensor went high)
- **Zero** = no spike detected

```javascript
// Single field - detect pressure spikes
.spikeGuard('filter', 'pump_out_p',
    { clean: 'pump_out_p_clean', detected: 'is_spike', magnitude: 'spike_mag' },
    { threshold: 30 }
)
// Outputs: pump_out_p_clean, is_spike, spike_mag

// Chain with emitIf to report spikes
.spikeGuard('filter', 'pressure',
    { clean: 'pressure_clean', detected: 'spike_detected', magnitude: 'spike_magnitude' },
    { threshold: 25 }
)
.emitIf('reportSpike',
    msg => msg.spike_detected,
    { target: 'mqtt', insightType: 'sensorGlitch' }
)

// Multi-field
.spikeGuard('filter', ['temperature', 'pressure'],
    { clean: 'clean', detected: 'spike', magnitude: 'mag' },
    { threshold: 20 }
)
// Outputs: temperature_clean, temperature_spike, temperature_mag,
//          pressure_clean, pressure_spike, pressure_mag
```

**Why Use spikeGuard Instead of median3:**
- Need to know WHEN spikes occur (detection flag)
- Need spike magnitude for diagnostics or severity tracking
- Need signed magnitude to distinguish dips from surges
- Want both cleaning AND detection in one node

**Limitations:**
Two consecutive spikes cannot be removed by median3 or spikeGuard — a pair of adjacent outliers dominates at least one 3-sample window. Cascading two median3 or spikeGuard nodes does not help either, because the surviving spikes from the first stage still appear as a consecutive pair to the second. A true 5-point median filter would solve this (3 of 5 values are clean), but no `median5` node exists yet. For now, use a smoothing kernel (e.g., `smooth5` or `binomial5`) if burst spikes are a concern.

---

## swStats
Computes exact statistics over a fixed-size sliding window of the last N samples. Unlike esStats (which uses exponential weighting), every sample in the window has equal weight and samples outside the window have zero weight — there is a sharp boundary. Internally, the node maintains incremental power sums and subtracts the evicted value on each step, so computation is O(1) per sample regardless of window size. Only the power sums needed for the requested stats are computed. No output is produced until the window is full.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**
- `mean` — average of the last N samples
- `variance` — sample variance (Bessel-corrected, denominator N-1)
- `stdev` — sample standard deviation
- `skewness` — population skewness: m3 / m2^1.5
- `kurtosis` — population excess kurtosis: m4 / m2^2 - 3
- `rms` — root mean square

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `windowSize` | number | `10` | Number of samples in the window (minimum: 4) |

**Per-field values:** `windowSize` also accepts a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Reset:** Clears all power sums and the sliding window. No output until the window fills again.

```javascript
// Single field
.swStats('window', 'flow',
    { mean: 'avgFlow', stdev: 'flowStd' },
    { windowSize: 100 }
)
// Outputs: avgFlow, flowStd

// Multi-field with higher-order stats
.swStats('window', ['flow', 'pressure'],
    { mean: 'avg', skewness: 'skew', kurtosis: 'kurt' },
    { windowSize: 50 }
)
// Outputs: flow_avg, flow_skew, flow_kurt, pressure_avg, pressure_skew, pressure_kurt
```

---

## twStats
**`#FeatureExtraction`**

Computes exact statistics over non-overlapping tumbling windows of N valid samples. Each window accumulates independently — when the Nth sample arrives, results are published and the window resets to zero. Between completions, output fields are cleared. This replaces the two-node `momentsDigest → digestMoments` chain for the common case where raw samples go in and computed statistics come out. Internally uses Pébay's numerically stable incremental algorithm with O(1) memory regardless of window size. Only the central moments needed for the requested stats are accumulated (selective tier gating: mean-only skips M2–M4 entirely). Invalid samples (NaN, Infinity) are silently skipped and do not count toward the window. Supports flush for graceful shutdown of partial windows.

**Type:** Per-field processing
**Mode:** Single or Multi-field
**Stats:**
- `n` — number of valid samples in the completed window
- `mean` — arithmetic mean
- `variance` — sample variance (Bessel-corrected by default; population variance when `biased` is true)
- `stddev` — standard deviation (square root of variance)
- `cv` — coefficient of variation: stddev / |mean| (NaN when mean is near zero)
- `skew` — population skewness: m3 / m2^1.5
- `kurtosis` — population excess kurtosis: m4 / m2^2 - 3
- `min` — minimum value in the window
- `max` — maximum value in the window
- `rms` — root mean square: sqrt(M2/n + M1²)
- `crestFactor` — crest factor: max(|min|, |max|) / RMS (NaN when RMS is near zero)

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `windowSize` | number | `100` | Valid samples per tumbling window (4–1,000,000) |
| `biased` | boolean | `false` | Use population (biased) variance instead of sample |
| `epsilon` | number | `1e-12` | Numerical stability threshold for near-zero denominators |

**Per-field values:** `windowSize` also accepts a per-field map (one value per field) for multi-field and `forEach` pipelines. See [Option value shapes](../flow-language.md#option-value-shapes).

**Reset:** Clears all moment accumulators (M1–M4, min, max) and restarts the window from zero. No output until the next window completes.

**Flush:** Forces immediate publication of whatever has accumulated so far (partial window). The current sample after flush becomes the first sample of the next window. If no samples have accumulated, flush is a no-op.

**Choosing between swStats and twStats:**
- `swStats` — sliding window: every sample produces fresh output once the window fills; the last N samples always have equal weight
- `twStats` — tumbling window: output only at window boundaries; windows are independent and non-overlapping; supports much larger windows (up to 1,000,000) with O(1) memory

```javascript
// Mean and standard deviation over 500-sample windows
.twStats('tempStats', 'temperature',
    { mean: 'avgTemp', stddev: 'sdTemp' },
    { windowSize: 500 }
)
// Outputs: avgTemp, sdTemp (every 500 valid samples)

// Full statistics with flush support
.twStats('vibStats', 'vibration', {
    n: 'vibN',
    mean: 'vibMean',
    variance: 'vibVar',
    stddev: 'vibSD',
    cv: 'vibCV',
    skew: 'vibSkew',
    kurtosis: 'vibKurt',
    min: 'vibMin',
    max: 'vibMax'
}, { windowSize: 1000 })
// Outputs all 9 stats every 1000 valid samples

// Multi-field
.twStats('stats', ['flow', 'pressure'],
    { mean: 'avg', stddev: 'sd' },
    { windowSize: 200 }
)
// Outputs: flow_avg, flow_sd, pressure_avg, pressure_sd
```
