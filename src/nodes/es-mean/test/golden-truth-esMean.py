"""
Golden-truth reference values for es-mean node tests.

Generates expected values using pandas.DataFrame.ewm() as an independent
reference implementation. The algorithm is NOT hand-coded in Python — all
numerical results come from the pandas library.

pandas ewm(halflife=h, adjust=False) implements:
    alpha = 1 - exp(-ln(2) / halfLife)
    esm_t = alpha * x_t + (1 - alpha) * esm_{t-1},  esm_0 = x_0

This is the standard exponential smoothing (EWMA) algorithm. The JS
es-mean node implements the algebraically equivalent form:
    esmValue += currentAlpha * (xVal - esmValue)

Reference:
    Hunter (1986), "The Exponentially Weighted Moving Average",
    Journal of Quality Technology 18(4), 203-210.

Cross-reference convention:
    The JS test file (es-mean.specs.js) loads golden-truth values from
    golden-truth-esMean.json via:
        const goldenTruth = JSON.parse( readFileSync( ... ) );

    Each closeTo assertion comment references this script's section, e.g.:
        // see golden-truth-esMean.py §1

    Section keys in the JSON (§1-basic-alpha05, §2-basic-alpha01, etc.)
    map 1:1 to the SECTION headers below.

Sections:
    §1  Basic ES Mean (alpha=0.5, halfLife=1)
    §2  Basic ES Mean (alpha=0.1)
    §3  Default halfLife -> alpha ~ 0.2
    §4  NaN recovery (alpha=0.3) — valid values only
    §5  Floating point edge cases (alpha=0.1)
    §6  Adaptive half-life (behavioral — no library equivalent)
    §7  Alpha capping at 0.95 (behavioral)
    §8  Publish sequence (alpha=0.25)
    §9  NaN lifecycle (default halfLife -> alpha ~ 0.2)

Library: pandas >= 1.0, numpy >= 1.20

Usage:
    python3 golden-truth-esMean.py

Generates golden-truth-esMean.json in the same directory.
Exit code 0 on success, 1 on failure.
"""

import json
import math
import os
import sys

import numpy as np
import pandas as pd


# ====================================================================
# Helpers
# ====================================================================

ok = True


def halflife_from_alpha(alpha):
    """alpha -> halfLife using the standard formula: hl = ln(2) / -log1p(-alpha)."""
    return math.log(2) / (-math.log1p(-alpha))


def check(label, actual, expected, tol=1e-12):
    """Verify actual matches expected within tolerance."""
    global ok
    diff = abs(actual - expected)
    status = "OK" if diff <= tol else "FAIL"
    if status == "FAIL":
        ok = False
    print(f"  {status}: {label} = {actual:.15e} (expected {expected:.15e}, diff {diff:.2e})")


def ewm_series(values, halflife):
    """Compute EWMA using pandas as the independent oracle. Returns list of floats."""
    s = pd.Series(values, dtype=float)
    return s.ewm(halflife=halflife, adjust=False).mean().tolist()


# ====================================================================
# Golden truth accumulator
# ====================================================================

golden = {}


# ====================================================================
# SECTION §1: Basic ES Mean (alpha=0.5, halfLife=1)
# ====================================================================

print("=" * 70)
print("SECTION 1: Basic ES Mean (alpha=0.5, halfLife=1)")
print("=" * 70)

hl_05 = halflife_from_alpha(0.5)
check("halfLife from alpha=0.5", hl_05, 1.0)

inputs_1 = [100.0, 110.0, 90.0, 100.0]
esm_1 = ewm_series(inputs_1, hl_05)

hand_expected_1 = [100.0, 105.0, 97.5, 98.75]
for i, v in enumerate(esm_1):
    check(f"esm[{i}]", v, hand_expected_1[i])

golden["§1-basic-alpha05"] = {
    "halfLife": hl_05,
    "alpha": 0.5,
    "input": inputs_1,
    "esm": esm_1
}

print()


# ====================================================================
# SECTION §2: Basic ES Mean (alpha=0.1)
# ====================================================================

print("=" * 70)
print("SECTION 2: Basic ES Mean (alpha=0.1)")
print("=" * 70)

hl_01 = halflife_from_alpha(0.1)
inputs_2 = [100.0, 110.0, 90.0, 100.0]
esm_2 = ewm_series(inputs_2, hl_01)

hand_expected_2 = [100.0, 101.0, 99.9, 99.91]
for i, v in enumerate(esm_2):
    check(f"esm[{i}]", v, hand_expected_2[i])

golden["§2-basic-alpha01"] = {
    "halfLife": hl_01,
    "alpha": 0.1,
    "input": inputs_2,
    "esm": esm_2
}

print()


# ====================================================================
# SECTION §3: Default halfLife -> alpha ~ 0.2
# ====================================================================

print("=" * 70)
print("SECTION 3: Default halfLife (3.1062837195053903) -> alpha ~ 0.2")
print("=" * 70)

DEFAULT_HL = 3.1062837195053903
# Verify using numpy: alpha = 1 - exp(-ln(2) / hl)
alpha_default = float(1.0 - np.exp(-np.log(2.0) / DEFAULT_HL))
check("default alpha", alpha_default, 0.2, tol=1e-10)

golden["§3-default-halflife"] = {
    "halfLife": DEFAULT_HL,
    "alpha": alpha_default
}

print()


# ====================================================================
# SECTION §4: NaN recovery (alpha=0.3)
# ====================================================================

