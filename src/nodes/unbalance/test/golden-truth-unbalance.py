#!/usr/bin/env python3
"""
Golden-truth generator for the unbalance node.

Reference library:
    numpy 2.x — mean / min / max / abs / argmax over the channel set.

What the node computes, per tick, across N nominally-equal magnitude fields:
    mean   = sum(x) / N
    min    = min(x)
    max    = max(x)
    range  = max - min
    maxDev = max(|x - mean|)                       (max absolute deviation)
    unbalance = (maxDev / |mean|) * 100            (percent; NaN if |mean| < 1e-12)
    worstIndex = argmax(|x - mean|)                (zero-based)
    worstDev   = x[worstIndex] - mean              (signed)

Why a purpose-built dataset (not just the ABC EMS rows):
    The ABC EMS golden fixture is one operating point sampled over time —
    3 phases, the high channel always worst, one narrow regime, and CT-artifact
    contaminated. It anchors the percent-vs-fraction unit relationship against an
    independent source, but it never exercises the low-side-worst branch, N > 3
    (the "no field cap" path), signed/zero-crossing inputs, or near-equal
    precision. The `numeric` cases below cover that input space; the `electrical`
    section keeps the real rows for provenance and the x100 unit anchor.

Determinacy of worstIndex:
    numpy's argmax returns the FIRST maximum on a tie, while the node's
    documented tie-break is "high side wins" — different rules. So every numeric
    case here is asserted to have a STRICTLY UNIQUE max-deviation channel
    (worstDeterminate), which makes argmax unambiguous and independent of the
    node's tie-break. The tie cases (N=2, symmetric 3-phase) are NOT generated
    here — they are pinned by hand in update.specs.js as spec-defined conventions.

Output: golden-truth-unbalance.json
"""

import json
import sys
import numpy as np

EPSILON = 1e-12


# ── Core golden-truth computation (numpy) ─────────────────────────────────────

def compute( values ):
    """Return the eight stats for one channel set, computed via numpy."""
    x = np.array( values, dtype=float )
    mean = float( np.mean( x ) )
    mn = float( np.min( x ) )
    mx = float( np.max( x ) )
    dev = np.abs( x - mean )
    max_dev = float( np.max( dev ) )
    worst_index = int( np.argmax( dev ) )
    worst_dev = float( x[ worst_index ] - mean )

    abs_mean = abs( mean )
    if abs_mean < EPSILON:
        unbalance = None          # serialized as null -> NaN in the JS test
    else:
        unbalance = ( max_dev / abs_mean ) * 100.0

    # Is the worst channel strictly unique? (so argmax is tie-break independent)
    top = np.max( dev )
    unique = int( np.sum( dev >= ( top - 1e-15 ) ) ) == 1

    return {
        'mean': mean,
        'min': mn,
        'max': mx,
        'range': mx - mn,
        'maxDev': max_dev,
        'unbalance': unbalance,
        'worstIndex': worst_index,
        'worstDev': worst_dev,
        'worstDeterminate': unique,
    }


def compute_skip( values, min_present ):
    """Stats over the present channels only, for skipOnNaN mode. `None` marks a
    missing channel. Blanks when fewer than min_present channels are present.
    worstIndex is mapped back from the present-subset position to the original
    field position — the node reports the real field index, never a compacted one.
    """
    present_pairs = [ ( i, float( v ) ) for i, v in enumerate( values ) if v is not None ]
    present = len( present_pairs )
    if present < min_present:
        return { 'blanked': True, 'presentCount': present }
    orig_idx = [ p[ 0 ] for p in present_pairs ]
    g = compute( [ p[ 1 ] for p in present_pairs ] )
    g[ 'worstIndex' ] = orig_idx[ g[ 'worstIndex' ] ]   # subset index -> real field index
    g[ 'presentCount' ] = present
    g[ 'blanked' ] = False
    return g


def verify( condition, msg, errors ):
    if not condition:
        errors.append( msg )
        print( f"  FAIL: {msg}" )
        return False
    return True


