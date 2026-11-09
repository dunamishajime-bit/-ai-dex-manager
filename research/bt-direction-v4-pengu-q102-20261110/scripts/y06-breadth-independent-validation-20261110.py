#!/usr/bin/env python3
"""Independent, read-only Y06 breadth/causality audit. Research only; never places orders."""
import collections
import datetime as dt
import gzip
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np

ROOT = Path(os.environ.get("DISDEX_BT_ROOT", r"C:\tmp\disdex-bt-20251001-20261001"))
OUT = ROOT / "DIRECTION_RESEARCH_20261109"
RAW = OUT / "v4_internal_threeperiod_flat.jsonl"
CACHE = OUT / "market_breadth_feature_cache_20261110.json"
ROUTE = "REC_Y06_REV_D0_T72"
H = 3_600_000
F = [3, 6, 12, 24]

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as file:
        for piece in iter(lambda: file.read(1024 * 1024), b""):
            h.update(piece)
    return h.hexdigest()

def utc(ts):
    return dt.datetime.fromtimestamp(ts / 1000, dt.timezone.utc).isoformat()

rows = sorted(
    (json.loads(line) for line in RAW.open(encoding="utf-8") if line.strip()),
    key=lambda x: (x["decisionTs"], x.get("row_id", "")),
)
rows = [x for x in rows if x.get("route") == ROUTE and x.get("period") == "TARGET"]
assert len(rows) == 352, f"Unexpected Y06 TARGET count: {len(rows)}"
assert all(x["side"] == "SHORT" for x in rows)
assert all(x["ief_lastClosedBarTsMs"] <= x["decisionTs"] - H for x in rows)
assert all(bool(x["wrong_native"]) == (x["flip_return_full"] > x["native_return_full"]) for x in rows)

cache_document = json.loads(CACHE.read_text(encoding="utf-8"))
assert cache_document["schema"] == "disdex-market-breadth-causal/v1"
cache = cache_document["features_by_decision_ts"]
symbols = [x for x in cache_document["symbols"] if x != "BTCUSDT"]
assert len(symbols) == 30

# Recompute independent from original completed Aster H1 candles. No current/incomplete bar.
prices = {}
input_hashes = []
for sym in symbols:
    f = ROOT / "aster-public-v3-h1" / f"{sym}-1h-20250924-20261001.jsonl.gz"
    input_hashes.append((f.name, sha256(f)))
    with gzip.open(f, "rt", encoding="utf-8") as z:
        prices[sym] = {int(a[0]): float(a[4]) for a in (json.loads(x) for x in z if x.strip())}
checks = collections.defaultdict(list)
counts_ok = 0
for row in rows:
    ts = row["decisionTs"]
    saved = cache[str(ts)]
    group_sizes = []
    for h in F:
        values = []
        for dd in prices.values():
            last_closed = dd.get(ts - H)
            old_closed = dd.get(ts - (h + 1) * H)
            if last_closed is not None and old_closed is not None and old_closed > 0:
                values.append(last_closed / old_closed - 1)
        assert values
        group_sizes.append(len(values))
        recomputed = {
            f"breadth_pos{h}": sum(z > 0 for z in values) / len(values),
            f"breadth_mean{h}": sum(values) / len(values),
        }
        for name, value in recomputed.items():
            error = abs(value - saved[name])
            checks[name].append(error)
            assert error <= 1e-10, f"Cache mismatch {ts} {name}: {value} vs {saved[name]}"
    assert min(group_sizes) == saved["universe_min_n"]
    counts_ok += 1

# Fixed research split: chronological train 211, validation 70, unseen test 71.
# IMPORTANT: model fitting excludes the preceding 72h so its labels have fully settled.
train = np.arange(0, 211)
validation = np.arange(211, 281)
test = np.arange(281, 352)
settled_train = train[
    np.array([rows[i]["decisionTs"] + 72 * H <= rows[211]["decisionTs"] for i in train])
]
settled_validation = validation[
    np.array([rows[i]["decisionTs"] + 72 * H <= rows[281]["decisionTs"] for i in validation])
]
assert len(settled_train) > 0 and len(settled_validation) > 0
y = np.array([int(r["wrong_native"]) for r in rows])
delta = np.array([r["flip_return_full"] - r["native_return_full"] for r in rows])

def auc(yy, pp):
    a, b = pp[yy == 1], pp[yy == 0]
    return float((np.sum(a[:, None] > b[None, :]) +
                  .5 * np.sum(a[:, None] == b[None, :])) / (len(a) * len(b)))

def ap(yy, pp):
    q = yy[np.argsort(-pp)]
    return float(np.sum(np.cumsum(q) / (1 + np.arange(len(q))) * q) / q.sum())

def entry_value(row, name):
    return cache[str(row["decisionTs"])][name] if name.startswith("breadth_") else row[name]

