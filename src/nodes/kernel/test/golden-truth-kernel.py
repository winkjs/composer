"""
Golden-truth reference values for kernel node tests.

Generates every numerical value asserted in kernel.specs.js using
numpy.convolve as the ground truth. The kernel node implements discrete
FIR (finite impulse response) filtering via convolution over a sliding
window with a user-specified or preset kernel.

Cross-reference: The JS test file (kernel.specs.js) references this
script via "see golden-truth-kernel.py S<N>" comments on closeTo
assertions. The section labels (S1-S7) map to the SECTION headers
below. If a value changes here, the corresponding JS assertion must
update.

Library: numpy 2.2.1 — numpy.convolve implements discrete linear
convolution. For FIR filtering, output[n] = sum_k(kernel[k] * x[n-k]),
which is standard convolution with kernel flip.

Convention mapping (JS node -> numpy):
    The JS node defines kernels in "newest-to-oldest" order:
        kernel[0] = weight for x[n] (newest)
        kernel[1] = weight for x[n-1]
        ...
    The JS init.js reverses the kernel, then update.js iterates from
    oldest to newest. This is equivalent to standard convolution.

    numpy.convolve(x, kernel, mode='full') applies:
        y[n] = sum_k( kernel[k] * x[n-k] )
    where kernel[0] multiplies x[n], kernel[1] multiplies x[n-1], etc.
    This matches the JS newest-first convention directly.

    Therefore: numpy.convolve(input_signal, kernel) with 'valid' mode
    (or slicing 'full' to skip warmup) gives the same outputs as the JS
    node after the ring buffer fills.

Algorithm reference:
    Oppenheim & Schafer, "Discrete-Time Signal Processing", Ch. 2.3
    (Convolution Sum).

Usage:
    python3 golden-truth-kernel.py

Outputs:
    golden-truth-kernel.json
"""

import sys
import json
import numpy as np


results = {}

# ====================================================================
# SECTION S1 — Basic custom kernel convolution
# ====================================================================
# Kernel: [0.25, 0.5, 0.25], Input: [10, 20, 30]
# This is the "computes result after buffer is full" test
kernel_s1 = np.array( [0.25, 0.5, 0.25] )
input_s1 = np.array( [10.0, 20.0, 30.0] )

# numpy.convolve with 'valid' mode outputs values where the full kernel
# overlaps the input — equivalent to after warmup
conv_s1 = np.convolve( input_s1, kernel_s1, mode='valid' )

# Self-check: for a symmetric unit-sum kernel on arithmetic sequence,
# result should be the middle value
assert abs( conv_s1[0] - 20.0 ) < 1e-12, f"S1 expected 20.0, got {conv_s1[0]}"

results["S1-basic-custom"] = {
    "kernel": kernel_s1.tolist(),
    "input": input_s1.tolist(),
    "output": conv_s1.tolist()
}


# ====================================================================
# SECTION S2 — Simple average (1/3, 1/3, 1/3)
# ====================================================================
kernel_s2 = np.array( [1/3, 1/3, 1/3] )
input_s2 = np.array( [10.0, 20.0, 30.0] )
conv_s2 = np.convolve( input_s2, kernel_s2, mode='valid' )

# Mean of [10,20,30] = 20
assert abs( conv_s2[0] - 20.0 ) < 1e-12, f"S2 expected 20.0, got {conv_s2[0]}"

results["S2-simple-average"] = {
    "kernel": kernel_s2.tolist(),
    "input": input_s2.tolist(),
    "output": conv_s2.tolist()
}


# ====================================================================
# SECTION S3 — Weighted kernel [0.1, 0.2, 0.3, 0.4]
# ====================================================================
kernel_s3 = np.array( [0.1, 0.2, 0.3, 0.4] )
input_s3 = np.array( [1.0, 2.0, 3.0, 4.0] )
conv_s3 = np.convolve( input_s3, kernel_s3, mode='valid' )

# Manual: 0.1*1 + 0.2*2 + 0.3*3 + 0.4*4 = 0.1+0.4+0.9+1.6 = 3.0
# Wait — numpy convention: kernel[0]*x[n], kernel[1]*x[n-1], etc.
# For input [1,2,3,4] and valid mode output at n=3:
# 0.1*4 + 0.2*3 + 0.3*2 + 0.4*1 = 0.4+0.6+0.6+0.4 = 2.0
assert abs( conv_s3[0] - 2.0 ) < 1e-12, f"S3 expected 2.0, got {conv_s3[0]}"

