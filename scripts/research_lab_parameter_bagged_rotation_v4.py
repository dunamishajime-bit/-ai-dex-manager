from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

HOUR = 3_600_000
DAY = 24 * HOUR
DATA_START = 1661990400000  # 2022-09-01 UTC
START_2023 = 1672531200000
START_2024 = 1704067200000
START_2025 = 1735689600000
START_2026 = 1767225600000
END = 1782864000000  # 2026-07-01 UTC
SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX"]
NORMAL_COST_BPS = 10.0
STRESS_COST_BPS = 30.0
BASE_ALLOCATION = 0.9


@dataclass(frozen=True)
class Component:
    model_id: str
    regime_days: int
    momentum_days: int
    rebalance_days: float
    top_k: int


@dataclass(frozen=True)
class Overlay:
    overlay_id: str
    vote_threshold: float
    slow_filter_days: int
    target_vol_pct: int
    max_gross: float
    crash_guard_20d_pct: Optional[int]


@dataclass
class Cycle:
    start_ts: int
    end_ts: int
    normal_pct: float
    stress_pct: float


def product_return(values: Iterable[float]) -> float:
    equity = 1.0
    for value in values:
        equity *= max(0.001, 1.0 + value / 100.0)
    return (equity - 1.0) * 100.0


def profit_factor(values: List[float]) -> Optional[float]:
    wins = sum(value for value in values if value > 0)
    losses = abs(sum(value for value in values if value < 0))
    if losses > 0:
        return wins / losses
    return 999.0 if wins > 0 else None


def median(values: List[float]) -> float:
    return statistics.median(values) if values else 0.0


def standard_deviation(values: List[float]) -> float:
    return statistics.pstdev(values) if len(values) >= 2 else 0.0


def load_symbol(cache_root: Path, symbol: str) -> dict:
    target = cache_root / "consolidated" / f"{symbol}USDT-{DATA_START}-{END}-v2.json"
    if not target.exists():
        matches = sorted((cache_root / "consolidated").glob(f"{symbol}USDT-{DATA_START}-{END}-*.json"))
        if not matches:
            raise FileNotFoundError(f"consolidated cache missing: {target}")
        target = matches[-1]
    return json.loads(target.read_text(encoding="utf-8"))


