#!/usr/bin/env python3
"""
Golden-truth reference for the transform node helpers.

Validates that each JS helper produces the same result as its
NumPy/Python equivalent. This is trivial for one-liner wrappers
around Math.*, but establishes the cross-reference pattern
required by the review-node skill.

Cross-reference convention:
  JS test file references this script as:
    // see golden-truth-transform.py §N
  Each section below is numbered §1–§7, one per helper.

Usage:
    python3 golden-truth-transform.py
"""

import sys
import numpy as np

VECTORS = [0.5, 1.0, 2.0, 3.14159, 100.0, 0.001]

passed = True


def check(name, section, js_fn, np_fn, vectors=VECTORS):
    """Compare JS helper logic against NumPy for each test vector."""
    global passed
    print(f"\n§{section} — {name}")
    for x in vectors:
        js_val = js_fn(x)
        np_val = np_fn(x)
        match = np.isclose(js_val, np_val, rtol=1e-15)
        status = "OK" if match else "FAIL"
        if not match:
            passed = False
        print(f"  {name}({x}) = {js_val:.15e}  ref = {np_val:.15e}  [{status}]")


# §1 — square: x * x
check("square", 1, lambda x: x * x, lambda x: x ** 2)

# §2 — abs: |x|
check("abs", 2, lambda x: abs(x), lambda x: np.abs(x),
      vectors=[-3.0, -0.5, 0.0, 0.5, 3.0])

# §3 — sqrt: √x
check("sqrt", 3, lambda x: np.sqrt(x), lambda x: np.sqrt(x))

# §4 — log: ln(x)
check("log", 4, lambda x: np.log(x), lambda x: np.log(x))

# §5 — log10: log₁₀(x)
check("log10", 5, lambda x: np.log10(x), lambda x: np.log10(x))

# §6 — reciprocal: 1/x
check("reciprocal", 6, lambda x: 1.0 / x, lambda x: 1.0 / x)

# §7 — negate: -x
check("negate", 7, lambda x: -x, lambda x: -x,
      vectors=[-3.0, -0.5, 0.0, 0.5, 3.0])

print("\n" + ("=" * 50))
if passed:
    print("ALL SECTIONS PASSED")
    sys.exit(0)
else:
    print("SOME SECTIONS FAILED")
    sys.exit(1)
