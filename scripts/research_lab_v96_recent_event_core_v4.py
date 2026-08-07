from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_ROOT = REPO_ROOT / ".research-base"
sys.path.insert(0, str(RESEARCH_ROOT / "scripts"))

import research_lab_v96_recent_event_core_v2 as v2

UTC = dt.timezone.utc
START_MS = v2.START_MS
END_MS = v2.END_MS
F1_MS = v2.FOLD1_END_MS
F2_MS = v2.FOLD2_END_MS
F3_MS = v2.FOLD3_END_MS
BAR_HOURS = v2.BAR_HOURS
BAR_MS = v2.BAR_MS
GROSS = v2.GROSS
SYMBOLS = v2.SYMBOLS
CACHE_ROOT = Path.cwd() / ".cache" / "perp-research-usdm"
V3_BENCHMARK = 67.520202

_original_loader = v2.core.load_aster_symbol
_original_momentum = v2.momentum
_original_sma = v2.sma
_original_volume_ratio = v2.volume_ratio
_original_prior_low = v2.prior_low
_original_signal = v2.signal
_original_funding = v2.funding_for_bar
_feature_cache: Dict[Tuple[Any, ...], Any] = {}
_funding_cache: Dict[int, Dict[int, float]] = {}


def _loader(symbol: str):
    return _original_loader(CACHE_ROOT, symbol)


def _memo_momentum(rows, idx: int, bars: int):
    key = ("m", id(rows), idx, bars)
    if key not in _feature_cache:
        _feature_cache[key] = _original_momentum(rows, idx, bars)
    return _feature_cache[key]


def _memo_sma(rows, idx: int, bars: int):
    key = ("s", id(rows), idx, bars)
    if key not in _feature_cache:
        _feature_cache[key] = _original_sma(rows, idx, bars)
    return _feature_cache[key]


def _memo_volume(rows, idx: int, recent: int = 8, base: int = 32):
    key = ("v", id(rows), idx, recent, base)
    if key not in _feature_cache:
        _feature_cache[key] = _original_volume_ratio(rows, idx, recent, base)
    return _feature_cache[key]


def _memo_low(rows, idx: int, bars: int):
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
v2.momentum = _memo_momentum
v2.sma = _memo_sma
v2.volume_ratio = _memo_volume
v2.prior_low = _memo_low
v2.funding_for_bar = _funding


@dataclass(frozen=True)
class LongProfile:
    profile_id: str
    breakout_days: int
    mom7_min: float
    btc7_min: float
    relative_min: float
    volume_floor: float


@dataclass(frozen=True)
class RouterConfig:
    router_id: str
    seed_id: str
    short_gate: str
    long_profile: Optional[LongProfile]


LONG_PROFILES: Tuple[Optional[LongProfile], ...] = (
    None,
    LongProfile("L5_M5_B0_R0_V08", 5, 5.0, 0.0, 0.0, 0.8),
    LongProfile("L5_M8_B4_R0_V08", 5, 8.0, 4.0, 0.0, 0.8),
    LongProfile("L10_M5_B0_R0_V08", 10, 5.0, 0.0, 0.0, 0.8),
    LongProfile("L10_M8_B4_R3_V10", 10, 8.0, 4.0, 3.0, 1.0),
)
SHORT_GATES = ("ALWAYS", "BTC_BELOW20", "BTC_MOM7_NEG", "BTC_NOT_STRONG4")


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
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + float(value))
    return equity - 1.0


def btc_context(ts: int, market: dict) -> Optional[dict]:
    idx = market["indexes"]["BTC"].get(ts)
    if idx is None:
        return None
    rows = market["bars"]["BTC"]
    mom7 = v2.momentum(rows, idx, int(7 * 24 / BAR_HOURS))
    sma20 = v2.sma(rows, idx, int(20 * 24 / BAR_HOURS))
    if mom7 is None or sma20 is None:
        return None
    close = float(rows[idx]["close"])
    return {"mom7": mom7, "above20": close > sma20}


def short_gate_open(mode: str, ctx: dict) -> bool:
    if mode == "ALWAYS":
        return True
    if mode == "BTC_BELOW20":
        return not ctx["above20"]
    if mode == "BTC_MOM7_NEG":
        return ctx["mom7"] < 0.0
    if mode == "BTC_NOT_STRONG4":
        return (not ctx["above20"]) or ctx["mom7"] < 4.0
    raise RuntimeError(mode)


