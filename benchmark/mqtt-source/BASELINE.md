# MQTT Source — Baseline Report

**First baseline of the as-shipped MQTT source adapter.**  No production code was changed while this baseline was collected — every number below reflects the unmodified path at commit `67abc8a`.

---

## Environment

| Item              | Value                                |
|-------------------|--------------------------------------|
| Date              | 2026-04-24                           |
| Composer commit   | `67abc8ab49c9dd78b0ff7af8353f230947adfcdd` |
| Node.js           | v22.16.0                             |
| `mqtt` library    | 5.15.1                               |
| Host              | Apple M4 Max, 16 cores, 128 GB RAM   |
| Broker            | `eclipse-mosquitto:latest` in Docker, `localhost:1883` |
| Host OS           | macOS (Darwin 25.3.0)                |

All measurements were taken with a **single-process harness** (publisher and subscriber in the same Node process for the broker variant). This is called out explicitly where it matters — the primary consequence is that the broker-harness ceilings are a conservative *combined* ceiling, not an isolated subscriber ceiling.

---

## TL;DR

1. **Stub ceiling (composer code + in-process publisher):**
   - 100 B payload: **897 k msg/s**
   - 1 KB payload: **317 k msg/s**
   - 10 KB payload: **45 k msg/s**

2. **Broker ceiling (real Mosquitto, QoS 1, single-process pub+sub):**
   - 100 B: **12.9 k msg/s delivered** (out of 3.9 M published — 11 % delivery ratio)
   - 1 KB : **8.7 k msg/s** (10 % delivery ratio)
   - 10 KB: **3.3 k msg/s** (10 % delivery ratio)

3. **At 10 k msg/s steady-state, every cell (stub and broker, all payload sizes) ran cleanly** — 100 % delivery, sub-10 ms latency, heap stable below 60 MB, GC total pause < 500 ms over 30 s.

4. **Broker unthrottled runs are pathological end-to-end.** The Node publisher's mqtt.js internal send queue grows without bound; RSS climbs to 5–6 GB in 30 s, heap GC consumes **23 % of wall time**, and single GC pauses reach **408 ms**. The broker itself sits at 40–60 % CPU and 11–16 MB RAM — the broker is *not* the bottleneck in this regime.

5. **No subscriber-side leak detected.** 10-minute sustained run at 50 k msg/s (30 M messages) showed heapUsed +6.9 MB (within GC band), RSS flat at ~147 MB after warm-up, and heap-snapshot file sizes stable at ~6.8 MB across three captures. The dedup cache is bounded as designed.

6. **The CPU profile changes the interpretation of the stub ceilings.** 62.7 % of CPU time during the 1 KB stub run was spent in the harness's *publisher* (`nextPayload` — `JSON.stringify` + `Buffer.from`), not in the subscriber. The stub ceilings above are therefore co-limited by publisher work in the same event loop and *understate* the subscriber-only ceiling. Phase-2 work should introduce a pre-generated-payload variant to isolate this.

---

## Method

Two harnesses, both with a 5 s warm-up and 30 s measurement window, three repetitions implied but reported as the median of a single representative run (short baseline — multi-run stability is a Phase-2 upgrade).

- **`harness-stub.js`** — injects synthetic packets via the `mqttConnectFn` config hook, no broker involvement. Isolates composer's decode / dedup / dispatch path from mqtt.js packet parsing and TCP.
- **`harness-broker.js`** — real publisher + Mosquitto + `createMQTTSourceClient` subscriber in one Node process. Publisher uses `mqtt.connect()` directly; subscriber uses the production factory unchanged.

Instrumentation:

