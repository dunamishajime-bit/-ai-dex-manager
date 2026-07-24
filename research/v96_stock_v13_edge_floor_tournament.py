from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import List

import v96_stock_v13_profit_pursuit_tournament as profit

STRATEGY_ID = "V96_STOCK_CROSS_VENUE_MAKER_HEDGE_V13_EDGE_FLOOR"
EDGE_FLOORS_BPS = (12.0, 15.0, 20.0)
DIVERSIFICATION_MODES = ("NONE", "NO_PREVIOUS_SYMBOL")
MIN_DEVELOPMENT_CYCLES = 5
MIN_VALIDATION_CYCLES = 4

# This continuation freezes the entry clock at exactly 10:00 New York.
profit.ENTRY_CUTOFF_MINUTE = 10 * 60


def simulate_arm(edge_floor_bps: float, diversification: str, data: dict) -> List[dict]:
    all_signals = sorted(set().union(*(set(node["common"]) for node in data.values())))
    rows: List[dict] = []
    portfolio_free_ts = -1
    previous_symbol = None
    for signal_ts in all_signals:
        if signal_ts < portfolio_free_ts:
            continue
        simultaneous = []
        for symbol in profit.hold.base.SYMBOLS:
            candidate = profit.candidate_at(symbol, signal_ts, "ASYMMETRIC", data)
            if candidate is None:
                continue
            _, quote_minute, _ = profit.local_parts(candidate["quoteTs"])
            if quote_minute != 10 * 60:
                continue
            if abs(candidate["spreadBps"]) < edge_floor_bps:
                continue
            if diversification == "NO_PREVIOUS_SYMBOL" and candidate["symbol"] == previous_symbol:
                continue
            simultaneous.append(candidate)
        if not simultaneous:
            continue
        selected = max(simultaneous, key=lambda row: (abs(row["spreadBps"]), row["symbol"]))
        trade = profit.realize(selected, "ASYMMETRIC", "LATE_TP30", data)
        trade["edgeFloorBps"] = edge_floor_bps
        trade["diversification"] = diversification
        rows.append(trade)
        previous_symbol = trade["symbol"]
        portfolio_free_ts = trade["exitTs"] + profit.STEP_MS
    return rows


def candidate_id(edge: float, diversification: str) -> str:
    return f"EDGE{int(edge)}__{diversification}"


def robust_score(node: dict) -> float:
    return (
        float(node["NORMAL"].get("averageNetBps") or -999.0)
        + float(node["P95"].get("averageNetBps") or -999.0)
        + float(node["SEVERE"].get("averageNetBps") or -999.0)
        + 2.0 * ((node["NORMAL"].get("profitFactor") or 0.0) - 1.0)
    )


