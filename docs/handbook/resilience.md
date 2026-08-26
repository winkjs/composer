# Resilience

This page covers the practices that keep a composer deployment
running through restarts, crashes, and outages. Each section is
self-contained: it names the risk, shows the fix, and states exactly
what is and is not guaranteed afterwards.

## Input durability in one line

**The one line:** give the MQTT source a fixed `clientId`.

```javascript
.source( mqttSource, {
    brokerUrl: 'mqtt://broker:1883',
    topics: [ 'plant/line1/#' ],
    clientId: 'paintshop-line1'    // fixed name — pick one and keep it
} )
```

Why this line matters takes a short story. When composer connects to
the MQTT broker, it introduces itself with a name — the `clientId`.
Composer asks the broker for a persistent session, which means: "if
I disconnect, keep collecting my messages, and hand them over when I
return." The broker does exactly that. But it files the saved
messages under the name.

Without a configured `clientId`, composer invents a name from the
start time. Every restart produces a different name. So the broker
holds the backlog under the old name, composer returns under a new
one, and the saved messages are never delivered. They sit unclaimed
until the session expires. Nothing reports an error. The readings
are simply missing.

With a fixed name, the same restart plays out differently. Composer
returns as `paintshop-line1`. The broker recognizes the session and
delivers every message saved during the downtime. Composer's
duplicate filter absorbs any boundary re-sends, so each reading is
processed exactly once.

Composer warns at startup when the `clientId` is missing while the
session is persistent, so this cannot be forgotten silently.

### Choose the name carefully

The broker allows one connection per name. If a second client
connects with a name already in use, the broker disconnects the
first. Two devices sharing a name therefore kick each other off in
an endless loop, and each kick looks like a network fault. Pick a
name that is unique on your broker. Site plus line works well:
`paintshop-line1`.

### What the session does and does not hold

- Saved messages wait for `MQTT_SESSION_EXPIRY_S` — 7 days by
  default. A composer that stays away longer than that loses the
  backlog.
- The broker saves messages published at QoS 1. Delivery quality is
  the *lower* of the publisher's and the subscriber's settings. A
  sensor publishing at QoS 0 therefore gets no queueing, no matter
  what composer requests. Check the publisher side too.
- The session lives in the broker's memory unless the broker's own
  disk persistence is turned on. Without it, a broker restart or
  power cut erases the saved backlog. How to turn it on is the next
  section.

## Configuring the broker

Composer ships a reference Mosquitto configuration at
`config/mosquitto.conf` in the composer repository — the same file
its own integration tests run against. The snippet below is the
settings part of that file. Copy it, then read the walk-through once,
so every line is a decision you made rather than a line you pasted.

```text
listener 1883
allow_anonymous true

max_queued_messages 0
max_inflight_messages 1000

persistence true
persistence_location /mosquitto/data/
autosave_interval 60
persistent_client_expiration 14d
```

### What each line does

- `listener 1883` — accept MQTT connections on the standard port.
  This is the default; declaring it makes the intent visible.
- `allow_anonymous true` — any client may connect without a password.
  That is acceptable on a closed test network only. A production
  broker should require authentication; start with Mosquitto's
  `password_file` documentation.
- `max_queued_messages 0` — no limit on how many messages the broker
  queues for a client that is offline or slow. Mosquitto's default is
  1,000, and beyond it messages are dropped silently. Zero means
  unlimited, bounded only by the broker host's disk and memory. Size
  this deliberately if your broker host is small.
- `max_inflight_messages 1000` — how many QoS 1 messages may be
  awaiting acknowledgment at once, per client. The default of 20 is
  too tight for high-rate telemetry and throttles delivery.
- `persistence true` — save sessions, subscriptions, and queued
  messages to disk, so they survive a broker restart. The default is
  false, which keeps everything in memory only.
- `persistence_location /mosquitto/data/` — the directory where the
  broker's database file (`mosquitto.db`) lives. The path shown is
  the standard one *inside the Docker container*. On a
  package-installed Mosquitto, use `/var/lib/mosquitto/` instead.
- `autosave_interval 60` — save the database every 60 seconds. The
  default is 1800 (thirty minutes). Persistence is a periodic save,
  not a per-message write, so a power cut on the broker host loses
  whatever changed since the last save. Sixty seconds makes that
  window one minute instead of half an hour. A clean shutdown or
  restart always saves on exit, whatever this interval says.
- `persistent_client_expiration 14d` — forget a saved session whose
  client has not returned for 14 days. Composer's own sessions expire
  after 7 days (`MQTT_SESSION_EXPIRY_S`), so this backstop only ever
  removes sessions composer has already abandoned. Without it, dead
  deployments accumulate queues without bound.

### Where to put it

- **Package install** (Debian, Ubuntu, Raspberry Pi OS):
  `/etc/mosquitto/mosquitto.conf`, or a new file such as
  `/etc/mosquitto/conf.d/composer.conf`. Change
  `persistence_location` to `/var/lib/mosquitto/`. Apply with
  `sudo systemctl restart mosquitto`.
- **Docker**: mount the file at `/mosquitto/config/mosquitto.conf`
  and give the data path a volume so it survives container
  replacement. Composer's own `docker-compose.yml` is a working
  example of both. Apply with `docker compose restart mosquitto`.
- **Check that it took effect**: restart the broker cleanly, then
  look for `mosquitto.db` in the persistence location. If the file
  is not there, the persistence lines are not being read — the most
  common cause is editing a file the broker does not load.

Run the broker under something that restarts it automatically — a
`systemd` service on a package install, `restart: unless-stopped` in
Docker. A broker that stays down turns every protection on this page
into a countdown.

## What the broker guarantees, and when it doesn't

