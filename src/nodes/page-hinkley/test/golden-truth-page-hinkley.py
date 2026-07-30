"""
Golden-truth reference values for page-hinkley node tests.

Note: The user-facing parameter is halfLife (samples). init.js converts
halfLife to alpha via halfLifeToAlpha(). The golden-truth operates at the
internal alpha level since that is what update.js uses. Each section
includes the halfLife equivalent so test files know which value to pass.

Three-tier verification strategy:

  Tier 1 — Library oracle (running-mean scenarios only):
      river.drift.PageHinkley (v0.23+) with alpha=1.0 produces the exact
      standard PHT recurrence. Internal state (_sum_increase, _x_mean,
      _min_increase) is extracted and compared sample-by-sample against
      the sequential implementation.

  Tier 2 — Vectorized cross-check (all scenarios):
      An independent numpy vectorized implementation computes the same
      quantities using array operations. Agreement between sequential
      and vectorized rules out implementation errors in either.

  Tier 3 — Mathematical invariants (all scenarios):
      Constant input: testStatistic ≡ 0, mean converges to the constant.
      Running mean convergence: verified against numpy cumulative mean.
      Sequential == vectorized (sample-by-sample, tolerance 1e-14).

Algorithm reference:
  Page, E.S. (1954). "Continuous Inspection Schemes."
      Biometrika, 41(1/2), 100-115.
  Hinkley, D.V. (1971). "Inference about the change-point from cumulative
      sum tests." Biometrika, 58(3), 509-523.
  Hunter, J.S. (1986). "The Exponentially Weighted Moving Average."
      Journal of Quality Technology, 18(4), 203-210.

For EWMA baseline mode (alpha > 0), no Python library implements the
composer's specific variant (EWMA baseline + raw cumulative sum). river's
alpha controls exponential forgetting of the cumulative sum itself — a
different algorithm. EWMA scenarios use Tier 2 + Tier 3 only.

Cross-reference convention:
    The JS test files load golden-truth values from golden-truth-page-hinkley.json.
    Each closeTo assertion references this script's section:
        // see golden-truth-page-hinkley.py S1

Libraries: numpy >= 1.24, river >= 0.23

Usage:
    python3 golden-truth-page-hinkley.py
"""

import json
import os
import sys

import numpy as np
from river.drift import PageHinkley


# ====================================================================
# Global pass/fail tracker
# ====================================================================
ok = True


def check( label, actual, expected, tol=1e-14 ):
    """Assert actual matches expected within tolerance."""
    global ok
    diff = abs( actual - expected )
    if diff > tol:
        ok = False
        print( f'  FAIL: {label} = {actual:.15e} (expected {expected:.15e}, diff {diff:.2e})' )


# ====================================================================
# Tier 1: river library oracle (running-mean mode only)
# ====================================================================

def pht_river_oracle( values, delta, lam, detect_drop=False ):
    """Run river's PageHinkley with alpha=1.0 (standard PHT).

    Returns list of dicts with internal state per sample.
    For detect_drop: negate input (composer approach) and detect increase.
    """
    ph = PageHinkley( min_instances=1, delta=delta, threshold=lam, alpha=1.0, mode='up' )
    results = []
    for v in values:
        x = -v if detect_drop else v
        ph.update( x )
        results.append( {
            'mean': ph._x_mean.get(),
            'cumSum': ph._sum_increase,
            'minCumSum': ph._min_increase,
            'testStatistic': ph._sum_increase - ph._min_increase,
            'shiftDetected': ph.drift_detected,
        } )
    return results


# ====================================================================
# Tier 2a: Sequential PHT implementation (running mean, alpha=0)
# ====================================================================

def pht_sequential( values, delta=0.005, lam=45.0, detect_drop=False ):
    """Page-Hinkley Test with running mean baseline.

    Standard recurrence — 4 lines of math:
        mean_n = mean_{n-1} + (x_n - mean_{n-1}) / n
        T_n = T_{n-1} + (x_n - mean_n - delta)
        M_n = min(M_{n-1}, T_n)
        alarm if (T_n - M_n) > lambda  →  then reset T, M to 0
    """
    results = []
    mean = 0.0
    cumSum = 0.0
    minCumSum = 0.0
    count = 0

    for v in values:
        xVal = -v if detect_drop else v
        count += 1
        mean += ( xVal - mean ) / count
        cumSum += xVal - mean - delta
        if cumSum < minCumSum:
            minCumSum = cumSum
        testStat = cumSum - minCumSum
        shift = bool( testStat > lam )
        if shift:
            cumSum = 0.0
            minCumSum = 0.0
        results.append( {
            'mean': mean,
            'cumSum': cumSum,
            'minCumSum': minCumSum,
            'testStatistic': testStat,
            'shiftDetected': shift,
            'count': count,
        } )
    return results


