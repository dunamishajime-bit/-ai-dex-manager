from __future__ import annotations

import datetime as dt
import itertools
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import research_lab_pengu_v57_extended_bt as common
import research_lab_pengu_v57_extended_bt_v3 as archive_source
import research_lab_pengu_wave_sleeve_v47 as v47
import research_lab_pengu_wave_sleeve_v49 as v49
import research_lab_pengu_wave_sleeve_v50 as v50
import research_lab_pengu_wave_sleeve_v52 as v52
import research_lab_pengu_wave_sleeve_v56 as v56

HOUR = v47.HOUR

v49.EXIT_PROFILES = tuple(v49.EXIT_PROFILES) + tuple(
    profile
    for profile in (v49.ExitProfile("RUN48", 2.2, 4.0, 4.0, 48),)
    if profile.name not in {item.name for item in v49.EXIT_PROFILES}
)

FLASH = v52.Candidate(-1, "FLASH", 6, 2.0, 5.0, 0.0, 0.8, 1.0, 1.0, 0.4, 2, "RUN48")
DISTRIBUTION = v52.Candidate(-1, "DISTRIBUTION", 6, 1.4, 1.0, 1.5, 0.5, 0.6, 0.5, 0.2, 1, "WIDE")
LONG_BREAK = v50.Candidate(1, "BREAK", 6, 0.35, 2.0, 0.5, 1.1, 1.0, 2.2, 0.4, "WIDE")
WASHOUT = v56.WashoutScout(1, "WASHOUT", 6, 1.0, 1.5, 0.0, 0.3, 0.4, 9.0, 0.2, 1, "FAST", -3.0, -8.0, 0.30)


@dataclass(frozen=True)
class FlashGate:
    min_rv24: float
    min_atr24_pct: float
    min_volume: float
    min_volatility_expansion: float
    min_down_mom3: float
    max_drawdown24_pct: float

    @property
    def gate_id(self) -> str:
        return (
            f"FLASH_RV{self.min_rv24:g}_ATR{self.min_atr24_pct:g}"
            f"_VOL{self.min_volume:g}_VX{self.min_volatility_expansion:g}"
            f"_M3{self.min_down_mom3:g}_DD{self.max_drawdown24_pct:g}"
        ).replace(".", "p").replace("-", "N")


@dataclass(frozen=True)
class LongBreakGate:
    min_rv24: float
    min_atr24_pct: float
    min_volume: float
    min_volatility_expansion: float
    min_mom3: float
    min_relative3: float

    @property
    def gate_id(self) -> str:
        return (
            f"LONG_RV{self.min_rv24:g}_ATR{self.min_atr24_pct:g}"
            f"_VOL{self.min_volume:g}_VX{self.min_volatility_expansion:g}"
            f"_M3{self.min_mom3:g}_REL{self.min_relative3:g}"
        ).replace(".", "p")


@dataclass(frozen=True)
class WashoutGate:
    min_rv24: float
    min_atr24_pct: float
    min_volume: float
    min_volatility_expansion: float
    max_mom3: float
    max_drawdown24_pct: float

    @property
    def gate_id(self) -> str:
        return (
            f"WASH_RV{self.min_rv24:g}_ATR{self.min_atr24_pct:g}"
            f"_VOL{self.min_volume:g}_VX{self.min_volatility_expansion:g}"
            f"_M3{self.max_mom3:g}_DD{self.max_drawdown24_pct:g}"
        ).replace(".", "p").replace("-", "N")


def flash_gates() -> List[FlashGate]:
    return [FlashGate(*row) for row in itertools.product(
        (0.0, 1.5, 2.0, 2.5),
        (0.0, 2.0, 3.0),
        (0.8, 1.2, 1.6),
        (1.0, 1.2, 1.5),
        (5.0, 7.0, 10.0),
        (0.0, -3.0, -6.0),
    )]


