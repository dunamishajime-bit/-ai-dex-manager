#!/usr/bin/env python3
"""PRISM VII: frozen read-only SHORT V20 53-intent inventory, not a trading policy.

Inputs are the historical PRISM5 entry-decision and PRISM6 early native-M5
research ledgers. Outcomes / future path are for attribution ONLY, never for
as-of trade features. This program does not place or simulate orders, optimize
thresholds, or claim 80% success or Production parity.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import json
from pathlib import Path
from statistics import median

SOURCE_PIN = "1657e173d250ad58f53e62f7bb0a3428fb405496"
BASE = Path("docs/research-results/prism-phase2-20261122")
ENTRY = BASE / "PRISM5_PENGU_V20_STRUCTURE_53_CLASSIFICATION.csv"
EARLY = BASE / "PRISM6_PENGU_V20_M5_53_EARLY_CAUSAL_FORENSICS.csv"
CHECKPOINTS = (1, 3, 6, 12)


def rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quantile(values: list[float], p: float) -> float | None:
    vals = sorted(x for x in values if x == x and abs(x) != float("inf"))
    if not vals:
        return None
    z = (len(vals) - 1) * p
    i = int(z)
    j = min(i + 1, len(vals) - 1)
    return round(vals[i] + (vals[j] - vals[i]) * (z - i), 6)


def dist(values: list[float]) -> dict[str, float | None]:
    return {"p10": quantile(values, 0.10),
            "median": quantile(values, 0.50),
            "p90": quantile(values, 0.90)}


def asof_summary(records: list[dict]) -> dict:
    # All feature values originate from as-of H1 candles in the pinned ledger.
    feat = [r["features"] for r in records]
    return {
        "n": len(records),
        "wins": sum(r["win"] for r in records),
        "atr24_hourly_ratio_pct": dist([f["atr24_ratio"] * 100 for f in feat]),
        "prior_3h_return_pct": dist([f["p_return_3h"] * 100 for f in feat]),
        "prior_6h_return_pct": dist([f["p_return_6h"] * 100 for f in feat]),
        "prior_24h_return_pct": dist([f["p_return_24h"] * 100 for f in feat]),
        "mean_native_net30_pct": round(
            sum(r["native_net30_pct"] for r in records) / len(records), 6
        ) if records else None,
        "exit_reasons": dict(sorted(Counter(r["native_exit_reason"] for r in records).items())),
    }


def inventory(entry_path: Path, early_path: Path, *, expected_n: int = 53) -> dict:
    original = rows(entry_path)
    timeline = rows(early_path)
    if len(original) != expected_n:
        raise ValueError(f"ENTRY_COUNT_MISMATCH:{len(original)}!={expected_n}")
    by_key = {}
    for row in original:
        k = (row["period"], row["original_signal_id"])
        if k in by_key:
            raise ValueError(f"DUPLICATE_NATIVE_INTENT:{k}")
        if row["source_native_short_pin"] != SOURCE_PIN:
            raise ValueError(f"UNEXPECTED_SOURCE_PIN:{k}")
        if int(row["original_referenceTs"]) > int(row["original_entryTs"]):
            raise ValueError(f"INVALID_ASOF_ENTRY_TIME:{k}")
        f = json.loads(row["features"])
        if not f.get("is_original_short_candidate"):
            raise ValueError(f"NOT_SHORT_V20_CANDIDATE:{k}")
        native = float(row["original_native_net30_pct"])
        win = native > 0
        if row["original_native_profitable30"].lower() != str(win).lower():
            raise ValueError(f"NATIVE_OUTCOME_FLAG_MISMATCH:{k}")
        by_key[k] = {
            "period": row["period"],
            "signal_id": row["original_signal_id"],
            "source_pin": SOURCE_PIN,
            "reference_ts": int(row["original_referenceTs"]),
            "entry_ts": int(row["original_entryTs"]),
            "native_exit_ts": int(row["original_native_exitTs"]),
            "native_exit_reason": row["original_native_exit_reason"],
            "native_net30_pct": native,
            "win": win,
            "features": f,
            # 3 loss families have not been assigned per-ID by PRISM5 inputs;
            # do not retroactively invent precise individual MFE-based labels.
            "loss_family": "UNRESOLVED_FROM_THESE_INPUTS" if not win else None,
            "early_checkpoints": {},
        }
    seen = set()
    for row in timeline:
        k = (row["period"], row["source_trade_id"])
        if k not in by_key:
            raise ValueError(f"EARLY_UNKNOWN_NATIVE_INTENT:{k}")
        h = int(row["checkpointH"])
        if h not in CHECKPOINTS:
            raise ValueError(f"INVALID_CHECKPOINT:{k}:{h}")
        index = (k, h)
        if index in seen:
            raise ValueError(f"EARLY_DUPLICATE_CHECKPOINT:{k}:{h}")
        seen.add(index)
        item = by_key[k]
        if int(row["entryTs"]) != item["entry_ts"]:
            raise ValueError(f"EARLY_ENTRY_TIME_MISMATCH:{k}:{h}")
        if (row["native_win30"].lower() == "true") != item["win"]:
            raise ValueError(f"EARLY_WIN_FLAG_MISMATCH:{k}:{h}")
        completed = row["status"] == "ASOF_COMPLETED"
        item["early_checkpoints"][h] = {
            "status": row["status"],
            "completed": completed,
            "max_favorable_pct": float(row["max_favorable_pct"]) if completed else None,
            "max_adverse_pct": float(row["max_adverse_pct"]) if completed else None,
            "positive_print_m5": int(row["positive_print_M5"]),
            "no_print_m5": int(row["no_print_m5"]),
            "observed_future_only": True,
        }
    if len(seen) != expected_n * len(CHECKPOINTS):
        raise ValueError(f"INCOMPLETE_NATIVE_TIMELINE:{len(seen)}")
    trades = sorted(by_key.values(), key=lambda r: (r["entry_ts"], r["period"], r["signal_id"]))
    winners = [r for r in trades if r["win"]]
    losers = [r for r in trades if not r["win"]]
    # Native win counts and all 53 trades remain the immutable comparison.
    if expected_n == 53 and (len(winners), len(losers)) != (29, 24):
        raise ValueError(f"NATIVE_WINLOSS_NOT_29_24:{len(winners)}:{len(losers)}")
    windows = {}
    for h in CHECKPOINTS:
        eligible = [r["early_checkpoints"][h] for r in trades
                    if r["early_checkpoints"][h]["completed"]]
        all_window = [r["early_checkpoints"][h] for r in trades]
        total_bars = sum(x["positive_print_m5"] + x["no_print_m5"] for x in all_window)
        zero_bars = sum(x["no_print_m5"] for x in all_window)
        windows[str(h)] = {
            "completed_count": len(eligible),
            "censored_or_no_print_only_count": expected_n - len(eligible),
            "all_recorded_m5_bars": total_bars,
            "zero_print_m5_bars": zero_bars,
            "zero_print_fraction": round(zero_bars / total_bars, 6) if total_bars else None,
            "maximum_favorable_pct_completed_only": dist(
                [r["max_favorable_pct"] for r in eligible]),
            "maximum_adverse_pct_completed_only": dist(
                [r["max_adverse_pct"] for r in eligible]),
        }
    return {
        "schema": "prism7-pengu-native53-immutable-opportunity-inventory/v1",
        "research_only": True,
        "future_paths_are_never_entry_features": True,
        "source_pin": SOURCE_PIN,
        "files_sha256": {
            str(entry_path).replace("\\\\", "/"): sha256(entry_path),
            str(early_path).replace("\\\\", "/"): sha256(early_path),
        },
        "candidate_intents": len(trades),
        "win30": len(winners),
        "lose30": len(losers),
        "target_80_wins_at_53_intents": 43 if expected_n == 53 else None,
        "minimum_loser_to_winner_conversions_if_no_winner_damaged":
            14 if expected_n == 53 else None,
        "all": asof_summary(trades),
        "winners": asof_summary(winners),
        "losers": asof_summary(losers),
        "m5_post_entry_observation_not_executable_profit": windows,
        "native_per_signal": trades,
        "limitations": [
            "All three windows are previously observed, not untouched OOS.",
            "Loss family counts 11/7/6 are externally verified aggregates; not assigned per-ID here.",
            "Maximum favorable excursion is hindsight and not executable profit.",
            "H1/M5 source price disagreement, actual fills and order book unresolved.",
            "No Production parity, funding, portfolio Gross or max DD asserted.",
        ],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entries", type=Path, default=ENTRY)
    ap.add_argument("--early", type=Path, default=EARLY)
    ap.add_argument("--out", type=Path, required=False)
    args = ap.parse_args()
    result = inventory(args.entries, args.early)
    encoded = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(encoded, encoding="utf-8")
        print(f"PRISM7_FORENSIC_INVENTORY_PASS {args.out}")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
