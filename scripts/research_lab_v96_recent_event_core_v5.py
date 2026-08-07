from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_ROOT = REPO_ROOT / ".research-base"
sys.path.insert(0, str(RESEARCH_ROOT / "scripts"))

import research_lab_v96_recent_event_core_v2 as v2

START_MS = v2.START_MS
END_MS = v2.END_MS
F1_MS = v2.FOLD1_END_MS
F2_MS = v2.FOLD2_END_MS
F3_MS = v2.FOLD3_END_MS
BAR_HOURS = v2.BAR_HOURS
BAR_MS = v2.BAR_MS
GROSS = v2.GROSS
CACHE_ROOT = Path.cwd() / ".cache" / "perp-research-usdm"
BENCHMARK_RETURN = 86.139242

_original_loader = v2.core.load_aster_symbol
_original_momentum = v2.momentum
_original_sma = v2.sma
_original_volume_ratio = v2.volume_ratio
_original_prior_low = v2.prior_low
_original_signal = v2.signal
_feature_cache: Dict[Tuple[Any, ...], Any] = {}
_funding_cache: Dict[int, Dict[int, float]] = {}


def _loader(symbol: str):
    return _original_loader(CACHE_ROOT, symbol)


def _mom(rows, idx: int, bars: int):
    key = ("m", id(rows), idx, bars)
    if key not in _feature_cache:
        _feature_cache[key] = _original_momentum(rows, idx, bars)
    return _feature_cache[key]


def _sma(rows, idx: int, bars: int):
    key = ("s", id(rows), idx, bars)
    if key not in _feature_cache:
        _feature_cache[key] = _original_sma(rows, idx, bars)
    return _feature_cache[key]


def _vol(rows, idx: int, recent: int = 8, base: int = 32):
    key = ("v", id(rows), idx, recent, base)
    if key not in _feature_cache:
        _feature_cache[key] = _original_volume_ratio(rows, idx, recent, base)
    return _feature_cache[key]


def _low(rows, idx: int, bars: int):
    key = ("l", id(rows), idx, bars)
    if key not in _feature_cache:
        _feature_cache[key] = _original_prior_low(rows, idx, bars)
    return _feature_cache[key]


def _funding(points, ts: int) -> float:
    key = id(points)
    buckets = _funding_cache.get(key)
    if buckets is None:
        buckets = {}
        for row in points:
            point_ts = int(row["ts"])
            bucket = point_ts // BAR_MS * BAR_MS
            buckets[bucket] = buckets.get(bucket, 0.0) + float(row["rate"])
        _funding_cache[key] = buckets
    return buckets.get(ts, 0.0)


v2.core.load_aster_symbol = _loader
v2.momentum = _mom
v2.sma = _sma
v2.volume_ratio = _vol
v2.prior_low = _low
v2.funding_for_bar = _funding


@dataclass(frozen=True)
class Refine:
    refine_id: str
    relative_weakness_min: float
    volume_floor: float
    stop_pct: float
    profit_lock_pct: float


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rounded(v) for v in value]
    return value


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return fallback
    return x if math.isfinite(x) else fallback


def compound(values: Iterable[float]) -> float:
    eq = 1.0
    for value in values:
        eq *= max(0.001, 1.0 + float(value))
    return eq - 1.0


def aggressive_pre_score(windows: dict) -> dict:
    normals = [windows[name]["normal"] for name in ("fold1", "fold2", "fold3")]
    severes = [windows[name]["severe"] for name in ("fold1", "fold2", "fold3")]
    pre = compound([finite(x["compoundedReturnPct"]) / 100.0 for x in normals]) * 100.0
    pre_s = compound([finite(x["compoundedReturnPct"]) / 100.0 for x in severes]) * 100.0
    pos = sum(finite(x["compoundedReturnPct"]) > 0 for x in normals)
    pos_s = sum(finite(x["compoundedReturnPct"]) > 0 for x in severes)
    trades = sum(int(x["tradeEpisodes"]) for x in normals)
    worst_dd = min(finite(x["maxDrawdownPct"], -99.0) for x in normals)
    avg_pf = sum(min(5.0, finite(x.get("profitFactor"))) for x in normals) / 3.0
    eligible = bool(
        trades >= 15
        and pos == 3
        and pos_s >= 2
        and pre >= 35.0
        and pre_s >= 8.0
        and worst_dd >= -15.0
        and avg_pf >= 1.10
    )
    score = pre + 0.55 * pre_s + 4.0 * (pos + pos_s) + 4.0 * max(0.0, avg_pf - 1.0) - 0.18 * abs(worst_dd) if eligible else -1e12
    return {
        "eligible": eligible,
        "score": score,
        "compoundedReturnPct": pre,
        "severeCompoundedReturnPct": pre_s,
        "positiveFolds": pos,
        "positiveSevereFolds": pos_s,
        "tradeEpisodes": trades,
        "worstFoldDrawdownPct": worst_dd,
        "averageFoldProfitFactor": avg_pf,
    }


