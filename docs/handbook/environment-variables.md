# Environment Variables

composer reads its runtime settings from environment variables. Two things hold for all of them:

- **They are validated once, at import, and fail fast.** When composer loads, it checks every variable. If one is malformed, it prints the errors and exits the process with code 1. A bad value stops startup rather than failing deep in a run.
- **Defaults are built in.** On a normal local stack you set none of these — the defaults already match the ports the services publish. Set a variable only to point at a different host or port, or to change a limit.

You can export these in the shell before a run, or keep them in a `.env` file and load it with `node --env-file=.env yourflow.js` (Node 20.6 or newer).

Most of these have an equivalent option you can pass directly in a flow — the source, emitter, and storage configs in [Configuration](./nodes/configuration.md). The environment variable is the fallback used when the option is omitted.

## Core

| Variable | Default | What it sets |
|----------|---------|--------------|
| `EDGE_DEVICE_ID` | machine hostname | Device identity; used in MQTT topics, so it must be topic-safe (letters, digits, `_ - / .`) |
| `NODE_ENV` | `development` | Run mode: `development`, `production`, or `test` |
| `COMPOSER_MAX_PARTITIONS_ALLOWED` | `10000` | Cap on isolated per-asset pipelines |
| `COMPOSER_MESSAGE_FAILURE_THRESHOLD` | `5` | Consecutive message failures before a flow stops — and before a repeatedly failing partition is quarantined. See [Resilience → When a node throws](./resilience.md#when-a-node-throws) |
| `SHUTDOWN_FORCE_TIMEOUT_MS` | `30000` | Deadline for graceful shutdown before a forced exit; matches Kubernetes' 30-second default |
| `YIELD_TIME_THRESHOLD_MS` | `500` | Longest stretch the pipeline runs before offering the event loop a breath; `Infinity` disables yielding. Per-flow override: [`.yield()`](./nodes/configuration.md#yield) |

### The yield threshold: when it matters

A flow processes messages synchronously. Background work — QuestDB flushes, MQTT delivery, console output — runs only when the event loop gets a turn. When a caller feeds messages in a tight loop and waits on each one (a CSV replay at full speed, the [headless driver](./headless-flow.md) over an in-memory array), the flow offers that turn itself: once this many milliseconds have passed, the current message finishes processing and the caller receives a Promise; awaiting it gives the event loop one full turn. The default, 500 ms, keeps those turns frequent enough that storage flush timers never wait long, and costs at most two deferred messages per second.

Flows fed by the MQTT source do not need this. Each incoming message already arrives through the event loop, so background work runs between messages on its own. For such flows the setting is inert — any value behaves the same. Set it to `Infinity` only where you deliberately want no yielding at all, such as a benchmark measuring raw pipeline speed.

## MQTT

| Variable | Default | What it sets |
|----------|---------|--------------|
| `MQTT_BROKER_URL` | `mqtt://127.0.0.1:1883` | Broker address; must start `mqtt://` or `mqtts://` |
| `MQTT_MSG_EXPIRY` | `3600` | Message time-to-live, seconds |
| `MQTT_KEEPALIVE` | `60` | Keepalive, seconds |
| `MQTT_RECONNECT_MS` | `5000` | Reconnect interval, milliseconds |
| `MQTT_CONNECT_TIMEOUT_MS` | `30000` | Connect timeout, milliseconds |
| `MQTT_CONNECT_GRACE_MS` | `500` | How long flow startup waits for the emitter's first broker acknowledgment, milliseconds. The wait ends the moment the broker answers; if it does not answer in time the flow starts anyway and messages buffer. `0` skips the wait. Per-flow override: the emitter's `connectGraceMs` option |
| `MQTT_SESSION_EXPIRY_S` | `604800` | Persistent-session expiry, seconds (7 days). Read by the MQTT source only — the emitter asks for a clean session, because a publish-only client has nothing for a broker session to keep |
| `MQTT_MAX_QUEUE_SIZE` | `10000` | Cap on undelivered messages held in memory (hard ceiling 60,000 — see below) |
| `MQTT_SOURCE_DEDUP_WINDOW_MS` | `120000` | Source-side duplicate filter: how long a message id is remembered (see below) |
| `MQTT_SOURCE_DEDUP_MAX_ENTRIES` | `65536` | Source-side duplicate filter: the most ids remembered at once (see below) |

### The MQTT queue ceiling: 60,000 messages

The MQTT emitter keeps every message it has not yet delivered in an in-memory buffer. During a broker outage, messages accumulate in the buffer and are sent when the connection returns. The buffer is process memory: if the process crashes or loses power, whatever is still undelivered is lost. At typical edge rates that is at most one burst, usually 0–2 messages.

The buffer can hold at most 60,000 messages. That ceiling is not a composer choice. Every undelivered MQTT message occupies a packet id, and a packet id is a 16-bit number — one connection can never carry more than 65,535 unacknowledged messages. composer stops at 60,000 to keep working room below the protocol limit. Setting `MQTT_MAX_QUEUE_SIZE` (or the emitter's `maxQueueSize` option) above 60,000 clamps it back to 60,000 and prints a warning.

The cap matters in exactly one situation: the broker is unreachable and messages keep coming. Two numbers decide how long you can ride that out. The **default cap is 10,000** (`MQTT_MAX_QUEUE_SIZE`), raiseable up to the 60,000 ceiling. And new publishes are refused once the buffer reaches **90% of its cap**, so the usable window is 0.9 × cap. How long that lasts depends only on your message rate:

| Message rate | Default cap (10,000) | At the 60,000 ceiling |
|--------------|----------------------|-----------------------|
| 1 msg/s | about 2.5 hours | about 15 hours |
| 10 msg/s | about 15 minutes | about 1.5 hours |
| 100 msg/s | about 90 seconds | about 9 minutes |
| 1,000 msg/s | about 9 seconds | about 54 seconds |

Three knobs when that is too short for your outages. Raise `MQTT_MAX_QUEUE_SIZE` toward the ceiling. Send fewer, richer messages: a digest node turns many raw ticks into one summary. Or split traffic across several emitters — each connection has its own 60,000.

The ceiling does **not** limit sustained throughput. While the broker is reachable, the number of unacknowledged messages equals your message rate times the broker's response time. Measured against a local broker at about 14,300 messages per second, that number stayed between 312 and 400 — nowhere near the ceiling.

When the buffer reaches 90% of its cap, new publishes are refused on the spot with a `STORAGE_FULL` error, instead of being accepted and dropped later. In a flow, `emitIf` reads that refusal and logs one line for the episode:

```text
winkComposer/emitIf: publish failed (node=alert, insightType=faultAlert, code=STORAGE_FULL): Store at or above pressure limit (0.9) — cannot accept message
```

### The source's duplicate filter: two knobs

MQTT delivers "at least once": after a connection break, the broker or an upstream emitter may send a message a second time. The MQTT source drops these repeats by remembering the ids of recently seen messages (each message from a composer emitter carries a unique id in its metadata).

Two limits control that memory, and whichever is reached first wins. `MQTT_SOURCE_DEDUP_WINDOW_MS` is the time limit: an id is remembered for 2 minutes by default, which covers a typical reconnect outage. A repeat arriving later than that is treated as a new message — a broker still retrying after 2 minutes has almost certainly given up. `MQTT_SOURCE_DEDUP_MAX_ENTRIES` is the memory limit: at most 65,536 ids are held, which costs about 8 MB in the worst case (measured 6.7 MB).

Below about 550 messages per second, the time limit is the one that matters. Above that rate the memory cap starts forgetting ids before their 2 minutes are up: the effective look-back becomes the cap divided by the message rate — about 6.5 seconds at 10,000 messages per second. That is still an order of magnitude wider than the burst a reconnect actually re-sends.

Only tagged messages are filtered. Messages from publishers that don't stamp ids pass through untouched — the source never guesses identity from message content, because two identical payloads are often two real readings.

## QuestDB

| Variable | Default | What it sets |
|----------|---------|--------------|
| `QUESTDB_ILP_URL` | `localhost:9000` | Write path — ILP over HTTP; `host:port` |
| `QUESTDB_PG_URL` | `localhost:8812` | Read and table-creation path — Postgres wire; `host:port` |
| `QUESTDB_FLUSH_MODE` | `auto` | `auto` or `manual` |
| `QUESTDB_IDLE_FLUSH_AFTER_MS` | `5000` | Idle time before a manual-mode flush |
| `QUESTDB_IDLE_FLUSH_CHECK_MS` | `1000` | How often the idle timer checks |
| `QUESTDB_AUTO_FLUSH_ROWS` | unset | Rows buffered before an auto-flush (client default when unset) |
| `QUESTDB_AUTO_FLUSH_INTERVAL_MS` | unset | Time before an auto-flush (client default when unset) |
| `QUESTDB_MAX_BUF_SIZE` | unset | ILP send-buffer size, bytes (client default when unset) |
| `QUESTDB_RETRY_TIMEOUT` | unset | Write-retry timeout (client default when unset) |
| `QUESTDB_DATABASE` | `qdb` | Database name |
| `QUESTDB_USER` | `admin` | User |
| `QUESTDB_PASSWORD` | `quest` | Password; may be empty for passwordless auth |
