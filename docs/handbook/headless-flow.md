# Headless Flows

Most flows own a source. A source is an adapter that reads data from outside and feeds it into the flow. A CSV file reader and an MQTT subscriber are sources. You name one with `.source()`, and the flow runs on its own.

A headless flow has no source. You feed it yourself. Everything after that point is unchanged. The nodes, the per-asset state, the emitters, and the storage all work exactly as they do in a flow that has a source.

## When to use one

Use a headless flow when:

- The data already lives in your own code, and you want to run it through a pipeline.
- Your input arrives over a protocol that has no source adapter yet.
- You are writing a test and want to control the exact messages.

If a built-in source adapter already fits, such as `csv` or `mqtt`, prefer `.source()`. It runs the read loop, the shutdown, and the end-of-data handling for you.

## The driver

Feed the flow with a driver. A driver is a small object, bound to one running flow, that hands messages to the flow one at a time and gets the awkward parts right for you. Create one with `headlessDriver( handle )`.

A driver has two methods, one for each way data reaches you:

- `feedAll( source )` — for data you pull. Give it any iterable: an array, a generator, an async generator, or a Node stream. It feeds every message in order and returns counts once the source is exhausted.
- `feedOne( msg )` — for data that arrives on its own. An event or callback hands you one message at a time, and you pass each to the flow.

Build the flow with no `.source()`, create a driver, feed it, and shut it down when the data is done.

```javascript
import { flow, headlessDriver } from '@winkjs/composer';

const handle = await flow( 'temperatureHealth' )
    .assetId( 'sensorId' )
    .esMean( 'smooth', 'temperature', { mean: 'avg' }, { halfLife: 10 } )
    .threshold( 'hot', 'avg', { active: 'isHot' }, { mode: 'above', threshold: 80 } )
    .run();                              // note: no .source()

const driver = headlessDriver( handle );

// Pull: feed an array, a file reader, a stream — anything iterable.
const { processed, failed } = await driver.feedAll( yourReader );
console.log( `${processed} processed, ${failed} failed` );

await handle.shutdown();
```

When data arrives on its own instead, feed one message at a time from the event handler:

```javascript
const driver = headlessDriver( handle, {
    onError: ( error, msg ) => console.error( 'message failed:', error.message )
} );

socket.on( 'reading', ( msg ) => driver.feedOne( msg ) );
socket.on( 'close',   () => handle.shutdown() );   // drain when the input ends
```

## What the driver handles for you

Two things are easy to get wrong when you feed a flow by hand. The driver gets them right.

**Awaiting at the right time.** The flow processes most messages and returns nothing. Once in a while it returns a Promise, which is the flow pausing to let other work run, such as storage writes. The driver awaits only on that pause, never on the common case. Awaiting every message would add a cost to every message, and at high rates that adds up.

**Catching faults.** A message can make a node throw. An example is a reading whose field cannot be parsed. The driver catches the fault, so one bad message never stops the feed. It hands the fault to your `onError` function and counts it in `failed`. If you give no `onError`, the driver logs each fault.

Your `onError` is guarded too. If it throws or rejects, the feed continues and the counters stay truthful. The driver reports each such fault as one classified `CALLBACK_FAILED` console line. A bug in your fault reporter costs you its output, never the feed.

The catch is needed because of how a flow without a source reports. A sourced flow contains a node fault itself and reports it red through the source's status channel. A headless flow has no such channel — your feeding code is the only listener. So the flow throws the fault straight back to the code that fed the message, and the driver is the catch that code needs.

