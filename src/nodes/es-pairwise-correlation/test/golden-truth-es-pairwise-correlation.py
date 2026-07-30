#!/usr/bin/env python3
"""
Golden-truth generator for es-pairwise-correlation node.

Reference libraries:
    pandas  3.0.1  — ewm(halflife=..., adjust=False).corr() / .mean()
    numpy   2.2.1  — arctanh (Fisher Z), random seed, array operations

Algorithm:
    The node implements Welford-style incremental EWMA with exponential decay:
        mean   += alpha * (value - mean)
        var    += alpha * (delta * (value - mean_new) - var)
        cov    += alpha * (delta_i * (value_j - mean_j_new) - cov)
        corr    = cov / sqrt(var_i * var_j)

    These match pandas ewm(adjust=False) exactly — the recursive mean update
    is identical, and the bias factor cancels in the correlation ratio.

Node behaviour modelled:
    - First sample (t=0): means initialized, sampleCount=1, no correlation
    - Subsequent samples: sampleCount incremented BEFORE EWMA computation
    - Correlation gated to 0 until sampleCount >= minSamples

Cross-reference convention with JS tests:
    Each section S1..S8 produces a key in the JSON output.
    JS test assertions reference: goldenTruth['S1-basic'].correlations[i]

Output: golden-truth-es-pairwise-correlation.json
"""

import json
import sys
import numpy as np
import pandas as pd


# ── Helpers ──────────────────────────────────────────────────────────────────

def alpha_from_halflife( hl ):
    """alpha = 1 - 2^(-1/hl), identical to the node's halfLifeToAlpha()."""
    return 1.0 - 2.0 ** ( -1.0 / hl )


def pandas_pairwise_correlations( data_dict, halflife ):
    """
    Compute per-step pairwise EWMA correlations using pandas ewm(adjust=False).

    Returns dict with:
        correlations: list[list[float|None]]  — per step, upper-triangle order
        means:        list[list[float]]       — per step, per variable
    """
    df = pd.DataFrame( data_dict )
    fields = list( data_dict.keys() )
    n = len( fields )
    num_steps = len( df )

    pairs = []
    for i in range( n ):
        for j in range( i + 1, n ):
            pairs.append( ( i, j, fields[ i ], fields[ j ] ) )

    all_corrs = []
    all_means = []

    means_df = df.ewm( halflife=halflife, adjust=False ).mean()

    for t in range( num_steps ):
        step_corrs = []
        for _i, _j, fi, fj in pairs:
            corr_series = df[ fi ].iloc[ :t + 1 ].ewm(
                halflife=halflife, adjust=False
            ).corr( df[ fj ].iloc[ :t + 1 ] )
            c = corr_series.iloc[ -1 ]
            step_corrs.append( float( c ) if not np.isnan( c ) else None )
        all_corrs.append( step_corrs )
        all_means.append( [ float( means_df[ f ].iloc[ t ] ) for f in fields ] )

    return {
        'correlations': all_corrs,
        'means': all_means,
        'fields': fields,
        'pairs': [ f"{fi}-{fj}" for _, _, fi, fj in pairs ],
    }


def node_covariances( data_dict, halflife ):
    """
    Replicate the node's exact covariance formula in Python.

    The node's cov formula differs from pandas ewm.cov (bias correction).
    This function uses the node's formula so the golden-truth matches exactly:
        delta_i = value_i - mean_i_old
        mean_i += alpha * delta_i          (update all means first)
        cov_ij += alpha * (delta_i * (value_j - mean_j_new) - cov_ij)

    Returns: covariances per step (list of lists), means per step.
    """
    fields = list( data_dict.keys() )
    n = len( fields )
    alpha = alpha_from_halflife( halflife )
    num_steps = len( data_dict[ fields[ 0 ] ] )

    pair_indices = []
    for i in range( n ):
        for j in range( i + 1, n ):
            pair_indices.append( ( i, j ) )
    num_pairs = len( pair_indices )

    # Initialize means with first sample
    means = [ data_dict[ fields[ i ] ][ 0 ] for i in range( n ) ]
    covs = [ 0.0 ] * num_pairs

    all_covs = [ [ 0.0 ] * num_pairs ]
    all_means = [ list( means ) ]

    for t in range( 1, num_steps ):
        vals = [ data_dict[ fields[ i ] ][ t ] for i in range( n ) ]

        # Compute deltas from OLD means
        deltas = [ vals[ i ] - means[ i ] for i in range( n ) ]

        # Update means to NEW values
        for i in range( n ):
            means[ i ] += alpha * deltas[ i ]

        # Update covariances using delta_i (OLD) and (value_j - mean_j_new)
        for p, ( i, j ) in enumerate( pair_indices ):
            covs[ p ] += alpha * (
                ( deltas[ i ] * ( vals[ j ] - means[ j ] ) ) - covs[ p ]
            )

        all_covs.append( list( covs ) )
        all_means.append( list( means ) )

    return all_covs, all_means


