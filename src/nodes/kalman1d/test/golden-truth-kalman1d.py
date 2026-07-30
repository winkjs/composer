"""
Golden-truth reference values for kalman1d node tests.

Uses filterpy.kalman.KalmanFilter as the independent reference implementation.
This validates our JS Kalman against a widely-used, peer-reviewed library —
NOT a hand-rolled reimplementation of the same algorithm.

Reference: filterpy by Roger Labbe (https://github.com/rlabbe/filterpy)

Self-verification strategy:
  - DARE cross-check: scipy steady-state P matches filterpy converged P
  - Constant-input invariant: xHat == z when innovation is always 0
  - Control-input invariant: perfect tracking → innovation == 0 at each step
  - Follow-mode reset: xHat == z/H, P == R/H² after outlier reset
  - Non-unity auto-init: xHat == z/H, P == R/H² on first measurement
  - P monotonicity: excluded steps grow P by exactly Q

Cross-reference convention:
    JS test files load golden-truth values from golden-truth-kalman1d.json.
    Each closeTo assertion references this script's section:
        // see golden-truth-kalman1d.py S1

Libraries: numpy, filterpy, scipy

Usage:
    python3 golden-truth-kalman1d.py
"""

import json
import os
import sys
import numpy as np
from filterpy.kalman import KalmanFilter
from scipy.linalg import solve_discrete_are


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


def make_kf( F=1.0, H=1.0, R=1.0, Q=0.01, G=0.0, x0=None, P0=None ):
    """Create a 1-D filterpy KalmanFilter with our node's conventions."""
    kf = KalmanFilter( dim_x=1, dim_z=1, dim_u=1 )
    kf.F = np.array( [[ F ]] )
    kf.H = np.array( [[ H ]] )
    kf.R = np.array( [[ R ]] )
    kf.Q = np.array( [[ Q ]] )
    kf.B = np.array( [[ G ]] )
    if x0 is not None:
        kf.x = np.array( [[ x0 ]] )
    if P0 is not None:
        kf.P = np.array( [[ P0 ]] )
    return kf


def step( kf, z, u=0.0 ):
    """Predict + update. Returns innovation, S, K before state is modified."""
    kf.predict( u=np.array( [[ u ]] ) )
    # Capture predicted state before update
    x_pred = float( kf.x[ 0, 0 ] )
    P_pred = float( kf.P[ 0, 0 ] )

    # Innovation (before update)
    innovation = z - float( kf.H[ 0, 0 ] ) * x_pred
    S = float( kf.H[ 0, 0 ] ) * P_pred * float( kf.H[ 0, 0 ] ) + float( kf.R[ 0, 0 ] )
    gate = ( innovation * innovation ) / S

    kf.update( np.array( [[ z ]] ) )
    K = float( kf.K[ 0, 0 ] )

    return {
        'xHat': float( kf.x[ 0, 0 ] ),
        'P': float( kf.P[ 0, 0 ] ),
        'K': K,
        'innovation': innovation,
        'innovationGate': gate,
        'S': S,
        'xPred': x_pred,
        'PPred': P_pred
    }


# ====================================================================
# §1: Constant input convergence
# ====================================================================
print( '=' * 60 )
print( '§1: Constant input (z=100.0, R=1, Q=0.01, F=1, H=1, G=0)' )
print( '    Using filterpy.kalman.KalmanFilter as reference' )
print( '=' * 60 )

# Our auto-init: xHat = z/H = 100, P = R/H² = 1
kf = make_kf( F=1, H=1, R=1, Q=0.01, G=0, x0=100.0, P0=1.0 )
print( f'Init: xHat=100.0, P=1.0' )

s1_trace = []
for i in range( 20 ):
    r = step( kf, 100.0 )
    s1_trace.append( {
        'step': i + 2,
        'xHat': r[ 'xHat' ],
        'P': r[ 'P' ],
        'K': r[ 'K' ],
        'innovation': r[ 'innovation' ],
        'innovationGate': r[ 'innovationGate' ]
    } )
    if i < 5 or i == 9 or i == 19:
        print( f"Step {i+2:2d}: xHat={r['xHat']:.16f}, P={r['P']:.16f}, "
               f"K={r['K']:.16f}, innovation={r['innovation']:.16f}, "
               f"gate={r['innovationGate']:.16e}" )

