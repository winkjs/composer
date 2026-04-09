# winkComposer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Status](https://img.shields.io/badge/status-transitioning%20to%20open%20source-blue.svg)](https://github.com/winkjs/composer)

## Composable Streaming Intelligence
[<img align="right" src="https://decisively.github.io/wink-logos/logo-title.png" width="100px" >](https://winkjs.org/)

A sensor spikes. An engine runs hot. A building's energy use surges. A server degrades. A cold chain breaks.

winkComposer turns live data streams into clear, actionable insights by composing small, focused building blocks — signal conditioning, anomaly detection, and health assessment — into pipelines underpinned by neural-network intelligence.

A high-performance JavaScript framework for IIoT and beyond. Runs on a Raspberry Pi or a production server or k8 cluster on cloud. Purpose-built for SMBs and MSMEs. Integrates with QuestDB, Grafana, and Mosquitto — open source, end to end.

winkComposer calls its building blocks nodes — each with a single responsibility, wired through a declarative flow language. Its flow language is a fluent, chainable
JavaScript DSL. Small vocabulary, unbounded composition — the same nodes that detect bearing wear also catch server latency degradation and process yield drift.

> [!NOTE]
> The [documentation site](https://composer.winkjs.org) is live and growing — interactive demos run real winkComposer nodes in your browser, no installation or sign-up required. winkComposer is transitioning to open source; the repository and full source will follow as development progresses. MCP integration for AI-driven queries over pre-computed insights is in active development.


## Explore Possibilities

Real data. Real insight. Each demo runs the same winkComposer core that powers edge-to-cloud deployments — right here in your browser.

| [![Bearing Health](https://composer.winkjs.org/readme-bearing-health.png)](https://composer.winkjs.org/docs/use-cases/bearing-health) | [![Server Health](https://composer.winkjs.org/readme-server-health.png)](https://composer.winkjs.org/docs/use-cases/server-health) | [![Process Quality](https://composer.winkjs.org/readme-process-quality.png)](https://composer.winkjs.org/docs/use-cases/process-quality) |
|:---:|:---:|:---:|
| [**Detecting Bearing Failure**](https://composer.winkjs.org/docs/use-cases/bearing-health) | [**Detecting Server Latency Degradation**](https://composer.winkjs.org/docs/use-cases/server-health) | [**Catching Process Drift**](https://composer.winkjs.org/docs/use-cases/process-quality) |
| Predictive Maintenance | AIOps | Process Control |


## Documentation

| Resource | What it covers |
|---|---|
| [**Hello Flow!**](https://composer.winkjs.org/docs/playground/hello-flow) | Build a 4-node temperature monitor from scratch — smooth, detect, confirm, broadcast — with an interactive demo running real nodes in your browser. The natural starting point. |
| [**Recipes**](https://composer.winkjs.org/docs/playground/recipes) | Focused, runnable patterns for common detection problems: gradual drift (fast/slow esMean crossover with Page-Hinkley), sudden shifts (Kalman filter), sensor freeze (collapsed standard deviation), and subtle process shifts (Western Electric run rules). Each runs in the browser. |
| [**Explore Nodes**](https://composer.winkjs.org/docs/playground/explore-nodes) | Single-node sandboxes — drag a slider, watch the node respond in real time. Covers the Kalman 1D filter and the kernel convolution node, with more to come. |
| [**Under the Hood**](https://composer.winkjs.org/docs/concepts/under-the-hood) | How messages flow and get enriched node by node, how bad data and throwing functions are handled without crashing the pipeline, how per-asset isolation works, and timestamp requirements. |
| [**Flow Language**](https://composer.winkjs.org/docs/concepts/flow-language) | The complete DSL reference — flow anatomy, node call signatures, dynamic options (tunables), single vs. multi-field processing, naming policies, and node processing types. |
| [**Composition Patterns**](https://composer.winkjs.org/docs/concepts/composition-patterns) | Proven node combinations for recurring problems: noise-tolerant alarms, drift detection, adaptive diagnostics, layered flows, and downsampling for storage. Includes clear guidance on when to use passIf, emitIf, or controller/disable. |
| [**Semantics**](https://composer.winkjs.org/docs/concepts/semantics) | How to define what computed values mean — types, units, physical ranges, operational limits — as a single source of truth shared by storage, dashboards, and query engines. Covers the facts-vs-decisions design principle. |
| [**Node Index**](https://composer.winkjs.org/docs/reference/node-index) | Every node grouped by category — Signal Conditioning, Detection, Feature Extraction, Intelligence, and more — with what each computes and what it adds to the message. |


## Performance

A pure compute benchmark — every step a live message takes, from arrival through all 8 nodes to final computed output, with no I/O. Asset pipelines are created dynamically as each new asset is first encountered; the benchmark runs 10 such pipelines concurrently, interleaved in random order to reflect real multi-asset deployment. Measured with `process.hrtime.bigint()` across 4.5 million messages (10 pipelines × 900 data points × 500 iterations). Storage and MQTT I/O are excluded.

| Configuration        | Throughput              |
|----------------------|-------------------------|
| Raspberry Pi 5       | ~100K messages/second   |
| Modern server        | ~1.2M messages/second   |
| Tracking 200K assets | ~300K messages/second   |

The same pipeline [runs in your browser](https://composer.winkjs.org/docs/benchmark) — browser results are typically 30–60% of native Node.js throughput due to JIT differences.


## Built for the Real World

Each asset runs in its own isolated state — a fault in one never affects another. Messages queue locally when the network drops and drain cleanly on reconnect. The same pipeline code runs unchanged from edge to cloud. Shutdown is ordered and deterministic: sources close first, storage last, with no data corruption.


## Get Involved

| [**Star winkComposer**](https://github.com/winkjs/composer) | [**Follow @winkjs**](https://github.com/winkjs) | [**Discussions**](https://github.com/winkjs/composer/discussions) |
|:---:|:---:|:---:|
| Support open-source streaming intelligence. | Stay updated on releases and ecosystem developments. | Questions, ideas, or feedback — all welcome. |


## About winkJS

## About winkJS
**[winkJS](https://winkjs.org)** is an open-source ecosystem of high-performance, production-grade libraries — built from first principles, tested to near-perfection, and trusted by thousands of projects worldwide.
