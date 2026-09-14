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
class RegimeGate:
    sma_length: int
    slope_lookback: int
    momentum_length: int
    momentum_threshold: float
    relative_length: int
    relative_threshold: float

    @property
    def strategy_id(self) -> str:
        def fmt(value: float) -> str:
            return str(value).replace(".", "p").replace("-", "m")
        return (
            f"G44_SMA{self.sma_length}_SL{self.slope_lookback}"
            f"_M{self.momentum_length}_{fmt(self.momentum_threshold)}"
            f"_R{self.relative_length}_{fmt(self.relative_threshold)}"
        )


def gates() -> List[RegimeGate]:
    result: List[RegimeGate] = []
    for sma_length in [168, 240, 336, 480]:
        for slope_lookback in [24, 48, 72]:
            for momentum_length in [72, 120, 168, 240]:
                for momentum_threshold in [-2.0, 0.0, 2.0]:
                    for relative_length in [72, 120, 168]:
                        for relative_threshold in [-2.0, 0.0]:
                            result.append(RegimeGate(
                                sma_length, slope_lookback, momentum_length,
                                momentum_threshold, relative_length, relative_threshold,
                            ))
    return result


def fixed_members() -> List[v41.RecoveryRule]:
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


def extended_series(rows: List[dict]):
    close = [float(row["close"]) for row in rows]
    sma_lengths = [168, 240, 336, 480]
    momentum_lengths = [72, 120, 168, 240]
    return (
        {length: v40.rolling_mean(close, length) for length in sma_lengths},
        {length: v40.momentum_series(close, length) for length in momentum_lengths},
    )


