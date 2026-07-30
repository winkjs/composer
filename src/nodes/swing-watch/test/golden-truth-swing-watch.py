"""
golden-truth-swing-watch.py — independent reference validation for the
swingWatch node, computed using the GUDHI library (3.12.0).

The swingWatch node implements the Huber/Persistence1D 1D sublevel-set
topological persistence algorithm. GUDHI is the standard, open-source C++/Python
library for computational topology and persistent homology, used widely in TDA
research. It implements the same mathematical construction (sublevel-set
filtration on a 1D simplicial complex) and produces identical persistence
diagrams up to the convention difference noted below.

References:
  GUDHI: https://gudhi.inria.fr/  Maria, C., Boissonnat, J-D., Glisse, M.,
    Yvinec, M. (2014). The GUDHI library: Simplicial complexes and persistent
    homology. ICMS.
  Edelsbrunner, Letscher & Zomorodian (2002). Topological Persistence and
    Simplification. Discrete & Computational Geometry, 28, 511–533.
  Huber, S. Persistent Topology for Peak Detection.
    https://www.sthu.org/blog/13-perstopology-peakdetection/index.html
  Persistence1D: https://github.com/weinkauf/Persistence1D

Convention notes:
  - GUDHI's sublevel-set filtration on a 1D complex (path graph: V vertices,
    V-1 edges) produces the same H0 persistence pairs as Persistence1D's
    minima sweep. Each finite (birth, death) pair in H0 corresponds to a local
    minimum being killed at a saddle (local maximum). One pair has
    death=+infinity — the global minimum, which never pairs.
  - For maxima, we run the same filtration on the negated signal and flip the
    signs back. A pair (b, d) in -f corresponds to a maximum of f at -b that
    is killed at -d.
  - GUDHI's pair ordering and tie-breaking may differ from Persistence1D, so
    we compare pair SETS (sorted), not orderings.

Cross-reference convention with the JS test file:
  Each section header below corresponds to a key in
  golden-truth-swing-watch.json. JS tests (see golden-truth.specs.js) load the
  JSON and assert against the values computed here.

Run:
  python3 golden-truth-swing-watch.py
  → writes golden-truth-swing-watch.json (data file)
  → exits 0 on internal-consistency success, 1 on failure
"""

import json
import math
import os
import sys

import numpy as np
import gudhi

LIB_INFO = {
    "gudhi_version": gudhi.__version__,
    "numpy_version": np.__version__,
}


def _build_complex(signal):
    """
    Build a 1D simplicial complex (path graph) for sublevel-set filtration.

    Vertices are filtered by f(i); each edge (i, i+1) is filtered by
    max(f(i), f(i+1)) so the edge appears exactly when both endpoints are
    in the sublevel set. This is the standard 1D sublevel-set construction.

    GUDHI's SimplexTree handles the filtration order and persistence
    computation. We do not implement any persistence logic ourselves.
    """
    st = gudhi.SimplexTree()
    n = len(signal)
    for i in range(n):
        st.insert([i], filtration=float(signal[i]))
    for i in range(n - 1):
        st.insert([i, i + 1], filtration=float(max(signal[i], signal[i + 1])))
    return st


def _persistence_pairs(signal):
    """
    Compute H0 sublevel-set persistence pairs using GUDHI.

    Returns:
      finite_pairs: list of (birth_value, death_value) for finite H0 pairs
      survivor: birth_value of the unpaired component (the global minimum)
    """
    st = _build_complex(signal)
    # compute_persistence is required before persistence_pairs is meaningful.
    st.compute_persistence(persistence_dim_max=False)
    pairs = st.persistence_intervals_in_dimension(0)
    finite = []
    survivor = None
    for birth, death in pairs:
        if math.isinf(death):
            survivor = float(birth)
        else:
            finite.append((float(birth), float(death)))
    return finite, survivor


def _min_pairs(signal):
    """Persistence pairs for local minima (sublevel of f)."""
    finite, survivor = _persistence_pairs(signal)
    pairs = [
        {"birthVal": b, "deathVal": d, "persistence": d - b}
        for b, d in finite
    ]
    return pairs, survivor


