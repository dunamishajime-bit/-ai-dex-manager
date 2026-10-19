#!/usr/bin/env python3
"""Research-only frozen Idle SHORT entry-filter replay, 2026-10-19.

Inputs are the independently preserved historical 61 accepted Idle intents, 61
10bps net trade returns, and 393 causal pre-entry feature rows. No hindsight
outcomes influence any admission. A filtered accepted intent is NOT reallocated
to a baseline strategy, nor are rejected candidates rediscovered.

IMPORTANT: does NOT compute formal integrated portfolio equity or H1 MTM DD.
Only reports gross-weighted normalized trade-return attribution, trade PF, and
causal non-price-dependent entry veto effects. 10/20/30bps sensitivity is modeled
by subtracting (new-roundtrip-cost - 10bps) * requested Gross.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HOUR = 3_600_000
HOLDOUT_START_MS = int(datetime(2026, 5, 1, tzinfo=timezone.utc).timestamp() * 1000)
EXPECTED_INTENTS = 61
EXPECTED_WINNERS = 48
HARD_STOP_PRICE_RETURN = .10
LOW_GROSS_SYMBOLS = {"DOTUSDT", "RENDERUSDT"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(root: Path) -> list[dict]:
    intents_path = root / "research/idle_priority_61_intents.json"
    returns_path = root / "research/idle_priority_61_target_net.json"
    features_path = root / "research/idle_priority_393_generic_candidate_features.csv"
    intents = json.loads(intents_path.read_text(encoding="utf-8"))
    target = json.loads(returns_path.read_text(encoding="utf-8"))
    with features_path.open("r", newline="", encoding="utf-8-sig") as source:
        comment = next(source)
        if not comment.startswith("# source idle_candidate_events.csv"):
            raise ValueError("unexpected feature source")
        features = {
            (f["symbol"], int(f["t"])): f
            for f in csv.DictReader(source)
        }
    if len(intents) != EXPECTED_INTENTS or len(target) != EXPECTED_INTENTS:
        raise ValueError("frozen 61-intent fixture mismatch")
    result: list[dict] = []
    for intent, ret in zip(intents, target):
        symbol = str(intent["symbol"])
        t = int(intent["entry_ts_ms"])
        feature = features.get((symbol, t))
        if feature is None or feature["side"] != "SHORT":
            raise ValueError(f"pre-entry feature/side absent for {symbol} {t}")
        item = dict(intent)
        item["gross"] = .25 if symbol in LOW_GROSS_SYMBOLS else 1.0
        item["return_10bps"] = float(ret)
        item["atr_ratio"] = float(feature["atr_ratio"])
        item["ret12"] = float(feature["ret12"])
        item["ret24"] = float(feature["ret24"])
        item["rel24"] = float(feature["rel24"])
        item["btc24"] = item["ret24"] - item["rel24"]
        item["vol_ratio"] = float(feature["vol_ratio"])
        result.append(item)
    if sum(x["return_10bps"] > 0 for x in result) != EXPECTED_WINNERS:
        raise ValueError("expected 48 wins among 61 historical intents")
    return sorted(result, key=lambda x: (int(x["entry_ts_ms"]), x["symbol"]))


def summarize(trades: list[dict], cost_bps: int) -> dict:
    vals = [
        x["gross"] * (x["return_10bps"] - (cost_bps - 10) / 10_000)
        for x in trades
    ]
    gross_profit = sum(x for x in vals if x > 0)
    gross_loss = -sum(x for x in vals if x < 0)
    return {
        "trades": len(vals),
        "wins": sum(x > 0 for x in vals),
        "win_rate_pct": round(100 * sum(x > 0 for x in vals) / len(vals), 3) if vals else None,
        "pf": round(gross_profit / gross_loss, 4) if gross_loss else None,
        "weighted_sum_return_pct": round(100 * sum(vals), 4),
        "mean_weighted_return_pct": round(100 * sum(vals) / len(vals), 4) if vals else None,
    }


def replay(trades: list[dict], *, atr_ceiling: float = float("inf"),
           gross_cap: float = float("inf"), max_positions: int = 99,
           one_per_h1: bool = False, entry_gap_hours: int = 0) -> dict:
    active: list[dict] = []
    accepted: list[dict] = []
    rejected: list[dict] = []
    last_accepted_ms = -10**18
    accepted_by_h1: Counter[int] = Counter()
    highest_open_gross = 0.0
    for item in trades:
        now = int(item["entry_ts_ms"])
        active = [pos for pos in active if int(pos["exit_ts_ms"]) > now]
        current_gross = sum(pos["gross"] for pos in active)
        reason = None
        if item["atr_ratio"] > atr_ceiling:
            reason = "ATR_OVERHEAT"
        elif one_per_h1 and accepted_by_h1[now // HOUR]:
            reason = "SAME_H1_EXTRA_SHORT"
        elif now - last_accepted_ms < entry_gap_hours * HOUR:
            reason = "ENTRY_GAP"
        elif len(active) >= max_positions:
            reason = "POSITION_SLOTS"
        elif current_gross + item["gross"] > gross_cap + 1e-12:
            reason = "IDLE_SHORT_BASKET_GROSS"
        if reason:
            rejected.append({**item, "reason": reason})
        else:
            accepted.append(item)
            active.append(item)
            last_accepted_ms = now
            accepted_by_h1[now // HOUR] += 1
            highest_open_gross = max(highest_open_gross, current_gross + item["gross"])
    in_sample = [x for x in accepted if int(x["entry_ts_ms"]) < HOLDOUT_START_MS]
    hold = [x for x in accepted if int(x["entry_ts_ms"]) >= HOLDOUT_START_MS]
    return {
        "10bps": summarize(accepted, 10),
        "20bps": summarize(accepted, 20),
        "30bps": summarize(accepted, 30),
        "pre_may_2026": summarize(in_sample, 10),
        "may_2026_onward": summarize(hold, 10),
        "highest_open_gross": round(highest_open_gross, 4),
        "nominal_10pct_stop_loss_risk_pct_of_equity": round(highest_open_gross * HARD_STOP_PRICE_RETURN * 100, 3),
        "excluded": [
            {
                "symbol": x["symbol"],
                "entry_ts_ms": x["entry_ts_ms"],
                "gross_weighted_10bps_return_pct": round(x["gross"] * x["return_10bps"] * 100, 4),
                "reason": x["reason"],
            } for x in rejected
        ],
    }


VARIANTS = {
    "BASE": {},
    "ONE_PER_H1": {"one_per_h1": True},
    "MAX_2_OPEN": {"max_positions": 2},
    "MAX_2_GROSS": {"gross_cap": 2.0},
    "MAX_1_5_GROSS": {"gross_cap": 1.5},
    "MAX_1_GROSS": {"gross_cap": 1.0},
    "ENTRY_GAP_6H": {"entry_gap_hours": 6},
    "ENTRY_GAP_24H": {"entry_gap_hours": 24},
    "ATR_2_5_PCT": {"atr_ceiling": .025},
    "ATR_2_7_PCT": {"atr_ceiling": .027},
    "ATR_2_5_ONE_H1": {"atr_ceiling": .025, "one_per_h1": True},
    "ATR_2_5_GROSS_1_5": {"atr_ceiling": .025, "gross_cap": 1.5},
    "ATR_2_5_GROSS_2": {"atr_ceiling": .025, "gross_cap": 2.0},
    "ATR_2_5_ONE_H1_GROSS_2": {"atr_ceiling": .025, "one_per_h1": True, "gross_cap": 2.0},
    "ATR_2_7_ONE_H1_GROSS_2": {"atr_ceiling": .027, "one_per_h1": True, "gross_cap": 2.0},
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.repo_root
    trades = load(root)
    proof = {
        name: sha256(root / name) for name in (
            "research/idle_priority_61_intents.json",
            "research/idle_priority_61_target_net.json",
            "research/idle_priority_393_generic_candidate_features.csv",
        )
    }
    print(json.dumps({
        "status": "FROZEN_ACCEPTED_INTENT_REPLAY_NOT_CAUSAL_INTEGRATED_BT",
        "source_files_sha256": proof,
        "baseline_candidate_count": len(trades),
        "baseline_historical_wins": EXPECTED_WINNERS,
        "holdout_start_utc": "2026-05-01T00:00:00Z",
        "source_cost_bps": 10,
        "limitations": [
            "Accepted-intents only: does not rediscover baseline core entries after an Idle veto.",
            "No hourly mark-to-market equity, maximum drawdown or portfolio final asset.",
            "No signed current unrealized PnL or STOP readback at historical entry times.",
            "No 5m entry timing, latency, margin filter or new live October order event in historical annual data.",
            "ATR gate evaluated against an inspected historical set; untouched validation with triggered signals is required.",
            "Nominal STOP budget assumes initial 10% stop/price and excludes gap/slippage.",
        ],
        "variants": {name: replay(trades, **options) for name, options in VARIANTS.items()},
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
