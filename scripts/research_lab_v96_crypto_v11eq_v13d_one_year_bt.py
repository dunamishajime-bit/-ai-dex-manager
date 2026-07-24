from __future__ import annotations

import argparse
import datetime as dt
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import research_lab_v96_crypto_v11_v13d_one_year_bt as base

UTC = dt.timezone.utc
STRATEGY_ID = "DISDEX_V96_CRYPTO_V11EQ_V13D_ONE_YEAR_PORTFOLIO"

EQ = {
    "minimumAbsoluteEntryBasisBps": 50.0,
    "maximumEstimatedRoundTripCostBps": 60.0,
    "maximumCostToEntryBasisRatio": 0.75,
    "minimumEstimatedNetEdgeBps": 10.0,
    "convergenceTargetBps": 15.0,
    "maximumSourceClockDifferenceMs": 1500,
    "maximumAdverseBasisMoveBps": 10.0,
    "requireCandidateStillTop1AtEntry": True,
    "unobservableRequiredInputs": [
        "live bid/ask spread",
        "order-size depth and slippage",
        "sub-second data age",
        "two-second adverse move",
        "post-only queue position and >=90% fill",
    ],
}


def rounded(value: Any):
    return base.rounded(value)


def build_v11eq(cache_root: Path) -> Tuple[List[dict], dict]:
    cash, cash_diag = base.v11.load_cash_intraday(cache_root / "v11-cash")
    perp, perp_diag = base.v11.load_perp_intraday(cache_root / "v11-perp", cache_root / "v11-funding")
    days, aligned, alignment = base.v11.align_intraday(cash, perp)
    scores = base.v11.rolling_scores(days, aligned)
    candidate = base.v11.Candidate("BOTH__FLAT__CONVERGENCE__ABS_TOP1", "BOTH", "FLAT", "CONVERGENCE", "ABS_TOP1")
    rows: List[dict] = []
    observable_rejections: Counter[str] = Counter()

    for day in days:
        trade = base.v11.build_trade(candidate, day, aligned, scores)
        if trade is None or not (base.PERIOD_START.date().isoformat() <= day < base.PERIOD_END.date().isoformat()):
            continue
        leg = trade["legs"][0]
        symbol = leg["symbol"]
        entry_basis_by_symbol: Dict[str, float] = {}
        for candidate_symbol in base.v11.SYMBOLS:
            row = aligned[candidate_symbol][day]
            cash_entry = float(row["cash"]["entry"])
            perp_entry = float(row["perp"]["entry"])
            entry_basis_by_symbol[candidate_symbol] = (perp_entry / cash_entry - 1.0) * 10000.0

        entry_top1 = max(entry_basis_by_symbol, key=lambda item: abs(entry_basis_by_symbol[item]))
        signal_basis = float(leg["entryBasisBps"])
        entry_basis = float(entry_basis_by_symbol[symbol])
        clock_difference_ms = abs(
            int(aligned[symbol][day]["cash"]["entryTs"]) - int(aligned[symbol][day]["perp"]["entryTs"])
        )
        adverse_basis_move = max(0.0, abs(entry_basis) - abs(signal_basis))
        reasons: List[str] = []
        if abs(entry_basis) < EQ["minimumAbsoluteEntryBasisBps"]:
            reasons.append("ENTRY_BASIS_BELOW_50")
        if EQ["requireCandidateStillTop1AtEntry"] and entry_top1 != symbol:
            reasons.append("NO_LONGER_TOP1_AT_ENTRY")
        if clock_difference_ms > EQ["maximumSourceClockDifferenceMs"]:
            reasons.append("SOURCE_CLOCK_DIFFERENCE_OVER_1500MS")
        if adverse_basis_move > EQ["maximumAdverseBasisMoveBps"]:
            reasons.append("ADVERSE_BASIS_MOVE_OVER_10BPS")
        observable_rejections.update(reasons)

        rows.append({
            "strategy": "V11_EQ",
            "day": day,
            "symbol": symbol,
            "entryTs": int(leg["entryTs"]),
            "exitTs": int(leg["exitTs"]),
            "gross": float(trade["gross"]),
            "grossReturn": float(trade["grossReturn"]),
            "fundingReturn": float(trade["fundingReturn"]),
            "exitReason": leg["exitReason"],
            "signalBasisBps": signal_basis,
            "entryBasisBps": entry_basis,
            "entryTop1Symbol": entry_top1,
            "sourceClockDifferenceMs": clock_difference_ms,
            "adverseBasisMoveBps": adverse_basis_move,
            "observableBaseReasons": reasons,
        })

    return rows, {
        "cash": cash_diag,
        "perp": perp_diag,
        "alignment": alignment,
        "eligibleDays": len(days),
        "rawV11Candidates": len(rows),
        "observableBasePassCandidates": sum(not row["observableBaseReasons"] for row in rows),
        "observableBaseRejectCandidates": sum(bool(row["observableBaseReasons"]) for row in rows),
        "observableBaseRejectReasons": dict(observable_rejections),
        "unobservableRequiredInputs": EQ["unobservableRequiredInputs"],
    }