def windows_for(rows, entries, severe_rows, severe_entries):
    ranges = {
        "fold1": (START_MS, F1_MS),
        "fold2": (F1_MS, F2_MS),
        "fold3": (F2_MS, F3_MS),
        "lateEvaluation": (F3_MS, END_MS),
        "full": (START_MS, END_MS),
    }
    return {
        name: {
            "normal": v2.metrics(rows, entries, start, end),
            "severe": v2.metrics(severe_rows, severe_entries, start, end),
        }
        for name, (start, end) in ranges.items()
    }


def coarse_configs() -> List[v2.EventConfig]:
    result = []
    for lookback in (8, 10, 12, 14):
        for threshold in (5.0, 6.0, 7.0, 8.0, 10.0):
            for confirm in (0.50, 0.75, 1.00, 1.25, 1.50):
                for hold in (48, 60, 72, 84, 96):
                    result.append(v2.EventConfig(
                        f"V5_L{lookback}_T{threshold:g}_C{confirm:g}_H{hold}",
                        "SHORT_PULLBACK", lookback, threshold, confirm, hold,
                        confirm_hours=6,
                    ))
    return result


def evaluate_plain(cfg: v2.EventConfig, market: dict):
    normal, entries = v2.simulate(cfg, market, False)
    severe, severe_entries = v2.simulate(cfg, market, True)
    windows = windows_for(normal, entries, severe, severe_entries)
    return {
        "variantId": cfg.config_id,
        "config": asdict(cfg),
        "preSelection": aggressive_pre_score(windows),
        **windows,
    }, normal, severe


def relative_at_signal(symbol: str, ts: int, seed: v2.EventConfig, market: dict) -> Optional[float]:
    idx = market["indexes"][symbol].get(ts)
    bidx = market["indexes"]["BTC"].get(ts)
    if idx is None or bidx is None:
        return None
    bars = int(seed.lookback_days * 24 / BAR_HOURS)
    move = v2.momentum(market["bars"][symbol], idx, bars)
    btc_move = v2.momentum(market["bars"]["BTC"], bidx, bars)
    if move is None or btc_move is None:
        return None
    return move - btc_move


def refined_signal(seed: v2.EventConfig, refine: Refine, ts: int, market: dict):
    item = _original_signal(seed, ts, market)
    if item is None:
        return None
    symbol, side, meta = item
    idx = market["indexes"][symbol].get(ts)
    if idx is None:
        return None
    relative = relative_at_signal(symbol, ts, seed, market)
    vol = v2.volume_ratio(market["bars"][symbol], idx)
    if relative is None or vol is None:
        return None
    if relative > -refine.relative_weakness_min:
        return None
    if vol < refine.volume_floor:
        return None
    return symbol, side, {**meta, "relativePct": relative, "volumeRatio": vol}


def evaluate_refined(seed: v2.EventConfig, refine: Refine, market: dict):
    cfg = replace(seed, stop_pct=refine.stop_pct, profit_lock_pct=refine.profit_lock_pct)
    old_signal = v2.signal
    try:
        v2.signal = lambda _cfg, ts, data: refined_signal(seed, refine, ts, data)
        normal, entries = v2.simulate(cfg, market, False)
        severe, severe_entries = v2.simulate(cfg, market, True)
    finally:
        v2.signal = old_signal
    windows = windows_for(normal, entries, severe, severe_entries)
    variant_id = f"{seed.config_id}__RW{refine.relative_weakness_min:g}_V{refine.volume_floor:g}_S{refine.stop_pct:g}_P{refine.profit_lock_pct:g}"
    return {
        "variantId": variant_id,
        "seedConfig": asdict(seed),
        "refine": asdict(refine),
        "effectiveConfig": asdict(cfg),
        "preSelection": aggressive_pre_score(windows),
        **windows,
    }, normal, severe


