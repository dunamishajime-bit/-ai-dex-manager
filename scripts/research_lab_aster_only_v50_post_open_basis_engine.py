from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22

STRATEGY_ID = "DISDEX_ASTER_ONLY_V50_POST_OPEN_BASIS_ENGINE"
SCENARIOS = v14.SCENARIOS
CONVERGENCE_BPS = 15.0
BASIS_STOP_MULTIPLE = 1.5
DAILY_LOSS_LIMIT = -0.02
MAX_DAILY_TRADES = 3
WINDOWS: Tuple[Tuple[str, int], ...] = (
    ("1130", 0),
    ("1230", 1),
    ("1330", 2),
    ("1430", 3),
)
WINDOW_SETS = {
    "POST_ALL4": (0, 1, 2, 3),
    "POST_EARLY3": (0, 1, 2),
    "POST_LATE3": (1, 2, 3),
}


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    window_set: str
    minimum_entry_basis_bps: float
    maximum_holding_hours: int
    direction_mode: str
    same_symbol_cooldown: bool


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"{window_set}__B{basis:g}__H{hours}__{direction}__{'COOLDOWN' if cooldown else 'NONE'}",
        window_set,
        basis,
        hours,
        direction,
        cooldown,
    )
    for window_set in WINDOW_SETS
    for basis in (50.0, 75.0, 100.0)
    for hours in (1, 2, 3)
    for direction in ("BOTH", "PREMIUM_SHORT_ONLY", "DISCOUNT_LONG_ONLY")
    for cooldown in (False, True)
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def direction_allowed(mode: str, basis_bps: float) -> bool:
    if mode == "PREMIUM_SHORT_ONLY":
        return basis_bps > 0
    if mode == "DISCOUNT_LONG_ONLY":
        return basis_bps < 0
    return True


def window_state(aligned: Dict[str, Dict[str, dict]], day: str, checkpoint_index: int) -> Dict[str, dict]:
    states: Dict[str, dict] = {}
    for symbol in v14.SYMBOLS:
        row = aligned[symbol][day]
        checkpoint = row["checkpoints"][checkpoint_index]
        cash_checkpoint = row["cash"]["checkpoints"][checkpoint_index]
        signal_basis = finite(checkpoint["basisBps"])
        entry_perp = finite(checkpoint["exit"])
        cash_reference = finite(cash_checkpoint["cash"])
        entry_basis = (entry_perp / cash_reference - 1.0) * 10_000.0 if min(entry_perp, cash_reference) > 0 else 0.0
        states[symbol] = {
            "row": row,
            "signalBasisBps": signal_basis,
            "entryBasisBps": entry_basis,
            "entryPrice": entry_perp,
            "entryTs": int(checkpoint["exitTs"]),
            "futureCheckpoints": row["checkpoints"][checkpoint_index + 1 :],
        }
    return states


def select_signal(candidate: Candidate, states: Dict[str, dict]) -> Optional[Tuple[str, dict]]:
    eligible: List[Tuple[float, str, dict]] = []
    for symbol, state in states.items():
        signal_basis = finite(state["signalBasisBps"])
        entry_basis = finite(state["entryBasisBps"])
        if abs(entry_basis) < candidate.minimum_entry_basis_bps:
            continue
        if signal_basis * entry_basis <= 0:
            continue
        if not direction_allowed(candidate.direction_mode, entry_basis):
            continue
        adverse = max(0.0, abs(entry_basis) - abs(signal_basis))
        if adverse > 10.0:
            continue
        eligible.append((abs(entry_basis), symbol, {**state, "adverseBasisMoveBps": adverse}))
    if not eligible:
        return None
    _score, symbol, state = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, state