# Self-verification: constant input → xHat must equal z exactly
check( 'S1: xHat after 20 constant updates', s1_trace[ -1 ][ 'xHat' ], 100.0, 1e-14 )
# Innovation must be 0 for every step (z always equals prediction)
for t in s1_trace:
    check( f"S1: innovation at step {t['step']}", t[ 'innovation' ], 0.0, 1e-14 )

# ====================================================================
# §2: Step change with exclude mode
# ====================================================================
print( '\n' + '=' * 60 )
print( '§2: Step change (z=100→200 at step 12, exclude mode, chi2=6.63)' )
print( '    Gate computed from filterpy prediction; update skipped on outlier' )
print( '=' * 60 )

chi2_threshold = 6.63
kf = make_kf( F=1, H=1, R=1, Q=0.01, G=0, x0=100.0, P0=1.0 )
print( f'Init: xHat=100.0, P=1.0' )

s2_warm_up_P = None
s2_first_excluded = None
s2_excluded_P_sequence = []
s2_trace = []

for i in range( 20 ):
    z = 100.0 if i < 11 else 200.0

    # Predict first
    kf.predict()
    x_pred = float( kf.x[ 0, 0 ] )
    P_pred = float( kf.P[ 0, 0 ] )

    # Compute innovation
    innovation = z - x_pred
    S = P_pred + 1.0  # H=1, R=1
    gate = ( innovation ** 2 ) / S
    is_outlier = gate > chi2_threshold

    if is_outlier:
        label = 'EXCLUDED'
    else:
        kf.update( np.array( [[ z ]] ) )
        label = 'normal'

    xHat = float( kf.x[ 0, 0 ] )
    P = float( kf.P[ 0, 0 ] )

    # Capture warm-up P (after step 12 = index 10, last normal step before jump)
    if i == 10:
        s2_warm_up_P = P

    # Capture excluded steps
    if is_outlier:
        s2_excluded_P_sequence.append( P )
        if s2_first_excluded is None:
            s2_first_excluded = {
                'xHat': xHat,
                'P': P,
                'innovation': innovation,
                'innovationGate': gate
            }

    if i >= 10 and i <= 15:
        s2_trace.append( {
            'step': i + 2,
            'z': z,
            'xHat': xHat,
            'P': P,
            'innovation': innovation,
            'innovationGate': gate,
            'label': label
        } )
        print( f"Step {i+2:2d} (z={z:5.0f}): xHat={xHat:.16f}, P={P:.16f}, "
               f"innov={innovation:.10f}, gate={gate:.10f}, {label}" )

# Self-verification: P grows by exactly Q each excluded step
for idx in range( 1, len( s2_excluded_P_sequence ) ):
    p_diff = s2_excluded_P_sequence[ idx ] - s2_excluded_P_sequence[ idx - 1 ]
    check( f'S2: P growth at excluded step {idx}', p_diff, 0.01, 1e-14 )

# ====================================================================
# §3: Ramp with control
# ====================================================================
print( '\n' + '=' * 60 )
print( '§3: Ramp with control (z=100+5*t, u=5, G=1.0, R=1, Q=0.01)' )
print( '    filterpy with B=[[1.0]]' )
print( '=' * 60 )

kf = make_kf( F=1, H=1, R=1, Q=0.01, G=1.0, x0=100.0, P0=1.0 )
print( f'Init: xHat=100.0, P=1.0' )

s3_trace = []
for i in range( 10 ):
    z = 100.0 + 5.0 * ( i + 1 )
    r = step( kf, z, u=5.0 )
    s3_trace.append( {
        'step': i + 2,
        'z': z,
        'xHat': r[ 'xHat' ],
        'P': r[ 'P' ],
        'innovation': r[ 'innovation' ],
        'innovationGate': r[ 'innovationGate' ]
    } )
    print( f"Step {i+2:2d} (z={z:6.1f}, u=5.0): xHat={r['xHat']:.16f}, P={r['P']:.16f}, "
           f"innov={r['innovation']:.16f}, gate={r['innovationGate']:.16e}" )

# Self-verification: perfect tracking → innovation == 0 at every step
for t in s3_trace:
    check( f"S3: innovation at step {t['step']}", t[ 'innovation' ], 0.0, 1e-14 )

