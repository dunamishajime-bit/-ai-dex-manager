from __future__ import annotations

import argparse
import json
import math
import statistics
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22
import research_lab_aster_only_v27_beta_squeeze_orb_tournament as v27

STRATEGY_ID = "DISDEX_ASTER_ONLY_V30_SEC_FILING_EVENT_DRIFT_TOURNAMENT"
SCENARIOS = v14.SCENARIOS
SYMBOLS = v14.SYMBOLS
HOLDOUT_START = v20.HOLDOUT_START_DAY
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
DAILY_LOSS_LOCK = -0.02
SEC_USER_AGENT = "DisDex-Research/1.0 github.com/dunamishajime-bit/-ai-dex-manager"
TP_PCT = 1.00
SL_PCT = 0.75
CIK_MAP = {
    "AMZNUSDT": "0001018724",
    "METAUSDT": "0001326801",
    "MSFTUSDT": "0000789019",
    "NVDAUSDT": "0001045810",
    "TSLAUSDT": "0001318605",
}


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    threshold: float
    secondary: float
    lag_threshold: float
    slot: int
    maximum_holding_hours: int
    maximum_event_age: int
    form_policy: str


CANDIDATES: Tuple[Candidate, ...] = tuple(
    [
        Candidate(
            f"SEC_REACTION_CONT__C{cash:g}__G{gap:g}__L{lag:g}__S{slot}__H{hours}__A{age}__{forms}",
            "SEC_REACTION_CONT", cash, gap, lag, slot, hours, age, forms,
        )
        for cash in (20.0, 40.0, 70.0)
        for gap in (20.0, 50.0)
        for lag in (10.0, 20.0)
        for slot in (1, 2)
        for hours in (1, 2)
        for age in (0, 1)
        for forms in ("QUARTERLY", "RESULTS")
    ]
    + [
        Candidate(
            f"SEC_REACTION_REV__C{cash:g}__G{gap:g}__L{lag:g}__S{slot}__H{hours}__A{age}__{forms}",
            "SEC_REACTION_REV", cash, gap, lag, slot, hours, age, forms,
        )
        for cash in (20.0, 40.0, 70.0)
        for gap in (20.0, 50.0)
        for lag in (10.0, 20.0)
        for slot in (1, 2)
        for hours in (1, 2)
        for age in (0, 1)
        for forms in ("QUARTERLY", "RESULTS")
    ]
    + [
        Candidate(
            f"SEC_BETA_RESIDUAL_CONT__Z{z:g}__R{residual:g}__L{lag:g}__S{slot}__H{hours}__A{age}__{forms}",
            "SEC_BETA_RESIDUAL_CONT", z, residual, lag, slot, hours, age, forms,
        )
        for z in (0.75, 1.25)
        for residual in (20.0, 40.0)
        for lag in (10.0, 20.0)
        for slot in (1, 2)
        for hours in (1, 2)
        for age in (0, 1)
        for forms in ("QUARTERLY", "RESULTS")
    ]
    + [
        Candidate(
            f"SEC_ORB_CONT__B{breakout:g}__V{volume:g}__L{lag:g}__S{slot}__H{hours}__A{age}__{forms}",
            "SEC_ORB_CONT", breakout, volume, lag, slot, hours, age, forms,
        )
        for breakout in (10.0, 25.0)
        for volume in (1.00, 1.25)
        for lag in (10.0, 20.0)
        for slot in (1, 2)
        for hours in (1, 2)
        for age in (0, 1)
        for forms in ("QUARTERLY", "RESULTS")
    ]
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def rounded(value: Any):
    return v14.rounded(value)


def fetch_sec_submissions(symbol: str, cik: str, cache_dir: Path) -> dict:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{symbol}-{cik}-submissions.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and payload.get("filings"):
            return payload
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    errors = []
    for attempt in range(5):
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": SEC_USER_AGENT,
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate",
            })
            with urllib.request.urlopen(request, timeout=40) as response:
                raw = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    import gzip
                    raw = gzip.decompress(raw)
                payload = json.loads(raw.decode("utf-8"))
            path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
            time.sleep(0.15)
            return payload
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            errors.append(f"{type(exc).__name__}:{exc}")
            time.sleep(min(8.0, 0.8 * (2 ** attempt)))
    raise RuntimeError(f"SEC submissions fetch failed for {symbol}: {'; '.join(errors[-5:])}")


