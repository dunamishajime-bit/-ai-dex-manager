#!/usr/bin/env python3
"""Recompute fixed-grid V4 X05/X11 sensitivity. Research only, no LIVE/orders.

Source: local DIRECTION_RESEARCH_20261109/direction_features_long_confirmation.jsonl
The historical test split has already been viewed during research; it is NOT fresh OOS.
"""
import hashlib
import json
import os
from pathlib import Path

root = Path(os.environ.get(
    "DISDEX_BT_ROOT", r"C:\tmp\disdex-bt-20251001-20261001"
))
dir_ = root / "DIRECTION_RESEARCH_20261109"
source = dir_ / "direction_features_long_confirmation.jsonl"
rows = [json.loads(line) for line in source.open(encoding="utf-8") if line.strip()]
report = {
    "source": source.name,
    "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "period": "2025-10-01 UTC to 2026-10-01 UTC (exclusive)",
    "method": "Fixed diagnostic jitter grids; historical train/val/test not independent if thresholds were previously inspected. Test is descriptive, not fresh OOS.",
    "routes": {},
}
specs = [
    ("REC_X05_TIME_36H", "sym_vol72", "sym_ret6",
     [.005264, .005922, .00658, .007238, .007896],
     [-.005, 0, .005], "<=", ">", [33, 11, 12]),
    ("REC_X11_TIME_48H", "rel72", "sym_ret12",
     [-.005, 0, .005], [-.005, 0, .005], ">", ">", [16, 5, 6]),
]

for route, key_a, key_b, values_a, values_b, op_a, op_b, n in specs:
    events = sorted(
        (x for x in rows if x.get("strategy") == "V4"
         and x.get("native_route") == route
         and 1759276800000 <= x["entryTs"] < 1790812800000),
        key=lambda x: x["entryTs"]
    )
    assert len(events) == sum(n), (route, len(events))
    groups = {
        "train": events[:n[0]],
        "validation": events[n[0]:n[0] + n[1]],
        "test": events[n[0] + n[1]:],
    }

    def accept(value, op, threshold):
        return value <= threshold if op == "<=" else value > threshold

    def summarize(group, a, b):
        matches = [x for x in group
                   if accept(x[key_a], op_a, a) and accept(x[key_b], op_b, b)]
        tp = sum(x["flip_return"] > x["native_return"] for x in matches)
        return {
            "flags": len(matches),
            "beneficial": tp,
            "harmful": len(matches) - tp,
            "sum_delta_uncompounded": sum(
                x["flip_return"] - x["native_return"] for x in matches
            ),
            "entries_utc": [x["entryUtc"] for x in matches],
        }

    grid = [
        {"threshold_a": a, "threshold_b": b,
         "splits": {name: summarize(group, a, b)
                    for name, group in groups.items()}}
        for a in values_a for b in values_b
    ]
    center = .00658 if "X05" in route else 0
    baseline = next(x for x in grid if x["threshold_a"] == center
                    and x["threshold_b"] == 0)
    survivors = [
        [x["threshold_a"], x["threshold_b"]]
        for x in grid
        if all(x["splits"][name]["harmful"] == 0 for name in groups)
        and x["splits"]["test"]["flags"] > 0
    ]
    report["routes"][route] = {
        "features": [key_a, key_b], "ops": [op_a, op_b],
        "n": len(events), "split_n": n,
        "base": baseline, "grid": grid,
        "grid_total": len(grid),
        "no_fp_all_splits_with_test_flags": len(survivors),
        "zero_fp_train_val_test_fires": survivors,
    }

target = dir_ / "v4_x05_x11_fixed_threshold_jitter_recheck_20261110.json"
target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                  encoding="utf-8")
for route, summary in report["routes"].items():
    print(route, "grid=", summary["grid_total"],
          "surviving=", summary["no_fp_all_splits_with_test_flags"])
print("OUTPUT=", target)
