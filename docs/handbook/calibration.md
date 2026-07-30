# Calibration

A pipeline's nodes are only as good as their parameters. The same `pageHinkley` node that catches a real bearing failure can also fire 50 times a day on baseline noise — or miss the failure entirely — depending on `delta` and `lambda`. This guide covers the principled process for tuning detection, trend, and assessment nodes against real data.

Every number in a flow's configuration is one of three kinds, and each kind is set differently:

- **Learned** — derived from a measured baseline of the signal (a Page Hinkley `delta`, a `threshold` hysteresis). This guide is mostly about these.
- **Law** — fixed by statistics or physics (a chi-squared gate, a Nyquist limit). You cite these; you never tune them.
- **Knob** — a deployment fact from outside the data (a specification limit, an alert policy). You look these up; you never fit them.

The approach is the same regardless of signal type: first check that the instrument itself is telling the truth, then characterise what "normal" looks like, then set each learned parameter relative to that baseline.

---

## Step 0 — Audit the Instrument Before You Trust Its Numbers

A flow never sees the equipment. It sees what the instrument claims about the equipment. Every baseline statistic in this guide — and every threshold derived from one — is built on those claims.

A broken instrument does not always look noisy. A latched register produces a perfectly flat signal. A meter with a wrong scale factor produces a clean, stable signal at the wrong magnitude. Both give you a beautifully tight σ₀ — and every parameter calibrated from it inherits the error. So before computing any baseline statistic, run these three checks on the baseline window. None of them needs a baseline itself; they work from the first message.

### Catch frozen channels

A live physical signal never repeats bit-identically for long. Flow, temperature, current — all of them wander at least a little between samples. A long run of *exactly* identical readings at a nonzero level is a latched register or a stalled collector, not a quiet plant.

The recipe: `lag` computes the sample-to-sample difference, and `persistenceCheck` confirms a run of exact zeros:

```javascript
.lag('freeze', 'flowRate', { delta: 'flowDelta' })
.persistenceCheck('frozen',
    ( msg ) => ( msg.flowDelta === 0 ) && ( msg.flowRate !== 0 ),
    { persistenceConfirmed: 'flowFrozen' },
    { minVotes: 30, outOfTotal: 30 }
)
```

Size `minVotes` as the shortest run of identical readings that is physically impossible for the signal. Thirty consecutive identical readings at one-minute cadence means the value has not moved at all for half an hour — plausible for a setpoint, impossible for a live flow.

Two related checks come almost free from the same `lag` node:

- **Counters only go up.** On a cumulative register (an energy or volume totaliser), `delta < 0` is a meter reset or swap, never consumption. Any statistic built on that counter must be re-based at the reset.
- **A stuck rate is as suspicious as a stuck value.** If the signal is itself a rate (a power reading), apply the frozen check directly to it.

### Range-check with units gates, not health bands

The `sanitize` node's `ranges` option is the pipeline's first gate. Set its bounds to what is *physically possible* for the instrument and unit — not to what is *healthy* for the process:

```javascript
// Units gate: any LV voltage reading is 150–1000 V.
// Wide on purpose — it asks "is this volts?", not "is this healthy?"
.sanitize('validate', 'voltage',
    { failureReason: 'vError' },
    { ranges: { min: 150, max: 1000 } }
)
```

The reason to keep the gate wide: a health band assumes the very thing the pipeline exists to test. If the gate is 415 V ± 25% and a meter breaks in a way that reports 206 V, every one of its readings is silently discarded — the broken regime becomes invisible, and the baseline you characterise contains only the readings that happened to look healthy. A wide units gate still rejects impossible values (a kilovolt reading in a volts field, a sensor sentinel like −9999 — use `valueList` for known sentinels) while letting genuinely sick readings through to the detectors whose job is to judge them.

One more consequence: if the same field name carries different units on different assets (volts on one, kilovolts on another), a single range is meaningless. Give each asset class its own range — `ranges` accepts a function, so the bounds can follow an asset-class field on the message.

### Cross-check channels that should agree

When the message carries two readings that physics locks together, their disagreement is a free integrity check. Two patterns, both from standard nodes:

**Redundant pair** — two channels that should read the same value. `ratio` divides them; `esStats` tracks the residual:

```javascript
.ratio('agree', 'tempA', 'tempB', { ratio: 'tempRatio' })
.esStats('residual', 'tempRatio',
    { mean: 'ratioMean', stdev: 'ratioStdev' },
    { halfLife: 200 }
)
```

**Balanced group** — several channels that should read nearly the same by design (three phase currents, parallel pumps sharing a load). `unbalance` reports the spread and names the outlier:

```javascript
.unbalance('phases', [ 'currentR', 'currentY', 'currentB' ],
    { unbalance: 'phaseUnbalance', worstIndex: 'worstPhase' }
)
```

Where the expected value needs arithmetic across several fields (a power reading checked against voltage × current), compute the expected value at ingestion so both sides exist as message fields — then the `ratio` pattern applies unchanged.

Read the *shape* of the residual, not just its size:

