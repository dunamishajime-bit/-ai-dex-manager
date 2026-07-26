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
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22
import research_lab_aster_only_v26_nonbasis_fallback_tournament as v26

STRATEGY_ID = "DISDEX_ASTER_ONLY_V27_BETA_SQUEEZE_ORB_TOURNAMENT"
SCENARIOS = v14.SCENARIOS
SYMBOLS = v14.SYMBOLS
HOLDOUT_START = v20.HOLDOUT_START_DAY
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
BASELINE_FALLBACK_NORMAL = 7.813259
BASELINE_FALLBACK_P95 = 7.400908
TP_PCT = 0.85
SL_PCT = 0.75
BETA_LOOKBACKS = (20, 40)
QQQ_TICKER = "QQQ"


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold: float
    secondary: float
    lag_threshold: float
    slot: int
    maximum_holding_hours: int
    beta_lookback: int


CANDIDATES: Tuple[Candidate, ...] = tuple(
    [
        Candidate(
            f"BETA_RESIDUAL_CONT__Z{z:g}__R{residual:g}__L{lag:g}__S{slot}__H{hours}__B{lookback}",
            "BETA_RESIDUAL_CONT", z, residual, lag, slot, hours, lookback,
        )
        for z in (1.0, 1.5, 2.0)
        for residual in (30.0, 50.0)
        for lag in (15.0, 30.0)
        for slot in (1, 2, 3)
        for hours in (1, 2)
        for lookback in BETA_LOOKBACKS
    ]
    + [
        Candidate(
            f"BETA_FUNDING_SQUEEZE__Z{z:g}__F{funding:g}__L{lag:g}__S{slot}__H{hours}__B{lookback}",
            "BETA_FUNDING_SQUEEZE", z, funding, lag, slot, hours, lookback,
        )
        for z in (1.0, 1.5)
        for funding in (0.20, 0.50)
        for lag in (15.0, 30.0)
        for slot in (1, 2, 3)
        for hours in (1, 2)
        for lookback in BETA_LOOKBACKS
    ]
    + [
        Candidate(
            f"FUNDING_SQUEEZE_CONT__F{funding:g}__C{cash:g}__L{lag:g}__S{slot}__H{hours}",
            "FUNDING_SQUEEZE_CONT", funding, cash, lag, slot, hours, 20,
        )
        for funding in (0.20, 0.50, 1.00)
        for cash in (40.0, 70.0, 100.0)
        for lag in (15.0, 30.0)
        for slot in (1, 2, 3)
        for hours in (1, 2)
    ]
    + [
        Candidate(
            f"OPENING_RANGE_VOLUME__B{breakout:g}__V{volume:g}__L{lag:g}__S{slot}__H{hours}",
            "OPENING_RANGE_VOLUME", breakout, volume, lag, slot, hours, 20,
        )
        for breakout in (10.0, 25.0, 40.0)
        for volume in (1.00, 1.25, 1.50)
        for lag in (15.0, 30.0)
        for slot in (1, 2)
        for hours in (1, 2)
    ]
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def rounded(value: Any):
    return v14.rounded(value)


def covariance_beta(pairs: Sequence[Tuple[float, float]]) -> Optional[float]:
    if len(pairs) < 8:
        return None
    stock = [item[0] for item in pairs]
    market = [item[1] for item in pairs]
    market_mean = statistics.mean(market)
    variance = sum((value - market_mean) ** 2 for value in market)
    if variance <= 1e-9:
        return None
    stock_mean = statistics.mean(stock)
    covariance = sum((s - stock_mean) * (m - market_mean) for s, m in pairs)
    return covariance / variance


def parse_yahoo_intraday(payload: dict) -> Tuple[Dict[str, dict], dict]:
    chart = payload.get("chart") if isinstance(payload, dict) else None
    results = chart.get("result") if isinstance(chart, dict) else None
    if not isinstance(results, list) or not results:
        return {}, {"bars": 0, "completeDays": 0, "error": chart.get("error") if isinstance(chart, dict) else None}
    root = results[0]
    timestamps = root.get("timestamp") or []
    quote = ((root.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    by_day: Dict[str, dict] = defaultdict(dict)
    valid = 0
    for index, raw_ts in enumerate(timestamps):
        if index >= min(len(opens), len(highs), len(lows), len(closes), len(volumes)):
            continue
        open_price = finite(opens[index], math.nan)
        high_price = finite(highs[index], math.nan)
        low_price = finite(lows[index], math.nan)
        close_price = finite(closes[index], math.nan)
        volume = finite(volumes[index], math.nan)
        if not all(math.isfinite(value) for value in (open_price, high_price, low_price, close_price, volume)):
            continue
        if min(open_price, high_price, low_price, close_price) <= 0 or volume < 0:
            continue
        ts_ms = int(raw_ts) * 1000
        day, minute, weekday = v14.v11.local_parts(ts_ms)
        if weekday >= 5 or minute not in {570, 630, 690, 750}:
            continue
        by_day[day][minute] = {
            "ts": ts_ms, "open": open_price, "high": high_price,
            "low": low_price, "close": close_price, "volume": volume,
        }
        valid += 1
    completed: Dict[str, dict] = {}
    for day, slots in by_day.items():
        if not all(minute in slots for minute in (570, 630, 690, 750)):
            continue
        base = slots[630]["open"]
        completed[day] = {
            "base": base,
            "points": [base, slots[630]["close"], slots[690]["close"], slots[750]["close"]],
            "cumulativeVolume": [
                0.0,
                slots[630]["volume"],
                slots[630]["volume"] + slots[690]["volume"],
                slots[630]["volume"] + slots[690]["volume"] + slots[750]["volume"],
            ],
            "openingHigh": slots[570]["high"],
            "openingLow": slots[570]["low"],
        }
    return completed, {
        "bars": valid,
        "completeDays": len(completed),
        "firstDay": min(completed) if completed else None,
        "lastDay": max(completed) if completed else None,
    }


def load_yahoo_context(cache_dir: Path) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    tickers = {**v14.v11.v10.SYMBOL_MAP, "QQQ": QQQ_TICKER}
    data: Dict[str, Dict[str, dict]] = {}
    diagnostics = {"source": "Yahoo Finance public 60m chart response", "symbols": {}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {
            pool.submit(v14.v11.v10.fetch_yahoo_chart, ticker, cache_dir): (symbol, ticker)
            for symbol, ticker in tickers.items()
        }
        for future in concurrent.futures.as_completed(futures):
            symbol, ticker = futures[future]
            rows, detail = parse_yahoo_intraday(future.result())
            data[symbol] = rows
            diagnostics["symbols"][symbol] = {"ticker": ticker, **detail}
            print(f"loaded V27 Yahoo context {ticker}: {len(rows)} complete days")
    return data, diagnostics


def build_features(days: Sequence[str], aligned: Dict[str, Dict[str, dict]], yahoo: Dict[str, Dict[str, dict]]) -> Dict[str, dict]:
    base_features = v26.build_features(days, aligned)
    pair_history: Dict[str, Dict[int, List[Tuple[float, float]]]] = {
        symbol: {slot: [] for slot in (1, 2, 3)} for symbol in SYMBOLS
    }
    volume_history: Dict[str, Dict[int, List[float]]] = {
        symbol: {slot: [] for slot in (1, 2, 3)} for symbol in SYMBOLS
    }
    result: Dict[str, dict] = {}
    for day in days:
        qqq = yahoo.get("QQQ", {}).get(day)
        rows: Dict[str, dict] = {}
        for symbol in SYMBOLS:
            base_row = base_features[day][symbol]
            market = yahoo.get(symbol, {}).get(day)
            slot_rows: Dict[int, dict] = {}
            for slot in (1, 2, 3):
                state = v26.slot_state(base_row, slot)
                qqq_return = None
                volume_ratio = None
                breakout_bps = None
                if qqq and market:
                    qqq_return = (finite(qqq["points"][slot]) / finite(qqq["base"]) - 1.0) * 10_000.0
                    current_cash = finite(market["points"][slot])
                    cumulative = finite(market["cumulativeVolume"][slot])
                    prior_volumes = volume_history[symbol][slot][-20:]
                    if len(prior_volumes) >= 20:
                        median_volume = statistics.median(prior_volumes)
                        volume_ratio = cumulative / median_volume if median_volume > 0 else None
                    if current_cash > finite(market["openingHigh"]):
                        breakout_bps = (current_cash / finite(market["openingHigh"]) - 1.0) * 10_000.0
                    elif current_cash < finite(market["openingLow"]):
                        breakout_bps = (current_cash / finite(market["openingLow"]) - 1.0) * 10_000.0
                    else:
                        breakout_bps = 0.0
                    volume_history[symbol][slot].append(cumulative)

                beta_payload: Dict[int, dict] = {}
                if qqq_return is not None:
                    stock_return = finite(state["cashReturnBps"])
                    for lookback in BETA_LOOKBACKS:
                        prior_pairs = pair_history[symbol][slot][-lookback:]
                        beta = covariance_beta(prior_pairs)
                        if beta is None or len(prior_pairs) < lookback:
                            beta_payload[lookback] = {"ready": False}
                            continue
                        residual = stock_return - beta * qqq_return
                        prior_residuals = [stock - beta * market_ret for stock, market_ret in prior_pairs]
                        sigma = statistics.pstdev(prior_residuals) if len(prior_residuals) >= lookback else 0.0
                        perp_residual = finite(state["perpReturnBps"]) - beta * qqq_return
                        beta_payload[lookback] = {
                            "ready": sigma > 1e-9,
                            "beta": beta,
                            "residualBps": residual,
                            "residualZ": residual / sigma if sigma > 1e-9 else 0.0,
                            "perpResidualBps": perp_residual,
                            "followRatio": abs(perp_residual) / abs(residual) if abs(residual) > 1e-9 else 999.0,
                        }
                    pair_history[symbol][slot].append((stock_return, qqq_return))

                point = base_row["points"][slot]
                funding_bps = v14.latest_funding_bps(base_row["fundingPoints"], int(point["ts"]))
                slot_rows[slot] = {
                    **state,
                    "qqqReturnBps": qqq_return,
                    "volumeRatio": volume_ratio,
                    "openingBreakoutBps": breakout_bps,
                    "beta": beta_payload,
                    "fundingBps": funding_bps,
                }
            rows[symbol] = {**base_row, "slots": slot_rows}
        result[day] = rows
    return result


def signal(candidate: Candidate, day_rows: Dict[str, dict]) -> Optional[Tuple[str, int, float, dict]]:
    eligible: List[Tuple[float, str, int, float, dict]] = []
    for symbol in SYMBOLS:
        row = day_rows[symbol]
        state = row["slots"][candidate.slot]
        cash_return = finite(state["cashReturnBps"])
        lag = finite(state["leadBps"])
        funding = state.get("fundingBps")

        if candidate.family == "BETA_RESIDUAL_CONT":
            beta_state = state["beta"].get(candidate.beta_lookback, {"ready": False})
            if not beta_state.get("ready"):
                continue
            residual = finite(beta_state["residualBps"])
            zscore = finite(beta_state["residualZ"])
            follow = finite(beta_state["followRatio"], 999.0)
            if (
                abs(zscore) < candidate.threshold
                or abs(residual) < candidate.secondary
                or residual * lag <= 0
                or abs(lag) < candidate.lag_threshold
                or follow > 0.70
            ):
                continue
            side = 1 if residual > 0 else -1
            edge = max(0.0, min(abs(residual), abs(lag)) - 5.0)
            detail = {**state, **beta_state, "family": candidate.family}
            eligible.append((abs(zscore) * 100.0 + abs(residual) + abs(lag), symbol, side, edge, detail))

        elif candidate.family == "BETA_FUNDING_SQUEEZE":
            beta_state = state["beta"].get(candidate.beta_lookback, {"ready": False})
            if not beta_state.get("ready") or funding is None:
                continue
            residual = finite(beta_state["residualBps"])
            zscore = finite(beta_state["residualZ"])
            if (
                abs(zscore) < candidate.threshold
                or abs(residual) < 30.0
                or abs(finite(funding)) < candidate.secondary
                or residual * finite(funding) >= 0
                or residual * lag <= 0
                or abs(lag) < candidate.lag_threshold
            ):
                continue
            side = 1 if residual > 0 else -1
            edge = max(0.0, min(abs(residual), abs(lag)) + abs(finite(funding)) * 3.0 - 5.0)
            detail = {**state, **beta_state, "family": candidate.family}
            eligible.append((abs(zscore) * 100.0 + abs(residual) + abs(finite(funding)) * 10.0, symbol, side, edge, detail))

        elif candidate.family == "FUNDING_SQUEEZE_CONT":
            if funding is None:
                continue
            if (
                abs(finite(funding)) < candidate.threshold
                or abs(cash_return) < candidate.secondary
                or cash_return * finite(funding) >= 0
                or cash_return * lag <= 0
                or abs(lag) < candidate.lag_threshold
            ):
                continue
            side = 1 if cash_return > 0 else -1
            edge = max(0.0, min(abs(cash_return), abs(lag)) + abs(finite(funding)) * 3.0 - 5.0)
            detail = {**state, "family": candidate.family}
            eligible.append((abs(cash_return) + abs(lag) + abs(finite(funding)) * 10.0, symbol, side, edge, detail))

        elif candidate.family == "OPENING_RANGE_VOLUME":
            breakout = state.get("openingBreakoutBps")
            volume_ratio = state.get("volumeRatio")
            if breakout is None or volume_ratio is None:
                continue
            if (
                abs(finite(breakout)) < candidate.threshold
                or finite(volume_ratio) < candidate.secondary
                or finite(breakout) * lag <= 0
                or abs(lag) < candidate.lag_threshold
            ):
                continue
            side = 1 if finite(breakout) > 0 else -1
            edge = max(0.0, min(abs(finite(breakout)), abs(lag)) + max(0.0, finite(volume_ratio) - 1.0) * 15.0 - 5.0)
            detail = {**state, "family": candidate.family}
            eligible.append((abs(finite(breakout)) + abs(lag) + finite(volume_ratio) * 20.0, symbol, side, edge, detail))

        else:
            raise ValueError(candidate.family)

    if not eligible:
        return None
    _strength, symbol, side, edge, detail = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, side, edge, detail


def build_trade(candidate: Candidate, day: str, day_rows: Dict[str, dict]) -> Optional[dict]:
    selected = signal(candidate, day_rows)
    if selected is None:
        return None
    symbol, side, edge_proxy, detail = selected
    row = day_rows[symbol]
    points = row["points"]
    entry = points[candidate.slot]
    last_index = min(len(points) - 1, candidate.slot + candidate.maximum_holding_hours)
    chosen = points[last_index]
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"
    for point in points[candidate.slot + 1:last_index + 1]:
        price_return = side * (finite(point["price"]) / finite(entry["price"]) - 1.0)
        if price_return >= TP_PCT / 100.0:
            chosen, exit_reason = point, "PRICE_TAKE_PROFIT"
            break
        if price_return <= -SL_PCT / 100.0:
            chosen, exit_reason = point, "PRICE_STOP"
            break
    entry_ts, exit_ts = int(entry["ts"]), int(chosen["ts"])
    gross_return = side * (finite(chosen["price"]) / finite(entry["price"]) - 1.0)
    gross_return += (-side) * v14.funding_mod.funding_between(row["fundingPoints"], entry_ts, exit_ts)
    return {
        "strategy": "V27_BETA_SQUEEZE_ORB_FALLBACK",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "grossReturn": gross_return,
        "edgeProxyBps": edge_proxy,
        "exitReason": exit_reason,
        "signalDetail": detail,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict]) -> List[dict]:
    return [trade for day in days if (trade := build_trade(candidate, day, features[day])) is not None]


def fallback_only_metrics(rows: Sequence[dict], days: Sequence[str]) -> dict:
    allowed = set(days)
    selected = [row for row in rows if str(row["day"]) in allowed]
    return {name: v14.metrics(selected, cost) for name, cost in SCENARIOS.items()}


def development_pass(audit: dict, fallback: dict) -> bool:
    routed = audit["development"]
    own = fallback["development"]
    return (
        routed["NORMAL"]["compoundedReturnPct"] > 0
        and routed["P95"]["compoundedReturnPct"] > 0
        and own["NORMAL"]["trades"] >= 8
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
    yahoo, yahoo_diagnostics = load_yahoo_context(cache_root / "yahoo")
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < HOLDOUT_START]
    holdout = [day for day in target if day >= HOLDOUT_START]
    splits = v14.split_days(pre_holdout)
    features = build_features(warmup, aligned, yahoo)
    v11_rows, v11_diag = v22.build_v11eq(warmup, aligned)
    baseline_rows = v22.build_fallback(warmup, aligned)
    args = (v11_rows, baseline_rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
    baseline = v22.audit(*args, True)

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
    validation_survivors = [
        item for item in development_survivors[:60]
        if validation_pass(item[2], item[3])
    ]
    validation_survivors.sort(key=lambda item: selection_score(item[2], item[3]), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None

    winner_payload = None
    status = "ASTER_ONLY_V27_NO_VALIDATED_BETA_SQUEEZE_ORB_FALLBACK"
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
        status = "ASTER_ONLY_V27_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V27_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {
            "candidate": asdict(candidate),
            "routerAudit": audit,
            "fallbackOnly": fallback,
            "improvementChecks": improvement_checks,
            "accepted": accepted,
        }

    top_validation = [
        {
            "candidate": asdict(candidate),
            "development": audit["development"],
            "validation": audit["validation"],
            "fallbackValidation": fallback["validation"],
        }
        for candidate, _rows, audit, fallback in development_survivors[:12]
    ]
    return rounded({
        "version": 27,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "baseline": baseline,
        "winner": winner_payload,
        "topValidationDiagnostics": top_validation,
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
        "# Aster-only V27 Beta / Squeeze / Opening-Range Tournament",
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