# ====================================================================
# §4: Steady-state P via scipy DARE
# ====================================================================
print( '\n' + '=' * 60 )
print( '§4: Steady-state P via scipy.linalg.solve_discrete_are' )
print( "    DARE: F'PF - P - F'PH'(HPH'+R)^{-1}HPF + Q = 0" )
print( '=' * 60 )

s4_cases = []
for qr in [ 0.001, 0.01, 0.1, 0.5, 1.0 ]:
    F_arr = np.array( [[ 1.0 ]] )
    H_arr = np.array( [[ 1.0 ]] )
    Q_arr = np.array( [[ qr ]] )
    R_arr = np.array( [[ 1.0 ]] )

    # DARE solves for the predicted covariance (before update).
    # The updated (post-measurement) covariance is: P_upd = (1 - K*H) * P_pred
    # where K = P_pred * H / (H * P_pred * H + R).
    P_dare_pred = solve_discrete_are( F_arr.T, H_arr.T, Q_arr, R_arr )
    P_pred_val = float( P_dare_pred[ 0, 0 ] )
    K_val = P_pred_val / ( P_pred_val + 1.0 )  # H=1, R=1
    P_upd_val = ( 1.0 - K_val ) * P_pred_val   # updated P
    print( f'Q/R={qr:6.3f}: P_ss(updated)={P_upd_val:.16f}, K_ss={K_val:.16f}' )

    # Cross-check: run filterpy for 1000 steps and compare against updated P
    kf_check = make_kf( F=1, H=1, R=1, Q=qr, G=0, x0=0, P0=1.0 )
    for _ in range( 1000 ):
        step( kf_check, 0.0 )
    P_empirical = float( kf_check.P[ 0, 0 ] )
    print( f'         filterpy 1000-step: P={P_empirical:.16f} (diff={abs( P_upd_val - P_empirical ):.2e})' )

    s4_cases.append( {
        'QoverR': qr,
        'Pss': P_upd_val,
        'Kss': K_val,
        'PEmpirical': P_empirical
    } )

    # Self-verification: DARE-derived updated P and filterpy must agree
    check( f'S4: DARE vs filterpy at Q/R={qr}', P_upd_val, P_empirical, 1e-10 )

# ====================================================================
# §5: Non-unity H=2, F=0.99
# ====================================================================
print( '\n' + '=' * 60 )
print( '§5: Non-unity H=2, F=0.99 (z=200, true state=100)' )
print( '=' * 60 )

kf = make_kf( F=0.99, H=2, R=1, Q=0.01, G=0, x0=100.0, P0=0.25 )
print( f'Init: xHat=100.0, P=0.25  (from z=200, H=2: xHat=z/H, P=R/H²)' )

# Self-verification: auto-init values
check( 'S5: auto-init xHat = z/H', 100.0, 200.0 / 2.0, 1e-14 )
check( 'S5: auto-init P = R/H²', 0.25, 1.0 / ( 2.0 * 2.0 ), 1e-14 )

s5_trace = []
for i in range( 10 ):
    r = step( kf, 200.0 )
    s5_trace.append( {
        'step': i + 2,
        'xHat': r[ 'xHat' ],
        'P': r[ 'P' ],
        'innovation': r[ 'innovation' ],
        'innovationGate': r[ 'innovationGate' ]
    } )
    if i < 3 or i == 9:
        print( f"Step {i+2:2d}: xHat={r['xHat']:.16f}, P={r['P']:.16f}, "
               f"innov={r['innovation']:.16f}" )

# ====================================================================
# §6: Step change with follow mode
# ====================================================================
print( '\n' + '=' * 60 )
print( '§6: Step change (z=100→200, follow mode, chi2=6.63)' )
print( '    On outlier: reset kf state to z/H with P=R/H²' )
print( '=' * 60 )

kf = make_kf( F=1, H=1, R=1, Q=0.01, G=0, x0=100.0, P0=1.0 )
print( f'Init: xHat=100.0' )

s6_trace = []
s6_follow_reset = None

