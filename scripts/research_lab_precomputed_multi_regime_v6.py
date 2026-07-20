from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4
import research_lab_asymmetric_bear_hedge_v5 as v5


@dataclass(frozen=True)
class RegimeVariant:
    variant_id: str
    overlay: v4.Overlay
    hedge: v5.Hedge
    confirm_bars: int


def funding_buckets(funding: Dict[str, List[dict]]) -> Dict[str, Dict[int, float]]:
    result: Dict[str, Dict[int, float]] = {}
    for symbol, points in funding.items():
        bucket: Dict[int, float] = {}
        for point in points:
            ts = int(point["ts"])
            bar_ts = ts // (12 * v4.HOUR) * (12 * v4.HOUR)
            bucket[bar_ts] = bucket.get(bar_ts, 0.0) + float(point["rate"]) * 100.0
        result[symbol] = bucket
    return result


def precompute_projected_members(
    components: List[v4.Component],
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
) -> Dict[int, List[Dict[str, float]]]:
    current: List[Dict[str, float]] = [{} for _ in components]
    pending: List[Optional[Dict[str, float]]] = [None for _ in components]
    projected_by_ts: Dict[int, List[Dict[str, float]]] = {}
    for ts in times:
        for index, value in enumerate(pending):
            if value is not None:
                current[index] = value
                pending[index] = None
        projected: List[Dict[str, float]] = []
        for index, component in enumerate(components):
            candidate = v4.component_target(component, ts, bars, indexes)
            rebalance_bars = max(1, round(component.rebalance_days * 2))
            scheduled = round((ts - v4.START_2023) / (12 * v4.HOUR)) % rebalance_bars == 0
            regime_exit = v4.gross_exposure(current[index]) > 0 and v4.gross_exposure(candidate) == 0
            if scheduled or regime_exit:
                pending[index] = candidate
                projected.append(candidate)
            else:
                projected.append(current[index])
        projected_by_ts[ts] = projected
    return projected_by_ts


def precompute_base_targets(
    overlays: List[v4.Overlay],
    times: List[int],
    projected: Dict[int, List[Dict[str, float]]],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
) -> Dict[str, Dict[int, Dict[str, float]]]:
    return {
        overlay.overlay_id: {
            ts: v4.overlay_target(overlay, ts, projected[ts], bars, indexes)
            for ts in times
        }
        for overlay in overlays
    }


def precompute_bear_targets(
    hedges: List[v5.Hedge],
    times: List[int],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
) -> Dict[str, Dict[int, Dict[str, float]]]:
    return {
        hedge.hedge_id: {ts: v5.bear_target(hedge, ts, bars, indexes) for ts in times}
        for hedge in hedges
    }


def confirmed_bear_series(
    raw: Dict[int, Dict[str, float]],
    times: List[int],
    confirm_bars: int,
) -> Dict[int, Dict[str, float]]:
    count = 0
    result: Dict[int, Dict[str, float]] = {}
    for ts in times:
        target = raw.get(ts, {})
        if v4.gross_exposure(target) > 0:
            count += 1
        else:
            count = 0
        result[ts] = target if count >= confirm_bars else {}
    return result


def simulate(
    variant: RegimeVariant,
    times: List[int],
    base_targets: Dict[str, Dict[int, Dict[str, float]]],
    bear_targets: Dict[str, Dict[int, Dict[str, float]]],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, Dict[int, float]],
    start: int,
    end: int,
) -> dict:
    active_times = [ts for ts in times if start <= ts < end]
    if len(active_times) < 2:
        return v4.metrics([], [], start, end)
    confirmed_bear = confirmed_bear_series(bear_targets[variant.hedge.hedge_id], times, variant.confirm_bars)
    portfolio: Dict[str, float] = {}
    pending: Optional[Dict[str, float]] = None
    rows: List[dict] = []
    cycles: List[v4.Cycle] = []
    cycle_start = -1
    cycle_normal: List[float] = []
    cycle_stress: List[float] = []

    def close_cycle(end_ts: int) -> None:
        nonlocal cycle_start, cycle_normal, cycle_stress
        if cycle_start >= 0 and cycle_normal:
            cycles.append(v4.Cycle(
                cycle_start,
                end_ts,
                v4.product_return(cycle_normal),
                v4.product_return(cycle_stress),
            ))
        cycle_start = -1
        cycle_normal = []
        cycle_stress = []

    for ts in active_times:
        bar_turnover = 0.0
        if pending is not None:
            if pending != portfolio:
                close_cycle(ts - 1)
                bar_turnover = v4.turnover(portfolio, pending)
                portfolio = pending
                if v4.gross_exposure(portfolio) > 0:
                    cycle_start = ts
            pending = None

        gross = 0.0
        funding_cost = 0.0
        for symbol, weight in portfolio.items():
            symbol_index = indexes[symbol].get(ts)
            if symbol_index is None:
                continue
            bar = bars[symbol][symbol_index]
            gross += weight * ((float(bar["close"]) / float(bar["open"]) - 1.0) * 100.0)
            funding_cost += weight * funding.get(symbol, {}).get(ts, 0.0)
        normal_pct = gross - funding_cost - bar_turnover * v4.NORMAL_COST_BPS / 100.0
        stress_pct = gross - funding_cost - bar_turnover * v4.STRESS_COST_BPS / 100.0
        rows.append({
            "ts": ts,
            "normal_pct": normal_pct,
            "stress_pct": stress_pct,
            "exposure": v4.gross_exposure(portfolio),
            "turnover": bar_turnover,
        })
        if cycle_start >= 0:
            cycle_normal.append(normal_pct)
            cycle_stress.append(stress_pct)

        base = base_targets[variant.overlay.overlay_id].get(ts, {})
        if v4.gross_exposure(base) > 0.05:
            pending = base
        else:
            pending = confirmed_bear.get(ts, {})

    final_turnover = v4.gross_exposure(portfolio)
    if final_turnover > 0 and rows:
        rows[-1]["normal_pct"] -= final_turnover * v4.NORMAL_COST_BPS / 100.0
        rows[-1]["stress_pct"] -= final_turnover * v4.STRESS_COST_BPS / 100.0
        rows[-1]["turnover"] += final_turnover
        if cycle_normal:
            cycle_normal[-1] -= final_turnover * v4.NORMAL_COST_BPS / 100.0
            cycle_stress[-1] -= final_turnover * v4.STRESS_COST_BPS / 100.0
    close_cycle(end - 1)
    return v4.metrics(rows, cycles, start, end)


