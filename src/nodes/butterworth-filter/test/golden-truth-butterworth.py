"""
Golden-truth reference values for butterworth-filter node tests.

Generates every numerical value asserted in butterworth-filter.specs.js
using scipy.signal as the ground truth. Run this script to verify that
the JS implementation matches the standard 2nd-order Butterworth filter.

Cross-reference: The JS test file (butterworth-filter.specs.js) references
this script via "see golden-truth-butterworth.py §N" comments on every
closeTo assertion. The section numbers (§1–§6) map to the SECTION headers
below. If a value changes here, the corresponding JS assertion must update.

Reference: scipy.signal.butter — 2nd-order Butterworth via bilinear
transform with frequency pre-warping (Oppenheim & Schafer, Ch. 7).

Usage:
    python3 golden-truth-butterworth.py

Algorithms validated:
    1. Coefficient computation (bilinear transform with pre-warping)
    2. Direct Form II Transposed filter engine
    3. DC steady-state initialization
    4. Frequency response (-3dB point verification)
"""

import sys
import numpy as np
from scipy.signal import butter, freqz


# ====================================================================
# JS Algorithm — exact port of init.js + update.js
# ====================================================================

def js_coefficients( fc, fs, filter_type='lowpass' ):
    """Exact port of init.js:97-124 — bilinear transform with pre-warping."""
    nyquist = fs / 2
    normalized_cutoff = fc / nyquist
    # init.js:99 — pre-warp: K = tan(π·fc/fs)
    wc = ( np.pi * normalized_cutoff ) / 2
    K = np.tan( wc )
    Q = 1 / np.sqrt( 2 )
    K2 = K * K
    norm = 1 / ( K2 + ( K / Q ) + 1 )

    if filter_type == 'lowpass':
        b = np.array( [ K2 * norm, 2 * K2 * norm, K2 * norm ] )
    else:
        b = np.array( [ norm, -2 * norm, norm ] )

    a = np.array( [ 1.0, 2 * ( K2 - 1 ) * norm, ( K2 - ( K / Q ) + 1 ) * norm ] )
    return b, a, normalized_cutoff


def js_df2t( b, a, x_arr, z1=0.0, z2=0.0 ):
    """Exact port of update.js:23-33 — Direct Form II Transposed."""
    b0, b1, b2 = b
    a1, a2 = a[ 1 ], a[ 2 ]
    DENORMAL = 1e-30
    outputs = []

    for x in x_arr:
        out = ( b0 * x ) + z1
        z1 = ( b1 * x ) - ( a1 * out ) + z2
        z2 = ( b2 * x ) - ( a2 * out )
        if abs( z1 ) < DENORMAL:
            z1 = 0.0
        if abs( z2 ) < DENORMAL:
            z2 = 0.0
        outputs.append( out )

    return np.array( outputs ), z1, z2


def js_dc_init( b, a, dc_estimate ):
    """Exact port of init.js:150-161 — DF2T steady-state initialization."""
    b0, b1, b2 = b
    a1, a2 = a[ 1 ], a[ 2 ]
    dc_gain = ( b0 + b1 + b2 ) / ( 1 + a1 + a2 )

    if abs( dc_gain ) > 1e-10:
        steady_output = dc_estimate * dc_gain
        z1 = steady_output - ( b0 * dc_estimate )
        z2 = ( b2 * dc_estimate ) - ( a2 * steady_output )
        return z1, z2, steady_output
    return 0.0, 0.0, 0.0


# ====================================================================
# Validation helpers
# ====================================================================

PASS = 0
FAIL = 0


def check( label, actual, expected, tol=0, comparison='closeTo' ):
    """Verify a single value. Tracks pass/fail counts."""
    global PASS, FAIL

    if comparison == 'closeTo':
        ok = abs( actual - expected ) <= tol
        detail = f'actual={actual:.15g}, expected={expected}, tol={tol}, delta={abs(actual-expected):.2e}'
    elif comparison == 'equal':
        ok = ( actual == expected )
        detail = f'actual={actual}, expected={expected}'
    elif comparison == 'lessThan':
        ok = ( actual < expected )
        detail = f'actual={actual:.10g} < {expected}'
    elif comparison == 'greaterThan':
        ok = ( actual > expected )
        detail = f'actual={actual:.10g} > {expected}'
    elif comparison == 'allclose':
        ok = np.allclose( actual, expected, rtol=tol )
        detail = f'rtol={tol}'
    else:
        raise ValueError( f'Unknown comparison: {comparison}' )

    status = 'PASS' if ok else 'FAIL'
    if ok:
        PASS += 1
    else:
        FAIL += 1
    print( f'  {status}: {label}  ({detail})' )
    return ok


