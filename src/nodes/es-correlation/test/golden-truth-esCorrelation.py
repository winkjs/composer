"""
Golden-truth reference values for es-correlation node tests.

Generates every numerical value that should be asserted in es-correlation.specs.js
using pandas.DataFrame.ewm as the ground truth. Run this script to verify that
the JS implementation matches the standard exponentially weighted moving correlation.

Cross-reference: The JS test file (es-correlation.specs.js) should reference this
script via "see golden-truth-esCorrelation.py SN" comments on every closeTo assertion.
The section numbers (S1-S5) map to the SECTION headers below. If a value changes here,
the corresponding JS assertion must update.

Reference: pandas.DataFrame.ewm(halflife=..., adjust=False).corr() computes the
exponentially weighted moving correlation using the same incremental algorithm as the
JS node (Welford-style with exponential decay). Validated against pandas 3.0.1.

The JS node algorithm:
    meanX += alpha * (xVal - meanX)
    meanY += alpha * (yVal - meanY)
    covariance += alpha * (deltaX * (yVal - meanY_new) - covariance)
    varianceX += alpha * (deltaX * (xVal - meanX_new) - varianceX)
    varianceY += alpha * (deltaY * (yVal - meanY_new) - varianceY)
    correlation = covariance / (sqrt(varianceX) * sqrt(varianceY))

This is mathematically equivalent to pandas ewm(halflife=h, adjust=False).corr(),
which uses the biased EWM covariance and variance. The correlation is identical because
the bias correction factor cancels in the ratio cov/(stdX*stdY).

Library: pandas 3.0.1, numpy 2.2.1
Algorithm: Exponentially weighted moving correlation (EWMC)

Usage:
    python3 golden-truth-esCorrelation.py
"""

import sys
import json
import numpy as np
import pandas as pd


def halflife_to_alpha(halflife):
    """Convert halflife (samples) to EWMA alpha, matching JS halfLifeToAlpha."""
    return -np.expm1(-np.log(2) / halflife)


def pandas_ewm_corr(x_vals, y_vals, halflife):
    """Compute EWM correlation at each step using pandas (ground truth).

    Returns a list of correlation values, one per step starting from step 1
    (step 0 is the init step with only one sample, correlation undefined).
    """
    df = pd.DataFrame({'x': x_vals, 'y': y_vals})
    results = []
    for i in range(1, len(x_vals)):
        sub = df.iloc[:i + 1]
        ewm_sub = sub.ewm(halflife=halflife, adjust=False)
        c = ewm_sub.corr()
        r = c.loc[(i, 'x'), 'y']
        results.append(float(r))
    return results


def pandas_ewm_cov_biased(x_vals, y_vals, halflife):
    """Compute biased EWM covariance at each step (matches JS state.covariance)."""
    df = pd.DataFrame({'x': x_vals, 'y': y_vals})
    results = []
    for i in range(1, len(x_vals)):
        sub = df.iloc[:i + 1]
        ewm_sub = sub.ewm(halflife=halflife, adjust=False)
        c = ewm_sub.cov(bias=True)
        cov = c.loc[(i, 'x'), 'y']
        results.append(float(cov))
    return results


def fisher_z(r, cap=0.9999):
    """Fisher Z transformation with capping, matching JS logic."""
    capped = max(min(r, cap), -cap)
    return 0.5 * np.log((1 + capped) / (1 - capped))


# ====================================================================
# S1: Basic positive correlation — halfLife=5, 10 samples
# ====================================================================
print("=" * 60)
print("S1: Basic positive correlation (halfLife=5)")
print("=" * 60)

s1_x = [10.0, 12.0, 15.0, 11.0, 14.0, 13.0, 16.0, 12.0, 18.0, 10.0]
s1_y = [20.0, 22.0, 28.0, 19.0, 25.0, 24.0, 30.0, 21.0, 35.0, 18.0]
s1_hl = 5.0
s1_alpha = halflife_to_alpha(s1_hl)

s1_corr = pandas_ewm_corr(s1_x, s1_y, s1_hl)
s1_cov = pandas_ewm_cov_biased(s1_x, s1_y, s1_hl)