User functions you supply, such as predicates, are a separate case. The node catches those for you before they ever reach the driver. See [Built-in Error Handling](./composition-patterns.md#built-in-error-handling).

## The message

Each message is a plain object. The field names are what the nodes read.

One field is special: the one you named in `.assetId()`. Composer keeps a separate copy of the pipeline for each value it sees in that field, so two sensors never share state. Put that field on every message.

Also include every field your nodes read. A message for the flow above needs `sensorId` and `temperature`:

```javascript
await driver.feedAll( [ { sensorId: 'pump-3', temperature: 91.4 } ] );
```

Extra fields are fine. Nodes ignore the fields they do not read. There is no fixed shape to match and no wrapper to fill in.

## Feed in order, one at a time

`feedAll` feeds messages in order and waits for each to finish before it starts the next. Order matters: a moving average or a change detector reads its inputs as a sequence.

If you feed messages yourself with `feedOne`, keep to the same rule — one at a time. Do not fire many `feedOne` calls at once on the same flow. The per-asset state is shared, and overlapping calls can let a later message reach the nodes before an earlier one.

## Shutting down

A flow with a source stops when the source runs out of data. A headless flow has no source, so it never stops on its own. You decide when the data is done. Two things shut the flow down, and most programs use both.

**You call `handle.shutdown()` when your data ends.** With `feedAll`, that is the line right after it returns. With `feedOne`, wire it to whatever ends your input, such as the socket's `close` event shown above. `shutdown()` flushes the emitters and the storage, so stop feeding before you call it. It is safe to call more than once.

**The process is asked to stop.** When you called `.run()`, the flow registered itself with the framework's signal handlers. So `Ctrl-C` (SIGINT) or `kill` (SIGTERM) drains every running flow and exits, with nothing wired by you. A long-running push service often relies on this alone and never calls `shutdown()` itself. If a drain runs longer than 30 seconds (`SHUTDOWN_FORCE_TIMEOUT_MS`), the process exits anyway, so a stuck sink cannot hang it forever.

The stop also sets the process exit code. Exit 0 means every flow drained clean. Exit 1 means the stop was forced by the timeout, or some flow's drain failed and lost buffered data. Each such loss is also printed as one classified console line. So a supervisor such as systemd or Docker can treat a data-losing stop as a failure.

Either path runs the same drain: stop the source if there is one, flush the emitters, then flush the storage.

**A delivery failure during the drain is loud, not fatal.** Each sink gets its full chance to deliver what it holds. When one cannot finish in time, the framework logs one classified line naming the sink, the reason, and the exact count — and the drain still completes for the other sinks. `handle.shutdown()` itself still resolves; it rejects only when a drain stage as a whole fails, such as a source that refuses to stop. The log line looks like this:

```text
winkComposer/wiring: emitter 'mqtt' shutdown failed [SHUTDOWN_TIMEOUT]: winkComposer/mqttEmitter: shutdown closed with 2 message(s) unacknowledged dropped={"count":2}
```

To handle delivery failures in code rather than by reading logs, give the emitter or storage an `onDeliveryFailure` function in its config — it is called with the classified error for each failure. See [Configuration](./nodes/configuration.md#emitter).

One sizing note for edge boxes. During a broker outage, undelivered MQTT messages wait in an in-memory buffer. The default cap is 10,000 messages (`MQTT_MAX_QUEUE_SIZE`, raiseable to 60,000), and new publishes are refused from 90% of the cap — so at defaults you can ride out about 2.5 hours of outage at 1 message per second, about 15 hours with the cap raised to the ceiling. The buffer is process memory, so a crash or power cut during the outage loses what it held. See [Environment Variables → the MQTT queue ceiling](./environment-variables.md#the-mqtt-queue-ceiling-60000-messages) for the full table and what to do when it is too short.

## `whenComplete()` tracks the source, not your feed

The handle has a `whenComplete()` method. It returns a Promise that resolves when the flow's **source** reaches its natural end. Only a finite source has one — see [Finite and infinite sources](./nodes/configuration.md#finite-and-infinite-sources). A `csv` source resolves it at the end of the file, and the runtime then shuts the flow down for you:

```javascript
const handle = await flow( 'replay' )
    .source( csv, { path: './data.csv' } )
    .esMean( 'smooth', 'temperature', { mean: 'avg' }, { halfLife: 10 } )
    .run();

await handle.whenComplete();   // resolves when the file reaches its end
await handle.shutdown();
```

A headless flow has no source, so there is no natural end to wait for. The runtime resolves `whenComplete()` immediately, at `.run()` time. It does not watch the messages you feed. So on a headless flow `await handle.whenComplete()` returns at once, whether or not you have fed anything. It tells you nothing about your feed.

This is why you track the end of your own data and call `shutdown()` yourself. Do not wait on `whenComplete()` to learn that your feed is finished. It cannot tell you.

## When a message is dropped

A message can be skipped without an error, in two ways. Your code cannot see either one from the driver's counts — a dropped message lands in `processed`, not `failed`.

**A missing asset id.** The field you named in `.assetId()` must be on every message. If the field is missing, the message still runs, but every message missing the field shares one state instead of each asset having its own. Nothing warns you.

**Too many assets.** One flow holds a limited number of distinct asset ids. The default is 10000, set by `COMPOSER_MAX_PARTITIONS_ALLOWED`. When a new id would push the count past the limit, its message is dropped, and the only sign is a line printed to the console.

To stay safe, make sure every message carries its asset id, and keep the number of distinct ids within the limit — or raise the limit with `COMPOSER_MAX_PARTITIONS_ALLOWED`.

## See also

- [Configuration → run](./nodes/configuration.md#run) — the handle that `.run()` returns, including `processMessage` and `shutdown`.
- [Built-in Error Handling](./composition-patterns.md#built-in-error-handling) — how nodes guard the functions you supply.
- [Flow Language](./flow-language.md) — the nodes and options you compose into a flow.