def extract_sec_filings(payload: dict) -> List[dict]:
    recent = ((payload.get("filings") or {}).get("recent") or {})
    columns = {key: value for key, value in recent.items() if isinstance(value, list)}
    count = max((len(value) for value in columns.values()), default=0)
    rows = []
    for index in range(count):
        form = str(columns.get("form", [""] * count)[index]) if index < len(columns.get("form", [])) else ""
        filing_date = str(columns.get("filingDate", [""] * count)[index]) if index < len(columns.get("filingDate", [])) else ""
        items = str(columns.get("items", [""] * count)[index]) if index < len(columns.get("items", [])) else ""
        accession = str(columns.get("accessionNumber", [""] * count)[index]) if index < len(columns.get("accessionNumber", [])) else ""
        accepted = str(columns.get("acceptanceDateTime", [""] * count)[index]) if index < len(columns.get("acceptanceDateTime", [])) else ""
        if not filing_date:
            continue
        quarterly = form in {"10-Q", "10-K"}
        results = quarterly or (form == "8-K" and "2.02" in items)
        if results:
            rows.append({
                "filingDate": filing_date,
                "acceptanceDateTime": accepted,
                "form": form,
                "items": items,
                "accessionNumber": accession,
                "quarterly": quarterly,
                "results": results,
            })
    dedup: Dict[str, dict] = {}
    for row in rows:
        key = row["filingDate"]
        if key not in dedup:
            dedup[key] = dict(row)
        else:
            dedup[key]["quarterly"] = bool(dedup[key]["quarterly"] or row["quarterly"])
            dedup[key]["results"] = bool(dedup[key]["results"] or row["results"])
    return [dedup[key] for key in sorted(dedup)]


def load_sec_events(cache_dir: Path, trading_days: Sequence[str]) -> Tuple[Dict[str, Dict[str, dict]], dict]:
    result: Dict[str, Dict[str, dict]] = {symbol: {} for symbol in SYMBOLS}
    diagnostics = {"source": "SEC data.sec.gov submissions API", "symbols": {}}
    sorted_days = sorted(trading_days)
    for symbol, cik in CIK_MAP.items():
        payload = fetch_sec_submissions(symbol, cik, cache_dir)
        filings = extract_sec_filings(payload)
        mapped = 0
        for filing in filings:
            future_days = [day for day in sorted_days if day > filing["filingDate"]]
            for age, day in enumerate(future_days[:2]):
                event = {**filing, "eventAge": age, "eventSession": day}
                current = result[symbol].get(day)
                if current is None or (event["quarterly"] and not current["quarterly"]):
                    result[symbol][day] = event
                mapped += 1
        diagnostics["symbols"][symbol] = {
            "cik": cik,
            "eligibleFilings": len(filings),
            "mappedSessionRows": mapped,
            "firstFiling": filings[0]["filingDate"] if filings else None,
            "lastFiling": filings[-1]["filingDate"] if filings else None,
        }
    return result, diagnostics


def event_allowed(candidate: Candidate, event: Optional[dict]) -> bool:
    if event is None or int(event.get("eventAge", 99)) > candidate.maximum_event_age:
        return False
    return bool(event.get("quarterly")) if candidate.form_policy == "QUARTERLY" else bool(event.get("results"))


