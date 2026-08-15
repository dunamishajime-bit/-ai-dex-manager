"""Trade-level regime-break diagnosis for frozen AVAX V4.

Instrumentation only. This script does not create or tune an entry rule. It
compares the exact frozen AVAX V4 trades from losing prehistory versus the
later 3Y window using signal-time context, forward path, side, and exit reason.
Post-2026-07-01 Fresh OOS is not read. Production/VPS/LIVE/order paths are
untouched and the original V4 rejection remains binding.
"""
from __future__ import annotations

import json
import os
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import research_causal_handoff_clean_sheet_v4 as v4
import research_causal_handoff_clean_sheet_v4_cached as cache

SYMBOL = "AVAX"
DATA_START = 1661990400000
PERIODS = {
    "prehistory": (DATA_START, v4.base.START_2023),
    "development": v4.base.PERIODS["development"],
    "validation": v4.base.PERIODS["validation"],
    "evaluation": v4.base.PERIODS["evaluation"],
    "later3Y": v4.base.PERIODS["combined"],
}
FEATURE_KEYS = (
    "leaderFloor12",
    "leaderMean12",
    "leaderDisagreement12",
    "avaxAlignedZ12",
    "avaxAlignedZ3",
    "lagGap12",
    "breadthSupport",
    "volRatio24to96",
    "efficiency72",
    "rangePositionSupport",
    "btcTrend72Aligned",
    "relative24Aligned",
    "relative72Aligned",
    "forwardGross1h",
    "forwardGross3h",
    "forwardGross6h",
    "forwardGross12h",
)


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def install_caches() -> None:
    # Performance only. The frozen V4 signal/lifecycle code remains unchanged.
    v4.base._ctx = cache.cached_ctx
    v4.norm_ret = cache.cached_norm_ret
    v4.raw_ret = cache.cached_raw_ret
    v4.feature = cache.cached_feature


def forward_gross(candles, index, record: dict[str, Any], hours: int) -> float | None:
    c = candles[SYMBOL]
    i = index[SYMBOL].get(int(record["entryTs"]))
    if i is None or i + hours >= len(c):
        return None
    entry = float(record["entryPrice"])
    px = float(c[i + hours]["open"])
    if entry <= 0:
        return None
    side = int(record["sideSign"])
    return side * (px / entry - 1.0) * 100.0


def enrich(candles, index, record: dict[str, Any]) -> dict[str, Any]:
    x = v4.feature(SYMBOL, candles, index, int(record["signalTs"]))
    if x is None:
        raise RuntimeError(f"MISSING_SIGNAL_CONTEXT:{record['signalTs']}")
    side = int(record["sideSign"])
    btc = side * float(x["btcZ12"])
    eth = side * float(x["ethZ12"])
    av12 = side * float(x["z12"])
    out = dict(record)
    out["entryContext"] = {
        "leaderFloor12": min(btc, eth),
        "leaderMean12": (btc + eth) / 2.0,
        "leaderDisagreement12": abs(btc - eth),
        "avaxAlignedZ12": av12,
        "avaxAlignedZ3": side * float(x["z3"]),
        "lagGap12": (btc + eth) / 2.0 - av12,
        "breadthSupport": float(x["breadth"]) if side > 0 else 1.0 - float(x["breadth"]),
        "volRatio24to96": float(x["vr"]),
        "efficiency72": float(x["eff"]),
        "rangePositionSupport": float(x["rp"]) if side > 0 else 1.0 - float(x["rp"]),
        "btcTrend72Aligned": side * float(x["btcZ72"]),
        "relative24Aligned": side * float(x["rel24"]),
        "relative72Aligned": side * float(x["rel72"]),
    }
    for h in (1, 3, 6, 12):
        out["entryContext"][f"forwardGross{h}h"] = forward_gross(candles, index, record, h)
    return out


def compound(records: list[dict[str, Any]]) -> float:
    eq = 1.0
    for r in records:
        eq *= max(0.001, 1.0 + float(r["netReturnPct"]) / 100.0)
    return (eq - 1.0) * 100.0


def pf(records: list[dict[str, Any]]) -> float | None:
    vals = [float(r["netReturnPct"]) for r in records]
    win = sum(v for v in vals if v > 0)
    loss = abs(sum(v for v in vals if v < 0))
    if loss <= 1e-12:
        return 999.0 if win > 0 else None
    return win / loss


