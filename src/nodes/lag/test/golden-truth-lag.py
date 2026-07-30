#!/usr/bin/env python3
"""
Golden-truth generator for the lag node.

Uses numpy and pandas to compute reference values for all six lag statistics:
delta, ratio, roc, slope, logReturn, cumDelta.

Library: numpy 1.24+, pandas 2.0+
Algorithm reference: Standard time-series lag operations.
  - delta: pandas.Series.diff(lag)
  - ratio: x / x.shift(lag)
  - roc: pandas.Series.pct_change(lag)
  - slope: (x - x.shift(lag)) / (t - t.shift(lag))
  - logReturn: numpy.log(x / x.shift(lag))
  - cumDelta: cumulative sum of delta

Cross-reference convention with JS test file:
  Each section key in the JSON output (e.g., "S1-exponential-growth") corresponds
  to a test scenario in lag.specs.js. JS tests load golden-truth-lag.json and
  assert against these values.

Self-verification: checks mathematical identities (telescoping sum, log-return
additivity, ratio * roc relationship) and exits with code 1 on failure.
"""

import json
import sys
import numpy as np
import pandas as pd

results = {}

# ============================================================================
# S1: Exponential growth series (lag=1)
# Series: 100, 110, 121, 133.1, 146.41 (10% growth each step)
# ============================================================================

values_s1 = pd.Series([100.0, 110.0, 121.0, 133.1, 146.41])
times_s1 = pd.Series([0.0, 1.0, 2.0, 3.0, 4.0])

delta_s1 = values_s1.diff(1)
ratio_s1 = values_s1 / values_s1.shift(1)
roc_s1 = values_s1.pct_change(1)
slope_s1 = (values_s1 - values_s1.shift(1)) / (times_s1 - times_s1.shift(1))
log_return_s1 = np.log(values_s1 / values_s1.shift(1))

results["S1-exponential-growth"] = {
    "values": values_s1.tolist(),
    "times": times_s1.tolist(),
    "delta": [None if np.isnan(v) else v for v in delta_s1],
    "ratio": [None if np.isnan(v) else v for v in ratio_s1],
    "roc": [None if np.isnan(v) else v for v in roc_s1],
    "slope": [None if np.isnan(v) else v for v in slope_s1],
    "logReturn": [None if np.isnan(v) else v for v in log_return_s1],
}

# ============================================================================
# S2: Linear decrease series (lag=1)
# Series: 100, 90, 80, 70, 60
# ============================================================================

values_s2 = pd.Series([100.0, 90.0, 80.0, 70.0, 60.0])

delta_s2 = values_s2.diff(1)
ratio_s2 = values_s2 / values_s2.shift(1)
roc_s2 = values_s2.pct_change(1)
log_return_s2 = np.log(values_s2 / values_s2.shift(1))

results["S2-linear-decrease"] = {
    "values": values_s2.tolist(),
    "delta": [None if np.isnan(v) else v for v in delta_s2],
    "ratio": [None if np.isnan(v) else v for v in ratio_s2],
    "roc": [None if np.isnan(v) else v for v in roc_s2],
    "logReturn": [None if np.isnan(v) else v for v in log_return_s2],
}

# ============================================================================
# S3: Lag=3 series
# Series: 10, 20, 30, 40, 50, 60
# ============================================================================

values_s3 = pd.Series([10.0, 20.0, 30.0, 40.0, 50.0, 60.0])
times_s3 = pd.Series([0.0, 1.0, 2.0, 3.0, 4.0, 5.0])

delta_s3 = values_s3.diff(3)
ratio_s3 = values_s3 / values_s3.shift(3)
roc_s3 = values_s3.pct_change(3)
slope_s3 = (values_s3 - values_s3.shift(3)) / (times_s3 - times_s3.shift(3))
log_return_s3 = np.log(values_s3 / values_s3.shift(3))

results["S3-lag3"] = {
    "values": values_s3.tolist(),
    "times": times_s3.tolist(),
    "lag": 3,
    "delta": [None if np.isnan(v) else v for v in delta_s3],
    "ratio": [None if np.isnan(v) else v for v in ratio_s3],
    "roc": [None if np.isnan(v) else v for v in roc_s3],
    "slope": [None if np.isnan(v) else v for v in slope_s3],
    "logReturn": [None if np.isnan(v) else v for v in log_return_s3],
}