result = {
    "status": "UNRESOLVED_DATA_OR_SEPARATION",
    "route": ROUTE,
    "source_runtime_sha": rows[0]["source_runtime_sha"],
    "period": "2025-10-01T00:00:00Z/2026-10-01T00:00:00Z (end-exclusive)",
    "events": len(rows),
    "unique_entry_hours": len({x["decisionTs"] for x in rows}),
    "native_side": "SHORT",
    "wrong_native_by_split": {
        name: {"n": len(ids), "wrong": int(y[ids].sum()),
               "wrong_rate": float(y[ids].mean()),
               "first_utc": utc(rows[ids[0]]["decisionTs"]),
               "last_utc": utc(rows[ids[-1]]["decisionTs"])}
        for name, ids in [("train", train), ("validation", validation), ("test", test)]
    },
    "source_sha256": {"v4_internal_threeperiod_flat.jsonl": sha256(RAW),
                      "market_breadth_feature_cache_20261110.json": sha256(CACHE)},
    "h1_30symbol_hash_of_name_sha256_pairs": hashlib.sha256(
        json.dumps(input_hashes, separators=(",", ":")).encode("utf-8")).hexdigest(),
    "closed_h1_feature_parity": {
        "checked_events": counts_ok,
        "comparisons": sum(len(v) for v in checks.values()),
        "max_abs_error_by_feature": {k: max(v) for k, v in checks.items()},
        "live_bar_used": False,
        "universe_excludes_btc": True,
    },
    "strict_72h_purge": {"train_fit_n": len(settled_train),
                          "validation_calibration_n": len(settled_validation),
                          "train_last_fit_utc": utc(rows[settled_train[-1]]["decisionTs"]),
                          "validation_last_calibration_utc": utc(rows[settled_validation[-1]]["decisionTs"])},
    "models": {},
}

for title, fs in {
    "native_entry_only": ["if_sret6", "if_btc6", "if_btc24",
                          "if_rel24", "if_volRatio", "if_er24"],
    "native_plus_cross_sectional_breadth": ["if_sret6", "if_btc6", "if_btc24",
        "if_rel24", "if_volRatio", "if_er24", "breadth_pos6",
        "breadth_pos12", "breadth_pos24"],
}.items():
    X = np.array([[float(entry_value(r, f)) for f in fs] for r in rows])
    assert np.all(np.isfinite(X))
    mu = X[settled_train].mean(axis=0)
    sd = X[settled_train].std(axis=0)
    sd = np.where(sd > 1e-9, sd, 1)
    Z = np.column_stack([np.ones(len(X)), (X - mu) / sd])
    w = np.zeros(Z.shape[1])
    pos = y[settled_train].sum()
    n = len(settled_train)
    sample_weight = np.where(y[settled_train] > 0, n / (2 * pos), n / (2 * (n - pos)))
    # Deterministic ridge logistic regression: no external ML library.
    for _ in range(55):
        probability = 1 / (1 + np.exp(-np.clip(Z[settled_train] @ w, -30, 30)))
        grad = Z[settled_train].T @ ((probability - y[settled_train]) * sample_weight) / n
        grad += np.r_[0, w[1:]] * 0.25
        hessian = Z[settled_train].T @ (
            ((probability * (1 - probability) * sample_weight)[:, None]) * Z[settled_train]
        ) / n
        hessian += np.diag([1e-6] + [0.25] * (len(w) - 1))
        step = np.linalg.solve(hessian, grad)
        w -= step
        if np.max(np.abs(step)) < 1e-8:
            break
    p = 1 / (1 + np.exp(-np.clip(Z @ w, -30, 30)))
    # Threshold calibrated ONLY on validation cases settled before test begins.
    # It guarantees zero false flags in calibration data, not zero in future data.
    native_correct = settled_validation[y[settled_validation] == 0]
    cutoff = float(np.max(p[native_correct]) + 1e-9)
    splits = {}
    for name, ids in [("train", train), ("validation", validation),
                      ("matured_validation", settled_validation), ("unseen_test", test)]:
        chosen = ids[p[ids] > cutoff]
        splits[name] = {
            "n": len(ids), "roc_auc": auc(y[ids], p[ids]),
            "avg_precision": ap(y[ids], p[ids]),
            "flags": len(chosen), "beneficial_flips": int(y[chosen].sum()),
            "harmful_flips": int(len(chosen) - y[chosen].sum()),
            "sum_delta_uncompounded": float(delta[chosen].sum()),
        }
    jitter = {}
    for factor in (0.95, 1.0, 1.05):
        c = min(1, cutoff * factor)
        ids = test[p[test] > c]
        jitter[str(factor)] = {"flags": len(ids), "tp": int(y[ids].sum()),
                              "fp": int(len(ids) - y[ids].sum())}
    result["models"][title] = {
        "features": fs, "coefficients": [float(a) for a in w],
        "penalty": 0.25, "score_cutoff_selected_using_validation": cutoff,
        "splits": splits, "unseen_cutoff_jitter": jitter,
        "accepted": False,
    }

# Simple breadth-only switch is a deliberate rejected comparator.
result["breadth_pos12_ge_0p70"] = {}
for name, ids in [("train", train), ("validation", validation), ("test", test)]:
    selected = [i for i in ids if cache[str(rows[i]["decisionTs"])]["breadth_pos12"] >= 0.70]
    result["breadth_pos12_ge_0p70"][name] = {
        "flags": len(selected), "beneficial": int(y[selected].sum()),
        "harmful": int(len(selected) - y[selected].sum()),
        "sum_delta_uncompounded": float(delta[selected].sum())}
result["conclusions"] = [
    "No Gate accepted: chronological validation discrimination is not robust.",
    "Market-breadth features are exactly reproducible from completed public Aster H1 candles.",
    "A 72h label-availability embargo is required before supervised fitting and cutoff choice.",
    "Large train/validation/test class-prevalence drift makes pooled 100%-precision claims unreliable.",
    "Research-only: integrated 10bps/30bps backtest is not run because no new rule is accepted.",
]
path = OUT / "v4_y06_breadth_independent_validation_20261110.json"
path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("RESULT_PATH", path)
print("RESULT_JSON", json.dumps(result, separators=(",", ":"), ensure_ascii=False))