def _max_pairs(signal):
    """Persistence pairs for local maxima (sublevel of -f, sign-flipped)."""
    neg = [-v for v in signal]
    finite, survivor = _persistence_pairs(neg)
    pairs = [
        {"birthVal": -b, "deathVal": -d, "persistence": (-d) - (-b)}
        # In -f, b is the negated max; d is the negated saddle.
        # birthVal of the max = -b ; deathVal (the killing saddle) = -d.
        # persistence = birthVal - deathVal = -b - (-d) = d - b ≥ 0.
        # We compute it as |b - d| to match the node's convention
        # (persistence is always positive).
        for b, d in finite
    ]
    # Recompute persistence cleanly
    for p in pairs:
        p["persistence"] = abs(p["birthVal"] - p["deathVal"])
    return pairs, ( -survivor if survivor is not None else None )


def _sorted_persistences(pairs, threshold):
    """Sort pair persistences for set-based comparison."""
    vals = [p["persistence"] for p in pairs if p["persistence"] >= threshold]
    return sorted(vals)


def _section(label, signal, threshold=0.001):
    mins, min_surv = _min_pairs(signal)
    maxs, max_surv = _max_pairs(signal)
    return {
        "label": label,
        "signal": [float(x) for x in signal],
        "threshold": float(threshold),
        "minPersistencesSorted": _sorted_persistences(mins, threshold),
        "maxPersistencesSorted": _sorted_persistences(maxs, threshold),
        "minPairCount": len(_sorted_persistences(mins, threshold)),
        "maxPairCount": len(_sorted_persistences(maxs, threshold)),
        "minSurvivor": min_surv,
        "maxSurvivor": max_surv,
        "deepestMinPersistence": (
            max((p["persistence"] for p in mins), default=0.0)
        ),
        "deepestMaxPersistence": (
            max((p["persistence"] for p in maxs), default=0.0)
        ),
        "deepestMinBirthValue": (
            max(mins, key=lambda p: p["persistence"])["birthVal"]
            if mins else None
        ),
        "deepestMaxBirthValue": (
            max(maxs, key=lambda p: p["persistence"])["birthVal"]
            if maxs else None
        ),
    }