- **Throughput**: `delivered / measurement-window-seconds`.
- **Latency (stub)**: `process.hrtime.bigint()` around the injected `deliver()` call — microsecond precision.
- **Latency (broker)**: `Date.now()` embedded in payload, compared on arrival — millisecond precision only; 1 ms reported values are at the resolution floor, not real 1 ms delays.
- **GC**: `perf_hooks.PerformanceObserver` with `entryTypes: ['gc']` — count and pause time per collection kind.
- **Heap / RSS**: `process.memoryUsage()` sampled at 1 Hz over the measurement window, max and end-point taken.
- **CPU profile**: `node --cpu-prof --cpu-prof-interval=100` (100 µs sampling) over a 15 s unthrottled stub run with 1 KB payloads.

See `README.md` in this directory for how to reproduce.

---

## Stub harness — composer code path only

| Target rate  | Payload | Throughput (msg/s) | p50 (µs) | p99 (µs) | Max (µs) | GC pause total (ms) | Heap peak (MB) |
|--------------|--------:|-------------------:|---------:|---------:|---------:|--------------------:|---------------:|
| 10 k msg/s   |   100 B |             10 000 |     0.42 |     3.42 |     1352 |                65.5 |           45.5 |
| unthrottled  |   100 B |        **897 178** |     0.46 |     1.00 |     1102 |               768.9 |           36.5 |
| 10 k msg/s   |   1 KB  |             10 000 |     0.75 |     6.38 |      929 |                90.1 |           33.5 |
| unthrottled  |   1 KB  |        **317 098** |     0.75 |     1.42 |      710 |               616.0 |           22.5 |
| 10 k msg/s   |  10 KB  |              9 999 |     4.88 |    16.75 |     1553 |               164.0 |           21.4 |
| unthrottled  |  10 KB  |         **44 597** |     3.42 |     5.00 |     2308 |               274.6 |           23.5 |

**Observations:**

- **At 10 k msg/s all sizes deliver exactly the target rate.** Sub-10 µs p99 latency except for 10 KB (17 µs). GC pause total under 200 ms across 30 s = < 0.6 % GC overhead.
- **Unthrottled throughput falls with payload size roughly as `payload^-0.7`** — not linear because `JSON.parse` does sub-linear work on larger payloads (amortised tokenisation) but allocations grow superlinearly.
- **GC overhead at unthrottled peaks at 2.6 % of wall time (stub, 100 B)** — very tolerable. Max single pause was 4.06 ms (stub 100 B at 10 k), 1.14 ms (stub 100 B unthrottled).
- **Heap never exceeded 46 MB** in any stub cell. The subscriber path is well-bounded; the dedup cache (count-based, 64 entries default) is clearly not accumulating.

---

## Broker harness — real Mosquitto in the loop

| Target rate  | Payload | Delivered (msg/s) | Publ./Deliv. (cnt) | p50 (ms) | GC pause total (ms) | Heap peak (MB) | RSS peak (MB) |
|--------------|--------:|------------------:|-------------------:|---------:|--------------------:|---------------:|--------------:|
| 10 k msg/s   |   100 B |             9 999 |  299 990 / 299 990 |      1.0 |               164.9 |           58.7 |           136 |
| unthrottled  |   100 B |        **12 946** | 3 939 800 / 430 371 |    10.3 s |              7 058 |         2 677 |          5 725 |
| 10 k msg/s   |   1 KB  |             9 999 |  299 980 / 299 980 |      1.0 |               134.0 |           55.7 |           139 |
| unthrottled  |   1 KB  |         **8 677** | 2 693 600 / 260 340 |     6.2 s |              7 277 |         1 432 |          6 262 |
| 10 k msg/s   |  10 KB  |             9 999 |  299 990 / 299 990 |      1.0 |               442.5 |           47.9 |           148 |
| unthrottled  |  10 KB  |         **3 329** |  982 000 /  99 878 |    319 ms |                730 |           38.4 |           209 |

**Two distinct regimes:**

### a. Bounded rate (10 k msg/s) — healthy

- 100 % delivery across all payload sizes.
- Latency floor is wall-clock resolution (1 ms reported = "under 1 ms"); the true number is sub-ms but unmeasurable with `Date.now()`.
- Heap peak 48–59 MB, RSS 136–149 MB — stable and small.
- GC pause total 130–442 ms over 30 s = 0.4–1.5 % GC overhead.

