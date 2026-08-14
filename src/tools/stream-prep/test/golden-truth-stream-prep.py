#!/usr/bin/env python3
"""
Golden-truth reference for the stream-preparation utilities.

Prints the expected values the JS specs hard-code, each computed with
Python's standard library (datetime/zoneinfo) — an implementation that
shares no code with the JS under test. Re-running this script must
reproduce every golden constant in the spec files byte-for-byte.

Cross-reference convention:
  JS spec files reference this script as:
    // see golden-truth-stream-prep.py §N
  Sections: §1 pattern-parser epochs, §2 shift labels (full-day sweep,
  IST three-shift schedule), §3 day keys, §4 shift keys (calendar
  edges + midnight wraps), §5 epoch-second conversions.

Usage:
    python3 golden-truth-stream-prep.py
"""

from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(minutes=330))
UTC = timezone.utc


def epoch_ms(dt):
    """Epoch milliseconds of an aware datetime (exact integer)."""
    return int(dt.timestamp() * 1000)


# ---------------------------------------------------------------- §1
# Pattern parser: 'YYYY-MM-DD HH:mm:ss[.frac]' text written in a fixed
# offset wall clock -> true-UTC epoch ms. Includes leap-year edges.
print("§1 pattern-parser epochs")
PATTERN_CASES = [
    # (text, offset_minutes)
    ("2026-04-07 09:15:00", 330),   # the solar feed shape, IST
    ("2026-04-07 09:15:00", 0),     # same text read as UTC
    ("2024-02-29 23:59:59", 0),     # leap day, divisible-by-4 year
    ("2000-02-29 12:00:00", 0),     # leap day, 400-rule year
    ("2026-12-31 23:59:59", 330),   # year-end wrap under offset
    ("2026-01-01 00:00:00", 330),   # year start under offset
    ("1969-12-31 23:59:59", 0),     # pre-epoch (negative ms)
    ("2026-08-13 07:05:09.5", 0),   # 1 fraction digit -> 500 ms
    ("2026-08-13 07:05:09.123", 0),   # 3 digits -> 123 ms
    ("2026-08-13 07:05:09.123456", 0),  # 6 digits -> truncate to 123 ms
]
for text, off in PATTERN_CASES:
    base, frac_ms = text, 0
    if "." in text:
        base, frac = text.split(".")
        frac_ms = int(frac[:3].ljust(3, "0"))
    dt = datetime.strptime(base, "%Y-%m-%d %H:%M:%S").replace(
        tzinfo=timezone(timedelta(minutes=off)))
    print(f"  ('{text}', {off}) -> {epoch_ms(dt) + frac_ms}")

# Malformed shapes the parser must reject (expected: NaN). Listed here
# so the spec's reject list stays tied to an authoritative check:
# every one of these raises in strptime too.
print("§1r rejected shapes (all raise in strptime)")
REJECTS = ["2023-02-29 10:00:00", "2100-02-29 10:00:00",
           "2026-13-01 10:00:00", "2026-00-10 10:00:00",
           "2026-04-31 10:00:00", "2026-04-07 24:00:00",
           "2026-04-07 09:60:00", "2026-04-07 09:15:60"]
for text in REJECTS:
    try:
        datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
        print(f"  UNEXPECTED PARSE: {text}")
    except ValueError:
        print(f"  {text} -> rejected OK")

# ---------------------------------------------------------------- §2
# Shift labels: IST schedule [0, 480, 960] -> S1/S2/S3. Sweep the
# boundaries and their neighbours on 2026-08-13 IST.
print("§2 shift labels (IST, boundaries [0,480,960])")
LABELS = ["S1", "S2", "S3"]
BOUNDS = [0, 480, 960]


def shift_of(dt_ist):
    minute = dt_ist.hour * 60 + dt_ist.minute
    idx = len(BOUNDS) - 1
    for i, b in enumerate(BOUNDS):
        if minute >= b:
            idx = i
    return LABELS[idx]


