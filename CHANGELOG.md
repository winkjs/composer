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

# [Retired QuestDB keys](https://github.com/winkjs/composer/releases/tag/0.8.0)
## Version 0.8.0 — September 21, 2026

### 💥 Breaking

- Five QuestDB storage options are removed, as 0.7.0 announced:
  `flushMode`, `idleFlushAfterMs`, `idleFlushCheckMs`, `autoFlushRows`,
  and `autoFlushIntervalMs`. A flow that still sets one fails at
  definition with `INVALID_CONFIG` and a message such as
  `Unknown property 'flushMode'`. Action: rename `autoFlushRows` to
  `flushRows` and `idleFlushCheckMs` to `flushIntervalMs`. Delete the
  other three. Composer owns every flush, so a flush mode and an idle
  timer have nothing left to set.
- Their five environment variables are removed with them:
  `QUESTDB_FLUSH_MODE`, `QUESTDB_IDLE_FLUSH_AFTER_MS`,
  `QUESTDB_IDLE_FLUSH_CHECK_MS`, `QUESTDB_AUTO_FLUSH_ROWS`, and
  `QUESTDB_AUTO_FLUSH_INTERVAL_MS`. A process that finds one set stops
  at import with exit code 1. The failure line names the variable and
  what to do instead. An empty value counts as set. Action: rename
  `QUESTDB_AUTO_FLUSH_ROWS` to `QUESTDB_FLUSH_ROWS` and
  `QUESTDB_IDLE_FLUSH_CHECK_MS` to `QUESTDB_FLUSH_INTERVAL_MS`. Delete
  the other three.

### 🐛 Fixes

- The README said the test suite holds over 6,500 tests behind a
  99.5% coverage gate. The gate is 100% on statements, branches,
  functions, and lines, and the suite holds over 7,000 tests. The
  line now says so.

### ⚙️ Updates

- The 0.7.0 code ran four days without interruption at twice its
  planned message rate. The device was an industrial Raspberry Pi, a
  Revolution Pi Connect 5 (Compute Module 5, 8 GB RAM, 32 GB eMMC).
  Every message was accounted for and none was lost. The source of
  0.8.0 is that code with the removals above and nothing else.

# [Delivery truth for QuestDB](https://github.com/winkjs/composer/releases/tag/0.7.0)
## Version 0.7.0 — September 15, 2026

### 💥 Breaking

- `localhost` is refused in every adapter address: `ilpUrl`, `pgUrl`,
  `brokerUrl`, and the variables `QUESTDB_ILP_URL`, `QUESTDB_PG_URL`,
  and `MQTT_BROKER_URL`. The name can stand for two addresses, and a
  service may answer on only one. A flow that uses it fails at
  definition with `INVALID_CONFIG`. A variable that uses it stops the
  process at import. The QuestDB defaults move from `localhost` to
  `127.0.0.1:9000` and `127.0.0.1:8812`. Action: write the literal
  address, `127.0.0.1`. `pgUrl` and `brokerUrl` also take a bracketed
  IPv6 literal such as `[::1]:8812`. `ilpUrl` does not, because the
  QuestDB client cannot read one.
- `maxBufSize` now sets the client's byte ceiling, `max_buf_size`. It
  used to set the initial buffer size, `init_buf_size`. Action: use
  the new `initBufSize` for the old meaning.
- The QuestDB `onDeliveryFailure` report has a new shape. The handler
  now receives `( err, { trigger, rowsLost, abandoned, probe } )`,
  once per failed send. `trigger` is `rows`, `timer`, or `recovery`.
  The old keys `idleFlush` and `recovery` are gone. Action: read
  `trigger` instead.
- `handle.shutdown()` now rejects when a sink loses buffered data at
  drain, with the sink's error, `err.code`, and `err.dropped.count`.
  It used to resolve over the loss, so a process could exit 0 over
  lost rows. Action: catch the rejection when your program calls
  `shutdown()` itself. The signal path exits 1 over the same loss.
- The MQTT emitter factory, when called directly, now always returns
  a promise, and a configuration error rejects it with
  `INVALID_CONFIG`. It used to return the handle at once at
  `connectGraceMs: 0` and throw. Flows are unaffected. Action:
  `await` the factory and catch the rejection.
- A custom emitter's handle must have `flush()`, as a storage handle
  already must. Wiring refuses a handle without it. Action: add
  `flush()`. A trivial emitter can resolve at once.

### ✨ Features

- Composer starts every QuestDB send itself, and the client's own
  trigger is off. A write that fills the buffer to `flushRows` starts
  a send at once, and a timer sends whatever is buffered every
  `flushIntervalMs`. One send runs at a time, so health and pressure
  report exact counts.
- Four new QuestDB options, each with a `QUESTDB_*` variable:
  `flushRows`, `flushIntervalMs`, `bufferCeilingRows`, and
  `flushDeadlineMs`. When the rows buffered plus the rows in flight
  reach the ceiling, `write()` refuses new rows with `STORAGE_FULL`.
  The ceiling defaults to ten times `flushRows` and must be at least
  twice it.
- Every send has a deadline, and delivery pauses while QuestDB is
  unreachable. After a failed or abandoned send, the adapter probes
  `ilpUrl`. While the probe fails, delivery stays paused and each
  interval probes again. When one passes, a single send carries
  everything held. So a restart costs only the batch on the wire when
  the port closed. Before, a 30-second restart lost every row written
  during it.