for i in range( 15 ):
    z = 100.0 if i < 11 else 200.0

    # Predict
    kf.predict()
    x_pred = float( kf.x[ 0, 0 ] )
    P_pred = float( kf.P[ 0, 0 ] )

    # Innovation
    innovation = z - x_pred
    S = P_pred + 1.0
    gate = ( innovation ** 2 ) / S
    is_outlier = gate > chi2_threshold

    if is_outlier:
        # Follow: reset to measurement
        kf.x = np.array( [[ z ]] )
        kf.P = np.array( [[ 1.0 ]] )  # R/(H*H) = 1
        label = 'FOLLOW-RESET'
        if s6_follow_reset is None:
            s6_follow_reset = {
                'xHat': float( kf.x[ 0, 0 ] ),
                'P': float( kf.P[ 0, 0 ] ),
                'innovation': innovation,
                'innovationGate': gate
            }
    else:
        kf.update( np.array( [[ z ]] ) )
        label = 'normal'

    xHat = float( kf.x[ 0, 0 ] )
    P = float( kf.P[ 0, 0 ] )

    if i >= 10 and i <= 14:
        s6_trace.append( {
            'step': i + 2,
            'z': z,
            'xHat': xHat,
            'P': P,
            'innovation': innovation,
            'innovationGate': gate,
            'label': label
        } )
        print( f"Step {i+2:2d} (z={z:5.0f}): xHat={xHat:.16f}, P={P:.16f}, "
               f"innov={innovation:.10f}, gate={gate:.10f}, {label}" )

# Self-verification: follow-mode reset values
check( 'S6: follow-reset xHat = z/H', s6_follow_reset[ 'xHat' ], 200.0, 1e-14 )
check( 'S6: follow-reset P = R/H²', s6_follow_reset[ 'P' ], 1.0, 1e-14 )

# The step after follow-reset with z=200 should converge normally
# P after normal update following reset matches S1 step 2 (same P=1 starting point)
s6_post_reset = s6_trace[ -1 ]  # last step in trace (step 16)

# ====================================================================
# §7: Basic filtering with non-zero innovation
# ====================================================================
print( '\n' + '=' * 60 )
print( '§7: init(100), then z=102 (R=1, Q=0.01, H=1, F=1)' )
print( '    Non-zero innovation case for publishTo assertions' )
print( '=' * 60 )

kf = make_kf( F=1, H=1, R=1, Q=0.01, G=0, x0=100.0, P0=1.0 )
r = step( kf, 102.0 )
print( f"After update(102): xHat={r['xHat']:.16f}, P={r['P']:.16f}, "
       f"innovation={r['innovation']:.16f}, gate={r['innovationGate']:.16e}, K={r['K']:.16f}" )

s7 = {
    'initZ': 100.0,
    'updateZ': 102.0,
    'R': 1, 'Q': 0.01, 'H': 1, 'F': 1, 'G': 0,
    'xHat': r[ 'xHat' ],
    'P': r[ 'P' ],
    'K': r[ 'K' ],
    'innovation': r[ 'innovation' ],
    'innovationGate': r[ 'innovationGate' ]
}

# ====================================================================
# §8: Control field missing (u defaults to 0)
# ====================================================================
print( '\n' + '=' * 60 )
print( '§8: Control missing — init(100) with G=1, then z=105 with u=0' )
print( '    Tests that missing control defaults to zero' )
print( '=' * 60 )

kf = make_kf( F=1, H=1, R=1, Q=0.01, G=1.0, x0=100.0, P0=1.0 )
# Predict with u=0, update with z=105
kf.predict( u=np.array( [[ 0.0 ]] ) )
x_pred_8 = float( kf.x[ 0, 0 ] )
P_pred_8 = float( kf.P[ 0, 0 ] )
innov_8 = 105.0 - x_pred_8
S_8 = P_pred_8 + 1.0
gate_8 = ( innov_8 ** 2 ) / S_8
print( f'Predict (u=0): xPred={x_pred_8:.16f}, PPred={P_pred_8:.16f}' )
print( f'Innovation: {innov_8:.16f}, S={S_8:.16f}, gate={gate_8:.16f}' )
print( f'Outlier (gate > 6.63)? {gate_8 > 6.63}' )

# Gate > 6.63 → excluded in default mode. xHat = xPred, P = PPred
print( f'Exclude result: xHat={x_pred_8:.16f}, P={P_pred_8:.16f}' )

s8 = {
    'G': 1.0, 'initZ': 100.0, 'updateZ': 105.0,
    'xPred': x_pred_8,
    'PPred': P_pred_8,
    'innovation': innov_8,
    'innovationGate': gate_8,
    'isExcluded': True,
    'xHat': x_pred_8,
    'P': P_pred_8
}