# ── Numeric cases (each must have a UNIQUE worst channel) ─────────────────────

NUMERIC_CASES = [
    {
        'label': 'clean3-high-side-worst',
        'note': 'baseline 3-phase, high channel is worst (highWins === true)',
        'values': [ 110.0, 100.0, 96.0 ],
    },
    {
        'label': 'clean3-low-side-worst',
        'note': 'one channel sags far below the mean (highWins === false)',
        'values': [ 100.0, 100.0, 70.0 ],
    },
    {
        'label': 'four-redundant-sensors-one-drifting',
        'note': 'N=4; the fourth sensor reads high',
        'values': [ 50.0, 50.0, 50.0, 56.0 ],
    },
    {
        'label': 'six-battery-cells-one-weak',
        'note': 'N=6; cell 5 is the weak (low-side) cell',
        'values': [ 3.95, 3.97, 3.96, 3.98, 3.99, 3.80 ],
    },
    {
        'label': 'twelve-channels-one-outlier',
        'note': 'N=12; proves there is no field cap; outlier on the high side',
        'values': [ 100.0, 100.0, 100.0, 100.0, 100.0, 100.0,
                    100.0, 100.0, 100.0, 100.0, 100.0, 130.0 ],
    },
    {
        'label': 'near-equal-tight-spread',
        'note': 'small percentage; precision near the noise floor',
        'values': [ 100.0, 100.2, 99.9 ],
    },
    {
        'label': 'signed-values-nonzero-mean',
        'note': 'bipolar inputs (e.g. signed active power), mean stays well above zero',
        'values': [ 50.0, -10.0, 30.0 ],
    },
    {
        'label': 'large-magnitude',
        'note': 'precision under scale (~1e6)',
        'values': [ 1.0e6, 1.01e6, 0.985e6 ],
    },
]


# ── ABC EMS electrical rows (provenance + x100 unit anchor) ──────────────────
# Source: usecases/abc-ems/pipeline/golden-fixture.json, field `i` (3-phase
# currents). The stored `currentUnbalance` there is a FRACTION (maxDev/|mean|)
# from the old vectorDistance+ratio path; the node emits PERCENT = fraction*100.
# These rows are CT-artifact contaminated (phase 1 ~12.6x high) — they test the
# arithmetic and the unit relationship, not a real electrical fault.

ABC_EMS_ROWS = [
    { 'i': [ 1181.2586666667, 93.6873333333, 121.98 ],         'currentUnbalance': 1.5368387445004958 },
    { 'i': [ 1179.8313333333, 93.9546666667, 122.2466666667 ], 'currentUnbalance': 1.5353948260044168 },
    { 'i': [ 1171.0476666667, 93.32, 121.4313333333 ],         'currentUnbalance': 1.5351028540214708 },
    { 'i': [ 1164.384, 93.6833333333, 121.9083333333 ],        'currentUnbalance': 1.5313141995017077 },
    { 'i': [ 1162.11, 93.616, 121.8813333333 ],                'currentUnbalance': 1.5307138802494407 },
    { 'i': [ 1166.5103333333, 93.6286666667, 121.836 ],        'currentUnbalance': 1.5322679498543028 },
    { 'i': [ 1155.908, 93.3786666667, 121.414 ],               'currentUnbalance': 1.529891525064249 },
    { 'i': [ 1164.8223333333, 93.4933333333, 121.8443333333 ], 'currentUnbalance': 1.5319289067935262 },
    { 'i': [ 1161.291, 93.168, 121.227 ],                      'currentUnbalance': 1.5324623496931715 },
    { 'i': [ 1164.09, 93.5203333333, 121.7196666667 ],         'currentUnbalance': 1.5318596709996881 },
    { 'i': [ 1165.351, 93.5316666667, 121.7016666667 ],        'currentUnbalance': 1.5322994876805773 },
    { 'i': [ 1162.2966666667, 93.241, 121.257 ],               'currentUnbalance': 1.5326144009854883 },
]