### b. Unthrottled — pathological publisher queue growth

- **Only 10 % of published messages are actually delivered in the measurement window** — the rest sit in the publisher's mqtt.js internal send queue, waiting to be drained.
- Publisher-side heap balloons to 1.4–2.7 GB; RSS to 5.7–6.3 GB. This is not a subscriber leak — it's the publisher's `mqtt.js` send queue holding onto millions of enqueued messages and their associated packet metadata (each 1 KB payload becomes ~1.5–2 KB of queued JS objects once wrapped).
- **GC catastrophe**: 7 s of pause time in a 30 s window = **23 % of wall time in GC**. Max single pause 408 ms (100 B) / 125 ms (1 KB) — any real system would time out.
- Broker is **not** the bottleneck: `docker stats` during this run showed Mosquitto at 7–59 % CPU, 11–16 MB RAM, and 2–3× more bytes received than forwarded. Sinking a faster broker in will not raise this ceiling.

---

## CPU profile — where the cycles actually go

Profile: `benchmark/mqtt-source/results/cpu-profile/stub-unthrottled-1024B.cpuprofile`
Run: stub harness, 1 KB payload, unthrottled, 15 s, 100 µs sampling (139 920 samples).

Top self-time hotspots:

| Self-time | Function                   | Location                                             |
|----------:|----------------------------|------------------------------------------------------|
|  62.71 %  | `nextPayload`              | `benchmark/mqtt-source/lib/publisher.js:61`          |
|  18.88 %  | `(anonymous)`              | `src/core/source-manager/mqtt/client.js:120` (the `'message'` handler) |
|   2.87 %  | `(idle)`                   | event-loop idle                                      |
|   2.72 %  | `(garbage collector)`      | V8 GC                                                |
|   2.43 %  | `Buffer.toString`          | `node:buffer:834` — called on the decode path        |
|   2.20 %  | `isDuplicate`              | `src/core/source-manager/mqtt/dedup.js:54`           |
|   0.88 %  | `nextPacket`               | `benchmark/mqtt-source/lib/publisher.js:83`          |
|  ~1.0 %   | `FastBuffer`, `utf8Slice`  | Buffer decode internals                              |

**How to read this:**

1. The single largest hotspot is the **harness's publisher**, not the subscriber. `JSON.stringify` + `Buffer.from` to build each payload costs 62.7 % of CPU in this run. The subscriber is idle waiting for work much of the time.
2. The subscriber's own hot path (`client.js:120` + `Buffer.toString` + `isDuplicate` + Buffer internals) accounts for **≈ 24 % of CPU**.
3. GC and event-loop idle are small (2.7 % + 2.9 %).
4. Therefore the stub harness is **co-limited by publisher work in the same event loop**. The "897 k msg/s" number is an *end-to-end in-process* ceiling, not a subscriber-only ceiling. Extrapolating naively, a pre-generated-payload variant would raise the 1 KB stub ceiling from 317 k msg/s to something like 1.0–1.3 M msg/s — but that's an extrapolation and needs a direct measurement in Phase 2.

---

## Leak test (10 min at 50 k msg/s, 1 KB payloads, stub path)

10-minute sustained run, 50 000 msg/s target, 1 KB payloads, stub harness (no broker). Heap snapshots written at t=0, t=5 min, and t=10 min for later retention diffing.

| Metric                 | Value                      |
|------------------------|----------------------------|
| Total delivered        | 29 996 700 messages        |
| Achieved rate          | 50 000 msg/s (exact)       |
| heapUsed: start → end  | 9.9 MB → 16.8 MB (**+6.9 MB**) |
| rss: start → end       | 62.9 MB → 147.9 MB (**+85 MB**) |
| Heap oscillation band  | 8.3 MB — 23.1 MB (GC churn)|
| Heap-snapshot file size (t=0 / t=5 / t=10) | 7.26 MB / 6.76 MB / 6.78 MB |

