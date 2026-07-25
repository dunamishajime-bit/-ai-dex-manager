from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import statistics
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v15_intraday_shock_tournament as v15
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20

STRATEGY_ID = "DISDEX_ASTER_ONLY_V21_BROAD_UNIVERSE_STRICT_TOURNAMENT"
SCENARIOS = v14.SCENARIOS
BT_START = v19.BT_START
BT_END_EXCLUSIVE = v19.BT_END_EXCLUSIVE
BT_START_DAY = v19.BT_START_DAY
BT_END_DAY_EXCLUSIVE = v19.BT_END_DAY_EXCLUSIVE
WARMUP_START = v19.WARMUP_START
HOLDOUT_START_DAY = v20.HOLDOUT_START_DAY

LOOKBACK_SESSIONS = 20
MIN_SYMBOL_ALIGNED_SESSIONS = 120
MIN_AVAILABLE_SYMBOLS_PER_DAY = 8
MAX_GROSS = 1.0
MAX_HOLDING_HOURS = 2

UNIVERSE_MAP = {
    "ADBEUSDT": "ADBE",
    "AMDUSDT": "AMD",
    "AMATUSDT": "AMAT",
    "AMZNUSDT": "AMZN",
    "ARMUSDT": "ARM",
    "ASMLUSDT": "ASML",
    "AVGOUSDT": "AVGO",
    "CRMUSDT": "CRM",
    "GOOGLUSDT": "GOOGL",
    "INTCUSDT": "INTC",
    "METAUSDT": "META",
    "MRVLUSDT": "MRVL",
    "MSFTUSDT": "MSFT",
    "MUUSDT": "MU",
    "NVDAUSDT": "NVDA",
    "ORCLUSDT": "ORCL",
    "PLTRUSDT": "PLTR",
    "QCOMUSDT": "QCOM",
    "TSMUSDT": "TSM",
    "TSLAUSDT": "TSLA",
}

REQUIRED_PERP_MINUTES = {
    600, 630, 660, 690, 720, 750, 780, 810, 840, 870, 900, 930
}
CHECK_CLOSE_STARTS = (660, 720, 780, 840, 900)
EXIT_OPEN_MINUTES = (690, 750, 810, 870, 930)


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    slot_policy: str
    slots: Tuple[int, ...]