# ── Skip-mode cases (skipOnNaN: compute over the present channels) ────────────
# `None` marks a channel that did not report this tick. Each non-blanked case must
# have a UNIQUE worst channel so numpy's argmax is tie-break independent (the ties
# are pinned by hand in update.specs.js, same as the numeric cases). These exercise
# the present-subset arithmetic, the worstIndex remap to the real field position,
# the minPresent floor (blank below it), and the all-missing edge.

SKIP_CASES = [
    {
        'label': 'skip-one-of-five-high-worst',
        'note': 'N=5, field 2 missing; the high field is worst among the 4 present',
        'values': [ 100.0, 102.0, None, 98.0, 110.0 ],
        'minPresent': 2,
    },
    {
        'label': 'skip-one-of-five-low-worst',
        'note': 'N=5, field 3 missing; a low field is worst among the 4 present',
        'values': [ 100.0, 100.0, 99.0, None, 70.0 ],
        'minPresent': 2,
    },
    {
        'label': 'skip-two-of-six',
        'note': 'N=6, two cells missing; metric over the 4 present, low cell worst',
        'values': [ 3.95, None, 3.96, 3.98, None, 3.80 ],
        'minPresent': 2,
    },
    {
        'label': 'floor-breach-two-present-min-three',
        'note': 'only 2 of 5 present but minPresent 3 -> blanked; presentCount still 2',
        'values': [ 100.0, None, None, None, 96.0 ],
        'minPresent': 3,
    },
    {
        'label': 'all-missing',
        'note': 'every channel missing -> blanked; presentCount 0',
        'values': [ None, None, None ],
        'minPresent': 2,
    },
]