print("=" * 70)
print("SECTION 4: NaN recovery sequence (alpha=0.3)")
print("=" * 70)

hl_03 = halflife_from_alpha(0.3)
# JS behavior: NaN is skipped, EMA continues on valid values only.
# Feed only the valid values to pandas.
valid_inputs_4 = [50.0, 60.0, 70.0]
esm_4 = ewm_series(valid_inputs_4, hl_03)

hand_expected_4 = [50.0, 53.0, 58.1]
for i, v in enumerate(esm_4):
    check(f"esm after valid[{i}]={valid_inputs_4[i]}", v, hand_expected_4[i])

golden["§4-nan-recovery"] = {
    "halfLife": hl_03,
    "alpha": 0.3,
    "validInput": valid_inputs_4,
    "fullSequence": [50, 60, "NaN", 70],
    "esm": esm_4
}

print()


# ====================================================================
# SECTION §5: Floating point edge cases (alpha=0.1)
# ====================================================================

print("=" * 70)
print("SECTION 5: Floating point edge cases (alpha=0.1)")
print("=" * 70)

fp_cases = [
    [0.1, 0.2],
    [1e-10, 2e-10],
    [1e10, 1e10 + 100],
]

fp_results = []
for vals in fp_cases:
    result = ewm_series(vals, hl_01)
    final = result[-1]
    fp_results.append({"input": vals, "esm": final})
    print(f"  [{vals[0]}, {vals[1]}] -> esm = {final:.17e}")

golden["§5-floating-point"] = {
    "halfLife": hl_01,
    "alpha": 0.1,
    "cases": fp_results
}

print()


# ====================================================================
# SECTION §6: Adaptive half-life (behavioral — no library equivalent)
# ====================================================================

print("=" * 70)
print("SECTION 6: Adaptive half-life — behavioral properties")
print("=" * 70)

print("  NOTE: Adaptive half-life is a custom extension (EMA of |innovation|")
print("  with bounded alpha boost). No standard library equivalent.")
print("  Tests verify behavioral properties only:")
print("    - Calm input: currentAlpha ~ baseAlpha")
print("    - Burst input: currentAlpha > baseAlpha")
print("    - Recovery: currentAlpha drifts back toward baseAlpha (+/- 5%)")

hl_02 = halflife_from_alpha(0.2)
alpha_02 = float(1.0 - np.exp(-np.log(2.0) / hl_02))
check("baseAlpha from halfLife(0.2)", alpha_02, 0.2, tol=1e-10)

golden["§6-adaptive-behavioral"] = {
    "halfLife": hl_02,
    "baseAlpha": alpha_02,
    "note": "Custom extension (EMA of |innovation| with bounded alpha boost). No standard library equivalent. Tests verify behavioral properties only."
}

print()


# ====================================================================
# SECTION §7: Alpha capping at 0.95
# ====================================================================

print("=" * 70)
print("SECTION 7: Alpha capping (behavioral)")
print("=" * 70)

print("  NOTE: Alpha capping is node-specific safety logic (cap at 0.95).")
print("  No library equivalent. Test verifies currentAlpha <= 0.95 after")
print("  extreme surprise with base alpha ~ 0.9.")

golden["§7-alpha-capping"] = {
    "cap": 0.95,
    "baseAlpha": 0.9,
    "note": "Behavioral test — currentAlpha must not exceed 0.95"
}

print()


# ====================================================================
# SECTION §8: Publish sequence (alpha=0.25)
# ====================================================================

print("=" * 70)
print("SECTION 8: Publish sequence (alpha=0.25)")
print("=" * 70)

hl_025 = halflife_from_alpha(0.25)
inputs_8 = [20.0, 24.0, 22.0, 23.0]
esm_8 = ewm_series(inputs_8, hl_025)

for i, v in enumerate(esm_8):
    print(f"  esm[{i}] = {v:.15e}")

golden["§8-publish-sequence"] = {
    "halfLife": hl_025,
    "alpha": 0.25,
    "input": inputs_8,
    "esm": esm_8
}

print()


# ====================================================================
# SECTION §9: NaN lifecycle (default halfLife -> alpha~0.2)
# ====================================================================

print("=" * 70)
print("SECTION 9: NaN lifecycle (alpha~0.2, default halfLife)")
print("=" * 70)

# JS skips NaN: valid sequence from [10, NaN, 20, NaN, 30] is [10, 20, 30]
valid_inputs_9 = [10.0, 20.0, 30.0]
esm_9 = ewm_series(valid_inputs_9, DEFAULT_HL)

hand_expected_9 = [10.0, 12.0, 15.6]
for i, v in enumerate(esm_9):
    check(f"esm after valid[{i}]={valid_inputs_9[i]}", v, hand_expected_9[i], tol=1e-10)

golden["§9-nan-lifecycle"] = {
    "halfLife": DEFAULT_HL,
    "alpha": alpha_default,
    "fullSequence": [10, "NaN", 20, "NaN", 30],
    "validInput": valid_inputs_9,
    "esm": esm_9
}

print()


# ====================================================================
# Write JSON
# ====================================================================

out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden-truth-esMean.json")
with open(out_path, "w") as f:
    json.dump(golden, f, indent=2)
    f.write("\n")
print(f"Golden truth written to: {out_path}")


# ====================================================================
# Summary
# ====================================================================

print()
print("=" * 70)
if ok:
    print("ALL CHECKS PASSED")
    sys.exit(0)
else:
    print("SOME CHECKS FAILED")
    sys.exit(1)