def analyze(cache_dir: Path) -> dict:
    data, diagnostics = profit.load_data(cache_dir)
    days = sorted({
        profit.hold.base.day_string(ts)
        for node in data.values()
        for ts in node["common"]
        if profit.hold.base.regular_bar_start(ts)
    })
    bounds = profit.fixed_bounds(days)

    reports = {}
    trades_by_id = {}
    for edge in EDGE_FLOORS_BPS:
        for diversification in DIVERSIFICATION_MODES:
            cid = candidate_id(edge, diversification)
            trades = simulate_arm(edge, diversification, data)
            trades_by_id[cid] = trades
            reports[cid] = {
                "edgeFloorBps": edge,
                "diversification": diversification,
                "forcedTakerCosts": profit.scenario_report(
                    trades, bounds, profit.hold.base.FORCED_TAKER_COSTS
                ),
                "twoMakerSensitivity": profit.scenario_report(
                    trades, bounds, profit.hold.base.TWO_MAKER_COSTS
                ),
                "concentrationNormal": profit.concentration(
                    trades, profit.hold.base.FORCED_TAKER_COSTS["NORMAL"]
                ),
                "portfolioNormal": profit.portfolio_metrics(
                    trades, profit.hold.base.FORCED_TAKER_COSTS["NORMAL"]
                ),
            }

    growth_pool = []
    diversified_pool = []
    for cid, report in reports.items():
        dev = report["forcedTakerCosts"]["periods"]["DEVELOPMENT"]
        eligible = bool(
            dev["NORMAL"]["cycles"] >= MIN_DEVELOPMENT_CYCLES
            and all((dev[name].get("averageNetBps") or -999.0) > 0 for name in ("NORMAL", "P95", "SEVERE"))
        )
        if not eligible:
            continue
        item = (robust_score(dev), cid)
        if report["diversification"] == "NONE":
            growth_pool.append(item)
        else:
            diversified_pool.append(item)

    growth_id = max(growth_pool)[1] if growth_pool else "EDGE20__NONE"
    diversified_id = max(diversified_pool)[1] if diversified_pool else "EDGE20__NO_PREVIOUS_SYMBOL"
    growth = reports[growth_id]
    diversified = reports[diversified_id]

    growth_validation = growth["forcedTakerCosts"]["periods"]["VALIDATION"]
    growth_holdout = growth["forcedTakerCosts"]["periods"]["HOLDOUT"]
    growth_full = growth["forcedTakerCosts"]["full"]
    growth_concentration = growth["concentrationNormal"]["maxPositiveProfitContributionShare"]

    growth_stress_pass = bool(
        growth_validation["SEVERE"]["cycles"] >= MIN_VALIDATION_CYCLES
        and growth_holdout["SEVERE"]["cycles"] >= MIN_VALIDATION_CYCLES
        and all((growth_validation[name].get("averageNetBps") or -999.0) > 0 for name in ("NORMAL", "P95", "SEVERE"))
        and all((growth_holdout[name].get("averageNetBps") or -999.0) > 0 for name in ("NORMAL", "P95", "SEVERE"))
        and all((growth_full[name].get("averageNetBps") or -999.0) > 0 for name in ("NORMAL", "P95", "SEVERE"))
    )
    growth_concentration_pass = bool(growth_concentration is not None and growth_concentration <= 0.40)

    if growth_stress_pass and growth_concentration_pass:
        status = "V13G_EDGE_FLOOR_HISTORICAL_PASS_FORWARD_REQUIRED"
    elif growth_stress_pass:
        status = "V13G_EDGE20_PROFIT_LEAD_CONCENTRATED_FORWARD_ONLY"
    else:
        status = "V13G_EDGE_FLOOR_REUSED_HISTORY_INCONCLUSIVE"

    selected_trades = trades_by_id[growth_id]
    return profit.rounded({
        "version": 13,
        "strategyId": STRATEGY_ID,
        "generatedAt": dt.datetime.now(profit.hold.base.UTC).isoformat(),
        "fixedDataEndUtc": profit.hold.base.FIXED_END_UTC.isoformat(),
        "status": status,
        "universe": list(profit.hold.base.SYMBOLS),
        "chronology": bounds,
        "data": {
            "interval": profit.INTERVAL,
            "regularSessions": len(days),
            "firstSession": days[0],
            "lastSession": days[-1],
            "diagnostics": diagnostics,
        },
        "candidates": reports,
        "selectedGrowth": {
            "candidateId": growth_id,
            **growth,
            "removalNormal": profit.removal_tests(
                selected_trades, profit.hold.base.FORCED_TAKER_COSTS["NORMAL"]
            ),
            "stressPass": growth_stress_pass,
            "concentrationPass": growth_concentration_pass,
        },
        "selectedDiversified": {
            "candidateId": diversified_id,
            **diversified,
        },
        "rules": {
            "makerVenue": "ASTER",
            "hedgeVenue": "XYZ",
            "quoteTimeNy": "10:00 only",
            "entryDirection": "Aster discount BUY or Aster premium SELL at 10:00",
            "simultaneousSelection": "largest absolute spread among symbols available at 10:00 only",
            "onePositionTotal": True,
            "targetExitNy": "15:00",
            "lateTakeProfit": "completed 14:00 pair price PnL >= 30 bps exits at 14:30",
            "edgeFloorsBps": list(EDGE_FLOORS_BPS),
            "diversificationModes": list(DIVERSIFICATION_MODES),
            "lookaheadSelection": False,
        },
        "selectionDiscipline": {
            "classification": "reused historical exploratory selection",
            "developmentSelection": True,
            "validationAndHoldoutReported": True,
            "independentHoldoutClaim": False,
            "nearbyEdgeFloorSearchAfterThisRun": False,
            "forwardSelectionRequired": True,
        },
        "limitations": [
            "The 12/15/20 bps floors were tested after earlier V13 history had already been inspected.",
            "Historical candles cannot prove queue consumption, partial-fill safety, exact bid/ask or second-Maker closes.",
            "The Growth and Diversified arms must be frozen before untouched Forward comparison.",
            "No historical result authorizes Production or LIVE.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11Changed": False,
            "forwardCollectorChanged": False,
        },
        "trades": selected_trades,
    })


def write_outputs(result: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    trades = result.pop("trades", [])
    (output_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "trades.json").write_text(json.dumps(trades, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = [
        "# V13 Edge-Floor Tournament",
        "",
        f"- Status: **{result['status']}**",
        f"- Growth arm: **{result['selectedGrowth']['candidateId']}**",
        f"- Diversified arm: **{result['selectedDiversified']['candidateId']}**",
        "- Production / LIVE / VPS / Crypto V96 / V11 / Forward collector changed: **NO**",
    ]
    (output_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    assert EDGE_FLOORS_BPS == (12.0, 15.0, 20.0)
    assert profit.ENTRY_CUTOFF_MINUTE == 600
    assert candidate_id(20.0, "NONE") == "EDGE20__NONE"
    assert candidate_id(15.0, "NO_PREVIOUS_SYMBOL") == "EDGE15__NO_PREVIOUS_SYMBOL"
    print("V13 edge-floor self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", default=".cache/v13-edge-floor")
    parser.add_argument("--output-dir", default=".research-state/v13-edge-floor")
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
        "growth": result["selectedGrowth"]["candidateId"],
        "diversified": result["selectedDiversified"]["candidateId"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
