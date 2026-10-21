from __future__ import annotations

import datetime as dt
import json
import os
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import research_lab_pengu_dual_engine_v39 as v39
import research_lab_pengu_long_completion_v40 as v40
import research_lab_pengu_recovery_dual_engine_v41 as v41

HOUR = v39.HOUR
DAY = v39.DAY
DECISION_HOURS = v39.DECISION_HOURS


@dataclass(frozen=True)
class ExitOverlay:
    max_hold_hours: int
    stop_atr: float
    take_atr: float
    failure_momentum_pct: float
    failure_sma: int

    @property
    def strategy_id(self) -> str:
        def fmt(value: float) -> str:
            return str(value).replace(".", "p").replace("-", "m")
        return (
            f"X42_H{self.max_hold_hours}_SL{fmt(self.stop_atr)}_TP{fmt(self.take_atr)}"
            f"_M{fmt(self.failure_momentum_pct)}_SMA{self.failure_sma}"
        )


def fixed_long_members() -> List[v41.RecoveryRule]:
    return [
        v41.RecoveryRule(
            "TREND_RESUME", 72, 12, 1.0, 72.0,
            48, 1.0, 0.8, 0.0003, "RISK",
            v39.ExitSpec("TIME24", 24),
        ),
        v41.RecoveryRule(
            "TREND_RESUME", 72, 12, 1.0, 72.0,
            48, 1.0, 0.8, 0.0008, "RISK",
            v39.ExitSpec("TIME24", 24),
        ),
        v41.RecoveryRule(
            "TREND_RESUME", 120, 12, 1.0, 72.0,
            48, 1.0, 0.8, 0.0003, "RISK",
            v39.ExitSpec("TIME24", 24),
        ),
    ]


def overlays() -> List[ExitOverlay]:
    result: List[ExitOverlay] = []
    for max_hold in [12, 18, 24, 36]:
        for stop in [1.0, 1.25, 1.5]:
            for take in [2.0, 2.5, 3.0]:
                for failure_momentum in [-2.0, -1.0, 0.0]:
                    for failure_sma in [0, 24, 48]:
                        result.append(ExitOverlay(max_hold, stop, take, failure_momentum, failure_sma))
    return result


def resolve_overlay_exit(
    overlay: ExitOverlay,
    pengu: v40.CachedSeries,
    btc: v40.CachedSeries,
    btc_index_by_ts: Dict[int, int],
    entry_index: int,
    entry_price: float,
    signal_atr: float,
) -> tuple[int, float, str]:
    end_index = min(len(pengu.rows) - 1, entry_index + overlay.max_hold_hours)
    stop = entry_price - overlay.stop_atr * signal_atr
    take = entry_price + overlay.take_atr * signal_atr
    for index in range(entry_index, end_index):
        if pengu.low[index] <= stop:
            return index, stop, "SL"
        if pengu.high[index] >= take:
            return index, take, "TP"
        held = index - entry_index + 1
        if held < 6 or held % 6 != 0:
            continue
        mom6 = pengu.momentum[6][index]
        close = pengu.close[index]
        sma_value = pengu.sma[overlay.failure_sma][index] if overlay.failure_sma else None
        momentum_failed = mom6 is not None and mom6 <= overlay.failure_momentum_pct
        trend_failed = overlay.failure_sma == 0 or (sma_value is not None and close < sma_value)
        btc_index = btc_index_by_ts.get(int(pengu.rows[index]["ts"]))
        btc_failed = btc_index is not None and not v39.btc_gate(1, "RISK", btc.rows, btc_index)
        if (momentum_failed and trend_failed) or btc_failed:
            exit_index = min(len(pengu.rows) - 1, index + 1)
            return exit_index, float(pengu.rows[exit_index]["open"]), "FAILURE"
    return end_index, float(pengu.rows[end_index]["open"]), "TIME"


