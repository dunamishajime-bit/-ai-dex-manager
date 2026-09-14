from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from pathlib import Path
from typing import Any, Callable, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
import research_current_top2_pengu_v52_dca as sim

UTC = dt.timezone.utc
NORMAL_STOCK_COST = float(sim.SCENARIOS["NORMAL"]["stockCostBps"])
SEVERE_STOCK_COST = float(sim.SCENARIOS["SEVERE"]["stockCostBps"])


def f(v: Any, default: float = 0.0) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return x if math.isfinite(x) else default


def metrics(values: Sequence[float]) -> dict:
    equity = peak = 1.0
    max_dd = 0.0
    gp = gl = 0.0
    for v in values:
        equity *= max(1e-9, 1.0 + v)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        if v > 0:
            gp += v
        else:
            gl -= v
    return {
        "trades": len(values),
        "returnPct": (equity - 1.0) * 100.0,
        "profitFactor": gp / gl if gl > 0 else (999.0 if gp > 0 else None),
        "winRatePct": (sum(v > 0 for v in values) / len(values) * 100.0) if values else 0.0,
        "maxDrawdownPct": max_dd * 100.0,
        "sumReturnPct": sum(values) * 100.0,
    }


def month(ts: int) -> str:
    return dt.datetime.fromtimestamp(int(ts) / 1000, tz=UTC).strftime("%Y-%m")


def bucket(ts: int) -> str:
    m = month(ts)
    if m <= "2025-11":
        return "EARLY_2025AUG_NOV"
    if m <= "2026-03":
        return "MID_2025DEC_2026MAR"
    return "LATE_2026APR_JUL"


def trade_key(t: dict) -> tuple:
    return (str(t.get("side")), int(t.get("signalTs", -1)), int(t.get("entryTs", -1)))


def pengu_value(t: dict) -> float:
    return f(t.get("requestedGross")) * f(t.get("netUnitReturn"))


def pengu_summary(rows: Sequence[dict]) -> dict:
    values = [pengu_value(t) for t in rows]
    return {
        **metrics(values),
        "hard": sum(t.get("exitReason") == "hard" for t in rows),
        "trail": sum(t.get("exitReason") == "trail" for t in rows),
        "time": sum(t.get("exitReason") == "time" for t in rows),
        "hardLossSumPct": sum(pengu_value(t) for t in rows if t.get("exitReason") == "hard") * 100.0,
        "trailSumPct": sum(pengu_value(t) for t in rows if t.get("exitReason") == "trail") * 100.0,
    }


def feat(t: dict, key: str) -> float:
    return f((t.get("signalFeatures") or {}).get(key), float("nan"))


def finite(v: float) -> bool:
    return math.isfinite(v)


