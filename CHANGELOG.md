<!--
  Release contract and entry format. This comment is for editors and
  never renders.

  The publish workflow extracts one entry and builds the GitHub
  Release page from it. An entry runs from its "## Version" heading
  down to the next "# [" title line. Keep both heading shapes
  exactly as they are.

  Entry shape, newest entry first:

    # [Short title](link to the release tag)
    ## Version X.Y.Z — Month DD, YYYY

  Versions are plain numeric semver: 0.4.0, never v0.4.0. Dates use
  the full month name.

  Sections, in this fixed order, only the ones that apply:

    ### 💥 Breaking   what changed, old -> new, the action to take
    ### ✨ Features
    ### 🐛 Fixes
    ### ⚙️ Updates
    ### 🔒 Security   security fixes, with advisory links

  Emojis appear in section headers only; bullet text stays plain.
  One claim per bullet, in short sentences. A retired or renamed API
  always names its replacement.
-->

# [Routable logs and contained faults](https://github.com/winkjs/composer/releases/tag/0.6.0)
## Version 0.6.0 — September 1, 2026

### ✨ Features

- Every framework log line and thrown Error message now starts with
  `winkComposer/<moduleToken>: `, replacing seven mixed prefix
  styles. One grammar lets you filter and route every Composer line
  the same way. In code, match `err.code`, never the message string.
- A logging facade now carries every line, with `debug`, `info`,
  `warn`, and `error` levels. `COMPOSER_LOGGER` picks the transport:
  `console` for readable lines, `json` for log collectors, or
  `silent`. `COMPOSER_LOG_LEVEL` sets the lowest level that prints
  (default: `info` in production, `debug` elsewhere). There is no
  file transport, because supervisors such as journald and Docker
  already own log files.
- `handle.getStats()` returns the flow's routing counters:
  `droppedUnknownSpecialization`, `totalPartitionsCreated`, and
  `activePartitions`. An operator can watch `.switch()` drops from a
  health check instead of scraping log lines.
- A node throw no longer stops the process. The flow skips the bad
  message, reports it as `MESSAGE_HANDLER_FAILED`, and continues.
  After `COMPOSER_MESSAGE_FAILURE_THRESHOLD` consecutive failures
  (default 5), the flow drains its sinks and stops in the terminal
  `errored` phase. A partition whose creation always fails is
  quarantined the same way, leaving the others untouched.
- A throw inside a user callback, such as `onStatus` or
  `onDeliveryFailure`, now becomes one classified `CALLBACK_FAILED`
  line, and the operation completes normally. QuestDB's strict-mode
  `onWarning` stays unguarded on purpose. Its throw is how strict
  mode rejects a row.

### 🐛 Fixes

- A shutdown that loses buffered data now exits with code 1. It used
  to exit 0, so a supervisor such as systemd or Docker saw a clean
  stop over a data loss. Each failed drain prints one classified
  line first. Callers of `handle.shutdown()` are unaffected, because
  they receive the rejection directly.
- A JSON payload that is a scalar, `null`, or a bare array no longer
  crashes the MQTT source. Such a record cannot carry pipeline
  fields. The source now skips it with a classified `DECODE_ERROR`
  report.
- A source `transform` that returns a scalar or an array is now
  skipped with a `CALLBACK_FAILED` report. Returning `null` or
  `undefined` stays the documented way to drop a record on purpose.
- `onStatus` must be a function when provided. CSV, testHarness, and
  direct `runFlow()` setup now throw `INVALID_CONFIG` instead of
  treating a bad value as no handler.
- A rejection returned by a non-native thenable inside a guarded
  callback no longer becomes an unhandled rejection.
- An MQTT client error now always prints, even when a broken
  `onMetrics` handler runs with no `onStatus` listener.

### ⚙️ Updates

- `npm test` now fails below 100% coverage on statements, branches,
  functions, and lines. Every branch open at arming time got a spec
  or was restructured away.
- Three unreachable trees left the npm package: `src/nodes/archive/`,
  `src/nodes/sse-emitter/`, and the console formatter. No runtime
  path could load them.
- The handbook covers each new surface. Grammar and levels sit on
  the observability page, exit codes on the headless-flow page, and
  new sections cover node-throw containment and the flow counters.

# [Lighter install](https://github.com/winkjs/composer/releases/tag/0.5.1)
## Version 0.5.1 — August 22, 2026

### 🐛 Fixes

- The repository's npm scripts now run on Windows. cmd.exe does not
  treat single quotes as quoting characters, so `npm test` and
  `npm run lint` failed there. The glob patterns now use double
  quotes, and the hardening script calls mocha's JS entry directly.
  Thanks @neerajvelocis for finding and fixing this.