SWEEP = [(0, 0), (7, 59), (8, 0), (15, 59), (16, 0), (23, 59)]
for h, m in SWEEP:
    dt = datetime(2026, 8, 13, h, m, 30, tzinfo=IST)
    print(f"  {epoch_ms(dt)} (IST {h:02d}:{m:02d}:30) -> {shift_of(dt)}")

# Pre-epoch instant (negative epoch ms): 1969-12-31 23:00 UTC, offset 0.
pre = datetime(1969, 12, 31, 23, 0, 0, tzinfo=UTC)
print(f"  {epoch_ms(pre)} (UTC 23:00 pre-epoch, offset 0) -> {shift_of(pre)}")

# ---------------------------------------------------------------- §3
# Day keys: floor((t + offset)/86400000) == days since 1970-01-01 in
# the local wall clock. Cross-checked via date arithmetic.
print("§3 day keys")
DAY_CASES = [
    (datetime(2026, 8, 13, 0, 0, 0, tzinfo=IST), 330),
    (datetime(2026, 8, 12, 23, 59, 59, tzinfo=IST), 330),
    (datetime(2024, 2, 29, 12, 0, 0, tzinfo=UTC), 0),
    (datetime(1969, 12, 31, 23, 0, 0, tzinfo=UTC), 0),
]
EPOCH_DAY0 = datetime(1970, 1, 1).date()
for dt, off in DAY_CASES:
    local_date = dt.astimezone(timezone(timedelta(minutes=off))).date()
    day_key = (local_date - EPOCH_DAY0).days
    print(f"  ({epoch_ms(dt)}, offset {off}) -> {day_key}")

# ---------------------------------------------------------------- §4
# Shift keys: dayIndex*3 + shiftIdx for the IST [0,480,960] schedule;
# a pre-first-boundary time belongs to the previous day's last shift.
# With boundary 0 the wrap case cannot occur, so also check a
# [360, 840, 1320] schedule where 05:00 wraps to yesterday's S3.
print("§4 shift keys")


def shift_key(dt, off, bounds):
    local = dt.astimezone(timezone(timedelta(minutes=off)))
    day_key = (local.date() - EPOCH_DAY0).days
    minute = local.hour * 60 + local.minute
    n = len(bounds)
    if minute < bounds[0]:
        return (day_key - 1) * n + (n - 1)
    idx = 0
    for i, b in enumerate(bounds):
        if minute >= b:
            idx = i
    return day_key * n + idx


KEY_CASES = [
    (datetime(2026, 8, 13, 7, 59, 0, tzinfo=IST), 330, [0, 480, 960]),
    (datetime(2026, 8, 13, 8, 0, 0, tzinfo=IST), 330, [0, 480, 960]),
    (datetime(2026, 8, 13, 23, 59, 0, tzinfo=IST), 330, [0, 480, 960]),
    (datetime(2026, 8, 14, 0, 0, 0, tzinfo=IST), 330, [0, 480, 960]),
    (datetime(2026, 8, 13, 5, 0, 0, tzinfo=IST), 330, [360, 840, 1320]),
    (datetime(2026, 8, 13, 6, 0, 0, tzinfo=IST), 330, [360, 840, 1320]),
    (datetime(2027, 1, 1, 0, 30, 0, tzinfo=IST), 330, [360, 840, 1320]),
    (datetime(1969, 12, 31, 23, 0, 0, tzinfo=UTC), 0, [0, 480, 960]),
]
for dt, off, bounds in KEY_CASES:
    print(f"  ({epoch_ms(dt)}, offset {off}, {bounds}) -> "
          f"{shift_key(dt, off, bounds)}")

# ---------------------------------------------------------------- §5
# Epoch-second conversion: unit 's' multiplies by exactly 1000.
print("§5 epoch-second conversions")
for s in [0, 1755043200, -1, 1755043200.5]:
    print(f"  {s} s -> {int(s * 1000) if s == int(s) else s * 1000} ms")

print("\nAll sections printed. Copy constants into the specs verbatim.")