def evaluate_v11eq(trade: dict, scenario: dict, strict_unobservable: bool = False) -> dict:
    reasons = list(trade.get("observableBaseReasons", []))
    estimated_round_trip_cost = 2.0 * float(scenario["v11OneWayBps"])
    entry_basis = abs(float(trade["entryBasisBps"]))
    ratio = estimated_round_trip_cost / entry_basis if entry_basis > 0 else float("inf")
    net_edge = entry_basis - float(EQ["convergenceTargetBps"]) - estimated_round_trip_cost

    if estimated_round_trip_cost > EQ["maximumEstimatedRoundTripCostBps"]:
        reasons.append("ESTIMATED_ROUND_TRIP_COST_OVER_60BPS")
    if ratio > EQ["maximumCostToEntryBasisRatio"]:
        reasons.append("COST_TO_BASIS_RATIO_OVER_75PCT")
    if net_edge < EQ["minimumEstimatedNetEdgeBps"]:
        reasons.append("ESTIMATED_NET_EDGE_BELOW_10BPS")
    if strict_unobservable:
        reasons.extend([
            "SPREAD_UNOBSERVABLE_FAIL_CLOSED",
            "DEPTH_SLIPPAGE_UNOBSERVABLE_FAIL_CLOSED",
            "SUBSECOND_FRESHNESS_UNOBSERVABLE_FAIL_CLOSED",
            "TWO_SECOND_MOVE_UNOBSERVABLE_FAIL_CLOSED",
            "POST_ONLY_FILL_UNOBSERVABLE_FAIL_CLOSED",
        ])

    return {
        "accepted": not reasons,
        "reasons": reasons,
        "estimatedRoundTripCostBps": estimated_round_trip_cost,
        "costToBasisRatio": ratio,
        "estimatedNetEdgeBps": net_edge,
    }


def route_stock(v11eq_rows: Sequence[dict], v13d_rows: Sequence[dict]) -> Tuple[List[dict], dict]:
    by11 = {row["day"]: row for row in v11eq_rows}
    by13 = {row["day"]: row for row in v13d_rows}
    routed: List[dict] = []
    stats: Counter[str] = Counter()
    for day in sorted(set(by11) | set(by13)):
        if day in by13:
            routed.append(dict(by13[day]))
            stats["V13D_SELECTED_1000"] += 1
            if day in by11:
                stats["V11_EQ_SKIPPED_STOCK_OCCUPIED"] += 1
        elif day in by11:
            routed.append(dict(by11[day]))
            stats["V11_EQ_FALLBACK_CANDIDATE_1030"] += 1
    return sorted(routed, key=lambda row: row["entryTs"]), dict(stats)


def trade_return(trade: dict, scenario: dict) -> float:
    if trade["strategy"] == "V11_EQ":
        return float(trade["grossReturn"]) - 2.0 * float(trade["gross"]) * float(scenario["v11OneWayBps"]) / 10000.0
    return (float(trade["grossBps"]) - float(scenario["v13dCycleBps"])) / 10000.0