def gate_correlations( raw_corrs, min_samples, num_pairs=None ):
    """
    Apply the node's warm-up gating: return 0 until sampleCount >= minSamples.
    sampleCount at step t = t + 1 (first sample counts as 1).

    raw_corrs: list of (list|float|None) per step from pandas.
    For single-pair scenarios, raw_corrs[t] is [value] — we flatten to scalar.
    For multi-pair, raw_corrs[t] is [v0, v1, ...].
    """
    gated = []
    for t, step in enumerate( raw_corrs ):
        sample_count = t + 1
        if sample_count < min_samples:
            if num_pairs is not None:
                gated.append( [ 0.0 ] * num_pairs )
            else:
                gated.append( 0.0 )
        else:
            if num_pairs is not None:
                gated.append( [
                    ( c if c is not None else 0.0 ) for c in step
                ] )
            else:
                c = step[ 0 ] if isinstance( step, list ) else step
                gated.append( c if c is not None else 0.0 )
    return gated


def fisher_z( r, cap=0.9999 ):
    """Fisher Z transform with capping, identical to the node."""
    r_capped = max( -cap, min( cap, r ) )
    return 0.5 * np.log( ( 1 + r_capped ) / ( 1 - r_capped ) )


# ── Self-verification helpers ────────────────────────────────────────────────

