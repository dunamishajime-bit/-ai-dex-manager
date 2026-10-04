from __future__ import annotations

import hashlib
import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import research_lab_parameter_bagged_rotation_v4 as v4


@dataclass(frozen=True)
class Hedge:
    hedge_id: str
    slow_days: int
    momentum_days: int
    gross: float
    mode: str


def hedge_list() -> List[Hedge]:
    result: List[Hedge] = []
    for slow_days in [60, 90, 150]:
        for momentum_days in [20, 30]:
            for gross in [0.25, 0.4, 0.6]:
                for mode in ["BTC", "WEAKEST"]:
                    result.append(Hedge(
                        hedge_id=f"H_{mode}_S{slow_days}_M{momentum_days}_G{gross}",
                        slow_days=slow_days,
                        momentum_days=momentum_days,
                        gross=gross,
                        mode=mode,
                    ))
    return result


def bear_target(
    hedge: Hedge,
    ts: int,
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
) -> Dict[str, float]:
    btc_index = indexes["BTC"].get(ts)
    if btc_index is None:
        return {}
    btc = bars["BTC"]
    slow = v4.sma(btc, btc_index, hedge.slow_days * 2)
    btc_momentum = v4.momentum(btc, btc_index, hedge.momentum_days * 2)
    if slow is None or btc_momentum is None:
        return {}
    if not (float(btc[btc_index]["close"]) < slow and btc_momentum < -2.0):
        return {}

    bearish: List[Tuple[str, float]] = []
    for symbol in ["ETH", "BNB", "SOL"]:
        index = indexes[symbol].get(ts)
        if index is None:
            continue
        rows = bars[symbol]
        average = v4.sma(rows, index, 44)
        symbol_momentum = v4.momentum(rows, index, hedge.momentum_days * 2)
        if average is None or symbol_momentum is None:
            continue
        if float(rows[index]["close"]) < average and symbol_momentum < 0:
            bearish.append((symbol, symbol_momentum))
    if len(bearish) < 2:
        return {}
    if hedge.mode == "BTC":
        return {"BTC": -hedge.gross}
    weakest = sorted(bearish, key=lambda item: item[1])[0][0]
    return {weakest: -hedge.gross}


def is_neighbor(left: Hedge, right: Hedge) -> bool:
    return (
        left.mode == right.mode
        and abs(left.slow_days - right.slow_days) <= 60
        and abs(left.momentum_days - right.momentum_days) <= 10
        and abs(left.gross - right.gross) <= 0.2
    )