def build_trade(candidate: Candidate, day: str, window_name: str, checkpoint_index: int,
                aligned: Dict[str, Dict[str, dict]]) -> Optional[dict]:
    states = window_state(aligned, day, checkpoint_index)
    selected = select_signal(candidate, states)
    if selected is None:
        return None
    symbol, state = selected
    entry_basis = finite(state["entryBasisBps"])
    side = -1 if entry_basis > 0 else 1
    future = list(state["futureCheckpoints"])
    if not future:
        return None
    maximum_index = min(len(future) - 1, candidate.maximum_holding_hours - 1)
    chosen = future[maximum_index]
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"
    for checkpoint in future[: maximum_index + 1]:
        current_basis = finite(checkpoint["basisBps"])
        converged = abs(current_basis) <= CONVERGENCE_BPS or current_basis * entry_basis <= 0
        stopped = abs(current_basis) >= BASIS_STOP_MULTIPLE * abs(entry_basis)
        if converged or stopped:
            chosen = checkpoint
            exit_reason = "BASIS_CONVERGED" if converged else "BASIS_STOP"
            break
    entry_price = finite(state["entryPrice"])
    exit_price = finite(chosen["exit"])
    entry_ts = int(state["entryTs"])
    exit_ts = int(chosen["exitTs"])
    price_return = side * (exit_price / entry_price - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(
        state["row"]["perp"]["fundingPoints"], entry_ts, exit_ts
    )
    return {
        "strategy": "V50_POST_OPEN_BASIS",
        "candidateId": candidate.candidate_id,
        "route": f"POST_{window_name}",
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "signalBasisBps": finite(state["signalBasisBps"]),
        "entryBasisBps": entry_basis,
        "adverseBasisMoveBps": finite(state["adverseBasisMoveBps"]),
        "edgeProxyBps": abs(entry_basis) - CONVERGENCE_BPS,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": exit_reason,
    }


def build_raw_trades(candidate: Candidate, days: Sequence[str], aligned: Dict[str, Dict[str, dict]]) -> List[dict]:
    rows: List[dict] = []
    allowed_indices = set(WINDOW_SETS[candidate.window_set])
    for day in days:
        for window_name, checkpoint_index in WINDOWS:
            if checkpoint_index not in allowed_indices:
                continue
            trade = build_trade(candidate, day, window_name, checkpoint_index, aligned)
            if trade is not None:
                rows.append(trade)
    return sorted(rows, key=lambda row: (str(row["day"]), int(row["entryTs"])))


def route(candidate: Candidate, raw: Sequence[dict], cost_bps: float, days: Sequence[str]) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by_day: Dict[str, List[dict]] = defaultdict(list)
    for row in raw:
        if str(row["day"]) in allowed:
            by_day[str(row["day"])].append(row)
    events: List[dict] = []
    stats: Counter[str] = Counter()
    for day in sorted(allowed):
        daily_net = 0.0
        previous_exit = -1
        previous_symbol: Optional[str] = None
        accepted_count = 0
        for row in sorted(by_day.get(day, []), key=lambda item: int(item["entryTs"])):
            if accepted_count >= MAX_DAILY_TRADES:
                stats["MAX_DAILY_TRADES_BLOCKED"] += 1
                continue
            if daily_net <= DAILY_LOSS_LIMIT:
                stats["DAILY_LOSS_BLOCKED"] += 1
                continue
            if int(row["entryTs"]) < previous_exit:
                stats["OVERLAP_BLOCKED"] += 1
                continue
            if candidate.same_symbol_cooldown and previous_symbol == str(row["symbol"]):
                stats["SAME_SYMBOL_BLOCKED"] += 1
                continue
            value = v14.net_trade_return(row, cost_bps)
            if value is None:
                stats["COST_EDGE_REJECTED"] += 1
                continue
            events.append({**row, "netReturn": value})
            daily_net = (1.0 + daily_net) * (1.0 + value) - 1.0
            previous_exit = int(row["exitTs"])
            previous_symbol = str(row["symbol"])
            accepted_count += 1
            stats[str(row["route"])] += 1
    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]))), dict(stats)


def scenario_set(candidate: Candidate, raw: Sequence[dict], days: Sequence[str]) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        events, stats = route(candidate, raw, cost, days)
        results[name] = v22.metrics(events)
        routing[name] = stats
    return results, routing


def remove_best(events: Sequence[dict]) -> List[dict]:
    if not events:
        return []
    index = max(range(len(events)), key=lambda i: finite(events[i]["netReturn"]))
    return [row for i, row in enumerate(events) if i != index]


def remove_best_month(events: Sequence[dict]) -> List[dict]:
    monthly: Dict[str, float] = defaultdict(float)
    for row in events:
        monthly[str(row["day"])[:7]] += finite(row["netReturn"])
    if not monthly:
        return []
    month = max(monthly, key=lambda key: (monthly[key], key))
    return [row for row in events if str(row["day"])[:7] != month]