def variants(overlays: List[v4.Overlay]) -> List[RegimeVariant]:
    result: List[RegimeVariant] = []
    for overlay in overlays:
        for hedge in v5.hedge_list():
            for confirm_bars in [1, 2, 4]:
                result.append(RegimeVariant(
                    variant_id=f"{overlay.overlay_id}__{hedge.hedge_id}__Q{confirm_bars}",
                    overlay=overlay,
                    hedge=hedge,
                    confirm_bars=confirm_bars,
                ))
    return result


def history_pass(item: dict) -> bool:
    m = item["history"]
    annual = m["annualReturnsPct"]
    halves = list(m["halfYearReturnsPct"].values())
    return (
        m["cycles"] >= 40
        and m["cagrPct"] >= 25
        and (m["profitFactor"] or 0) >= 1.25
        and (m["stressProfitFactor"] or 0) >= 1.1
        and m["maxDrawdownPct"] >= -30
        and all(annual.get(year, -100) > 0 for year in ["2023", "2024", "2025"])
        and sum(1 for value in halves if value > 0) >= 5
        and (m["bestCycleProfitSharePct"] or 100) <= 30
        and (m["profitFactorWithoutBest"] or 0) >= 1.15
    )


def final_pass(m: dict) -> bool:
    return (
        m["cycles"] >= 5
        and m["compoundedReturnPct"] > 0
        and m["stressCompoundedReturnPct"] > 0
        and (m["profitFactor"] or 0) >= 1.05
        and (m["stressProfitFactor"] or 0) >= 1.0
        and m["maxDrawdownPct"] >= -15
        and (m["bestCycleProfitSharePct"] or 100) <= 45
        and (m["profitFactorWithoutBest"] or 0) >= 0.9
    )