def analyze_pengu(pengu: dict) -> dict:
    normal_all = list(pengu["modes"]["normal"]["trades"])
    stress_all = list(pengu["modes"]["stress"]["trades"])
    normal = [t for t in normal_all if t.get("side") == "S"]
    stress = [t for t in stress_all if t.get("side") == "S"]
    stress_by_key = {trade_key(t): t for t in stress}

    # These are structural, entry-known gates anchored to the existing production
    # eligibility boundaries. They are intentionally few and coarse; this is not
    # a threshold grid search.
    predicates: dict[str, Callable[[dict], bool]] = {
        "REQUIRE_72H_LE_M10": lambda t: finite(feat(t, "penguReturn72h")) and feat(t, "penguReturn72h") > -0.10,
        "REQUIRE_REL24_LE_M05": lambda t: finite(feat(t, "relativeReturn24h")) and feat(t, "relativeReturn24h") > -0.05,
        "REQUIRE_BTC24_NONPOS": lambda t: finite(feat(t, "btcReturn24h")) and feat(t, "btcReturn24h") > 0.0,
        "REQUIRE_VOL_GE_075": lambda t: finite(feat(t, "volumeRatio6OverPrior36")) and feat(t, "volumeRatio6OverPrior36") < 0.75,
        "REQUIRE_RSI_LE_45": lambda t: finite(feat(t, "rsi14")) and feat(t, "rsi14") > 45.0,
        "REQUIRE_ATR_LE_035": lambda t: finite(feat(t, "atr24Ratio")) and feat(t, "atr24Ratio") > 0.035,
        "DEEP72_AND_REL24": lambda t: (
            (finite(feat(t, "penguReturn72h")) and feat(t, "penguReturn72h") > -0.10)
            or (finite(feat(t, "relativeReturn24h")) and feat(t, "relativeReturn24h") > -0.05)
        ),
        "DEEP72_REL24_BTC": lambda t: (
            (finite(feat(t, "penguReturn72h")) and feat(t, "penguReturn72h") > -0.10)
            or (finite(feat(t, "relativeReturn24h")) and feat(t, "relativeReturn24h") > -0.05)
            or (finite(feat(t, "btcReturn24h")) and feat(t, "btcReturn24h") > 0.0)
        ),
    }
    baseline = pengu_summary(normal)
    baseline_buckets = {b: pengu_summary([t for t in normal if bucket(t["entryTs"]) == b]) for b in sorted({bucket(t["entryTs"]) for t in normal})}
    candidates = {}
    for name, reject in predicates.items():
        kept = [t for t in normal if not reject(t)]
        dropped = [t for t in normal if reject(t)]
        kept_keys = {trade_key(t) for t in kept}
        stress_kept = [stress_by_key[k] for k in kept_keys if k in stress_by_key]
        by_bucket = {}
        for b in baseline_buckets:
            src = [t for t in normal if bucket(t["entryTs"]) == b]
            dst = [t for t in kept if bucket(t["entryTs"]) == b]
            by_bucket[b] = {
                "baseline": pengu_summary(src),
                "filtered": pengu_summary(dst),
                "returnDeltaPct": pengu_summary(dst)["returnPct"] - pengu_summary(src)["returnPct"],
            }
        candidates[name] = {
            "normal": pengu_summary(kept),
            "stress": pengu_summary(stress_kept),
            "dropped": len(dropped),
            "droppedHard": sum(t.get("exitReason") == "hard" for t in dropped),
            "droppedTrail": sum(t.get("exitReason") == "trail" for t in dropped),
            "droppedTime": sum(t.get("exitReason") == "time" for t in dropped),
            "droppedKeys": [list(trade_key(t)) for t in dropped],
            "buckets": by_bucket,
        }
    # Descriptive hard/trail feature means only; never used directly as a rule.
    feature_names = ["penguReturn24h", "penguReturn72h", "btcReturn24h", "relativeReturn24h", "btcEma168Distance", "volumeRatio6OverPrior36", "atr24Ratio", "rsi14"]
    feature_compare = {}
    for reason in ("hard", "trail", "time"):
        rr = [t for t in normal if t.get("exitReason") == reason]
        feature_compare[reason] = {
            "trades": len(rr),
            **{
                k: (sum(feat(t, k) for t in rr if finite(feat(t, k))) / max(1, sum(finite(feat(t, k)) for t in rr)))
                for k in feature_names
            },
        }
    return {
        "shortTrades": len(normal),
        "baseline": baseline,
        "baselineBuckets": baseline_buckets,
        "featureMeansByExit": feature_compare,
        "candidates": candidates,
    }


def stock_unit(raw: dict, cost: float) -> float | None:
    return sim.base.stock.unit_trade_value(raw, cost)