def simulate(
    overlay: v4.Overlay,
    hedge: Hedge,
    components: List[v4.Component],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
    funding: Dict[str, List[dict]],
    start: int,
    end: int,
) -> dict:
    btc = bars["BTC"]
    first = next((index for index, bar in enumerate(btc) if int(bar["ts"]) >= start), -1)
    last = max((index for index, bar in enumerate(btc) if int(bar["ts"]) < end), default=-1)
    if first < 0 or last <= first:
        return v4.metrics([], [], start, end)

    member_weights: List[Dict[str, float]] = [{} for _ in components]
    member_pending: List[Optional[Dict[str, float]]] = [None for _ in components]
    portfolio: Dict[str, float] = {}
    portfolio_pending: Optional[Dict[str, float]] = None
    rows: List[dict] = []
    cycles: List[v4.Cycle] = []
    cycle_start = -1
    cycle_normal: List[float] = []
    cycle_stress: List[float] = []

    funding_by_bar: Dict[str, Dict[int, float]] = {}
    for symbol, points in funding.items():
        bucket: Dict[int, float] = {}
        for point in points:
            ts = int(point["ts"])
            bar_ts = ts // (12 * v4.HOUR) * (12 * v4.HOUR)
            bucket[bar_ts] = bucket.get(bar_ts, 0.0) + float(point["rate"]) * 100.0
        funding_by_bar[symbol] = bucket

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

    for index in range(first, last + 1):
        bar = btc[index]
        ts = int(bar["ts"])
        for member_index, pending in enumerate(member_pending):
            if pending is not None:
                member_weights[member_index] = pending
                member_pending[member_index] = None

        bar_turnover = 0.0
        if portfolio_pending is not None:
            if portfolio_pending != portfolio:
                close_cycle(ts - 1)
                bar_turnover = v4.turnover(portfolio, portfolio_pending)
                portfolio = portfolio_pending
                if v4.gross_exposure(portfolio) > 0:
                    cycle_start = ts
            portfolio_pending = None

        gross = 0.0
        funding_cost = 0.0
        for symbol, weight in portfolio.items():
            symbol_index = indexes[symbol].get(ts)
            if symbol_index is None:
                continue
            symbol_bar = bars[symbol][symbol_index]
            gross += weight * ((float(symbol_bar["close"]) / float(symbol_bar["open"]) - 1.0) * 100.0)
            funding_cost += weight * funding_by_bar.get(symbol, {}).get(ts, 0.0)
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

        projected: List[Dict[str, float]] = []
        for member_index, component in enumerate(components):
            candidate = v4.component_target(component, ts, bars, indexes)
            rebalance_bars = max(1, round(component.rebalance_days * 2))
            scheduled = round((ts - v4.START_2023) / (12 * v4.HOUR)) % rebalance_bars == 0
            regime_exit = v4.gross_exposure(member_weights[member_index]) > 0 and v4.gross_exposure(candidate) == 0
            if scheduled or regime_exit:
                member_pending[member_index] = candidate
                projected.append(candidate)
            else:
                projected.append(member_weights[member_index])

        base_target = v4.overlay_target(overlay, ts, projected, bars, indexes)
        if v4.gross_exposure(base_target) > 0.05:
            portfolio_pending = base_target
        else:
            portfolio_pending = bear_target(hedge, ts, bars, indexes)

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
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: v4.load_symbol(cache_root, symbol) for symbol in v4.SYMBOLS}
    bars = {symbol: v4.resample_12h(raw[symbol]["candles"]) for symbol in v4.SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = {symbol: raw[symbol]["funding"] for symbol in v4.SYMBOLS}

    base_overlays = [v4.Overlay(**item["overlay"]) for item in v4_result.get("topHistorical", [])[:10]]
    candidates: List[dict] = []
    for overlay in base_overlays:
        for hedge in hedge_list():
            history = simulate(overlay, hedge, components, bars, indexes, funding, v4.START_2023, v4.START_2026)
            candidates.append({
                "overlay": overlay.__dict__,
                "hedge": hedge.__dict__,
                "history": history,
                "neighborCount": 0,
                "neighborhoodScore": -999.0,
            })

    passed = [item for item in candidates if history_pass(item)]
    for item in passed:
        left = Hedge(**item["hedge"])
        neighbors = [other for other in passed if other["overlay"]["overlay_id"] == item["overlay"]["overlay_id"] and is_neighbor(left, Hedge(**other["hedge"]))]
        item["neighborCount"] = len(neighbors)
        worst_years = [min(other["history"]["annualReturnsPct"].get(year, -100) for year in ["2023", "2024", "2025"]) for other in neighbors]
        item["neighborhoodScore"] = v4.median(worst_years)

    robust = [item for item in passed if item["neighborCount"] >= 3]
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
            v4.Overlay(**selected["overlay"]),
            Hedge(**selected["hedge"]),
            components,
            bars,
            indexes,
            funding,
            v4.START_2026,
            v4.END,
        )
    final_ok = final_pass(final_2026) if final_2026 else False
    status = "PAPER_CANDIDATE_ONLY_ADAPTIVE" if final_ok else ("FINAL_TEMPORAL_STRESS_REJECTED" if selected else "NO_ROBUST_BEAR_HEDGE")

    result = rounded({
        "version": 5,
        "strategyId": "ASYMMETRIC_BEAR_HEDGE_ROTATION_V5",
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "status": status,
        "productionChanged": False,
        "realTradingEnabled": False,
        "source": {
            "v3Fingerprint": v3_result.get("fingerprint"),
            "v4Fingerprint": v4_result.get("fingerprint"),
            "baseOverlays": len(base_overlays),
            "hedgeVariants": len(hedge_list()),
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
                "V5は既存Holdout結果を確認後に設計されたadaptive研究",
                "Forward Paper 100 trades未達",
                "Aster実約定Spread/Slippage未検証",
                "通貨別Forward 30 trades未達",
            ],
        } if selected else None,
        "topHistorical": robust[:10] if robust else sorted(candidates, key=lambda item: item["history"]["cagrPct"], reverse=True)[:10],
        "fingerprint": hashlib.sha256(json.dumps({
            "bases": [overlay.__dict__ for overlay in base_overlays],
            "hedges": [hedge.__dict__ for hedge in hedge_list()],
            "periods": [v4.START_2023, v4.START_2026, v4.END],
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "V5はV3/V4のHoldout確認後に導入したため完全未使用OOSではない。",
            "Bull時はbagged long rotation、明確なBear時だけBTCまたは最弱通貨Shortへ切り替える。",
            "3近傍以上のHedgeパラメータ安定性を必須にする。",
            "通過してもForward Paper専用でLiveは禁止する。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    })

    def line(label: str, m: dict) -> str:
        return f"| {label} | {m['cycles']} | {m['winRatePct']}% | {m['cagrPct']}% | {m['stressCagrPct']}% | {m['profitFactor']} | {m['stressProfitFactor']} | {m['compoundedReturnPct']}% | {m['maxDrawdownPct']}% | {m['bestCycleProfitSharePct']}% | {m['profitFactorWithoutBest']} |"

    report = [
        "# Asymmetric Bear-Hedge Rotation V5",
        "",
        f"- Status: **{status}**",
        f"- Base overlays: {len(base_overlays)}",
        f"- Hedge variants: {len(hedge_list())}",
        f"- Evaluations: {len(candidates)}",
        f"- 2023-2025 passed: {len(passed)}",
        f"- Robust hedge neighborhoods: {len(robust)}",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Selected",
        "",
    ]
    if result["selected"]:
        report.extend([
            f"- Base overlay: **{result['selected']['overlay']['overlay_id']}**",
            f"- Bear hedge: **{result['selected']['hedge']['hedge_id']}**",
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
        report.append("安定性Gateを通るBear Hedge構成はありませんでした。")
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
    (state_dir / "asymmetric-bear-hedge-rotation-v5.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "asymmetric-bear-hedge-rotation-v5.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