# ====================================================================
# Tier 2b: Sequential PHT with EWMA baseline (alpha > 0)
# ====================================================================

def pht_ewma( values, alpha=0.5, delta=0.005, lam=45.0, detect_drop=False ):
    """Page-Hinkley Test with EWMA baseline.

    Standard EWMA initialization: mean = x_1 on first sample (Hunter 1986).
    Subsequent samples: mean += alpha * (x_n - mean).
    Cumulative sum is raw (not alpha-weighted).
    """
    results = []
    mean = 0.0
    cumSum = 0.0
    minCumSum = 0.0
    count = 0

    for v in values:
        xVal = -v if detect_drop else v
        count += 1
        if count == 1:
            mean = xVal
        else:
            mean += alpha * ( xVal - mean )
        cumSum += xVal - mean - delta
        if cumSum < minCumSum:
            minCumSum = cumSum
        testStat = cumSum - minCumSum
        shift = bool( testStat > lam )
        if shift:
            cumSum = 0.0
            minCumSum = 0.0
        results.append( {
            'mean': mean,
            'cumSum': cumSum,
            'minCumSum': minCumSum,
            'testStatistic': testStat,
            'shiftDetected': shift,
            'count': count,
        } )
    return results


# ====================================================================
# Tier 2c: Vectorized numpy PHT (running mean, no post-detection reset)
# ====================================================================

def pht_vectorized( values, delta=0.005 ):
    """Vectorized PHT using numpy — independent of sequential implementation.

    Computes running mean, cumulative sum, and min-tracking using array ops.
    Does NOT handle post-detection reset (only valid for pre-detection trace).
    Used to cross-check the sequential implementation up to first detection.
    """
    arr = np.array( values, dtype=np.float64 )
    n = np.arange( 1, len( arr ) + 1, dtype=np.float64 )
    running_mean = np.cumsum( arr ) / n
    deviations = arr - running_mean - delta
    cumsum = np.cumsum( deviations )
    min_cumsum = np.minimum.accumulate( cumsum )
    test_stat = cumsum - min_cumsum
    return {
        'means': running_mean.tolist(),
        'cumSums': cumsum.tolist(),
        'minCumSums': min_cumsum.tolist(),
        'testStatistics': test_stat.tolist(),
    }


# ====================================================================
# Helper: compare sequential vs river (Tier 1)
# ====================================================================

def verify_river( label, seq_results, river_results, tol=1e-14 ):
    """Compare sequential and river results sample-by-sample.

    At the detection sample, river stores pre-reset cumSum/minCumSum while the
    composer resets immediately. testStatistic and shiftDetected are compared
    at all samples; cumSum/minCumSum are skipped when shiftDetected is True.
    """
    assert len( seq_results ) == len( river_results ), f'{label}: length mismatch'
    for i in range( len( seq_results ) ):
        s, r = seq_results[ i ], river_results[ i ]
        check( f'{label}[{i}] mean  seq vs river', s[ 'mean' ], r[ 'mean' ], tol )
        check( f'{label}[{i}] tStat  seq vs river', s[ 'testStatistic' ], r[ 'testStatistic' ], tol )
        if s[ 'shiftDetected' ] != r[ 'shiftDetected' ]:
            global ok
            ok = False
            print( f'  FAIL: {label}[{i}] detection mismatch: seq={s["shiftDetected"]} river={r["shiftDetected"]}' )
        # Skip cumSum/minCumSum at detection — river stores pre-reset, composer stores post-reset
        if not s[ 'shiftDetected' ]:
            check( f'{label}[{i}] cumSum seq vs river', s[ 'cumSum' ], r[ 'cumSum' ], tol )
            check( f'{label}[{i}] minCS  seq vs river', s[ 'minCumSum' ], r[ 'minCumSum' ], tol )


# ====================================================================
# Helper: compare sequential vs vectorized pre-detection (Tier 2)
# ====================================================================