def resample_12h(candles: List[dict]) -> List[dict]:
    groups: Dict[int, List[dict]] = {}
    bucket_ms = 12 * HOUR
    for candle in candles:
        bucket = int(candle["ts"] // bucket_ms * bucket_ms)
        groups.setdefault(bucket, []).append(candle)
    rows: List[dict] = []
    for ts, items in sorted(groups.items()):
        if len(items) != 12:
            continue
        rows.append({
            "ts": ts,
            "open": float(items[0]["open"]),
            "high": max(float(item["high"]) for item in items),
            "low": min(float(item["low"]) for item in items),
            "close": float(items[-1]["close"]),
            "volume": sum(float(item.get("volume", 0)) for item in items),
        })
    return rows


def sma(rows: List[dict], end: int, length: int) -> Optional[float]:
    if length <= 0 or end - length + 1 < 0:
        return None
    return statistics.fmean(float(row["close"]) for row in rows[end - length + 1:end + 1])


def momentum(rows: List[dict], end: int, length: int) -> Optional[float]:
    prior = end - length
    if prior < 0 or float(rows[prior]["close"]) <= 0:
        return None
    return (float(rows[end]["close"]) / float(rows[prior]["close"]) - 1.0) * 100.0


def realized_annual_vol(rows: List[dict], end: int, length: int = 40) -> Optional[float]:
    if end - length < 0:
        return None
    returns: List[float] = []
    for index in range(end - length + 1, end + 1):
        previous = float(rows[index - 1]["close"])
        close = float(rows[index]["close"])
        if previous > 0 and close > 0:
            returns.append(math.log(close / previous))
    return standard_deviation(returns) * math.sqrt(730.0) * 100.0


def volume_ratio(rows: List[dict], end: int, recent: int = 20, base: int = 80) -> Optional[float]:
    if end - base + 1 < 0:
        return None
    recent_values = [float(row["volume"]) for row in rows[end - recent + 1:end + 1]]
    base_values = [float(row["volume"]) for row in rows[end - base + 1:end - recent + 1]]
    denominator = statistics.fmean(base_values) if base_values else 0.0
    return statistics.fmean(recent_values) / denominator if denominator > 0 else None


def funding_pct(points: List[dict], start_ts: int, end_ts: int) -> float:
    return sum(float(point["rate"]) * 100.0 for point in points if start_ts <= int(point["ts"]) < end_ts)


def parse_components(v3_result: dict) -> List[Component]:
    components: List[Component] = []
    for item in v3_result.get("topValidationPairs", []):
        model = item["development"]["model"]
        if int(item.get("neighborCount", 0)) < 3:
            continue
        if model.get("timeframeHours") != 12 or model.get("family") != "LONG_CASH" or model.get("universeId") != "CORE3":
            continue
        components.append(Component(
            model_id=model["id"],
            regime_days=int(model["regimeDays"]),
            momentum_days=int(model["momentumDays"]),
            rebalance_days=float(model["rebalanceDays"]),
            top_k=int(model["topK"]),
        ))
    unique = {component.model_id: component for component in components}
    result = list(unique.values())
    if len(result) < 3:
        raise RuntimeError(f"insufficient robust V3 components: {len(result)}")
    return result


def component_target(component: Component, ts: int, bars: Dict[str, List[dict]], indexes: Dict[str, Dict[int, int]]) -> Dict[str, float]:
    btc_index = indexes["BTC"].get(ts)
    if btc_index is None:
        return {}
    btc = bars["BTC"]
    regime_bars = component.regime_days * 2
    momentum_bars = component.momentum_days * 2
    asset_sma_bars = 44
    btc_average = sma(btc, btc_index, regime_bars)
    btc_momentum = momentum(btc, btc_index, momentum_bars)
    if btc_average is None or btc_momentum is None:
        return {}
    if not (float(btc[btc_index]["close"]) > btc_average and btc_momentum > 0):
        return {}

    candidates: List[Tuple[str, float]] = []
    breadth = 0
    for symbol in ["ETH", "BNB", "SOL"]:
        index = indexes[symbol].get(ts)
        if index is None:
            continue
        rows = bars[symbol]
        average = sma(rows, index, asset_sma_bars)
        symbol_momentum = momentum(rows, index, momentum_bars)
        vol = realized_annual_vol(rows, index, momentum_bars)
        volume = volume_ratio(rows, index)
        if average is None or symbol_momentum is None or vol is None or volume is None:
            continue
        close = float(rows[index]["close"])
        if close > average and symbol_momentum > 0:
            breadth += 1
            if volume >= 0.7:
                relative = symbol_momentum - btc_momentum
                score = symbol_momentum + relative * 0.3 - (vol / math.sqrt(36.5)) * 0.18 + min(2.0, volume)
                candidates.append((symbol, score))
    if breadth < 1 or not candidates:
        return {}
    selected = sorted(candidates, key=lambda item: item[1], reverse=True)[:component.top_k]
    each = BASE_ALLOCATION / len(selected)
    return {symbol: each for symbol, _ in selected}


def turnover(left: Dict[str, float], right: Dict[str, float]) -> float:
    return sum(abs(right.get(symbol, 0.0) - left.get(symbol, 0.0)) for symbol in set(left) | set(right))


def gross_exposure(weights: Dict[str, float]) -> float:
    return sum(abs(value) for value in weights.values())


def average_weights(member_weights: List[Dict[str, float]]) -> Dict[str, float]:
    if not member_weights:
        return {}
    symbols = set().union(*(weights.keys() for weights in member_weights))
    return {
        symbol: sum(weights.get(symbol, 0.0) for weights in member_weights) / len(member_weights)
        for symbol in symbols
        if abs(sum(weights.get(symbol, 0.0) for weights in member_weights)) > 1e-12
    }


def overlay_target(
    overlay: Overlay,
    ts: int,
    projected_members: List[Dict[str, float]],
    bars: Dict[str, List[dict]],
    indexes: Dict[str, Dict[int, int]],
) -> Dict[str, float]:
    exposed_votes = sum(1 for weights in projected_members if gross_exposure(weights) > 0)
    if exposed_votes / len(projected_members) < overlay.vote_threshold:
        return {}
    target = average_weights(projected_members)
    gross = gross_exposure(target)
    if gross <= 0:
        return {}
    btc_index = indexes["BTC"].get(ts)
    if btc_index is None:
        return {}
    btc = bars["BTC"]
    if overlay.slow_filter_days:
        slow = sma(btc, btc_index, overlay.slow_filter_days * 2)
        slow_momentum = momentum(btc, btc_index, 60)
        if slow is None or slow_momentum is None or not (float(btc[btc_index]["close"]) > slow and slow_momentum > 0):
            return {}
    if overlay.crash_guard_20d_pct is not None:
        recent = momentum(btc, btc_index, 40)
        if recent is None or recent <= overlay.crash_guard_20d_pct:
            return {}

    scale = 1.0
    if overlay.target_vol_pct > 0:
        vol = realized_annual_vol(btc, btc_index, 40)
        if vol is None or vol <= 0:
            return {}
        scale = overlay.target_vol_pct / vol
    scale = min(scale, overlay.max_gross / gross)
    return {symbol: weight * scale for symbol, weight in target.items() if abs(weight * scale) > 1e-12}


def overlay_list() -> List[Overlay]:
    result: List[Overlay] = []
    for vote in [0.5, 0.7]:
        for slow in [0, 90]:
            for target_vol in [0, 35, 45]:
                for max_gross in [0.9, 1.1]:
                    for crash_guard in [None, -10]:
                        guard = "NONE" if crash_guard is None else str(abs(crash_guard))
                        result.append(Overlay(
                            overlay_id=f"BAG_V{int(vote * 100)}_S{slow}_TV{target_vol}_G{max_gross}_C{guard}",
                            vote_threshold=vote,
                            slow_filter_days=slow,
                            target_vol_pct=target_vol,
                            max_gross=max_gross,
                            crash_guard_20d_pct=crash_guard,
                        ))
    return result


def group_compounded(rows: List[dict], key_fn) -> Dict[str, float]:
    groups: Dict[str, List[float]] = {}
    for row in rows:
        groups.setdefault(key_fn(int(row["ts"])), []).append(float(row["normal_pct"]))
    return {key: product_return(values) for key, values in groups.items()}


def metrics(rows: List[dict], cycles: List[Cycle], start: int, end: int) -> dict:
    normal = [float(row["normal_pct"]) for row in rows]
    stress = [float(row["stress_pct"]) for row in rows]
    cycle_normal = [cycle.normal_pct for cycle in cycles]
    cycle_stress = [cycle.stress_pct for cycle in cycles]
    equity = 1.0
    stress_equity = 1.0
    peak = 1.0
    stress_peak = 1.0
    max_dd = 0.0
    stress_dd = 0.0
    for normal_value, stress_value in zip(normal, stress):
        equity *= max(0.001, 1.0 + normal_value / 100.0)
        stress_equity *= max(0.001, 1.0 + stress_value / 100.0)
        peak = max(peak, equity)
        stress_peak = max(stress_peak, stress_equity)
        max_dd = min(max_dd, (equity / peak - 1.0) * 100.0)
        stress_dd = min(stress_dd, (stress_equity / stress_peak - 1.0) * 100.0)
    years = max(0.5, (end - start) / (365.25 * DAY))
    cagr = (max(0.001, equity) ** (1.0 / years) - 1.0) * 100.0
    stress_cagr = (max(0.001, stress_equity) ** (1.0 / years) - 1.0) * 100.0
    annual = group_compounded(rows, lambda ts: str(__import__("datetime").datetime.utcfromtimestamp(ts / 1000).year))
    half_year = group_compounded(rows, lambda ts: f"{__import__('datetime').datetime.utcfromtimestamp(ts / 1000).year}-H{1 if __import__('datetime').datetime.utcfromtimestamp(ts / 1000).month <= 6 else 2}")
    best = max(cycle_normal) if cycle_normal else None
    total_positive = sum(value for value in cycle_normal if value > 0)
    best_share = best / total_positive * 100.0 if best is not None and best > 0 and total_positive > 0 else None
    without_best = list(cycle_normal)
    if best is not None:
        without_best.remove(best)
    return {
        "cycles": len(cycles),
        "winRatePct": (sum(1 for value in cycle_normal if value > 0) / len(cycle_normal) * 100.0) if cycle_normal else None,
        "averageCyclePct": statistics.fmean(cycle_normal) if cycle_normal else None,
        "medianCyclePct": median(cycle_normal) if cycle_normal else None,
        "profitFactor": profit_factor(cycle_normal),
        "stressProfitFactor": profit_factor(cycle_stress),
        "compoundedReturnPct": (equity - 1.0) * 100.0,
        "stressCompoundedReturnPct": (stress_equity - 1.0) * 100.0,
        "cagrPct": cagr,
        "stressCagrPct": stress_cagr,
        "maxDrawdownPct": max_dd,
        "stressMaxDrawdownPct": stress_dd,
        "exposurePct": statistics.fmean(float(row["exposure"]) for row in rows) * 100.0 if rows else 0.0,
        "turnover": sum(float(row["turnover"]) for row in rows),
        "bestCyclePct": best,
        "worstCyclePct": min(cycle_normal) if cycle_normal else None,
        "bestCycleProfitSharePct": best_share,
        "profitFactorWithoutBest": profit_factor(without_best) if without_best else None,
        "annualReturnsPct": annual,
        "halfYearReturnsPct": half_year,
    }


def simulate(
    overlay: Overlay,
    components: List[Component],
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
        return metrics([], [], start, end)

    member_weights: List[Dict[str, float]] = [{} for _ in components]
    member_pending: List[Optional[Dict[str, float]]] = [None for _ in components]
    portfolio: Dict[str, float] = {}
    portfolio_pending: Optional[Dict[str, float]] = None
    rows: List[dict] = []
    cycles: List[Cycle] = []
    cycle_start = -1
    cycle_normal: List[float] = []
    cycle_stress: List[float] = []

    def close_cycle(end_ts: int) -> None:
        nonlocal cycle_start, cycle_normal, cycle_stress
        if cycle_start >= 0 and cycle_normal:
            cycles.append(Cycle(cycle_start, end_ts, product_return(cycle_normal), product_return(cycle_stress)))
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
                bar_turnover = turnover(portfolio, portfolio_pending)
                portfolio = portfolio_pending
                if gross_exposure(portfolio) > 0:
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
            funding_cost += weight * funding_pct(funding[symbol], ts, ts + 12 * HOUR)
        normal_pct = gross - funding_cost - bar_turnover * NORMAL_COST_BPS / 100.0
        stress_pct = gross - funding_cost - bar_turnover * STRESS_COST_BPS / 100.0
        rows.append({
            "ts": ts,
            "normal_pct": normal_pct,
            "stress_pct": stress_pct,
            "exposure": gross_exposure(portfolio),
            "turnover": bar_turnover,
        })
        if cycle_start >= 0:
            cycle_normal.append(normal_pct)
            cycle_stress.append(stress_pct)

        projected: List[Dict[str, float]] = []
        for member_index, component in enumerate(components):
            candidate = component_target(component, ts, bars, indexes)
            rebalance_bars = max(1, round(component.rebalance_days * 2))
            scheduled = round((ts - START_2023) / (12 * HOUR)) % rebalance_bars == 0
            regime_exit = gross_exposure(member_weights[member_index]) > 0 and gross_exposure(candidate) == 0
            if scheduled or regime_exit:
                member_pending[member_index] = candidate
                projected.append(candidate)
            else:
                projected.append(member_weights[member_index])
        portfolio_pending = overlay_target(overlay, ts, projected, bars, indexes)

    final_turnover = gross_exposure(portfolio)
    if final_turnover > 0 and rows:
        rows[-1]["normal_pct"] -= final_turnover * NORMAL_COST_BPS / 100.0
        rows[-1]["stress_pct"] -= final_turnover * STRESS_COST_BPS / 100.0
        rows[-1]["turnover"] += final_turnover
        if cycle_normal:
            cycle_normal[-1] -= final_turnover * NORMAL_COST_BPS / 100.0
            cycle_stress[-1] -= final_turnover * STRESS_COST_BPS / 100.0
    close_cycle(end - 1)
    return metrics(rows, cycles, start, end)


def rounded(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def historical_pass(item: dict) -> bool:
    metrics_all = item["history"]
    annual = metrics_all["annualReturnsPct"]
    halves = list(metrics_all["halfYearReturnsPct"].values())
    return (
        metrics_all["cycles"] >= 35
        and metrics_all["cagrPct"] >= 20
        and (metrics_all["profitFactor"] or 0) >= 1.2
        and (metrics_all["stressProfitFactor"] or 0) >= 1.05
        and metrics_all["maxDrawdownPct"] >= -30
        and all(annual.get(year, -100) > 0 for year in ["2023", "2024", "2025"])
        and sum(1 for value in halves if value > 0) >= 5
        and (metrics_all["bestCycleProfitSharePct"] or 100) <= 35
        and (metrics_all["profitFactorWithoutBest"] or 0) >= 1.1
    )


def final_pass(metrics_final: dict) -> bool:
    return (
        metrics_final["cycles"] >= 5
        and metrics_final["compoundedReturnPct"] > 0
        and metrics_final["stressCompoundedReturnPct"] > 0
        and (metrics_final["profitFactor"] or 0) >= 1.0
        and (metrics_final["stressProfitFactor"] or 0) >= 0.95
        and metrics_final["maxDrawdownPct"] >= -15
        and (metrics_final["bestCycleProfitSharePct"] or 100) <= 50
        and (metrics_final["profitFactorWithoutBest"] or 0) >= 0.8
    )


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    v3_result = json.loads((state_dir / "multi-horizon-regime-rotation-v3.json").read_text(encoding="utf-8"))
    components = parse_components(v3_result)
    cache_root = Path.cwd() / ".cache" / "perp-research-usdm"
    raw = {symbol: load_symbol(cache_root, symbol) for symbol in SYMBOLS}
    bars = {symbol: resample_12h(raw[symbol]["candles"]) for symbol in SYMBOLS}
    indexes = {symbol: {int(bar["ts"]): index for index, bar in enumerate(rows)} for symbol, rows in bars.items()}
    funding = {symbol: raw[symbol]["funding"] for symbol in SYMBOLS}

    candidates: List[dict] = []
    for overlay in overlay_list():
        history = simulate(overlay, components, bars, indexes, funding, START_2023, START_2026)
        candidates.append({"overlay": overlay.__dict__, "history": history})
    passed = [item for item in candidates if historical_pass(item)]

    def selection_key(item: dict):
        annual = item["history"]["annualReturnsPct"]
        worst_year = min(annual.get(year, -100) for year in ["2023", "2024", "2025"])
        return (worst_year, item["history"]["stressCagrPct"], item["history"]["profitFactorWithoutBest"] or 0, -item["history"]["turnover"])

    passed.sort(key=selection_key, reverse=True)
    selected = passed[0] if passed else None
    final_2026 = None
    if selected:
        overlay = Overlay(**selected["overlay"])
        final_2026 = simulate(overlay, components, bars, indexes, funding, START_2026, END)
    passed_final = final_pass(final_2026) if final_2026 else False
    status = "PAPER_CANDIDATE_ONLY_ADAPTIVE" if passed_final else ("FINAL_TEMPORAL_STRESS_REJECTED" if selected else "NO_STABLE_2023_2025_ENSEMBLE")

    result = {
        "version": 4,
        "strategyId": "PARAMETER_BAGGED_ROTATION_V4",
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "status": status,
        "productionChanged": False,
        "realTradingEnabled": False,
        "components": [component.__dict__ for component in components],
        "source": {
            "v3Fingerprint": v3_result.get("fingerprint"),
            "componentCount": len(components),
            "overlayCandidates": len(candidates),
            "historyPassed": len(passed),
            "historyPeriod": [START_2023, START_2026],
            "finalTemporalStressPeriod": [START_2026, END],
        },
        "selected": {
            **selected,
            "final2026H1": final_2026,
            "finalPassed": passed_final,
            "paperEligible": passed_final,
            "liveEligible": False,
            "liveBlockReasons": [
                "V4はV3 Holdout確認後に設計されたadaptive研究で完全未使用OOSではない",
                "Forward Paper 100 trades未達",
                "Aster実約定Spread/Slippage未検証",
                "通貨別Forward 30 trades未達",
            ],
        } if selected else None,
        "topHistorical": passed[:10] if passed else sorted(candidates, key=selection_key, reverse=True)[:10],
        "fingerprint": hashlib.sha256(json.dumps({
            "components": [component.__dict__ for component in components],
            "overlays": [overlay.__dict__ for overlay in overlay_list()],
            "periods": [START_2023, START_2026, END],
        }, sort_keys=True).encode()).hexdigest(),
        "limitations": [
            "V4はV3の2025-2026 Holdout結果確認後に導入したため、2026H1を完全未使用OOSとは呼ばない。",
            "Validation通過した近接パラメータ群を等ウェイト合成し、単一パラメータ依存を軽減する。",
            "2023-2025の全3年プラス、5/6半期プラス、外れ値除外後PFを事前Gateとする。",
            "候補になってもForward Paper専用で、Liveは禁止する。",
            "本番コード、VPS、.env、実売買runnerは変更していない。",
        ],
    }
    result = rounded(result)

    def line(label: str, item: dict) -> str:
        return (
            f"| {label} | {item['cycles']} | {item['winRatePct'] if item['winRatePct'] is not None else '—'}% | "
            f"{item['cagrPct']}% | {item['stressCagrPct']}% | {item['profitFactor']} | {item['stressProfitFactor']} | "
            f"{item['compoundedReturnPct']}% | {item['maxDrawdownPct']}% | {item['bestCycleProfitSharePct']}% | {item['profitFactorWithoutBest']} |"
        )

    report = [
        "# Parameter-Bagged Rotation V4",
        "",
        f"- Status: **{status}**",
        f"- V3 robust components: {len(components)}",
        f"- Overlay candidates: {len(candidates)}",
        f"- 2023-2025 stable candidates: {len(passed)}",
        "- Production changed: NO",
        "- Real trading: DISABLED",
        "",
        "## Design",
        "",
        "- V3で2023/2024を通過した近接モデル群を等ウェイト合成",
        "- Component vote threshold",
        "- 90-day slow trend confirmation",
        "- 35% / 45% volatility target",
        "- 0.9x / 1.1x gross cap",
        "- 20-day crash guard",
        "- 2023-2025で選定、2026H1は最終temporal stress",
        "",
        "## Selected",
        "",
    ]
    if result["selected"]:
        report.extend([
            f"- Overlay: **{result['selected']['overlay']['overlay_id']}**",
            f"- Final 2026H1 pass: **{'YES' if result['selected']['finalPassed'] else 'NO'}**",
            f"- Paper eligible: **{'YES' if result['selected']['paperEligible'] else 'NO'}**",
            "",
            "| Window | N | Win | CAGR | Stress CAGR | PF | Stress PF | Compound | DD | Best share | PF ex-best |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            line("2023-2025", result["selected"]["history"]),
            line("2026H1", result["selected"]["final2026H1"]),
        ])
    else:
        report.append("2023-2025の安定性Gateを通過するbagged overlayはありませんでした。")
    report.extend([
        "",
        "## Verdict",
        "",
        "Forward Paperへ進める研究候補が残りました。Liveは引き続き禁止です。" if passed_final else "新しいPaper候補はありません。Liveは引き続き禁止です。",
        "",
        "## Limitations",
        "",
        *[f"- {item}" for item in result["limitations"]],
    ])

    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "parameter-bagged-rotation-v4.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (state_dir / "parameter-bagged-rotation-v4.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
