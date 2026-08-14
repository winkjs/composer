# Handbook

A practical guide to building streaming intelligence pipelines with winkComposer. Start with the concepts, then explore the nodes, and use the patterns and calibration guides when building real pipelines.

## Reading Order

1. **[Understanding Composer](./understanding-composer.md)** — Quick start, core concepts, how messages flow, built-in resilience, and pipeline isolation. Start here.

2. **[Flow Language](./flow-language.md)** — The declarative language for defining pipelines: node anatomy, single vs multi-field processing, dynamic options, and processing types.

3. **[Node Catalog](./nodes/index.md)** — Every node organized by purpose: [Arithmetic](./nodes/arithmetic.md), [Detection](./nodes/detection.md), [Feature Extraction](./nodes/feature-extraction.md), [Flow Control](./nodes/flow-control.md), [Intelligence](./nodes/intelligence.md), [Observability](./nodes/observability.md), [Orchestration](./nodes/orchestration.md), [Signal Conditioning](./nodes/signal-conditioning.md), and [Configuration](./nodes/configuration.md).

4. **[Composition Patterns](./composition-patterns.md)** — Proven recipes for combining nodes: bearing failure detection, drift detection, adaptive diagnostics, and more.

5. **[Headless Flows](./headless-flow.md)** — Running a flow with no source adapter: feeding it yourself with `processMessage`, the await rule, error handling, and shutdown.

6. **[Calibration](./calibration.md)** — How to set every number in a flow against real data: auditing the instrument first, baseline characterisation, classifying each constant as law, knob, or learned, per-regime tunables, and node-by-node tuning for Page Hinkley, trend, kalman1d, and appraise.

7. **[Semantics](./semantics/index.md)** — The metadata layer: column types, limit hierarchies, asset classes, and the semantic loader API.

8. **[Visualization](./visualization.md)** — From pipeline to dashboard: QuestDB as the integration surface, Grafana provisioning, query patterns, dashboard templates, and where the approach stops.

9. **[Resilience](./resilience.md)** — Keeping a deployment running through restarts and outages: input durability with a fixed `clientId`, the recommended broker configuration walked line by line, what the broker guarantees in each outage type, and measuring durations from message time.

10. **[Environment Variables](./environment-variables.md)** — The runtime settings composer reads from the environment: MQTT and QuestDB connection details, flush tuning, and lifecycle timeouts. Defaults are built in; set these only to change a host, port, or limit.

11. **[Stream Preparation](./stream-preparation.md)** — Ready-made functions for a source's `transform` option: coerce numbers, normalize timestamps, keep a replay window, label shifts, track activity, stamp period keys.