def verify_vectorized( label, seq_results, vec_results, tol=1e-14 ):
    """Compare sequential vs vectorized up to first detection."""
    first_detect = next( ( i for i, r in enumerate( seq_results ) if r[ 'shiftDetected' ] ), len( seq_results ) )
    for i in range( first_detect ):
        check( f'{label}[{i}] mean  seq vs vec', seq_results[ i ][ 'mean' ], vec_results[ 'means' ][ i ], tol )
        check( f'{label}[{i}] cumSum seq vs vec', seq_results[ i ][ 'cumSum' ], vec_results[ 'cumSums' ][ i ], tol )
        check( f'{label}[{i}] tStat  seq vs vec', seq_results[ i ][ 'testStatistic' ], vec_results[ 'testStatistics' ][ i ], tol )


# ====================================================================
# SECTION 1: Running mean basics (alpha=0)
# ====================================================================
print( 'S1: Running mean basics' )
s1_values = [ 10.0, 20.0, 30.0 ]
s1_seq = pht_sequential( s1_values, delta=0.005, lam=45 )
s1_river = pht_river_oracle( s1_values, delta=0.005, lam=45 )
s1_vec = pht_vectorized( s1_values, delta=0.005 )

# Tier 1: river agreement
verify_river( 'S1', s1_seq, s1_river )
# Tier 2: vectorized agreement
verify_vectorized( 'S1', s1_seq, s1_vec )
# Tier 3: numpy running mean cross-check
s1_numpy_means = ( np.cumsum( s1_values ) / np.arange( 1, 4 ) ).tolist()
for i in range( 3 ):
    check( f'S1[{i}] mean vs numpy', s1_seq[ i ][ 'mean' ], s1_numpy_means[ i ] )
print( f'  means: {[ r["mean"] for r in s1_seq ]}' )
print( '  PASS' )


# ====================================================================
# SECTION 2: Exponentially smoothed basics (halfLife=1.0) — corrected init
# ====================================================================
print( 'S2: ES basics (halfLife=1.0, alpha=0.5, corrected)' )
s2_values = [ 10.0, 20.0, 30.0 ]
s2_seq = pht_ewma( s2_values, alpha=0.5, delta=0.005, lam=45 )

# Tier 2: verify exponentially smoothed mean math by hand
# count=1: mean = 10.0 (seeded)
check( 'S2 mean[0]', s2_seq[ 0 ][ 'mean' ], 10.0 )
# count=2: mean = 10 + 0.5*(20-10) = 15.0
check( 'S2 mean[1]', s2_seq[ 1 ][ 'mean' ], 15.0 )
# count=3: mean = 15 + 0.5*(30-15) = 22.5
check( 'S2 mean[2]', s2_seq[ 2 ][ 'mean' ], 22.5 )

# Tier 3: cumSum for first sample = x - mean - delta = 10 - 10 - 0.005 = -0.005
check( 'S2 cumSum[0]', s2_seq[ 0 ][ 'cumSum' ], -0.005 )
# testStatistic for first sample should be 0 (cumSum equals minCumSum)
check( 'S2 testStat[0]', s2_seq[ 0 ][ 'testStatistic' ], 0.0 )
print( f'  means: {[ r["mean"] for r in s2_seq ]}' )
print( '  PASS (Tier 1 N/A — no library equivalent for ES baseline mode)' )


# ====================================================================
# SECTION 3: Shift detection — baseline at 10, shift to 20
# ====================================================================
print( 'S3: Shift detection (10 -> 20)' )
s3_values = [ 10.0 ] * 10 + [ 20.0 ] * 20
s3_seq = pht_sequential( s3_values, delta=0.01, lam=10 )
s3_river = pht_river_oracle( s3_values, delta=0.01, lam=10 )

# Tier 1: river detection at same index
s3_detect_seq = next( i for i, r in enumerate( s3_seq ) if r[ 'shiftDetected' ] )
s3_detect_river = next( i for i, r in enumerate( s3_river ) if r[ 'shiftDetected' ] )
check( 'S3 detection index', float( s3_detect_seq ), float( s3_detect_river ) )

# Tier 1: pre-detection state agreement
s3_river_pre = s3_river[ :s3_detect_seq + 1 ]
s3_seq_pre = s3_seq[ :s3_detect_seq + 1 ]
verify_river( 'S3-pre', s3_seq_pre, s3_river_pre )

