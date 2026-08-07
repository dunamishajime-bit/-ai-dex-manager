from __future__ import annotations

import argparse
import datetime as dt
import itertools
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

UTC = dt.timezone.utc
REPO_ROOT = Path(__file__).resolve().parent.parent
RESEARCH_ROOT = REPO_ROOT / ".research-base"
sys.path.insert(0, str(RESEARCH_ROOT / "scripts"))

import research_lab_v96_volume50_turnover075_full_bt as crypto_bt

core = crypto_bt.core
v4 = core.v4
v32 = core.v32
v89 = crypto_bt.v89

START = dt.datetime(2025, 8, 13, tzinfo=UTC)
DEV_END = dt.datetime(2026, 1, 1, tzinfo=UTC)
HOLDOUT_START = dt.datetime(2026, 3, 11, tzinfo=UTC)
END = dt.datetime(2026, 8, 3, tzinfo=UTC)
START_MS = int(START.timestamp() * 1000)
DEV_END_MS = int(DEV_END.timestamp() * 1000)
HOLDOUT_START_MS = int(HOLDOUT_START.timestamp() * 1000)
END_MS = int(END.timestamp() * 1000)
SYMBOLS = ("BTC", "ETH", "BNB", "SOL", "LINK", "AVAX")
ALT_SYMBOLS = ("ETH", "BNB", "SOL", "LINK", "AVAX")


@dataclass(frozen=True)
class DualConfig:
    config_id: str
    regime_days: int
    btc_momentum_days: int
    rank_momentum_days: int
    rebalance_bars: int
    bull_top_k: int
    bear_mode: str
    target_vol_pct: int
    asset_sma_days: int = 20
    volume_floor: float = 0.60
    bull_gross: float = 1.00
    bear_gross: float = 0.75
    bull_min_momentum_pct: float = 0.0
    bear_min_momentum_pct: float = 0.0


def rounded(value: Any):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def compound(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + float(value))
    return equity - 1.0


def profit_factor(values: Sequence[float]) -> Optional[float]:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    return gains / losses if losses > 1e-15 else (999.0 if gains > 0 else None)


def metrics(rows: Sequence[dict], start: int, end: int) -> dict:
    active = [row for row in rows if start <= int(row["ts"]) < end]
    values = [float(row["return"]) for row in active]
    equity = peak = 1.0
    max_dd = 0.0
    wins = 0
    months: Dict[str, List[float]] = {}
    gross = []
    for row, value in zip(active, values):
        equity *= max(0.001, 1.0 + value)
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1.0)
        wins += value > 0
        gross.append(float(row.get("gross", 0.0)))
        month = dt.datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC).strftime("%Y-%m")
        months.setdefault(month, []).append(value)
    month_returns = {key: compound(items) * 100.0 for key, items in months.items()}
    days = max(1e-9, (end - start) / 86_400_000.0)
    years = days / 365.25
    return {
        "events": len(active),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "cagrPct": (equity ** (1.0 / years) - 1.0) * 100.0 if equity > 0 else None,
        "maxDrawdownPct": max_dd * 100.0,
        "profitFactor": profit_factor(values),
        "winRatePct": wins / len(values) * 100.0 if values else None,
        "averageGross": sum(gross) / len(gross) if gross else 0.0,
        "maxGross": max(gross, default=0.0),
        "activeBucketRatio": sum(item > 0.01 for item in gross) / len(gross) if gross else 0.0,
        "positiveMonthRatio": sum(value > 0 for value in month_returns.values()) / len(month_returns) if month_returns else 0.0,
        "monthlyReturnsPct": month_returns,
    }


def candidate_configs() -> List[DualConfig]:
    result = []
    for regime_days, btc_mom_days, rank_days, rebalance_bars, top_k, bear_mode, target_vol in itertools.product(
        (10, 20, 30),
        (3, 7),
        (3, 7, 14),
        (1, 2),
        (1, 2),
        ("BTC", "WEAKEST"),
        (0, 65),
    ):
        result.append(DualConfig(
            config_id=f"R{regime_days}_BM{btc_mom_days}_RM{rank_days}_RB{rebalance_bars}_K{top_k}_{bear_mode}_TV{target_vol}",
            regime_days=regime_days,
            btc_momentum_days=btc_mom_days,
            rank_momentum_days=rank_days,
            rebalance_bars=rebalance_bars,
            bull_top_k=top_k,
            bear_mode=bear_mode,
            target_vol_pct=target_vol,
        ))
    return result


