from __future__ import annotations

import argparse
import datetime
import json
import os
from pathlib import Path

import research_lab_parallel_event_regime_v53 as base
import research_lab_distinct_logic_tournament_v56 as tournament

DAY = 24 * base.HOUR
YEAR = 365 * DAY
FAMILIES = [
    "trend_breakout",
    "shock_mean_reversion",
    "rs_rotation",
    "residual_statarb",
    "carry_hedged",
    "crash_rebound",
    "session_opening_range",
    "compression_expansion",
    "lead_lag",
    "orderflow_depth",
    "pair_cointegration",
    "breadth_capitulation",
]
EXPECTED = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]


def iso(ts: int) -> str:
    return datetime.datetime.fromtimestamp(ts / 1000, tz=datetime.timezone.utc).isoformat()


def common_window(candles):
    symbols = list(base.SYMS)
    if symbols != EXPECTED:
        raise RuntimeError(f"Universe mismatch: expected {EXPECTED}, got {symbols}")
    first = max(int(candles[s][0]["ts"]) for s in symbols if candles[s])
    latest = min(int(candles[s][-1]["ts"]) for s in symbols if candles[s])
    start = latest - YEAR
    if start < first:
        raise RuntimeError(
            f"Insufficient common 365d history: common_first={iso(first)} common_latest={iso(latest)}"
        )
    # [start, end) boundaries. Latest candle itself is retained as a safety endpoint,
    # so end is one hour beyond the latest common timestamp.
    end = latest + base.HOUR
    span = end - start
    d1 = start + int(span * 0.50)
    d2 = start + int(span * 0.70)
    d3 = start + int(span * 0.85)
    return {
        "start": start,
        "development": (start, d1),
        "validation": (d1, d2),
        "confirmation": (d2, d3),
        "holdout": (d3, end),
        "end": end,
        "latestCommonCandle": latest,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--family", required=True, choices=FAMILIES)
    args = ap.parse_args()

    candles, idx, fby = base.load()
    w = common_window(candles)
    periods = {
        "development": w["development"],
        "validation": w["validation"],
        "confirmation": w["confirmation"],
        "holdout": w["holdout"],
    }
    # V56 reads its own imported PERIODS object. Replace only inside this research process.
    tournament.PERIODS = periods

    result = tournament.evaluate_family(args.family, candles, idx, fby)
    result.update(
        {
            "strategyId": "SIX_PAIR_ROLLING_1Y_V57",
            "family": args.family,
            "universe": ["BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "LINK/USDT", "AVAX/USDT"],
            "historyPolicy": "latest common genuine 365d only",
            "latestCommonCandleUtc": iso(w["latestCommonCandle"]),
            "historyStartUtc": iso(w["start"]),
            "historyEndExclusiveUtc": iso(w["end"]),
            "split": {
                k: {"startUtc": iso(a), "endExclusiveUtc": iso(b)}
                for k, (a, b) in periods.items()
            },
            "normalRoundTripBps": tournament.NORMAL_BPS,
            "stressRoundTripBps": tournament.STRESS_BPS,
            "stressDelayHours": 1,
            "selectionRule": "representative params -> Development -> Validation only; Confirmation/Holdout never tune params",
            "productionChanged": False,
            "realTradingEnabled": False,
            "limitations": [
                "Exactly six fixed pairs; no post-result symbol substitution.",
                "Only genuine cached public USD-M OHLCV/funding is used.",
                "Long historical order-flow/depth is DATA_UNAVAILABLE rather than synthesized.",
                "This wrapper changes only chronology/universe assertions; V56 economic mechanisms and gates remain frozen for comparability.",
            ],
        }
    )

    out = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state"))
    out.mkdir(parents=True, exist_ok=True)
    stem = f"six-pair-rolling-1y-v57-{args.family}"
    (out / f"{stem}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (out / f"{stem}.md").write_text(
        f"# Six Pair Rolling 1Y V57 — {args.family}\n\n"
        f"- Status: **{result['status']}**\n"
        f"- Robust: **{result['robust']}**\n"
        f"- History: {result['historyStartUtc']} -> {result['historyEndExclusiveUtc']}\n\n"
        f"```json\n{json.dumps(result, indent=2)}\n```\n",
        encoding="utf-8",
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
