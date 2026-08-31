# Configuration

Configuration methods are called **before** any processing nodes in the chain. They set up data sources, outputs, identity, naming, and specialization. From the user's perspective, they look and feel like any other node in the chain:

```javascript
flow('pump-monitor')
    // Configuration
    .source(csv, { path: './data.csv' })
    .storage(questdbAdapter, { ilpUrl: 'localhost:9000' })
    .assetClass(assetClass)
    .assetId('machineId')

    // Processing
    .esMean('smooth', 'temperature', { mean: 'avg' })
    .threshold('check', 'avg', { active: 'alarm' }, { mode: 'above', threshold: 80 })

    // Terminal
    .run();
```

## Quick Reference

Configuration methods fall into five groups:

#### Data I/O

Connect sources, outputs, and storage.

| Method | What It Does |
|--------|-------------|
| [emitter](#emitter) | Registers an output adapter (MQTT, Terminal) |
| [source](#source) | Connects a data source adapter (CSV, MQTT) |
| [storage](#storage) | Registers a persistence adapter (QuestDB) |

#### Identity

Bind semantics and isolate state per asset.

| Method | What It Does |
|--------|-------------|
| [assetClass](#assetclass) | Semantics definition for storage schema |
| [assetId](#assetid) | Per-asset pipeline isolation |

#### Specialization

Route messages to different linear pipelines by field value.

| Method | What It Does |
|--------|-------------|
| [groupBy, endGroup](#groupby-endgroup) | Templated specialization with per-group tuning |
| [switch, case, break](#switch-case-break) | Routes messages to different pipelines by field value |

#### Lifecycle

Compile, validate, and run.

| Method | What It Does |
|--------|-------------|
| [run](#run) | Wires and starts the pipeline |
| [validate](#validate) | Validates flow definition and cross-references |
| [yield](#yield) | Cooperative event-loop yielding threshold |
| [build](#build-internal) | Compiles flow to executable source (**internal**) |
| [inspect](#inspect-internal) | Introspects flow structure (**internal**) |

---

## Data I/O

### emitter

Registers an output adapter for broadcasting messages to external systems. Nodes like `emitIf` reference emitters by target name (the adapter's `id`).

```javascript
.emitter( adapter, config )
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `adapter` | object | Yes | Imported adapter module (must have `id` and `createEmitter()`) |
| `config` | object | No | Adapter-specific configuration |

#### MQTT Emitter

Production emitter for reliable message delivery to MQTT brokers. Features an in-memory outage buffer and persistent sessions.

```javascript
import { mqttEmitter } from '@winkjs/composer';

flow('pipeline')
    .emitter(mqttEmitter, {
        brokerUrl: 'mqtt://broker:1883',
        codec: { pack: ( msg ) => Buffer.from( JSON.stringify( msg ) ) },
        clientId: 'composer-edge-001',
        maxQueueSize: 10000
    })
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `brokerUrl` | string | `MQTT_BROKER_URL` env var | MQTT broker URL (`mqtt://` or `mqtts://`) |
| `codec` | object | required | Codec with `pack( msg )` method returning Buffer |
| `clientId` | string | auto-generated | MQTT client identifier |
| `connectGraceMs` | number | `500` (`MQTT_CONNECT_GRACE_MS` env var) | How long flow startup waits for the broker's first connection acknowledgment, in milliseconds. The flow starts either way — an unreachable broker never fails startup. `0` skips the wait |
| `maxQueueSize` | number | `10000` | Max undelivered messages held in memory (hard ceiling 60,000 — see Delivery guarantees below) |
| `debug` | boolean | `false` | Enable debug logging |
| `will` | object | `null` | MQTT Last Will and Testament (see below) |
| `onCritical` | function | `null` | Callback when buffer pressure > 80% |
| `onBackpressure` | function | `null` | Pressure callback, fired when an accepted publish completes (refused attempts never fire it) |
| `onDeliveryFailure` | function | `null` | Callback when an accepted message fails to deliver. Without one, the failure surfaces as an unhandled rejection — loud by design |
| `mqttConnectFn` | function | `mqtt.connect` | Advanced: inject a custom MQTT connect function (tests, benchmarks) |

The three callbacks are guarded. If one throws or rejects, the emitter keeps publishing and the fault is reported once as a `CALLBACK_FAILED` console line. A bug in your callback costs its own output, never the emitter.

Config is checked when the flow is defined, before anything runs. A misspelled
option name (say `brokerURL` instead of `brokerUrl`) — or an option retired by
the in-memory emitter redesign (`storePath`, `maxQueueBytes`) — is rejected
with an "Unknown property" error instead of being silently ignored.

**Will (Last Will and Testament):**

```javascript
will: {
    topic: 'devices/sensor-001/status',
    message: { status: 'offline' },
    qos: 1,
    retain: true
}
```

**Publishing behavior:**
- At startup, the flow waits briefly (up to `connectGraceMs`, default 500 ms) for the broker connection before the first message flows. On a reachable broker the wait ends the moment the broker answers — typically a few milliseconds. If the broker is not reachable in time, the flow starts anyway and messages buffer until it connects
- Fire-and-forget with QoS 1 — never blocks on PUBACK
- MQTT v5 with persistent sessions (7-day expiry)
- Auto-reconnect every 5s
- Keepalive: 60s

**Message metadata** (added automatically per message):
- `messageExpiryInterval` — TTL in seconds (default: 3600 for telemetry, 86400 for status)
- `winkDedupId` — UUID for deduplication by downstream MQTT sources
- `winkTimestamp` — Emission timestamp
- `winkVersion` — Protocol version tag

**Outage buffer (in-memory):**
- Undelivered messages wait in process memory during broker outages
- Automatic re-send on reconnection
- The buffer dies with the process: a crash or power cut loses whatever was still undelivered — at typical edge rates, at most one burst, usually 0–2 messages

**Delivery guarantees:**

Every accepted publish counts as in flight until the broker acknowledges it.

- The buffer holds at most 60,000 messages, whatever `maxQueueSize` says. The ceiling comes from the MQTT protocol: every unacknowledged message needs a packet id, a packet id is a 16-bit number, and one connection can therefore never carry more than 65,535 of them. A `maxQueueSize` above 60,000 is clamped back with a printed warning. For how long 60,000 lasts at your message rate, see [Environment Variables → the queue ceiling](../environment-variables.md#the-mqtt-queue-ceiling-60000-messages).
- The ceiling does not limit throughput. In steady operation the number of unacknowledged messages equals your message rate times the broker's response time. Measured against a local broker at about 14,300 messages per second, that number stayed between 312 and 400.
- At 90% of buffer capacity, `publishNow` refuses new messages with a `STORAGE_FULL` error. The refusal is immediate. composer never accepts a message it would later drop in silence.
- A message the codec cannot encode (for example, a value JSON cannot represent) is refused on the spot with an `ENCODE_ERROR`. The message never occupies buffer space, later messages are unaffected, and the running count appears in `stats.encodeErrors`. Fix the flow that produces the value; the transport is fine.
- The emitter's `shutdown()` result states exactly what was delivered. A clean resolve means every accepted message reached a settled outcome — acknowledged by the broker, or failed and reported loudly through `onDeliveryFailure`. When unacknowledged messages remain at the deadline, shutdown rejects with a `SHUTDOWN_TIMEOUT` error carrying the exact count in `dropped: { count }` — whether the connection was up or not, because nothing survives the process. Inside a flow, the framework catches this rejection and logs it — one classified line naming the emitter, the code, and the count — so the flow's own shutdown still completes for the other sinks.

**Resolved issue — completing a connection could lose in-flight messages (fixed 2026-07-09).** mqtt.js briefly forgets which packet ids its undelivered messages hold whenever a connection completes; with an asynchronous disk store, a new publish could take an id an undelivered message still owned and overwrite it. composer closed this by running the client's synchronous in-memory store, where the forget-and-rebuild gap has zero width. The library defect is still being pursued upstream with a reproduction. The trade: undelivered messages no longer survive a process restart — the crash cost is stated under "Outage buffer" above.

**Health monitoring:**

```javascript
emitter.getHealth()
// Returns: { status: 'green'|'yellow'|'red', connected, pressure: 0.0-1.0,
//            stats: { published, publishErrors, encodeErrors, errors, reconnects, unacked } }
```

#### Terminal Emitter

Debug emitter that writes to stdout. Useful for development and testing.

```javascript
import { terminal } from '@winkjs/composer';

flow('debug')
    .emitter(terminal, { verbose: false, precision: 2 })
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `verbose` | boolean | `false` | `false` = compact `key=value` format; `true` = pretty JSON |
| `prefix` | string | `''` | Prefix for each output line |
| `precision` | number | `2` | Decimal places for floating-point values |

Config is checked when the flow is defined. A misspelled option name (say
`verbos` instead of `verbose`) is rejected with an "Unknown property" error
instead of being silently ignored.

**Compact output (default):**

```
── 3:26:57 pm ── device/sensor/0/alert ──
id=158550  temperature=87.9  pressure=2.1  is_active=true  alert=null
```

**Verbose output:**

```
── 3:26:57 pm ── device/sensor/0/alert ──
{
  "id": 158550,
  "temperature": 87.9,
  "pressure": 2.1
}
```

---

### source

Connects a data source adapter to the pipeline. The adapter feeds messages into the pipeline one at a time.

```javascript
.source( adapter, config )
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `adapter` | object | Yes | Imported adapter module (must have a `start()` function) |
| `config` | object | No | Adapter-specific configuration (validated against adapter's schema if provided) |

#### Finite and infinite sources

Every source is one of two kinds, and the kind decides how your flow ends.

A **finite** source has a natural end. A CSV file runs out of rows; a test
harness runs out of generated messages. When that happens, the source tells
the runtime it is done (it emits a `phase: 'complete'` status event), and
the runtime shuts the flow down for you: emitters flush, storage drains,
the process can exit. You do not write any shutdown code for this case.
`handle.whenComplete()` resolves at that moment, so a script can simply
`await` it.

An **infinite** source never ends on its own. An MQTT subscription keeps
producing for as long as the broker keeps sending. The only way such a flow
stops is that you stop it — call `handle.shutdown()`, or let a process
signal (SIGINT/SIGTERM) do it. A dropped connection does not end the flow
either: the source stays alive and reconnects (see each source's
"Connection behavior").

Which shipped source is which:

| Source | Kind | How it ends |
|--------|------|-------------|
| CSV | Finite | End of file → flow shuts down automatically |
| testHarness | Finite | Last generated message → flow shuts down automatically |
| MQTT | Infinite | Only on `handle.shutdown()` or a process signal |

One switch controls the automatic part: `shutdownOnComplete` (finite
sources only). Inside a flow you never need to touch it — the runtime
manages it and drives the shutdown itself. It exists for programs that call
a source's `start()` directly, without a flow around it: set
`shutdownOnComplete: false` there if you want to decide yourself what
happens after the data ends.

A flow with no source at all is the third arrangement — you feed messages
in yourself. That is covered in [Headless Flows](../headless-flow.md),
including how `whenComplete()` behaves without a source.

#### CSV Source

Streams CSV files row-by-row for replay, testing, and batch analysis.

```javascript
import { csv } from '@winkjs/composer';

flow('replay')
    .source(csv, {
        path: './sensor-data.csv',
        delayMs: 100,
        dynamicTyping: true,
        transform: ( row ) => row,
        startMsgId: 100,
        endMsgId: 500
    })
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | string | required | Path to CSV file |
| `delayMs` | number | `0` | Delay between messages in ms (simulation pacing) |
| `dynamicTyping` | boolean | `true` | Auto-cast `"123"` → number, `"true"` → boolean, `""` → null |
| `transform` | function | `null` | Per-row transform: `( row ) => transformedRow`; return `null`/`undefined` to drop the row (only those two values mean drop). A throw skips that one row (`CALLBACK_FAILED`) and the stream continues. Ready-made transforms: [Stream Preparation](../stream-preparation.md) |
| `idField` | string | `null` | Field for range filtering (row index if omitted) |
| `startMsgId` | number\|string | `null` | Start at this id/row (inclusive) |
| `endMsgId` | number\|string | `null` | Stop after this id/row (inclusive) |
| `shutdownOnComplete` | boolean | `true` | Auto-shutdown pipeline when file ends |
| `onStatus` | function | `null` | Called with status updates while streaming. When the file finishes, it receives one payload with `phase: 'complete'`, whose `count` field is the number of messages produced |

**Behavior:**
- Streaming via Node.js `readline` — memory-efficient for large files
- Auto-delimiter detection: tries tab, semicolon, then comma
- Supports quoted fields with escaped quotes
- One-shot: no reconnection (file source)
- A row that cannot be read is skipped and reported; the stream continues.
  "Cannot be read" means the row's structure is broken — its field count
  does not match the header, or a quoted field never closes. Each skip is
  reported through `onStatus` as a `DECODE_ERROR`, and the final completion
  event carries the total in `skipped`. A row that parses fine but holds a
  garbage value is NOT skipped — it flows through for the pipeline
  (`sanitize`) to judge.
- Your `transform` gets the same protection: if it throws on a row, that
  one row is skipped and reported through `onStatus` as a
  `CALLBACK_FAILED` (fix the transform — the report names the row), and
  the stream continues. Rows your transform drops (returns
  `null`/`undefined`) and rows it threw on are counted in the completion
  event's `skipped` alongside malformed rows, so `count + skipped`
  covers every data row read.

**Message format:** Object with CSV header fields as keys, values dynamically typed.

#### MQTT Source

Subscribes to MQTT topics for real-time data ingestion. Designed for Layer 2 aggregator flows consuming events from upstream flows.

```javascript
import { mqttSource, msgpackCodec } from '@winkjs/composer';

flow('aggregator')
    .source(mqttSource, {
        brokerUrl: 'mqtt://broker:1883',
        topics: ['edge/+/enriched', 'edge/alerts'],
        codec: msgpackCodec,
        clientId: 'composer-agg-001',
        cleanStart: false
    })
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `brokerUrl` | string | required | MQTT broker URL (`mqtt://` or `mqtts://`) |
| `topics` | string\|string[] | required | Topic(s) to subscribe (supports `+` and `#` wildcards) |
| `codec` | object | `JSON.parse` | Codec with `unpack( payload )` method |
| `dedupWindowMs` | number | `120000` | Dedup time bound: a duplicate arriving within this window of its original is dropped |
| `dedupMaxEntries` | number | `65536` | Dedup memory cap (~8 MB worst case); at high rates the effective window is this count divided by the message rate |
| `clientId` | string | auto-generated | MQTT client identifier. Set a fixed name in production — the broker files the persistent session's saved backlog under it, and an auto-generated name changes on every restart. See [Resilience](../resilience.md) |
| `cleanStart` | boolean | `false` | `false` = resume persistent session; `true` = fresh start |
| `transform` | function | `null` | Per-message transform: `( msg ) => transformedMsg`; return `null`/`undefined` to drop the message (only those two values mean drop). A throw skips that one message (`CALLBACK_FAILED`) and the stream continues. Ready-made transforms: [Stream Preparation](../stream-preparation.md) |
| `onStatus` | function | `null` | Structured status callback — see [Watching a source](./observability.md#watching-a-source-status-and-metrics) |
| `onMetrics` | function | `null` | Counter-snapshot callback, about once per second — see [the metrics channel](./observability.md#the-metrics-channel-onmetrics) |
| `expectedQuietPeriodMs` | number | off | Opt-in: report yellow when no packet arrives for longer than this. Set it only if your stream should never be quiet |
| `mqttConnectFn` | function | `mqtt.connect` | Advanced: inject a custom MQTT connect function (tests, benchmarks) |

Config is checked when the flow is defined, before anything runs. A misspelled
option name (say `brokerURL` instead of `brokerUrl`) is rejected with an
"Unknown property" error instead of being silently ignored.

**Connection behavior:**
- MQTT v5 with QoS 1 subscriptions
- Persistent sessions (7-day expiry) — the broker queues messages while composer is away, and delivers them only if composer returns under the same fixed `clientId` (see [Resilience](../resilience.md))
- Auto-reconnect with backoff (5s intervals)
- Keepalive: 60s

**Deduplication:**

MQTT's QoS 1 delivery means "at least once": after a connection break,
a message can arrive a second time. The source drops these repeats so
the pipeline sees each message once.

- Every message composer's MQTT emitter publishes carries a
  `winkDedupId` — a unique id stamped into the message metadata. A
  re-send carries the same id as the original, so the source
  recognizes it and drops it.
- A repeat is caught when it arrives within `dedupWindowMs` of the
  original. The default is 2 minutes, which covers a typical reconnect
  outage. A repeat arriving later is treated as new — a broker still
  retrying after 2 minutes has almost certainly given up.
- The source remembers at most `dedupMaxEntries` ids (default 65,536,
  about 8 MB of memory). This cap is the memory guarantee. When
  messages arrive faster than about 550 per second, the cap — not the
  clock — decides how far back the source remembers: the effective
  window becomes the cap divided by the message rate.
- A message without an id is always processed. The source never
  guesses identity from message content, because two identical
  payloads are often two real readings. Publishers that don't stamp
  ids (a third-party gateway, or anything on MQTT 3.1.1) therefore get
  plain at-least-once delivery: after a reconnect, a genuine re-send
  is processed twice.
- The id memory lives in process memory. If the source crashes after
  processing a message but before acknowledging it, the broker
  re-sends that message on restart and it is processed once more — at
  most one repeat per crash.

**Message format:** Decoded payload enriched with `_topic` and `_dedupId` metadata fields.

#### Source and Emitter Comparison

| Feature | CSV Source | MQTT Source | MQTT Emitter | Terminal Emitter |
|---------|-----------|------------|-------------|-----------------|
| **Use case** | Replay, testing | Aggregation | Production output | Debug |
| **Reconnect** | No (one-shot) | Auto (5s) | Auto (5s) | N/A |
| **Persistence** | N/A | Session (7d) | In-memory buffer | None |
| **Dedup** | None | Drops repeats (2-min window) | Adds dedupId | None |
| **Circuit breaker** | None | None | None | None |
| **Backpressure** | `delayMs` pacing | None | Queue pressure | None |

#### What a crash costs — the durability label

Every adapter declares a one-word durability label. It answers one question:
if the process crashes, what happens to data the adapter had accepted but not
yet delivered? For a source the same label describes the input it can recover
after a disconnect.

The four labels, in plain words:

- `in-memory` — accepted data sits in process memory; a crash loses whatever
  was not yet delivered.
- `wal-backed` — accepted data sits in an on-disk store local to the process;
  a crash recovers it on restart.
- `broker-queue` — a broker holds the data; a crash of this process loses
  nothing the broker still has.
- `best-effort` — no recovery promise at all beyond the immediate write.

What each shipped adapter declares:

| Adapter | Label | What that means for you |
|---------|-------|-------------------------|
| CSV source | `best-effort` | The file is replayable, but the source does not resume mid-file after a crash. |
| MQTT source | `broker-queue` | The persistent broker session holds subscribed messages during a disconnect and replays them on reconnect. |
| testHarness source | `best-effort` | A crashed run is simply re-generated (same seed, same messages). |
| MQTT emitter | `in-memory` | Accepted messages wait in memory until the broker acknowledges them; a crash loses whatever is unacknowledged. The shutdown drain reports any such loss with an exact count. |
| Terminal emitter | `best-effort` | Nothing is buffered beyond the stdout write. |
| QuestDB storage | `in-memory` | Rows wait in a memory buffer until flushed to the server; a crash loses un-flushed rows. The shutdown drain reports any such loss with an exact count. |

The flow refuses to start with an adapter that does not declare its label —
so the answer to "what does a crash cost here" always exists.

---

### storage

Registers a persistence adapter for storing messages. Nodes like `persistIf` reference storage adapters by name (the adapter's `id`).

```javascript
.storage( adapter, config )
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `adapter` | object | Yes | Imported adapter module (must have `id` and `createStorage()`) |
| `config` | object | No | Adapter-specific configuration |

```javascript
import { questdbAdapter } from '@winkjs/composer';

flow('pipeline')
    .storage(questdbAdapter, {
        tablePrefix: 'prod',
        ilpUrl: 'localhost:9000',
        pgUrl: 'localhost:8812'
    })
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ilpUrl` | string | `localhost:9000` | ILP endpoint for writes (`host:port`) |
| `pgUrl` | string | `localhost:8812` | PostgreSQL endpoint for table creation (`host:port`) |
| `tablePrefix` | string | asset class name | Prefix for table names (`{tablePrefix}_{insightType}`) |
| `flushMode` | string | `'auto'` | `'auto'` lets the client flush on a row or time trigger; `'manual'` flushes on an idle timer |
| `idleFlushAfterMs` | number | `5000` | Idle time before a manual-mode flush |
| `idleFlushCheckMs` | number | `1000` | How often the idle timer checks |
| `autoFlushRows` | number | client default | Rows buffered before an auto-flush |
| `autoFlushIntervalMs` | number | client default | Time before an auto-flush |
| `maxBufSize` | number | client default | ILP send-buffer size in bytes |
| `retryTimeout` | number | client default | How long the client retries a failed send |
| `partitionBy` | string | — | Partitioning when the adapter creates a table: `NONE`, `HOUR`, `DAY`, `WEEK`, `MONTH`, or `YEAR` |
| `onWarning` | function | `null` | Called with non-fatal storage warnings |
| `onDeliveryFailure` | function | `null` | Called when a write ultimately fails. Guarded: if your handler itself throws or rejects, the adapter keeps running and the fault is reported once as a `CALLBACK_FAILED` console line |

The `ilpUrl` and `pgUrl` values fall back to the `QUESTDB_ILP_URL` and `QUESTDB_PG_URL` environment variables when omitted. See [Environment Variables](../environment-variables.md).

Config is checked when the flow is defined, before anything connects. A
misspelled option name (say `illpUrl` instead of `ilpUrl`) is rejected with an
"Unknown property" error instead of being silently ignored. `assetClass` is
not a config option — it reaches the adapter through the flow's
`.assetClass()` call, and supplying it here is rejected the same way.

**Table naming convention:** `{tablePrefix}_{insightType}`. The table prefix defaults to `assetClass.name`; override it via `tablePrefix` in config.

| Asset Class | Table Prefix | Insight Type | Table Name |
|-------------|--------------|--------------|------------|
| rwmPump | rwmPump (default) | operational | rwmPump_operational |
| rwmPump | factory1 (override) | operational | factory1_operational |

**What each column accepts:**

Every value is checked before the row is opened, so one bad value can never wedge the writer mid-row.

| Column type | Accepted | Anything else |
|-------------|----------|---------------|
| `float64` | finite numbers | column skipped, warning raised |
| `int64`, `timestamp` | integers and bigints | column skipped, warning raised |
| `string` | strings | column skipped, warning raised |
| `bool` | booleans | column skipped, warning raised |

A skipped column is simply not written for that row, so it reads as NULL in QuestDB. The rest of the row still persists. The warning goes to your `onWarning` function and names the column, the reason, the insight type, and the asset.

A missing or invalid designated timestamp skips the whole row — with a warning — before anything is written.

Worked example: `temp` is a `float64` column and a message arrives with `temp: "hot"`. The adapter writes the other columns, leaves `temp` unwritten, and calls `onWarning` with:

```text
column 'temp' is wrong-typed (expected float64, received string) in insightType 'monitoring' (asset: pump-3) — column skipped
```

**Strict mode.** An `onWarning` that throws turns every warning into a refusal: the row is rejected before the writer touches it, and the sender stays clean. Use this when a partial row is worse than no row. For this reason `onWarning` is deliberately not guarded. Your throw is the instruction, so composer never contains it.

**Shutdown reports the delivery outcome exactly.** A clean resolve from the adapter's `shutdown()` means every buffered row was flushed. When rows remain — the final flush failed, or a hung flush outlived the shutdown budget — shutdown rejects with a classified error (`DELIVERY_FAILED` or `SHUTDOWN_TIMEOUT`) carrying the exact count in `dropped: { count }`. Inside a flow, the framework catches this rejection and logs it — one classified line naming the storage, the code, and the count — so the flow's own shutdown still completes for the other sinks.

**A failed startup names its cause.** When the adapter cannot start, the error's `code` tells you which of two different problems you have — so you fix the right thing:

| Code | What happened | What to do |
|------|---------------|------------|
| `TRANSPORT_UNREACHABLE` | The PostgreSQL endpoint did not answer — nothing listening, host unresolvable, or the attempt timed out | The config may be fine. Check the network, the firewall, and whether QuestDB is running |
| `INVALID_CONFIG` | The config itself does not work — a required URL is missing, credentials were rejected, a column declares an unsupported type | Fix the storage config or the `QUESTDB_*` environment variable it fell back to |
| `MISSING_ASSET_CLASS` | The flow never called `.assetClass()` | Add the asset class to the flow |

The underlying error is preserved on `err.cause` for diagnostics either way.

Persist plans are compiled at startup, so writes add no overhead during message processing.

---

## Identity

### assetClass

Registers the semantics definition for storage schema validation. The asset class defines columns, types, units, limits, and insight types. See [Semantics](../semantics/index.md) for complete schema documentation.

```javascript
.assetClass( definition )
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `definition` | object | Yes | Asset class object from `loadSemantics()` |

```javascript
import { loadSemantics } from '@winkjs/composer';

const semantics = await loadSemantics('./semantics');
const assetClass = semantics.assetClasses.rwmPump;

flow('monitor')
    .assetClass(assetClass)
```

---

### assetId

Sets the per-asset isolation field. Each unique value in this field gets its own isolated pipeline instance with independent state. A pump with `assetId('machineId')` creates separate state for every distinct `machineId` in the message stream.

```javascript
.assetId( field )
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `field` | string | Yes | Message field name (must be a valid identifier) |

```javascript
flow('fleet-monitor')
    .assetId('machineId')
    // Each machine gets independent smoothing, thresholds, etc.
    .esMean('smooth', 'temperature', { mean: 'avg' })
```

---

## Output Naming

Multi-field output naming is automatic and fixed — there is no method to configure it. When a node processes an array of fields, each output is named `field_label`: the input field, an underscore, then the label from the stats object (for example, `temperature_avg`). See [Multi-Field Mode](../flow-language.md#multi-field-mode-array-input).

To repeat a multi-node chain across a field list, use [`forEach`](../flow-language.md#repeating-a-chain-across-fields-with-foreach).

---

## Specialization

All flows are **linear** — messages pass through nodes in order. Specialization selects which entire linear pipeline runs for each message based on a field value. It does not create branches within a pipeline.

### groupBy, endGroup

Syntactic sugar for creating specialized pipelines that share the same node structure but with different tuning parameters. Expands to `switch`/`case`/`break` internally.

```javascript
.groupBy( field, values )
    // ... template nodes (with tunable parameters) ...
.endGroup()
```

| Method | Parameters | Description |
|--------|-----------|-------------|
| `.groupBy( field, values )` | `field`: string, `values`: array | Routing field and at least 2 group values |
| `.endGroup()` | — | Expands templates into one case per value |

**Expansion rules:**
- Node names are prefixed: `'ph'` → `'idle_ph'`, `'low_ph'`, `'cruise_ph'`
- Tunable helpers like `lookupByField` resolve to concrete values per group
- Trigger targets are prefixed to match expanded node names
- Output field names (`storeAs`) are **not** prefixed — they remain identical across groups

```javascript
import { lookupByField } from '@winkjs/composer';

flow('rpm-analysis')
    .assetId('machineId')
    .groupBy('rpmBand', ['idle', 'low', 'cruise'])
        .pageHinkley('ph', 'r2', { phShift: 'shift' }, {
            lambda: lookupByField('rpmBand', { idle: 3.4, low: 3.2, cruise: 2.4 })
        })
    .endGroup()
    .run();
```

This expands to the equivalent of:

```javascript
.switch('rpmBand')
    .case('idle')
        .pageHinkley('idle_ph', 'r2', { phShift: 'shift' }, { lambda: 3.4 })
    .break()
    .case('low')
        .pageHinkley('low_ph', 'r2', { phShift: 'shift' }, { lambda: 3.2 })
    .break()
    .case('cruise')
        .pageHinkley('cruise_ph', 'r2', { phShift: 'shift' }, { lambda: 2.4 })
    .break()
```

---

### switch, case, break

Defines multiple independent pipelines, each handling a different value of a routing field. The message field value selects which pipeline runs — only one pipeline executes per message.

```javascript
.switch( field )
.case( key )
    // ... nodes for this case ...
.break()
.case( key )
    // ... nodes for this case ...
.break()
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.switch( field )` | `field`: string | Message field for routing (must differ from `assetId` field) |
| `.case( key )` | `key`: string\|number | Unique value that selects this pipeline |
| `.break()` | — | Ends the current case |

**Rules:**
- `.switch()` must be called before any processing nodes
- Each `.case()` must end with `.break()`
- Each case must contain at least one node
- Case keys must be unique
- Cannot be combined with `.groupBy()`

```javascript
flow('multi-mode')
    .assetId('machineId')
    .switch('operatingMode')

    .case('normal')
        .esMean('smooth', 'temperature', { mean: 'avg' })
        .threshold('check', 'avg', { active: 'alarm' }, { mode: 'above', threshold: 80 })
    .break()

    .case('maintenance')
        .esStats('diag', 'vibration', { mean: 'avg', stdev: 'std' })
    .break()

    .run();
```

When a message arrives with `operatingMode: 'normal'`, it runs through the first pipeline. A message with `operatingMode: 'maintenance'` runs through the second. Messages with unrecognized values are skipped.

---

## Lifecycle

### run

Wires the pipeline and starts processing. Returns a handle for monitoring and shutdown.

```javascript
const handle = await flow('pipeline')
    .source(csv, { path: './data.csv' })
    .esMean('smooth', 'temperature', { mean: 'avg' })
    .run();
```

**Return value:**

| Property | Type | Description |
|----------|------|-------------|
| `flowName` | string | The name passed to `flow()` |
| `shutdown()` | async function | Stops the source, drains the emitters, then drains the storage. A sink that cannot deliver in time does not fail the flow's shutdown: the framework logs one classified line naming the sink, the error code, and the exact undelivered count, and the other sinks still drain. The promise rejects only when a drain stage itself fails — for example, a source that refuses to stop. Safe to call more than once: every call returns the same outcome. For programmatic delivery-failure handling, configure `onDeliveryFailure` on the emitter or storage. |
| `processMessage( msg )` | function | Feed one message yourself, when the flow has no source. Returns nothing on the fast path, and a Promise to await on a yield. See [Headless Flows](../headless-flow.md). |
| `whenComplete()` | function | Returns a Promise that resolves when a finite source reaches its natural end, or when shutdown is called. On a flow with no source it resolves immediately at `.run()`. See [Finite and infinite sources](#finite-and-infinite-sources). |
| `getStats()` | function | Returns a fresh snapshot of the flow's routing counters: dropped messages and partition counts. See [Observability → Flow counters](./observability.md#flow-counters). |

**Single flow per process:** When `.run()` starts, it registers shutdown handlers for SIGINT and SIGTERM. This means one running flow per process. For per-asset isolation, use `.assetId()`. For different pipeline shapes, use `.switch()`/`.case()`. For truly independent flows, use separate processes.

---

### validate

Checks the flow definition for configuration errors before running. Returns `{ valid: boolean, errors: string[] }`. Validation also runs automatically when you call `.run()` — use `.validate()` when you want an explicit pre-flight check.

**Three rules are checked:**

| Rule | What it catches |
|------|----------------|
| **Targets exist** | A controller trigger references a node name that doesn't exist in the flow |
| **No loops** | Controller A targets B, and B targets A — creating a cycle |
| **Methods supported** | A trigger uses a control method that the target node doesn't support (e.g., `flush` on a node that only supports `reset`, `enable`, `disable`) |

```javascript
const result = await flow('pipeline')
    .esMean('smooth', 'temperature', { mean: 'avg' })
    .controller('ctrl', [{
        when: msg => msg.avg > 100,
        triggers: [{ control: 'reset', targets: ['smooth'] }]
    }])
    .validate();

if ( !result.valid ) {
    console.error(result.errors);
}
// Example errors:
//   "Node 'ctrl' trigger[0] references unknown target 'missing'"
//   "Node 'ctrl' trigger[0] uses 'flush' but 'ES Mean' only supports: reset, enable, disable"
```

---

### yield

Sets how long the pipeline may process messages before offering the event loop a breath. After the threshold passes, the current message finishes processing and the flow hands its caller a Promise; awaiting it gives Node.js one full turn to run background work — storage flushes, MQTT delivery, console output. The message is always processed first; the pause comes after, so message order is never affected.

This matters only when something feeds the flow in a tight loop and waits on each message: a CSV replay at full speed, or the [headless driver](../headless-flow.md) over in-memory data. A flow fed by the MQTT source gets its event-loop turns naturally, one per incoming message — for such flows this setting changes nothing.

```javascript
.yield( { threshold } )
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `threshold` | number | `500` | Milliseconds between event-loop breaths; `Infinity` disables yielding |

The default comes from the `YIELD_TIME_THRESHOLD_MS` environment variable (see [Environment Variables](../environment-variables.md)); `.yield()` overrides it for one flow. Most flows never need either — the default keeps replays healthy and costs at most two briefly deferred messages per second. Set `Infinity` only where you deliberately want no yielding at all, such as a benchmark measuring raw pipeline speed:

```javascript
flow('replay-benchmark')
    .yield({ threshold: Infinity })
    .source(csv, { filePath: './readings.csv' })
    .esMean('smooth', 'temperature', { mean: 'avg' })
    .run();
```

---

### build (**internal**)

Compiles the flow definition into a JavaScript module containing the node specs. Returns the generated source as a string. The output includes only the node specifications — source, emitter, storage, and partition wiring are not included.

---

### inspect (**internal**)

Returns a structured object describing the flow — node names, types, runtime configuration (sources, emitters, storage, partitioning). Used by framework tooling such as the create-flow skill.