# ====================================================================
# Canonical test configuration: fc=10Hz, fs=100Hz, lowpass
# ====================================================================

FC, FS = 10, 100
b_lp, a_lp, nc = js_coefficients( FC, FS, 'lowpass' )
b_hp, a_hp, _  = js_coefficients( FC, FS, 'highpass' )
b_sp, a_sp     = butter( 2, FC, btype='low', fs=FS )
b_sp_hp, a_sp_hp = butter( 2, FC, btype='high', fs=FS )


# ====================================================================
print( '=' * 70 )
print( 'SECTION 1: Coefficient alignment — JS implementation vs scipy' )
print( '=' * 70 )
# ====================================================================

print( '\n  Lowpass fc=10Hz, fs=100Hz:' )
check( 'b coefficients match scipy', b_lp, b_sp, tol=1e-12, comparison='allclose' )
check( 'a coefficients match scipy', a_lp, a_sp, tol=1e-12, comparison='allclose' )

print( '\n  Highpass fc=10Hz, fs=100Hz:' )
check( 'b coefficients match scipy', b_hp, b_sp_hp, tol=1e-12, comparison='allclose' )
check( 'a coefficients match scipy', a_hp, a_sp_hp, tol=1e-12, comparison='allclose' )

# Cross-configuration check
print( '\n  Multi-configuration coefficient match:' )
configs = [
    ( 1, 1000, 'low' ),   ( 50, 1000, 'low' ),  ( 100, 5000, 'high' ),
    ( 1000, 44100, 'low' ), ( 5, 100, 'low' ),   ( 100, 48000, 'low' ),
]
for fc_t, fs_t, bt in configs:
    ft = bt + 'pass'
    b_j, a_j, _ = js_coefficients( fc_t, fs_t, ft )
    b_s, a_s = butter( 2, fc_t, btype=bt, fs=fs_t )
    ok_b = np.allclose( b_j, b_s, rtol=1e-12 )
    ok_a = np.allclose( a_j, a_s, rtol=1e-12 )
    check( f'{ft} fc={fc_t} fs={fs_t}', ok_b and ok_a, True, comparison='equal' )


# ====================================================================
print( '\n' + '=' * 70 )
print( 'SECTION 2: -3dB frequency verification' )
print( '=' * 70 )
# ====================================================================

w, h = freqz( b_lp, a_lp, worN=8192, fs=FS )
mag = np.abs( h )
target = 1 / np.sqrt( 2 )
idx_3dB = np.argmin( np.abs( mag - target ) )
actual_3dB_hz = w[ idx_3dB ]

print()
check( 'lowpass -3dB at requested fc=10Hz', actual_3dB_hz, FC, tol=0.1, comparison='closeTo' )

w_hp, h_hp = freqz( b_hp, a_hp, worN=8192, fs=FS )
mag_hp = np.abs( h_hp )
idx_3dB_hp = np.argmin( np.abs( mag_hp - target ) )
actual_3dB_hp = w_hp[ idx_3dB_hp ]
check( 'highpass -3dB at requested fc=10Hz', actual_3dB_hp, FC, tol=0.1, comparison='closeTo' )


# ====================================================================
print( '\n' + '=' * 70 )
print( 'SECTION 3: DC gain and DC initialization' )
print( '=' * 70 )
# ====================================================================

dc_gain_lp = ( b_lp[ 0 ] + b_lp[ 1 ] + b_lp[ 2 ] ) / ( 1 + a_lp[ 1 ] + a_lp[ 2 ] )
dc_gain_hp = ( b_hp[ 0 ] + b_hp[ 1 ] + b_hp[ 2 ] ) / ( 1 + a_hp[ 1 ] + a_hp[ 2 ] )

print()
check( 'lowpass DC gain = 1.0', dc_gain_lp, 1.0, tol=1e-12, comparison='closeTo' )
check( 'highpass DC gain = 0.0', dc_gain_hp, 0.0, tol=1e-12, comparison='closeTo' )