def context_stats(records: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in FEATURE_KEYS:
        vals = [float(r["entryContext"][key]) for r in records if r["entryContext"].get(key) is not None]
        out[key] = {"median": median(vals), "mean": mean(vals), "n": len(vals)}
    return out


def group_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    wins = [r for r in records if float(r["netReturnPct"]) > 0]
    losses = [r for r in records if float(r["netReturnPct"]) <= 0]
    exits = Counter(str(r["exitReason"]) for r in records)
    exit_pnl: dict[str, float] = defaultdict(float)
    for r in records:
        exit_pnl[str(r["exitReason"])] += float(r["netReturnPct"])
    sides = {}
    for name in ("LONG", "SHORT"):
        rows = [r for r in records if r["side"] == name]
        sides[name] = {
            "trades": len(rows),
            "returnPctPoints": sum(float(r["netReturnPct"]) for r in rows),
            "winRatePct": 100.0 * sum(float(r["netReturnPct"]) > 0 for r in rows) / len(rows) if rows else None,
        }
    return {
        "trades": len(records),
        "returnPct": compound(records),
        "pf": pf(records),
        "winRatePct": 100.0 * len(wins) / len(records) if records else None,
        "medianTradePct": median([float(r["netReturnPct"]) for r in records]),
        "medianMfePct": median([float(r["mfePct"]) for r in records]),
        "medianMaePct": median([float(r["maePct"]) for r in records]),
        "exitReasonCounts": dict(exits),
        "exitReasonReturnPctPoints": dict(exit_pnl),
        "sides": sides,
        "allEntryContext": context_stats(records),
        "winnerEntryContext": context_stats(wins),
        "loserEntryContext": context_stats(losses),
    }


def delta(pre: dict[str, Any], later: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for key in FEATURE_KEYS:
        a = pre["allEntryContext"][key]["median"]
        b = later["allEntryContext"][key]["median"]
        out[key] = None if a is None or b is None else float(b) - float(a)
    return out


def main() -> None:
    install_caches()
    candles, index, _ = v4.base.v109.b.base.load()
    period_records: dict[str, list[dict[str, Any]]] = {}
    summaries: dict[str, Any] = {}
    for label, (start, end) in PERIODS.items():
        raw = v4.simulate(SYMBOL, candles, index, start, end, v4.NORMAL_BPS, 0)
        rows = [enrich(candles, index, r) for r in raw]
        period_records[label] = rows
        summaries[label] = group_summary(rows)

    out = {
        "researchLine": "AVAX_V4_REGIME_BREAK_DIAGNOSIS",
        "researchOnly": True,
        "productionChanged": False,
        "vpsChanged": False,
        "liveChanged": False,
        "realTradingEnabled": False,
        "symbol": SYMBOL,
        "architecture": v4.ARCH[SYMBOL],
        "v4LogicFrozen": True,
        "originalV4GateStillBinding": True,
        "freshOosRead": False,
        "post20260701DataUsed": False,
        "newEntryDesigned": False,
        "candidateThresholdsDerived": False,
        "parameterSearch": False,
        "periods": PERIODS,
        "summaries": summaries,
        "laterMinusPrehistoryMedianDelta": delta(summaries["prehistory"], summaries["later3Y"]),
        "interpretationRule": "Use only to identify causal regime differences. Do not turn observed feature separation into a threshold in this same run.",
    }
    root = Path(os.environ.get("RESEARCH_STATE_DIR", ".research-state")); root.mkdir(parents=True, exist_ok=True)
    (root / "avax-v4-regime-break-diagnosis.json").write_text(json.dumps(out, indent=2, sort_keys=True), encoding="utf-8")
    with (root / "avax-v4-regime-break-diagnosis-trades.jsonl").open("w", encoding="utf-8") as fh:
        for label in ("prehistory", "development", "validation", "evaluation"):
            for r in period_records[label]:
                row = dict(r); row["period"] = label
                fh.write(json.dumps(row, sort_keys=True) + "\n")
    lines = ["# AVAX V4 Regime-break Diagnosis", "", "Frozen architecture: SYNCHRONIZED_MARKET_CATCHUP_12H", ""]
    for label in ("prehistory", "development", "validation", "evaluation", "later3Y"):
        s = summaries[label]
        lines.append(f"- {label}: trades={s['trades']} return={s['returnPct']:.2f}% PF={s['pf']} win={s['winRatePct']}% exits={s['exitReasonCounts']}")
    lines += ["", "## Later 3Y minus prehistory median entry-context deltas"]
    for key, value in out["laterMinusPrehistoryMedianDelta"].items():
        lines.append(f"- {key}: {value}")
    lines += ["", "Instrumentation only. No threshold is derived here. Original V4 rejection remains binding; Fresh OOS not read."]
    (root / "avax-v4-regime-break-diagnosis.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