def target_vol_scale(config: DualConfig, bars: Dict[str, List[dict]], indexes: Dict[str, Dict[int, int]], ts: int) -> float:
    if config.target_vol_pct <= 0:
        return 1.0
    idx = indexes["BTC"].get(ts)
    if idx is None:
        return 0.0
    vol = v4.realized_annual_vol(bars["BTC"], idx, 40)
    if vol is None or vol <= 0:
        return 0.0
    return max(0.40, min(1.0, config.target_vol_pct / vol))


def raw_desired(config: DualConfig, ts: int, bars: Dict[str, List[dict]], indexes: Dict[str, Dict[int, int]]) -> Dict[str, float]:
    bi = indexes["BTC"].get(ts)
    if bi is None:
        return {}
    btc = bars["BTC"]
    regime_sma = v4.sma(btc, bi, config.regime_days * 2)
    btc_momentum = v4.momentum(btc, bi, config.btc_momentum_days * 2)
    if regime_sma is None or btc_momentum is None:
        return {}
    btc_close = float(btc[bi]["close"])
    bull = btc_close > regime_sma and btc_momentum > 0.0
    bear = btc_close < regime_sma and btc_momentum < 0.0
    if not bull and not bear:
        return {}

    scale = target_vol_scale(config, bars, indexes, ts)
    if scale <= 0:
        return {}

    if bull:
        candidates: List[Tuple[str, float]] = []
        for symbol in ALT_SYMBOLS:
            idx = indexes[symbol].get(ts)
            if idx is None:
                continue
            rows = bars[symbol]
            average = v4.sma(rows, idx, config.asset_sma_days * 2)
            momentum = v4.momentum(rows, idx, config.rank_momentum_days * 2)
            volume = v4.volume_ratio(rows, idx, 20, 80)
            vol = v4.realized_annual_vol(rows, idx, max(20, config.rank_momentum_days * 2))
            if average is None or momentum is None or volume is None or vol is None:
                continue
            if float(rows[idx]["close"]) <= average or momentum <= config.bull_min_momentum_pct or volume < config.volume_floor:
                continue
            relative = momentum - btc_momentum
            score = momentum + 0.35 * relative - 0.04 * vol + min(2.0, volume)
            candidates.append((symbol, score))
        selected = sorted(candidates, key=lambda item: item[1], reverse=True)[: config.bull_top_k]
        if not selected:
            return {}
        each = config.bull_gross * scale / len(selected)
        return {symbol: each for symbol, _score in selected}

    # Bear: either short BTC (clean market-regime hedge) or the weakest liquid crypto.
    if config.bear_mode == "BTC":
        return {"BTC": -config.bear_gross * scale}

    candidates = []
    for symbol in SYMBOLS:
        idx = indexes[symbol].get(ts)
        if idx is None:
            continue
        rows = bars[symbol]
        average = v4.sma(rows, idx, config.asset_sma_days * 2)
        momentum = v4.momentum(rows, idx, config.rank_momentum_days * 2)
        if average is None or momentum is None:
            continue
        if float(rows[idx]["close"]) >= average or momentum >= -config.bear_min_momentum_pct:
            continue
        candidates.append((symbol, momentum))
    if not candidates:
        return {"BTC": -config.bear_gross * scale}
    symbol, _score = min(candidates, key=lambda item: item[1])
    return {symbol: -config.bear_gross * scale}


def build_targets(config: DualConfig, times: Sequence[int], bars: Dict[str, List[dict]], indexes: Dict[str, Dict[int, int]]) -> Dict[int, Dict[str, float]]:
    targets: Dict[int, Dict[str, float]] = {}
    current: Dict[str, float] = {}
    for position, ts in enumerate(times):
        desired = raw_desired(config, ts, bars, indexes)
        current_sign = 1 if any(value > 0 for value in current.values()) else -1 if any(value < 0 for value in current.values()) else 0
        desired_sign = 1 if any(value > 0 for value in desired.values()) else -1 if any(value < 0 for value in desired.values()) else 0
        scheduled = position % config.rebalance_bars == 0
        regime_change = current_sign != desired_sign
        if scheduled or regime_change:
            current = desired
        targets[ts] = dict(current)
    return targets