def main():
    results = { 'numeric': [], 'electrical': {} }
    errors = []

    # ── Numeric cases ─────────────────────────────────────────────────────────
    print( "Numeric cases (numpy golden truth):" )
    for case in NUMERIC_CASES:
        g = compute( case[ 'values' ] )
        n = len( case[ 'values' ] )
        fields = [ f"c{k}" for k in range( n ) ]

        verify( g[ 'worstDeterminate' ],
                f"{case[ 'label' ]}: worst channel is NOT unique — "
                f"would be tie-break dependent", errors )
        # Sanity: maxDev must equal the larger of the two extreme deviations.
        dev_high = g[ 'max' ] - g[ 'mean' ]
        dev_low = g[ 'mean' ] - g[ 'min' ]
        verify( abs( g[ 'maxDev' ] - max( dev_high, dev_low ) ) < 1e-9,
                f"{case[ 'label' ]}: maxDev {g[ 'maxDev' ]} != max(extreme devs)",
                errors )

        ub = 'NaN' if g[ 'unbalance' ] is None else f"{g[ 'unbalance' ]:.6f}"
        print( f"  {case[ 'label' ]:<36} N={n} unbalance={ub} "
               f"worstIdx={g[ 'worstIndex' ]} worstDev={g[ 'worstDev' ]:.4f}" )

        results[ 'numeric' ].append( {
            'label': case[ 'label' ],
            'note': case[ 'note' ],
            'fields': fields,
            'values': case[ 'values' ],
            'expected': {
                'mean': g[ 'mean' ],
                'min': g[ 'min' ],
                'max': g[ 'max' ],
                'range': g[ 'range' ],
                'maxDev': g[ 'maxDev' ],
                'unbalance': g[ 'unbalance' ],
                'worstIndex': g[ 'worstIndex' ],
                'worstDev': g[ 'worstDev' ],
            },
        } )

    # ── Electrical rows ─────────────────────────────────────────────────────────
    print( "\nElectrical rows (ABC EMS provenance, percent = fraction * 100):" )
    fields = [ 'i0', 'i1', 'i2' ]
    rows = []
    for idx, row in enumerate( ABC_EMS_ROWS ):
        g = compute( row[ 'i' ] )
        stored_fraction = row[ 'currentUnbalance' ]
        expected_percent = stored_fraction * 100.0

        # The numpy-computed percent must equal the stored fraction * 100.
        # Two independent sources (numpy here vs the old vectorDistance+ratio
        # path that produced the fixture) — agreement is a real cross-check.
        verify( abs( g[ 'unbalance' ] - expected_percent ) < 1e-6,
                f"row {idx}: numpy percent {g[ 'unbalance' ]} != "
                f"stored fraction*100 {expected_percent}", errors )
        # On this data phase 0 is always the worst (high side).
        verify( g[ 'worstIndex' ] == 0,
                f"row {idx}: expected worstIndex 0 (high phase), "
                f"got {g[ 'worstIndex' ]}", errors )

        rows.append( {
            'values': row[ 'i' ],
            'storedFraction': stored_fraction,
            'expected': {
                'mean': g[ 'mean' ],
                'min': g[ 'min' ],
                'max': g[ 'max' ],
                'range': g[ 'range' ],
                'maxDev': g[ 'maxDev' ],
                'unbalance': g[ 'unbalance' ],
                'worstIndex': g[ 'worstIndex' ],
                'worstDev': g[ 'worstDev' ],
            },
        } )

    print( f"  {len( rows )} rows; numpy percent == stored fraction * 100 verified" )

    results[ 'electrical' ] = {
        'fields': fields,
        'note': ( 'Source usecases/abc-ems/pipeline/golden-fixture.json field i. '
                  'storedFraction is the old fraction form; expected.unbalance is '
                  'percent = storedFraction * 100.' ),
        'rows': rows,
    }

    # ── Skip-mode cases ──────────────────────────────────────────────────────────
    print( "\nSkip-mode cases (skipOnNaN; numpy over the present channels):" )
    skip_results = []
    for case in SKIP_CASES:
        n = len( case[ 'values' ] )
        flds = [ f"c{k}" for k in range( n ) ]
        g = compute_skip( case[ 'values' ], case[ 'minPresent' ] )

        record = {
            'label': case[ 'label' ],
            'note': case[ 'note' ],
            'fields': flds,
            'values': case[ 'values' ],
            'minPresent': case[ 'minPresent' ],
            'presentCount': g[ 'presentCount' ],
        }

        if g[ 'blanked' ]:
            record[ 'expected' ] = { 'blanked': True }
            print( f"  {case[ 'label' ]:<34} BLANKED presentCount={g[ 'presentCount' ]}" )
        else:
            verify( g[ 'worstDeterminate' ],
                    f"{case[ 'label' ]}: worst channel is NOT unique — "
                    f"would be tie-break dependent", errors )
            record[ 'expected' ] = {
                'blanked': False,
                'mean': g[ 'mean' ],
                'min': g[ 'min' ],
                'max': g[ 'max' ],
                'range': g[ 'range' ],
                'maxDev': g[ 'maxDev' ],
                'unbalance': g[ 'unbalance' ],
                'worstIndex': g[ 'worstIndex' ],
                'worstDev': g[ 'worstDev' ],
            }
            ub_str = 'NaN' if g[ 'unbalance' ] is None else f"{g[ 'unbalance' ]:.6f}"
            print( f"  {case[ 'label' ]:<34} present={g[ 'presentCount' ]} "
                   f"unbalance={ub_str} worstIdx={g[ 'worstIndex' ]}" )

        skip_results.append( record )

    results[ 'skip' ] = skip_results

    # ── Write output ──────────────────────────────────────────────────────────
    output_path = 'golden-truth-unbalance.json'
    with open( output_path, 'w' ) as f:
        json.dump( results, f, indent=2 )
    print( f"\nWrote golden-truth to {output_path}" )

    if errors:
        print( f"\n{len( errors )} CHECKS FAILED:" )
        for e in errors:
            print( f"  - {e}" )
        sys.exit( 1 )
    print( "All self-verification checks PASSED." )
    sys.exit( 0 )


if __name__ == '__main__':
    main()