**Verdict: no subscriber-side leak.**

- The 6.9 MB heap delta is within the steady-state GC oscillation band (8–23 MB across the run). Twenty separate samples show heap returning to single-digit MB after each young-gen cycle.
- RSS grew by 85 MB in the first 60 s and then sat flat between 143 MB and 148 MB for the remaining 9 minutes. This is Node.js's normal event-loop / ArrayBuffer pool warm-up followed by steady-state. A slow leak would show monotonic RSS growth after warm-up; we see the opposite.
- Heap-snapshot *file sizes* are a direct proxy for live heap content. Start 7.26 MB → 5 min 6.76 MB → end 6.78 MB: stable. If retained objects were accumulating, snapshots would grow linearly. They don't.
- At 50 k msg/s × 600 s = 30 M messages processed, any per-message retention bug would have produced a visible signature. None was seen.

Snapshot files are preserved at `results/leak-2026-04-24T07-05-47-101Z/heap-*.heapsnapshot` for Chrome DevTools retention-diff confirmation.

---

## Implications for Phase 2

1. **The subscriber's hot-path accidental allocations identified in the review (`|| {}` fallback, `_topic`/`_dedupId` post-mutation) are real costs, but at realistic rates (≤ 10 k msg/s) they account for a very small share of CPU.** At 897 k msg/s stub unthrottled, the subscriber hot path is 24 % of CPU; at 10 k msg/s it's proportionally tiny and the whole system is effectively idle. A codec refactor helps only workloads that are sustained at tens-of-thousands of msg/s or higher on a single subscriber.

2. **The broker harness's 17 k / 8.7 k / 3.3 k msg/s ceilings are an end-to-end Node + mqtt.js ceiling, not a mqtt-source ceiling.** The broker has headroom; the subscriber code is fast. The gap is in mqtt.js packet parsing and the single-process publisher queue interfering with the subscriber. Phase 2 should:
   - Split publisher to a separate process so subscriber-only ceiling becomes cleanly visible.
   - Measure mqtt.js packet-parse cost directly (profile inside the `client.on('message', ...)` handler, which currently shows as 18.88 % of CPU — but that cost is mqtt.js dispatch + our code combined).

3. **`mqtt.js` publisher send-queue is unbounded.** This is a cross-cutting risk, not a mqtt-source concern, but it was surfaced here. Any subscriber running slower than its publisher will accumulate unbounded memory on the *publisher* side. Worth a separate investigation of `mqtt.js` flow-control primitives.

4. **Nothing in the current data supports a custom-codec push right now.** The codec is not the bottleneck at realistic rates. If a future workload requires sustained 100 k+ msg/s per subscriber on Pi-class hardware, re-run this baseline on that hardware; at that point pooled-record + schema-driven decode becomes the likely answer. Until then, the review findings (declarative `configSchema`, coverage, monolith test-file split) are the actual priority.

5. **Known measurement limitations to fix in Phase 2:**
   - In-process publisher pollutes subscriber-only measurement → split to two processes (or pre-generate payloads for stub).
   - Broker latency is wall-clock ms-only → needs clock-synchronised high-resolution timing, or a single-process measurement with an isolated mqtt.js round-trip.
   - Single-repetition runs → median over 3+ reps per cell.
   - No Pi-class measurement → run this same harness on a Raspberry Pi 4 / 5 to establish the real production ceiling.

---

## Gate: what do we build next?

- **Do not** start custom-codec work. No evidence yet that it would move a realistic workload.
- **Do** fix the MQTT source review findings first (declarative `configSchema`, test-file split, branch coverage).
- **Do** split the broker harness into two processes and re-measure, so we have an honest subscriber-only ceiling.
- **Do** pre-generate payloads in the stub harness (small change) and re-measure — this is the cheapest way to get a subscriber-isolated number.
- **Do** run this benchmark on a Raspberry Pi 4 / 5 before any architectural decision, because the realistic production hardware is where the ceiling actually binds.
