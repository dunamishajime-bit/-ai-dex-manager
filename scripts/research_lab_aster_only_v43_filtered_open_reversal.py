from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v39_overnight_open_router as v39
import research_lab_aster_only_v40_overnight_residual_router as v40

STRATEGY_ID = "DISDEX_ASTER_ONLY_V43_FILTERED_OPEN_REVERSAL"


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    minimum_confirmation_bps: float
    maximum_holding_hours: int
    direction_mode: str
    maximum_broad_overnight_bps: float
    maximum_broad_first_hour_bps: float
    first_hour_relation: str


CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(
        f"C{confirm:g}__H{hours}__{direction}__ONMAX{overnight:g}__OPENMAX{open_cap:g}__REL_{relation}",
        confirm,
        hours,
        direction,
        overnight,
        open_cap,
        relation,
    )
    for confirm in (25.0, 75.0)
    for hours in (1, 2)
    for direction in ("BOTH", "LONG_ONLY", "SHORT_ONLY")
    for overnight in (50.0, 100.0, 150.0)
    for open_cap in (50.0, 100.0, 10_000.0)
    for relation in ("ANY", "SAME_AS_BROAD", "OPPOSITE_BROAD")
)


def direction_allowed(mode: str, side: int) -> bool:
    return mode == "BOTH" or (mode == "LONG_ONLY" and side > 0) or (mode == "SHORT_ONLY" and side < 0)


def relation_allowed(mode: str, confirmation: float, broad_first_hour: float) -> bool:
    if mode == "ANY":
        return True
    product = confirmation * broad_first_hour
    if mode == "SAME_AS_BROAD":
        return product > 0
    if mode == "OPPOSITE_BROAD":
        return product < 0
    raise ValueError(mode)


def signal(candidate: Candidate, absolute_feature: Dict[str, dict], residual_feature: Dict[str, dict]) -> Optional[Tuple[str, int, float]]:
    first_row = next(iter(residual_feature.values()))
    broad_overnight = v39.finite(first_row["overnightMedianBps"])
    broad_first_hour = v39.finite(first_row["firstHourMedianBps"])
    if abs(broad_overnight) > candidate.maximum_broad_overnight_bps:
        return None
    if abs(broad_first_hour) > candidate.maximum_broad_first_hour_bps:
        return None

    eligible = []
    for symbol in v39.v14.SYMBOLS:
        row = absolute_feature[symbol]
        overnight = v39.finite(row["overnightBps"])
        confirmation = v39.finite(row["firstHourBps"])
        zscore = v39.finite(row["overnightZscore"])
        if not row["historyReady"]:
            continue
        if abs(overnight) < 150.0 or abs(confirmation) < candidate.minimum_confirmation_bps or abs(zscore) < 1.5:
            continue
        if overnight * confirmation >= 0:
            continue
        side = 1 if confirmation > 0 else -1
        if not direction_allowed(candidate.direction_mode, side):
            continue
        if not relation_allowed(candidate.first_hour_relation, confirmation, broad_first_hour):
            continue
        edge = max(0.0, min(abs(overnight), abs(confirmation)) - 5.0)
        strength = abs(confirmation) + 0.5 * abs(overnight) + 25.0 * abs(zscore)
        eligible.append((strength, symbol, side, edge))
    if not eligible:
        return None
    _strength, symbol, side, edge = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, side, edge


def build_trade(candidate: Candidate, day: str, absolute_feature: Dict[str, dict], residual_feature: Dict[str, dict]) -> Optional[dict]:
    selected = signal(candidate, absolute_feature, residual_feature)
    if selected is None:
        return None
    symbol, side, edge = selected
    row = absolute_feature[symbol]
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
            stop_hit = low <= entry_price * 0.99
            take_hit = high >= entry_price * 1.01
            stop_price, take_price = entry_price * 0.99, entry_price * 1.01
        else:
            stop_hit = high >= entry_price * 1.01
            take_hit = low <= entry_price * 0.99
            stop_price, take_price = entry_price * 1.01, entry_price * 0.99
        if stop_hit or take_hit:
            chosen_price, reason = (stop_price, "PRICE_STOP") if stop_hit else (take_price, "PRICE_TAKE_PROFIT")
            chosen_ts = int(bar[0]) + 30 * 60_000
            break
    entry_ts = int(row["entryTs"])
    price_return = side * (chosen_price / entry_price - 1.0)
    funding_return = (-side) * v39.v14.funding_mod.funding_between(row["fundingPoints"], entry_ts, chosen_ts)
    residual_row = residual_feature[symbol]
    return {
        "strategy": "V43_FILTERED_OPEN_REVERSAL",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": chosen_ts,
        "holdingHours": max(0.0, (chosen_ts - entry_ts) / 3_600_000.0),
        "overnightBps": v39.finite(row["overnightBps"]),
        "firstHourBps": v39.finite(row["firstHourBps"]),
        "overnightZscore": v39.finite(row["overnightZscore"]),
        "broadOvernightBps": v39.finite(residual_row["overnightMedianBps"]),
        "broadFirstHourBps": v39.finite(residual_row["firstHourMedianBps"]),
        "edgeProxyBps": edge,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "grossReturn": price_return + funding_return,
        "exitReason": reason,
    }


