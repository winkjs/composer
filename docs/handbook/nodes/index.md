# Node Catalog

Nodes are classified two ways:
- **By purpose** (the category headings) — what problem the node solves
- **By processing type** — how it handles input fields

For example, `threshold` is "Detection" by purpose and "Per-field" by processing type. See [Node Processing Types](../flow-language.md#node-processing-types) for details on each type.

## Quick Reference

Each node is listed under its primary purpose.
Nodes that also serve a secondary purpose are tagged **`#Category`**.

### Arithmetic

| Node | What It Does |
|------|-------------|
| [accumulate](./arithmetic.md#accumulate) | Running total (cumulative sum) |
| [diff](./arithmetic.md#diff) | Difference between two fields |
| [invertFlag](./arithmetic.md#invertflag) | Boolean inversion (true ↔ false) |
| [ratio](./arithmetic.md#ratio) | Ratio between two fields |
| [transform](./arithmetic.md#transform) | Apply a pure function to each sample |

### Detection

| Node | What It Does |
|------|-------------|
| [pageHinkley](./detection.md#pagehinkley) | Change-point detection (distributional shift) |
| [persistenceCheck](./detection.md#persistencecheck) | m-of-n voting confirmation |
| [processIndex](./detection.md#processindex) | Process capability index (Cp/Cpk) from mean + stdev fields<br/>**`#FeatureExtraction`** |
| [threshold](./detection.md#threshold) | Above/below/in-range with optional hysteresis |
| [winnow](./detection.md#winnow) | Trajectory-aware significance detector for compression and edge gating |

### Feature Extraction

| Node | What It Does |
|------|-------------|
| [digestMoments](./feature-extraction.md#digestmoments) | Reconstructs displayable statistics from a moments digest |
| [dwellTimeTracker](./feature-extraction.md#dwelltimetracker) | Time-in-state + edge detection at state transitions<br/>**`#Detection`** |
| [esCorrelation](./feature-extraction.md#escorrelation) | Exponentially weighted correlation between two fields |
| [esPairwiseCorrelation](./feature-extraction.md#espairwisecorrelation) | All pairwise correlations across a field group |
| [swingWatch](./feature-extraction.md#swingwatch) | Reports each completed swing — dip or peak — with its size<br/>**`#Detection`** |
| [lag](./feature-extraction.md#lag) | Historical comparison: delta, ratio, roc, slope, logReturn, cumDelta, xLag |
| [momentsDigest](./feature-extraction.md#momentsdigest) | Compact statistical digest for cross-flow transfer |
| [stateChangeDetector](./feature-extraction.md#statechangedetector) | Debounced state-change detection with dwell time<br/>**`#Detection`** |
| [tally](./feature-extraction.md#tally) | Logical reduce over N flag fields — any / all / count |
| [trend](./feature-extraction.md#trend) | Rising/falling/stable classification with confidence<br/>**`#Detection`** |
| [unbalance](./feature-extraction.md#unbalance) | Spread across N fields that should read alike (NEMA percent unbalance) |
| [vectorDistance](./feature-extraction.md#vectordistance) | Distance between two fields (RMS, cosine, angular, MAD) |

### Flow Control

| Node | What It Does |
|------|-------------|
| [passIf](./flow-control.md#passif) | Passes or drops messages based on a condition |

### Intelligence

| Node | What It Does |
|------|-------------|
| [appraise](./intelligence.md#appraise) | Fuse evidence from multiple signals into a conviction score<br/>**`#Detection`** |
| [kalman1d](./intelligence.md#kalman1d) | Model-based state estimation with outlier detection<br/>**`#SignalConditioning`** |

### Observability

| Node | What It Does |
|------|-------------|
| [emitIf](./observability.md#emitif) | Broadcasts a message copy to an external system on condition |
| [persistIf](./observability.md#persistif) | Writes message to storage on condition |

### Orchestration

| Node | What It Does |
|------|-------------|
| [controller](./orchestration.md#controller) | Enables/disables other nodes based on conditions |

### Signal Conditioning

| Node | What It Does |
|------|-------------|
| [butterworthFilter](./signal-conditioning.md#butterworthfilter) | 2nd-order low-pass filtered value |
| [categorize](./signal-conditioning.md#categorize) | Maps numeric values to semantic categories<br/>**`#FeatureExtraction`** |
| [esMean](./signal-conditioning.md#esmean) | Exponentially smoothed mean |
| [esStats](./signal-conditioning.md#esstats) | Mean, stdev, zScore, cv, envelope, snrDB, and more<br/>**`#FeatureExtraction`** |
| [kernel](./signal-conditioning.md#kernel) | Convolved output — smoothing, derivatives, edge detection<br/>**`#FeatureExtraction`** **`#Detection`** |
| [median3](./signal-conditioning.md#median3) | 3-sample median filter for spike removal |
| [sanitize](./signal-conditioning.md#sanitize) | Validates and cleans bad values; reports failure reason + original value<br/>**`#Detection`** |
| [spikeGuard](./signal-conditioning.md#spikeguard) | Cleaned value; spike detection flag + signed magnitude<br/>**`#Detection`** |
| [swStats](./signal-conditioning.md#swstats) | Sliding-window mean, stdev, skewness, kurtosis, rms |
| [twStats](./signal-conditioning.md#twstats) | Tumbling-window n, mean, variance, stdev, cv, skew, kurtosis, min, max, rms, crestFactor<br/>**`#FeatureExtraction`** |

### Configuration

Configuration methods are called before any processing nodes. They fall into five groups.

#### Data I/O

| Method | What It Does |
|--------|-------------|
| [source](./configuration.md#source) | Connects a data source adapter (CSV, MQTT) |
| [emitter](./configuration.md#emitter) | Registers an output adapter (MQTT, Terminal) |
| [storage](./configuration.md#storage) | Registers a persistence adapter (QuestDB) |

#### Identity

| Method | What It Does |
|--------|-------------|
| [assetClass](./configuration.md#assetclass) | Semantics definition for storage schema |
| [assetId](./configuration.md#assetid) | Per-asset pipeline isolation |

#### Specialization

| Method | What It Does |
|--------|-------------|
| [switch, case, break](./configuration.md#switch-case-break) | Routes messages to different pipelines by field value |
| [groupBy, endGroup](./configuration.md#groupby-endgroup) | Templated specialization with per-group tuning |

#### Lifecycle

| Method | What It Does |
|--------|-------------|
| [build](./configuration.md#build) | Compiles flow to executable source |
| [run](./configuration.md#run) | Wires and starts the pipeline |
| [validate](./configuration.md#validate) | Validates flow definition and cross-references |
| [inspect](./configuration.md#inspect) | Introspects flow structure |
| [yield](./configuration.md#yield) | Cooperative event-loop yielding threshold |