With the configuration above, and composer connecting under a fixed
`clientId`, the guarantees read like this:

- **Composer restarts; broker stays up.** No loss. The broker holds
  the backlog and replays it when composer returns.
- **Broker restarts cleanly** (deploy, host reboot). No loss. A
  clean shutdown saves the database on exit, whatever the autosave
  interval says.
- **Broker host loses power.** Bounded loss: whatever changed since
  the last save — at most `autosave_interval` seconds of queued
  messages, one minute with the setting above.
- **The whole site loses power.** The sensors were dark too, so
  nothing was being measured. What is lost is the broker's unsaved
  window plus whatever composer had mid-send at that instant.
- **The session expires.** A composer that stays away longer than
  `MQTT_SESSION_EXPIRY_S` (7 days) loses the backlog. The broker's
  own 14-day backstop never fires first.

Composer's integration suite certifies the first two rows against a
real broker: stop composer, keep publishing, restart, and every
message published during the gap arrives exactly once — including
across a broker restart
(`src/core/source-manager/mqtt/test/slow-broker-durability.specs.js`).

## Measure durations from the message, not the device clock

Two nodes measure how long something lasted: `dwellTimeTracker`
("how long has this valve been open?") and `stateChangeDetector`
("how long was the machine in its previous state?"). Both take the
time from the device's clock unless told otherwise.

The device clock has two failure cases. First, corrections: a
device that was offline reconnects with a wrong clock, and NTP —
the internet time service — snaps it to true time, forwards or
backwards, sometimes by minutes. A snap landing inside a
measurement makes the result wrong. Second, replay: the broker
protections above deliver the saved backlog at compute speed, so an
hour of readings can rush through in seconds — and on the device
clock, an hour-long state reads as seconds.

The fix is one option on the node: `timestampField`, the name of
the message field that carries each reading's own time. With it
set, durations come out exact during replay, and clock corrections
cannot touch them. The rule of thumb: **a flow that measures
durations sets `timestampField` on the node that measures them.**

Two guards hold even without it. A dwell is never published as a
negative number — a backward clock step reports 0. And a message
whose timestamp field is missing or not a number is faulted for
that one message, while the measurement in progress continues.

One clock is deliberately left on the device: `emitIf`'s alert
throttle ("do not re-send this alert within N seconds") runs on
the device clock, because a rate limit is about real elapsed time.
That is the correct clock for that job.

## When a node throws

The protections above cover the transport: the broker, the
session, the clock. This section covers a fault inside the
pipeline itself — the moment a node chokes on a reading.

Here is how that happens. Imagine a flow watching fifty pumps.
One day the gateway on `pump07` gets a firmware update. It starts
sending the flow-rate as a 64-bit integer instead of a plain
number.

The payload still decodes into a normal-looking message.
But when a node places that value into its numeric buffer,
JavaScript refuses. The node throws an error.

Without protection, that one throw would take down the whole
process — and with it the other forty-nine pumps.

**What actually happens: one bad message costs exactly one
message.** The flow catches the throw at the one point every
message passes through. It skips the bad message and moves on to
the next. Your `onStatus` handler receives one red report:

```javascript
{
    status: 'red',
    phase: 'running',
    error: {
        code: 'MESSAGE_HANDLER_FAILED',
        message: 'Node execution failed at index 2: ...'
    }
}
```

The report tells you which node failed and why. If the flow has
no `onStatus` handler, the same report goes to the console
instead. Either way, nothing fails silently. And the other
forty-nine pumps never notice.

### When every message fails

One bad message is noise. Every message failing is a different
situation. It usually means something upstream broke for good —
say the firmware change hit the shared gateway, so every pump now
sends the bad format. Skipping and reporting forever would hide a
dead deployment behind a process that looks alive.

So the flow keeps a count of failures in a row. Each failure adds
one. Any successful message puts the count back to zero. When the
count reaches the threshold — five in a row, by default — the
flow concludes the stream itself is broken, and stops.

You get
one final red report with `phase: 'errored'`. Then the flow shuts
down cleanly: emitters and storage drain their buffers, so
nothing already computed is lost. Messages arriving after the
stop are dropped, and one console line records that.

The threshold is the environment variable
`COMPOSER_MESSAGE_FAILURE_THRESHOLD`. The default of 5 suits most
deployments.

### One sick partition cannot poison the rest

The same counting idea protects partitions. Each pump gets its
own copy of the pipeline, built when its first message arrives.
Suppose only `pump07` sends the bad format, and the fault strikes
while its copy is being built. Composer retries the build on each
of its messages. After five failed builds in a row, composer
stops trying: `pump07` is quarantined.

Its messages are dropped,
one console line reports it, and the other pumps run untouched.
A quarantined pump's drops do not count against the flow-level
threshold above — one sick pump cannot stop the plant.

### Faults inside your own functions

You give composer functions of your own: an `emitIf` predicate,
an annotate function, a tunable. These can throw too — a typo, a
missing field. Two layers handle them. Where a node tracks its
own errors, the node records the fault and the stream continues.
`emitIf` and `persistIf` do this for predicate and annotate
errors. Everywhere else, the dispatch guard above is the
backstop: the throw costs that one message and is reported as
`MESSAGE_HANDLER_FAILED`.

Output adapters get the same treatment at the two gates. An
adapter is supposed to answer `{ ok }` — never throw. If a broken
one throws anyway, the gate records it in its failure counters as
`MALFORMED_RESULT`, and the message continues.

### Flows without a source

One flow kind opts out: a headless flow, fed directly by your own
code instead of a source. It has no status channel to report on.
So a pipeline fault throws straight back to the code that fed the
message, and that code owns the decision. The headless flow page
explains that contract.