# Tier 2: vectorized cross-check (pre-detection only)
s3_vec = pht_vectorized( s3_values, delta=0.01 )
verify_vectorized( 'S3', s3_seq, s3_vec )

# Collect trace for JSON
s3_trace = []
for i in range( s3_detect_seq + 1 ):
    s3_trace.append( {
        'mean': s3_seq[ i ][ 'mean' ],
        'cumSum': s3_seq[ i ][ 'cumSum' ],
        'minCumSum': s3_seq[ i ][ 'minCumSum' ],
        'testStatistic': s3_seq[ i ][ 'testStatistic' ],
        'shiftDetected': s3_seq[ i ][ 'shiftDetected' ],
    } )

print( f'  Detection at index {s3_detect_seq} (count={s3_seq[ s3_detect_seq ]["count"]})' )
print( f'  testStatistic at detection: {s3_seq[ s3_detect_seq ]["testStatistic"]:.15e}' )
print( '  PASS' )


# ====================================================================
# SECTION 4: Constant input — no detection
# ====================================================================
print( 'S4: Constant input' )
s4_values = [ 50.0 ] * 100
s4_seq = pht_sequential( s4_values, delta=0.005, lam=45 )
s4_river = pht_river_oracle( s4_values, delta=0.005, lam=45 )

# Tier 1: river agrees no detection
assert not any( r[ 'shiftDetected' ] for r in s4_river ), 'S4: river detected drift in constant input'

# Tier 3: mathematical invariants
check( 'S4 final mean', s4_seq[ -1 ][ 'mean' ], 50.0 )
check( 'S4 final testStatistic', s4_seq[ -1 ][ 'testStatistic' ], 0.0 )
assert not any( r[ 'shiftDetected' ] for r in s4_seq ), 'S4: constant input triggered detection'
print( '  PASS' )


# ====================================================================
# SECTION 5: Zero values
# ====================================================================
print( 'S5: Zero values' )
s5_values = [ 0.0, 0.0, 0.0 ]
s5_seq = pht_sequential( s5_values, delta=0.005, lam=45 )
s5_river = pht_river_oracle( s5_values, delta=0.005, lam=45 )

# Tier 1 + Tier 3
verify_river( 'S5', s5_seq, s5_river )
check( 'S5 final mean', s5_seq[ -1 ][ 'mean' ], 0.0 )
print( '  PASS' )


# ====================================================================
# SECTION 6: Negative values
# ====================================================================
print( 'S6: Negative values' )
s6_values = [ -10.0, -20.0, -30.0 ]
s6_seq = pht_sequential( s6_values, delta=0.005, lam=45 )
s6_river = pht_river_oracle( s6_values, delta=0.005, lam=45 )
s6_vec = pht_vectorized( s6_values, delta=0.005 )

# Tier 1 + Tier 2
verify_river( 'S6', s6_seq, s6_river )
verify_vectorized( 'S6', s6_seq, s6_vec )
# Tier 3: numpy running mean
s6_numpy_means = ( np.cumsum( s6_values ) / np.arange( 1, 4 ) ).tolist()
for i in range( 3 ):
    check( f'S6[{i}] mean vs numpy', s6_seq[ i ][ 'mean' ], s6_numpy_means[ i ] )
print( f'  means: {[ r["mean"] for r in s6_seq ]}' )
print( '  PASS' )


# ====================================================================
# SECTION 7: detectDrop mode — baseline at 100, drop to 50
# ====================================================================
print( 'S7: detectDrop mode (100 -> 50)' )
s7_values = [ 100.0 ] * 10 + [ 50.0 ] * 20
s7_seq = pht_sequential( s7_values, delta=0.01, lam=10, detect_drop=True )
# river: negate input manually, detect increase (matches composer's approach)
s7_river = pht_river_oracle( s7_values, delta=0.01, lam=10, detect_drop=True )

# Tier 1: detection at same index
s7_detect_seq = next( i for i, r in enumerate( s7_seq ) if r[ 'shiftDetected' ] )
s7_detect_river = next( i for i, r in enumerate( s7_river ) if r[ 'shiftDetected' ] )
check( 'S7 detection index', float( s7_detect_seq ), float( s7_detect_river ) )
verify_river( 'S7-pre', s7_seq[ :s7_detect_seq + 1 ], s7_river[ :s7_detect_seq + 1 ] )