results["S3-weighted"] = {
    "kernel": kernel_s3.tolist(),
    "input": input_s3.tolist(),
    "output": conv_s3.tolist()
}


# ====================================================================
# SECTION S4 — Sliding window with sum kernel [1, 1, 1]
# ====================================================================
kernel_s4 = np.array( [1.0, 1.0, 1.0] )
input_s4 = np.array( [1.0, 2.0, 3.0, 4.0, 5.0] )
conv_s4 = np.convolve( input_s4, kernel_s4, mode='valid' )

# Expected: [6, 9, 12]  (1+2+3, 2+3+4, 3+4+5)
assert abs( conv_s4[0] - 6.0 ) < 1e-12, f"S4[0] expected 6.0, got {conv_s4[0]}"
assert abs( conv_s4[1] - 9.0 ) < 1e-12, f"S4[1] expected 9.0, got {conv_s4[1]}"
assert abs( conv_s4[2] - 12.0 ) < 1e-12, f"S4[2] expected 12.0, got {conv_s4[2]}"

results["S4-sliding-sum"] = {
    "kernel": kernel_s4.tolist(),
    "input": input_s4.tolist(),
    "output": conv_s4.tolist()
}


# ====================================================================
# SECTION S5 — Preset: smooth3 = [0.25, 0.5, 0.25]
# ====================================================================
kernel_s5 = np.array( [0.25, 0.5, 0.25] )
input_s5 = np.array( [10.0, 20.0, 10.0] )
conv_s5 = np.convolve( input_s5, kernel_s5, mode='valid' )

# 0.25*10 + 0.5*20 + 0.25*10 = 2.5 + 10 + 2.5 = 15
assert abs( conv_s5[0] - 15.0 ) < 1e-12, f"S5 expected 15.0, got {conv_s5[0]}"

results["S5-smooth3"] = {
    "kernel": kernel_s5.tolist(),
    "input": input_s5.tolist(),
    "output": conv_s5.tolist()
}


# ====================================================================
# SECTION S6 — Preset: rate = [-1, 1]
# ====================================================================
kernel_s6 = np.array( [-1.0, 1.0] )
input_s6 = np.array( [10.0, 15.0] )
conv_s6 = np.convolve( input_s6, kernel_s6, mode='valid' )

# numpy: kernel[0]*x[1] + kernel[1]*x[0] = (-1)*15 + 1*10 = -5
assert abs( conv_s6[0] - (-5.0) ) < 1e-12, f"S6 expected -5.0, got {conv_s6[0]}"

results["S6-rate"] = {
    "kernel": kernel_s6.tolist(),
    "input": input_s6.tolist(),
    "output": conv_s6.tolist()
}


# ====================================================================
# SECTION S7 — Preset: accel = [1, -2, 1]
# ====================================================================
kernel_s7a = np.array( [1.0, -2.0, 1.0] )

# S7a: Constant velocity [0, 10, 20] — should give 0
input_s7a = np.array( [0.0, 10.0, 20.0] )
conv_s7a = np.convolve( input_s7a, kernel_s7a, mode='valid' )
assert abs( conv_s7a[0] ) < 1e-12, f"S7a expected 0, got {conv_s7a[0]}"

# S7b: Accelerating [0, 1, 4] — should detect acceleration
input_s7b = np.array( [0.0, 1.0, 4.0] )
conv_s7b = np.convolve( input_s7b, kernel_s7a, mode='valid' )
# 1*4 + (-2)*1 + 1*0 = 4-2+0 = 2
assert abs( conv_s7b[0] - 2.0 ) < 1e-12, f"S7b expected 2.0, got {conv_s7b[0]}"

results["S7-accel"] = {
    "constant_velocity": {
        "input": input_s7a.tolist(),
        "output": conv_s7a.tolist()
    },
    "accelerating": {
        "input": input_s7b.tolist(),
        "output": conv_s7b.tolist()
    }
}


# ====================================================================
# SECTION S8 — Preset: spike3 = [-1, 2, -1]
# ====================================================================
kernel_s8 = np.array( [-1.0, 2.0, -1.0] )