def build_overlay_trades(
    overlay: ExitOverlay,
    members: List[v41.RecoveryRule],
    pengu: v40.CachedSeries,
    btc: v40.CachedSeries,
    funding: List[dict],
    funding_by_index: List[float],
) -> List[v39.Trade]:
    p_map = {int(row["ts"]): index for index, row in enumerate(pengu.rows)}
    b_map = {int(row["ts"]): index for index, row in enumerate(btc.rows)}
    common = sorted(set(p_map) & set(b_map))
    trades: List[v39.Trade] = []
    next_free = 0
    for ts in common:
        if ts < next_free or (ts // HOUR) % DECISION_HOURS != 0:
            continue
        pi = p_map[ts]
        bi = b_map[ts]
        votes = sum(v41.signal(rule, pengu, pi, btc, bi, funding_by_index) for rule in members)
        if votes < 2:
            continue
        entry_index = pi + 1
        if entry_index >= len(pengu.rows):
            continue
        entry_ts = int(pengu.rows[entry_index]["ts"])
        entry_price = float(pengu.rows[entry_index]["open"])
        signal_atr = pengu.atr[24][pi] or 0.0
        if signal_atr <= 0:
            continue
        exit_index, exit_price, reason = resolve_overlay_exit(
            overlay, pengu, btc, b_map, entry_index, entry_price, signal_atr,
        )
        exit_ts = int(pengu.rows[exit_index]["ts"])
        if exit_ts <= entry_ts:
            continue
        gross = (exit_price / entry_price - 1.0) * 100.0
        paid_funding = v39.funding_between(funding, entry_ts, exit_ts)
        held_days = max(1.0 / 24.0, (exit_ts - entry_ts) / DAY)
        base = gross - paid_funding - 0.12 - 0.02 * held_days
        severe = gross - paid_funding - 0.20 - 0.05 * held_days
        trades.append(v39.Trade(
            f"ENS41_{overlay.strategy_id}", entry_ts, exit_ts, 1,
            entry_price, exit_price, gross, paid_funding, base, severe, reason,
        ))
        next_free = exit_ts
    return trades


def metrics(trades: List[v39.Trade], start: int, end: int) -> dict:
    return v39.metrics(trades, start, end)


def preholdout_pass(item: dict) -> bool:
    full = item["preHoldout"]
    folds = item["folds"]
    return bool(
        full["trades"] >= 12
        and full["compoundedReturnPct"] > 0
        and (full["profitFactor"] or 0) >= 1.25
        and full["maxDrawdownPct"] >= -20
        and full["severeReturnPct"] > 0
        and (full["severeProfitFactor"] or 0) >= 1.15
        and sum(fold["compoundedReturnPct"] > 0 for fold in folds) >= 3
        and sum(fold["severeReturnPct"] > 0 for fold in folds) >= 3
        and min(fold["compoundedReturnPct"] for fold in folds) >= -5.0
    )


def holdout_pass(metric: dict) -> bool:
    return bool(
        metric["trades"] >= 3
        and metric["compoundedReturnPct"] > 0
        and (metric["profitFactor"] or 0) >= 1.0
        and metric["maxDrawdownPct"] >= -20
        and metric["severeReturnPct"] > 0
        and (metric["severeProfitFactor"] or 0) >= 1.0
    )


def neighbor(left: ExitOverlay, right: ExitOverlay) -> bool:
    return (
        abs(left.max_hold_hours - right.max_hold_hours) <= 6
        and abs(left.stop_atr - right.stop_atr) <= 0.26
        and abs(left.take_atr - right.take_atr) <= 0.51
        and abs(left.failure_momentum_pct - right.failure_momentum_pct) <= 1.01
        and (left.failure_sma == right.failure_sma or {left.failure_sma, right.failure_sma} <= {0, 24, 48})
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
    end = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000) // HOUR * HOUR
    state_dir = Path(os.environ.get("RESEARCH_AUTONOMOUS_STATE_DIR", ".research-state")).resolve()
    pengu_rows = v39.fetch_klines("PENGUUSDT", end)
    btc_rows = v39.fetch_klines("BTCUSDT", end)
    funding = v39.fetch_funding("PENGUUSDT", end)
    pengu = v40.build_cache(pengu_rows)
    btc = v40.build_cache(btc_rows)
    funding_by_index = v40.latest_funding_by_index(funding, pengu_rows)
    members = fixed_long_members()

    first = max(int(pengu_rows[0]["ts"]), int(btc_rows[0]["ts"])) + 360 * HOUR
    last = min(int(pengu_rows[-1]["ts"]), int(btc_rows[-1]["ts"]))
    span = last - first
    holdout_start = first + int(span * 0.80)
    fold_edges = [first + int((holdout_start - first) * step / 4) for step in range(5)]

    candidate_overlays = overlays()
    overlay_map = {overlay.strategy_id: overlay for overlay in candidate_overlays}
    trades_by_id: Dict[str, List[v39.Trade]] = {}
    results: Dict[str, dict] = {}
    passed: List[str] = []
    for overlay in candidate_overlays:
        trades = build_overlay_trades(overlay, members, pengu, btc, funding, funding_by_index)
        trades_by_id[overlay.strategy_id] = trades
        item = {
            "overlay": asdict(overlay),
            "preHoldout": metrics(trades, first, holdout_start),
            "folds": [metrics(trades, fold_edges[index], fold_edges[index + 1]) for index in range(4)],
        }
        results[overlay.strategy_id] = item
        if preholdout_pass(item):
            passed.append(overlay.strategy_id)

    stable = [
        strategy_id for strategy_id in passed
        if sum(1 for other in passed if other != strategy_id and neighbor(overlay_map[strategy_id], overlay_map[other])) >= 2
    ]
    stable.sort(key=lambda strategy_id: (
        statistics.median(fold["severeReturnPct"] for fold in results[strategy_id]["folds"]),
        min(fold["compoundedReturnPct"] for fold in results[strategy_id]["folds"]),
        results[strategy_id]["preHoldout"]["profitFactor"] or 0,
        results[strategy_id]["preHoldout"]["maxDrawdownPct"],
        -overlay_map[strategy_id].max_hold_hours,
    ), reverse=True)
    selected = stable[0] if stable else None
    long_trades = trades_by_id[selected] if selected else []
    long_holdout = metrics(long_trades, holdout_start, last + HOUR)
    long_passed = bool(selected and holdout_pass(long_holdout))

    short_rule = v39.Rule(
        -1, "BREAKDOWN", 6, 24, 0.0, 0.0, 0.8, 0.0, "RISK",
        v39.ExitSpec("TIME24", 24),
    )
    short_trades = v39.build_trades(short_rule, pengu_rows, btc_rows, funding)
    short_holdout = metrics(short_trades, holdout_start, last + HOUR)
    short_passed = holdout_pass(short_holdout)

    combined = v39.combine_trades(long_trades if long_passed else [], short_trades, 1.0, 1.0)
    combined_holdout = metrics(combined, holdout_start, last + HOUR)
    combined_full = metrics(combined, first, last + HOUR)
    combined_passed = bool(long_passed and short_passed and holdout_pass(combined_holdout))
    status = "PENGU_DUAL_ENGINE_V42_COMPLETE" if combined_passed else "PENGU_EXIT_V42_NOT_COMPLETE"

    payload = rounded({
        "version": 42,
        "strategyId": "PENGU_FAILURE_EXIT_DUAL_ENGINE_V42",
        "status": status,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "candidateCount": len(candidate_overlays),
        "preHoldoutPassedCount": len(passed),
        "stableCount": len(stable),
        "fixedLongMembers": [asdict(rule) for rule in members],
        "selectedExitOverlay": asdict(overlay_map[selected]) if selected else None,
        "selectedExitOverlayId": selected,
        "longPreHoldout": metrics(long_trades, first, holdout_start),
        "longFrozenHoldout": long_holdout,
        "longHoldoutPassed": long_passed,
        "shortRule": asdict(short_rule),
        "shortFrozenHoldout": short_holdout,
        "shortHoldoutPassed": short_passed,
        "combinedFrozenHoldout": combined_holdout,
        "combinedFull": combined_full,
        "combinedHoldoutPassed": combined_passed,
        "topStable": stable[:20],
        "topStableResults": {strategy_id: results[strategy_id] for strategy_id in stable[:20]},
        "selectedLongTrades": [asdict(trade) for trade in long_trades],
        "shortTrades": [asdict(trade) for trade in short_trades],
        "productionChanged": False,
        "realTradingEnabled": False,
        "limitations": [
            "The latest window is reused confirmation, not pristine forward evidence.",
            "Intrabar stop is evaluated before take profit when both are touched in the same hourly candle.",
            "V19 depth, spread, taker flow and basis remain forward-only vetoes.",
        ],
    })
    report = [
        "# PENGU Failure Exit Dual Engine V42",
        "",
        f"- Status: **{status}**",
        f"- Exit candidates: {len(candidate_overlays)}",
        f"- Pre-holdout passed: {len(passed)}",
        f"- Stable: {len(stable)}",
        f"- Selected exit: **{selected or 'NONE'}**",
        f"- Long holdout: {long_holdout['compoundedReturnPct']}% / PF {long_holdout['profitFactor']} / Severe {long_holdout['severeReturnPct']}%",
        f"- Short holdout: {short_holdout['compoundedReturnPct']}% / PF {short_holdout['profitFactor']} / Severe {short_holdout['severeReturnPct']}%",
        f"- Combined holdout: {combined_holdout['compoundedReturnPct']}% / PF {combined_holdout['profitFactor']} / Severe {combined_holdout['severeReturnPct']}%",
        f"- Combined full: {combined_full['compoundedReturnPct']}% / PF {combined_full['profitFactor']} / DD {combined_full['maxDrawdownPct']}%",
        "- Production changed: NO",
        "- Real trading: DISABLED",
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-failure-exit-dual-engine-v42.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    (state_dir / "pengu-failure-exit-dual-engine-v42.md").write_text(
        "\n".join(report), encoding="utf-8",
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