def analyze_v50(cache: Path) -> dict:
    v11, v50, _days, _diag = sim.build_stock(cache)
    meta_short = [t for t in v50 if str(t.get("symbol")) == "METAUSDT" and int(t.get("side", 0)) == -1 and stock_unit(t, NORMAL_STOCK_COST) is not None]
    predicates: dict[str, Callable[[dict], bool]] = {
        "META_SHORT_NO_1130": lambda t: str(t.get("route")) == "POST_1130",
        "META_SHORT_NO_1330": lambda t: str(t.get("route")) == "POST_1330",
        "META_SHORT_ONLY_1230": lambda t: str(t.get("route")) != "POST_1230",
        "META_SHORT_BASIS_CAP_120": lambda t: abs(f(t.get("entryBasisBps"))) > 120.0,
        "META_SHORT_BASIS_CAP_140": lambda t: abs(f(t.get("entryBasisBps"))) > 140.0,
    }
    def sm(rows: Sequence[dict], cost: float) -> dict:
        vals = [stock_unit(t, cost) for t in rows]
        return metrics([f(v) for v in vals if v is not None])
    candidates = {}
    for name, reject in predicates.items():
        kept = [t for t in meta_short if not reject(t)]
        dropped = [t for t in meta_short if reject(t)]
        early = [t for t in meta_short if str(t.get("day")) < "2026-01-01"]
        late = [t for t in meta_short if str(t.get("day")) >= "2026-01-01"]
        candidates[name] = {
            "normal": sm(kept, NORMAL_STOCK_COST),
            "severe": sm(kept, SEVERE_STOCK_COST),
            "dropped": len(dropped),
            "early": {"baseline": sm(early, NORMAL_STOCK_COST), "filtered": sm([t for t in early if not reject(t)], NORMAL_STOCK_COST)},
            "late": {"baseline": sm(late, NORMAL_STOCK_COST), "filtered": sm([t for t in late if not reject(t)], NORMAL_STOCK_COST)},
            "droppedKeys": [[str(t.get("symbol")), int(t.get("entryTs", -1)), int(t.get("exitTs", -1))] for t in dropped],
        }
    return {
        "shortTrades": len(meta_short),
        "baselineNormal": sm(meta_short, NORMAL_STOCK_COST),
        "baselineSevere": sm(meta_short, SEVERE_STOCK_COST),
        "candidates": candidates,
    }


def analyze_v12(v12: dict) -> dict:
    rows = list(v12["modes"]["normal"]["trades"])
    longs = [t for t in rows if str(t.get("side")) == "long"]
    shorts = [t for t in rows if str(t.get("side")) == "short"]
    def sm(rr: Sequence[dict]) -> dict:
        return metrics([f(t.get("requestedGross")) * f(t.get("netUnitReturn")) for t in rr])
    by_symbol = {}
    for symbol in sorted({str(t.get("symbol")) for t in longs}):
        rr = [t for t in longs if str(t.get("symbol")) == symbol]
        by_symbol[symbol] = sm(rr)
    return {
        "long": sm(longs),
        "short": sm(shorts),
        "longRank1": sm([t for t in longs if int(t.get("rank", 1)) == 1]),
        "longRank2": sm([t for t in longs if int(t.get("rank", 1)) == 2]),
        "longBySymbol": by_symbol,
        "interpretation": "Diagnostic only. Current frozen V12 ledger does not retain the complete entry feature vector, so no symbol blacklist or hindsight exit-based V12 filter is eligible for promotion from this stage.",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pengu", required=True)
    ap.add_argument("--v12", required=True)
    ap.add_argument("--stock-cache", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    pengu = json.loads(Path(args.pengu).read_text())
    v12 = json.loads(Path(args.v12).read_text())
    payload = {
        "status": "PASS_RESEARCH_ONLY",
        "schema": "weak-month-a-entry-known-diagnostics/v1",
        "method": {
            "principle": "Only features known at signal/entry are tested. Exit reason is diagnostic label only, never a live predicate.",
            "penguCandidateCount": 8,
            "v50MetaCandidateCount": 5,
            "thresholdPolicy": "small predeclared structural set; no continuous grid search",
        },
        "pengu": analyze_pengu(pengu),
        "v50Meta": analyze_v50(Path(args.stock_cache)),
        "v12": analyze_v12(v12),
        "safety": {"mode":"RESEARCH_ONLY","ordersSent":False,"liveChanged":False,"vpsChanged":False,"productionChanged":False},
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