def prior_high(rows: Sequence[dict], idx: int, bars: int) -> Optional[float]:
    key = ("h", id(rows), idx, bars)
    if key in _feature_cache:
        return _feature_cache[key]
    value = None if idx - bars < 0 else max(float(row["high"]) for row in rows[idx-bars:idx])
    _feature_cache[key] = value
    return value


def long_breakout(profile: LongProfile, ts: int, market: dict, ctx: dict) -> Optional[Tuple[str, int, dict]]:
    if not ctx["above20"] or ctx["mom7"] < profile.btc7_min:
        return None
    btc_idx = market["indexes"]["BTC"].get(ts)
    btc_rows = market["bars"]["BTC"]
    btc7 = v2.momentum(btc_rows, btc_idx, int(7 * 24 / BAR_HOURS))
    if btc7 is None:
        return None
    candidates = []
    for symbol in ("ETH", "BNB", "SOL", "LINK", "AVAX"):
        idx = market["indexes"][symbol].get(ts)
        if idx is None:
            continue
        rows = market["bars"][symbol]
        mom7 = v2.momentum(rows, idx, int(7 * 24 / BAR_HOURS))
        high = prior_high(rows, idx, int(profile.breakout_days * 24 / BAR_HOURS))
        vol = v2.volume_ratio(rows, idx)
        if mom7 is None or high is None or vol is None:
            continue
        relative = mom7 - btc7
        close = float(rows[idx]["close"])
        if close > high and mom7 >= profile.mom7_min and relative >= profile.relative_min and vol >= profile.volume_floor:
            score = mom7 + 0.35 * relative + 0.5 * vol
            candidates.append((score, symbol, {"signalFamily": "LONG_BREAKOUT", "mom7Pct": mom7, "relativePct": relative, "volumeRatio": vol}))
    if not candidates:
        return None
    score, symbol, meta = max(candidates, key=lambda item: (item[0], item[1]))
    return symbol, 1, {"score": score, **meta}


def router_signal(router: RouterConfig, seed: v2.EventConfig, ts: int, market: dict) -> Optional[Tuple[str, int, dict]]:
    ctx = btc_context(ts, market)
    if ctx is None:
        return None
    if short_gate_open(router.short_gate, ctx):
        item = _original_signal(seed, ts, market)
        if item is not None:
            symbol, side, meta = item
            return symbol, side, {**meta, "routerMode": "SHORT", "btcMom7Pct": ctx["mom7"], "btcAbove20": ctx["above20"]}
    if router.long_profile is not None:
        item = long_breakout(router.long_profile, ts, market, ctx)
        if item is not None:
            symbol, side, meta = item
            return symbol, side, {**meta, "routerMode": "LONG", "btcMom7Pct": ctx["mom7"], "btcAbove20": ctx["above20"]}
    return None


def simulate_router(router: RouterConfig, seed: v2.EventConfig, market: dict, severe: bool):
    old_signal = v2.signal
    try:
        v2.signal = lambda _cfg, ts, data: router_signal(router, seed, ts, data)
        return v2.simulate(seed, market, severe=severe)
    finally:
        v2.signal = old_signal


def score_from_windows(windows: dict) -> dict:
    normals = [windows[name]["normal"] for name in ("fold1", "fold2", "fold3")]
    severes = [windows[name]["severe"] for name in ("fold1", "fold2", "fold3")]
    pre = compound([finite(item["compoundedReturnPct"]) / 100.0 for item in normals]) * 100.0
    pre_s = compound([finite(item["compoundedReturnPct"]) / 100.0 for item in severes]) * 100.0
    pos = sum(finite(item["compoundedReturnPct"]) > 0 for item in normals)
    pos_s = sum(finite(item["compoundedReturnPct"]) > 0 for item in severes)
    trades = sum(int(item["tradeEpisodes"]) for item in normals)
    worst_dd = min(finite(item["maxDrawdownPct"], -99.0) for item in normals)
    avg_pf = sum(min(5.0, finite(item.get("profitFactor"))) for item in normals) / 3.0
    eligible = bool(
        trades >= 9
        and pos == 3
        and pos_s >= 2
        and pre >= 22.0
        and pre_s >= 12.0
        and worst_dd >= -12.0
        and avg_pf >= 1.15
    )
    score = pre + 0.65 * pre_s + 5.0 * (pos + pos_s) + 5.0 * max(0.0, avg_pf - 1.0) - 0.25 * abs(worst_dd) if eligible else -1e12
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