print(f"  alpha = {s1_alpha:.15e}")
for i, (r, c) in enumerate(zip(s1_corr, s1_cov)):
    print(f"  step {i + 1}: r={r:.15e}, cov={c:.15e}")

s1_data = {
    "alpha": s1_alpha,
    "correlation": s1_corr,
    "covariance": s1_cov,
    "r2": [r * r for r in s1_corr]
}

# ====================================================================
# S2: Negative correlation — halfLife=3
# ====================================================================
print()
print("=" * 60)
print("S2: Negative correlation (halfLife=3)")
print("=" * 60)

s2_x = [10.0, 8.0, 12.0, 6.0, 14.0, 4.0, 16.0, 2.0]
s2_y = [2.0, 4.0, 1.0, 6.0, 0.0, 8.0, -1.0, 10.0]
s2_hl = 3.0
s2_alpha = halflife_to_alpha(s2_hl)

s2_corr = pandas_ewm_corr(s2_x, s2_y, s2_hl)
s2_cov = pandas_ewm_cov_biased(s2_x, s2_y, s2_hl)

print(f"  alpha = {s2_alpha:.15e}")
for i, (r, c) in enumerate(zip(s2_corr, s2_cov)):
    print(f"  step {i + 1}: r={r:.15e}, cov={c:.15e}")

s2_data = {
    "alpha": s2_alpha,
    "correlation": s2_corr,
    "covariance": s2_cov,
    "r2": [r * r for r in s2_corr]
}

# ====================================================================
# S3: Near-zero correlation (independent signals) — halfLife=10
# ====================================================================
print()
print("=" * 60)
print("S3: Near-zero correlation (halfLife=10)")
print("=" * 60)

# Deliberately uncorrelated data: x increasing, y alternating
s3_x = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
s3_y = [5.0, 3.0, 7.0, 2.0, 8.0, 1.0, 6.0, 4.0, 9.0, 0.0]
s3_hl = 10.0
s3_alpha = halflife_to_alpha(s3_hl)

s3_corr = pandas_ewm_corr(s3_x, s3_y, s3_hl)
s3_cov = pandas_ewm_cov_biased(s3_x, s3_y, s3_hl)

print(f"  alpha = {s3_alpha:.15e}")
for i, (r, c) in enumerate(zip(s3_corr, s3_cov)):
    print(f"  step {i + 1}: r={r:.15e}, cov={c:.15e}")

s3_data = {
    "alpha": s3_alpha,
    "correlation": s3_corr,
    "covariance": s3_cov
}

# ====================================================================
# S4: Fisher Z transformation — halfLife=10
# ====================================================================
print()
print("=" * 60)
print("S4: Fisher Z transformation (halfLife=10)")
print("=" * 60)

s4_x = [10.0, 20.0, 30.0, 25.0, 35.0, 15.0, 40.0, 22.0, 45.0, 28.0]
s4_y = [12.0, 19.0, 31.0, 26.0, 33.0, 17.0, 38.0, 24.0, 43.0, 30.0]
s4_hl = 10.0
s4_alpha = halflife_to_alpha(s4_hl)
FISHER_CAP = 0.9999

s4_corr = pandas_ewm_corr(s4_x, s4_y, s4_hl)
s4_fisher = [fisher_z(r, FISHER_CAP) for r in s4_corr]

print(f"  alpha = {s4_alpha:.15e}")
for i, (r, z) in enumerate(zip(s4_corr, s4_fisher)):
    print(f"  step {i + 1}: r={r:.15e}, fisherZ={z:.15e}")

s4_data = {
    "alpha": s4_alpha,
    "correlation": s4_corr,
    "fisherZT": s4_fisher,
    "fisherZCap": FISHER_CAP
}

# ====================================================================
# S5: Step response — constant then shift, halfLife=8
# ====================================================================
print()
print("=" * 60)
print("S5: Step response (halfLife=8)")
print("=" * 60)

# First 5: perfectly correlated, then decorrelate
s5_x = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0]
s5_y = [1.0, 2.0, 3.0, 4.0, 5.0, 5.0, 4.0, 3.0, 2.0, 1.0,  0.0, -1.0]
s5_hl = 8.0
s5_alpha = halflife_to_alpha(s5_hl)

