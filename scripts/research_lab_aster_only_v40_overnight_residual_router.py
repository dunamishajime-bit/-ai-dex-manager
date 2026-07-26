from __future__ import annotations

import argparse
import json
import statistics
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v39_overnight_open_router as v39

STRATEGY_ID = "DISDEX_ASTER_ONLY_V40_OVERNIGHT_RESIDUAL_ROUTER"


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    minimum_residual_bps: float
    minimum_confirmation_bps: float
    minimum_residual_zscore: float
    maximum_holding_hours: int


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"{family}__R{residual:g}__C{confirm:g}__Z{z:g}__H{hours}",
        family,
        residual,
        confirm,
        z,
        hours,
    )
    for family in ("RESIDUAL_CONTINUATION", "RESIDUAL_REVERSAL")
    for residual in (50.0, 100.0, 150.0)
    for confirm in (25.0, 50.0, 75.0)
    for z in (0.0, 1.5)
    for hours in (1, 2)
)


def build_features(days: Sequence[str], rows: Dict[str, Dict[str, dict]], funding: dict) -> Dict[str, dict]:
    residual_history: Dict[str, List[float]] = {symbol: [] for symbol in v39.v14.SYMBOLS}
    result: Dict[str, dict] = {}
    for day in days:
        overnight = {
            symbol: (v39.finite(rows[symbol][day]["preopen"]) / v39.finite(rows[symbol][day]["previousClose"]) - 1.0) * 10_000.0
            for symbol in v39.v14.SYMBOLS
        }
        first_hour = {
            symbol: (v39.finite(rows[symbol][day]["signal"]) / v39.finite(rows[symbol][day]["preopen"]) - 1.0) * 10_000.0
            for symbol in v39.v14.SYMBOLS
        }
        overnight_median = statistics.median(overnight.values())
        first_hour_median = statistics.median(first_hour.values())
        result[day] = {}
        for symbol in v39.v14.SYMBOLS:
            residual = overnight[symbol] - overnight_median
            confirmation = first_hour[symbol] - first_hour_median
            previous = residual_history[symbol][-v39.LOOKBACK:]
            sigma = statistics.pstdev(previous) if len(previous) >= v39.LOOKBACK else 0.0
            median = statistics.median(previous) if len(previous) >= v39.LOOKBACK else 0.0
            zscore = (residual - median) / sigma if sigma > 1e-9 else 0.0
            result[day][symbol] = {
                **rows[symbol][day],
                "overnightBps": overnight[symbol],
                "firstHourBps": first_hour[symbol],
                "overnightMedianBps": overnight_median,
                "firstHourMedianBps": first_hour_median,
                "overnightResidualBps": residual,
                "firstHourResidualBps": confirmation,
                "residualZscore": zscore,
                "historyReady": len(previous) >= v39.LOOKBACK,
                "fundingPoints": funding.get(symbol, []),
            }
            residual_history[symbol].append(residual)
    return result


def signal(candidate: Candidate, day_feature: Dict[str, dict]) -> Optional[Tuple[str, int, float]]:
    eligible = []
    for symbol in v39.v14.SYMBOLS:
        row = day_feature[symbol]
        residual = v39.finite(row["overnightResidualBps"])
        confirmation = v39.finite(row["firstHourResidualBps"])
        zscore = v39.finite(row["residualZscore"])
        if not row["historyReady"]:
            continue
        if abs(residual) < candidate.minimum_residual_bps or abs(confirmation) < candidate.minimum_confirmation_bps:
            continue
        if candidate.minimum_residual_zscore > 0 and abs(zscore) < candidate.minimum_residual_zscore:
            continue
        if candidate.family == "RESIDUAL_CONTINUATION":
            if residual * confirmation <= 0:
                continue
            side = 1 if confirmation > 0 else -1
        elif candidate.family == "RESIDUAL_REVERSAL":
            if residual * confirmation >= 0:
                continue
            side = 1 if confirmation > 0 else -1
        else:
            raise ValueError(candidate.family)
        edge = max(0.0, min(abs(residual), abs(confirmation)) - 5.0)
        strength = abs(confirmation) + 0.5 * abs(residual) + 25.0 * abs(zscore)
        eligible.append((strength, symbol, side, edge))
    if not eligible:
        return None
    _strength, symbol, side, edge = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, side, edge