def signal(candidate: Candidate, day: str, day_rows: Dict[str, dict], events: Dict[str, Dict[str, dict]]) -> Optional[dict]:
    eligible: List[Tuple[float, str, int, float, dict]] = []
    for symbol in SYMBOLS:
        event = events.get(symbol, {}).get(day)
        if not event_allowed(candidate, event):
            continue
        state = day_rows[symbol]["slots"][candidate.slot]
        cash_return = finite(state["cashReturnBps"])
        gap = state.get("gapBps")
        lag = finite(state["leadBps"])

        if candidate.family in {"SEC_REACTION_CONT", "SEC_REACTION_REV"}:
            if gap is None or abs(cash_return) < candidate.threshold or abs(finite(gap)) < candidate.secondary:
                continue
            same = cash_return * finite(gap) > 0
            if candidate.family == "SEC_REACTION_CONT" and not same:
                continue
            if candidate.family == "SEC_REACTION_REV" and same:
                continue
            if cash_return * lag <= 0 or abs(lag) < candidate.lag_threshold:
                continue
            side = 1 if cash_return > 0 else -1
            edge = max(0.0, min(abs(cash_return), abs(lag)) + min(abs(finite(gap)), 100.0) * 0.15 - 5.0)
            strength = abs(cash_return) + abs(lag) + abs(finite(gap)) * 0.25
        elif candidate.family == "SEC_BETA_RESIDUAL_CONT":
            beta = state["beta"].get(20, {"ready": False})
            if not beta.get("ready"):
                continue
            residual = finite(beta["residualBps"])
            zscore = finite(beta["residualZ"])
            if abs(zscore) < candidate.threshold or abs(residual) < candidate.secondary:
                continue
            if residual * lag <= 0 or abs(lag) < candidate.lag_threshold:
                continue
            side = 1 if residual > 0 else -1
            edge = max(0.0, min(abs(residual), abs(lag)) - 5.0)
            strength = abs(zscore) * 100.0 + abs(residual) + abs(lag)
        elif candidate.family == "SEC_ORB_CONT":
            breakout = state.get("openingBreakoutBps")
            volume = state.get("volumeRatio")
            if breakout is None or volume is None:
                continue
            if abs(finite(breakout)) < candidate.threshold or finite(volume) < candidate.secondary:
                continue
            if finite(breakout) * lag <= 0 or abs(lag) < candidate.lag_threshold:
                continue
            side = 1 if finite(breakout) > 0 else -1
            edge = max(0.0, min(abs(finite(breakout)), abs(lag)) + max(0.0, finite(volume) - 1.0) * 15.0 - 5.0)
            strength = abs(finite(breakout)) + abs(lag) + finite(volume) * 20.0
        else:
            raise ValueError(candidate.family)
        eligible.append((strength, symbol, side, edge, {**state, "event": event}))
    if not eligible:
        return None
    _strength, symbol, side, edge, detail = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return {"symbol": symbol, "side": side, "edgeProxyBps": edge, "detail": detail}


def build_trade(candidate: Candidate, day: str, day_rows: Dict[str, dict], events: Dict[str, Dict[str, dict]]) -> Optional[dict]:
    selected = signal(candidate, day, day_rows, events)
    if selected is None:
        return None
    symbol = str(selected["symbol"])
    side = int(selected["side"])
    row = day_rows[symbol]
    points = row["points"]
    entry = points[candidate.slot]
    last_index = min(len(points) - 1, candidate.slot + candidate.maximum_holding_hours)
    chosen = points[last_index]
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"
    for point in points[candidate.slot + 1:last_index + 1]:
        price_return = side * (finite(point["price"]) / finite(entry["price"]) - 1.0)
        if price_return >= TP_PCT / 100.0:
            chosen, exit_reason = point, "EVENT_TAKE_PROFIT"
            break
        if price_return <= -SL_PCT / 100.0:
            chosen, exit_reason = point, "EVENT_STOP"
            break
    entry_ts, exit_ts = int(entry["ts"]), int(chosen["ts"])
    price_return = side * (finite(chosen["price"]) / finite(entry["price"]) - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(row["fundingPoints"], entry_ts, exit_ts)
    return {
        "strategy": "V30_SEC_EVENT_FALLBACK",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
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


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict], events: Dict[str, Dict[str, dict]]) -> List[dict]:
    return [trade for day in days if (trade := build_trade(candidate, day, features[day], events)) is not None]


def combined_route(v11_rows: Sequence[dict], v19_rows: Sequence[dict], event_rows: Sequence[dict], cost_bps: float, days: Sequence[str]) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by11 = {str(row["day"]): row for row in v11_rows if str(row["day"]) in allowed}
    by19 = {str(row["day"]): row for row in v19_rows if str(row["day"]) in allowed}
    by_event = {str(row["day"]): row for row in event_rows if str(row["day"]) in allowed}
    output: List[dict] = []
    stats: Counter = Counter()
    for day in sorted(allowed):
        primary = by11.get(day)
        if primary is not None:
            value = v22.trade_value(primary, cost_bps)
            if value is not None:
                output.append({**primary, "netReturn": value, "route": "V11_EQ_PRIMARY"})
                stats["V11_EQ_SELECTED"] += 1
                continue
        daily_return = 0.0
        next_free_ts = -1
        event = by_event.get(day)
        if event is not None:
            value = v22.trade_value(event, cost_bps)
            if value is not None:
                output.append({**event, "netReturn": value, "route": "V30_SEC_EVENT_FALLBACK"})
                stats["V30_SEC_EVENT_SELECTED"] += 1
                daily_return = (1.0 + daily_return) * (1.0 + value) - 1.0
                next_free_ts = int(event["exitTs"])
        baseline = by19.get(day)
        if baseline is not None and daily_return > DAILY_LOSS_LOCK:
            if int(baseline["entryTs"]) >= next_free_ts:
                value = v22.trade_value(baseline, cost_bps)
                if value is not None:
                    output.append({**baseline, "netReturn": value, "route": "V19_FALLBACK"})
                    stats["V19_FALLBACK_SELECTED"] += 1
            else:
                stats["V19_OVERLAP_BLOCKED"] += 1
    return sorted(output, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]))), dict(stats)


