# winkComposer

[![npm version](https://img.shields.io/npm/v/@winkjs/composer.svg)](https://www.npmjs.com/package/@winkjs/composer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Composable Streaming Intelligence
[<img align="right" src="https://decisively.github.io/wink-logos/logo-title.png" width="100px" >](https://winkjs.org/)

winkComposer is a JavaScript framework that turns streaming data into real-time insights and decisions. The streams can come from anywhere: IoT and IIoT sensors, vehicle telematics, server metrics. There is no batch job to wait for. In real-time operations like a plant floor, a delayed insight is a lost opportunity. It is open source, purpose-built for SMBs and MSMEs.


## See It in Action

The fastest way to understand winkComposer is to watch it work. The demos below run in your browser — real nodes, live data, no install, nothing to sign up for. Each one uses the same core that runs from edge to cloud.

| [![Bearing Health](https://composer.winkjs.org/readme-bearing-health.png)](https://composer.winkjs.org/docs/use-cases/bearing-health) | [![Server Health](https://composer.winkjs.org/readme-server-health.png)](https://composer.winkjs.org/docs/use-cases/server-health) | [![Process Quality](https://composer.winkjs.org/readme-process-quality.png)](https://composer.winkjs.org/docs/use-cases/process-quality) |
|:---:|:---:|:---:|
| [**Detecting Bearing Failure**](https://composer.winkjs.org/docs/use-cases/bearing-health) | [**Detecting Server Latency Degradation**](https://composer.winkjs.org/docs/use-cases/server-health) | [**Catching Process Drift**](https://composer.winkjs.org/docs/use-cases/process-quality) |
| Predictive Maintenance | AIOps | Process Control |

Other end-to-end examples include [diagnosing Wi-Fi access-point health](https://composer.winkjs.org/docs/use-cases/wifi-ap-health), [classifying driving conditions](https://composer.winkjs.org/docs/use-cases/driving-modes) from OBD-II telematics, and [tracking wash-cycle quality](https://composer.winkjs.org/docs/use-cases/wash-cycle-quality).

Prefer to start with a failure mode instead of an industry? [Recipes](https://composer.winkjs.org/docs/playground/recipes) are short, runnable patterns for recurring problems. They cover gradual drift, directional trends, sudden shifts, hidden parasitic drain, PID-loop hunting, frozen sensors, and subtle process shifts — plus adaptive compression for storage.


## How It Works

A flow is a [pipeline](docs/handbook/understanding-composer.md) of small, single-purpose [nodes](docs/handbook/nodes/index.md). Each node reads fields from the message, computes its result, and adds the result onto the same message for the nodes downstream. The message that leaves the pipeline carries its whole history. A message can also stop early — a failed check drops it, and nothing downstream fires.

The intelligence emerges from composition. Together the nodes cover the whole path from raw signal to decision: clean signals, extract features, detect change, fuse evidence, and act. The repertoire runs from a simple threshold, through a [Kalman filter, to a two-layer spiking neural network](docs/handbook/nodes/intelligence.md). The filter estimates what sensors cannot directly measure. The network weighs many weak signals into one confident verdict.

You define such a pipeline in code — a [linear flow](docs/handbook/flow-language.md) that reads top to bottom, not a drag-and-drop graph. Explicit control signals handle orchestration, so a flow stays readable as it grows. And when many machines share one flow, each gets its own [isolated state](docs/handbook/understanding-composer.md) — one flow, thousands of assets.

Results leave through emitters and storage: alerts to an MQTT broker like Mosquitto or the terminal, insights to QuestDB. [Grafana dashboards](docs/handbook/visualization.md) read from there. The stack is open source end to end.

The Quick Start below builds one such pipeline end to end.


## Quick Start

Requires Node.js 22 or newer.

The Quick Start flow replays a CSV feed of pump motor temperatures. It cleans each reading, flags a hot motor, confirms the heat is not a blip, and prints an alert. One command scaffolds it as a runnable project:

```bash
npm create @winkjs/composer
```

Accept the directory prompt, then run the three printed steps. A run takes about eight seconds. Watch for the `overheat` alert. Prefer zero install? [Build this flow interactively](https://composer.winkjs.org/docs/playground/hello-flow) in the browser playground. The same project also lives in the repository, in [`examples/hello-flow`](examples/hello-flow).

Here is the whole program, [`hello-flow.js`](examples/hello-flow/hello-flow.js):

```javascript
import { flow, csv, terminal } from '@winkjs/composer';

const handle = await flow( 'hello-flow' )

    // Replay the CSV like a live feed: one reading every 200 ms.
    .source( csv, { path: 'data/pump-temps.csv', delayMs: 200 } )

    // Alerts print to the terminal here. A production flow points this
    // at an MQTT broker instead, with QuestDB for storage.
    .emitter( terminal, { verbose: true, prefix: '[pump]' } )

    // One isolated pipeline per pump, and alerts name the pump in
    // their topic. This feed has a single pump; a fleet needs no
    // code change.
    .assetId( 'id' )

    // 1. clean — reject readings outside a sane range
    .sanitize( 'clean', 'motor_t',
        { failureReason: 'reject_reason' },
        { ranges: { min: 0, max: 120 } } )

    // 2. detect — flag when the motor runs hot
    .threshold( 'tooHot', 'motor_t',
        { active: 'is_hot' },
        { mode: 'above', threshold: 80, hysteresis: 3 } )

    // 3. confirm — hot across several readings, not one spike
    .persistenceCheck( 'confirmHot',
        ( msg ) => msg.is_hot,
        { persistenceConfirmed: 'hot_confirmed' },
        { minVotes: 3, outOfTotal: 5 } )

    // 4. broadcast — print an alert once confirmed
    .emitIf( 'alert',
        ( msg ) => msg.hot_confirmed,
        { target: 'terminal', insightType: 'overheat' } )

    .run();
```

To use winkComposer in your own project:

```bash
npm install @winkjs/composer
```

Your project needs `"type": "module"` in its `package.json`. Then copy the flow above and point `path` at your own data. The replayed file has two columns: a pump id and a motor temperature (`id`, `motor_t`).

The example above replays a CSV file. A live deployment reads from an MQTT broker instead — or runs [headless](docs/handbook/headless-flow.md), where your own code feeds the flow. Headless takes any source you already run: an OPC-UA client, a Kafka consumer.


## Performance

The numbers below come from a pure compute benchmark — every step a live message takes through an 8-node flow, from arrival to final output. **Storage and MQTT I/O are excluded** — these are compute ceilings, not full-deployment numbers.

| Configuration        | Throughput              |
|----------------------|-------------------------|
| Raspberry Pi 5       | ~100K messages/second   |
| MacBook Pro (M4 Max) | ~1.1M messages/second   |
| Tracking 10K assets  | ~500K messages/second   |

Both non-Pi rows were measured on a MacBook Pro (M4 Max) under Node.js 22. Every figure is single-core.

Two configurations produced these numbers. The first two rows interleave 10 asset pipelines in random order — 4.5 million messages (10 pipelines × 900 data points × 500 iterations). The third row runs the same flow with 10,000 assets — 10,000 isolated states alive at once, 9 million messages, under 140 MB of heap. Pipelines are created dynamically as each asset first appears; timing uses `process.hrtime.bigint()`. The same pipeline [runs in your browser](https://composer.winkjs.org/docs/benchmark) — browser performance varies from native Node.js due to JIT differences.

Reproduce them from a repo clone. `node benchmark/compare.js 10 500` reports the median of three rounds. `node benchmark/run-benchmark.js static 10000 1` gives the 10K-asset row.


## Built for the Real World

Write a flow once and run it anywhere Node.js does — an industrial-grade Raspberry Pi, a production server, a Kubernetes cluster. Each asset's state is isolated, so a fault in one stays in one. Messages [queue locally](docs/handbook/resilience.md) when the network drops and drain cleanly on reconnect. Shutdown is ordered and deterministic: sources close first, storage last. A misconfigured flow fails when you define it, not in production — unknown options, output collisions, and bad triggers are all caught at definition time.

The test suite holds over 6,500 tests behind a 99.5% coverage gate. Integration tests run against real Mosquitto and QuestDB services, not mocks. Every npm release carries SLSA provenance — a public, verifiable link from the package back to the exact source commit and the build that produced it. `npm audit signatures` verifies it.

The documentation also relates winkComposer's concepts to two industrial standards: [ISO 13374](https://composer.winkjs.org/docs/reference/iso-13374-mapping) for condition monitoring, the [NIST AI RMF](https://composer.winkjs.org/docs/reference/nist-ai-rmf-mapping) for AI risk management.

Flows can run headless inside your own application — no broker, no services. Your code feeds messages in from any source you already run. Already running a historian (the plant's time-series system of record)? winkComposer adds value beside it — it watches the live stream and acts, while the historian keeps the record.


## Documentation

The documentation lives in two places: the [documentation site](https://composer.winkjs.org) for interactive learning, and the in-repo handbook for version-matched reference.

| Resource | What it covers |
|---|---|
| [**Hello Flow!**](https://composer.winkjs.org/docs/playground/hello-flow) | Build a 4-node temperature monitor from scratch — smooth, detect, confirm, broadcast — with an interactive demo running real nodes in your browser. The natural starting point. |
| [**Recipes**](https://composer.winkjs.org/docs/playground/recipes) | Short, runnable patterns for recurring failure modes — each names the nodes it uses and runs in the browser. |
| [**Explore Nodes**](https://composer.winkjs.org/docs/playground/explore-nodes) | Single-node sandboxes — drag a slider, watch the node respond in real time. Covers the Kalman 1D filter and the kernel convolution node, with more to come. |
| [**Under the Hood**](https://composer.winkjs.org/docs/concepts/under-the-hood) | How messages flow and get enriched node by node, how bad data and throwing functions are handled without crashing the pipeline, how per-asset isolation works, and timestamp requirements. |
| [**Flow Language**](https://composer.winkjs.org/docs/concepts/flow-language) | The complete DSL reference — flow anatomy, node call signatures, dynamic options (tunables), single vs. multi-field processing, naming policies, and node processing types. |
| [**Composition Patterns**](https://composer.winkjs.org/docs/concepts/composition-patterns) | Proven node combinations for recurring problems: noise-tolerant alarms, drift detection, adaptive diagnostics, layered flows, and downsampling for storage. Includes clear guidance on when to use passIf, emitIf, or controller/disable. |
| [**Semantics**](https://composer.winkjs.org/docs/concepts/semantics) | How to define what computed values mean — types, units, physical ranges, operational limits — as a single source of truth shared by storage, dashboards, and query engines. Covers the facts-vs-decisions design principle. |
| [**Node Index**](https://composer.winkjs.org/docs/reference/node-index) | Every node grouped by category — Signal Conditioning, Detection, Feature Extraction, Intelligence, and more — with what each computes and what it adds to the message. |
| [**Handbook**](docs/handbook/index.md) | The complete reference, right here in the repo and version-matched: the handbook at any release tag describes exactly that release's code. |
| [**Changelog**](CHANGELOG.md) | Release notes for every published version — what changed, what broke, and what to do about it. |
| [**Roadmap**](ROADMAP.md) | What is planned next, item by item, with complexity and status. |


## Get Involved

| [**Star winkComposer**](https://github.com/winkjs/composer) | [**Follow @winkjs**](https://github.com/winkjs) | [**Discussions**](https://github.com/winkjs/composer/discussions) |
|:---:|:---:|:---:|
| Support open-source streaming intelligence. | Stay updated on releases and ecosystem developments. | Questions, ideas, or feedback — all welcome. |

Want to contribute code or docs? Start with the [contributing guide](CONTRIBUTING.md). The project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).


## About winkJS

[winkJS](https://winkjs.org) is the open-source home of high-performance JavaScript tools. winkNLP covers natural language processing; winkComposer covers streaming intelligence. Both follow the same discipline: developer-friendly APIs, measured performance, and well-tested code.


## License

winkComposer is released under the [MIT License](LICENSE).

Copyright (c) 2024-26 GRAYPE Systems Private Limited.