# DC init steady-state test (test line 113-121)
DC_EST = 50.0
z1_dc, z2_dc, out_dc = js_dc_init( b_lp, a_lp, DC_EST )
y_dc, _, _ = js_df2t( b_lp, a_lp, np.ones( 10 ) * DC_EST, z1_dc, z2_dc )
max_dev = np.max( np.abs( y_dc - DC_EST ) )

check( 'DC init output = dcEstimate', out_dc, DC_EST, tol=1e-10, comparison='closeTo' )
check( 'DC init z1 non-zero', z1_dc != 0, True, comparison='equal' )
check( 'DC init z2 non-zero', z2_dc != 0, True, comparison='equal' )
check( 'DC init holds steady state (10 samples)', max_dev, 0.001, comparison='lessThan' )


# ====================================================================
print( '\n' + '=' * 70 )
print( 'SECTION 4: Test assertion golden-truth values' )
print( '=' * 70 )
print( '\n  --- Coefficients (test line 91-93) ---' )
# ====================================================================

check( 'b0 closeTo(0.0675, 0.0001)', b_lp[ 0 ], 0.0675, tol=0.0001 )
check( 'a1 closeTo(-1.1430, 0.0001)', a_lp[ 1 ], -1.1430, tol=0.0001 )
check( 'a2 closeTo(0.4128, 0.0001)', a_lp[ 2 ], 0.4128, tol=0.0001 )
check( 'b0 == b2 (lowpass symmetry)', b_lp[ 0 ], b_lp[ 2 ], tol=0, comparison='equal' )
check( 'b1 == 2*b0', b_lp[ 1 ], 2 * b_lp[ 0 ], tol=0, comparison='equal' )

# --- Settling time → cutoff (test line 60) ---
print( '\n  --- Settling time → cutoff (test line 60) ---' )
fc_from_settling = 4 / ( 2 * np.pi * 0.1 )
check( 'settlingTimeMs=100 → cutoffHz', fc_from_settling, 6.366, tol=0.01 )

# --- Cascade adjustment (test line 127-128) ---
print( '\n  --- Cascade adjustment (test line 127-128) ---' )
cascade_adj = 2 ** ( 1 / 2 - 1 )
cascade_cutoff = 10 / cascade_adj
check( 'cascadeAdjustment closeTo(0.7071, 0.001)', cascade_adj, 0.7071, tol=0.001 )
check( 'adjusted cutoff closeTo(14.142, 0.01)', cascade_cutoff, 14.142, tol=0.01 )

# --- Performance metrics (test line 135-138) ---
print( '\n  --- Performance metrics (test line 135-138) ---' )
nc_val = FC / ( FS / 2 )
gd = round( 0.5 / ( np.pi * nc_val ) )
st = round( 4 / ( 2 * np.pi * nc_val ) )
check( 'groupDelaySamples = 1', gd, 1, comparison='equal' )
check( 'settlingTimeSamples = 3', st, 3, comparison='equal' )


# ====================================================================
print( '\n' + '=' * 70 )
print( 'SECTION 5: Behavioral test golden-truth values' )
print( '=' * 70 )
# ====================================================================

# --- Step response: lowpass, x=1, 20 samples (test line 302) ---
print( '\n  --- Step response lowpass (test line 302) ---' )
y_step, _, _ = js_df2t( b_lp, a_lp, np.ones( 20 ) )
check( 'step(1)×20 closeTo(1, 0.1)', y_step[ -1 ], 1, tol=0.1 )

# --- Noisy signal: DC=10 ± alternating (test line 317) ---
print( '\n  --- Noisy signal (test line 317) ---' )
x_noisy = np.array( [ 10 + ( ( ( i % 2 ) * 2 ) - 1 ) for i in range( 50 ) ] )
y_noisy, _, _ = js_df2t( b_lp, a_lp, x_noisy )
avg_last10 = np.mean( y_noisy[ -10: ] )
check( 'noisy DC=10 avg last 10 closeTo(10, 1)', avg_last10, 10, tol=1 )

# --- 25Hz attenuation lowpass (test line 333) ---
print( '\n  --- 25Hz attenuation lowpass (test line 333) ---' )
x_hf = np.sin( 2 * np.pi * 25 * np.arange( 100 ) / 100 )
y_hf_lp, _, _ = js_df2t( b_lp, a_lp, x_hf )
max_amp_lp = np.max( np.abs( y_hf_lp[ -40: ] ) )
check( '25Hz lowpass max_amp < 0.5', max_amp_lp, 0.5, comparison='lessThan' )