def build_trade(candidate: Candidate, day: str, day_feature: Dict[str, dict]) -> Optional[dict]:
    selected = signal(candidate, day_feature)
    if selected is None:
        return None
    symbol, side, edge = selected
    row = day_feature[symbol]
    entry_price = v39.finite(row["entry"])
    bars = row["bars"]
    exit_minute = 690 if candidate.maximum_holding_hours == 1 else 750
    chosen_price = v39.finite(bars[exit_minute][1])
    chosen_ts = int(bars[exit_minute][0])
    reason = f"TIME_{candidate.maximum_holding_hours}H"
    scan_minutes = (630, 660) if candidate.maximum_holding_hours == 1 else (630, 660, 690, 720)
    for minute in scan_minutes:
        bar = bars[minute]
        high, low = v39.finite(bar[2]), v39.finite(bar[3])
        if side > 0:
            stop_hit = low <= entry_price * (1.0 - v39.SL_PCT / 100.0)
            take_hit = high >= entry_price * (1.0 + v39.TP_PCT / 100.0)
            stop_price = entry_price * (1.0 - v39.SL_PCT / 100.0)
            take_price = entry_price * (1.0 + v39.TP_PCT / 100.0)
        else:
            stop_hit = high >= entry_price * (1.0 + v39.SL_PCT / 100.0)
            take_hit = low <= entry_price * (1.0 - v39.TP_PCT / 100.0)
            stop_price = entry_price * (1.0 + v39.SL_PCT / 100.0)
            take_price = entry_price * (1.0 - v39.TP_PCT / 100.0)
        if stop_hit or take_hit:
            chosen_price, reason = (stop_price, "PRICE_STOP") if stop_hit else (take_price, "PRICE_TAKE_PROFIT")
            chosen_ts = int(bar[0]) + 30 * 60_000
            break
    entry_ts = int(row["entryTs"])
    price_return = side * (chosen_price / entry_price - 1.0)
    funding_return = (-side) * v39.v14.funding_mod.funding_between(row["fundingPoints"], entry_ts, chosen_ts)
    return {
        "strategy": "V40_OVERNIGHT_RESIDUAL",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": chosen_ts,
        "holdingHours": max(0.0, (chosen_ts - entry_ts) / 3_600_000.0),
        "overnightResidualBps": v39.finite(row["overnightResidualBps"]),
        "firstHourResidualBps": v39.finite(row["firstHourResidualBps"]),
        "residualZscore": v39.finite(row["residualZscore"]),
        "edgeProxyBps": edge,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": reason,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    return [trade for day in days if (trade := build_trade(candidate, day, features[day])) is not None]


def analyze(cache_root: Path) -> dict:
    v39.v14.base.verify_source(v39.v14.base.V11_ROOT, v39.v14.base.V11_SOURCE_SHA)
    v39.v14.base.verify_source(v39.v14.base.V13_ROOT, v39.v14.base.V13_SOURCE_SHA)
    v39.v19.configure_exact_data_window()
    days, aligned, aligned_diag = v39.v19.v17.load_all(cache_root / "aligned")
    warmup = [day for day in days if v39.v19.WARMUP_START.date().isoformat() <= day < v39.v19.BT_END_DAY_EXCLUSIVE]
    market = v39.v14.v11.v9.load_market(cache_root / "aster-market")
    market_rows, market_diag = v39.parse_market(market, warmup)
    common = [day for day in warmup if all(day in market_rows[symbol] for symbol in v39.v14.SYMBOLS)]
    funding_raw = v39.v14.funding_mod.load_funding(cache_root / "funding")
    funding = {symbol: v39.v14.funding_mod.funding_points(rows) for symbol, rows in funding_raw.items()}
    features = build_features(common, market_rows, funding)
    target = [day for day in common if v39.v19.BT_START_DAY <= day < v39.v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < v39.HOLDOUT_START]
    holdout = [day for day in target if day >= v39.HOLDOUT_START]
    splits = v39.v14.split_days(pre_holdout)
    v11_rows, v11_diag = v39.v22.build_v11eq(warmup, aligned)
    v19_rows = v39.v22.build_fallback(warmup, aligned)
    baseline = v39.v22.audit(v11_rows, v19_rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True)

    development_survivors = []
    diagnostics = []
    for candidate in CANDIDATES:
        rows = build_trades(candidate, common, features)
        result = v39.audit(v11_rows, v19_rows, rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
        diagnostics.append({
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "development": result["development"],
            "validation": result["validation"],
            "developmentResidualTrades": result["developmentOvernightTrades"],
            "validationResidualTrades": result["validationOvernightTrades"],
        })
        if v39.development_pass(result, baseline):
            development_survivors.append((candidate, rows, result))
    development_survivors.sort(key=lambda item: item[2]["development"]["NORMAL"]["compoundedReturnPct"] + item[2]["development"]["P95"]["compoundedReturnPct"], reverse=True)
    validation_survivors = [item for item in development_survivors[:30] if v39.validation_pass(item[2], baseline)]
    validation_survivors.sort(key=lambda item: v39.selection_score(item[2], baseline), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V40_NO_VALIDATED_OVERNIGHT_RESIDUAL_ROUTER"
    winner_payload = None
    if winner is not None:
        candidate, rows, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V40_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V40_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {"candidate": asdict(candidate), "rawTrades": len(rows), "accepted": accepted, "audit": result}

    diagnostics.sort(key=lambda row: row["development"]["NORMAL"]["compoundedReturnPct"] + row["development"]["P95"]["compoundedReturnPct"], reverse=True)
    return v39.v14.rounded({
        "version": 40,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner_payload,
        "baseline": baseline,
        "topDevelopmentDiagnostics": diagnostics[:15],
        "period": {
            "startInclusiveUtc": v39.v19.BT_START.isoformat(),
            "endExclusiveUtc": v39.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "targetSessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "signalSource": "CROSS_SECTIONAL_OVERNIGHT_AND_FIRST_HOUR_RESIDUAL",
            "entryNy": "10:30",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "v11EqPriority": True,
            "v19SequentialWhenNonOverlapping": True,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopThirty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "productionPromotionAllowed": False,
        },
        "data": {"aligned": aligned_diag, "aster24h": market_diag, "commonSessions": len(common)},
        "v11Diagnostics": v11_diag,
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v19Changed": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V40 Overnight Residual Router", "",
        f"Status: **{result['status']}**", "",
        f"Candidates: {result['candidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}", "",
    ]
    if result["winner"]:
        winner = result["winner"]
        audit = winner["audit"]
        lines += [
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Normal: {audit['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"P95: {audit['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Fallback Normal: {audit['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Fallback P95: {audit['fallbackFull']['P95']['compoundedReturnPct']:.6f}%", "",
        ]
    lines += ["Research only. No Production, LIVE, VPS or order state was changed.", ""]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
        "topDevelopmentDiagnostics": result["topDevelopmentDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