CANDIDATES = (
    Candidate("BROAD_Z2_SLOT_1230_H2", "SLOT_1230", (2,)),
    Candidate("BROAD_Z2_EARLY_1130_1230_H2", "EARLY_1130_1230", (1, 2)),
    Candidate("BROAD_Z2_ALL_1130_1230_1330_H2", "ALL_1130_1230_1330", (1, 2, 3)),
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def rounded(value: Any):
    return v14.rounded(value)


def parse_perp_intraday(rows: Sequence[list], funding_rows: Sequence[dict]) -> Tuple[Dict[str, dict], dict]:
    by_day: Dict[str, dict] = defaultdict(dict)
    valid = 0
    for row in rows:
        if not isinstance(row, list) or len(row) < 6:
            continue
        ts = int(row[0])
        day, minute, weekday = v14.v11.v9.local_parts(ts)
        if weekday >= 5 or minute not in REQUIRED_PERP_MINUTES:
            continue
        open_price = finite(row[1], math.nan)
        close_price = finite(row[4], math.nan)
        if not math.isfinite(open_price) or not math.isfinite(close_price) or min(open_price, close_price) <= 0:
            continue
        by_day[day][minute] = {
            "ts": ts,
            "open": open_price,
            "close": close_price,
        }
        valid += 1

    funding_points = v14.funding_mod.funding_points(funding_rows)
    complete: Dict[str, dict] = {}
    for day, slots in by_day.items():
        if not REQUIRED_PERP_MINUTES.issubset(slots):
            continue
        signal = slots[600]
        entry = slots[630]
        checkpoints = []
        for close_start, exit_minute in zip(CHECK_CLOSE_STARTS, EXIT_OPEN_MINUTES):
            check = slots[close_start]
            exit_row = slots[exit_minute]
            checkpoints.append({
                "ts": int(check["ts"]) + 30 * 60 * 1000,
                "perp": finite(check["close"]),
                "exit": finite(exit_row["open"]),
                "exitTs": int(exit_row["ts"]),
            })
        complete[day] = {
            "signal": finite(signal["close"]),
            "signalTs": int(signal["ts"]) + 30 * 60 * 1000,
            "entry": finite(entry["open"]),
            "entryTs": int(entry["ts"]),
            "checkpoints": checkpoints,
            "fundingPoints": funding_points,
        }
    return complete, {
        "tradeBars": valid,
        "fundingRows": len(funding_rows),
        "completeDays": len(complete),
        "firstDay": min(complete) if complete else None,
        "lastDay": max(complete) if complete else None,
    }


def load_symbol(symbol: str, ticker: str, cache_root: Path) -> Tuple[str, Dict[str, dict], dict]:
    errors: List[str] = []
    cash: Dict[str, dict] = {}
    perp: Dict[str, dict] = {}
    cash_diag: dict = {}
    perp_diag: dict = {}
    try:
        payload = v14.v11.v10.fetch_yahoo_chart(ticker, cache_root / "cash")
        cash, cash_diag = v14.v11.parse_cash_intraday(payload)
    except Exception as exc:
        errors.append(f"cash:{type(exc).__name__}:{exc}")
    try:
        rows = v14.v11.v9.request_series(symbol, "trade", cache_root / "perp")
        funding_rows = v14.funding_mod.fetch_funding(symbol, cache_root / "funding")
        perp, perp_diag = parse_perp_intraday(rows, funding_rows)
    except Exception as exc:
        errors.append(f"perp:{type(exc).__name__}:{exc}")

    common = sorted(set(cash) & set(perp))
    aligned: Dict[str, dict] = {}
    clock_rejected = 0
    for day in common:
        c = cash[day]
        p = perp[day]
        if abs(int(c["signalTs"]) - int(p["signalTs"])) > 5 * 60 * 1000:
            clock_rejected += 1
            continue
        if abs(int(c["entryTs"]) - int(p["entryTs"])) > 5 * 60 * 1000:
            clock_rejected += 1
            continue
        checkpoints = []
        valid = True
        for cash_check, perp_check in zip(c["checkpoints"], p["checkpoints"]):
            if abs(int(cash_check["ts"]) - int(perp_check["ts"])) > 5 * 60 * 1000:
                valid = False
                break
            cash_price = finite(cash_check["cash"])
            perp_price = finite(perp_check["perp"])
            if min(cash_price, perp_price) <= 0:
                valid = False
                break
            checkpoints.append({
                "ts": int(perp_check["ts"]),
                "basisBps": (perp_price / cash_price - 1.0) * 10_000.0,
                "exit": finite(perp_check["exit"]),
                "exitTs": int(perp_check["exitTs"]),
            })
        if not valid:
            clock_rejected += 1
            continue
        cash_entry = finite(c["entry"])
        perp_entry = finite(p["entry"])
        if min(cash_entry, perp_entry) <= 0:
            continue
        aligned[day] = {
            "symbol": symbol,
            "ticker": ticker,
            "cash": c,
            "perp": p,
            "basisBps": (finite(p["signal"]) / finite(c["signal"]) - 1.0) * 10_000.0,
            "entry": perp_entry,
            "entryTs": int(p["entryTs"]),
            "checkpoints": checkpoints,
        }

    return symbol, aligned, {
        "ticker": ticker,
        "cash": cash_diag,
        "perp": perp_diag,
        "commonDays": len(common),
        "alignedDays": len(aligned),
        "clockRejected": clock_rejected,
        "firstAligned": min(aligned) if aligned else None,
        "lastAligned": max(aligned) if aligned else None,
        "errors": errors,
    }


def load_broad_universe(cache_root: Path) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    aligned: Dict[str, Dict[str, dict]] = {}
    diagnostics = {"requestedSymbols": len(UNIVERSE_MAP), "symbols": {}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(load_symbol, symbol, ticker, cache_root): symbol
            for symbol, ticker in UNIVERSE_MAP.items()
        }
        for future in concurrent.futures.as_completed(futures):
            symbol = futures[future]
            try:
                returned_symbol, rows, detail = future.result()
            except Exception as exc:
                returned_symbol, rows, detail = symbol, {}, {
                    "ticker": UNIVERSE_MAP[symbol],
                    "alignedDays": 0,
                    "errors": [f"load:{type(exc).__name__}:{exc}"],
                }
            aligned[returned_symbol] = rows
            diagnostics["symbols"][returned_symbol] = detail
            print(f"loaded broad {returned_symbol}: {len(rows)} aligned days")

    eligible = sorted(
        symbol
        for symbol, rows in aligned.items()
        if sum(BT_START_DAY <= day < BT_END_DAY_EXCLUSIVE for day in rows)
        >= MIN_SYMBOL_ALIGNED_SESSIONS
    )
    diagnostics["eligibleSymbols"] = eligible
    diagnostics["eligibleSymbolCount"] = len(eligible)
    diagnostics["excludedSymbols"] = sorted(set(UNIVERSE_MAP) - set(eligible))
    return {symbol: aligned[symbol] for symbol in eligible}, diagnostics


def build_features(
    aligned: Dict[str, Dict[str, dict]],
) -> Tuple[List[str], Dict[str, dict]]:
    histories: Dict[str, Dict[int, List[float]]] = {
        symbol: {slot: [] for slot in range(6)}
        for symbol in aligned
    }
    union_days = sorted(set().union(*(set(rows) for rows in aligned.values())))
    features: Dict[str, dict] = {}

    for day in union_days:
        day_symbols: Dict[str, dict] = {}
        raw_points: Dict[str, List[dict]] = {}
        for symbol, rows in aligned.items():
            row = rows.get(day)
            if row is None:
                continue
            raw_points[symbol] = v15.points_for(row)
        if len(raw_points) < MIN_AVAILABLE_SYMBOLS_PER_DAY:
            for symbol, points in raw_points.items():
                for slot, point in enumerate(points):
                    histories[symbol][slot].append(finite(point["basisBps"]))
            continue

        for symbol, points in raw_points.items():
            enriched = []
            for slot, point in enumerate(points):
                previous = histories[symbol][slot][-LOOKBACK_SESSIONS:]
                median = statistics.median(previous) if len(previous) >= LOOKBACK_SESSIONS else 0.0
                sigma = statistics.pstdev(previous) if len(previous) >= LOOKBACK_SESSIONS else 0.0
                residual = finite(point["basisBps"]) - median
                enriched.append({
                    **point,
                    "rollingMedianBasisBps": median,
                    "rollingSigmaBasisBps": sigma,
                    "residualBps": residual,
                    "zscore": residual / sigma if sigma > 1e-9 else 0.0,
                    "historyReady": len(previous) >= LOOKBACK_SESSIONS,
                })
                histories[symbol][slot].append(finite(point["basisBps"]))
            day_symbols[symbol] = {
                "points": enriched,
                "fundingPoints": aligned[symbol][day]["perp"]["fundingPoints"],
            }
        features[day] = {"symbols": day_symbols}

    return sorted(features), features


def build_trade_at_slot(
    candidate: Candidate,
    day: str,
    day_feature: dict,
    slot: int,
) -> Optional[dict]:
    eligible = []
    for symbol, symbol_row in day_feature["symbols"].items():
        current = symbol_row["points"][slot]
        if not current["historyReady"]:
            continue
        residual = finite(current["residualBps"])
        zscore = finite(current["zscore"])
        if abs(zscore) < 2.0 or abs(residual) < 35.0:
            continue
        side = -1 if residual > 0 else 1
        strength = abs(zscore) * 100.0 + abs(residual)
        edge_proxy = max(0.0, abs(residual) - 10.0)
        eligible.append((strength, symbol, side, edge_proxy, {
            "basisBps": finite(current["basisBps"]),
            "residualBps": residual,
            "zscore": zscore,
        }))
    if not eligible:
        return None
    _strength, symbol, side, edge_proxy, detail = sorted(
        eligible, key=lambda item: (-item[0], item[1])
    )[0]
    symbol_row = day_feature["symbols"][symbol]
    points = symbol_row["points"]
    entry = points[slot]
    final_index = min(len(points) - 1, slot + MAX_HOLDING_HOURS)
    chosen = points[final_index]
    reason = f"TIME_{MAX_HOLDING_HOURS}H"
    for point in points[slot + 1 : final_index + 1]:
        price_return = side * (finite(point["price"]) / finite(entry["price"]) - 1.0)
        if price_return >= v15.TAKE_PROFIT_PCT / 100.0:
            chosen = point
            reason = "PRICE_TAKE_PROFIT"
            break
        if price_return <= -v15.STOP_LOSS_PCT / 100.0:
            chosen = point
            reason = "PRICE_STOP"
            break
    entry_ts = int(entry["ts"])
    exit_ts = int(chosen["ts"])
    price_return = side * (finite(chosen["price"]) / finite(entry["price"]) - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(
        symbol_row["fundingPoints"], entry_ts, exit_ts
    )
    return {
        "strategy": "ASTER_ONLY_V21_BROAD",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "entrySlot": str(entry["label"]),
        "side": side,
        "gross": MAX_GROSS,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "entryPrice": finite(entry["price"]),
        "exitPrice": finite(chosen["price"]),
        "edgeProxyBps": edge_proxy,
        "grossReturn": price_return + funding_return,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "exitReason": reason,
        "signalDetail": detail,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    trades: List[dict] = []
    for day in days:
        if day not in features:
            continue
        next_free_ts = -1
        for slot in candidate.slots:
            symbol_rows = features[day]["symbols"]
            first_symbol = min(symbol_rows)
            slot_ts = int(symbol_rows[first_symbol]["points"][slot]["ts"])
            if slot_ts < next_free_ts:
                continue
            trade = build_trade_at_slot(candidate, day, features[day], slot)
            if trade is None:
                continue
            trades.append(trade)
            next_free_ts = int(trade["exitTs"])
    return sorted(trades, key=lambda row: (int(row["entryTs"]), str(row["symbol"])))


def selection_score(result: dict) -> float:
    normal = result["NORMAL"]
    p95 = result["P95"]
    return (
        normal["compoundedReturnPct"]
        + p95["compoundedReturnPct"]
        + 0.10 * normal["netBpsPerCapitalHour"]
        - 0.50 * abs(normal["maxDrawdownPct"])
    )


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()

    aligned, diagnostics = load_broad_universe(cache_root)
    if len(aligned) < MIN_AVAILABLE_SYMBOLS_PER_DAY:
        return rounded({
            "version": 21,
            "strategyId": STRATEGY_ID,
            "status": "ASTER_ONLY_V21_INSUFFICIENT_BROAD_UNIVERSE_DATA",
            "candidateCount": len(CANDIDATES),
            "data": diagnostics,
            "safety": {
                "mode": "RESEARCH_ONLY",
                "orderSubmissionAllowed": False,
                "productionChanged": False,
                "liveChanged": False,
                "vpsChanged": False,
                "cryptoV96Changed": False,
                "v11EqChanged": False,
                "v13dProductionChanged": False,
            },
        })

    all_days, features = build_features(aligned)
    target_days = [day for day in all_days if BT_START_DAY <= day < BT_END_DAY_EXCLUSIVE]
    pre_holdout_days = [day for day in target_days if day < HOLDOUT_START_DAY]
    holdout_days = [day for day in target_days if day >= HOLDOUT_START_DAY]
    if len(pre_holdout_days) < 60 or not holdout_days:
        raise RuntimeError("Insufficient broad-universe chronological sessions")

    splits = v14.split_days(pre_holdout_days)
    all_trades = {
        candidate.candidate_id: build_trades(candidate, all_days, features)
        for candidate in CANDIDATES
    }

    rows = []
    for candidate in CANDIDATES:
        trades = all_trades[candidate.candidate_id]
        development = v20.scenario_set(trades, splits["DEVELOPMENT"])
        validation = v20.scenario_set(trades, splits["VALIDATION"])
        rows.append({
            "candidate": asdict(candidate),
            "development": development,
            "validation": validation,
            "developmentPassed": v20.development_pass(development),
            "validationPassed": v20.validation_pass(validation),
            "validationScore": selection_score(validation),
        })

    validation_eligible = [
        row for row in rows
        if row["developmentPassed"] and row["validationPassed"]
    ]
    selected = max(
        validation_eligible,
        key=lambda row: (row["validationScore"], row["candidate"]["candidate_id"]),
        default=None,
    )
    diagnostic = max(
        [row for row in rows if row["developmentPassed"]] or rows,
        key=lambda row: (row["validationScore"], row["candidate"]["candidate_id"]),
    )

    def evaluate(row: dict) -> dict:
        trades = all_trades[row["candidate"]["candidate_id"]]
        final_reused = v20.scenario_set(trades, splits["FINAL_REUSED"])
        holdout = v20.scenario_set(trades, holdout_days)
        full = v20.scenario_set(trades, target_days)
        checks, robustness = v20.strict_checks(
            trades,
            target_days,
            row["development"],
            row["validation"],
            final_reused,
            holdout,
        )
        return {
            **row,
            "finalReused": final_reused,
            "holdout": holdout,
            "full": full,
            "checks": checks,
            "allStrictHurdlesPassed": all(checks.values()),
            "robustness": robustness,
            "tradeAudit": [
                trade for trade in trades if str(trade["day"]) in set(target_days)
            ],
        }

    diagnostic_lead = evaluate(diagnostic)
    winner = evaluate(selected) if selected is not None else None
    strict_pass = bool(winner and winner["allStrictHurdlesPassed"])
    status = (
        "ASTER_ONLY_V21_BROAD_UNIVERSE_STRICT_PASS_SHADOW_ONLY"
        if strict_pass
        else "ASTER_ONLY_V21_NO_BROAD_UNIVERSE_STRICT_CANDIDATE"
    )

    return rounded({
        "version": 21,
        "strategyId": STRATEGY_ID,
        "status": status,
        "period": {
            "startInclusiveUtc": BT_START.isoformat(),
            "endExclusiveUtc": BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": (BT_END_EXCLUSIVE - BT_START).days,
            "sessions": len(target_days),
            "selectionSessions": len(pre_holdout_days),
            "holdoutSessions": len(holdout_days),
            "firstSession": target_days[0],
            "lastSession": target_days[-1],
        },
        "candidateCount": len(CANDIDATES),
        "requestedUniverse": UNIVERSE_MAP,
        "eligibleUniverse": sorted(aligned),
        "eligibleUniverseCount": len(aligned),
        "rules": {
            "venue": "ASTER_ONLY",
            "hyperliquidUsed": False,
            "fixedZscoreThreshold": 2.0,
            "fixedMinimumResidualBps": 35.0,
            "maximumGross": MAX_GROSS,
            "maximumOnePositionAtATime": True,
            "maximumHoldingHours": MAX_HOLDING_HOURS,
            "entrySlotsNy": ["11:30", "12:30", "13:30"],
            "universeChosenByUnderlyingSizeNotBacktestProfit": True,
            "minimumSymbolAlignedSessions": MIN_SYMBOL_ALIGNED_SESSIONS,
            "minimumAvailableSymbolsPerDay": MIN_AVAILABLE_SYMBOLS_PER_DAY,
            "dailyLossLimitPct": 2.0,
            "strictHurdles": v20.STRICT_HURDLES,
        },
        "splits": {
            key: {
                "sessions": len(value),
                "first": value[0] if value else None,
                "last": value[-1] if value else None,
            }
            for key, value in splits.items()
        },
        "candidateRows": rows,
        "winner": winner,
        "diagnosticLead": diagnostic_lead,
        "data": diagnostics,
        "selectionDiscipline": {
            "fiveSymbolThresholdsRetuned": False,
            "broadUniverseFixedBeforeResults": True,
            "candidateCount": len(CANDIDATES),
            "developmentAndValidationSelection": True,
            "julyHoldoutExcludedFromSelection": True,
            "holdoutRetuningAllowed": False,
            "productionPromotionAllowed": False,
        },
        "limitations": [
            "Yahoo 60-minute cash data are not historical Pyth ticks.",
            "Aster 30-minute candles cannot reconstruct spread, depth, queue or exact fills.",
            "Aster listings may not all share a complete one-year history; a fixed minimum data rule is applied.",
            "The broader universe is based on current known large-cap underlying symbols and is not a survivorship-free historical listing archive.",
            "Historical results do not guarantee future profit.",
        ],
        "safety": {
            "mode": "RESEARCH_ONLY",
            "orderSubmissionAllowed": False,
            "productionChanged": False,
            "liveChanged": False,
            "vpsChanged": False,
            "cryptoV96Changed": False,
            "v11EqChanged": False,
            "v13dProductionChanged": False,
        },
    })


def report(result: dict) -> str:
    lines = [
        "# Aster-only V21 Broad Universe Strict Tournament",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Eligible universe: {result.get('eligibleUniverseCount', 0)} symbols",
        f"Candidate architectures: {result.get('candidateCount', 0)}",
        "",
    ]
    diagnostic = result.get("diagnosticLead")
    if diagnostic:
        normal = diagnostic["full"]["NORMAL"]
        p95 = diagnostic["full"]["P95"]
        lines += [
            f"Closest diagnostic: `{diagnostic['candidate']['candidate_id']}`",
            f"- Normal: {normal['compoundedReturnPct']:.6f}% / PF {normal['profitFactor']} / {normal['trades']} trades / DD {normal['maxDrawdownPct']:.6f}%",
            f"- P95: {p95['compoundedReturnPct']:.6f}% / PF {p95['profitFactor']} / {p95['trades']} trades",
            "",
        ]
    lines.append("Research only. No Production, LIVE, VPS or order state was changed.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = analyze(Path(args.cache_dir).resolve())
    (output / "result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "eligibleUniverse": result.get("eligibleUniverse"),
        "winner": result.get("winner"),
        "diagnosticLead": result.get("diagnosticLead"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