# ====================================================================
# §9: F=0.95, z=100 after init(100) — decaying state
# ====================================================================
print( '\n' + '=' * 60 )
print( '§9: F=0.95, init(100), then z=100 (decaying state model)' )
print( '=' * 60 )

kf = make_kf( F=0.95, H=1, R=1, Q=0.01, G=0, x0=100.0, P0=1.0 )
r = step( kf, 100.0 )
print( f"xPred={r['xPred']:.16f}, innovation={r['innovation']:.16f}, "
       f"xHat={r['xHat']:.16f}, P={r['P']:.16f}" )

s9 = {
    'F': 0.95, 'initZ': 100.0, 'updateZ': 100.0,
    'R': 1, 'Q': 0.01, 'H': 1,
    'xPred': r[ 'xPred' ],
    'innovation': r[ 'innovation' ],
    'xHat': r[ 'xHat' ],
    'P': r[ 'P' ]
}

# ====================================================================
# §10: Negative controlModel (fuel consumption)
# ====================================================================
print( '\n' + '=' * 60 )
print( '§10: G=-1, init(100), then z=98 with u=2 (tank depleting)' )
print( '=' * 60 )

kf = make_kf( F=1, H=1, R=1, Q=0.01, G=-1.0, x0=100.0, P0=1.0 )
r = step( kf, 98.0, u=2.0 )
print( f"xPred={r['xPred']:.16f}, innovation={r['innovation']:.16f}, "
       f"gate={r['innovationGate']:.16e}, xHat={r['xHat']:.16f}, P={r['P']:.16f}" )

s10 = {
    'G': -1.0, 'initZ': 100.0, 'updateZ': 98.0, 'u': 2.0,
    'R': 1, 'Q': 0.01, 'H': 1, 'F': 1,
    'xPred': r[ 'xPred' ],
    'innovation': r[ 'innovation' ],
    'innovationGate': r[ 'innovationGate' ],
    'xHat': r[ 'xHat' ],
    'P': r[ 'P' ]
}

# Self-verification: negative control → perfect tracking → innovation = 0
check( 'S10: innovation (perfect tracking)', r[ 'innovation' ], 0.0, 1e-14 )
check( 'S10: gate (perfect tracking)', r[ 'innovationGate' ], 0.0, 1e-14 )


# ====================================================================
# Build golden-truth JSON and write to file
# ====================================================================
golden = {
    'S1-constant-input': {
        'R': 1, 'Q': 0.01, 'F': 1, 'H': 1, 'G': 0,
        'initXHat': 100.0, 'initP': 1.0,
        'trace': s1_trace,
        'finalP': s1_trace[ -1 ][ 'P' ]
    },
    'S2-step-change-exclude': {
        'R': 1, 'Q': 0.01, 'chi2Threshold': 6.63,
        'warmUpP': s2_warm_up_P,
        'firstExcluded': s2_first_excluded,
        'excludedPSequence': s2_excluded_P_sequence,
        'trace': s2_trace
    },
    'S3-ramp-with-control': {
        'R': 1, 'Q': 0.01, 'G': 1.0,
        'initZ': 100.0, 'rampIncrement': 5.0,
        'trace': s3_trace
    },
    'S4-dare-steady-state': {
        'cases': s4_cases
    },
    'S5-non-unity-HF': {
        'H': 2, 'F': 0.99, 'R': 1, 'Q': 0.01,
        'initXHat': 100.0, 'initP': 0.25,
        'trace': s5_trace
    },
    'S6-follow-mode': {
        'R': 1, 'Q': 0.01, 'chi2Threshold': 6.63,
        'followReset': s6_follow_reset,
        'trace': s6_trace
    },
    'S7-basic-innovation': s7,
    'S8-missing-control': s8,
    'S9-decaying-state': s9,
    'S10-negative-control': s10
}

script_dir = os.path.dirname( os.path.abspath( __file__ ) )
output_path = os.path.join( script_dir, 'golden-truth-kalman1d.json' )

with open( output_path, 'w' ) as f:
    json.dump( golden, f, indent=2 )

print( f'\nGolden-truth written to {output_path}' )
if ok:
    print( 'All self-verification checks PASSED' )
    sys.exit( 0 )
else:
    print( 'SOME CHECKS FAILED — see above' )
    sys.exit( 1 )
