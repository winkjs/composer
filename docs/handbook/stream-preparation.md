# Stream Preparation

Stream-preparation utilities are ready-made functions for a source's
`transform` option. They get a raw feed ready for analytics. They fix
numeric types, normalize timestamps, keep a replay window, label
shifts, derive activity states, and stamp period keys.

This page covers the six utilities and how they compose. The
`transform` option itself is documented with each source in
[Data I/O](./nodes/configuration.md).

## The plug point

A source's `transform` runs once per record, before the flow sees it.
The utilities plug in there:

```text
csv / mqttSource --> transform hook --> partitions --> nodes --> emitters / storage
                     (utilities here)                  (sanitize owns
                                                        field validity)
```

Each utility is a factory. You call it once with your feed's
configuration, and it returns the per-record function. The returned
function mutates the message in place and returns the same object, so
utilities compose by plain sequencing. Only `filterRows` ever returns
null, which tells the source to drop the record and count it as
skipped.

Two boundaries keep the utilities small. They are field-agnostic: a
physical validity range (a bath below 5 degC, a -9999 code) belongs to
the `sanitize` node in the flow. And they are one-record-in,
one-record-out: joining or splitting records is not a `transform` job.

## Run order

Sequence the utilities from raw bytes toward meaning:

1. `coerceNumeric` — make the numbers numbers.
2. `normalizeTimestamp` — make the clock epoch milliseconds.
3. `filterRows` — keep the study window (replay work only).
4. `labelShift`, `trackActivity`, `stampPeriod` — stamp derived
   fields, in any order.

The time-based utilities read epoch milliseconds, so they run after
`normalizeTimestamp`.

## coerceNumeric

`coerceNumeric( fields, options )` rewrites each listed field to a
clean finite number or NaN. A blank, null, or unparseable cell becomes
NaN — never 0, which is what a naive `Number( '' )` would produce.
Downstream NaN-skip logic then treats missing data as missing.

| Option | Default | What it does |
|---|---|---|
| `fields` | required | Array of field names to coerce. |
| `sentinelAbs` | none | Magnitude cut: any value at or above it becomes NaN. For universal collector garbage such as 3.4e38, not for physical ranges. |

```javascript
import { coerceNumeric } from '@winkjs/composer';

const coerce = coerceNumeric( [ 'tempC', 'pressure' ], { sentinelAbs: 1e30 } );
// { tempC: '', pressure: '42.5' }  ->  { tempC: NaN, pressure: 42.5 }
```

One documented limit: a whitespace-only string coerces to 0, matching
`Number`'s own behavior. Real feeds encode a missing cell as an empty
string or null.

## normalizeTimestamp

`normalizeTimestamp( options )` guarantees one field holds a numeric
epoch-millisecond timestamp. Declare the feed's shape once; the hot
path never sniffs it per row. An empty or unparseable value becomes
NaN, and the message still flows — pair it with `filterRows` when bad
clocks should drop.

| Option | Default | What it does |
|---|---|---|
| `field` | `'timestamp'` | Field to read. |
| `target` | same as `field` | Field to write. Set it when the raw column name differs. |
| `unit` | `'auto'` | Input shape: `'ms'`, `'s'`, or `'auto'` (numbers pass as ms, strings parse as ISO-8601). |
| `pattern` | none | Fixed text layout, instead of `unit`. Supported: `'YYYY-MM-DD HH:mm:ss'`, with an optional fraction in the data. |
| `offsetMinutes` | `0` | With `pattern` only: the fixed UTC offset of the wall clock the text was written in (IST = 330). |

```javascript
import { normalizeTimestamp } from '@winkjs/composer';

// A historian export: zone-less local text, written in IST.
const normalize = normalizeTimestamp( {
    field: 'ts',
    target: 'timestamp',
    pattern: 'YYYY-MM-DD HH:mm:ss',
    offsetMinutes: 330
} );
// { ts: '2026-04-07 09:15:00' }  ->  timestamp: 1775533500000
```

The `pattern` path exists because zone-less historian text is the most
common field shape, and `Date.parse` on it is engine-dependent. The
compiled reader is exact across leap years and allocates nothing per
row. The offset is fixed, so daylight-saving sites must resolve local
time upstream.

## filterRows

`filterRows( options )` keeps only rows inside an inclusive time
window and drops everything else by returning null. Its home is replay
work — demos, evaluations, reruns that study a window of a longer
recording. A row whose timestamp is not a finite number is dropped
too.

| Option | Default | What it does |
|---|---|---|
| `field` | `'timestamp'` | Field holding epoch ms. |
| `from` | none | Inclusive lower bound: epoch ms or an ISO-8601 string. At least one bound is required. |
| `to` | none | Inclusive upper bound, same forms. |

```javascript
import { filterRows } from '@winkjs/composer';

const window = filterRows( { from: '2026-04-01T00:00:00Z', to: '2026-04-07T23:59:59Z' } );
```

Arbitrary predicates need no utility: the `transform` hook itself
drops a record when your own code returns null.

## labelShift

`labelShift( options )` stamps each message with the production shift
its timestamp falls in. The schedule is yours: shift start times as
minutes of the local day, matching labels, and a fixed UTC offset. A
time before the first boundary belongs to the last shift, because it
wrapped past midnight.