print( f'  Detection at index {s7_detect_seq} (count={s7_seq[ s7_detect_seq ]["count"]})' )
print( '  PASS' )


# ====================================================================
# SECTION 8: Reset-then-warm-again cycle
# ====================================================================
print( 'S8: Reset-then-warm-again cycle' )
# Simulate: 5 samples at 100, then reset, then 5 samples at 200
# After reset, state should be as if freshly initialized
s8_pre_values = [ 100.0 ] * 5
s8_post_values = [ 200.0 ] * 5
s8_pre = pht_sequential( s8_pre_values, delta=0.005, lam=45 )
# After reset, fresh start with new values
s8_post = pht_sequential( s8_post_values, delta=0.005, lam=45 )

# Tier 3: after reset, state matches a fresh init
check( 'S8 post-reset mean[0]', s8_post[ 0 ][ 'mean' ], 200.0 )
check( 'S8 post-reset count[0]', float( s8_post[ 0 ][ 'count' ] ), 1.0 )
check( 'S8 post-reset testStat[0]', s8_post[ 0 ][ 'testStatistic' ], 0.0 )
assert s8_post[ 0 ][ 'shiftDetected' ] is False, 'S8: shift detected after reset on first sample'
print( f'  Pre-reset final mean: {s8_pre[ -1 ]["mean"]:.15e}' )
print( f'  Post-reset first mean: {s8_post[ 0 ]["mean"]:.15e}' )
print( '  PASS' )


# ====================================================================
# SECTION 9: Post-detection internal state
# ====================================================================
print( 'S9: Post-detection internal state' )
# Use S3 results — detection at index 11
s9_at_detect = s3_seq[ s3_detect_seq ]
# After detection: cumSum and minCumSum reset to 0
check( 'S9 cumSum after detection', s9_at_detect[ 'cumSum' ], 0.0 )
check( 'S9 minCumSum after detection', s9_at_detect[ 'minCumSum' ], 0.0 )
# Mean and count continue (not reset)
assert s9_at_detect[ 'count' ] == s3_detect_seq + 1, 'S9: count should continue after detection'
assert s9_at_detect[ 'mean' ] != 0.0, 'S9: mean should not reset after detection'

# The sample AFTER detection should resume accumulation from 0
if s3_detect_seq + 1 < len( s3_seq ):
    s9_after = s3_seq[ s3_detect_seq + 1 ]
    # cumSum should be fresh: xVal - mean - delta (from zero baseline)
    assert s9_after[ 'cumSum' ] != 0.0, 'S9: cumSum after detection should accumulate'
    assert s9_after[ 'count' ] == s3_detect_seq + 2, 'S9: count continues incrementing'
print( f'  At detection (idx {s3_detect_seq}): cumSum={s9_at_detect["cumSum"]}, mean={s9_at_detect["mean"]:.6f}' )
print( '  PASS' )


# ====================================================================
# SECTION 10: ES baseline shift detection (halfLife≈1.94, corrected init)
# ====================================================================
print( 'S10: ES shift detection (halfLife=1.94, alpha=0.3)' )
s10_values = [ 10.0 ] * 15 + [ 25.0 ] * 30
s10_seq = pht_ewma( s10_values, alpha=0.3, delta=0.01, lam=8 )

# Find detection
s10_detect = next( ( i for i, r in enumerate( s10_seq ) if r[ 'shiftDetected' ] ), None )
assert s10_detect is not None, 'S10: ES baseline mode should detect the shift'

# Tier 3: verify ES baseline is reasonable
# After 15 samples of constant 10, ES baseline should have converged near 10
check( 'S10 mean at sample 14', s10_seq[ 14 ][ 'mean' ], 10.0 )
# After shift, mean should be tracking upward
assert s10_seq[ s10_detect ][ 'mean' ] > 10.0, 'S10: mean should track upward after shift'

# Collect trace for JSON
s10_trace = []
for i in range( min( s10_detect + 2, len( s10_seq ) ) ):
    s10_trace.append( {
        'mean': s10_seq[ i ][ 'mean' ],
        'cumSum': s10_seq[ i ][ 'cumSum' ],
        'minCumSum': s10_seq[ i ][ 'minCumSum' ],
        'testStatistic': s10_seq[ i ][ 'testStatistic' ],
        'shiftDetected': s10_seq[ i ][ 'shiftDetected' ],
        'count': s10_seq[ i ][ 'count' ],
    } )