def compact(row: dict) -> dict:
    return {k: row[k] for k in row if k in ("variantId", "config", "seedConfig", "refine", "effectiveConfig", "preSelection", "fold1", "fold2", "fold3", "lateEvaluation", "full")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/v96-recent-event-core-v5")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    market = v2.load_market()

    coarse_rows = []
    coarse_replay = {}
    for cfg in coarse_configs():
        row, normal, severe = evaluate_plain(cfg, market)
        coarse_rows.append(row)
        coarse_replay[row["variantId"]] = (normal, severe)
    coarse_eligible = sorted(
        (row for row in coarse_rows if row["preSelection"]["eligible"]),
        key=lambda row: (row["preSelection"]["score"], row["variantId"]),
        reverse=True,
    )
    seeds = []
    cfg_map = {cfg.config_id: cfg for cfg in coarse_configs()}
    for row in coarse_eligible[:10]:
        seeds.append(cfg_map[row["variantId"]])

    refinements = [
        Refine(f"RW{rw:g}_V{vol:g}_S{stop:g}_P{lock:g}", rw, vol, stop, lock)
        for rw in (0.0, 2.0, 4.0)
        for vol in (0.0, 0.8, 1.0)
        for stop in (0.0, 4.5, 6.0)
        for lock in (0.0, 7.5)
    ]
    refined_rows = []
    replays = {}
    for seed in seeds:
        for refine in refinements:
            row, normal, severe = evaluate_refined(seed, refine, market)
            refined_rows.append(row)
            replays[row["variantId"]] = (normal, severe)

    eligible = sorted(
        (row for row in refined_rows if row["preSelection"]["eligible"]),
        key=lambda row: (row["preSelection"]["score"], row["variantId"]),
        reverse=True,
    )
    ranked = sorted(refined_rows, key=lambda row: (row["preSelection"]["score"], row["variantId"]), reverse=True)
    selected = eligible[0] if eligible else ranked[0]
    normal, severe = replays[selected["variantId"]]
    full = selected["full"]["normal"]
    full_s = selected["full"]["severe"]
    late = selected["lateEvaluation"]["normal"]
    late_s = selected["lateEvaluation"]["severe"]
    late_pass = bool(
        int(late["tradeEpisodes"]) >= 3
        and finite(late["compoundedReturnPct"]) > 0.0
        and finite(late_s["compoundedReturnPct"]) > 0.0
        and finite(late["maxDrawdownPct"], -99.0) >= -10.0
        and finite(late.get("profitFactor")) > 1.05
    )
    beats = bool(
        finite(full["compoundedReturnPct"]) > BENCHMARK_RETURN
        and finite(full_s["compoundedReturnPct"]) > 20.0
        and finite(full["maxDrawdownPct"], -99.0) >= -15.0
        and finite(full.get("profitFactor")) > 1.20
    )
    status = "V96_RECENT_EVENT_CORE_V5_PASS" if selected["preSelection"]["eligible"] and late_pass and beats else "V96_RECENT_EVENT_CORE_V5_DIAGNOSTIC"

    coarse_full = sorted(coarse_rows, key=lambda row: finite(row["full"]["normal"]["compoundedReturnPct"], -1e12), reverse=True)
    refined_full = sorted(refined_rows, key=lambda row: finite(row["full"]["normal"]["compoundedReturnPct"], -1e12), reverse=True)
    payload = rounded({
        "version": 5,
        "strategyId": "V96_RECENT_EVENT_CORE_V5_HIGH_RETURN_SHORT_PULLBACK",
        "status": status,
        "architecture": {
            "barHours": BAR_HOURS,
            "gross": GROSS,
            "onePositionMaximum": True,
            "family": "SHORT_PULLBACK",
            "coarseSearch": "lookback/decline/rebound/hold",
            "refinement": "relative weakness / volume / close-based stop / profit-lock",
            "nextBarExecution": True,
        },
        "benchmark": {"V2FullDiagnosticBestPct": BENCHMARK_RETURN},
        "candidateCounts": {
            "coarseTested": len(coarse_rows),
            "coarseEligible": len(coarse_eligible),
            "refinedTested": len(refined_rows),
            "refinedEligible": len(eligible),
        },
        "seedIds": [cfg.config_id for cfg in seeds],
        "selected": compact(selected),
        "selectedPassesLateEvaluation": late_pass,
        "selectedBeats86p139": beats,
        "topCoarsePreSelection": [compact(row) for row in coarse_eligible[:20]],
        "topCoarseFullDiagnosticOnly": [compact(row) for row in coarse_full[:20]],
        "topRefinedPreSelection": [compact(row) for row in ranked[:20]],
        "topRefinedFullDiagnosticOnly": [compact(row) for row in refined_full[:20]],
        "selectionPolicy": {
            "coarseSeedRankingUsesOnlyFirstThreeFolds": True,
            "refinedRankingUsesOnlyFirstThreeFolds": True,
            "lateEvaluationUsedForRanking": False,
            "fullPeriodUsedForRanking": False,
            "target": "beat 86.139242% at fixed gross 0.75; DD no worse than 15%; Severe positive and >20%; late Normal/Severe positive",
        },
        "selectedReplay": {
            "strategyId": "V96_RECENT_EVENT_CORE_V5_HIGH_RETURN_SHORT_PULLBACK",
            "variantId": selected["variantId"],
            "normal": normal,
            "severe": severe,
        },
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    })
    (output / "v96-recent-event-core-v5.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V96 Recent Event Core V5 — High Return Short Pullback",
        "",
        f"- Status: **{status}**",
        f"- Coarse tested: **{len(coarse_rows)}** / eligible **{len(coarse_eligible)}**",
        f"- Refined tested: **{len(refined_rows)}** / eligible **{len(eligible)}**",
        f"- Selected: **{selected['variantId']}**",
        f"- Full: **{full['compoundedReturnPct']}%** / Severe **{full_s['compoundedReturnPct']}%** / DD **{full['maxDrawdownPct']}%** / PF **{full['profitFactor']}**",
        f"- Late: **{late['compoundedReturnPct']}%** / Severe **{late_s['compoundedReturnPct']}%** / DD **{late['maxDrawdownPct']}%** / PF **{late['profitFactor']}**",
        f"- Beats 86.139242% gate: **{beats}** / Late pass: **{late_pass}**",
        f"- Best full diagnostic refined: **{refined_full[0]['variantId']} = {refined_full[0]['full']['normal']['compoundedReturnPct']}%** (diagnostic only)",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output / "v96-recent-event-core-v5.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