def neighbor(left: RegimeVariant, right: RegimeVariant) -> bool:
    return (
        left.overlay.overlay_id == right.overlay.overlay_id
        and left.hedge.mode == right.hedge.mode
        and abs(left.hedge.slow_days - right.hedge.slow_days) <= 60
        and abs(left.hedge.momentum_days - right.hedge.momentum_days) <= 10
        and abs(left.hedge.gross - right.hedge.gross) <= 0.2
        and abs(left.confirm_bars - right.confirm_bars) <= 2
    )


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    v3_result = json.loads((state_dir / "multi-horizon-regime-rotation-v3.json").read_text(encoding="utf-8"))
    v4_result = json.loads((state_dir / "parameter-bagged-rotation-v4.json").read_text(encoding="utf-8"))
    components = v4.parse_components(v3_result)
    overlays = [v4.Overlay(**item["overlay"]) for item in v4_result.get("topHistorical", [])[:10]]
    hedges = v5.hedge_list()
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = funding_buckets({symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS})
    times = [int(bar["ts"]) for bar in bars["BTC"] if v4.START_2023 <= int(bar["ts"]) < v4.END]

    projected = precompute_projected_members(components, times, bars, indexes)
    base_targets = precompute_base_targets(overlays, times, projected, bars, indexes)
    bear_targets = precompute_bear_targets(hedges, times, bars, indexes)
    candidate_variants = variants(overlays)

    candidates: List[dict] = []
    for variant in candidate_variants:
        history = simulate(variant, times, base_targets, bear_targets, bars, indexes, funding, v4.START_2023, v4.START_2026)
        candidates.append({
            "variant": {
                "variant_id": variant.variant_id,
                "overlay": variant.overlay.__dict__,
                "hedge": variant.hedge.__dict__,
                "confirm_bars": variant.confirm_bars,
            },
            "history": history,
            "neighborCount": 0,
            "neighborhoodScore": -999.0,
        })

    passed = [item for item in candidates if history_pass(item)]
    variant_map = {variant.variant_id: variant for variant in candidate_variants}
    for item in passed:
        left = variant_map[item["variant"]["variant_id"]]
        neighbors = [other for other in passed if neighbor(left, variant_map[other["variant"]["variant_id"]])]
        item["neighborCount"] = len(neighbors)
        worst_years = [min(other["history"]["annualReturnsPct"].get(year, -100) for year in ["2023", "2024", "2025"]) for other in neighbors]
        item["neighborhoodScore"] = v4.median(worst_years)

    robust = [item for item in passed if item["neighborCount"] >= 5]
    robust.sort(key=lambda item: (
        item["neighborhoodScore"],
        item["history"]["stressCagrPct"],
        item["history"]["profitFactorWithoutBest"] or 0,
        -item["history"]["turnover"],
    ), reverse=True)
    selected = robust[0] if robust else None
    final_2026 = None
    if selected:
        final_2026 = simulate(
            variant_map[selected["variant"]["variant_id"]],
            times,
            base_targets,
            bear_targets,
            bars,
            indexes,
            funding,
            v4.START_2026,
            v4.END,
        )
    final_ok = final_pass(final_2026) if final_2026 else False
    status = "PAPER_CANDIDATE_ONLY_ADAPTIVE" if final_ok else ("FINAL_TEMPORAL_STRESS_REJECTED" if selected else "NO_ROBUST_MULTI_REGIME")

    result = rounded({
        "version": 6,
        "strategyId": "PRECOMPUTED_MULTI_REGIME_ROTATION_V6",
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "status": status,
        "productionChanged": False,
        "realTradingEnabled": False,
        "source": {
            "baseOverlays": len(overlays),
            "hedges": len(hedges),
            "confirmationVariants": 3,
            "evaluations": len(candidates),
            "historyPassed": len(passed),
            "robustNeighborhoods": len(robust),
        },
        "selected": {
            **selected,
            "final2026H1": final_2026,
            "finalPassed": final_ok,
            "paperEligible": final_ok,
            "liveEligible": False,
            "liveBlockReasons": [
                "V6は既存Holdout確認後に設計されたadaptive研究",
                "Forward Paper 100 trades未達",
                "Aster実約定Spread/Slippage未検証",
                "通貨別Forward 30 trades未達",
            ],
        } if selected else None,
        "topHistorical": robust[:15] if robust else sorted(candidates, key=lambda item: item["history"]["cagrPct"], reverse=True)[:15],
        "fingerprint": hashlib.sha256(json.dumps({
            "components": [component.__dict__ for component in components],
            "overlays": [overlay.__dict__ for overlay in overlays],
            "hedges": [hedge.__dict__ for hedge in hedges],
            "confirm": [1, 2, 4],
            "periods": [v4.START_2023, v4.START_2026, v4.END],
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "V6はV3/V4結果確認後のadaptive研究で完全未使用OOSではない。",
            "Bull合成TrendとBear Shortを非対称に切り替え、Bear確認1/2/4本を検証する。",
            "5近傍以上のパラメータ安定性を必須にする。",
            "通過してもForward Paper専用でLiveは禁止する。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    })

    def line(label: str, m: dict) -> str:
        return f"| {label} | {m['cycles']} | {m['winRatePct']}% | {m['cagrPct']}% | {m['stressCagrPct']}% | {m['profitFactor']} | {m['stressProfitFactor']} | {m['compoundedReturnPct']}% | {m['maxDrawdownPct']}% | {m['bestCycleProfitSharePct']}% | {m['profitFactorWithoutBest']} |"

    report = [
        "# Precomputed Multi-Regime Rotation V6",
        "",
        f"- Status: **{status}**",
        f"- Evaluations: {len(candidates)}",
        f"- 2023-2025 passed: {len(passed)}",
        f"- Robust neighborhoods: {len(robust)}",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Selected",
        "",
    ]
    if result["selected"]:
        variant = result["selected"]["variant"]
        report.extend([
            f"- Variant: **{variant['variant_id']}**",
            f"- Neighbor count: {result['selected']['neighborCount']}",
            f"- Final 2026H1 pass: **{'YES' if result['selected']['finalPassed'] else 'NO'}**",
            f"- Paper eligible: **{'YES' if result['selected']['paperEligible'] else 'NO'}**",
            "",
            "| Window | N | Win | CAGR | Stress CAGR | PF | Stress PF | Compound | DD | Best share | PF ex-best |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            line("2023-2025", result["selected"]["history"]),
            line("2026H1", result["selected"]["final2026H1"]),
        ])
    else:
        report.append("安定性Gateを通るMulti-Regime構成はありませんでした。")
    report.extend([
        "",
        "## Verdict",
        "",
        "Forward Paper候補が残りました。ただしLiveは禁止です。" if final_ok else "Paper候補なし。Liveは禁止を維持します。",
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "precomputed-multi-regime-rotation-v6.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "precomputed-multi-regime-rotation-v6.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