s5_corr = pandas_ewm_corr(s5_x, s5_y, s5_hl)
s5_cov = pandas_ewm_cov_biased(s5_x, s5_y, s5_hl)

print(f"  alpha = {s5_alpha:.15e}")
for i, (r, c) in enumerate(zip(s5_corr, s5_cov)):
    print(f"  step {i + 1}: r={r:.15e}, cov={c:.15e}")

s5_data = {
    "alpha": s5_alpha,
    "correlation": s5_corr,
    "covariance": s5_cov,
    "r2": [r * r for r in s5_corr]
}

# ====================================================================
# Assemble and write JSON
# ====================================================================
golden = {
    "S1-basic-positive": s1_data,
    "S2-negative": s2_data,
    "S3-near-zero": s3_data,
    "S4-fisher-z": s4_data,
    "S5-step-response": s5_data
}

output_path = "golden-truth-esCorrelation.json"
with open(
    __file__.replace("golden-truth-esCorrelation.py", output_path), "w"
) as f:
    json.dump(golden, f, indent=2)

print()
print(f"Golden-truth data written to {output_path}")
print()

# ====================================================================
# Self-verification: mathematical invariants on pandas-generated values
# ====================================================================
print("=" * 60)
print("VERIFICATION: Mathematical invariants")
print("=" * 60)

ok = True

# --- 1. Bound invariant: |r| <= 1.0 for all correlation values ---
all_corrs = [
    ("S1", s1_corr), ("S2", s2_corr), ("S3", s3_corr),
    ("S4", s4_corr), ("S5", s5_corr),
]
for name, corrs in all_corrs:
    violations = [i for i, r in enumerate(corrs) if abs(r) > 1.0]
    if violations:
        print(f"  FAIL {name} bound: |r| > 1 at steps {violations}")
        ok = False
    else:
        print(f"  {name} bound |r| <= 1: PASS")

# --- 2. Symmetry invariant: corr(x, y) == corr(y, x) ---
# Recompute S1 with columns swapped; result must be identical.
s1_corr_yx = pandas_ewm_corr(s1_y, s1_x, s1_hl)
sym_err = max(abs(a - b) for a, b in zip(s1_corr, s1_corr_yx))
if sym_err > 1e-15:
    print(f"  FAIL S1 symmetry: max |corr(x,y) - corr(y,x)| = {sym_err:.2e}")
    ok = False
else:
    print(f"  S1 symmetry corr(x,y)==corr(y,x): PASS (max err = {sym_err:.2e})")

# --- 3. r-squared identity: r2 == correlation^2 ---
r2_datasets = [
    ("S1", s1_corr, s1_data["r2"]),
    ("S2", s2_corr, s2_data["r2"]),
    ("S5", s5_corr, s5_data["r2"]),
]
for name, corrs, r2s in r2_datasets:
    max_err = max(abs(r * r - r2) for r, r2 in zip(corrs, r2s))
    if max_err > 1e-15:
        print(f"  FAIL {name} r2 identity: max |r^2 - r2| = {max_err:.2e}")
        ok = False
    else:
        print(f"  {name} r2 == correlation^2: PASS (max err = {max_err:.2e})")

# --- 4. Sign consistency: sign(cov) == sign(corr) where both nonzero ---
sign_datasets = [
    ("S1", s1_corr, s1_cov), ("S2", s2_corr, s2_cov),
    ("S3", s3_corr, s3_cov), ("S5", s5_corr, s5_cov),
]
for name, corrs, covs in sign_datasets:
    violations = []
    for i, (r, c) in enumerate(zip(corrs, covs)):
        if abs(r) > 1e-15 and abs(c) > 1e-15:
            if np.sign(r) != np.sign(c):
                violations.append(i)
    if violations:
        print(f"  FAIL {name} sign consistency at steps {violations}")
        ok = False
    else:
        print(f"  {name} sign(cov)==sign(corr): PASS")

print()
if ok:
    print("ALL VERIFICATIONS PASSED")
    sys.exit(0)
else:
    print("VERIFICATION FAILED")
    sys.exit(1)