def long_break_gates() -> List[LongBreakGate]:
    return [LongBreakGate(*row) for row in itertools.product(
        (0.0, 1.0, 1.5, 2.0),
        (0.0, 1.5, 2.5),
        (1.1, 1.5, 2.0),
        (1.0, 1.2, 1.5),
        (2.0, 3.0, 4.0),
        (0.5, 1.0, 1.5),
    )]


def washout_gates() -> List[WashoutGate]:
    return [WashoutGate(*row) for row in itertools.product(
        (0.0, 1.0, 1.5, 2.0),
        (0.0, 1.5, 2.5),
        (0.3, 0.8, 1.2),
        (0.4, 0.8, 1.0),
        (-3.0, -4.0, -5.0),
        (-8.0, -10.0, -12.0),
    )]


def rolling_std(values: List[float], length: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    for index in range(length - 1, len(values)):
        result[index] = statistics.pstdev(values[index - length + 1:index + 1])
    return result


def extra_features(rows: List[dict], features: dict) -> dict:
    close = [float(row["close"]) for row in rows]
    returns = [0.0]
    for index in range(1, len(close)):
        returns.append((close[index] / close[index - 1] - 1.0) * 100.0)
    atr24 = features["atr24"]
    drawdown24: List[Optional[float]] = [None] * len(rows)
    for index in range(24, len(rows)):
        high = max(float(row["high"]) for row in rows[index - 24:index])
        drawdown24[index] = (close[index] / high - 1.0) * 100.0 if high > 0 else None
    return {
        "rv24": rolling_std(returns, 24),
        "atr24Pct": [
            value / close[index] * 100.0 if value is not None and close[index] > 0 else None
            for index, value in enumerate(atr24)
        ],
        "drawdown24": drawdown24,
    }


def context_for_trade(trade: v50.Trade, index_by_ts: Dict[int, int], features: dict, extra: dict) -> dict:
    index = index_by_ts[int(trade.signal_ts)]
    return {
        "rv24": extra["rv24"][index],
        "atr24Pct": extra["atr24Pct"][index],
        "drawdown24Pct": extra["drawdown24"][index],
        "mom1": features["mom1"][index],
        "mom3": features["mom3"][index],
        "relative3": features["relative3"][index],
        "volumeAcceleration": features["volumeAcceleration"][index],
        "volatilityExpansion": features["volatilityExpansion"][index],
    }


def passes_flash_gate(gate: FlashGate, context: dict) -> bool:
    values = tuple(context[key] for key in (
        "rv24", "atr24Pct", "volumeAcceleration", "volatilityExpansion", "mom3", "drawdown24Pct"
    ))
    if any(value is None for value in values):
        return False
    return bool(
        float(context["rv24"]) >= gate.min_rv24
        and float(context["atr24Pct"]) >= gate.min_atr24_pct
        and float(context["volumeAcceleration"]) >= gate.min_volume
        and float(context["volatilityExpansion"]) >= gate.min_volatility_expansion
        and -float(context["mom3"]) >= gate.min_down_mom3
        and float(context["drawdown24Pct"]) <= gate.max_drawdown24_pct
    )


def passes_long_gate(gate: LongBreakGate, context: dict) -> bool:
    values = tuple(context[key] for key in (
        "rv24", "atr24Pct", "volumeAcceleration", "volatilityExpansion", "mom3", "relative3"
    ))
    if any(value is None for value in values):
        return False
    return bool(
        float(context["rv24"]) >= gate.min_rv24
        and float(context["atr24Pct"]) >= gate.min_atr24_pct
        and float(context["volumeAcceleration"]) >= gate.min_volume
        and float(context["volatilityExpansion"]) >= gate.min_volatility_expansion
        and float(context["mom3"]) >= gate.min_mom3
        and float(context["relative3"]) >= gate.min_relative3
    )


def passes_washout_gate(gate: WashoutGate, context: dict) -> bool:
    values = tuple(context[key] for key in (
        "rv24", "atr24Pct", "volumeAcceleration", "volatilityExpansion", "mom3", "drawdown24Pct"
    ))
    if any(value is None for value in values):
        return False
    return bool(
        float(context["rv24"]) >= gate.min_rv24
        and float(context["atr24Pct"]) >= gate.min_atr24_pct
        and float(context["volumeAcceleration"]) >= gate.min_volume
        and float(context["volatilityExpansion"]) >= gate.min_volatility_expansion
        and float(context["mom3"]) <= gate.max_mom3
        and float(context["drawdown24Pct"]) <= gate.max_drawdown24_pct
    )


def filter_trades(trades: List[v50.Trade], contexts: Dict[int, dict], gate, predicate) -> List[v50.Trade]:
    return [trade for trade in trades if predicate(gate, contexts[int(trade.signal_ts)])]


def combine_same_side(*groups: List[v50.Trade]) -> List[v50.Trade]:
    tagged = []
    for priority, group in enumerate(groups):
        tagged.extend((trade.entry_ts, priority, trade) for trade in group)
    tagged.sort(key=lambda row: (row[0], row[1]))
    result: List[v50.Trade] = []
    next_free = 0
    for _, _, trade in tagged:
        if trade.entry_ts < next_free:
            continue
        result.append(trade)
        next_free = trade.exit_ts
    return result


def folds_for(rows: List[dict]) -> List[Tuple[int, int]]:
    return v50.fold_bounds(rows, 5)


def metrics(trades: List[v50.Trade], start: int, end: int, severe: bool = False) -> dict:
    return v50.metrics(trades, start, end, severe)


def split_metrics(trades: List[v50.Trade], folds: List[Tuple[int, int]]) -> dict:
    return {
        "train": metrics(trades, folds[0][0], folds[2][1]),
        "trainSevere": metrics(trades, folds[0][0], folds[2][1], True),
        "validation": metrics(trades, folds[3][0], folds[3][1]),
        "validationSevere": metrics(trades, folds[3][0], folds[3][1], True),
        "holdout": metrics(trades, folds[4][0], folds[4][1]),
        "holdoutSevere": metrics(trades, folds[4][0], folds[4][1], True),
        "full": metrics(trades, folds[0][0], folds[-1][1]),
        "fullSevere": metrics(trades, folds[0][0], folds[-1][1], True),
    }


def exclude(trades: List[v50.Trade], events: List[dict]) -> List[v50.Trade]:
    result, _ = common.exclude_large_wave_profits(trades, events)
    return result


def selection_events(pengu: List[dict], folds: List[Tuple[int, int]]) -> List[dict]:
    cutoff = folds[3][1]
    return [
        event for event in [*v50.wave_events(pengu, 24, 20.0), *v50.wave_events(pengu, 72, 35.0)]
        if int(event["startTs"]) < cutoff
    ]


def capture(trades: List[v50.Trade], events: List[dict], side: int) -> dict:
    selected = [event for event in events if int(event["side"]) == side]
    audit = v50.capture_metrics(trades, selected, 12, side)
    return {
        "events": audit["events"],
        "captured": audit["capturedEvents"],
        "early": audit["earlyCapturedEvents"],
        "profitable": audit["profitableCapturedEvents"],
        "details": audit["details"],
    }


def selection_pass(included: dict, excluded_metrics: dict, wave: dict, min_trades: int) -> bool:
    return bool(
        included["train"]["trades"] >= min_trades
        and included["train"]["compoundedReturnPct"] > 0
        and included["trainSevere"]["compoundedReturnPct"] > 0
        and included["validation"]["trades"] >= 2
        and included["validation"]["compoundedReturnPct"] > 0
        and included["validationSevere"]["compoundedReturnPct"] >= 0
        and excluded_metrics["train"]["compoundedReturnPct"] > 0
        and excluded_metrics["trainSevere"]["compoundedReturnPct"] > 0
        and excluded_metrics["validation"]["compoundedReturnPct"] >= 0
        and excluded_metrics["validationSevere"]["compoundedReturnPct"] >= -0.10
        and wave["events"] > 0
        and wave["captured"] / wave["events"] >= 0.50
        and wave["profitable"] / wave["events"] >= 0.50
    )


def rank_key(item: dict) -> tuple:
    return (
        item["excluded"]["validationSevere"]["compoundedReturnPct"],
        item["included"]["validationSevere"]["compoundedReturnPct"],
        item["wave"]["early"],
        item["wave"]["profitable"],
        item["excluded"]["trainSevere"]["compoundedReturnPct"],
        item["included"]["trainSevere"]["compoundedReturnPct"],
    )


def search_flash_router(
    distribution: List[v50.Trade],
    flash: List[v50.Trade],
    contexts: Dict[int, dict],
    folds: List[Tuple[int, int]],
    events: List[dict],
) -> dict:
    passed = []
    diagnostics = []
    for gate in flash_gates():
        routed = filter_trades(flash, contexts, gate, passes_flash_gate)
        combined = combine_same_side(distribution, routed)
        included = split_metrics(combined, folds)
        excluded_metrics = split_metrics(exclude(combined, events), folds)
        wave = capture(combined, events, -1)
        item = {
            "gate": asdict(gate), "gateId": gate.gate_id,
            "routedFlashTrades": len(routed), "included": included,
            "excluded": excluded_metrics, "wave": wave,
            "trades": [asdict(trade) for trade in combined],
        }
        diagnostics.append(item)
        if selection_pass(included, excluded_metrics, wave, 12):
            passed.append(item)
    passed.sort(key=rank_key, reverse=True)
    diagnostics.sort(key=rank_key, reverse=True)
    return {"candidateCount": len(flash_gates()), "passed": len(passed), "selected": passed[0] if passed else None, "topDiagnostics": diagnostics[:20]}


def search_long_router(
    base_long: List[v50.Trade],
    washout: List[v50.Trade],
    contexts: Dict[int, dict],
    folds: List[Tuple[int, int]],
    events: List[dict],
) -> dict:
    base_rows = []
    for gate in long_break_gates():
        routed = filter_trades(base_long, contexts, gate, passes_long_gate)
        included = split_metrics(routed, folds)
        excluded_metrics = split_metrics(exclude(routed, events), folds)
        wave = capture(routed, events, 1)
        item = {"gate": asdict(gate), "gateId": gate.gate_id, "included": included, "excluded": excluded_metrics, "wave": wave, "trades": [asdict(t) for t in routed]}
        if selection_pass(included, excluded_metrics, wave, 6):
            base_rows.append(item)
    wash_rows = []
    for gate in washout_gates():
        routed = filter_trades(washout, contexts, gate, passes_washout_gate)
        included = split_metrics(routed, folds)
        excluded_metrics = split_metrics(exclude(routed, events), folds)
        wave = capture(routed, events, 1)
        item = {"gate": asdict(gate), "gateId": gate.gate_id, "included": included, "excluded": excluded_metrics, "wave": wave, "trades": [asdict(t) for t in routed]}
        if selection_pass(included, excluded_metrics, wave, 3):
            wash_rows.append(item)
    base_rows.sort(key=rank_key, reverse=True)
    wash_rows.sort(key=rank_key, reverse=True)
    combinations = []
    base_options = [None, *base_rows[:20]]
    wash_options = [None, *wash_rows[:20]]
    for base_item, wash_item in itertools.product(base_options, wash_options):
        if base_item is None and wash_item is None:
            continue
        base_trades = [v50.Trade(**row) for row in base_item["trades"]] if base_item else []
        wash_trades = [v50.Trade(**row) for row in wash_item["trades"]] if wash_item else []
        combined = combine_same_side(wash_trades, base_trades)
        included = split_metrics(combined, folds)
        excluded_metrics = split_metrics(exclude(combined, events), folds)
        wave = capture(combined, events, 1)
        item = {
            "baseGateId": base_item["gateId"] if base_item else None,
            "washoutGateId": wash_item["gateId"] if wash_item else None,
            "included": included, "excluded": excluded_metrics, "wave": wave,
            "trades": [asdict(t) for t in combined],
        }
        if selection_pass(included, excluded_metrics, wave, 6):
            combinations.append(item)
    combinations.sort(key=rank_key, reverse=True)
    return {
        "baseGateCandidates": len(long_break_gates()), "basePassed": len(base_rows),
        "washoutGateCandidates": len(washout_gates()), "washoutPassed": len(wash_rows),
        "combinationPassed": len(combinations), "selected": combinations[0] if combinations else None,
        "topBase": base_rows[:10], "topWashout": wash_rows[:10], "topCombinations": combinations[:20],
    }


def rebuild(item: Optional[dict]) -> List[v50.Trade]:
    return [] if not item else [v50.Trade(**row) for row in item["trades"]]


def full_portfolio(long_trades: List[v50.Trade], short_trades: List[v50.Trade], pengu: List[dict], folds: List[Tuple[int, int]]) -> dict:
    combined = v50.combine_sides(long_trades, short_trades)
    events = [*v50.wave_events(pengu, 24, 20.0), *v50.wave_events(pengu, 72, 35.0)]
    excluded_rows, exclusion = common.exclude_large_wave_profits(combined, events)
    return {
        "included": split_metrics(combined, folds),
        "excluded": split_metrics(excluded_rows, folds),
        "wave24": v50.capture_metrics(combined, v50.wave_events(pengu, 24, 20.0), 6),
        "wave72": v50.capture_metrics(combined, v50.wave_events(pengu, 72, 35.0), 12),
        "exclusion": exclusion,
        "trades": [asdict(t) for t in combined],
        "excludedTrades": [asdict(t) for t in excluded_rows],
    }


def rounded(value):
    return v50.rounded(value)


def main() -> None:
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    now = dt.datetime.now(dt.timezone.utc)
    last_complete = archive_source.previous_complete_month(now)
    months = list(archive_source.iter_months(archive_source.ARCHIVE_START, last_complete))
    pengu, pengu_months = archive_source.fetch_archive_klines("PENGUUSDT", months)
    relevant = archive_source.month_pairs(pengu_months)
    btc, _ = archive_source.fetch_archive_klines("BTCUSDT", relevant)
    funding, funding_months = archive_source.fetch_archive_funding("PENGUUSDT", relevant)
    pengu, btc, funding, _ = archive_source.trim_to_complete_funding_window(pengu, btc, funding, funding_months)
    pengu, btc = common.intersect_rows(pengu, btc)
    features = v52.prepare_features(pengu, btc)
    extra = extra_features(pengu, features)
    index_by_ts = {int(row["ts"]): index for index, row in enumerate(pengu)}
    folds = folds_for(pengu)
    events = selection_events(pengu, folds)

    flash, _ = v52.run_candidate(FLASH, pengu, btc, funding, features)
    distribution, _ = v52.run_candidate(DISTRIBUTION, pengu, btc, funding, features)
    base_long, _ = v50.run_candidate(LONG_BREAK, pengu, btc, funding, features)
    washout, _ = v56.run_candidate(WASHOUT, pengu, btc, funding, features)
    all_trades = [*flash, *distribution, *base_long, *washout]
    contexts = {int(trade.signal_ts): context_for_trade(trade, index_by_ts, features, extra) for trade in all_trades}

    short_search = search_flash_router(distribution, flash, contexts, folds, events)
    long_search = search_long_router(base_long, washout, contexts, folds, events)
    selected_short = rebuild(short_search["selected"])
    selected_long = rebuild(long_search["selected"])
    portfolio = full_portfolio(selected_long, selected_short, pengu, folds)

    short_holdout = split_metrics(selected_short, folds)
    long_holdout = split_metrics(selected_long, folds)
    short_enabled = bool(
        selected_short
        and short_holdout["holdout"]["trades"] >= 3
        and short_holdout["holdout"]["compoundedReturnPct"] > 0
        and short_holdout["holdoutSevere"]["compoundedReturnPct"] > 0
    )
    long_enabled = bool(
        selected_long
        and long_holdout["holdout"]["trades"] >= 2
        and long_holdout["holdout"]["compoundedReturnPct"] > 0
        and long_holdout["holdoutSevere"]["compoundedReturnPct"] > 0
    )
    enabled_portfolio = full_portfolio(
        selected_long if long_enabled else [],
        selected_short if short_enabled else [],
        pengu,
        folds,
    )
    h = enabled_portfolio["included"]["holdout"]
    hs = enabled_portfolio["included"]["holdoutSevere"]
    he = enabled_portfolio["excluded"]["holdout"]
    hes = enabled_portfolio["excluded"]["holdoutSevere"]
    holdout_pass = bool(
        h["trades"] >= 3 and h["compoundedReturnPct"] > 0 and hs["compoundedReturnPct"] > 0
        and he["compoundedReturnPct"] > 0 and hes["compoundedReturnPct"] > 0
    )
    status = (
        "BOTH_ROUTED_ENABLED" if long_enabled and short_enabled and holdout_pass
        else "SHORT_ROUTED_ENABLED" if short_enabled and holdout_pass
        else "LONG_ROUTED_ENABLED" if long_enabled and holdout_pass
        else "NO_ROBUST_ROUTER"
    )
    result = rounded({
        "version": 59, "strategyId": "PENGU_V59_OBSERVABLE_REGIME_ROUTER",
        "generatedAt": now.isoformat(), "status": status,
        "shortSearch": short_search, "longSearch": long_search,
        "shortEnabledAfterHoldout": short_enabled, "longEnabledAfterHoldout": long_enabled,
        "selectionPortfolio": portfolio, "enabledPortfolio": enabled_portfolio,
        "holdoutPassed": holdout_pass,
        "safety": {"productionChanged": False, "liveChanged": False, "vpsChanged": False, "ordersSent": False, "holdoutUsedForRouterSelection": False},
        "limitations": [
            "Router selection used only signal-time observable features from the first 80% of the archive.",
            "The final 20% was used only for acceptance or rejection of each side.",
            "The operator had already observed aggregate V57/V58 archive results, so this is not pristine human-blind evidence.",
        ],
    })
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-v59-regime-router.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report = [
        "# PENGU V59 Observable Regime Router", "", f"- Status: **{status}**",
        f"- Short router selected: **{short_search['selected']['gateId'] if short_search['selected'] else 'NONE'}**",
        f"- Long router selected: **{'YES' if long_search['selected'] else 'NONE'}**",
        f"- Short enabled after Holdout: **{'YES' if short_enabled else 'NO'}**",
        f"- Long enabled after Holdout: **{'YES' if long_enabled else 'NO'}**",
        f"- Enabled Holdout pass: **{'YES' if holdout_pass else 'NO'}**",
        "", "## Enabled portfolio",
        f"- Full included: {enabled_portfolio['included']['full']['compoundedReturnPct']}% / PF {enabled_portfolio['included']['full']['profitFactor']} / DD {enabled_portfolio['included']['full']['maxDrawdownPct']}%",
        f"- Full included Severe: {enabled_portfolio['included']['fullSevere']['compoundedReturnPct']}%",
        f"- Full waves excluded: {enabled_portfolio['excluded']['full']['compoundedReturnPct']}% / PF {enabled_portfolio['excluded']['full']['profitFactor']} / DD {enabled_portfolio['excluded']['full']['maxDrawdownPct']}%",
        f"- Full excluded Severe: {enabled_portfolio['excluded']['fullSevere']['compoundedReturnPct']}%",
        f"- Holdout included: {h['compoundedReturnPct']}%",
        f"- Holdout included Severe: {hs['compoundedReturnPct']}%",
        f"- Holdout excluded: {he['compoundedReturnPct']}%",
        f"- Holdout excluded Severe: {hes['compoundedReturnPct']}%",
        f"- 24h waves early: {enabled_portfolio['wave24']['earlyCapturedEvents']}/{enabled_portfolio['wave24']['events']}",
        f"- 72h waves early: {enabled_portfolio['wave72']['earlyCapturedEvents']}/{enabled_portfolio['wave72']['events']}",
        "", "- Production / LIVE / VPS changed: **NO**",
    ]
    (state_dir / "pengu-v59-regime-router.md").write_text("\n".join(report), encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