def simulate(
    crypto_rows: Sequence[dict],
    stock_rows: Sequence[dict],
    scenario: dict,
    strict_unobservable: bool = False,
) -> dict:
    timeline = [{"kind": "CRYPTO", "ts": int(row["ts"]), "return": float(row["return"]), "priority": 2} for row in crypto_rows]
    timeline += [{"kind": "ENTRY", "ts": int(row["entryTs"]), "trade": row, "return": 0.0, "priority": 1} for row in stock_rows]
    timeline.sort(key=lambda row: (row["ts"], row["priority"]))
    events: List[dict] = []
    stats: Counter[str] = Counter()
    gate_reasons: Counter[str] = Counter()
    current_day = locked_day = None
    day_return = 0.0
    index = 0

    while index < len(timeline):
        row = timeline[index]
        day = dt.datetime.fromtimestamp(row["ts"] / 1000, tz=UTC).date().isoformat()
        if day != current_day:
            current_day, locked_day, day_return = day, None, 0.0
        if row["kind"] == "ENTRY":
            trade = row["trade"]
            if locked_day == day:
                stats["stockSkippedDailyLoss"] += 1
            elif trade["strategy"] == "V11_EQ":
                gate = evaluate_v11eq(trade, scenario, strict_unobservable)
                if not gate["accepted"]:
                    stats["V11_EQ_REJECTED"] += 1
                    gate_reasons.update(gate["reasons"])
                else:
                    timeline.append({"kind": "STOCK", "ts": int(trade["exitTs"]), "trade": trade,
                                     "return": trade_return(trade, scenario), "priority": 3})
                    timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda item: (item["ts"], item["priority"]))
                    stats["acceptedV11_EQ"] += 1
            else:
                timeline.append({"kind": "STOCK", "ts": int(trade["exitTs"]), "trade": trade,
                                 "return": trade_return(trade, scenario), "priority": 3})
                timeline[index + 1:] = sorted(timeline[index + 1:], key=lambda item: (item["ts"], item["priority"]))
                stats["acceptedV13D"] += 1
            index += 1
            continue
        if locked_day == day:
            stats[f"{row['kind']}SkippedDailyLoss"] += 1
            index += 1
            continue
        strategy = row.get("trade", {}).get("strategy", "CRYPTO")
        event = {
            "ts": int(row["ts"]),
            "return": float(row["return"]),
            "strategy": strategy,
            "symbol": row.get("trade", {}).get("symbol"),
            "priority": row["priority"],
        }
        events.append(event)
        day_return = (1.0 + day_return) * (1.0 + event["return"]) - 1.0
        if day_return <= base.DAILY_LOSS_LIMIT:
            locked_day = day
            stats["dailyLossLocks"] += 1
        index += 1

    result = base.metrics(events)
    result.update({
        "acceptedV11EqTrades": sum(row["strategy"] == "V11_EQ" for row in events),
        "acceptedV13DTrades": sum(row["strategy"] == "V13D" for row in events),
        "observedMaximumGross": base.TOTAL_GROSS_CAP,
        "routingDiagnostics": dict(stats),
        "v11EqGateRejectReasons": dict(gate_reasons),
        "bySleeve": {
            name: base.metrics([row for row in events if row["strategy"] == name])
            for name in ("CRYPTO", "V11_EQ", "V13D")
        },
    })
    return result


def isolated_stock(rows: Sequence[dict], scenario: dict, strict_unobservable: bool = False) -> dict:
    accepted: List[dict] = []
    gate_reasons: Counter[str] = Counter()
    for row in rows:
        if row["strategy"] == "V11_EQ":
            gate = evaluate_v11eq(row, scenario, strict_unobservable)
            if not gate["accepted"]:
                gate_reasons.update(gate["reasons"])
                continue
        accepted.append(row)
    result = base.metrics([
        {"ts": row["exitTs"], "return": trade_return(row, scenario), "strategy": row["strategy"], "priority": 1}
        for row in accepted
    ])
    result.update({
        "acceptedV11EqTrades": sum(row["strategy"] == "V11_EQ" for row in accepted),
        "acceptedV13DTrades": sum(row["strategy"] == "V13D" for row in accepted),
        "v11EqGateRejectReasons": dict(gate_reasons),
    })
    return result


