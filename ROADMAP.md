# Roadmap 🧭

winkComposer transitioned to open source on July 30, 2026. Its
first public release, 0.4.0, was published on npm on August 8,
2026. The items below are the current plan, with a special focus on
keeping things simple for the user. Sequence and scope may change
as work and community feedback teach us more.

|S. No.| Item | Complexity | Status |
|---|---|---|---|
|01.|**Runnable examples in-repo**:<br/>An `examples/` directory of small, self-contained projects you can copy anywhere. [`hello-flow`](examples/hello-flow/) is already present: the README Quick Start flow — pure Node, no services. Next: a monitoring example that starts with one `docker compose up`, streams readings into QuestDB, and fills a bundled Grafana dashboard live as you watch. More follow. Every example pins an exact released version and runs in CI.|Simple|In progress|
|02.|**Continuous integration + coverage badge**:<br/>Lint and the full test suite on every pull request, an integration job running Mosquitto and QuestDB as service containers, and a live coverage badge.|Medium|Yet to start|
|03.|**Community files**:<br/>Issue forms for bug reports and feature requests, a chooser that sends questions to Discussions, a pull-request checklist, and a published security policy ([`SECURITY.md`](SECURITY.md)). Private vulnerability reporting is enabled on the repository, so a report starts as a draft advisory that only the maintainers and the reporter can see.|Simple|Completed|
|04.|**OpenSSF Best Practices badge**:<br/>Apply for the passing-level badge; the higher levels follow.|High|Yet to start|
|05.|**Handbook audit**:<br/>Verify every handbook page against the released code — options against their schemas, every snippet run. Repeats each release. A first correctness pass rode 0.6.0: quoted log lines re-verified against the shipped grammar. The full options-and-snippets audit remains.|Medium|In progress|
|06.|**Stream-preparation utilities**:<br/>Ready-made functions for a source's `transform` option — they get a raw feed ready for analytics: fix numeric types, normalize timestamps, keep a replay window, label shifts, track activity, stamp period keys. Promoted from field use: `coerceNumeric`, `normalizeTimestamp`, `filterRows`, `labelShift`, `trackActivity`, `stampPeriod`. Shipped in 0.5.0 with full tests and a [handbook page](docs/handbook/stream-preparation.md).|Medium|Completed|
|07.|**Architecture decision records**:<br/>Publish the remaining architecture decision records (ADRs) under `docs/decisions/`.|Simple|In progress|
|08.|**Real-data showcase**:<br/>A public, anonymised industrial dataset — multi-day paint-shop telemetry contributed by a manufacturing partner — with an SPC example flow built on it.|High|Yet to start|
|09.|**Soak program on edge hardware**:<br/>Multi-day continuous runs on industrial Raspberry-Pi-class hardware with exact message accounting. The results back the 1.0.0 stability declaration.|High|Yet to start|
|10.|**TypeScript definitions**:<br/>Ship type definitions for the public API — the flow builder, node options, and helper families.|Medium|Yet to start|
|11.|**Project scaffolder**:<br/>Shipped as [`@winkjs/create-composer`](create-composer/). One command, `npm create @winkjs/composer@latest`, scaffolds a runnable project from a bundled template. Templates are packed byte-identical from `examples/`; an example under item 01 joins the bundle by declaring its `composer` block (category, featured), so heavy demos stay out of the download.|Simple|Completed|

The list is a guideline for users and
[contributors](https://github.com/winkjs/composer/blob/main/CONTRIBUTING.md) —
feedback and participation are welcome in
[discussions](https://github.com/winkjs/composer/discussions).
