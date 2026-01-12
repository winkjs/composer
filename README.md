# wink-composer

### [![Stability](https://img.shields.io/badge/stability-1--experimental-orange.svg)](https://nodejs.org/api/documentation.html#documentation_stability_index) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## ✨ Streaming intelligence, playfully simple.

[<img align="right" src="https://decisively.github.io/wink-logos/logo-title.png" width="100px" >](http://winkjs.org/)

A sensor spikes. An engine runs hot. A building's energy use surges. A customer clicks away. A shipment stalls. A forecast shifts. Your streaming data has a story to tell—uncovering it has always been the hard part.

**WinkComposer** reveals it—effortlessly. Small, focused nodes chain into powerful pipelines. An **expressive `flow` API** that mirrors your intent. **Monitor 200K sensors on a single CPU core**. **Same code from edge to cloud**.

## Hello, Flow
Smooth noisy data. Detect threshold breaches. Confirm they persist. Broadcast alerts:

```javascript
await flow( 'temperature-monitor' )                               // Name the flow
    .assetId( 'sensorId' )                                        // Isolate per asset
    .source( csv, { path: './sensor-data.csv' } )                 // Dev/debug data source
    .emitter( mqtt, { brokerUrl: 'mqtt://localhost:1883' } )      // Define alert channel
    .esMean( 'smooth', 'temperature',
        { mean: 'smoothTemp' }, { halfLife: 5 } )                 // Smoothen data
    .threshold( 'alert', 'smoothTemp', { active: 'overheating' }, // Detect overheating
        { mode: 'above', threshold: 80, hysteresis: 2 } )         // Avoid flapping
    .persistenceCheck( 'confirm', ( msg ) => msg.overheating,     // Avoid false alarms
        { persistenceConfirmed: 'alertConfirmed' }, { minVotes: 2, outOfTotal: 3 } ) 
    .emitIf( 'broadcast', ( msg ) => msg.alertConfirmed,          // Send alert
        { target: 'mqtt', signalType: 'temperatureAlert' } ) 
    .run();                                                       // Start the flow
```

### Layered Flows
Hello, Flow is one layer. That's enough for smaller setups. When the fleet grows, add another layer:

**Layer 1: upstream flows**
- One flow per asset class—a production line, a vehicle model, a building zone.
- Partitioned by assetId. Each asset runs in isolation.
- Emits events, anomalies, and digests.

**Layer 2: aggregator flow**
- One flow for the full fleet.
- Listens to all upstream flows.
- Builds trends and fleet-wide views.
- Persists to a time-series database: **QuestDB**.

Same flow(). Same nodes. New scope. Rarely, add more layers.


## Why Composability
**Build exactly what you need.**<br/>
Most platforms give you fixed features—often as black boxes. WinkComposer gives you building blocks. You compose only what your use case demands.

**Evolve as you go.**<br/>
Start simple: sensor → threshold → alert. Add smoothing when there’s noise. Add persistence to cut false positives. Pipelines grow with your understanding.

**Know what’s happening.**<br/>
Each node does one job. Every decision is visible. When an alert fires, you know exactly where—and why—it happened.

**Unlock possibilities.**<br/>
Focused nodes combine like musical notes. Simple patterns build into powerful, custom intelligence.

## Built to Stay Clear

No drag-and-drop spaghetti. WinkComposer uses clean, linear flows with control signals for orchestration. This keeps pipelines understandable, maintainable, and production-safe—even as they grow.

## Works Everywhere

**Process any streaming data—same codebase, edge to cloud**:

- Industrial IoT — Predictive maintenance, quality control, process monitoring
- Vehicle Telematics — Driver behavior, fleet analytics, diagnostics
- E-commerce — Clickstream insights, real-time personalization, session analysis
- Network Operations — Anomaly detection, QoS monitoring, capacity planning
- Financial Services — Fraud detection, transaction monitoring, audit trails
- Smart Infrastructure — Energy optimization, predictive operations, occupancy patterns

## Features

### 30+ nodes across 6 categories

| Category | Purpose |
|----------|---------|
| **Signal Conditioning** | Smoothing, filtering, noise removal |
| **Feature Extraction** | Statistics, correlations, trends |
| **Detection** | Thresholds, change points, persistence checks |
| **Flow Control** | Filtering, routing, orchestration |
| **Emission** | MQTT publishing, conditional alerts |
| **Data Quality** | Validation, range checking |

### Core Capabilities

- **Layered flows** — Scale from single pipeline to fleet-wide analytics. Same flow(), same nodes, new scope.
- **Adaptive pipelines** — Analyze only when needed. Reset baselines on mode changes.
- **Isolated state** — Each sensor, user, or session runs independently. Failures don't cascade.
- **Production-ready** — Offline queuing, circuit breakers, auto-recovery.
- **Context-aware thresholds** — Parameters adapt to real-time context.
- **Semantics** — Give data meaning. Define once as Single Source of Truth (SSOT). For example, raw `42` becomes 42°C with limits.

### Performance

Benchmarked with an 8-node change-point detection pipeline (single-threaded, Node.js):

| Configuration | Throughput |
|---------------|------------|
| Raspberry Pi 5 | ~100K msgs/sec |
| Modern server | >1M msgs/sec |
| Modern server, 200K unique sensors | 300K msgs/sec |

Scales horizontally across processes or hosts.

## Project Status

WinkComposer is in active development. Open source transition planned for **Q1 2026**.

### Stable

- Core DSL and runtime
- 30+ analytical nodes
- CSV input, MQTT output
- Tested from Raspberry Pi to cloud

### In Progress
- MCP Server — Chat with your streaming data. Trace anomalies. Discover root causes in near real time. Get actionable insights.
- QuestDB storage — Fast ingest, SQL queries, and history for dashboards and MCP. Export to Parquet for downstream analytics.
- Real-time dashboard framework

### Planned

- Kafka integration
- Authentication and access control
- Knowledge graph integration

## Get Involved

Help shape the future of composable streaming intelligence:

- **Discussions:** [github.com/winkjs/wink-composer/discussions](https://github.com/winkjs/wink-composer/discussions)
- **Contact:** wink@graype.in

## About winkJS

WinkComposer joins the winkJS family — production-grade open-source packages for NLP, ML, and statistics in JavaScript.

## License

**Wink Composer** is copyright 2017-25 [GRAYPE Systems Private Limited](https://graype.in/).

Licensed under the MIT License.