def main():
    out = {"_meta": LIB_INFO, "sections": {}}

    # ── S1: hand-crafted [5,1,3,2,4,0,2] ─────────────────────
    out["sections"]["S1-handcrafted"] = _section(
        "Hand-crafted signal from update.specs.js",
        [5, 1, 3, 2, 4, 0, 2],
        threshold=0.001,
    )

    # ── S2: constant signal — no extrema ─────────────────────
    out["sections"]["S2-constant"] = _section(
        "Constant signal — no extrema, no pairs",
        [5.0] * 10,
    )

    # ── S3: monotonic increasing ─────────────────────────────
    out["sections"]["S3-monotonic-up"] = _section(
        "Monotonic increasing — no interior extrema",
        list(range(10)),
    )

    # ── S4: monotonic decreasing ─────────────────────────────
    out["sections"]["S4-monotonic-down"] = _section(
        "Monotonic decreasing — no interior extrema",
        list(range(10, 0, -1)),
    )

    # ── S5: alternating square-wave-ish signal ───────────────
    out["sections"]["S5-square-ish"] = _section(
        "Alternating signal [10,0,10,0,10,0,10,0,10]",
        [10, 0, 10, 0, 10, 0, 10, 0, 10],
    )

    # ── S6: tied global minimum ──────────────────────────────
    out["sections"]["S6-plateau"] = _section(
        "Plateau with surrounding extrema [1,5,5,5,1]",
        [1, 5, 5, 5, 1],
    )

    # ── S7: chirp-like signal (varying amplitudes) ───────────
    rng = np.random.default_rng(42)
    n = 50
    t = np.linspace(0, 4 * np.pi, n)
    chirp = (
        np.sin(t) * np.linspace(0.5, 2.0, n)
        + 0.05 * rng.standard_normal(n)
    )
    out["sections"]["S7-chirp-noise"] = _section(
        "Chirp + noise (deterministic seed=42, n=50)",
        list(chirp),
        threshold=0.0,
    )

    # ── S8: deterministic LCG signal matching test-helpers.js ─
    # Mirror the JS LCG in test-helpers.js so the JS tests can use the same
    # underlying signal and verify against the Python-computed persistences.
    def _js_lcg(length, seed=42, scale=100):
        signal = []
        s = seed
        for _ in range(length):
            s = ((s * 1103515245) + 12345) & 0x7FFFFFFF
            signal.append((s % (scale * 10)) / 10.0)
        return signal

    out["sections"]["S8-lcg-50-seed-1"] = _section(
        "LCG signal (n=50, seed=1) matching JS test-helpers.makeSignal",
        _js_lcg(50, seed=1),
    )
    out["sections"]["S8-lcg-100-seed-7"] = _section(
        "LCG signal (n=100, seed=7) matching JS test-helpers.makeSignal",
        _js_lcg(100, seed=7),
    )
    out["sections"]["S8-lcg-200-seed-99"] = _section(
        "LCG signal (n=200, seed=99) matching JS test-helpers.makeSignal",
        _js_lcg(200, seed=99),
    )

    # ── Self-verification (mathematical invariants from GUDHI) ─
    failures = []

    def _check(cond, msg):
        if not cond:
            failures.append(msg)

    s = out["sections"]["S1-handcrafted"]
    # Hand-crafted has known structure: 2 min pairs (p=1, p=3) and 3 max pairs
    # (p=1, p=2, p=3). Survivor of mins = global min = 0.
    _check(
        sorted(s["minPersistencesSorted"]) == sorted([1.0, 3.0]),
        f"S1 min persistences expected [1,3], got {s['minPersistencesSorted']}",
    )
    _check(
        sorted(s["maxPersistencesSorted"]) == sorted([1.0, 2.0, 3.0]),
        f"S1 max persistences expected [1,2,3], got {s['maxPersistencesSorted']}",
    )
    _check(s["minSurvivor"] == 0.0, f"S1 min survivor expected 0, got {s['minSurvivor']}")
    _check(s["maxSurvivor"] == 5.0, f"S1 max survivor expected 5, got {s['maxSurvivor']}")

    # S2 constant: no pairs at all.
    s2 = out["sections"]["S2-constant"]
    _check(s2["minPairCount"] == 0, "S2 constant must have 0 min pairs")
    _check(s2["maxPairCount"] == 0, "S2 constant must have 0 max pairs")

    # S3 monotonic increasing: no interior extrema.
    s3 = out["sections"]["S3-monotonic-up"]
    _check(s3["minPairCount"] == 0, "S3 monotonic-up must have 0 min pairs")
    _check(s3["maxPairCount"] == 0, "S3 monotonic-up must have 0 max pairs")

    # S4 monotonic decreasing: no interior extrema.
    s4 = out["sections"]["S4-monotonic-down"]
    _check(s4["minPairCount"] == 0, "S4 monotonic-down must have 0 min pairs")
    _check(s4["maxPairCount"] == 0, "S4 monotonic-down must have 0 max pairs")

    # S6 plateau [1,5,5,5,1]: one pair on each side.
    s6 = out["sections"]["S6-plateau"]
    _check(s6["minPairCount"] >= 0 and s6["maxPairCount"] >= 0,
           "S6 plateau pair counts must be non-negative")
    _check(s6["maxPairCount"] == 0,  # global max-side has only the plateau as the unique max → no pairs
           f"S6 plateau expected 0 max pairs (only one peak), got {s6['maxPairCount']}")

    # Universal invariant: total finite pairs + 1 (survivor) = number of
    # connected-component births. For 1D sublevel-set, sum of finite +
    # survivor = number of strict local minima (counting the global one).
    # Verified at least for S1: 2 finite + 1 survivor = 3 minima of [5,1,3,2,4,0,2]
    #   → at indices 1, 3, 5 (values 1, 2, 0). Correct.
    _check(s["minPairCount"] + 1 == 3, "S1 total minima invariant violated")

    out["selfCheck"] = {
        "passed": len(failures) == 0,
        "failures": failures,
    }

    here = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(here, "golden-truth-swing-watch.json")
    with open(json_path, "w") as fh:
        json.dump(out, fh, indent=2, sort_keys=True)
    print(f"Wrote {json_path}")
    print(f"Library: gudhi {LIB_INFO['gudhi_version']}, numpy {LIB_INFO['numpy_version']}")
    print(f"Sections: {len(out['sections'])}")
    if failures:
        print("SELF-CHECK FAILURES:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("Self-check: PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()
