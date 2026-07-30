# MQTT Source — Baseline Benchmark

Measures the throughput, latency, GC pressure, and long-run memory behaviour
of `src/core/source-manager/mqtt/client.js` as-shipped. No changes to the
client are permitted while a baseline is being collected — the whole point is
a fixed reference we can measure *against* later.

---

## What is measured

1. **Throughput** — messages per second delivered to the `onMessage` handler,
   under both unthrottled "best effort" load and steady-state target rates.
2. **Latency** — enqueue → `onMessage` delivery distribution (stub harness,
   hrtime precision); publish-wallclock → `onMessage` wallclock (broker
   harness, millisecond precision).
3. **GC pressure** — count and total pause time of minor/major collections
   during steady-state runs. Sampled via `perf_hooks` `PerformanceObserver`
   with `entryTypes: ['gc']` (no `--trace-gc` stderr parsing needed).
4. **Heap trajectory** — `heapUsed` / `heapTotal` / `external` / `rss`
   sampled once per second across the run.
5. **Leak behaviour** — long-running test with periodic heap snapshots
   (`v8.writeHeapSnapshot()`) for retention diffing.

## Two harnesses, two purposes

| Harness              | Broker? | What it isolates                                                  |
|----------------------|---------|-------------------------------------------------------------------|
| `harness-stub.js`    | No      | Composer's own code path (decode, dedup, mutation, dispatch)      |
| `harness-broker.js`  | Yes     | End-to-end: mqtt.js packet parser + TCP + broker + our code       |

The delta between the two tells you how much of the ceiling is owned by the
`mqtt.js` library and TCP stack, versus composer's own per-message work.

## Prerequisites

- Node.js ≥ 22 (this baseline was taken on v22.16.0)
- Mosquitto reachable on `mqtt://localhost:1883` for the broker harness.
  A default Eclipse Mosquitto Docker image is sufficient:

      docker run -d --name mosquitto -p 1883:1883 eclipse-mosquitto:latest

  Session persistence is not required — the harness passes `cleanStart: true`.

## How to run

From `composer/`:

```bash
# Stub harness — best-effort (unthrottled) throughput with 1KB JSON payloads
node benchmark/mqtt-source/harness-stub.js --payload 1024 --duration 30

# Stub harness — steady-state at 10k msg/sec with 100B payloads
node benchmark/mqtt-source/harness-stub.js --payload 100 --rate 10000 --duration 30

# Broker harness — equivalent runs
node benchmark/mqtt-source/harness-broker.js --payload 1024 --duration 30
node benchmark/mqtt-source/harness-broker.js --payload 100 --rate 10000 --duration 30

# Leak test — 10 minute sustained run with heap snapshots
node --expose-gc benchmark/mqtt-source/leak-test.js

# Full sweep (all cells)
bash benchmark/mqtt-source/run-all.sh
```

Each run writes a CSV row to `results/` and prints a human-readable summary.

## Flags

| Flag              | Default  | Meaning                                                         |
|-------------------|----------|-----------------------------------------------------------------|
| `--payload <N>`   | `1024`   | Approximate payload size in bytes (100, 1024, 10240 recommended)|
| `--rate <N>`      | `0`      | Target messages/sec. `0` = unthrottled best-effort              |
| `--duration <S>`  | `30`     | Steady-state measurement window (seconds). Excludes 5s warmup   |
| `--dedup`         | `true`   | Include `winkDedupId` in user properties                        |
| `--broker <url>`  | `mqtt://localhost:1883` | Broker URL (broker harness only)                 |
| `--topic <t>`     | `bench/mqtt-source` | MQTT topic (broker harness only)                     |

## Output

- `results/stub-<timestamp>.csv` / `results/broker-<timestamp>.csv` — one row per run with
  env, params, throughput, latency percentiles, GC stats, heap deltas.
- `results/leak-<timestamp>/heap-*.heapsnapshot` — heap snapshots for diffing in
  Chrome DevTools (Memory tab → Load).
- `results/` is gitignored (per-machine data). Only harness code and the
  committed `BASELINE.md` report are versioned.

## Reading the CSV

Columns, in order:

    timestamp, harness, rate, payload_bytes, duration_s,
    throughput_msg_s, latency_p50_us, latency_p95_us, latency_p99_us, latency_max_us,
    gc_minor_count, gc_major_count, gc_total_pause_ms, gc_max_pause_ms,
    heap_used_start_mb, heap_used_end_mb, rss_start_mb, rss_end_mb

(`us` = microseconds. For the broker harness, latency is recorded in ms
and converted; resolution is limited to ms by wall-clock timestamps.)

## When to re-run

- After any change to `src/core/source-manager/mqtt/**`.
- After any `mqtt` npm dependency bump.
- After any Node.js major version upgrade (V8 GC behaviour changes).

Compare the resulting CSV rows against `BASELINE.md` to see the delta.

## Known limitations (first baseline)

- Broker harness runs publisher and subscriber in the **same process**. This
  is a conservative ceiling — publisher work competes for CPU. If the single
  publisher cannot saturate the subscriber, split into two processes and
  re-run. Documented in `BASELINE.md`.
- Broker harness latency has millisecond resolution only (wall-clock).
- No Pi-class measurements yet. The M4 Max number is an *upper* bound; the
  interesting production ceiling is on edge hardware.