def build_trades(candidate: Candidate, days: Sequence[str], absolute_features: Dict[str, dict], residual_features: Dict[str, dict]) -> List[dict]:
    return [
        trade for day in days
        if (trade := build_trade(candidate, day, absolute_features[day], residual_features[day])) is not None
    ]


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
    absolute_features = v39.build_features(common, market_rows, funding)
    residual_features = v40.build_features(common, market_rows, funding)
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
        rows = build_trades(candidate, common, absolute_features, residual_features)
        result = v39.audit(v11_rows, v19_rows, rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
        diagnostics.append({
            "candidate": asdict(candidate),
            "rawTrades": len(rows),
            "development": result["development"],
            "validation": result["validation"],
            "developmentReversalTrades": result["developmentOvernightTrades"],
            "validationReversalTrades": result["validationOvernightTrades"],
            "full": result["full"],
            "fallbackFull": result["fallbackFull"],
            "finalReused": result["finalReused"],
            "holdout": result["holdout"],
            "checks": result["checks"],
        })
        if v39.development_pass(result, baseline):
            development_survivors.append((candidate, rows, result))
    development_survivors.sort(key=lambda item: item[2]["development"]["NORMAL"]["compoundedReturnPct"] + item[2]["development"]["P95"]["compoundedReturnPct"], reverse=True)
    validation_survivors = [item for item in development_survivors[:50] if v39.validation_pass(item[2], baseline)]
    validation_survivors.sort(key=lambda item: v39.selection_score(item[2], baseline), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V43_NO_VALIDATED_FILTERED_OPEN_REVERSAL"
    winner_payload = None
    if winner is not None:
        candidate, rows, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V43_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V43_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {"candidate": asdict(candidate), "rawTrades": len(rows), "accepted": accepted, "audit": result}

    diagnostics.sort(key=lambda row: row["development"]["NORMAL"]["compoundedReturnPct"] + row["development"]["P95"]["compoundedReturnPct"], reverse=True)
    return v39.v14.rounded({
        "version": 43,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "winner": winner_payload,
        "baseline": baseline,
        "topDevelopmentDiagnostics": diagnostics[:20],
        "period": {
            "startInclusiveUtc": v39.v19.BT_START.isoformat(),
            "endExclusiveUtc": v39.v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "targetSessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "signalSource": "FILTERED_OVERNIGHT_OPEN_REVERSAL",
            "entryNy": "10:30",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "v11EqPriority": True,
            "v19SequentialWhenNonOverlapping": True,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopFifty": True,
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
    lines = ["# Aster-only V43 Filtered Open Reversal", "", f"Status: **{result['status']}**", "", f"Candidates: {result['candidateCount']}", f"Development survivors: {result['developmentSurvivors']}", f"Validation survivors: {result['validationSurvivors']}", ""]
    if result["winner"]:
        winner = result["winner"]
        audit = winner["audit"]
        lines += [f"Winner: `{winner['candidate']['candidate_id']}`", f"Accepted: {winner['accepted']}", f"Normal: {audit['full']['NORMAL']['compoundedReturnPct']:.6f}%", f"P95: {audit['full']['P95']['compoundedReturnPct']:.6f}%", f"Fallback Normal: {audit['fallbackFull']['NORMAL']['compoundedReturnPct']:.6f}%", f"Fallback P95: {audit['fallbackFull']['P95']['compoundedReturnPct']:.6f}%", ""]
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
    print(json.dumps({"status": result["status"], "developmentSurvivors": result["developmentSurvivors"], "validationSurvivors": result["validationSurvivors"], "winner": result["winner"], "topDevelopmentDiagnostics": result["topDevelopmentDiagnostics"][:5]}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