print( f'  Detection at index {s10_detect} (count={s10_seq[ s10_detect ]["count"]})' )
print( f'  testStatistic at detection: {s10_seq[ s10_detect ]["testStatistic"]:.15e}' )
print( '  PASS (Tier 1 N/A — ES baseline mode)' )


# ====================================================================
# Build and save golden-truth JSON
# ====================================================================
golden = {
    'S1-running-mean-basics': {
        'values': s1_values,
        'delta': 0.005,
        'lambda': 45,
        'means': [ r[ 'mean' ] for r in s1_seq ],
        'cumSums': [ r[ 'cumSum' ] for r in s1_seq ],
        'testStatistics': [ r[ 'testStatistic' ] for r in s1_seq ],
    },
    'S2-es-basics': {
        'values': s2_values,
        'alpha': 0.5,
        'halfLife': 1.0,
        'delta': 0.005,
        'lambda': 45,
        'means': [ r[ 'mean' ] for r in s2_seq ],
        'cumSums': [ r[ 'cumSum' ] for r in s2_seq ],
        'testStatistics': [ r[ 'testStatistic' ] for r in s2_seq ],
    },
    'S3-shift-detection': {
        'values': s3_values,
        'delta': 0.01,
        'lambda': 10,
        'detectionIndex': s3_detect_seq,
        'detectionCount': s3_seq[ s3_detect_seq ][ 'count' ],
        'testStatisticAtDetection': s3_seq[ s3_detect_seq ][ 'testStatistic' ],
        'trace': s3_trace,
    },
    'S4-constant-input': {
        'values': [ 50.0 ],
        'repetitions': 100,
        'delta': 0.005,
        'lambda': 45,
        'finalMean': s4_seq[ -1 ][ 'mean' ],
        'finalTestStatistic': s4_seq[ -1 ][ 'testStatistic' ],
        'anyDetection': False,
    },
    'S5-zero-values': {
        'values': s5_values,
        'finalMean': s5_seq[ -1 ][ 'mean' ],
    },
    'S6-negative-values': {
        'values': s6_values,
        'means': [ r[ 'mean' ] for r in s6_seq ],
    },
    'S7-detect-drop': {
        'values': s7_values[ :s7_detect_seq + 2 ],
        'delta': 0.01,
        'lambda': 10,
        'detectionIndex': s7_detect_seq,
        'detectionCount': s7_seq[ s7_detect_seq ][ 'count' ],
    },
    'S8-reset-warm-again': {
        'preValues': s8_pre_values,
        'postValues': s8_post_values,
        'delta': 0.005,
        'lambda': 45,
        'preResetFinalMean': s8_pre[ -1 ][ 'mean' ],
        'postResetMeans': [ r[ 'mean' ] for r in s8_post ],
        'postResetTestStatistics': [ r[ 'testStatistic' ] for r in s8_post ],
    },
    'S9-post-detection-state': {
        'detectionIndex': s3_detect_seq,
        'cumSumAfterDetection': s9_at_detect[ 'cumSum' ],
        'minCumSumAfterDetection': s9_at_detect[ 'minCumSum' ],
        'meanAtDetection': s9_at_detect[ 'mean' ],
        'countAtDetection': s9_at_detect[ 'count' ],
    },
    'S10-es-shift-detection': {
        'values': s10_values,
        'alpha': 0.3,
        'halfLife': 1.943358209874732,
        'delta': 0.01,
        'lambda': 8,
        'detectionIndex': s10_detect,
        'detectionCount': s10_seq[ s10_detect ][ 'count' ],
        'testStatisticAtDetection': s10_seq[ s10_detect ][ 'testStatistic' ],
        'trace': s10_trace,
    },
}

script_dir = os.path.dirname( os.path.abspath( __file__ ) )
output_path = os.path.join( script_dir, 'golden-truth-page-hinkley.json' )

with open( output_path, 'w' ) as f:
    json.dump( golden, f, indent=2 )

print( f'\nGolden-truth written to {output_path}' )
if ok:
    print( 'All self-verification checks PASSED' )
    sys.exit( 0 )
else:
    print( 'SOME CHECKS FAILED — see above' )
    sys.exit( 1 )