# Flat signal [10, 10, 10] — no spike
input_s8a = np.array( [10.0, 10.0, 10.0] )
conv_s8a = np.convolve( input_s8a, kernel_s8, mode='valid' )
assert abs( conv_s8a[0] ) < 1e-12, f"S8a expected 0, got {conv_s8a[0]}"

# Spike: [10, 10, 100] — with spike
input_s8b = np.array( [10.0, 10.0, 100.0] )
conv_s8b = np.convolve( input_s8b, kernel_s8, mode='valid' )
# (-1)*100 + 2*10 + (-1)*10 = -100+20-10 = -90
assert abs( conv_s8b[0] - (-90.0) ) < 1e-12, f"S8b expected -90, got {conv_s8b[0]}"

results["S8-spike3"] = {
    "flat": {
        "input": input_s8a.tolist(),
        "output": conv_s8a.tolist()
    },
    "spike": {
        "input": input_s8b.tolist(),
        "output": conv_s8b.tolist()
    }
}


# ====================================================================
# SECTION S9 — Constant input preservation
# ====================================================================
kernel_s9 = np.array( [0.25, 0.5, 0.25] )
input_s9 = np.array( [100.0, 100.0, 100.0] )
conv_s9 = np.convolve( input_s9, kernel_s9, mode='valid' )

# Unit-sum kernel on constant input should return the constant
assert abs( conv_s9[0] - 100.0 ) < 1e-12, f"S9 expected 100.0, got {conv_s9[0]}"

results["S9-constant-input"] = {
    "kernel": kernel_s9.tolist(),
    "input": input_s9.tolist(),
    "output": conv_s9.tolist()
}


# ====================================================================
# SECTION S10 — Savitzky-Golay presets validation
# ====================================================================
# sg5 coefficients (2nd order, 5 points)
sg5_kernel = np.array( [-3/35, 12/35, 17/35, 12/35, -3/35] )

# Self-check: sg5 should sum to 1 (smoothing preserves DC)
assert abs( np.sum( sg5_kernel ) - 1.0 ) < 1e-12, \
    f"S10: sg5 sum should be 1.0, got {np.sum(sg5_kernel)}"

# sg7 coefficients (2nd order, 7 points)
sg7_kernel = np.array( [-2/21, 3/21, 6/21, 7/21, 6/21, 3/21, -2/21] )
assert abs( np.sum( sg7_kernel ) - 1.0 ) < 1e-12, \
    f"S10: sg7 sum should be 1.0, got {np.sum(sg7_kernel)}"

# binomial5 should sum to 1
bin5_kernel = np.array( [1/16, 4/16, 6/16, 4/16, 1/16] )
assert abs( np.sum( bin5_kernel ) - 1.0 ) < 1e-12, \
    f"S10: binomial5 sum should be 1.0, got {np.sum(bin5_kernel)}"

# binomial7 should sum to 1
bin7_kernel = np.array( [1/64, 6/64, 15/64, 20/64, 15/64, 6/64, 1/64] )
assert abs( np.sum( bin7_kernel ) - 1.0 ) < 1e-12, \
    f"S10: binomial7 sum should be 1.0, got {np.sum(bin7_kernel)}"

# Derivative presets should sum to 0 (zero DC response)
rate_kernel = np.array( [-1.0, 1.0] )
rate3_kernel = np.array( [-1.0, 0.0, 1.0] )
accel_kernel = np.array( [1.0, -2.0, 1.0] )
jerk_kernel = np.array( [-1.0, 3.0, -3.0, 1.0] )
sgRate5_kernel = np.array( [-2/10, -1/10, 0.0, 1/10, 2/10] )

for name, k in [("rate", rate_kernel), ("rate3", rate3_kernel),
                ("accel", accel_kernel), ("jerk", jerk_kernel),
                ("sgRate5", sgRate5_kernel)]:
    assert abs( np.sum(k) ) < 1e-12, \
        f"S10: {name} should sum to 0, got {np.sum(k)}"

# Test sg5 on a quadratic signal (should preserve it perfectly)
# SG 2nd-order filter fits a 2nd-order polynomial exactly
quadratic = np.array( [x**2 for x in range(5)] , dtype=float)  # [0,1,4,9,16]
conv_sg5_quad = np.convolve( quadratic, sg5_kernel, mode='valid' )
# At the center point (x=2), the quadratic value is 4
assert abs( conv_sg5_quad[0] - 4.0 ) < 1e-10, \
    f"S10: sg5 on quadratic should give 4.0 at center, got {conv_sg5_quad[0]}"