def build_trades(
    gate: RegimeGate,
    members: List[v41.RecoveryRule],
    pengu: v40.CachedSeries,
    btc: v40.CachedSeries,
    funding: List[dict],
    funding_by_index: List[float],
    extended_sma: Dict[int, List[Optional[float]]],
    extended_momentum: Dict[int, List[Optional[float]]],
    btc_extended_momentum: Dict[int, List[Optional[float]]],
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
        sma_now = extended_sma[gate.sma_length][pi]
        slope_index = pi - gate.slope_lookback
        sma_then = extended_sma[gate.sma_length][slope_index] if slope_index >= 0 else None
        momentum = extended_momentum[gate.momentum_length][pi]
        p_relative = extended_momentum[gate.relative_length][pi]
        b_momentum = btc_extended_momentum[gate.relative_length][bi]
        if (
            sma_now is None or sma_then is None or momentum is None
            or p_relative is None or b_momentum is None
        ):
            continue
        if not (
            pengu.close[pi] > sma_now
            and sma_now > sma_then
            and momentum > gate.momentum_threshold
            and p_relative - b_momentum > gate.relative_threshold
        ):
            continue
        entry_index = pi + 1
        exit_index = entry_index + 24
        if exit_index >= len(pengu.rows):
            continue
        entry_ts = int(pengu.rows[entry_index]["ts"])
        exit_ts = int(pengu.rows[exit_index]["ts"])
        entry_price = float(pengu.rows[entry_index]["open"])
        exit_price = float(pengu.rows[exit_index]["open"])
        gross = (exit_price / entry_price - 1.0) * 100.0
        paid_funding = v39.funding_between(funding, entry_ts, exit_ts)
        base = gross - paid_funding - 0.12 - 0.02
        severe = gross - paid_funding - 0.20 - 0.05
        trades.append(v39.Trade(
            f"ENS41_{gate.strategy_id}", entry_ts, exit_ts, 1,
            entry_price, exit_price, gross, paid_funding, base, severe, "TIME24",
        ))
        next_free = exit_ts
    return trades


def metrics(trades: List[v39.Trade], start: int, end: int) -> dict:
    return v39.metrics(trades, start, end)


def eligible(item: dict) -> bool:
    full = item["preHoldout"]
    folds = item["folds"]
    returns = [fold["compoundedReturnPct"] for fold in folds]
    severe = [fold["severeReturnPct"] for fold in folds]
    return bool(
        full["trades"] >= 8
        and full["compoundedReturnPct"] > 0
        and (full["profitFactor"] or 0) >= 1.20
        and full["maxDrawdownPct"] >= -20
        and full["severeReturnPct"] > 0
        and (full["severeProfitFactor"] or 0) >= 1.10
        and statistics.median(returns) > 0
        and statistics.median(severe) > 0
        and sum(value > 0 for value in returns) >= 3
        and min(returns) >= -5.0
    )


def holdout_pass(metric: dict) -> bool:
    return bool(
        metric["trades"] >= 2
        and metric["compoundedReturnPct"] > 0
        and (metric["profitFactor"] or 0) >= 1.0
        and metric["maxDrawdownPct"] >= -15
        and metric["severeReturnPct"] > 0
        and (metric["severeProfitFactor"] or 0) >= 1.0
    )


def neighbor(left: RegimeGate, right: RegimeGate) -> bool:
    return (
        abs(left.sma_length - right.sma_length) <= 168
        and abs(left.slope_lookback - right.slope_lookback) <= 24
        and abs(left.momentum_length - right.momentum_length) <= 72
        and abs(left.momentum_threshold - right.momentum_threshold) <= 2.1
        and abs(left.relative_length - right.relative_length) <= 48
        and abs(left.relative_threshold - right.relative_threshold) <= 2.1
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
    p_sma, p_momentum = extended_series(pengu_rows)
    _, b_momentum = extended_series(btc_rows)
    members = fixed_members()

    first = max(int(pengu_rows[0]["ts"]), int(btc_rows[0]["ts"])) + 520 * HOUR
    last = min(int(pengu_rows[-1]["ts"]), int(btc_rows[-1]["ts"]))
    span = last - first
    holdout_start = first + int(span * 0.80)
    fold_edges = [first + int((holdout_start - first) * step / 4) for step in range(5)]

    candidates = gates()
    gate_map = {gate.strategy_id: gate for gate in candidates}
    trades_by_id: Dict[str, List[v39.Trade]] = {}
    results: Dict[str, dict] = {}
    eligible_ids: List[str] = []
    for gate in candidates:
        trades = build_trades(
            gate, members, pengu, btc, funding, funding_by_index,
            p_sma, p_momentum, b_momentum,
        )
        trades_by_id[gate.strategy_id] = trades
        item = {
            "gate": asdict(gate),
            "preHoldout": metrics(trades, first, holdout_start),
            "folds": [metrics(trades, fold_edges[index], fold_edges[index + 1]) for index in range(4)],
        }
        results[gate.strategy_id] = item
        if eligible(item):
            eligible_ids.append(gate.strategy_id)

    stable = [
        strategy_id for strategy_id in eligible_ids
        if sum(1 for other in eligible_ids if other != strategy_id and neighbor(gate_map[strategy_id], gate_map[other])) >= 2
    ]
    stable.sort(key=lambda strategy_id: (
        statistics.median(fold["severeReturnPct"] for fold in results[strategy_id]["folds"]),
        results[strategy_id]["preHoldout"]["profitFactor"] or 0,
        results[strategy_id]["preHoldout"]["compoundedReturnPct"],
        results[strategy_id]["preHoldout"]["maxDrawdownPct"],
        -gate_map[strategy_id].sma_length,
    ), reverse=True)
    selected = stable[0] if stable else None
    long_trades = trades_by_id[selected] if selected else []
    long_preholdout = metrics(long_trades, first, holdout_start)
    long_holdout = metrics(long_trades, holdout_start, last + HOUR)
    long_passed = bool(selected and holdout_pass(long_holdout))

    short_rule = v39.Rule(
        -1, "BREAKDOWN", 6, 24, 0.0, 0.0, 0.8, 0.0, "RISK",
        v39.ExitSpec("TIME24", 24),
    )
    short_trades = v39.build_trades(short_rule, pengu_rows, btc_rows, funding)
    short_preholdout = metrics(short_trades, first, holdout_start)
    short_holdout = metrics(short_trades, holdout_start, last + HOUR)
    short_passed = holdout_pass(short_holdout)

    combined = v39.combine_trades(long_trades if long_passed else [], short_trades, 1.0, 1.0)
    combined_holdout = metrics(combined, holdout_start, last + HOUR)
    combined_full = metrics(combined, first, last + HOUR)
    combined_passed = bool(long_passed and short_passed and holdout_pass(combined_holdout))
    status = "PENGU_DUAL_ENGINE_V44_COMPLETE" if combined_passed else "PENGU_REGIME_GATE_V44_NOT_COMPLETE"

    payload = rounded({
        "version": 44,
        "strategyId": "PENGU_LONG_REGIME_GATE_V44",
        "status": status,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "candidateCount": len(candidates),
        "eligibleCount": len(eligible_ids),
        "stableCount": len(stable),
        "selectedGateId": selected,
        "selectedGate": asdict(gate_map[selected]) if selected else None,
        "longPreHoldout": long_preholdout,
        "longFrozenHoldout": long_holdout,
        "longHoldoutPassed": long_passed,
        "shortRule": asdict(short_rule),
        "shortPreHoldout": short_preholdout,
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
            "The final window is reused confirmation, not pristine forward evidence.",
            "PENGU Long is intentionally sparse and disabled when its own medium-term regime is not bullish.",
            "V19 microstructure remains a forward-only veto.",
        ],
    })
    report = [
        "# PENGU Long Regime Gate V44",
        "",
        f"- Status: **{status}**",
        f"- Gates: {len(candidates)}",
        f"- Eligible: {len(eligible_ids)}",
        f"- Stable: {len(stable)}",
        f"- Selected gate: **{selected or 'NONE'}**",
        f"- Long pre-holdout: {long_preholdout['compoundedReturnPct']}% / PF {long_preholdout['profitFactor']} / DD {long_preholdout['maxDrawdownPct']}%",
        f"- Long holdout: {long_holdout['compoundedReturnPct']}% / PF {long_holdout['profitFactor']} / Severe {long_holdout['severeReturnPct']}%",
        f"- Short holdout: {short_holdout['compoundedReturnPct']}% / PF {short_holdout['profitFactor']} / Severe {short_holdout['severeReturnPct']}%",
        f"- Combined holdout: {combined_holdout['compoundedReturnPct']}% / PF {combined_holdout['profitFactor']} / Severe {combined_holdout['severeReturnPct']}%",
        f"- Combined full: {combined_full['compoundedReturnPct']}% / PF {combined_full['profitFactor']} / DD {combined_full['maxDrawdownPct']}%",
        "- Production changed: NO",
        "- Real trading: DISABLED",
    ]
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "pengu-long-regime-gate-v44.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    (state_dir / "pengu-long-regime-gate-v44.md").write_text(
        "\n".join(report), encoding="utf-8",
    )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n\n" + "\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
