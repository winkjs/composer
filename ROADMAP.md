# Roadmap 🧭

winkComposer transitioned to open source on July 30, 2026. Its
first public release, 0.4.0, was published on npm on August 8,
2026. The items below are the current plan, with a special focus on
keeping things simple for the user. Sequence and scope may change
as work and community feedback teach us more.

|S. No.| Item | Complexity | Status |
|---|---|---|---|
|01.|**Runnable examples in-repo**:<br/>An `examples/` directory with self-contained, copy-out-able example flows. We're starting with two examples, with more to come: a pure-Node hello flow with no services, and a pump-monitoring flow that runs with a single `docker compose up`. The pump flow replays sensor readings at 100 ms per record into QuestDB, and a bundled Grafana dashboard fills live as you watch. Each example is pinned to a released version and runs in CI.|Simple|Yet to start|
|02.|**Continuous integration + coverage badge**:<br/>Lint and the full test suite on every pull request, an integration job running Mosquitto and QuestDB as service containers, and a live coverage badge.|Medium|Yet to start|
|03.|**Community files**:<br/>Issue templates, a pull-request template, and a published security policy (`SECURITY.md`) with a private vulnerability-reporting path.|Simple|Yet to start|
|04.|**OpenSSF Best Practices badge**:<br/>Apply for the passing-level badge; the higher levels follow.|High|Yet to start|
|05.|**Handbook audit**:<br/>Verify every handbook page against the released code — options against their schemas, every snippet run. Repeats each release.|Medium|Yet to start|
|06.|**Stream-preparation utilities**:<br/>Ready-made functions for a source's `transform` option — they get a raw feed ready for analytics: fix numeric types, normalize timestamps, label shifts, derive activity states. Promoted from field use: `coerceNumeric`, `normalizeTimestamp`, `shiftLabel`, `activityState`. Each arrives with full tests and a handbook page.|Medium|Yet to start|
|07.|**Architecture decision records**:<br/>Publish the remaining architecture decision records (ADRs) under `docs/decisions/`.|Simple|In progress|
|08.|**Real-data showcase**:<br/>A public, anonymised industrial dataset — multi-day paint-shop telemetry contributed by a manufacturing partner — with an SPC example flow built on it.|High|Yet to start|
|09.|**Soak program on edge hardware**:<br/>Multi-day continuous runs on industrial Raspberry-Pi-class hardware with exact message accounting. The results back the 1.0.0 stability declaration.|High|Yet to start|
|10.|**Project scaffolder**:<br/>`npm create` support that scaffolds a new project from any example in `examples/`.|Simple|Under consideration|

The list is a guideline for users and
[contributors](https://github.com/winkjs/composer/blob/main/CONTRIBUTING.md) —
feedback and participation are welcome in
[discussions](https://github.com/winkjs/composer/discussions).