def evaluate_router(router: RouterConfig, seed: v2.EventConfig, market: dict) -> Tuple[dict, List[dict], List[dict]]:
    normal, entries = simulate_router(router, seed, market, False)
    severe, severe_entries = simulate_router(router, seed, market, True)
    ranges = {
        "fold1": (START_MS, F1_MS),
        "fold2": (F1_MS, F2_MS),
        "fold3": (F2_MS, F3_MS),
        "lateEvaluation": (F3_MS, END_MS),
        "full": (START_MS, END_MS),
    }
    windows = {
        name: {
            "normal": v2.metrics(normal, entries, start, end),
            "severe": v2.metrics(severe, severe_entries, start, end),
        }
        for name, (start, end) in ranges.items()
    }
    return {
        "variantId": router.router_id,
        "router": {
            "routerId": router.router_id,
            "seedId": router.seed_id,
            "shortGate": router.short_gate,
            "longProfile": asdict(router.long_profile) if router.long_profile else None,
        },
        "seedConfig": asdict(seed),
        "preSelection": score_from_windows(windows),
        **windows,
    }, normal, severe


def compact(row: dict) -> dict:
    keys = ("variantId", "router", "seedConfig", "preSelection", "fold1", "fold2", "fold3", "lateEvaluation", "full")
    return {key: row[key] for key in keys}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/v96-recent-event-core-v4")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    market = v2.load_market()
    short_configs = [cfg for cfg in v2.configs() if cfg.family == "SHORT_PULLBACK"]

    # Reproduce every V2 short-pullback candidate. Full-period ranking below is diagnostic only.
    seed_rows = []
    for cfg in short_configs:
        row, _normal, _severe = v2.evaluate(cfg, market)
        seed_rows.append(row)
    seed_by_id = {row["variantId"]: next(cfg for cfg in short_configs if cfg.config_id == row["variantId"]) for row in seed_rows}
    seed_ranked_pre = sorted(
        (row for row in seed_rows if row["preSelection"]["eligible"]),
        key=lambda row: (row["preSelection"]["score"], row["variantId"]),
        reverse=True,
    )
    seed_top_full = sorted(seed_rows, key=lambda row: finite(row["full"]["normal"]["compoundedReturnPct"], -1e12), reverse=True)
    seeds = [seed_by_id[row["variantId"]] for row in seed_ranked_pre[:8]]

    router_rows = []
    replays = {}
    for seed in seeds:
        for gate in SHORT_GATES:
            for long_profile in LONG_PROFILES:
                suffix = long_profile.profile_id if long_profile else "CASH"
                router = RouterConfig(
                    router_id=f"V4_{seed.config_id}__{gate}__{suffix}",
                    seed_id=seed.config_id,
                    short_gate=gate,
                    long_profile=long_profile,
                )
                row, normal, severe = evaluate_router(router, seed, market)
                router_rows.append(row)
                replays[row["variantId"]] = (normal, severe)

    eligible = sorted(
        (row for row in router_rows if row["preSelection"]["eligible"]),
        key=lambda row: (row["preSelection"]["score"], row["variantId"]),
        reverse=True,
    )
    ranked = sorted(router_rows, key=lambda row: (row["preSelection"]["score"], row["variantId"]), reverse=True)
    selected = eligible[0] if eligible else ranked[0]
    selected_normal, selected_severe = replays[selected["variantId"]]
    full = selected["full"]["normal"]
    full_s = selected["full"]["severe"]
    late = selected["lateEvaluation"]["normal"]
    late_s = selected["lateEvaluation"]["severe"]
    late_pass = bool(
        int(late["tradeEpisodes"]) >= 2
        and finite(late["compoundedReturnPct"]) > 0.0
        and finite(late_s["compoundedReturnPct"]) > 0.0
        and finite(late["maxDrawdownPct"], -99) >= -8.0
        and finite(late.get("profitFactor")) > 1.05
    )
    beats_v3 = bool(
        finite(full["compoundedReturnPct"]) > V3_BENCHMARK
        and finite(full_s["compoundedReturnPct"]) > 40.0
        and finite(full["maxDrawdownPct"], -99) >= -12.0
        and finite(full.get("profitFactor")) > 1.35
    )
    status = "V96_RECENT_EVENT_CORE_V4_PASS" if selected["preSelection"]["eligible"] and late_pass and beats_v3 else "V96_RECENT_EVENT_CORE_V4_DIAGNOSTIC"

    payload = rounded({
        "version": 4,
        "strategyId": "V96_RECENT_EVENT_CORE_V4_REGIME_GATED_ROUTER",
        "status": status,
        "period": {
            "startInclusive": v2.START.isoformat(),
            "endExclusive": v2.END.isoformat(),
            "selectionFolds": [
                [v2.START.isoformat(), v2.FOLD1_END.isoformat()],
                [v2.FOLD1_END.isoformat(), v2.FOLD2_END.isoformat()],
                [v2.FOLD2_END.isoformat(), v2.FOLD3_END.isoformat()],
            ],
            "lateEvaluationStartInclusive": v2.FOLD3_END.isoformat(),
        },
        "architecture": {
            "barHours": BAR_HOURS,
            "gross": GROSS,
            "onePositionMaximum": True,
            "short": "V2 short-pullback seed selected on first three folds only",
            "shortRegimeGates": list(SHORT_GATES),
            "strongRegimeAction": "cash or completed-bar long breakout",
            "nextBarExecution": True,
        },
        "benchmark": {"V3SelectedReturnPct": V3_BENCHMARK},
        "seedAudit": {
            "testedShortPullback": len(seed_rows),
            "preSelectionEligible": len(seed_ranked_pre),
            "seedIdsUsedForRouter": [cfg.config_id for cfg in seeds],
            "topFullDiagnosticOnly": [
                {
                    "variantId": row["variantId"],
                    "preSelection": row["preSelection"],
                    "full": row["full"],
                    "lateEvaluation": row["lateEvaluation"],
                }
                for row in seed_top_full[:15]
            ],
        },
        "candidateCounts": {"routerTested": len(router_rows), "preSelectionEligible": len(eligible)},
        "selected": compact(selected),
        "selectedPassesLateEvaluation": late_pass,
        "selectedBeatsV3": beats_v3,
        "topPreSelection": [compact(row) for row in ranked[:20]],
        "topFullDiagnosticOnly": [compact(row) for row in sorted(router_rows, key=lambda r: finite(r["full"]["normal"]["compoundedReturnPct"], -1e12), reverse=True)[:20]],
        "selectionPolicy": {
            "seedSelectionUsesOnlyFirstThreeFolds": True,
            "routerRankingUsesOnlyFirstThreeFolds": True,
            "lateEvaluationUsedForRanking": False,
            "fullPeriodUsedForRanking": False,
            "fullDiagnosticCandidatesCannotBePromotedByFullRank": True,
        },
        "selectedReplay": {
            "strategyId": "V96_RECENT_EVENT_CORE_V4_REGIME_GATED_ROUTER",
            "variantId": selected["variantId"],
            "normal": selected_normal,
            "severe": selected_severe,
        },
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
    })
    (output / "v96-recent-event-core-v4.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V96 Recent Event Core V4 — Regime Gated Router",
        "",
        f"- Status: **{status}**",
        f"- V2 short-pullback candidates re-audited: **{len(seed_rows)}**",
        f"- Exact best full diagnostic: **{seed_top_full[0]['variantId']} = {seed_top_full[0]['full']['normal']['compoundedReturnPct']}%** (diagnostic only)",
        f"- Router tested: **{len(router_rows)}** / Eligible: **{len(eligible)}**",
        f"- Selected: **{selected['variantId']}**",
        f"- Full: **{full['compoundedReturnPct']}%** / Severe **{full_s['compoundedReturnPct']}%** / DD **{full['maxDrawdownPct']}%** / PF **{full['profitFactor']}**",
        f"- Late: **{late['compoundedReturnPct']}%** / Severe **{late_s['compoundedReturnPct']}%** / PF **{late['profitFactor']}**",
        f"- Beats V3: **{beats_v3}** / Late pass: **{late_pass}**",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output / "v96-recent-event-core-v4.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