# --- Highpass DC blocking (test line 351) ---
print( '\n  --- Highpass DC blocking (test line 351) ---' )
y_dc_hp, _, _ = js_df2t( b_hp, a_hp, np.ones( 50 ) * 10 )
check( 'highpass DC block |output| < 0.5', abs( y_dc_hp[ -1 ] ), 0.5, comparison='lessThan' )

# --- Highpass 25Hz pass (test line 367) ---
print( '\n  --- Highpass 25Hz pass (test line 367) ---' )
y_hf_hp, _, _ = js_df2t( b_hp, a_hp, x_hf )
max_amp_hp = np.max( np.abs( y_hf_hp[ -40: ] ) )
check( '25Hz highpass max_amp > 0.5', max_amp_hp, 0.5, comparison='greaterThan' )

# --- Negative step (test line 863) ---
print( '\n  --- Negative step (test line 863) ---' )
y_neg, _, _ = js_df2t( b_lp, a_lp, np.ones( 50 ) * -100 )
check( 'neg step closeTo(-100, 5)', y_neg[ -1 ], -100, tol=5 )

# --- Warm-up step 50×30 (test line 918) ---
print( '\n  --- Warm-up step (test line 918) ---' )
y_warm, _, _ = js_df2t( b_lp, a_lp, np.ones( 30 ) * 50 )
check( 'step(50)×30 closeTo(50, 1)', y_warm[ -1 ], 50, tol=1 )

# --- Full lifecycle: reset → step -25×30 (test line 923) ---
print( '\n  --- Full lifecycle (test line 923) ---' )
y_neg25, _, _ = js_df2t( b_lp, a_lp, np.ones( 30 ) * -25 )
check( 'lifecycle step(-25)×30 closeTo(-25, 1)', y_neg25[ -1 ], -25, tol=1 )


# ====================================================================
print( '\n' + '=' * 70 )
print( 'SECTION 6: Exact reference values for test assertions' )
print( '=' * 70 )
# ====================================================================

print( f"""
  Lowpass coefficients (fc=10, fs=100):
    b0 = {b_lp[0]:.15e}
    b1 = {b_lp[1]:.15e}
    b2 = {b_lp[2]:.15e}
    a1 = {a_lp[1]:.15e}
    a2 = {a_lp[2]:.15e}

  Highpass coefficients (fc=10, fs=100):
    b0 = {b_hp[0]:.15e}
    b1 = {b_hp[1]:.15e}
    b2 = {b_hp[2]:.15e}
    a1 = {a_hp[1]:.15e}
    a2 = {a_hp[2]:.15e}

  DC initialization (dcEstimate=50, lowpass fc=10, fs=100):
    dcGain = {dc_gain_lp:.15e}
    z1     = {z1_dc:.15e}
    z2     = {z2_dc:.15e}
    output = {out_dc:.15e}

  Step response first 5 outputs (lowpass, x=1):
    y[0] = {y_step[0]:.15e}
    y[1] = {y_step[1]:.15e}
    y[2] = {y_step[2]:.15e}
    y[3] = {y_step[3]:.15e}
    y[4] = {y_step[4]:.15e}

  Steady-state amplitudes:
    25Hz through lowpass:  max_amp = {max_amp_lp:.15e}
    25Hz through highpass: max_amp = {max_amp_hp:.15e}

  Settling time from ms:
    settlingTimeMs=100 → cutoffHz = {fc_from_settling:.15e}

  Cascade adjustment:
    cascadeAdjustment = {cascade_adj:.15e}
    adjustedCutoff    = {cascade_cutoff:.15e}
""" )


# ====================================================================
print( '=' * 70 )
print( 'SUMMARY' )
print( '=' * 70 )
# ====================================================================

total = PASS + FAIL
print( f'\n  {PASS}/{total} checks passed, {FAIL} failed.\n' )

if FAIL > 0:
    print( '  GOLDEN-TRUTH VALIDATION FAILED — JS implementation diverges from scipy.' )
    sys.exit( 1 )
else:
    print( '  All golden-truth values verified. JS implementation matches scipy.' )
    sys.exit( 0 )