# ============================================================================
# S4: CumDelta (telescoping sum property) — lag=1
# Series: 100, 110, 105, 120, 115, 130
# cumDelta should equal x[now] - x[first_lagged]
# ============================================================================

values_s4 = pd.Series([100.0, 110.0, 105.0, 120.0, 115.0, 130.0])

delta_s4 = values_s4.diff(1)
cum_delta_s4 = delta_s4.cumsum()
# The cumDelta starts accumulating only after the buffer fills (i.e., from index 1)
# At each step: cumDelta = sum of deltas from index 1 onward

results["S4-cumDelta"] = {
    "values": values_s4.tolist(),
    "delta": [None if np.isnan(v) else v for v in delta_s4],
    "cumDelta": [None if np.isnan(v) else v for v in cum_delta_s4],
    # Telescoping property: cumDelta[i] = x[i] - x[1] (first value after buffer fills)
    "telescopingCheck": values_s4.iloc[-1] - values_s4.iloc[0],
}

# ============================================================================
# S5: CumDelta with lag=3
# Series: 10, 20, 30, 40, 50, 60
# lag-3 pairs: (40,10)=30, (50,20)=30, (60,30)=30
# cumDelta: 30, 60, 90
# ============================================================================

values_s5 = pd.Series([10.0, 20.0, 30.0, 40.0, 50.0, 60.0])

delta_s5 = values_s5.diff(3)
# cumDelta accumulates only from the first non-NaN delta (index 3)
cum_delta_s5_valid = delta_s5.dropna().cumsum()

results["S5-cumDelta-lag3"] = {
    "values": values_s5.tolist(),
    "lag": 3,
    "delta": [None if np.isnan(v) else v for v in delta_s5],
    "cumDeltaAfterFill": cum_delta_s5_valid.tolist(),
}

# ============================================================================
# S6: Absolute mode — delta and slope with absolute
# ============================================================================

values_s6_delta = pd.Series([20.0, 12.0])
delta_s6 = values_s6_delta.diff(1)
abs_delta_s6 = delta_s6.abs()

values_s6_slope_x = pd.Series([50.0, 30.0])
times_s6_slope = pd.Series([0.0, 4.0])
slope_s6 = (values_s6_slope_x - values_s6_slope_x.shift(1)) / (times_s6_slope - times_s6_slope.shift(1))
abs_slope_s6 = slope_s6.abs()

results["S6-absolute-mode"] = {
    "absDelta": abs_delta_s6.iloc[-1],
    "rawDelta": delta_s6.iloc[-1],
    "absSlope": abs_slope_s6.iloc[-1],
    "rawSlope": slope_s6.iloc[-1],
}

# ============================================================================
# S7: Division-by-zero edge cases
# ============================================================================

# ratio when x_lag = 0: should be NaN (or inf)
ratio_div_zero = 10.0 / 0.0 if False else float('nan')  # Python would raise, use NaN

# roc when x_lag = 0: (10-0)/0 = NaN
roc_div_zero = float('nan')

# logReturn when x=0: ln(0/100) is undefined
log_return_x_zero = float('nan')

# logReturn when x_lag=0: ln(100/0) is undefined
log_return_xlag_zero = float('nan')

# logReturn when x<0: ln(-50/100) is undefined (log of negative)
log_return_x_neg = float('nan')

# slope when t-t_lag = 0
slope_t_zero = float('nan')

results["S7-division-edge-cases"] = {
    "ratio_xlag_zero": None,  # NaN
    "roc_xlag_zero": None,    # NaN
    "logReturn_x_zero": None,
    "logReturn_xlag_zero": None,
    "logReturn_x_negative": None,
    "logReturn_xlag_negative": None,
    "slope_t_zero": None,
}

# ============================================================================
# S8: Basic computations for cross-validation
# Simple pairs for exact validation
# ============================================================================