| Residual behaviour | Meaning | Action |
|---|---|---|
| Flat, far from 1 | Configuration fault — a wrong scale factor is rock-steady | Fix the config; do not calibrate on this data |
| Drifting | One channel degrading | Equipment issue — the detectors' job |
| Jumping between discrete levels | Operating regimes, not faults | Characterise per regime (see [One baseline per regime](#one-baseline-per-regime)) |

Only calibrate on windows where the residual sits at 1. And keep these Step-0 checks in the production flow, ahead of the detectors — the instrument can start lying after deployment too.

---

## Baseline Characterisation

Everything starts here. Before tuning any node, measure the statistical properties of each signal during a known-healthy operating period.

**Step 1 — Select a baseline window.** Choose a contiguous period where the equipment was operating normally *and* the Step-0 checks pass: no frozen runs, no out-of-gate values, cross-check residuals flat at 1. Longer is better (more stable statistics), but the window must exclude any degradation, startup transients, or maintenance events. For the NASA IMS bearing dataset, the first 2 days (288 of 982 samples) precede any degradation signal.

**Step 2 — Compute per-signal statistics.**

For each raw signal (e.g., RMS vibration, kurtosis):

| Statistic | Symbol | What it tells you |
|-----------|--------|-------------------|
| Mean | μ₀ | The signal's normal operating level |
| Standard deviation | σ₀ | How much the signal fluctuates during normal operation |

For rate-of-change (sample-to-sample differences):

| Statistic | Symbol | What it tells you |
|-----------|--------|-------------------|
| Mean rate | μᵣ | Should be near zero during baseline (no drift) |
| Rate stdev | σᵣ | Natural sample-to-sample variation in rate |

**Step 3 — Check the window is long enough.** Split the window in half and compute σ₀ on each half. If the two halves disagree by more than about 10%, the estimate has not settled — use a longer window before hanging thresholds on it. (A window that fails this test quietly inflates or deflates every σ₀-derived parameter downstream.)

**Worked example — NASA IMS Bearing 1, first 2 days:**

| Signal | μ₀ | σ₀ | Notes |
|--------|-----|-----|-------|
| RMS | 0.07725 | 0.00109 | Very tight baseline — inner race defect hasn't started |
| Kurtosis | 0.4358 | 0.0992 | Higher variability — kurtosis is inherently noisier |
| RMS rate-of-change | ≈ 0 | 0.00135 | No drift, moderate sample-to-sample noise |
| Kurtosis rate-of-change | ≈ 0 | 0.1323 | No drift, high sample-to-sample noise |

These numbers are the calibration basis for every downstream parameter.

If the equipment has distinct operating modes (idle vs. loaded, day vs. night), a single baseline mixes them and σ₀ comes out inflated — thresholds derived from it go deaf. Characterise each mode separately; [One baseline per regime](#one-baseline-per-regime) shows how tunables carry per-mode constants.

---

## Law, Knob, or Learned — Classify Every Number

Before tuning, classify. Every option value in the flow gets exactly one label:

- **Learned** — set from the baseline you just characterised, usually as a multiple of σ₀ or σᵣ.
- **Law** — set by statistics or physics; comes with a citation, never with tuning.
- **Knob** — set by a fact from outside the data: a spec sheet, a standard, an operating policy, the message cadence.

The test for every constant: *this flow moves to a new asset tomorrow and only the config changes — is the number still right?* A Law is right everywhere. A Knob is right once you look up the new asset's fact. A Learned value is right once you re-run baseline characterisation. A number that fails all three readings was fitted to the studied data — replace it.

### Learned knobs (this guide shows how)

| Knob | Set from |
|---|---|
| `pageHinkley` → `delta`, `lambda` | Multiples of σ₀ — see [Page Hinkley Tuning](#page-hinkley-tuning) |
| `trend` → `rocThreshold` | Multiple of the smoothed rate noise — see [Trend Node Tuning](#trend-node-tuning) |
| `kalman1d` → `sensorVariance` | Variance of a steady baseline stretch, or the datasheet accuracy — see [Kalman1d Calibration](#kalman1d-calibration) |
| `threshold` → `hysteresis` | At least 2× the noise of the signal at the boundary — see [Gate Knobs](#gate-knobs-sized-by-noise) |
| `spikeGuard` → `threshold` | Largest legitimate one-sample step — see [Gate Knobs](#gate-knobs-sized-by-noise) |
| `winnow` → `K` | Band width in units of the upstream noise floor; 2–3 is typical |
| `swingWatch` → `threshold` | Smallest swing that matters — several × σ₀, so noise wiggles don't count. A fixed value transfers only between channels of similar size; unequal channels need a per-field map, a function, or a normalized input upstream |
| `appraise` → per-source `theta` | Typical exceedance magnitude when the source is active — see [Appraise Node Calibration](#appraise-node-calibration) |

### Laws (cite, never tune)

| Knob | The law |
|---|---|
| `kalman1d` → `chi2Threshold`, `winnow` → `chi2Threshold` | Chi-squared, 1 degree of freedom: 3.84 = 95%, 6.63 = 99%, 10.83 = 99.9% confidence. Picking a row picks a false-alarm rate; there is nothing else to tune |
| `processIndex` → `capableThreshold` (1.33), `marginalThreshold` (1.0) | Industry process-capability conventions |
| `butterworthFilter` → `sampleRateHz`, `cutoffHz` | `sampleRateHz` is the true cadence (a fact); `cutoffHz` must stay below half of it (Nyquist limit) |
| `sanitize` → `ranges` | Physical possibility for the instrument and unit (Step 0) |
| Numerical floors: `epsilon` (`twStats`, `digestMoments`, `processIndex`), `minVariance` (`esCorrelation`), `minY` (`ratio`), `varianceLimit` (`kalman1d`), `maxIndex` (`processIndex`) | Division-by-zero and runaway guards. Leave at defaults |

### Knobs (look up, never fit)

| Knob | The outside fact |
|---|---|
| `processIndex` → `upperSpecLimit`, `lowerSpecLimit` | The product specification. From the drawing — never from the data (fitting spec limits to output makes every process look capable) |
| `categorize` → `thresholds`, `categories` | A standard's class boundaries or an operating policy |
| `appraise` → `thresholds` | Alert policy: what conviction level warrants which action |
| `threshold` → `threshold`, `min`, `max` | Usually a spec or policy boundary (the `hysteresis` around it is Learned) |
| `appraise` → `messageRate` | The actual message cadence — a fact about the feed, and the decay math silently breaks if it's wrong |
| Half-life family: `esMean`, `esStats`, `esCorrelation`, `esPairwiseCorrelation` → `halfLife`; `pageHinkley` → `halfLife`; `trend` → `rocStatsHalfLife` (all in samples); `appraise` → `halfLife`, `l2HalfLife` (in timestamp units) | The process time-scale: how long should the statistic remember? Long enough to smooth noise, short enough to track the fastest change that matters |
| Window family: `swStats`, `twStats`, `momentsDigest`, `digestMoments`, `swingWatch` → `windowSize`; `lag` → `lag`; `kernel` → `preset`/`kernel`; `winnow` → `tightenBase`, `maxGap` | Same trade in window form: the shortest feature you must preserve, in samples at the actual cadence |
| Confirmation family: `persistenceCheck` → `minVotes`, `outOfTotal`; `stateChangeDetector` → `debounce` | Cadence × acceptable detection delay — see [Confirmation Knobs](#confirmation-knobs--votes-before-verdicts) |
| Warm-up family: `pageHinkley` → `minWarmUpSamples`; `trend` → `warmupSamples`; `esCorrelation` → `minSamples` | How many samples the statistic needs before it means anything |
| `kalman1d` → `processVariance` | How fast the true quantity can move between samples — plant physics, not signal noise |
| `unbalance` → `minPresent` | Channel topology: how many of the group must report for the cross-field metric to mean anything |

The remaining nodes (`accumulate`, `diff`, `invertFlag`, `median3`, `tally`, `transform`, `vectorDistance`, `dwellTimeTracker`, `controller`, `emitIf`, `passIf`, `persistIf`) have no numeric calibration options — but constants written *inside* their predicates (`msg.temp > 80`) are knobs like any other. Classify them the same way: is 80 a spec limit (Knob), or should it be μ₀ + k·σ₀ (Learned)?

---

## Dynamic Knobs — Tunables and the Helper Functions

Several learned knobs accept a function instead of a number. The function receives the current message and returns the value to use — resolved per message, pre-compiled at startup so the hot path pays no dispatch cost. Composer calls these **tunables**.

The calibration-relevant tunables:

| Node | Options that accept a function |
|---|---|
| `pageHinkley` | `delta`, `lambda` |
| `trend` | `rocThreshold` |
| `threshold` | `threshold`, `min`, `max`, `hysteresis` |
| `winnow` | `K` |
| `swingWatch` | `threshold` |
| `categorize` | `thresholds` |
| `sanitize` | `ranges` |

(Most of these also accept a per-field map for multi-field pipelines — see [Option value shapes](./flow-language.md#option-value-shapes). A map picks a value per *field*; a tunable picks a value per *message*.)

Composer ships seven helpers that build these functions with introspectable semantics — import them alongside the flow DSL:

| Helper | Returns | Calibration use |
|---|---|---|
| `lookupByField( field, map, default )` | The map entry for the message's field value | Per-regime constants: a different `lambda` per operating mode |
| `scaleBy( field, factor, offset?, step? )` | `msg[field] × factor + offset` | Noise-tracking sensitivity: `delta` follows a live stdev |
| `chooseWhen( predicate, trueVal, falseVal, desc )` | One of two values by condition | Desensitise during a known transient (warmup, cleaning cycle) |
| `clampTo( field, min, max )` | The field value, bounded | Safety limits on an externally supplied threshold |
| `fromField( field, default? )` | The field value directly | Threshold tracks a learned baseline published upstream |
| `offsetBy( field, offset )` | `msg[field] + offset` | Baseline-plus-margin thresholds |
| `pickByField( map )` | Resolved once at build time, inside a `forEach` | Per-channel constants when a fan expands — no runtime cost |

### One baseline per regime

When the residual of a cross-check — or the signal itself — jumps between discrete levels, the plant has operating regimes. One σ₀ across regimes is wrong twice over: it is inflated by the level jumps (so thresholds go deaf within each regime), and every regime transition looks like a shift (so detectors fire on mode changes, not faults).

The procedure:

1. Split the baseline window by regime, using whatever field marks the mode. If no field marks it, `stateChangeDetector` on the load-related fields finds the transitions.
2. Run [Baseline Characterisation](#baseline-characterisation) once per regime — a μ₀ and σ₀ column per mode.
3. Carry the per-regime constants with `lookupByField`:

```javascript
.pageHinkley('drift', 'motorCurrent',
    { phShift: 'currentShift' },
    {
        delta:  lookupByField( 'operatingMode', { idle: 0.02, loaded: 0.15 }, 0.15 ),
        lambda: lookupByField( 'operatingMode', { idle: 0.4,  loaded: 3.0  }, 3.0 )
    }
)
```

4. Verify each regime against its own baseline slice — a constant validated only on the loaded slice says nothing about idle behaviour.

### Keep the ruler apart from the thing it measures

A tunable that reads a *live* statistic makes the threshold adaptive:

```javascript
.esStats('noise', 'rms', { stdev: 'rmsStdev' }, { halfLife: 200 })
.pageHinkley('drift', 'rms',
    { phShift: 'rmsShift' },
    { delta: scaleBy( 'rmsStdev', 1.0 ), lambda: scaleBy( 'rmsStdev', 18 ) }
)
```

This is legitimate — it re-runs the σ₀ calibration continuously. But the noise estimate must move much more slowly than the events being detected. Here the stdev half-life is 200 samples while a shift accumulates over tens of samples, so a developing fault cannot inflate the noise estimate fast enough to raise its own threshold. As a rule, make the statistic's half-life at least 10× the detection time-scale. Without that separation the detector licenses the very fault it is watching for: the fault raises the measured noise, the raised noise widens the threshold, and the detector stays silent.

---

## Page Hinkley Tuning

The Page Hinkley test detects when a signal's mean has shifted. Two parameters control its behaviour:

- **`delta`** — subtracted from the cumulative sum on every sample. Acts as a noise allowance: small random deviations are absorbed; only sustained shifts accumulate.
- **`lambda`** — the cumulative sum must exceed this threshold to trigger a detection. Controls the tradeoff between speed and false alarm rate.

Three supporting knobs: `halfLife` selects how the baseline is learned, `minWarmUpSamples` holds detection off until the baseline has settled, and `detectDrop` flips the test to watch for downward shifts.

### Setting delta

`delta` determines the minimum shift magnitude the test can detect. The standard calibration:

| delta value | Detects shifts of | Character |
|-------------|-------------------|-----------|
| σ₀ / 2 | ≈ 1σ₀ | Sensitive — faster detection, more susceptible to noise |
| σ₀ | ≈ 2σ₀ | Balanced — filters baseline noise, catches real shifts |
| 2 × σ₀ | ≈ 4σ₀ | Conservative — only large shifts, slower detection |

**Recommendation:** Start at `delta ≈ σ₀`. This filters out normal fluctuations while remaining sensitive to genuine mean shifts. Only reduce to σ₀/2 if the signal is very clean and you need early detection; only increase if false alarms persist despite a well-chosen lambda.

### Setting lambda

`lambda` controls how much accumulated evidence is needed before firing. Higher values mean fewer false alarms but slower detection.

A useful rule of thumb:

| lambda | Character | Typical use |
|--------|-----------|-------------|
| 5 × σ₀ | Aggressive | Low-noise signals, fast response needed |
| 10 × σ₀ | Moderate | General purpose |
| 20 × σ₀ | Conservative | Noisy signals, false alarms are costly |

**How to verify:** Run the pipeline on the full baseline period. If the Page Hinkley test fires during baseline, lambda is too low. If it doesn't fire until well after the visible onset of degradation, lambda may be too high.

### Choosing the baseline type (halfLife)

By default the node's internal baseline is a running mean of everything it has seen. Omit `halfLife` when the healthy level is genuinely constant — the running mean is then the most stable reference.

Set `halfLife` (in samples) when the healthy level itself moves for legitimate reasons — a load-following current, a seasonal temperature. The baseline then tracks recent behaviour and the test flags shifts *relative to the recent level* rather than to an all-time average. Size it from the process: the baseline should follow changes the operation considers normal and should not follow changes at the speed a fault develops. If a fault ramps over ~50 samples, a halfLife of 500 keeps the baseline from absorbing it.

`minWarmUpSamples` (default 10) holds detection off while the baseline is still learning. Raise it for noisy signals — the default suits the clean-RMS case; a signal like kurtosis benefits from 20–30 samples before its mean is trustworthy.

### Worked example — bearing health

| Node | Signal σ₀ | delta (≈ σ₀) | lambda | lambda / σ₀ |
|------|-----------|-------------|--------|-------------|
| RMS PH | 0.00109 | 0.001 | 0.02 | 18× |
| Kurtosis PH | 0.0992 | 0.1 | 2.2 | 22× |

Kurtosis uses a slightly higher lambda/σ₀ ratio because kurtosis is inherently noisier (fat-tailed distribution during normal operation).

### After a detection

When the test statistic exceeds lambda, the node fires and resets its cumulative sum to zero. If the shift is sustained (ongoing degradation), the cumulative sum rapidly accumulates again and fires repeatedly. The count and frequency of firings is itself a severity signal — more frequent firings indicate a stronger sustained shift.

### Reading what fired

A detection says the mean moved. It does not say why — and the *time shape* of the signal after the firing carries that information for free. Pair the Page Hinkley node with `trend` on the same signal:

- **Firing, then `rocMean` returns to ~0 at a new flat level** — a step change. The signal jumped and is stable again. On instrumented plants a clean step right after maintenance usually means a configuration or instrument event (a re-scaled register, a swapped sensor), not gradual damage. Check the instrument before blaming the equipment.
- **Firing with `rocMean` sustained above `rocThreshold`** — a drift. The level is still moving. This is the degradation signature.
- **Repeated firings alternating in level** — the signal is jumping between discrete levels. That is a regime pattern, not a fault: go to [One baseline per regime](#one-baseline-per-regime).

---

## Trend Node Tuning

The trend node tracks the exponentially smoothed rate of change and classifies it as `stable`, `rising`, or `falling`. The key parameter:

- **`rocThreshold`** — the mean rate of change must exceed this value (in absolute terms) for the trend to be classified as rising or falling. Below this threshold, the trend is classified as stable.

### Setting rocThreshold

The raw rate-of-change noise (σᵣ) is not what the trend node sees. The node applies exponential smoothing, which reduces the effective noise by √n_eff. Here n_eff is the effective sample count — roughly, how many recent samples the smoothing averages over:

```
n_eff = ( 2 / α ) − 1
α = ln(2) / rocStatsHalfLife
```

The smoothed noise floor is:

```
σ_smoothed = σᵣ / √n_eff
```

Set `rocThreshold` above this smoothed noise floor to avoid false trend classifications:

| rocThreshold | Character |
|---------------|-----------|
| 1 × σ_smoothed | Sensitive — may flag noise as a trend |
| 2 × σ_smoothed | Balanced — filters smoothed noise |
| 3 × σ_smoothed | Conservative — only clear trends |

### Choosing rocStatsHalfLife

`rocStatsHalfLife` (default 9 samples) sets how much smoothing the rate gets, and the formula above shows the consequence: doubling it roughly halves the noise floor, letting `rocThreshold` sit lower and catch gentler trends. The price is response time — the smoothed rate needs on the order of a half-life to reflect a change that just started.

So the knob is bounded from both sides:

- **Long enough** that σ_smoothed sits clearly below the degradation rate you must catch. If the smoothed noise floor is above the fault's ramp rate, no threshold setting can work.
- **Short enough** that detection is timely: a trend is only classified after the smoothed rate crosses the threshold, which takes roughly one half-life from trend onset. A half-life of 12 samples at 10-minute cadence means ~2 hours of lag — fine for bearing wear, useless for a thermal runaway.

`warmupSamples` is derived from `rocStatsHalfLife` by default — raise it only if classifications during the first minutes after startup prove noisy. `speedUp` (default 2) only affects the optional `accelerationHint` output; leave it unless the hint chatters (raise toward 3) or never fires (lower toward 1.5).

### Worked example — RMS trend

```
σᵣ = 0.00135 (baseline RoC stdev)
rocStatsHalfLife = 12
α = ln(2) / 12 ≈ 0.058
n_eff = (2 / 0.058) − 1 ≈ 33.5
σ_smoothed = 0.00135 / √33.5 ≈ 0.00023
```

A `rocThreshold` of 0.0005 (≈ 2× smoothed noise) separates baseline fluctuation from genuine trends. The actual degradation rate during the bearing failure is ~0.0003/sample sustained — above the smoothed noise but below the raw noise, which is why smoothing and proper threshold calibration matter.

### Confidence interpretation

The trend node publishes a `confidence` value alongside direction. This confidence is **direction-agnostic** — it measures how certain the node is about its current classification, not how "bad" the situation is. A trend classified as "stable" with 80% confidence means "I'm 80% sure it's stable," not "there's an 80% chance of a trend."

This distinction matters when feeding trend outputs to downstream nodes. The confidence value alone is not suitable as a degradation severity signal (see [Choosing Signals for the Appraise Node](#choosing-signals-for-the-appraise-node) below).

---

## Kalman1d Calibration

The `kalman1d` node is where the split this guide keeps drawing — the instrument versus the world — becomes two explicit numbers:

- **`sensorVariance`** is a claim about the *instrument*: how much a reading scatters when the true quantity holds still.
- **`processVariance`** is a claim about the *world*: how much the true quantity can move between two samples, expressed as a ratio to the sensor variance.

The filter's entire behaviour follows from the ratio of the two, and its `innovation` output — the gap between what the model expected and what the sensor reported — is the per-sample audit of both claims. (For the smoothing-versus-lag intuition and the follow-mode decision, see [Tuning kalman1d](./nodes/intelligence.md#tuning-kalman1d) on the node's own page; this section covers where the numbers come from.)

### Measuring sensorVariance

Two independent routes — use both and compare:

1. **From the baseline.** Take the steadiest stretch of the baseline window — a period where the true quantity is as constant as the process ever holds it — and compute the variance there. That variance is an *upper bound* on the sensor noise, since any true movement inside the stretch is included. For the bearing RMS baseline: σ₀ = 0.00109, so `sensorVariance ≈ 1.2e-6`.
2. **From the datasheet.** If the instrument states an accuracy of ±e in the signal's units, treat e as a 2-sigma band: `sensorVariance ≈ (e / 2)²`.

If the two routes disagree badly — the measured scatter is many times the datasheet claim — that is a Step-0 finding about the installation (electrical noise, loose coupling, wrong range), not a tuning input. Fix it before filtering around it.

### Choosing processVariance

`processVariance` is the Q/R ratio: how far the true state plausibly moves in one sample interval, squared, relative to the sensor variance. It is plant physics at the actual cadence — a furnace temperature moves very little in a second and a lot in ten minutes, so the right value changes when the cadence does, even though the furnace didn't. Start at the node default (0.01) and adjust by the verification below, not by eye.

### chi2Threshold is a law

The `innovationGate` output is a chi-squared statistic, so its threshold is a table lookup, not a tuning knob: 3.84 flags the 5% most surprising samples on a healthy signal, 6.63 the 1%, 10.83 the 0.1%. Choosing a row *is* choosing a false-alarm rate. If the gate fires far more often than its table rate on healthy data, the fix is never to raise the threshold — it is to revisit `sensorVariance` or `processVariance`, because one of the two claims is wrong.

### Verifying the calibration

Run the baseline window through the filter and check two things:

- **`innovation` mean ≈ 0** (track it with `esStats`). A drifting innovation mean says the model is biased — usually `processVariance` too low for a moving process.
- **`innovationGate` exceeds the threshold at ≈ its table rate** — about 1 sample in 100 at 6.63. Much more frequent: `sensorVariance` is understated. Much rarer: overstated, and real anomalies will be absorbed too.

In production, a *persistently* firing gate is an integrity signal before it is an equipment signal: either the sensor's behaviour changed (noise, dropouts, re-scaling) or the model no longer describes the process. Route it to the same place as the Step-0 checks, not straight to an equipment alarm.

---

## Appraise Node Calibration

The appraise node accumulates evidence from multiple sources into a single health assessment. Its accumulator is a bounded leaky integrator — it adds evidence as it arrives, lets old evidence fade at a fixed rate, and never exceeds 1. Each source must be carefully configured: the wrong deviation type or threshold can cause the integrator to saturate on baseline noise — producing false assessments with no actual anomaly.

### How the integrator works

For each source on each message:

1. **Read** the raw field value from the message
2. **Deviate** — apply a deviation function to extract a non-negative "badness" value
3. **Normalise** — squash the deviation into [0, 1) with a saturating curve: `n = d / (d + θ)`. Small deviations map almost linearly; large ones level off toward 1. θ is the half-saturation point — the deviation at which n = 0.5. (The curve is the Michaelis-Menten function.)
4. **Integrate** — decay existing charge, inject normalised value into headroom: `charge = decayed + n × (1 − decayed)`

The charge for each source is bounded in [0, 1]. Charges are then combined via weighted average and classified against thresholds.

### The accumulation problem

The integrator accumulates continuously. With typical streaming data (samples every few seconds to minutes) and a halfLife of hours, the inter-sample decay factor is very close to 1 (e.g., `exp(−0.167/34.6) ≈ 0.995` for 10-minute samples with a 24-hour halfLife). This means **even small injections compound into large charges.**

At steady state with constant normalised injection `n` and decay factor `d`:

```
steady-state charge = n / ( 1 − d × (1 − n) )
```

Example: `n = 0.1, d = 0.995` → steady-state charge = **0.95**

A normalised injection of just 0.1 (from a minor baseline fluctuation) produces a near-saturated charge. This is why every source must produce **exactly zero injection during normal operation.** Any non-zero baseline leaks into a false charge.

### The node-level knobs

| Knob | What it is | How to set it |
|---|---|---|
| `halfLife` | How fast per-source evidence fades | The process question: how long after evidence stops should the assessment stay elevated? Hours of memory for slow degradation, minutes for fast processes. Each source may override it with its own `halfLife` |
| `l2HalfLife` | How fast the combined decision level fades | Defaults to the slowest source; set longer only when the verdict should outlast the individual evidence |
| `messageRate` | Messages per timestamp unit | A fact about the feed, not a choice. Decay runs on message timestamps, so `halfLife` and `l2HalfLife` share the timestamp's unit (milliseconds for standard composer timestamps) — state `messageRate` in the same unit (one message per minute = 1/60000 per millisecond) |
| `thresholds` | The `monitor` / `degraded` / `critical` boundaries and actions | Policy knobs: which conviction level warrants which response. Ordered `monitor.at < degraded.at < critical.at`. Never adjusted to make a particular dataset produce a satisfying alarm |

### Burn-in calibrates the readout — keep it clean

For its first stretch of messages the node runs a burn-in (the `calibrating` output is `true`). During burn-in it watches its own baseline activity and sets the internal readout constant so that normal-operation conviction lands at one third of the `monitor` threshold — close enough to respond quickly, far enough not to false-trigger. Burn-in ends after five decision-level time constants: roughly `7.2 × l2HalfLife`, converted to a message count through `messageRate`.

Two hard consequences:

- **Burn-in must see normal operation.** Starting the flow on an already-degraded machine bakes the degradation into "normal", and every later verdict is measured against a sick reference. Timing matters here: while `calibrating` is still `true`, a control-plane `reset` restarts the burn-in count. Once burn-in has completed, the learned constant is deliberately preserved across resets — the only remedy is restarting the flow when healthy data is flowing.
- **Sources must be quiet during burn-in.** Charge injected while calibrating raises the observed baseline, the readout constant is derived too high, and the node under-reports genuine evidence from then on. Upstream warm-ups (`minWarmUpSamples`, `warmupSamples`) must complete *before* appraise starts integrating — and `messageRate` must be honest, because a wrong value silently shortens or stretches the burn-in itself.

### Deviation type selection

The deviation function converts a raw signal value into a non-negative "badness" measure. Choosing the right type is critical — it determines whether baseline values produce zero injection.

| Type | Formula | Use when |
|------|---------|----------|
| `identity` | `max(raw, 0)` | Signal is already a non-negative badness metric with zero baseline |
| `absolute` | `\|raw\|` | Both positive and negative deviations are bad |
| `highExceedance` | `max(raw − baseline, 0)` | Only values above a threshold are bad |
| `lowExceedance` | `max(baseline − raw, 0)` | Only values below a threshold are bad |
| `bandExceedance` | distance outside [lower, upper] | Normal is a range; either direction is bad |

**The key rule:** The deviation function must return zero for all values observed during normal operation. If any normal-operation value produces a non-zero deviation, the integrator will accumulate a false charge.

### Setting baseline

The `baseline` parameter (for exceedance types) determines the boundary between "normal" and "evidence." It should be set at the **upstream node's decision boundary** — the value at which the upstream node itself considers the signal noteworthy.

| Source type | baseline = | Rationale |
|-------------|------------|-----------|
| Page Hinkley test statistic | PH node's `lambda` | Below lambda, the PH test hasn't fired — no shift detected |
| Trend rate of change | Trend node's `rocThreshold` | Below threshold, the trend node classifies "stable" |
| SNR (dB) | Normal-operation SNR | Above this value, signal quality is acceptable |

This creates a **consistent decision boundary**: the upstream node and the appraise source agree on what constitutes evidence. The appraise node doesn't second-guess the upstream node's calibration — it only accumulates evidence from signals that the upstream node itself would consider meaningful.

### Setting theta

`theta` is the half-saturation constant from step 3 above — the deviation value at which the normalised output equals 0.5. It controls how responsive the integrator is to exceedances.

**The key question:** What is the typical exceedance magnitude when the source is active?

| Source | Typical exceedance | Why |
|--------|-------------------|-----|
| PH test statistic (after firing) | Small (0.1–0.5) | PH resets cumSum to 0 after firing; overshoot above lambda is typically one sample's worth of drift |
| Trend rate of change | Signal-dependent | Difference between the actual rate and the threshold |
| SNR decline | 5–15 dB | Signal quality drops from ~30 dB to 15–20 dB during degradation |

**Set theta to the exceedance magnitude that represents "moderate evidence."** At that magnitude, the normalised injection will be 0.5 — meaningful but not saturating. Larger exceedances produce diminishing returns (the curve levels off), which is the desired behaviour: the integrator responds to presence of evidence, not unbounded magnitude.

**Common mistakes:**

- **theta too large** (e.g., theta = lambda for a PH source): normalised injection is tiny even when the source is active. The charge barely accumulates despite repeated firings. The source effectively contributes nothing.
- **theta too small**: even minor exceedances produce near-1.0 injections, saturating the charge immediately. The source becomes binary (on/off) with no gradation.

### Worked example — bearing health sources

| Source | Field | Deviation | baseline | theta | Weight | Rationale |
|--------|-------|-----------|----------|-------|--------|-----------|
| RMS level shift | `phStat` | highExceedance | 0.02 (= lambda) | 0.5 | 1.0 | PH fires at lambda; typical overshoot ~0.1–0.5 |
| Kurtosis level shift | `kurtPhStat` | highExceedance | 2.2 (= lambda) | 0.5 | 1.0 | Same logic, different PH node |
| RMS trend | `rmsMeanRoC` | highExceedance | 0.0001 (≈ rocThreshold) | 0.0003 | 1.0 | Only rising rates above the noise floor; half-saturation at degradation-onset rate |
| Signal quality | `esSnrDB` | lowExceedance | 27.5 (normal SNR) | 5 | 0.3 | SNR drops during degradation; half-saturation at 5 dB decline |

---

## Choosing Signals for the Appraise Node

Not every published field is a good appraise source. The integrator has specific requirements that disqualify many natural-seeming choices.

### What makes a good source

A field is suitable for the leaky integrator when it has these properties:

1. **Zero during baseline** — The deviation function must produce exactly 0 for all values observed during normal operation. Even tiny non-zero values accumulate into false charges.
2. **Monotonically increasing with severity** — The signal should grow as the condition worsens, without reversals. Non-monotonic signals produce confusing charge dynamics.
3. **Cumulative, not per-sample** — The signal should reflect a sustained condition, not a single-sample event. Per-sample spike detectors produce recurring pulses that the integrator amplifies.
4. **Stable warmup** — The signal should not produce large transient values during the first few samples while the upstream node is learning its baseline.

### Signals to avoid

**Direction-agnostic confidence.** The trend node's `confidence` value measures certainty in the current classification — it can be 80% during "stable" (meaning "I'm sure it's stable"). Using confidence directly as a severity signal causes the integrator to accumulate charge during normal, stable operation. Use the rate of change (`rocMean`) instead — it's near-zero when stable and grows when a trend emerges.

**Per-sample breakout scores.** The `envScore` from esStats measures how far the current sample is from the envelope midpoint, computed before the envelope updates. During normal operation, every time a sample sets a new local high, envScore briefly exceeds 1 before the envelope snaps up to include it. These frequent small spikes are by design (the score detects breakouts), but the leaky integrator accumulates them into a sustained false charge. Use cumulative measures like `stdev` or `snrDB` instead.

**Non-monotonic indicators.** Crest factor (peak / RMS) rises during early bearing fault development as impulsive events create high peaks. But as the fault progresses, overall RMS rises — lifting the noise floor — and the peak-to-RMS ratio actually drops. This non-monotonic behaviour means crest factor can decrease during worsening degradation, which confuses the integrator. Crest factor is useful for snapshot-based assessment (like a fuzzy inference system that evaluates the current value), but not for a temporal integrator that accumulates evidence over time.

### Signals that work well

| Signal | Why it works | Deviation type |
|--------|-------------|----------------|
| PH test statistic (`phTestStatistic`) | Always ≥ 0, zero at reset, grows only when a shift accumulates. Baseline fluctuations stay below lambda. | `highExceedance` with baseline = lambda |
| EWM rate of change (`rocMean`) | Near-zero during stable operation, grows monotonically during sustained trends. EWM smoothing provides implicit noise rejection. | `highExceedance` with baseline = rocThreshold |
| SNR in dB (`snrDB`) | Stable during normal operation (~30 dB), drops monotonically as the signal becomes erratic during degradation. A late-stage corroborator. | `lowExceedance` with baseline = normal-operation SNR |
| Standard deviation (`stdev`) | Stable during normal operation, grows monotonically as the signal becomes more variable. | `highExceedance` with baseline = normal-operation stdev |
| Kalman innovation gate (`innovationGate`) | Chi-squared statistic: near zero when the model holds, grows with sustained surprise. | `highExceedance` with baseline = the chi-squared threshold (e.g. 3.84) |

---

## Confirmation Knobs — Votes Before Verdicts

Real telemetry is usually interval-averaged: the message carries the mean of the last minute or fifteen, not an instantaneous reading. Relations that hold exactly at every instant — a cross-check identity, a threshold on a derived quantity — do *not* hold exactly between averages, because the signals swing inside the interval. The result: on a perfectly healthy instrument, single-tick excursions are normal.

The wrong response is loosening the tolerance until single ticks stop firing — that deafens the check to real faults too. The right response is confirmation: keep the tolerance tight and require the excursion to persist.

- **`persistenceCheck`** (`minVotes` of `outOfTotal`): the condition must hold on at least `minVotes` of the last `outOfTotal` messages. Sizing is a straight trade: `minVotes × sample interval` is the detection delay you accept in exchange for immunity to `minVotes − 1` consecutive artifacts. A 4-of-4 vote at 15-minute cadence means a confirmed finding is at least an hour old — and no single averaging artifact can fire it.
- **`stateChangeDetector`** (`debounce`): the same idea for categorical states — the new state must persist `debounce` consecutive samples before the transition is confirmed, so a one-tick flap never counts as a mode change.

### Warm-up knobs

The mirror image of confirmation: never let a downstream node consume a statistic before it exists. `pageHinkley.minWarmUpSamples`, `trend.warmupSamples`, and `esCorrelation.minSamples` all hold their outputs back while the underlying estimate settles; the appraise burn-in ([above](#burn-in-calibrates-the-readout--keep-it-clean)) is the same discipline at the assessment level. When chaining, make sure the warm-ups complete in order: a trend that starts classifying before its rate statistics settle feeds garbage forward with full confidence.

---

## Gate Knobs Sized by Noise

Two knobs guard decision boundaries against noise, and both are sized directly from the baseline table.

**`threshold` → `hysteresis`.** A signal hovering at a boundary recrosses it on every noise wiggle, toggling the output and re-firing edge triggers. The deadband must be wider than the noise: at least 2× the standard deviation of the signal *at the boundary* — σ₀ for a raw signal, σ_smoothed if the input was smoothed upstream. For the bearing RMS signal (σ₀ = 0.00109), `hysteresis: 0.0022` makes chatter statistically negligible while costing almost nothing in release lag. The `threshold` value itself is usually a Knob (a spec or policy boundary); the hysteresis around it is Learned.

**`spikeGuard` → `threshold`.** A spike must differ from *both* neighbours by more than the threshold, so the knob answers: what is the largest one-sample move the real process can make? Two anchors, in order of preference:

1. **Physics.** If the quantity has a slew limit (a massive furnace cannot cool 50 degrees in one second), any one-sample step beyond it is an artifact by definition. This anchor needs no baseline at all.
2. **Baseline rate noise.** Without a physics bound, use σᵣ from the characterisation table: a threshold of ≥ 5 × σᵣ makes normal sample-to-sample motion effectively invisible to the detector. For the bearing RMS signal (σᵣ = 0.00135), `threshold: 0.007`.

Check the other side too: the threshold must sit *below* the smallest genuine spike that matters downstream, or the guard cleans away the evidence.

---

## Calibration Checklist

Before deploying a pipeline, verify each detection and assessment node against the baseline:

- [ ] **Step-0 audit passed on the baseline window** — no frozen runs, no counter resets, cross-check residuals flat at 1
- [ ] **Sanitize ranges are units gates** — bounds mean "physically possible", not "healthy"; known sentinels handled via `valueList`
- [ ] **Baseline period selected** — known-healthy, no transients, no degradation
- [ ] **Baseline window long enough** — split-half σ₀ estimates agree within ~10%
- [ ] **Per-signal μ₀ and σ₀ computed** — for every raw signal and its rate of change; per regime where regimes exist
- [ ] **Every constant classified** — Law (cited), Knob (looked up), or Learned (derived here); nothing fitted to the studied data
- [ ] **Deploy-tomorrow test passes** — a new asset needs only a config change, not a re-fit
- [ ] **PH delta ≈ σ₀** — filters baseline noise without masking real shifts
- [ ] **PH lambda verified** — no false alarms during the full baseline period
- [ ] **Trend rocThreshold > σ_smoothed** — above the smoothed noise floor, with `rocStatsHalfLife` fast enough for the failure mode
- [ ] **Kalman innovation verified on baseline** — innovation mean ≈ 0; gate rate ≈ the chi-squared table rate; chi2Threshold untouched
- [ ] **Statistical constants untouched** — chi-squared gates and capability thresholds at their cited values, not tuned
- [ ] **Adaptive tunables separated in time** — any live statistic feeding a threshold has a half-life ≥ 10× the detection time-scale
- [ ] **Appraise burn-in clean** — baseline data flowing, upstream warm-ups complete before integration starts, `messageRate` matches the true cadence
- [ ] **Appraise sources produce zero charge during baseline** — run the pipeline on baseline data and confirm all charges remain at 0 (or below the negligible threshold of 0.01)
- [ ] **Appraise baselines match upstream thresholds** — PH baseline = lambda, trend baseline = rocThreshold
- [ ] **Appraise theta calibrated to typical exceedance magnitude** — not too large (no response) or too small (instant saturation)
- [ ] **No non-monotonic signals feeding the integrator** — crest factor, envScore, and direction-agnostic confidence excluded
- [ ] **Confirmation votes sized consciously** — `minVotes × cadence` is a delay someone accepted on purpose