results["S10-preset-validation"] = {
    "sg5_sum": float( np.sum(sg5_kernel) ),
    "sg7_sum": float( np.sum(sg7_kernel) ),
    "binomial5_sum": float( np.sum(bin5_kernel) ),
    "binomial7_sum": float( np.sum(bin7_kernel) ),
    "rate_sum": float( np.sum(rate_kernel) ),
    "rate3_sum": float( np.sum(rate3_kernel) ),
    "accel_sum": float( np.sum(accel_kernel) ),
    "jerk_sum": float( np.sum(jerk_kernel) ),
    "sgRate5_sum": float( np.sum(sgRate5_kernel) ),
    "sg5_quadratic_center": float( conv_sg5_quad[0] ),
    "sg5_kernel": sg5_kernel.tolist(),
    "sg7_kernel": sg7_kernel.tolist()
}


# ====================================================================
# SECTION S11 — Edge cases: zeros, negatives, small values, sum kernel
# ====================================================================
kernel_s11_sum = np.array( [1.0, 1.0, 1.0] )

# Zeros
input_zeros = np.array( [0.0, 0.0, 0.0] )
conv_zeros = np.convolve( input_zeros, np.array([0.25, 0.5, 0.25]), mode='valid' )
assert abs( conv_zeros[0] ) < 1e-15, f"S11: zeros expected 0, got {conv_zeros[0]}"

# Negatives
input_neg = np.array( [-10.0, -20.0, -30.0] )
conv_neg = np.convolve( input_neg, kernel_s11_sum, mode='valid' )
assert abs( conv_neg[0] - (-60.0) ) < 1e-12, f"S11: negatives expected -60, got {conv_neg[0]}"

# Mixed
input_mix = np.array( [10.0, -10.0, 10.0] )
conv_mix = np.convolve( input_mix, kernel_s11_sum, mode='valid' )
assert abs( conv_mix[0] - 10.0 ) < 1e-12, f"S11: mixed expected 10, got {conv_mix[0]}"

# Very small values
kernel_s11_2 = np.array( [1.0, 1.0] )
input_small = np.array( [1e-10, 1e-10] )
conv_small = np.convolve( input_small, kernel_s11_2, mode='valid' )
assert abs( conv_small[0] - 2e-10 ) < 1e-15, f"S11: small expected 2e-10, got {conv_small[0]}"

results["S11-edge-cases"] = {
    "zeros": float( conv_zeros[0] ),
    "negatives": float( conv_neg[0] ),
    "mixed": float( conv_mix[0] ),
    "small_values": float( conv_small[0] )
}


# ====================================================================
# SECTION S12 — Multi-step sliding window (full sequence)
# ====================================================================
# Test a longer sequence and provide all valid-mode outputs
kernel_s12 = np.array( [0.25, 0.5, 0.25] )
input_s12 = np.array( [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0] )
conv_s12 = np.convolve( input_s12, kernel_s12, mode='valid' )

# Self-check: for arithmetic progression with unit-sum symmetric kernel,
# each output should equal the center value
for i, val in enumerate( conv_s12 ):
    expected = (i + 1) * 10.0 + 10.0  # center value: 20, 30, 40, ...
    assert abs( val - expected ) < 1e-10, \
        f"S12[{i}]: expected {expected}, got {val}"

results["S12-multi-step"] = {
    "kernel": kernel_s12.tolist(),
    "input": input_s12.tolist(),
    "output": conv_s12.tolist()
}


# ====================================================================
# Self-verification summary
# ====================================================================
# Mathematical invariants verified:
# 1. Unit-sum kernels preserve constant signals (S9)
# 2. Derivative kernels have zero DC response (S10)
# 3. SG filters preserve polynomials of their order (S10)
# 4. Symmetric unit-sum kernel on arithmetic sequence = center value (S1, S12)
# 5. Sum kernel produces actual sum (S4, S11)

print( "All self-verification checks passed." )

# Write JSON
with open( 'golden-truth-kernel.json', 'w' ) as f:
    json.dump( results, f, indent=2 )

print( f"Wrote golden-truth-kernel.json with {len(results)} sections." )
sys.exit( 0 )