results["S8-basic-pairs"] = {
    # delta: 15 - 10 = 5
    "delta_10_15": 15.0 - 10.0,
    # delta: 150 - 100 = 50
    "delta_100_150": 150.0 - 100.0,
    # ratio: 150 / 100 = 1.5
    "ratio_100_150": 150.0 / 100.0,
    # roc: (110-100)/100 = 0.1
    "roc_100_110": (110.0 - 100.0) / 100.0,
    # slope: (30-10)/(2-0) = 10
    "slope_10_30_t0_t2": (30.0 - 10.0) / (2.0 - 0.0),
    # logReturn: ln(110/100)
    "logReturn_100_110": float(np.log(110.0 / 100.0)),
    # logReturn: ln(100/110) = -ln(110/100) (symmetry)
    "logReturn_110_100": float(np.log(100.0 / 110.0)),
    # zero crossing: roc = (5 - (-5)) / (-5) = -2
    "roc_neg5_pos5": (5.0 - (-5.0)) / (-5.0),
}

# ============================================================================
# Self-verification
# ============================================================================

errors = []

# 1. Telescoping sum: cumDelta of (x - x_lag) = x[last] - x[first]
#    For lag=1: sum of diff(1) from index 1 to end = x[end] - x[1]
#    But in the node, cumDelta starts from first valid delta = x[1]-x[0]
#    So cumDelta[end] = x[end] - x[0]
telescoping_expected = values_s4.iloc[-1] - values_s4.iloc[0]
telescoping_actual = delta_s4.dropna().sum()
if abs(telescoping_expected - telescoping_actual) > 1e-12:
    errors.append(f"Telescoping sum failed: {telescoping_actual} != {telescoping_expected}")

# 2. Log return additivity: sum of log returns = log(x_last / x_first)
log_sum = log_return_s1.dropna().sum()
log_total = np.log(values_s1.iloc[-1] / values_s1.iloc[0])
if abs(log_sum - log_total) > 1e-10:
    errors.append(f"Log return additivity failed: {log_sum} != {log_total}")

# 3. Log return symmetry: ln(a/b) = -ln(b/a)
lr_forward = float(np.log(110.0 / 100.0))
lr_backward = float(np.log(100.0 / 110.0))
if abs(lr_forward + lr_backward) > 1e-15:
    errors.append(f"Log return symmetry failed: {lr_forward} + {lr_backward} != 0")

# 4. ROC = ratio - 1 (mathematical identity)
for i in range(1, len(values_s1)):
    ratio_val = ratio_s1.iloc[i]
    roc_val = roc_s1.iloc[i]
    if abs((ratio_val - 1) - roc_val) > 1e-12:
        errors.append(f"ROC != ratio-1 at index {i}: {roc_val} != {ratio_val - 1}")

# 5. Slope = delta / dt when dt is constant
#    For S1: dt=1, so slope should equal delta
for i in range(1, len(values_s1)):
    if abs(slope_s1.iloc[i] - delta_s1.iloc[i]) > 1e-10:
        errors.append(f"Slope != delta for dt=1 at index {i}")

# 6. CumDelta lag=3 telescoping: sum of lag-3 deltas
#    This is NOT x[last] - x[first] for lag>1. Verify sum directly.
cum_delta_s5_check = delta_s5.dropna().sum()
# For lag=3: deltas are (40-10)+(50-20)+(60-30) = 30+30+30 = 90
if abs(cum_delta_s5_check - 90.0) > 1e-12:
    errors.append(f"CumDelta lag=3 sum failed: {cum_delta_s5_check} != 90.0")

# 7. Absolute delta: |12 - 20| = 8
if abs(results["S6-absolute-mode"]["absDelta"] - 8.0) > 1e-12:
    errors.append(f"Absolute delta failed: {results['S6-absolute-mode']['absDelta']} != 8.0")

# 8. Absolute slope: |(30-50)/(4-0)| = |-5| = 5
if abs(results["S6-absolute-mode"]["absSlope"] - 5.0) > 1e-12:
    errors.append(f"Absolute slope failed: {results['S6-absolute-mode']['absSlope']} != 5.0")

if errors:
    print("VERIFICATION FAILED:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)

# ============================================================================
# Write output
# ============================================================================

output_path = "composer/src/nodes/lag/test/golden-truth-lag.json"
with open(output_path, "w") as f:
    json.dump(results, f, indent=2)

print(f"Golden truth written to {output_path}")
print("All self-verification checks passed.")
sys.exit(0)