- `getHealth()` on the QuestDB adapter now reads delivery. One failed
  send reads `yellow`. Two in a row, one abandoned, or a pause read
  `red` with `connected: false`. The next delivered send reads
  `green`. Five fields join the report: `consecutiveFlushFailures`,
  `lastFlushAt`, `lastFlushError`, `pausedSince`, and
  `abandonedFlushes`.
- Each change of delivery state prints one line, with or without an
  `onDeliveryFailure` handler. The codes are `DELIVERY_HEALTH` for
  the ladder, `CIRCUIT_OPEN` for a pause or resume, and
  `STORAGE_FULL` for shedding. Nothing repeats while a state
  persists. The restored line names the outage length and the rows
  reported lost.
- The QuestDB transport fails fast by default. `stdlibHttp: true`
  (`QUESTDB_STDLIB_HTTP=on`) selects the client's standard-library
  HTTP transport, whose requests always end. The client's own
  default, undici, retries a refused connection without end. A send
  into a stopped server then hung and held the process open. New
  `requestTimeout` (`QUESTDB_REQUEST_TIMEOUT`) and `initBufSize`
  (`QUESTDB_INIT_BUF_SIZE`) join the schema.
- The QuestDB adapter checks `pgUrl` and `ilpUrl` at setup, with one
  TCP connect per address the name resolves to. An address that does
  not answer throws `TRANSPORT_UNREACHABLE`, and the message lists
  each address with its result. Every adapter warns once per address,
  with `ADDRESS_IS_NAME`, on any host name.
- The MQTT source prints one line at every change of its health, with
  or without an `onStatus` handler. Yellow prints at `warn`, red at
  `error`, and the return to green at `warn` with the episode length.
- Every repeating fault line is bounded: two lines in full per
  episode, then one summary a minute. That covers `DELIVERY_FAILED`,
  `CALLBACK_FAILED`, `CONNECT_FAILED`, the QuestDB default
  `onWarning`, and the MQTT source's decode and transform faults. A
  dead sensor that sends NaN all night costs two lines, then one a
  minute.
- The MQTT emitter prints one `DELIVERY_HEALTH` line per change of
  the broker link. `onCritical` fires once when pressure climbs past
  80% and re-arms below 66%. Both MQTT adapters add a random share of
  up to 20% to the reconnect period, drawn once at startup. So a
  fleet that lost one broker does not retry in step.
- The handbook gains sections on the address rule, MQTT client
  names, and the limits of the MQTT source. It also covers the yield
  rule for tight loops and the QuestDB delivery lines.

### 🐛 Fixes

- A dead QuestDB endpoint no longer loses rows in silence while
  health reads green. In a long soak run, `localhost` stopped
  resolving to the answering address after 32 hours. The write path
  was then lost for four hours with no report. The refusal, the
  probes, the deadlines, and the delivery ladder above close it
  together.
- A flow with several `persistIf` nodes on one storage built the
  adapter once per node. Each orphan kept a timer, an HTTP agent, and
  a sender for the life of the process. The storage is now built once.
- `.source()`, `.emitter()`, and `.storage()` now throw
  `INVALID_CONFIG` when an adapter's schema rejects a config, in place
  of a plain error with no code.
- The QuestDB red health line waited for a failed send that a paused
  delivery never starts. A pause is now the red edge, so the lines
  read degraded, red, paused, resumed, restored.
- An empty recovery send after a mid-row throw stamped a delivery
  that never happened, so health read green over a poison write. It
  now stays red.
- The MQTT source's `stop()` could leave the socket open, so a pending
  connect or a hung broker held the process. The socket now detaches
  at once, or a timer destroys it at the deadline. The MQTT emitter's
  shutdown got the same fix.
- Two MQTT sources started in the same millisecond got the same
  generated client name, and the broker disconnected the older one.
  The name now carries a random part.
- An MQTT emitter `options.type` of `'constructor'` could poison the
  connection through the expiry table's prototype. The table has no
  prototype now.
- Durations now read a stopwatch clock that a wall-clock step cannot
  move. Before, an NTP step after boot could fire the MQTT source's
  30-second red early. It could also expire every dedup entry at
  once, or report an hour for a five-second outage.
- A decode failure on the MQTT source reports the topic and the byte
  count, never the payload text, which a parser's message can echo.
- A dedup id that is not a string now bypasses the cache and counts
  in `dedupBypassed`.
- `tablePrefix` must be an identifier, because QuestDB reads the
  unquoted table name as one token.
- The environment validator printed `QUESTDBRETRYTIMEOUT` for
  `QUESTDB_RETRY_TIMEOUT` in its error line.
- The handbook said the MQTT emitter keeps a persistent session. The
  session has been clean in every public release, and the page now
  says so.

### ⚙️ Updates

- Five QuestDB options are deprecated and will be removed in 0.8.0:
  `flushMode`, `idleFlushAfterMs`, `idleFlushCheckMs`, `autoFlushRows`,
  and `autoFlushIntervalMs`, with their `QUESTDB_*` variables. Until
  then `autoFlushRows` maps to `flushRows`, and `idleFlushCheckMs`
  maps to `flushIntervalMs`. The other three are accepted and ignored.
  Setup prints one `DEPRECATED_OPTION` line naming the keys in use.
- `@questdb/nodejs-client` is pinned to `~4.2.0`. The adapter depends
  on the client's retry lists and timeouts.

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