| Option | Default | What it does |
|---|---|---|
| `boundariesMin` | required | Shift start minutes-of-day, strictly ascending, each in [0, 1440). |
| `labels` | required | One label per boundary. |
| `offsetMinutes` | `0` | Fixed UTC offset of the plant's wall clock. |
| `field` | `'timestamp'` | Field holding epoch ms. |
| `target` | `'shiftLabel'` | Field to write the label to. |

```javascript
import { labelShift } from '@winkjs/composer';

const shift = labelShift( {
    offsetMinutes: 330,
    boundariesMin: [ 0, 480, 960 ],
    labels: [ 'S1', 'S2', 'S3' ]
} );
```

A non-finite timestamp writes null. The offset is fixed —
daylight-saving sites are out of scope, same as the `pattern` parser.

## trackActivity

`trackActivity( options )` turns an intermittent change signal into a
sustained active/idle state, and reports how long that state has held.
Activity means a watched field's value changed since the previous
message. The state holds "active" for `windowSec` after the last
change. It starts false and turns true only once a change is actually
observed, so a dead, never-changing signal never reads as running.

The same measurement answers several questions, read from either end.
`active` true means the line is running. `active` false over a long
stretch means a sensor is dead or a machine is idle. `activeFor` says
how long the current run has lasted.

| Option | Default | What it does |
|---|---|---|
| `from` | required | Field name, or array of names, to watch for change. |
| `windowSec` | required | Hold "active" this many seconds after the last change. |
| `epsilon` | `0` | Ignore a numeric change at or below this (jitter gate). |
| `timestampField` | `'timestamp'` | Epoch-ms clock field. |
| `writes` | required | Output names: any of `active`, `activeFor`, `sinceActivity`, `activeStart`. |

```javascript
import { trackActivity } from '@winkjs/composer';

const lineState = trackActivity( {
    from: [ 'pulseEntry', 'pulseExit' ],
    windowSec: 1200,
    writes: { active: 'lineRunning', activeFor: 'activeStretchMs' }
} );
```

Scope limit: this is a stream-level utility. It compares each message
against the previous one, so the watched fields must be shared across
the stream (line pulses, a plant meter). Per-asset activity needs
per-asset state, which belongs to partitions.

## stampPeriod

`stampPeriod( options )` stamps a monotonic integer key naming the
calendar period a timestamp falls in: the local day, or the shift. The
key is what makes period rollovers detectable in the flow — see the
recipe below.

| Option | Default | What it does |
|---|---|---|
| `period` | required | `'day'` or `'shift'`. |
| `boundariesMin` | shift only | Shift start minutes-of-day, as in `labelShift`. |
| `offsetMinutes` | `0` | Fixed UTC offset of the plant's wall clock. |
| `field` | `'timestamp'` | Field holding epoch ms. |
| `target` | `'dayKey'` / `'shiftKey'` | Field to write the key to. |

```javascript
import { stampPeriod } from '@winkjs/composer';

const day = stampPeriod( { period: 'day', offsetMinutes: 330 } );
const shiftKey = stampPeriod( { period: 'shift', offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ] } );
```

The shift key is `dayIndex * shiftsPerDay + shiftIndex`, so it never
repeats and never moves backward. A time before the first boundary
keys to the previous day's last shift.

## Composing an inlet

A real inlet is the utilities sequenced inside one function you pass
as the source's `transform`:

```javascript
import { flow, csv, coerceNumeric, normalizeTimestamp, trackActivity, labelShift } from '@winkjs/composer';

const coerce = coerceNumeric( [ 'tempC', 'pulseEntry', 'pulseExit' ] );
const clock = normalizeTimestamp( { unit: 's' } );
const lineState = trackActivity( {
    from: [ 'pulseEntry', 'pulseExit' ],
    windowSec: 1200,
    writes: { active: 'lineRunning' }
} );
const shift = labelShift( { offsetMinutes: 330, boundariesMin: [ 0, 480, 960 ], labels: [ 'S1', 'S2', 'S3' ] } );

const prepare = function ( row ) {
    coerce( row );
    clock( row );
    if ( !Number.isFinite( row.timestamp ) ) {
        return null;    // a row with no usable clock never reaches the stateful utilities
    }
    lineState( row );
    shift( row );
    return row;
};

flow( 'paintline' )
    .assetId( 'tankId' )
    .source( csv, { path: './feed.csv', transform: prepare } );
```

Drop bad-clock rows before the stateful utilities, so they never see a
message they cannot place in time.

## Two recipes

The utilities stop where flow logic starts. Two common needs resolve
in the flow, not at the inlet.

**Period rollover.** To flush a window when the shift or day changes,
stamp the key with `stampPeriod`. Then detect the key's change per
asset inside the flow with `stateChangeDetector`, and act on the
change flag. The inlet stays stateless; each partition owns its own
roll.

**Late data.** Dropping late rows at the inlet destroys data. Route
them instead. Test lateness in the flow, and block the analytics path
with `passIf`. Send late records to a side channel with `emitIf`, for
separate batch processing.