def metrics_set(v11_rows: Sequence[dict], v19_rows: Sequence[dict], event_rows: Sequence[dict], days: Sequence[str]) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        rows, stats = combined_route(v11_rows, v19_rows, event_rows, cost, days)
        results[name] = v22.metrics(rows)
        routing[name] = stats
    return results, routing


def event_only(event_rows: Sequence[dict], days: Sequence[str]) -> dict:
    allowed = set(days)
    selected = [row for row in event_rows if str(row["day"]) in allowed]
    return {name: v14.metrics(selected, cost) for name, cost in SCENARIOS.items()}


def audit(v11_rows: Sequence[dict], v19_rows: Sequence[dict], event_rows: Sequence[dict], target: Sequence[str], development: Sequence[str], validation: Sequence[str], final: Sequence[str], holdout: Sequence[str]) -> dict:
    full, routing = metrics_set(v11_rows, v19_rows, event_rows, target)
    dev, _ = metrics_set(v11_rows, v19_rows, event_rows, development)
    val, val_routing = metrics_set(v11_rows, v19_rows, event_rows, validation)
    fin, _ = metrics_set(v11_rows, v19_rows, event_rows, final)
    hol, _ = metrics_set(v11_rows, v19_rows, event_rows, holdout)
    event_metrics = {
        "development": event_only(event_rows, development),
        "validation": event_only(event_rows, validation),
        "finalReused": event_only(event_rows, final),
        "holdout": event_only(event_rows, holdout),
        "full": event_only(event_rows, target),
    }
    normal_events, _ = combined_route(v11_rows, v19_rows, event_rows, SCENARIOS["NORMAL"], target)
    p95_events, _ = combined_route(v11_rows, v19_rows, event_rows, SCENARIOS["P95"], target)
    normal_month_events, normal_month = v22.remove_best_month(normal_events)
    p95_month_events, p95_month = v22.remove_best_month(p95_events)
    normal, p95 = full["NORMAL"], full["P95"]
    checks = {
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightNormalTrades": val["NORMAL"]["trades"] >= 8,
        "validationMinimumFourEventTrades": event_metrics["validation"]["NORMAL"]["trades"] >= 4,
        "validationNormalProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.20,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "eventValidationNormalAndP95Positive": event_metrics["validation"]["NORMAL"]["compoundedReturnPct"] > 0 and event_metrics["validation"]["P95"]["compoundedReturnPct"] > 0,
        "finalReusedNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumTrades": hol["NORMAL"]["trades"] >= v20.STRICT_HURDLES["minimumHoldoutTrades"],
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "normalReturnAboveV22": normal["compoundedReturnPct"] > BASELINE_NORMAL,
        "p95ReturnAboveV22": p95["compoundedReturnPct"] > BASELINE_P95,
        "eventNormalPositive": event_metrics["full"]["NORMAL"]["compoundedReturnPct"] > 0,
        "eventP95Positive": event_metrics["full"]["P95"]["compoundedReturnPct"] > 0,
        "normalProfitFactorAtLeast1_5": (normal["profitFactor"] or 0.0) >= 1.50,
        "normalDrawdownNoWorseThanMinus15Pct": normal["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": normal["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": normal["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": v22.metrics(v22.remove_best(normal_events))["compoundedReturnPct"] > 0 and v22.metrics(v22.remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": v22.metrics(normal_month_events)["compoundedReturnPct"] > 0 and v22.metrics(p95_month_events)["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {
        "full": full, "development": dev, "validation": val, "finalReused": fin,
        "holdout": hol, "routing": routing, "validationRouting": val_routing,
        "eventMetrics": event_metrics, "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": v22.metrics(v22.remove_best(normal_events)),
            "p95BestTradeRemoved": v22.metrics(v22.remove_best(p95_events)),
            "normalBestMonthRemoved": {"month": normal_month, "metrics": v22.metrics(normal_month_events)},
            "p95BestMonthRemoved": {"month": p95_month, "metrics": v22.metrics(p95_month_events)},
        },
    }


def development_pass(result: dict, baseline: dict) -> bool:
    event = result["eventMetrics"]["development"]
    return (
        event["NORMAL"]["trades"] >= 6
        and event["NORMAL"]["compoundedReturnPct"] > 0
        and event["P95"]["compoundedReturnPct"] > 0
        and (event["NORMAL"]["profitFactor"] or 0.0) >= 1.2
        and result["development"]["NORMAL"]["compoundedReturnPct"] > baseline["development"]["NORMAL"]["compoundedReturnPct"]
        and result["development"]["P95"]["compoundedReturnPct"] > baseline["development"]["P95"]["compoundedReturnPct"]
    )


def validation_pass(result: dict, baseline: dict) -> bool:
    event = result["eventMetrics"]["validation"]
    return (
        result["validation"]["NORMAL"]["trades"] >= 8
        and event["NORMAL"]["trades"] >= 4
        and result["validation"]["NORMAL"]["compoundedReturnPct"] > baseline["validation"]["NORMAL"]["compoundedReturnPct"]
        and result["validation"]["P95"]["compoundedReturnPct"] > baseline["validation"]["P95"]["compoundedReturnPct"]
        and event["NORMAL"]["compoundedReturnPct"] > 0
        and event["P95"]["compoundedReturnPct"] > 0
        and (result["validation"]["NORMAL"]["profitFactor"] or 0.0) >= 1.2
    )


def selection_score(result: dict) -> float:
    val = result["validation"]["NORMAL"]
    event = result["eventMetrics"]["validation"]["NORMAL"]
    return val["compoundedReturnPct"] + result["validation"]["P95"]["compoundedReturnPct"] + event["compoundedReturnPct"] + 0.25 * event["trades"] - 0.5 * abs(val["maxDrawdownPct"])


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
    sec_events, sec_diagnostics = load_sec_events(cache_root / "sec", warmup)
    v11_rows, v11_diag = v22.build_v11eq(warmup, aligned)
    v19_rows = v22.build_fallback(warmup, aligned)
    baseline = v22.audit(v11_rows, v19_rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True)

    development_survivors = []
    for candidate in CANDIDATES:
        rows = build_trades(candidate, warmup, features, sec_events)
        result = audit(v11_rows, v19_rows, rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
        if development_pass(result, baseline):
            development_survivors.append((candidate, result))
    development_survivors.sort(key=lambda item: selection_score(item[1]), reverse=True)
    validation_survivors = [item for item in development_survivors[:60] if validation_pass(item[1], baseline)]
    validation_survivors.sort(key=lambda item: selection_score(item[1]), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None

    winner_payload = None
    status = "ASTER_ONLY_V30_NO_VALIDATED_SEC_EVENT_DRIFT"
    if winner is not None:
        candidate, result = winner
        accepted = result["allStrictHurdlesPassed"]
        status = "ASTER_ONLY_V30_VALIDATED_SHADOW_LEAD" if accepted else "ASTER_ONLY_V30_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {"candidate": asdict(candidate), "audit": result, "accepted": accepted}

    return rounded({
        "version": 30,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "baseline": baseline,
        "winner": winner_payload,
        "topDiagnostics": [{"candidate": asdict(candidate), "audit": result} for candidate, result in development_survivors[:12]],
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
            "filingSessionRule": "strictly next aligned session after SEC filing date",
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "sequentialEventThenV19Allowed": True,
            "hyperliquidUsed": False,
        },
        "data": {"stock": diagnostics, "yahooContext": yahoo_diagnostics, "sec": sec_diagnostics},
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
        "# Aster-only V30 SEC Filing Event Drift Tournament", "",
        f"Status: **{result['status']}**", "",
        f"Candidates: {result['candidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}", "",
    ]
    if result["winner"]:
        winner = result["winner"]
        lines += [
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Router Normal: {winner['audit']['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Router P95: {winner['audit']['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Event Normal: {winner['audit']['eventMetrics']['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Event P95: {winner['audit']['eventMetrics']['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Validation event trades: {winner['audit']['eventMetrics']['validation']['NORMAL']['trades']}", "",
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
        "topDiagnostics": result["topDiagnostics"][:5],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
