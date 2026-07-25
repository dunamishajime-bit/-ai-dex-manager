from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22
import research_lab_aster_only_v27_beta_squeeze_orb_tournament as v27

STRATEGY_ID = "DISDEX_ASTER_ONLY_V28_BETA_RESIDUAL_PAIR_TOURNAMENT"
SCENARIOS = v14.SCENARIOS
SYMBOLS = v14.SYMBOLS
HOLDOUT_START = v20.HOLDOUT_START_DAY
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
BASELINE_FALLBACK_NORMAL = 7.813259
BASELINE_FALLBACK_P95 = 7.400908
TP_PCT = 0.75
SL_PCT = 0.75


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold: float
    secondary: float
    slot: int
    maximum_holding_hours: int
    beta_lookback: int


CANDIDATES: Tuple[Candidate, ...] = tuple(
    [
        Candidate(
            f"RESIDUAL_PAIR_CONT__R{spread:g}__L{lag:g}__S{slot}__H{hours}__B{lookback}",
            "RESIDUAL_PAIR_CONT", spread, lag, slot, hours, lookback,
        )
        for spread in (40.0, 70.0, 100.0)
        for lag in (15.0, 30.0)
        for slot in (1, 2, 3)
        for hours in (1, 2)
        for lookback in (20, 40)
    ]
    + [
        Candidate(
            f"RESIDUAL_PAIR_REV__R{spread:g}__O{overfollow:g}__S{slot}__H{hours}__B{lookback}",
            "RESIDUAL_PAIR_REV", spread, overfollow, slot, hours, lookback,
        )
        for spread in (40.0, 70.0, 100.0)
        for overfollow in (15.0, 30.0)
        for slot in (1, 2, 3)
        for hours in (1, 2)
        for lookback in (20, 40)
    ]
    + [
        Candidate(
            f"CASH_MOM_PAIR_CONT__R{spread:g}__L{lag:g}__S{slot}__H{hours}",
            "CASH_MOM_PAIR_CONT", spread, lag, slot, hours, 20,
        )
        for spread in (60.0, 100.0, 140.0)
        for lag in (15.0, 30.0)
        for slot in (1, 2, 3)
        for hours in (1, 2)
    ]
    + [
        Candidate(
            f"ORB_DISPERSION_PAIR__R{spread:g}__V{volume:g}__S{slot}__H{hours}",
            "ORB_DISPERSION_PAIR", spread, volume, slot, hours, 20,
        )
        for spread in (20.0, 40.0, 60.0)
        for volume in (1.00, 1.25)
        for slot in (1, 2)
        for hours in (1, 2)
    ]
    + [
        Candidate(
            f"RESIDUAL_FUNDING_SQUEEZE_PAIR__R{spread:g}__F{funding:g}__S{slot}__H{hours}__B{lookback}",
            "RESIDUAL_FUNDING_SQUEEZE_PAIR", spread, funding, slot, hours, lookback,
        )
        for spread in (40.0, 70.0, 100.0)
        for funding in (0.40, 1.00)
        for slot in (1, 2, 3)
        for hours in (1, 2)
        for lookback in (20, 40)
    ]
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def rounded(value: Any):
    return v14.rounded(value)


def beta_state(day_rows: Dict[str, dict], symbol: str, slot: int, lookback: int) -> Optional[dict]:
    state = day_rows[symbol]["slots"][slot]
    beta = state["beta"].get(lookback, {"ready": False})
    return {**state, **beta} if beta.get("ready") else None


def signal(candidate: Candidate, day_rows: Dict[str, dict]) -> Optional[dict]:
    if candidate.family in {"RESIDUAL_PAIR_CONT", "RESIDUAL_PAIR_REV", "RESIDUAL_FUNDING_SQUEEZE_PAIR"}:
        states = {
            symbol: beta_state(day_rows, symbol, candidate.slot, candidate.beta_lookback)
            for symbol in SYMBOLS
        }
        states = {symbol: state for symbol, state in states.items() if state is not None}
        if len(states) < 4:
            return None
        ordered = sorted(states.items(), key=lambda item: finite(item[1]["residualBps"]))
        low_symbol, low = ordered[0]
        high_symbol, high = ordered[-1]
        cash_spread = finite(high["residualBps"]) - finite(low["residualBps"])
        perp_spread = finite(high["perpResidualBps"]) - finite(low["perpResidualBps"])
        lag_spread = cash_spread - perp_spread
        if cash_spread < candidate.threshold:
            return None

        if candidate.family == "RESIDUAL_PAIR_CONT":
            if lag_spread < candidate.secondary:
                return None
            long_symbol, short_symbol = high_symbol, low_symbol
            edge = max(0.0, lag_spread - 5.0)
            strength = cash_spread + lag_spread
        elif candidate.family == "RESIDUAL_PAIR_REV":
            overfollow = perp_spread - cash_spread
            if overfollow < candidate.secondary:
                return None
            long_symbol, short_symbol = low_symbol, high_symbol
            edge = max(0.0, overfollow - 5.0)
            strength = cash_spread + overfollow
        else:
            high_funding = high.get("fundingBps")
            low_funding = low.get("fundingBps")
            if high_funding is None or low_funding is None:
                return None
            funding_spread = finite(high_funding) - finite(low_funding)
            if finite(high_funding) >= 0 or finite(low_funding) <= 0:
                return None
            if abs(funding_spread) < candidate.secondary or lag_spread < 10.0:
                return None
            long_symbol, short_symbol = high_symbol, low_symbol
            edge = max(0.0, lag_spread + abs(funding_spread) * 3.0 - 5.0)
            strength = cash_spread + lag_spread + abs(funding_spread) * 10.0
        return {
            "longSymbol": long_symbol,
            "shortSymbol": short_symbol,
            "edgeProxyBps": edge,
            "strength": strength,
            "detail": {
                "cashResidualSpreadBps": cash_spread,
                "perpResidualSpreadBps": perp_spread,
                "lagSpreadBps": lag_spread,
                "highSymbol": high_symbol,
                "lowSymbol": low_symbol,
                "highFundingBps": high.get("fundingBps"),
                "lowFundingBps": low.get("fundingBps"),
            },
        }

    if candidate.family == "CASH_MOM_PAIR_CONT":
        states = {symbol: day_rows[symbol]["slots"][candidate.slot] for symbol in SYMBOLS}
        ordered = sorted(states.items(), key=lambda item: finite(item[1]["cashReturnBps"]))
        low_symbol, low = ordered[0]
        high_symbol, high = ordered[-1]
        cash_spread = finite(high["cashReturnBps"]) - finite(low["cashReturnBps"])
        perp_spread = finite(high["perpReturnBps"]) - finite(low["perpReturnBps"])
        lag_spread = cash_spread - perp_spread
        if cash_spread < candidate.threshold or lag_spread < candidate.secondary:
            return None
        return {
            "longSymbol": high_symbol,
            "shortSymbol": low_symbol,
            "edgeProxyBps": max(0.0, lag_spread - 5.0),
            "strength": cash_spread + lag_spread,
            "detail": {
                "cashSpreadBps": cash_spread,
                "perpSpreadBps": perp_spread,
                "lagSpreadBps": lag_spread,
            },
        }

    if candidate.family == "ORB_DISPERSION_PAIR":
        states = {
            symbol: day_rows[symbol]["slots"][candidate.slot]
            for symbol in SYMBOLS
            if day_rows[symbol]["slots"][candidate.slot].get("openingBreakoutBps") is not None
            and day_rows[symbol]["slots"][candidate.slot].get("volumeRatio") is not None
        }
        if len(states) < 4:
            return None
        ordered = sorted(states.items(), key=lambda item: finite(item[1]["openingBreakoutBps"]))
        low_symbol, low = ordered[0]
        high_symbol, high = ordered[-1]
        breakout_spread = finite(high["openingBreakoutBps"]) - finite(low["openingBreakoutBps"])
        if breakout_spread < candidate.threshold:
            return None
        if min(finite(high["volumeRatio"]), finite(low["volumeRatio"])) < candidate.secondary:
            return None
        cash_spread = finite(high["cashReturnBps"]) - finite(low["cashReturnBps"])
        perp_spread = finite(high["perpReturnBps"]) - finite(low["perpReturnBps"])
        lag_spread = cash_spread - perp_spread
        if lag_spread < 10.0:
            return None
        return {
            "longSymbol": high_symbol,
            "shortSymbol": low_symbol,
            "edgeProxyBps": max(0.0, lag_spread + max(0.0, min(finite(high["volumeRatio"]), finite(low["volumeRatio"])) - 1.0) * 10.0 - 5.0),
            "strength": breakout_spread + lag_spread,
            "detail": {
                "breakoutSpreadBps": breakout_spread,
                "lagSpreadBps": lag_spread,
                "highVolumeRatio": high["volumeRatio"],
                "lowVolumeRatio": low["volumeRatio"],
            },
        }

    raise ValueError(candidate.family)


def build_trade(candidate: Candidate, day: str, day_rows: Dict[str, dict]) -> Optional[dict]:
    selected = signal(candidate, day_rows)
    if selected is None:
        return None
    long_symbol = str(selected["longSymbol"])
    short_symbol = str(selected["shortSymbol"])
    long_row = day_rows[long_symbol]
    short_row = day_rows[short_symbol]
    long_points = long_row["points"]
    short_points = short_row["points"]
    entry_long = long_points[candidate.slot]
    entry_short = short_points[candidate.slot]
    last_index = min(
        len(long_points) - 1,
        len(short_points) - 1,
        candidate.slot + candidate.maximum_holding_hours,
    )
    chosen_index = last_index
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"
    for index in range(candidate.slot + 1, last_index + 1):
        long_return = 0.5 * (finite(long_points[index]["price"]) / finite(entry_long["price"]) - 1.0)
        short_return = 0.5 * -(finite(short_points[index]["price"]) / finite(entry_short["price"]) - 1.0)
        portfolio_return = long_return + short_return
        if portfolio_return >= TP_PCT / 100.0:
            chosen_index, exit_reason = index, "PAIR_TAKE_PROFIT"
            break
        if portfolio_return <= -SL_PCT / 100.0:
            chosen_index, exit_reason = index, "PAIR_STOP"
            break

    long_exit = long_points[chosen_index]
    short_exit = short_points[chosen_index]
    entry_ts = max(int(entry_long["ts"]), int(entry_short["ts"]))
    exit_ts = min(int(long_exit["ts"]), int(short_exit["ts"]))
    long_price_return = 0.5 * (finite(long_exit["price"]) / finite(entry_long["price"]) - 1.0)
    short_price_return = 0.5 * -(finite(short_exit["price"]) / finite(entry_short["price"]) - 1.0)
    price_return = long_price_return + short_price_return
    long_funding = -0.5 * v14.funding_mod.funding_between(long_row["fundingPoints"], entry_ts, exit_ts)
    short_funding = 0.5 * v14.funding_mod.funding_between(short_row["fundingPoints"], entry_ts, exit_ts)
    funding_return = long_funding + short_funding
    return {
        "strategy": "V28_BETA_RESIDUAL_PAIR_FALLBACK",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": f"L:{long_symbol}|S:{short_symbol}",
        "longSymbol": long_symbol,
        "shortSymbol": short_symbol,
        "side": 0,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "grossReturn": price_return + funding_return,
        "priceReturn": price_return,
        "fundingReturn": funding_return,
        "edgeProxyBps": finite(selected["edgeProxyBps"]),
        "exitReason": exit_reason,
        "signalDetail": selected["detail"],
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    return [trade for day in days if (trade := build_trade(candidate, day, features[day])) is not None]


def fallback_only_metrics(rows: Sequence[dict], days: Sequence[str]) -> dict:
    allowed = set(days)
    selected = [row for row in rows if str(row["day"]) in allowed]
    return {name: v14.metrics(selected, cost) for name, cost in SCENARIOS.items()}


def development_pass(audit: dict, fallback: dict) -> bool:
    own = fallback["development"]
    return (
        own["NORMAL"]["trades"] >= 12
        and own["NORMAL"]["compoundedReturnPct"] > 0
        and own["P95"]["compoundedReturnPct"] > 0
        and (own["NORMAL"]["profitFactor"] or 0.0) >= 1.2
    )


def validation_pass(audit: dict, fallback: dict) -> bool:
    routed = audit["validation"]
    own = fallback["validation"]
    return (
        routed["NORMAL"]["trades"] >= 8
        and routed["NORMAL"]["compoundedReturnPct"] > 0
        and routed["P95"]["compoundedReturnPct"] > 0
        and (routed["NORMAL"]["profitFactor"] or 0.0) >= 1.2
        and own["NORMAL"]["trades"] >= 4
        and own["NORMAL"]["compoundedReturnPct"] > 0
        and own["P95"]["compoundedReturnPct"] > 0
    )


def selection_score(audit: dict, fallback: dict) -> float:
    routed = audit["validation"]["NORMAL"]
    own = fallback["validation"]["NORMAL"]
    return (
        routed["compoundedReturnPct"]
        + audit["validation"]["P95"]["compoundedReturnPct"]
        + own["compoundedReturnPct"]
        + 0.25 * own["trades"]
        - 0.5 * abs(routed["maxDrawdownPct"])
    )


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()
    days, aligned, diagnostics = v19.v17.load_all(cache_root / "stock")
    yahoo, yahoo_diagnostics = v27.load_yahoo_context(cache_root / "yahoo")
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < HOLDOUT_START]
    holdout = [day for day in target if day >= HOLDOUT_START]
    splits = v14.split_days(pre_holdout)
    features = v27.build_features(warmup, aligned, yahoo)
    v11_rows, v11_diag = v22.build_v11eq(warmup, aligned)
    baseline_rows = v22.build_fallback(warmup, aligned)
    baseline_args = (v11_rows, baseline_rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
    baseline = v22.audit(*baseline_args, True)

    development_survivors = []
    for candidate in CANDIDATES:
        rows = build_trades(candidate, warmup, features)
        audit = v22.audit(v11_rows, rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True)
        fallback = {
            "development": fallback_only_metrics(rows, splits["DEVELOPMENT"]),
            "validation": fallback_only_metrics(rows, splits["VALIDATION"]),
            "finalReused": fallback_only_metrics(rows, splits["FINAL_REUSED"]),
            "holdout": fallback_only_metrics(rows, holdout),
            "full": fallback_only_metrics(rows, target),
        }
        if development_pass(audit, fallback):
            development_survivors.append((candidate, rows, audit, fallback))
    development_survivors.sort(key=lambda item: selection_score(item[2], item[3]), reverse=True)
    validation_survivors = [item for item in development_survivors[:60] if validation_pass(item[2], item[3])]
    validation_survivors.sort(key=lambda item: selection_score(item[2], item[3]), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None

    winner_payload = None
    status = "ASTER_ONLY_V28_NO_VALIDATED_BETA_RESIDUAL_PAIR"
    if winner is not None:
        candidate, rows, audit, fallback = winner
        full = audit["full"]
        improvement_checks = {
            "normalAboveV22": full["NORMAL"]["compoundedReturnPct"] > BASELINE_NORMAL,
            "p95AboveV22": full["P95"]["compoundedReturnPct"] > BASELINE_P95,
            "fallbackNormalAboveV19": fallback["full"]["NORMAL"]["compoundedReturnPct"] > BASELINE_FALLBACK_NORMAL,
            "fallbackP95AboveV19": fallback["full"]["P95"]["compoundedReturnPct"] > BASELINE_FALLBACK_P95,
            "finalNormalAndP95Positive": audit["finalReused"]["NORMAL"]["compoundedReturnPct"] > 0 and audit["finalReused"]["P95"]["compoundedReturnPct"] > 0,
            "holdoutNormalAndP95Positive": audit["holdout"]["NORMAL"]["compoundedReturnPct"] > 0 and audit["holdout"]["P95"]["compoundedReturnPct"] > 0,
            "allV22StrictChecks": all(audit["checks"].values()),
        }
        accepted = all(improvement_checks.values())
        status = "ASTER_ONLY_V28_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V28_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "routerAudit": audit,
            "fallbackOnly": fallback,
            "improvementChecks": improvement_checks,
            "accepted": accepted,
        }

    return rounded({
        "version": 28,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "baseline": baseline,
        "winner": winner_payload,
        "topValidationDiagnostics": [
            {
                "candidate": asdict(candidate),
                "development": audit["development"],
                "validation": audit["validation"],
                "fallbackValidation": fallback["validation"],
                "fallbackFull": fallback["full"],
                "finalReused": audit["finalReused"],
                "holdout": audit["holdout"],
            }
            for candidate, _rows, audit, fallback in development_survivors[:12]
        ],
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "sessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "selectionDiscipline": {
            "developmentSelectsTopSixty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "sameHistoryIsReusedAndNotIndependent": True,
            "productionPromotionAllowed": False,
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "maximumConcurrentGross": 1.0,
            "longWeight": 0.5,
            "shortWeight": 0.5,
            "hyperliquidUsed": False,
        },
        "data": {"stock": diagnostics, "yahooContext": yahoo_diagnostics},
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
        "# Aster-only V28 QQQ Beta-Residual Pair Tournament",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidates: {result['candidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        "",
    ]
    if result["winner"]:
        winner = result["winner"]
        lines += [
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Router Normal: {winner['routerAudit']['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Router P95: {winner['routerAudit']['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Fallback Normal: {winner['fallbackOnly']['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Fallback P95: {winner['fallbackOnly']['full']['P95']['compoundedReturnPct']:.6f}%",
            "",
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
        "candidateCount": result["candidateCount"],
        "developmentSurvivors": result["developmentSurvivors"],
        "validationSurvivors": result["validationSurvivors"],
        "winner": result["winner"],
        "topValidationDiagnostics": result["topValidationDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