def build_rows(config: DualConfig, raw: dict) -> Tuple[List[dict], List[dict], dict]:
    times = [int(ts) for ts in raw["times"] if START_MS <= int(ts) < END_MS]
    targets = build_targets(config, times, raw["bars"], raw["indexes"])
    normal_map = v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 10, 0, 0)
    severe_map = v32.core_series(targets, times, raw["bars"], raw["indexes"], raw["funding"], 50, 1, 3)
    normal = [{"ts": ts, "return": float(normal_map[ts]["return"]), "gross": float(normal_map[ts]["exposure"]), "maxGross": float(normal_map[ts]["exposure"]), "regime": int(normal_map[ts]["regime"])} for ts in times]
    severe = [{"ts": ts, "return": float(severe_map[ts]["return"]), "gross": float(severe_map[ts]["exposure"]), "maxGross": float(severe_map[ts]["exposure"]), "regime": int(severe_map[ts]["regime"])} for ts in times]
    counts = {"bullBuckets": sum(row["regime"] > 0 for row in normal), "bearBuckets": sum(row["regime"] < 0 for row in normal), "cashBuckets": sum(row["regime"] == 0 for row in normal)}
    return normal, severe, counts


def finite(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def evaluate(config: DualConfig, raw: dict) -> Tuple[dict, List[dict], List[dict]]:
    normal, severe, counts = build_rows(config, raw)
    item = {
        "variantId": config.config_id,
        "config": asdict(config),
        "regimeCounts": counts,
        "development": {"normal": metrics(normal, START_MS, DEV_END_MS), "severe": metrics(severe, START_MS, DEV_END_MS)},
        "validation": {"normal": metrics(normal, DEV_END_MS, HOLDOUT_START_MS), "severe": metrics(severe, DEV_END_MS, HOLDOUT_START_MS)},
        "holdout": {"normal": metrics(normal, HOLDOUT_START_MS, END_MS), "severe": metrics(severe, HOLDOUT_START_MS, END_MS)},
        "full": {"normal": metrics(normal, START_MS, END_MS), "severe": metrics(severe, START_MS, END_MS)},
    }
    dev = item["development"]["normal"]
    dev_s = item["development"]["severe"]
    val = item["validation"]["normal"]
    val_s = item["validation"]["severe"]
    item["selectionEligible"] = bool(
        finite(dev["compoundedReturnPct"]) > 0.0
        and finite(dev_s["compoundedReturnPct"]) > -3.0
        and finite(val["compoundedReturnPct"]) > 0.0
        and finite(val_s["compoundedReturnPct"]) > 0.0
        and finite(val.get("profitFactor")) > 1.05
        and finite(val.get("maxDrawdownPct"), -99.0) >= -10.0
        and finite(val.get("activeBucketRatio")) >= 0.20
    )
    item["selectionScorePreHoldout"] = (
        0.35 * finite(dev["compoundedReturnPct"])
        + 0.80 * finite(val["compoundedReturnPct"])
        + 0.20 * finite(dev_s["compoundedReturnPct"])
        + 0.45 * finite(val_s["compoundedReturnPct"])
        + 5.0 * max(0.0, min(2.0, finite(val.get("profitFactor")) - 1.0))
        - 0.20 * abs(finite(val["maxDrawdownPct"]))
    ) if item["selectionEligible"] else -1e12
    return item, normal, severe


def compact(item: dict) -> dict:
    return {key: item[key] for key in ("variantId", "config", "regimeCounts", "selectionEligible", "selectionScorePreHoldout", "development", "validation", "holdout", "full")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=".research-state/v96-recent-dual-regime-v1")
    args = parser.parse_args()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    core.CORE_END = END_MS
    core.v4.END = END_MS
    raw = v89.build_raw()

    results = []
    replay: Dict[str, Tuple[List[dict], List[dict]]] = {}
    for config in candidate_configs():
        item, normal, severe = evaluate(config, raw)
        results.append(item)
        replay[item["variantId"]] = (normal, severe)

    eligible = sorted((row for row in results if row["selectionEligible"]), key=lambda row: (row["selectionScorePreHoldout"], row["variantId"]), reverse=True)
    ranked = sorted(results, key=lambda row: (row["selectionScorePreHoldout"], row["variantId"]), reverse=True)
    selected = eligible[0] if eligible else ranked[0]
    selected_normal, selected_severe = replay[selected["variantId"]]
    hold = selected["holdout"]["normal"]
    hold_s = selected["holdout"]["severe"]
    full = selected["full"]["normal"]
    full_s = selected["full"]["severe"]
    pass_holdout = bool(
        selected["selectionEligible"]
        and finite(hold["compoundedReturnPct"]) >= 5.0
        and finite(hold_s["compoundedReturnPct"]) > 0.0
        and finite(hold.get("profitFactor")) > 1.05
        and finite(hold.get("maxDrawdownPct"), -99.0) >= -12.0
        and finite(full["compoundedReturnPct"]) >= 15.0
        and finite(full_s["compoundedReturnPct"]) > 0.0
    )
    status = "V96_RECENT_DUAL_REGIME_V1_PASS" if pass_holdout else "NO_ROBUST_DUAL_REGIME_IMPROVEMENT"

    payload = rounded({
        "version": 1,
        "strategyId": "V96_RECENT_DUAL_REGIME_V1",
        "status": status,
        "period": {"startInclusive": START.isoformat(), "developmentEndExclusive": DEV_END.isoformat(), "holdoutStartInclusive": HOLDOUT_START.isoformat(), "endExclusive": END.isoformat()},
        "selectionPolicy": {"holdoutUsedForRanking": False, "rankingData": "2025-08-13 through 2026-03-10 only", "holdout": "2026-03-11 through 2026-08-02", "architecture": "Bull strongest-alt Long / Bear BTC-or-weakest Short / neutral Cash; next 12h bucket execution via frozen v32 core_series."},
        "candidateCounts": {"totalVariants": len(results), "selectionEligible": len(eligible)},
        "selected": compact(selected),
        "selectedPassesFreshHoldout": pass_holdout,
        "topPreHoldoutCandidates": [compact(row) for row in ranked[:30]],
        "selectedReplay": {
            "strategyId": "V96_RECENT_DUAL_REGIME_V1",
            "variantId": selected["variantId"],
            "normal": selected_normal,
            "severe": selected_severe,
            "diagnostics": {"legacyPenguIncluded": False, "config": selected["config"], "regimeCounts": selected["regimeCounts"]},
        },
        "checks": {"holdoutNotUsedForRanking": True, "selectedValidationPositive": finite(selected["validation"]["normal"]["compoundedReturnPct"]) > 0, "selectedFreshHoldoutPositive": finite(hold["compoundedReturnPct"]) > 0, "selectedFreshHoldoutSeverePositive": finite(hold_s["compoundedReturnPct"]) > 0},
        "safety": {"mode": "RESEARCH_ONLY", "ordersSent": False, "liveChanged": False, "vpsChanged": False, "productionChanged": False},
        "limitations": ["This is a new independent recent-regime Core candidate; the running V96 is unchanged.", "The final holdout is not used for candidate ranking, but the underlying dates have been seen elsewhere in the wider project.", "Signals are 12h-close observable and applied from the next 12h bucket by core_series; Normal uses 10bps turnover cost and Severe uses 50bps plus one-bucket delay and 3bps adverse stress.", "Promotion requires a new immutable strategy ID and forward execution evidence."],
    })

    (output / "v96-recent-dual-regime-v1.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V96 Recent Dual Regime V1",
        "",
        f"- Status: **{status}**",
        f"- Variants: {len(results)} / pre-holdout eligible: {len(eligible)}",
        f"- Selected: **{selected['variantId']}**",
        f"- Config: `{selected['config']}`",
        "",
        f"- Development: {selected['development']['normal']['compoundedReturnPct']}% / Severe {selected['development']['severe']['compoundedReturnPct']}%",
        f"- Validation: {selected['validation']['normal']['compoundedReturnPct']}% / Severe {selected['validation']['severe']['compoundedReturnPct']}%",
        f"- Fresh Holdout: **{hold['compoundedReturnPct']}%** / PF {hold.get('profitFactor')} / DD {hold['maxDrawdownPct']}% / Severe **{hold_s['compoundedReturnPct']}%**",
        f"- Full: **{full['compoundedReturnPct']}%** / PF {full.get('profitFactor')} / DD {full['maxDrawdownPct']}% / Severe **{full_s['compoundedReturnPct']}%**",
        f"- Fresh Holdout pass: **{'YES' if pass_holdout else 'NO'}**",
        "",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output / "v96-recent-dual-regime-v1.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
