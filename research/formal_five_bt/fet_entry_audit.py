"""FET entry-time H1 feature audit against allocated portfolio outcomes.

Uses only finalized, contiguous Aster bars strictly earlier than the entry
timestamp. Compares all FET hard stops with other accepted and rejected FET
signals. Gate probes are retrospective attrition diagnostics, NOT portfolio
counterfactuals or deployable proof. Does not touch LIVE or submit orders.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path
from statistics import median
from typing import Any

from .crypto_price_model import HOUR, _rows

FEATURES = (
    "fet_return_6h", "fet_return_12h", "fet_return_24h",
    "fet_return_48h", "btc_return_6h", "btc_return_12h",
    "btc_return_24h", "fet_minus_btc_24h", "fet_prev_1h_volume_ratio",
    "fet_prev_2h_volume_ratio", "fet_atr_24h_pct",
    "fet_close_vs_prev_48h_high", "fet_prev_1h_return",
)


def load_history(data_root: Path, symbol: str) -> dict[int, dict[str, Any]]:
    path = data_root / "normalized/aster/klines" / f"{symbol}.jsonl"
    rows = _rows(path)
    by_ts: dict[int, dict[str, Any]] = {}
    for row in rows:
        ts = int(row["event_time_ms"])
        if ts in by_ts:
            raise ValueError(f"DUPLICATE_H1:{symbol}:{ts}")
        if any(not math.isfinite(float(row[key])) or float(row[key]) <= 0
               for key in ("open", "high", "low", "close")):
            raise ValueError(f"INVALID_H1:{symbol}:{ts}")
        by_ts[ts] = row
    return by_ts


def asof_bars(history: dict[int, dict[str, Any]], entry_ts: int,
              count: int, symbol: str) -> list[dict[str, Any]]:
    # The latest bar opens entry_ts-HOUR and is fully finished when entry
    # begins. The current entry bar and everything after it are forbidden.
    expected = [entry_ts - n * HOUR for n in range(count, 0, -1)]
    rows = [history.get(ts) for ts in expected]
    if any(row is None for row in rows):
        missing = [ts for ts, row in zip(expected, rows) if row is None]
        raise ValueError(f"MISSING_CONTIGUOUS_PRE_ENTRY_H1:{symbol}:{missing[0]}")
    return rows


def fet_entry_features(fet_history: dict[int, dict[str, Any]],
                       btc_history: dict[int, dict[str, Any]],
                       entry_ts: int) -> dict[str, float]:
    fet = asof_bars(fet_history, entry_ts, 73, "FETUSDT")
    btc = asof_bars(btc_history, entry_ts, 25, "BTCUSDT")
    fc = [float(r["close"]) for r in fet]
    bc = [float(r["close"]) for r in btc]
    vols = [float(r["base_volume"]) for r in fet]
    prev_vol_median = median(vols[:-1])
    if prev_vol_median <= 0:
        raise ValueError("INVALID_FET_PRE_ENTRY_VOLUME_MEDIAN")
    true_ranges = []
    for i in range(len(fet) - 24, len(fet)):
        row = fet[i]
        prior_close = fc[i - 1]
        true_ranges.append(max(
            float(row["high"]) - float(row["low"]),
            abs(float(row["high"]) - prior_close),
            abs(float(row["low"]) - prior_close),
        ) / prior_close)
    fet_24h = fc[-1] / fc[-25] - 1
    btc_24h = bc[-1] / bc[-25] - 1
    return {
        "fet_return_6h": fc[-1] / fc[-7] - 1,
        "fet_return_12h": fc[-1] / fc[-13] - 1,
        "fet_return_24h": fet_24h,
        "fet_return_48h": fc[-1] / fc[-49] - 1,
        "btc_return_6h": bc[-1] / bc[-7] - 1,
        "btc_return_12h": bc[-1] / bc[-13] - 1,
        "btc_return_24h": btc_24h,
        "fet_minus_btc_24h": fet_24h - btc_24h,
        "fet_prev_1h_volume_ratio": vols[-1] / prev_vol_median,
        "fet_prev_2h_volume_ratio": sum(vols[-2:]) / (2 * prev_vol_median),
        "fet_atr_24h_pct": sum(true_ranges) / len(true_ranges),
        "fet_close_vs_prev_48h_high": fc[-1] / max(float(r["high"]) for r in fet[-48:]) - 1,
        "fet_prev_1h_return": fc[-1] / fc[-2] - 1,
    }


def analyze_fet(data_root: Path, decisions_path: Path,
                trades_path: Path, output_root: Path) -> dict[str, Any]:
    fet_hist = load_history(data_root, "FETUSDT")
    btc_hist = load_history(data_root, "BTCUSDT")
    decisions = [r for r in _rows(decisions_path) if r["strategy_id"] == "FET"]
    trade_rows = [r for r in _rows(trades_path) if r["strategy_id"] == "FET"]
    by_id = {r["candidate_id"]: r for r in trade_rows}
    if len(by_id) != len(trade_rows):
        raise ValueError("DUPLICATE_ACCEPTED_FET_TRADE")
    if len({r["candidate_id"] for r in decisions}) != len(decisions):
        raise ValueError("DUPLICATE_FET_CANDIDATE_DECISION")
    accepted_ids = {
        r["candidate_id"] for r in decisions if r["decision"] == "ACCEPTED_MODELED_ENTRY"
    }
    if accepted_ids != set(by_id):
        raise ValueError("ACCEPTED_FET_DECISIONS_DO_NOT_MATCH_CLOSED_TRADES")

    rows = []
    for decision in decisions:
        entry_ts = int(decision["entry_ts_ms"])
        trade = by_id.get(decision["candidate_id"])
        row = {
            "candidate_id": decision["candidate_id"], "entry_ts_ms": entry_ts,
            "allocation_decision": decision["decision"],
            "allocation_reason": decision["reason"],
            "requested_gross": decision.get("requested_gross"),
            "accepted_gross": trade.get("accepted_gross") if trade else None,
            "modeled_pnl_jpy": float(trade["modeled_realized_pnl_jpy_at_exit_fx"])
            if trade else None,
            "modeled_exit_reason": trade.get("exit_reason_actual") if trade else None,
            "exit_ts_ms": trade.get("exit_ts_ms") if trade else None,
            "holding_hours": (int(trade["exit_ts_ms"]) - entry_ts) / HOUR
            if trade else None,
            "group": ("HARD_STOP" if trade and trade["exit_reason_actual"] == "FET_HARD_STOP"
                      else "OTHER_ACCEPTED" if trade else "REJECTED"),
            "features_available": True,
        }
        try:
            row["pre_entry_features"] = fet_entry_features(fet_hist, btc_hist, entry_ts)
        except ValueError as error:
            row["features_available"] = False
            row["feature_error"] = str(error)
            row["pre_entry_features"] = None
        rows.append(row)

    def stats(group: str) -> dict[str, Any]:
        matched = [r for r in rows if r["group"] == group]
        result: dict[str, Any] = {
            "count": len(matched),
            "missing_feature_count": sum(not r["features_available"] for r in matched),
            "modeled_pnl_jpy": sum(r["modeled_pnl_jpy"] or 0 for r in matched),
            "feature_ranges": {},
        }
        for feature in FEATURES:
            vals = sorted(r["pre_entry_features"][feature] for r in matched
                          if r["pre_entry_features"] is not None)
            result["feature_ranges"][feature] = {
                "count": len(vals), "min": vals[0] if vals else None,
                "median": median(vals) if vals else None,
                "max": vals[-1] if vals else None,
            }
        return result

    # Probes are specified independently of the realized FET outcomes.
    # Static retained-PnL below is an attribution diagnostic only: it cannot
    # represent the integrated portfolio after reallocation or compounding.
    probes = {
        "BTC_24H_NOT_NEGATIVE": lambda f: f["btc_return_24h"] >= 0,
        "BTC_12H_NOT_NEGATIVE": lambda f: f["btc_return_12h"] >= 0,
        "FET_6H_NOT_NEGATIVE": lambda f: f["fet_return_6h"] >= 0,
        "FET_24H_NOT_NEGATIVE": lambda f: f["fet_return_24h"] >= 0,
        "FET_RELATIVE_BTC_24H_NOT_NEGATIVE": lambda f: f["fet_minus_btc_24h"] >= 0,
        "PREVIOUS_2H_VOLUME_AT_LEAST_MEDIAN": lambda f: f["fet_prev_2h_volume_ratio"] >= 1,
        "FET_PRIOR_1H_NOT_NEGATIVE": lambda f: f["fet_prev_1h_return"] >= 0,
    }
    probe_rows = {}
    for name, allow in probes.items():
        accepted = [r for r in rows if r["group"] in ("HARD_STOP", "OTHER_ACCEPTED")
                    and r["features_available"]]
        missing = sum(r["group"] in ("HARD_STOP", "OTHER_ACCEPTED")
                      and not r["features_available"] for r in rows)
        blocked = [r for r in accepted if not allow(r["pre_entry_features"])]
        probe_rows[name] = {
            "observed_accepted_with_features": len(accepted),
            "unknown_due_to_missing_preentry_bars": missing,
            "hard_stops_blocked": sum(r["group"] == "HARD_STOP" for r in blocked),
            "other_accepted_blocked": sum(r["group"] == "OTHER_ACCEPTED" for r in blocked),
            "winners_blocked": sum((r["modeled_pnl_jpy"] or 0) > 0 for r in blocked),
            "blocked_static_pnl_jpy_NOT_COUNTERFACTUAL": sum(
                r["modeled_pnl_jpy"] or 0 for r in blocked),
        }

    result = {
        "status": "FET_PREENTRY_DIAGNOSTIC_NOT_VALIDATED_GATE",
        "lookahead_guard": "ALL_FEATURE_BARS_STRICTLY_BEFORE_ENTRY_TS",
        "source": "Aster native H1 candles and saved 10bps allocated decisions/trades",
        "sample_size_warning": "Only 3 allocated hard stops; do not optimize a gate on these alone",
        "candidate_counts": dict(Counter(r["group"] for r in rows)),
        "group_stats": {g: stats(g) for g in ("HARD_STOP", "OTHER_ACCEPTED", "REJECTED")},
        "pre_specified_gate_probes": probe_rows,
        "limitations": [
            "Probes are retrospective and use the same in-sample year",
            "Blocked static PnL is NOT shared-Gross portfolio replay",
            "No L2 actual fill verification",
        ],
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "fet-preentry-feature-audit.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True, allow_nan=False) + "\n" for row in rows))
    (output_root / "fet-preentry-summary.json").write_text(
        json.dumps(result, sort_keys=True, indent=2, allow_nan=False) + "\n")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--decisions", type=Path, required=True)
    parser.add_argument("--trades", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    result = analyze_fet(args.data_root, args.decisions, args.trades, args.output_root)
    print("FET_PREENTRY_DIAGNOSTIC:", json.dumps(result, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