### ⚙️ Updates

- Installing `@winkjs/composer` no longer downloads the LevelDB
  store. `classic-level` moved to development dependencies, and the
  dormant `mqtt-store.js` module left the npm package. The module
  was unreachable from the package and served no runtime feature.
  Its native binaries and helper packages no longer land in your
  `node_modules`.
- The unused `docs-serve` script left the package scripts. The
  documentation lives at composer.winkjs.org and in the in-repo
  handbook.

# [Stream preparation arrives](https://github.com/winkjs/composer/releases/tag/0.5.0)
## Version 0.5.0 — August 15, 2026

### ✨ Features

- Stream-preparation utilities: six ready-made functions for a
  source's `transform` option — `coerceNumeric`, `normalizeTimestamp`,
  `filterRows`, `labelShift`, `trackActivity`, and `stampPeriod`.
  They get a raw feed ready for analytics. They fix numeric types,
  normalize timestamps (including zone-less historian text), keep a
  replay window, label shifts, track activity, and stamp period keys.
  All are allocation-free per row and fail fast on bad config. See
  the handbook's Stream Preparation page.

### 🐛 Fixes

- The change-point benchmarks now run from a repo clone. Their
  900-point dataset ships at `benchmark/data/cpd-data.js`. It
  previously sat outside the repository, so every benchmark script
  failed on a missing import.

### ⚙️ Updates

- `benchmark/compare.js` now runs three rounds and reports the
  medians. A single round swings by several percent, enough to flip
  its overhead verdict.
- The README benchmark table now lists the exact commands that
  reproduce it. The server row reads ~1.1M messages/second — the
  median under the three-round protocol.
- The benchmark folder now holds only the performance benchmarks.
  The development-era experiment harnesses left the repository
  (idle-node NaN overhead, switch fan-out scaling, an MQTT source
  baseline rig, a heap sampler). The `performance-tests/` folder of
  early design studies left with them.

# [The Quick Start becomes one command](https://github.com/winkjs/composer/releases/tag/0.4.2)
## Version 0.4.2 — August 12, 2026

### ✨ Features

- A new scaffolder package, `@winkjs/create-composer`, turns the
  Quick Start into one command. `npm create @winkjs/composer`
  scaffolds the hello-flow example as a runnable project.
- The scaffolder is developed in this repository, under
  `create-composer/`. It versions and releases independently, with
  its own changelog.

### ⚙️ Updates

- The README Quick Start now leads with the scaffold command. The
  cloneable project stays at `examples/hello-flow`.
- Example projects now pin an exact composer version and link to
  documentation at that version's tag. The convention is recorded
  in `examples/README.md`.
- The composer library code is unchanged from 0.4.1.

# [Runnable example and sharper npm discovery](https://github.com/winkjs/composer/releases/tag/0.4.1)
## Version 0.4.1 — August 10, 2026

### ✨ Features

- A new `examples/` directory holds small, runnable example projects.
  The convention they follow is recorded in `examples/README.md`.
- The first example is `hello-flow`: the README Quick Start flow as a
  working project. It needs Node.js 22 and nothing else.

### ⚙️ Updates

- The README is rewritten for the first-time visitor.
- A public `ROADMAP.md` now describes where the project is heading.
- The npm keywords now match what people search for: `iiot`,
  `industrial-iot`, `streaming-analytics`, `edge-computing`,
  `anomaly-detection`, and `predictive-maintenance`.
- Two redundant keywords are removed: `edge` (covered by
  `edge-computing`) and `wink-composer` (covered by the package name).

# [First public release](https://github.com/winkjs/composer/releases/tag/0.4.0)
## Version 0.4.0 — August 8, 2026

### ✨ Features

- winkComposer goes open source under the MIT license: composable
  streaming intelligence, from Raspberry-Pi-class edge devices to the
  cloud.
- Declarative flows: small analytical nodes compose into pipelines,
  with per-asset partitioning, control signals, and windowing built
  in.
- Nodes across eight categories: arithmetic, detection, feature
  extraction, flow control, intelligence, observability,
  orchestration, and signal conditioning.
- Adapters in the box: MQTT in and out, a CSV file source, QuestDB
  persistence, terminal output, and a test-harness source.
- The handbook ships in the repo (`docs/handbook`): concepts, the
  node reference, and recipes. Documentation site:
  https://composer.winkjs.org/

### ⚙️ Updates

- winkComposer was developed privately before this release. The
  earlier `0.0.x` versions on npm were internal previews.
- Public release tags begin at `0.4.0`, as plain numeric semver.