def analyze(cache_root: Path) -> dict:
    base.verify_source(base.V11_ROOT, base.V11_SOURCE_SHA)
    base.verify_source(base.V13_ROOT, base.V13_SOURCE_SHA)
    v11eq_rows, v11eq_diag = build_v11eq(cache_root)
    v13d_rows, v13d_diag = base.build_v13d(cache_root)
    routed, routing = route_stock(v11eq_rows, v13d_rows)
    crypto = base.build_crypto()
    results: Dict[str, dict] = {}

    for name, scenario in base.SCENARIOS.items():
        crypto_rows = crypto[scenario["crypto"]]
        results[name] = {
            "unified": simulate(crypto_rows, routed, scenario),
            "cryptoSleeveOneOnly": simulate(crypto_rows, [], scenario),
            "cryptoPlusV11EqOnly": simulate(crypto_rows, v11eq_rows, scenario),
            "cryptoPlusV13DOnly": simulate(crypto_rows, v13d_rows, scenario),
            "v11EqStandalone": isolated_stock(v11eq_rows, scenario),
            "v13dStandalone": isolated_stock(v13d_rows, scenario),
            "routedStockStandalone": isolated_stock(routed, scenario),
        }

    normal_scenario = base.SCENARIOS["NORMAL"]
    strict_lower_bound = simulate(crypto["normal"], routed, normal_scenario, strict_unobservable=True)
    normal = results["NORMAL"]["unified"]
    severe = results["SEVERE"]["unified"]
    status = (
        "ONE_YEAR_V11EQ_OBSERVABLE_PROXY_FORWARD_EXECUTION_REQUIRED"
        if normal["compoundedReturnPct"] > 0 and normal["maxDrawdownPct"] >= -35
        and severe["compoundedReturnPct"] > 0 and severe["maxDrawdownPct"] >= -55
        else "ONE_YEAR_V11EQ_OBSERVABLE_PROXY_DIAGNOSTIC_NOT_PRODUCTION_APPROVED"
    )

    return rounded({
        "version": 2,
        "strategyId": STRATEGY_ID,
        "generatedAt": dt.datetime.now(UTC).isoformat(),
        "status": status,
        "period": {"startInclusive": base.PERIOD_START.isoformat(), "endExclusive": base.PERIOD_END.isoformat(), "calendarDays": 365},
        "sourceCommits": {
            "cryptoResearchBase": "17d2acd512dac75f6c9b7c427cb4995b6ab8c81b",
            "v11": base.V11_SOURCE_SHA,
            "v13d": base.V13_SOURCE_SHA,
        },
        "architecture": {
            "cryptoGrossCap": 1.0,
            "stockGrossCap": 1.0,
            "totalGrossCap": 2.0,
            "sleeveLending": False,
            "dailyLossLimitPct": 2.0,
            "dailyLossResolution": "completed event; triggering loss retained, later same-UTC-day events blocked",
            "stockPriority": "V13D 10:00 first; V11-EQ 10:30 only when V13D did not open",
            "stockVsCrypto": "independent sleeves; no cancellation or preemption",
        },
        "fixedStrategies": {
            "crypto": {
                "productionRevision": "V96 Core Volume50 / Turnover7.5 plus reserved PENGU 1.15",
                "portfolioAdaptation": "proportional cap to Crypto sleeve Gross 1.0",
            },
            "V11_EQ": {
                "candidateId": "BOTH__FLAT__CONVERGENCE__ABS_TOP1__EQ_PROXY_V1",
                "entryNy": "10:30",
                "gross": 1.0,
                "exit": "Basis <=15 bps or zero-cross; stop at 1.5x entry Basis; otherwise 15:30",
                "executionQualityGate": EQ,
                "historicalProxy": "entry-basis/top1/clock/adverse-basis are candle-observable; scenario round-trip cost is treated as ex-ante estimate",
            },
            "V13D": {
                "candidateId": "EDGE20__NO_PREVIOUS_SYMBOL",
                "basisFloorBps": 20,
                "entryNy": "10:00",
                "gross": 1.0,
                "exit": "14:30 when completed 14:00 price PnL >=30 bps, otherwise 15:00",
                "previousSymbolCooldown": True,
            },
        },
        "costScenarios": base.SCENARIOS,
        "data": {
            "crypto": crypto["diagnostics"],
            "V11_EQ": v11eq_diag,
            "V13D": v13d_diag,
            "routedStock": {"candidateEvents": len(routed), "routing": routing},
        },
        "results": results,
        "strictUnobservableFailClosedLowerBound": {
            "scenario": "NORMAL crypto and costs; all V11-EQ entries rejected because required historical spread/depth/sub-second/fill inputs do not exist",
            "unified": strict_lower_bound,
        },
        "limitations": [
            "This is V11-EQ observable-proxy replay, not a full historical reconstruction of the live Execution Quality Gate.",
            "Historical V11 data cannot prove bid/ask spread, order-size depth, slippage, sub-second freshness, two-second moves, post-only queue position, partial fill, or >=90% fill.",
            "Scenario round-trip cost is treated as observable before entry; this is optimistic whenever cost deterioration cannot be detected in advance.",
            "V11 and V13D were selected on overlapping reused history; this is not an independent Holdout.",
            "V13D uses a strict next-open candle proxy and cannot prove queue consumption, exact bid/ask, partial-fill safety, or 250 ms hedge execution.",
            "Crypto V96 includes the fixed historical PENGU trade sequence; future reproducibility remains Forward-dependent.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "realPositionsChanged": False,
        },
    })