def audit(candidate: Candidate, raw: Sequence[dict], target: Sequence[str], development: Sequence[str],
          validation: Sequence[str], final: Sequence[str], holdout: Sequence[str]) -> dict:
    full, routing = scenario_set(candidate, raw, target)
    dev, _ = scenario_set(candidate, raw, development)
    val, _ = scenario_set(candidate, raw, validation)
    fin, _ = scenario_set(candidate, raw, final)
    hol, _ = scenario_set(candidate, raw, holdout)
    normal_events, _ = route(candidate, raw, SCENARIOS["NORMAL"], target)
    p95_events, _ = route(candidate, raw, SCENARIOS["P95"], target)
    normal, p95 = full["NORMAL"], full["P95"]
    checks = {
        "standaloneNormalAtLeast50Pct": normal["compoundedReturnPct"] >= 50.0,
        "standaloneP95AtLeast30Pct": p95["compoundedReturnPct"] >= 30.0,
        "normalProfitFactorAtLeast1_5": (normal["profitFactor"] or 0.0) >= 1.5,
        "normalDrawdownNoWorseThanMinus15Pct": normal["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": normal["trades"] >= 50,
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightTrades": val["NORMAL"]["trades"] >= 8,
        "validationProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.2,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "finalNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumThreeTrades": hol["NORMAL"]["trades"] >= 3,
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "positiveProfitConcentrationAtMost40Pct": normal["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": v22.metrics(remove_best(normal_events))["compoundedReturnPct"] > 0 and v22.metrics(remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": v22.metrics(remove_best_month(normal_events))["compoundedReturnPct"] > 0 and v22.metrics(remove_best_month(p95_events))["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {
        "full": full,
        "development": dev,
        "validation": val,
        "finalReused": fin,
        "holdout": hol,
        "routing": routing,
        "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
    }


def development_pass(result: dict) -> bool:
    normal, p95 = result["development"]["NORMAL"], result["development"]["P95"]
    return normal["compoundedReturnPct"] > 10.0 and p95["compoundedReturnPct"] > 5.0 and normal["trades"] >= 20 and (normal["profitFactor"] or 0.0) >= 1.2


def validation_pass(result: dict) -> bool:
    normal, p95 = result["validation"]["NORMAL"], result["validation"]["P95"]
    return normal["trades"] >= 8 and normal["compoundedReturnPct"] > 0 and p95["compoundedReturnPct"] > 0 and (normal["profitFactor"] or 0.0) >= 1.2


def selection_score(result: dict) -> float:
    normal, p95 = result["validation"]["NORMAL"], result["validation"]["P95"]
    return normal["compoundedReturnPct"] + p95["compoundedReturnPct"] + 0.05 * normal["trades"]


def analyze(cache_root: Path) -> dict:
    v19.configure_exact_data_window()
    days, aligned, aligned_diag = v19.v17.load_all(cache_root / "aligned")
    target = [day for day in days if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v20.HOLDOUT_START_DAY]
    holdout = [day for day in target if day >= v20.HOLDOUT_START_DAY]
    splits = v14.split_days(pre_holdout)
    diagnostics = []
    development_survivors = []
    for candidate in CANDIDATES:
        raw = build_raw_trades(candidate, target, aligned)
        result = audit(candidate, raw, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
        payload = {"candidate": asdict(candidate), "rawTrades": len(raw), "audit": result}
        diagnostics.append(payload)
        if development_pass(result):
            development_survivors.append(payload)
    development_survivors.sort(key=lambda item: item["audit"]["development"]["NORMAL"]["compoundedReturnPct"] + item["audit"]["development"]["P95"]["compoundedReturnPct"], reverse=True)
    validation_survivors = [item for item in development_survivors[:40] if validation_pass(item["audit"])]
    validation_survivors.sort(key=lambda item: selection_score(item["audit"]), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V50_NO_VALIDATED_STANDALONE_50PCT_POST_OPEN_ENGINE"
    if winner is not None:
        status = "ASTER_ONLY_V50_STANDALONE_50PCT_SHADOW_LEAD" if winner["audit"]["allStrictHurdlesPassed"] else "ASTER_ONLY_V50_VALIDATION_WINNER_FAILED_FINAL_HURDLES"
    diagnostics.sort(key=lambda item: item["audit"]["full"]["NORMAL"]["compoundedReturnPct"] + item["audit"]["full"]["P95"]["compoundedReturnPct"], reverse=True)
    return v14.rounded({
        "version": 50,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner,
        "topDiagnostics": diagnostics[:20],
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "targetSessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "economicThesis": "POST_OPEN_CASH_PERP_BASIS_CONVERGENCE",
            "v11TenThirtyTradesIncluded": False,
            "otherStrategyReturnsIncluded": False,
            "entryWindowsNy": [name for name, _index in WINDOWS],
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "maximumDailyTrades": MAX_DAILY_TRADES,
            "dailyLossLimit": DAILY_LOSS_LIMIT,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopForty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "standaloneReturnRequired": True,
            "productionPromotionAllowed": False,
        },
        "data": aligned_diag,
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v19Changed": False,
            "v48Changed": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V50 Standalone Post-Open Basis Engine",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidates: {result['candidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        "",
    ]
    winner = result.get("winner")
    if winner:
        lines += [f"Winner: `{winner['candidate']['candidate_id']}`", ""]
        for name, row in winner["audit"]["full"].items():
            lines.append(f"- {name}: {row['compoundedReturnPct']:.6f}% / PF {row['profitFactor']} / DD {row['maxDrawdownPct']:.6f}% / {row['trades']} trades")
    else:
        lines.append("No post-open standalone candidate passed chronological Validation.")
    lines += ["", "## Top full-period diagnostics", ""]
    for item in result["topDiagnostics"][:5]:
        row = item["audit"]["full"]
        lines.append(f"- `{item['candidate']['candidate_id']}`: Normal {row['NORMAL']['compoundedReturnPct']:.6f}% / P95 {row['P95']['compoundedReturnPct']:.6f}% / {row['NORMAL']['trades']} trades")
    lines += ["", "Research only. V11 10:30 returns and every other strategy return are excluded.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default="../.cache/aster-only-v39-overnight-open")
    parser.add_argument("--output-dir", default="../.research-state/aster-only-v50-post-open-basis")
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({"status": result["status"], "winner": result["winner"], "top": result["topDiagnostics"][:3]}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