def verify( condition, msg, errors ):
    """Assert a condition; accumulate errors instead of failing immediately."""
    if not condition:
        errors.append( msg )
        print( f"  FAIL: {msg}" )
        return False
    return True


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    results = {}
    errors = []

    # ── S1: Basic 2-variable positive correlation ────────────────────────
    print( "S1: Basic 2-variable positive correlation" )
    hl_s1 = 4.0
    ms_s1 = 3
    data_s1 = {
        'x': [ 1.0, 3.0, 2.0, 5.0, 4.0, 6.0, 3.0, 7.0, 8.0, 5.0 ],
        'y': [ 2.0, 4.0, 1.0, 6.0, 5.0, 7.0, 2.0, 8.0, 9.0, 4.0 ],
    }
    res_s1 = pandas_pairwise_correlations( data_s1, hl_s1 )
    gated_s1 = gate_correlations( res_s1[ 'correlations' ], ms_s1 )

    # Verify: first ms-1 steps are gated to 0
    for t in range( ms_s1 - 1 ):
        verify( gated_s1[ t ] == 0.0,
                f"S1 t={t}: expected 0, got {gated_s1[ t ]}", errors )
    # Verify: step ms-1 (sample ms) is computed and positive
    verify( gated_s1[ ms_s1 - 1 ] > 0,
            f"S1 t={ms_s1 - 1}: expected > 0, got {gated_s1[ ms_s1 - 1 ]}", errors )
    # Verify: all computed correlations in [-1, 1]
    for t in range( ms_s1 - 1, len( gated_s1 ) ):
        verify( -1.0 <= gated_s1[ t ] <= 1.0,
                f"S1 t={t}: correlation {gated_s1[ t ]} outside [-1,1]", errors )
    print( f"  {len( data_s1[ 'x' ] )} steps, gating verified" )

    results[ 'S1-basic' ] = {
        'halflife': hl_s1,
        'alpha': alpha_from_halflife( hl_s1 ),
        'minSamples': ms_s1,
        'fields': res_s1[ 'fields' ],
        'data': data_s1,
        'correlations': gated_s1,
        'means': res_s1[ 'means' ],
    }

    # ── S2: 3-variable mixed correlation (positive + negative) ───────────
    print( "S2: 3-variable mixed correlation" )
    hl_s2 = 5.0
    ms_s2 = 3
    data_s2 = {
        'A': [ 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0 ],
        'B': [ 2.0, 4.0, 5.0, 8.0, 9.0, 12.0, 13.0, 16.0, 17.0, 20.0 ],
        'C': [ 10.0, 9.0, 7.0, 6.0, 5.0, 3.0, 2.0, 1.0, -1.0, -2.0 ],
    }
    res_s2 = pandas_pairwise_correlations( data_s2, hl_s2 )
    gated_s2 = gate_correlations( res_s2[ 'correlations' ], ms_s2, num_pairs=3 )

    # Compute node-formula covariances for S2
    covs_s2, _ = node_covariances( data_s2, hl_s2 )

    # Verify: A-B positive, A-C negative, B-C negative at final step
    final_s2 = gated_s2[ -1 ]
    verify( final_s2[ 0 ] > 0.9, f"S2 A-B should be > 0.9, got {final_s2[ 0 ]}", errors )
    verify( final_s2[ 1 ] < -0.9, f"S2 A-C should be < -0.9, got {final_s2[ 1 ]}", errors )
    verify( final_s2[ 2 ] < -0.9, f"S2 B-C should be < -0.9, got {final_s2[ 2 ]}", errors )
    print( f"  Final: A-B={final_s2[ 0 ]:.6f}, A-C={final_s2[ 1 ]:.6f}, "
           f"B-C={final_s2[ 2 ]:.6f}" )

    results[ 'S2-mixed' ] = {
        'halflife': hl_s2,
        'alpha': alpha_from_halflife( hl_s2 ),
        'minSamples': ms_s2,
        'fields': res_s2[ 'fields' ],
        'pairs': res_s2[ 'pairs' ],
        'data': data_s2,
        'correlations': gated_s2,
        'covariances': covs_s2,
    }

    # ── S3: Fisher Z transform verification ──────────────────────────────
    print( "S3: Fisher Z transform" )
    # Use S1 final correlation
    r_input = gated_s1[ -1 ]
    fz = fisher_z( r_input, cap=0.9999 )

    # Round-trip: tanh(fisherZ(r)) == r
    r_back = float( np.tanh( fz ) )
    verify( abs( r_back - r_input ) < 1e-12,
            f"S3 round-trip diff = {abs( r_back - r_input )}", errors )

    # Verify against numpy.arctanh for known values
    test_rs = [ -0.9, -0.5, 0.0, 0.5, 0.9 ]
    fz_known = {}
    for r in test_rs:
        z = fisher_z( r, cap=0.9999 )
        z_ref = float( np.arctanh( r ) )
        verify( abs( z - z_ref ) < 1e-10,
                f"S3 fisherZ({r}) = {z}, arctanh = {z_ref}", errors )
        fz_known[ str( r ) ] = z

    print( f"  r={r_input:.12f} -> z={fz:.12f}, round-trip verified" )
    print( f"  {len( test_rs )} known values verified against numpy.arctanh" )

    results[ 'S3-fisherZ' ] = {
        'r_input': r_input,
        'fisherZ': fz,
        'roundtrip_r': r_back,
        'known_values': fz_known,
        'cap': 0.9999,
    }

    # ── S4: Warm-up gating with perfect linear data ────────��─────────────
    print( "S4: Warm-up gating (perfect linear, minSamples=5)" )
    hl_s4 = 3.0
    ms_s4 = 5
    data_s4 = {
        'p': [ 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0 ],
        'q': [ 2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0 ],
    }
    res_s4 = pandas_pairwise_correlations( data_s4, hl_s4 )
    gated_s4 = gate_correlations( res_s4[ 'correlations' ], ms_s4 )

    # Verify: first ms-1 steps gated, rest = 1.0 (perfect linear)
    for t in range( ms_s4 - 1 ):
        verify( gated_s4[ t ] == 0.0,
                f"S4 t={t}: expected 0 (gated), got {gated_s4[ t ]}", errors )
    for t in range( ms_s4 - 1, len( gated_s4 ) ):
        verify( abs( gated_s4[ t ] - 1.0 ) < 1e-10,
                f"S4 t={t}: expected 1.0, got {gated_s4[ t ]}", errors )
    print( f"  First {ms_s4 - 1} gated, remaining = 1.0" )

    results[ 'S4-warmup' ] = {
        'halflife': hl_s4,
        'alpha': alpha_from_halflife( hl_s4 ),
        'minSamples': ms_s4,
        'data': data_s4,
        'correlations': gated_s4,
    }

    # ── S5: 4-variable with negative pair (seeded random) ────────────────
    print( "S5: 4-variable with negative pair" )
    hl_s5 = 6.0
    ms_s5 = 3
    np.random.seed( 42 )
    n_pts = 20
    base = np.arange( n_pts, dtype=float )
    data_s5 = {
        'temp': ( base + np.random.normal( 0, 0.1, n_pts ) ).tolist(),
        'pressure': ( 1.5 * base + np.random.normal( 0, 0.1, n_pts ) ).tolist(),
        'flow': ( 0.8 * base + np.random.normal( 0, 0.1, n_pts ) ).tolist(),
        'vibration': ( -0.5 * base + np.random.normal( 0, 0.1, n_pts ) ).tolist(),
    }
    res_s5 = pandas_pairwise_correlations( data_s5, hl_s5 )
    gated_s5 = gate_correlations( res_s5[ 'correlations' ], ms_s5, num_pairs=6 )

    # Verify: positive pairs (temp-press, temp-flow, press-flow) > 0.99
    # Negative pairs (temp-vib, press-vib, flow-vib) < -0.99
    final_s5 = gated_s5[ -1 ]
    pos_indices = [ 0, 1, 3 ]   # temp-pressure, temp-flow, pressure-flow
    neg_indices = [ 2, 4, 5 ]   # temp-vibration, pressure-vibration, flow-vibration
    for idx in pos_indices:
        verify( final_s5[ idx ] > 0.99,
                f"S5 pair {idx} ({res_s5[ 'pairs' ][ idx ]}) = {final_s5[ idx ]}, "
                f"expected > 0.99", errors )
    for idx in neg_indices:
        verify( final_s5[ idx ] < -0.99,
                f"S5 pair {idx} ({res_s5[ 'pairs' ][ idx ]}) = {final_s5[ idx ]}, "
                f"expected < -0.99", errors )
    print( f"  {n_pts} steps, 6 pairs; positive > 0.99, negative < -0.99" )

    results[ 'S5-four-var' ] = {
        'halflife': hl_s5,
        'alpha': alpha_from_halflife( hl_s5 ),
        'minSamples': ms_s5,
        'fields': list( data_s5.keys() ),
        'pairs': res_s5[ 'pairs' ],
        'data': data_s5,
        'correlations': gated_s5,
        'finalCorrelations': final_s5,
    }

    # ── S6: NaN recovery (state preservation) ────────────────────────────
    print( "S6: NaN recovery" )
    hl_s6 = 4.0
    ms_s6 = 2
    # Golden-truth for valid-only data: the node skips invalid inputs,
    # so after interleaved NaN/valid, its state matches valid-only processing.
    valid_data_s6 = {
        'x': [ 5.0, 10.0, 15.0, 20.0, 25.0, 30.0 ],
        'y': [ 10.0, 20.0, 30.0, 40.0, 50.0, 60.0 ],
    }
    res_s6 = pandas_pairwise_correlations( valid_data_s6, hl_s6 )
    gated_s6 = gate_correlations( res_s6[ 'correlations' ], ms_s6 )

    # Perfect linear → correlations should be 1.0 after warm-up
    for t in range( ms_s6 - 1, len( gated_s6 ) ):
        verify( abs( gated_s6[ t ] - 1.0 ) < 1e-10,
                f"S6 t={t}: expected 1.0, got {gated_s6[ t ]}", errors )
    print( f"  {len( valid_data_s6[ 'x' ] )} valid samples, correlation = 1.0" )

    results[ 'S6-nan-recovery' ] = {
        'halflife': hl_s6,
        'minSamples': ms_s6,
        'validData': valid_data_s6,
        'correlationsAfterValidOnly': gated_s6,
    }

    # ── S7: Covariance verification ──────────────────────────────────────
    print( "S7: Covariance values" )
    hl_s7 = 5.0
    data_s7 = {
        'a': [ 1.0, 3.0, 5.0, 2.0, 4.0, 6.0, 3.0, 5.0 ],
        'b': [ 2.0, 6.0, 10.0, 4.0, 8.0, 12.0, 6.0, 10.0 ],
        'c': [ 3.0, 1.0, 4.0, 1.0, 5.0, 9.0, 2.0, 6.0 ],
    }
    covs_s7, means_s7 = node_covariances( data_s7, hl_s7 )
    res_s7 = pandas_pairwise_correlations( data_s7, hl_s7 )

    # Cross-verify: correlations from pandas match correlations derived
    # from node-formula covariances (at least at the final step).
    alpha_s7 = alpha_from_halflife( hl_s7 )
    fields_s7 = [ 'a', 'b', 'c' ]
    n_s7 = len( fields_s7 )

    # Recompute variances using node formula to derive correlations
    node_vars = [ 0.0 ] * n_s7
    node_means = [ data_s7[ f ][ 0 ] for f in fields_s7 ]
    for t in range( 1, len( data_s7[ 'a' ] ) ):
        vals = [ data_s7[ f ][ t ] for f in fields_s7 ]
        deltas = [ vals[ i ] - node_means[ i ] for i in range( n_s7 ) ]
        for i in range( n_s7 ):
            node_means[ i ] += alpha_s7 * deltas[ i ]
            node_vars[ i ] += alpha_s7 * (
                ( deltas[ i ] * ( vals[ i ] - node_means[ i ] ) ) - node_vars[ i ]
            )

    # Derive correlations from final covariances/variances
    final_covs = covs_s7[ -1 ]
    pair_idx = [ ( 0, 1 ), ( 0, 2 ), ( 1, 2 ) ]
    derived_corrs = []
    for p, ( i, j ) in enumerate( pair_idx ):
        import math
        denom = math.sqrt( max( node_vars[ i ], 1e-12 ) * max( node_vars[ j ], 1e-12 ) )
        derived_corrs.append( final_covs[ p ] / denom )

    # Compare against pandas correlations at final step
    pandas_final = res_s7[ 'correlations' ][ -1 ]
    for p in range( 3 ):
        ref = pandas_final[ p ]
        if ref is not None:
            verify( abs( derived_corrs[ p ] - ref ) < 1e-10,
                    f"S7 pair {p}: node-derived corr {derived_corrs[ p ]:.12f} "
                    f"vs pandas {ref:.12f}", errors )
    print( f"  {len( data_s7[ 'a' ] )} steps, 3 pairs; "
           f"node covariance → correlation matches pandas" )

    results[ 'S7-covariance' ] = {
        'halflife': hl_s7,
        'alpha': alpha_s7,
        'data': data_s7,
        'fields': fields_s7,
        'pairs': [ 'a-b', 'a-c', 'b-c' ],
        'covariances': covs_s7,
        'means': means_s7,
        'pandasCorrelations': [
            ( c if c is not None else None ) for c in pandas_final
        ],
    }

    # ── S8: Alpha from half-life verification ────────────────────────────
    print( "S8: Alpha from half-life" )
    test_hls = [ 1.0, 2.0, 5.0, 10.0, 13.5, 20.0, 50.0, 100.0 ]
    alphas = {}
    for hl in test_hls:
        a = alpha_from_halflife( hl )
        # Verify: (1 - alpha)^hl == 0.5 (definition of half-life)
        decay = ( 1.0 - a ) ** hl
        verify( abs( decay - 0.5 ) < 1e-10,
                f"S8 hl={hl}: (1-alpha)^hl = {decay}, expected 0.5", errors )
        alphas[ str( hl ) ] = a
    print( f"  {len( test_hls )} half-lives verified: (1-alpha)^hl == 0.5" )

    results[ 'S8-alpha' ] = {
        'halflifes': test_hls,
        'alphas': alphas,
    }

    # ── Write output ─────────────────────────────────────────────────────
    output_path = 'golden-truth-es-pairwise-correlation.json'
    with open( output_path, 'w' ) as f:
        json.dump( results, f, indent=2 )
    print( f"\nWrote golden-truth to {output_path}" )

    if errors:
        print( f"\n{len( errors )} CHECKS FAILED:" )
        for e in errors:
            print( f"  - {e}" )
        sys.exit( 1 )
    else:
        print( "All self-verification checks PASSED." )
        sys.exit( 0 )


if __name__ == '__main__':
    main()
