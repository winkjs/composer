# Wink Composer

### [![Stability](https://img.shields.io/badge/stability-1--experimental-orange.svg)](https://nodejs.org/api/documentation.html#documentation_stability_index)

## Composable Streaming Intelligence

A sensor spikes. An engine runs hot. A building's energy use surges. A customer clicks away. A shipment stalls.

Wink Composer helps you turn live streams into clear, actionable insights—by composing small, focused building blocks into pipelines.

### What you get
- **Composable building blocks** — build exactly the workflow you need
- **An expressive `flow` language** – focused on "what you want"
- **Edge to cloud** — same code across deployments

### Ask → Answer → Act
Composer surfaces AI-ready insights via **MCP Server** and **Semantics**—anomalies, patterns, statistical digests—giving AI the context it needs for root cause, next steps, and prescriptions.

![Ask Answer Act](https://composer.winkjs.org/readme-ask-answer-act.png)

> You ask a question. AI answers using Composer's **live insights** and **stored history**. No cross-team handoffs. No delays.


## Hello, Flow

Here is a sketch of the “Answer” pipeline for this pump—11 declarative steps: validate sensors, clean spikes, detect wash cycles, compute statistics, and persist insights.


```javascript
await flow( 'pumpHealth' )
  .source( mqtt, { brokerUrl: 'mqtt://localhost:1883', topic: 'pumps/+/+' } )
  .storage( questdb, { ilpUrl: 'localhost:9000', pgUrl: 'localhost:8812' } )
  .assetId( 'sensorId' )

  .sanitize( 'validate', 'pressure', { ranges: GAUGE_LIMITS } )           // 1. Validate
  .spikeGuard( 'despike', 'pressure', { threshold: 30 } )                 // 2. Clean spikes
  .threshold( 'detectWash', 'pressure_clean', { threshold: 45 } )         // 3. Detect cycle
  .dwellTimeTracker( 'washTimer', msg => msg.is_washing )                 // 4. Track duration
  .controller( 'flushOnEnd', [ { when: msg => msg.wash_dur,               // 5. Orchestrate
      triggers: [ { control: 'flush', targets: [ 'stats' ] } ] } ] )
  .momentsDigest( 'stats', 'pressure_clean', { windowSize: 100 } )        // 6. Collect stats
  .momentsDigest( 'cascade', 'pressure_clean', { cascade: true } )        // 7. 100×100 window

  .digestMoments( 'compute', 'pressure_clean' )                           // 8. Moments → stats
  .invertFlag( 'wasWashing', 'is_washing' )                               // 9. Normalize
  .persistIf( 'storeStats', msg => msg.mean, { insightType: 'stats' } )   // 10. → QuestDB
  .persistIf( 'storeGlitch', msg => msg.spike, { insightType: 'glitch' }) // 11. → QuestDB

  .run();
```


## Features
### Agentic RAG for Streaming Intelligence
- **Retrieval over insights, not raw data** — AI queries insights already discovered by Composer, not firehose streams.
- **Clear separation of concerns** — Composer computes. You define domain semantics. The LLM reasons.

### Core Capabilities

- **Layered flows** — Scale from single pipeline to fleet-wide analytics. Same flow(), same nodes, new scope.
- **Adaptive pipelines** — Analyze only when needed. Reset baselines on mode changes.
- **Isolated state** — Each sensor, user, or session runs independently. Failures don't cascade.
- **Production-ready** — Offline queuing, circuit breakers, auto-recovery.
- **Context-aware thresholds** — Parameters adapt to real-time context.
- **Semantics** — Give data meaning. Define once as Single Source of Truth (SSOT). For example, raw `42` becomes 42°C with limits.

### Building blocks across 6 categories

| Category                | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| **Signal Conditioning** | Smoothing, filtering, noise removal           |
| **Feature Extraction**  | Statistics, correlations, trends              |
| **Detection**           | Thresholds, change points, persistence checks |
| **Flow Control**        | Filtering, routing, orchestration             |
| **Emission**            | MQTT publishing, conditional alerts           |
| **Data Quality**        | Validation, range checking                    |

### Typical applications

- **Industrial IoT** — Predictive maintenance, quality control
- **Vehicle Telematics** — Fleet analytics, diagnostics
- **E-commerce** — Clickstream insights, session analysis
- **Smart Infrastructure** — Energy optimization, occupancy patterns, *and more*

### Performance

Throughput depends on pipeline complexity and hardware. The numbers with an 8-node change point detection flow are:

| Configuration        | Throughput     |
| -------------------- | -------------- |
| Raspberry Pi 5       | ~100K messages/second |
| Modern server        | >1M messages/second |
| Tracking 200K assets | ~300K messages/second |

Results vary with message size, flow complexity, and the number of assets being tracked.


## Project Status

Active development. Hope to unveil it in **Q1 2026**.

| **Stable**                                  | **In Progress**       | **Planned**                          |
|--------------------------------------------|------------------------|--------------------------------------|
| Core `Flow` language and runtime           | **MCP Server**         | Kafka integration                    |
| Analytical building blocks (called **nodes**) | **QuestDB storage**    | Authentication and access control    |
| CSV/MQTT input, MQTT output                |                        |                                      |


### Get Involved
Help shape the future of composable streaming intelligence:
- **Discussions:** [github.com/winkjs/composer/discussions](https://github.com/winkjs/composer/discussions)
- **Contact:** wink@graype.in


## About winkJS

Wink Composer joins the [winkJS](https://winkjs.org) family—production-grade open-source packages for NLP, ML, and statistics in JavaScript.
