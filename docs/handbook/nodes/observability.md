# Observability

Observability means being able to see what a flow is doing from the
outside. This chapter covers the machinery that provides it: the log
lines the framework prints, the status and metrics a source reports,
and the two output gates. The gates are `emitIf`, which publishes
results, and `persistIf`, which stores them. They live here because
they are how a flow's results become visible beyond the process.

## Framework log lines

A framework log line is a diagnostic message composer prints about its
own operation. Data output — the terminal emitter's rows — is not a
log line. Every log line follows one grammar:

```text
winkComposer/<module>: <message>
winkComposer/<module>: <message> [<CODE>]: <detail>
```

The prefix names the module that spoke. The bracket, when present,
echoes a stable error code. One real line, from `emitIf` refusing a
publish while the emitter's buffer is at its pressure limit:

```text
winkComposer/emitIf: publish failed (node=alert, insightType=faultAlert, code=STORAGE_FULL): Store at or above pressure limit (0.9) — cannot accept message
```

Two rules make these lines safe to build on. Programs match the code
on `err.code`, never the message text — messages can improve between
releases, codes cannot. And a wrapped failure reads as a chain: the
outer module's prefix, then the inner module's prefixed message as the
detail.

Four levels order the lines: `debug`, `info`, `warn`, and `error`. The
lowest level that prints comes from `COMPOSER_LOG_LEVEL`, defaulting
to `info` in production and `debug` everywhere else. A suppressed
level costs nothing at run time. Where the lines go — readable
console, JSON for log collectors, or nowhere — is picked once at
startup by `COMPOSER_LOGGER`. Composer never writes a log file
itself; your supervisor owns files. Both variables, the transports,
and the per-platform file routes are documented in
[Environment Variables](../environment-variables.md#the-logger-settings).

## Watching a source: status and metrics

A source reports its health through two callbacks you pass in its
config: `onStatus` and `onMetrics`. Both are optional. Without them the
source still protects you. A red failure inside a flow is logged by
the runtime, and error reports fall back to a classified log line.

### The status channel (`onStatus`)

Every status payload has the same shape:

```javascript
{
    status: 'green',        // 'green' | 'yellow' | 'red'
    connected: true,        // is the transport up right now
    phase: 'running',       // where in its life the source is
    msSinceLastMsg: 240     // how long since the last packet arrived
}
```

Error payloads add an `error: { code, message }` field. A forced stop
adds a `note` instead — it is a fact, not a fault.

Read the two fields together. The `status` is the severity: green means
healthy, yellow means degraded but working, red means an operator
should look now. The `phase` says whether the source is alive:
`offline` and `reconnecting` mean it is still trying; `stopped` means
it shut down. The MQTT source never gives up on its own — its library
retries forever — so a broken broker address shows up as a red status
whose `connected: false` never clears, not as a final failure.

The channel is quiet by design. A status is emitted only when
something changes; a reconnect storm that fails the same way five
hundred times produces one payload, not five hundred. There are two
exceptions: a message that could not be decoded, and a message your
`transform` threw on. Every one of those is reported individually,
because a silently skipped record is the one thing a streaming system
must never do.

### What the MQTT source can report

| Code | Severity | What it means | What to do |
|------|----------|---------------|------------|
| `DECODE_ERROR` | yellow | A payload could not be decoded and was skipped (one report per message). Also raised as a health flip when more than 1 % of the last 1,000 messages failed to decode | Check what the publisher is sending — the topic name is in the message |
| `CALLBACK_FAILED` | yellow | A function you supplied failed. Either your `transform` threw (that one message was skipped, one report per message), or your `onStatus` / `onMetrics` callback itself threw or rejected (the fault is contained and reported; the stream continues either way) | Fix the named function — the report carries the fault detail |
| `SUBSCRIBE_FAILED` | red | The broker refused the subscription. The source is connected but deaf | Check topic permissions (ACLs) on the broker |
| `CONNECT_FAILED` | yellow | A connection attempt failed; the library keeps retrying | Nothing yet — watch whether it heals |
| `CONNECTION_LOST` | red | Disconnected for more than 30 seconds and still trying | Check the broker, the network, the credentials |
| `QUIET_PERIOD_EXCEEDED` | yellow | No packet for longer than your configured `expectedQuietPeriodMs` | Check the publisher — the pipe is up but nothing is flowing |

The quiet-period rule is off unless you set `expectedQuietPeriodMs` in
the source config. Silence is normal for many sources; only you know
whether yours should never be quiet.

### The metrics channel (`onMetrics`)

When you supply `onMetrics`, the source calls it about once per second
(and on every health change) with a snapshot of its counters:

```javascript
{
    delivered: 41200,      // messages handed to your flow
    skipped: 37,           // received but not delivered (see below)
    decodeErrors: 2,       // payloads that could not be decoded
    reconnects: 1,         // successful re-connections since start
    dedupHits: 34,         // duplicates dropped
    dedupMisses: 41198,    // fresh ids accepted into the dedup cache
    dedupBypassed: 0,      // messages that carried no dedup id
    dedupCacheSize: 12040  // ids currently held by the dedup cache
}
```

The counters only ever go up — compare two snapshots to get a rate.
`skipped` is the sum of everything received but not delivered:
duplicates, decode failures, and messages your `transform` dropped
or threw on.

Two of these earn a special watch. A rising `dedupBypassed` means a
publisher is not stamping `winkDedupId` — that publisher's messages
are not protected against duplicates at all. And a duplicate being
dropped is *not* an error: it is QoS 1 doing its job, so it appears
here as `dedupHits`, never on the status channel.

---

## emitIf
A pass-through node that conditionally broadcasts messages to an external system. Every message continues downstream unchanged — emitIf only sends a copy when the predicate returns true.

The node always hands the copy to the emitter, even while the broker is unreachable. The emitter keeps undelivered messages in an in-memory buffer and sends them when the connection returns. Skipping the publish during a disconnect would keep messages out of that buffer — the exact loss it exists to prevent.

A failed publish is loud. The node logs the first failure of an episode and stays quiet until a publish succeeds. An episode is the stretch from a first failure to the next success.

**Type:** Condition-based
**Mode:** Single only
**Stats:** None (side effect only)
**Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `target` | string | Yes | Emitter target: `'mqtt'` or `'terminal'` (`'gpio'` upcoming) |
| `insightType` | string | Yes | Label for the emitted insight (used to construct the topic) |
| `annotate` | function | No | Shapes the payload before emission; receives `(msg)` and must return a plain object. When omitted, the full message is emitted. Any other return — `null`, an array, a string, a number — is rejected: nothing is published, and the node treats it exactly like a predicate throw. The function builds a fresh object on every firing: fine for a sparse event gate, a cost on a gate that fires per message — see [Reusing one record in annotate](#reusing-one-record-in-annotate) |

**Error handling:** Two failure kinds are tracked, both loud, each with its own episode.

- **The predicate or annotate throws.** Nothing is published for that message. A status signal goes to the target, the first error of the episode is logged, and repeats stay quiet until an evaluation succeeds. See [What Happens When a Predicate Throws](../flow-language.md#what-happens-when-a-predicate-throws).
- **The emitter refuses or breaks.** The node records the error's code and message, logs the first failure of the episode, and stays quiet until a publish succeeds. A typical line:

```text
winkComposer/emitIf: publish failed (node=alert, insightType=faultAlert, code=STORAGE_FULL): Store at or above pressure limit (0.9) — cannot accept message
```

The codes a publish can return: `STORAGE_FULL` (the emitter's buffer is at its limit — see [the queue ceiling](../environment-variables.md#the-mqtt-queue-ceiling-60000-messages)), `ENCODE_ERROR` (the codec could not encode the message; the message never entered the buffer), `SHUTTING_DOWN` (publish arrived during shutdown), and `MALFORMED_RESULT` (a third-party emitter broke its return contract; built-in emitters never produce this).

**Reset:** Resets emission counts and error tracking.

```javascript
// Broadcast critical faults to MQTT
.emitIf('alert',
    msg => msg.criticalFault,
    {
        target: 'mqtt',
        insightType: 'faultAlert'
    }
)

// Emit only selected fields using annotate
.emitIf('summary',
    msg => msg.confirmed,
    {
        target: 'terminal',
        insightType: 'cycleSummary',
        annotate: msg => ( { temp: msg.tempAvg, pressure: msg.pressureAvg } )
    }
)
```

---

## persistIf
A pass-through node that conditionally writes messages to storage. Every message continues downstream unchanged — persistIf only saves a copy when the predicate returns true.

The write hands the record to the storage adapter's buffer and returns at once, so the pipeline never waits on the database. The adapter flushes the buffer in the background.

A failed write is loud. The node logs the first failure of an episode and stays quiet until a write succeeds. An episode is the stretch from a first failure to the next success.

**Type:** Condition-based
**Mode:** Single only (evaluates predicate)
**Stats:** None (pass-through node)
**Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `insightType` | string | Yes | Label for the stored insight — maps to a storage table (defined in semantics) |
| `storageName` | string | Yes | Name of the storage adapter registered via `.storage()` |
| `annotate` | function | No | Shapes the record before it is written; receives `(msg)` and must return a plain object. When omitted, the full message is written. Any other return — `null`, an array, a string, a number — is rejected: nothing is written, and the node treats it exactly like a predicate throw. The function builds a fresh object on every firing: fine for a sparse event gate, a cost on a gate that fires per message — see [Reusing one record in annotate](#reusing-one-record-in-annotate) |

**Note:** Requires semantics configuration for schema definition. The stored row's timestamp always comes from the insight type's `designatedTimestamp` column in the message — the node has no say in it. See [Semantics](../semantics/index.md) and [storage](./configuration.md#storage).

**A typo in an annotate key is named once.** The storage layer writes only
the columns the asset class declares, so a key that is neither a declared
column nor a message field would vanish without a trace. On the gate's first
firing, the record's keys are checked, and every such key is named in one
warning. Keys copied in from the message (a `...msg` spread) are not named —
they are working fields, not typos.

**Error handling:** Two failure kinds are tracked, both loud, each with its own episode.

- **The predicate or annotate throws.** Nothing is written for that message. The first error of the episode is logged; repeats stay quiet until an evaluation succeeds. See [What Happens When a Predicate Throws](../flow-language.md#what-happens-when-a-predicate-throws).
- **The storage refuses or breaks.** The node records the error's code and message, logs the first failure of the episode, and stays quiet until a write succeeds. A typical line:

```text
winkComposer/persistIf: storage write failed (node=persistStats, insightType=washCycleStats, code=SEND_FAILED): <the storage client's error message>
```

The codes a write can return: `SEND_FAILED` (the storage client threw while building the row; the adapter recovers itself and the next write proceeds), `INVALID_INSIGHT_TYPE` (no persist plan exists for the name — a configuration error), `SHUTTING_DOWN` (write arrived after shutdown began), and `MALFORMED_RESULT` (a third-party adapter broke its return contract; built-in adapters never produce this).

**Reset:** Resets persistence counts and error tracking.

```javascript
// Persist wash cycle statistics when the mean has a valid value
.persistIf('persistStats',
    msg => msg.mean !== undefined,
    {
        storageName: 'questdb',
        insightType: 'washCycleStats'
    }
)

// Save state transitions — only write when a change was detected
.persistIf('saveTransition',
    msg => msg.stateChanged === true,
    {
        storageName: 'questdb',
        insightType: 'stateTransitions'
    }
)
```

---

## Reusing one record in annotate

`annotate` builds a fresh object every time the gate fires. For an event
gate that is fine: it fires a few times an hour, and a few small objects an
hour cost nothing. A **dense** gate is different. It fires on every message,
or nearly every message. On a dense gate, annotate creates one throwaway
object per message. The JavaScript engine has to clean those objects up.
That cleanup is called garbage collection, and on a small edge device it
takes processor time away from the pipeline.

There is a simple way out. Nothing requires annotate to return a *new*
object. The function may fill the same object on every firing and return
it. The object is created once, when the flow file loads. After that, no
firing allocates anything.

```javascript
// One record for this gate, created once when the flow file loads.
// The fixed values are written here, one time.
// The changing values are overwritten on every firing.
const eventRecord = {
    eventTime: null,     // the designated timestamp — never leave it out
    eventType: 'signFlip',
    severity: 'warning',
    value: null
};

const shapeEvent = function ( msg ) {
    eventRecord.eventTime = msg.eventTime;
    eventRecord.value = msg.activePower;
    return eventRecord;
};
```

The gate uses it like any other annotate:

```javascript
.persistIf('persistFlips',
    msg => msg.flipped === true,
    {
        storageName: 'questdb',
        insightType: 'powerEvents',
        annotate: shapeEvent
    }
)
```

**Why this is safe.** The pipeline processes one message at a time. Every
bundled sink reads the whole record inside the write call, before that call
returns. So by the time the next firing overwrites the record, nobody is
still reading it. One caution: a third-party sink must read the record the
same way — fully, inside the call. That requirement is part of the adapter
development standards. Check it before using this pattern in a flow with a
sink that did not ship with composer.

**Four rules keep the pattern correct.** Each one guards against a specific
mistake.

1. **Overwrite every changing field on every firing.** Suppose `value` were
   written only when the message carries one. On the next firing without a
   value, the record would still hold the previous message's number, and
   that stale number would be written to the database. Overwriting every
   changing field, every time, makes stale values impossible.
2. **Always fill the designated timestamp.** A record without it is not
   written at all. The row is skipped with a warning, and the data is lost.
3. **One record per gate.** Two gates write different columns. If they
   shared one record, each would overwrite the other's fields. Give every
   gate its own record.
4. **Give the record to nobody but the gate.** Do not push it into an
   array, and do not hand it to code that reads it later. Anyone who keeps
   the reference sees the values change on the next firing.

A misspelled key in the record is caught for you. On the gate's first
firing, every key that is neither a declared column nor a message field is
named in one warning — see the note in the persistIf section above.

The pattern works the same way on `emitIf`. The only difference is where
the record goes: to the broker instead of the database. The
designated-timestamp rule does not apply there.