def write_outputs(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V96 Crypto + V11-EQ + V13D One-Year Backtest",
        "",
        f"- Status: **{result['status']}**",
        f"- Period: {result['period']['startInclusive']} to {result['period']['endExclusive']}",
        f"- Raw V11 candidates: {result['data']['V11_EQ']['rawV11Candidates']}",
        f"- V13D trades: {result['data']['V13D']['trades']}",
        "",
        "| Scenario | Return | CAGR | DD | PF | V11-EQ | V13D |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, node in result["results"].items():
        row = node["unified"]
        lines.append(
            f"| {name} | {row['compoundedReturnPct']}% | {row['cagrPct']}% | {row['maxDrawdownPct']}% | "
            f"{row['profitFactor']} | {row['acceptedV11EqTrades']} | {row['acceptedV13DTrades']} |"
        )
    lower = result["strictUnobservableFailClosedLowerBound"]["unified"]
    lines += [
        "",
        f"- Strict unavailable-input fail-closed lower bound: {lower['compoundedReturnPct']}% / DD {lower['maxDrawdownPct']}%.",
        "- The main V11-EQ result is an observable historical proxy; full EQ requires Forward order-book and execution evidence.",
        "- Production / LIVE / VPS / orders changed: **NO**",
    ]
    (output_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert (base.PERIOD_END - base.PERIOD_START).days == 365
    good = {
        "entryBasisBps": 100.0,
        "observableBaseReasons": [],
    }
    normal = evaluate_v11eq(good, base.SCENARIOS["NORMAL"])
    assert normal["accepted"] and normal["estimatedRoundTripCostBps"] == 40.0
    severe = evaluate_v11eq(good, base.SCENARIOS["SEVERE"])
    assert not severe["accepted"] and "ESTIMATED_ROUND_TRIP_COST_OVER_60BPS" in severe["reasons"]
    strict = evaluate_v11eq(good, base.SCENARIOS["NORMAL"], True)
    assert not strict["accepted"] and "POST_ONLY_FILL_UNOBSERVABLE_FAIL_CLOSED" in strict["reasons"]
    routed, diag = route_stock(
        [{"strategy": "V11_EQ", "day": "2026-01-05", "entryTs": 2}],
        [{"strategy": "V13D", "day": "2026-01-05", "entryTs": 1}],
    )
    assert len(routed) == 1 and routed[0]["strategy"] == "V13D"
    assert diag["V11_EQ_SKIPPED_STOCK_OCCUPIED"] == 1
    print("V96 Crypto + V11-EQ + V13D one-year self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v96-crypto-v11-v13d-one-year")
    parser.add_argument("--output-dir", default=".research-state/v96-crypto-v11eq-v13d-one-year")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    result = analyze(Path(args.cache_dir))
    write_outputs(result, Path(args.output_dir))
    print(json.dumps({
        "strategyId": result["strategyId"],
        "status": result["status"],
        "normal": result["results"]["NORMAL"]["unified"],
        "severe": result["results"]["SEVERE"]["unified"],
        "strictLowerBound": result["strictUnobservableFailClosedLowerBound"]["unified"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
