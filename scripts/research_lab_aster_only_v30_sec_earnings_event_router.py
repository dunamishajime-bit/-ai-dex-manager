from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

import research_lab_aster_only_v14_replacement_tournament as v14
import research_lab_aster_only_v19_trailing_one_year_bt as v19
import research_lab_aster_only_v20_strict_hurdle_tournament as v20
import research_lab_aster_only_v22_v11eq_primary_v19_fallback as v22
import research_lab_aster_only_v26_nonbasis_fallback_tournament as v26

STRATEGY_ID = "DISDEX_ASTER_ONLY_V30_SEC_EARNINGS_EVENT_ROUTER"
SCENARIOS = v14.SCENARIOS
HOLDOUT_START = v20.HOLDOUT_START_DAY
BASELINE_NORMAL = 72.276908
BASELINE_P95 = 68.080022
BASELINE_FALLBACK_NORMAL = 7.813259
BASELINE_FALLBACK_P95 = 7.400908
NY = ZoneInfo("America/New_York")
TP_PCT = 0.90
SL_PCT = 0.80
CIK_BY_SYMBOL = {
    "AMZN": "0001018724",
    "META": "0001326801",
    "MSFT": "0000789019",
    "NVDA": "0001045810",
    "TSLA": "0001318605",
}
ASTER_TO_CASH = {
    "AMZNUSDT": "AMZN",
    "METAUSDT": "META",
    "MSFTUSDT": "MSFT",
    "NVDAUSDT": "NVDA",
    "TSLAUSDT": "TSLA",
}


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    family: str
    event_offset: int
    primary_threshold_bps: float
    secondary_threshold_bps: float
    entry_slot: int
    maximum_holding_hours: int
    route_policy: str


def candidate_id(family: str, offset: int, primary: float, secondary: float, slot: int, hours: int, policy: str) -> str:
    return f"{family}__D{offset}__P{primary:g}__S{secondary:g}__SLOT{slot}__H{hours}__{policy}"


BASE_SPECS: List[Tuple[str, float, float]] = []
BASE_SPECS += [("EVENT_GAP_CONFIRM", gap, move) for gap in (30.0, 60.0, 100.0) for move in (20.0, 40.0, 70.0)]
BASE_SPECS += [("EVENT_CASH_ASTER_LAG", move, lag) for move in (30.0, 60.0, 100.0) for lag in (15.0, 30.0)]
BASE_SPECS += [("EVENT_GAP_REVERSAL", gap, reversal) for gap in (30.0, 60.0, 100.0) for reversal in (20.0, 40.0, 70.0)]

CANDIDATES: Tuple[Candidate, ...] = tuple(
    Candidate(candidate_id(family, offset, primary, secondary, slot, hours, policy), family, offset, primary, secondary, slot, hours, policy)
    for family, primary, secondary in BASE_SPECS
    for offset in (0, 1)
    for slot in (1, 2)
    for hours in (1, 2)
    for policy in ("EVENT_PRIORITY", "MAX_EDGE")
) + tuple(
    Candidate(candidate_id(family, offset, primary, secondary, 1, 1, "SEQUENTIAL_THEN_V19"), family, offset, primary, secondary, 1, 1, "SEQUENTIAL_THEN_V19")
    for family, primary, secondary in BASE_SPECS
    for offset in (0, 1)
)


def finite(value: Any, fallback: float = 0.0) -> float:
    return v14.finite(value, fallback)


def rounded(value: Any):
    return v14.rounded(value)


def parse_sec_datetime(value: str) -> dt.datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError("missing SEC acceptance datetime")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def fetch_sec_submissions(symbol: str, cache_dir: Path) -> dict:
    cik = CIK_BY_SYMBOL[symbol]
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{symbol}-{cik}-submissions.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and payload.get("cik"):
            return payload
    request = urllib.request.Request(
        f"https://data.sec.gov/submissions/CIK{cik}.json",
        headers={
            "User-Agent": "DisDexResearch/1.0 github.com/dunamishajime-bit/-ai-dex-manager",
            "Accept": "application/json",
        },
    )
    errors = []
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                payload = json.loads(response.read().decode("utf-8"))
            path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
            return payload
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
            errors.append(f"{type(exc).__name__}:{exc}")
            time.sleep(min(12.0, 1.0 * (2 ** attempt)))
    raise RuntimeError(f"SEC submissions unavailable for {symbol}: {'; '.join(errors[-4:])}")


def recent_rows(payload: dict) -> List[dict]:
    recent = ((payload.get("filings") or {}).get("recent") or {})
    if not isinstance(recent, dict):
        return []
    keys = ["accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "form", "items", "primaryDocument", "primaryDocDescription"]
    length = max((len(recent.get(key) or []) for key in keys), default=0)
    rows = []
    for index in range(length):
        row = {}
        for key in keys:
            values = recent.get(key) or []
            row[key] = values[index] if index < len(values) else ""
        rows.append(row)
    return rows


def is_earnings_filing(row: dict) -> bool:
    form = str(row.get("form") or "").upper().strip()
    if form in {"10-Q", "10-K", "10-Q/A", "10-K/A"}:
        return True
    if form not in {"8-K", "8-K/A"}:
        return False
    items = {item.strip() for item in str(row.get("items") or "").split(",")}
    return "2.02" in items


def first_session_on_or_after(day: str, sessions: Sequence[str]) -> Optional[int]:
    for index, session in enumerate(sessions):
        if session >= day:
            return index
    return None


def event_sessions(cache_dir: Path, sessions: Sequence[str]) -> Tuple[Dict[str, Dict[int, List[dict]]], dict]:
    result: Dict[str, Dict[int, List[dict]]] = {symbol: {0: [], 1: []} for symbol in CIK_BY_SYMBOL}
    diagnostics: Dict[str, dict] = {}
    for symbol in CIK_BY_SYMBOL:
        payload = fetch_sec_submissions(symbol, cache_dir)
        filings = []
        for row in recent_rows(payload):
            if not is_earnings_filing(row):
                continue
            try:
                accepted = parse_sec_datetime(str(row.get("acceptanceDateTime") or ""))
            except (TypeError, ValueError):
                continue
            local = accepted.astimezone(NY)
            candidate_day = local.date().isoformat()
            if local.hour > 9 or (local.hour == 9 and local.minute >= 25):
                candidate_day = (local.date() + dt.timedelta(days=1)).isoformat()
            first_index = first_session_on_or_after(candidate_day, sessions)
            if first_index is None:
                continue
            for offset in (0, 1):
                index = first_index + offset
                if index >= len(sessions):
                    continue
                event = {
                    "symbol": symbol,
                    "session": sessions[index],
                    "offset": offset,
                    "form": str(row.get("form") or ""),
                    "items": str(row.get("items") or ""),
                    "filingDate": str(row.get("filingDate") or ""),
                    "reportDate": str(row.get("reportDate") or ""),
                    "acceptanceDateTime": accepted.isoformat(),
                    "accessionNumber": str(row.get("accessionNumber") or ""),
                }
                result[symbol][offset].append(event)
                filings.append(event)
        for offset in (0, 1):
            dedup = {}
            for event in result[symbol][offset]:
                current = dedup.get(event["session"])
                rank = 2 if str(event["form"]).startswith(("10-Q", "10-K")) else 1
                current_rank = 2 if current and str(current["form"]).startswith(("10-Q", "10-K")) else 1
                if current is None or rank > current_rank:
                    dedup[event["session"]] = event
            result[symbol][offset] = [dedup[key] for key in sorted(dedup)]
        diagnostics[symbol] = {
            "cik": CIK_BY_SYMBOL[symbol],
            "companyName": payload.get("name"),
            "eventSessionsOffset0": len(result[symbol][0]),
            "eventSessionsOffset1": len(result[symbol][1]),
            "firstEventSession": min((row["session"] for row in filings), default=None),
            "lastEventSession": max((row["session"] for row in filings), default=None),
        }
    return result, diagnostics


def event_map(events: Dict[str, Dict[int, List[dict]]], offset: int) -> Dict[str, Dict[str, dict]]:
    mapped: Dict[str, Dict[str, dict]] = defaultdict(dict)
    for cash_symbol, by_offset in events.items():
        for event in by_offset[offset]:
            mapped[event["session"]][cash_symbol] = event
    return dict(mapped)


def state_at(row: dict, slot: int) -> dict:
    cash0, cash_now = finite(row["cash"][0]), finite(row["cash"][slot])
    perp0, perp_now = finite(row["perp"][0]), finite(row["perp"][slot])
    cash_return = (cash_now / cash0 - 1.0) * 10_000.0
    perp_return = (perp_now / perp0 - 1.0) * 10_000.0
    return {
        "gapBps": row.get("gapBps"),
        "cashReturnBps": cash_return,
        "perpReturnBps": perp_return,
        "lagBps": cash_return - perp_return,
    }


def select_signal(candidate: Candidate, day: str, features: Dict[str, dict], events_by_day: Dict[str, Dict[str, dict]]) -> Optional[Tuple[str, int, float, dict]]:
    eligible: List[Tuple[float, str, int, float, dict]] = []
    event_symbols = events_by_day.get(day) or {}
    for aster_symbol in v14.SYMBOLS:
        event = event_symbols.get(ASTER_TO_CASH[aster_symbol])
        if event is None:
            continue
        row = features[day][aster_symbol]
        state = state_at(row, candidate.entry_slot)
        gap = finite(state.get("gapBps"), math.nan)
        cash_return, lag = finite(state["cashReturnBps"]), finite(state["lagBps"])
        if candidate.family == "EVENT_GAP_CONFIRM":
            if not math.isfinite(gap) or abs(gap) < candidate.primary_threshold_bps or abs(cash_return) < candidate.secondary_threshold_bps or gap * cash_return <= 0:
                continue
            side = 1 if cash_return > 0 else -1
            strength = abs(gap) + abs(cash_return)
            edge = max(0.0, min(abs(gap), abs(cash_return)) - 5.0)
        elif candidate.family == "EVENT_CASH_ASTER_LAG":
            if abs(cash_return) < candidate.primary_threshold_bps or abs(lag) < candidate.secondary_threshold_bps or cash_return * lag <= 0:
                continue
            side = 1 if cash_return > 0 else -1
            strength = abs(cash_return) + abs(lag)
            edge = max(0.0, min(abs(cash_return), abs(lag)) - 5.0)
        elif candidate.family == "EVENT_GAP_REVERSAL":
            if not math.isfinite(gap) or abs(gap) < candidate.primary_threshold_bps or abs(cash_return) < candidate.secondary_threshold_bps or gap * cash_return >= 0:
                continue
            side = 1 if cash_return > 0 else -1
            strength = abs(gap) + abs(cash_return)
            edge = max(0.0, min(abs(gap), abs(cash_return)) - 5.0)
        else:
            raise ValueError(candidate.family)
        eligible.append((strength, aster_symbol, side, edge, {**state, "event": event}))
    if not eligible:
        return None
    _strength, symbol, side, edge, detail = sorted(eligible, key=lambda item: (-item[0], item[1]))[0]
    return symbol, side, edge, detail


def build_trade(candidate: Candidate, day: str, features: Dict[str, dict], events_by_day: Dict[str, Dict[str, dict]]) -> Optional[dict]:
    selected = select_signal(candidate, day, features, events_by_day)
    if selected is None:
        return None
    symbol, side, edge_proxy, detail = selected
    row = features[day][symbol]
    points = row["points"]
    entry = points[candidate.entry_slot]
    last_index = min(len(points) - 1, candidate.entry_slot + candidate.maximum_holding_hours)
    chosen = points[last_index]
    exit_reason = f"TIME_{candidate.maximum_holding_hours}H"
    for point in points[candidate.entry_slot + 1:last_index + 1]:
        price_return = side * (finite(point["price"]) / finite(entry["price"]) - 1.0)
        if price_return >= TP_PCT / 100.0:
            chosen, exit_reason = point, "PRICE_TAKE_PROFIT"
            break
        if price_return <= -SL_PCT / 100.0:
            chosen, exit_reason = point, "PRICE_STOP"
            break
    entry_ts, exit_ts = int(entry["ts"]), int(chosen["ts"])
    price_return = side * (finite(chosen["price"]) / finite(entry["price"]) - 1.0)
    funding_return = (-side) * v14.funding_mod.funding_between(row["fundingPoints"], entry_ts, exit_ts)
    return {
        "strategy": "V30_SEC_EVENT",
        "candidateId": candidate.candidate_id,
        "day": day,
        "symbol": symbol,
        "side": side,
        "gross": 1.0,
        "entryTs": entry_ts,
        "exitTs": exit_ts,
        "holdingHours": max(0.0, (exit_ts - entry_ts) / 3_600_000.0),
        "grossReturn": price_return + funding_return,
        "fundingReturn": funding_return,
        "edgeProxyBps": edge_proxy,
        "exitReason": exit_reason,
        "signalDetail": detail,
    }


def build_trades(candidate: Candidate, days: Sequence[str], features: Dict[str, dict], events: Dict[str, Dict[int, List[dict]]]) -> List[dict]:
    mapped = event_map(events, candidate.event_offset)
    return [trade for day in days if (trade := build_trade(candidate, day, features, mapped)) is not None]


def estimated_edge(row: Optional[dict], cost_bps: float) -> float:
    return -1e18 if row is None else finite(row.get("edgeProxyBps")) - cost_bps


def combined_route(candidate: Candidate, v11_rows: Sequence[dict], v19_rows: Sequence[dict], event_rows: Sequence[dict], cost_bps: float, days: Sequence[str]) -> Tuple[List[dict], dict]:
    allowed = set(days)
    by11 = {str(row["day"]): row for row in v11_rows if str(row["day"]) in allowed}
    by19 = {str(row["day"]): row for row in v19_rows if str(row["day"]) in allowed}
    by_event = {str(row["day"]): row for row in event_rows if str(row["day"]) in allowed}
    events: List[dict] = []
    stats: Counter = Counter()
    for day in sorted(allowed):
        primary = by11.get(day)
        if primary is not None:
            value = v22.trade_value(primary, cost_bps)
            if value is not None:
                events.append({**primary, "netReturn": value, "route": "V11_EQ_PRIMARY"})
                stats["V11_EQ_SELECTED"] += 1
                continue
            stats["V11_EQ_COST_GATE_REJECTED"] += 1
        event, baseline = by_event.get(day), by19.get(day)
        if candidate.route_policy == "SEQUENTIAL_THEN_V19":
            if event is not None:
                value = v22.trade_value(event, cost_bps)
                if value is not None:
                    events.append({**event, "netReturn": value, "route": "V30_SEC_EVENT"})
                    stats["V30_SEC_EVENT_SELECTED"] += 1
            if baseline is not None and (event is None or int(event["exitTs"]) <= int(baseline["entryTs"])):
                value = v22.trade_value(baseline, cost_bps)
                if value is not None:
                    events.append({**baseline, "netReturn": value, "route": "V19_FALLBACK"})
                    stats["V19_FALLBACK_SELECTED"] += 1
            elif baseline is not None:
                stats["V19_OVERLAP_BLOCKED"] += 1
            continue
        event_ok = event is not None and v22.trade_value(event, cost_bps) is not None
        v19_ok = baseline is not None and v22.trade_value(baseline, cost_bps) is not None
        selected = route = None
        if candidate.route_policy == "EVENT_PRIORITY":
            if event_ok:
                selected, route = event, "V30_SEC_EVENT"
            elif v19_ok:
                selected, route = baseline, "V19_FALLBACK"
        elif candidate.route_policy == "MAX_EDGE":
            choices = []
            if event_ok:
                choices.append((event, "V30_SEC_EVENT"))
            if v19_ok:
                choices.append((baseline, "V19_FALLBACK"))
            if choices:
                selected, route = sorted(choices, key=lambda item: (-estimated_edge(item[0], cost_bps), item[1]))[0]
        else:
            raise ValueError(candidate.route_policy)
        if selected is not None:
            value = v22.trade_value(selected, cost_bps)
            events.append({**selected, "netReturn": value, "route": route})
            stats[route + "_SELECTED"] += 1
    return sorted(events, key=lambda row: (int(row["entryTs"]), int(row["exitTs"]), str(row["route"]))), dict(stats)


def scenario_set(candidate: Candidate, v11_rows: Sequence[dict], v19_rows: Sequence[dict], event_rows: Sequence[dict], days: Sequence[str]) -> Tuple[dict, dict]:
    results, routing = {}, {}
    for name, cost in SCENARIOS.items():
        rows, stats = combined_route(candidate, v11_rows, v19_rows, event_rows, cost, days)
        results[name] = v22.metrics(rows)
        routing[name] = stats
    return results, routing


def audit(candidate: Candidate, v11_rows: Sequence[dict], v19_rows: Sequence[dict], event_rows: Sequence[dict], target: Sequence[str], development: Sequence[str], validation: Sequence[str], final: Sequence[str], holdout: Sequence[str]) -> dict:
    full, routing = scenario_set(candidate, v11_rows, v19_rows, event_rows, target)
    dev, dev_routing = scenario_set(candidate, v11_rows, v19_rows, event_rows, development)
    val, val_routing = scenario_set(candidate, v11_rows, v19_rows, event_rows, validation)
    fin, _ = scenario_set(candidate, v11_rows, v19_rows, event_rows, final)
    hol, _ = scenario_set(candidate, v11_rows, v19_rows, event_rows, holdout)
    normal_events, _ = combined_route(candidate, v11_rows, v19_rows, event_rows, SCENARIOS["NORMAL"], target)
    p95_events, _ = combined_route(candidate, v11_rows, v19_rows, event_rows, SCENARIOS["P95"], target)
    normal_month_events, normal_month = v22.remove_best_month(normal_events)
    p95_month_events, p95_month = v22.remove_best_month(p95_events)
    event_full_normal = v22.metrics([row for row in normal_events if row.get("route") == "V30_SEC_EVENT"])
    event_full_p95 = v22.metrics([row for row in p95_events if row.get("route") == "V30_SEC_EVENT"])
    event_dev = int(dev_routing["NORMAL"].get("V30_SEC_EVENT_SELECTED", 0))
    event_val = int(val_routing["NORMAL"].get("V30_SEC_EVENT_SELECTED", 0))
    normal, p95 = full["NORMAL"], full["P95"]
    checks = {
        "developmentNormalAndP95Positive": dev["NORMAL"]["compoundedReturnPct"] > 0 and dev["P95"]["compoundedReturnPct"] > 0,
        "validationMinimumEightNormalTrades": val["NORMAL"]["trades"] >= 8,
        "validationMinimumFourEventTrades": event_val >= 4,
        "validationNormalProfitFactorAtLeast1_2": (val["NORMAL"]["profitFactor"] or 0.0) >= 1.20,
        "validationNormalAndP95Positive": val["NORMAL"]["compoundedReturnPct"] > 0 and val["P95"]["compoundedReturnPct"] > 0,
        "finalReusedNormalAndP95Positive": fin["NORMAL"]["compoundedReturnPct"] > 0 and fin["P95"]["compoundedReturnPct"] > 0,
        "holdoutMinimumTrades": hol["NORMAL"]["trades"] >= v20.STRICT_HURDLES["minimumHoldoutTrades"],
        "holdoutNormalAndP95Positive": hol["NORMAL"]["compoundedReturnPct"] > 0 and hol["P95"]["compoundedReturnPct"] > 0,
        "normalReturnAboveV22": normal["compoundedReturnPct"] > BASELINE_NORMAL,
        "p95ReturnAboveV22": p95["compoundedReturnPct"] > BASELINE_P95,
        "eventNormalAboveV19Fallback": event_full_normal["compoundedReturnPct"] > BASELINE_FALLBACK_NORMAL,
        "eventP95AboveV19Fallback": event_full_p95["compoundedReturnPct"] > BASELINE_FALLBACK_P95,
        "normalProfitFactorAtLeast1_5": (normal["profitFactor"] or 0.0) >= 1.50,
        "normalDrawdownNoWorseThanMinus15Pct": normal["maxDrawdownPct"] >= -15.0,
        "normalMinimumFiftyTrades": normal["trades"] >= 50,
        "positiveProfitConcentrationAtMost40Pct": normal["maximumPositiveProfitSymbolShare"] <= 0.40,
        "bestTradeRemovedNormalAndP95Positive": v22.metrics(v22.remove_best(normal_events))["compoundedReturnPct"] > 0 and v22.metrics(v22.remove_best(p95_events))["compoundedReturnPct"] > 0,
        "bestMonthRemovedNormalAndP95Positive": v22.metrics(normal_month_events)["compoundedReturnPct"] > 0 and v22.metrics(p95_month_events)["compoundedReturnPct"] > 0,
        "severeFailClosedNonnegative": full["SEVERE"]["compoundedReturnPct"] >= 0,
    }
    return {
        "full": full,
        "development": dev,
        "validation": val,
        "finalReused": fin,
        "holdout": hol,
        "routing": routing,
        "developmentEventTrades": event_dev,
        "validationEventTrades": event_val,
        "eventFull": {"NORMAL": event_full_normal, "P95": event_full_p95},
        "checks": checks,
        "allStrictHurdlesPassed": all(checks.values()),
        "robustness": {
            "normalBestTradeRemoved": v22.metrics(v22.remove_best(normal_events)),
            "p95BestTradeRemoved": v22.metrics(v22.remove_best(p95_events)),
            "normalBestMonthRemoved": {"month": normal_month, "metrics": v22.metrics(normal_month_events)},
            "p95BestMonthRemoved": {"month": p95_month, "metrics": v22.metrics(p95_month_events)},
        },
    }


def development_pass(candidate_audit: dict, baseline: dict) -> bool:
    return candidate_audit["developmentEventTrades"] >= 4 and candidate_audit["development"]["NORMAL"]["compoundedReturnPct"] > baseline["development"]["NORMAL"]["compoundedReturnPct"] and candidate_audit["development"]["P95"]["compoundedReturnPct"] > baseline["development"]["P95"]["compoundedReturnPct"] and (candidate_audit["development"]["NORMAL"]["profitFactor"] or 0.0) >= 1.30


def validation_pass(candidate_audit: dict, baseline: dict) -> bool:
    return candidate_audit["validation"]["NORMAL"]["trades"] >= 8 and candidate_audit["validationEventTrades"] >= 4 and candidate_audit["validation"]["NORMAL"]["compoundedReturnPct"] > baseline["validation"]["NORMAL"]["compoundedReturnPct"] and candidate_audit["validation"]["P95"]["compoundedReturnPct"] > baseline["validation"]["P95"]["compoundedReturnPct"] and (candidate_audit["validation"]["NORMAL"]["profitFactor"] or 0.0) >= 1.20


def selection_score(candidate_audit: dict) -> float:
    val, val95 = candidate_audit["validation"]["NORMAL"], candidate_audit["validation"]["P95"]
    return val["compoundedReturnPct"] + val95["compoundedReturnPct"] + 0.25 * candidate_audit["validationEventTrades"] - 0.5 * abs(val["maxDrawdownPct"])


def analyze(cache_root: Path) -> dict:
    v14.base.verify_source(v14.base.V11_ROOT, v14.base.V11_SOURCE_SHA)
    v14.base.verify_source(v14.base.V13_ROOT, v14.base.V13_SOURCE_SHA)
    v19.configure_exact_data_window()
    days, aligned, diagnostics = v19.v17.load_all(cache_root / "market")
    warmup = [day for day in days if v19.WARMUP_START.date().isoformat() <= day < v19.BT_END_DAY_EXCLUSIVE]
    target = [day for day in warmup if v19.BT_START_DAY <= day < v19.BT_END_DAY_EXCLUSIVE]
    pre_holdout = [day for day in target if day < HOLDOUT_START]
    holdout = [day for day in target if day >= HOLDOUT_START]
    splits = v14.split_days(pre_holdout)
    features = v26.build_features(warmup, aligned)
    sec_events, sec_diagnostics = event_sessions(cache_root / "sec", warmup)
    v11_rows, v11_diagnostics = v22.build_v11eq(warmup, aligned)
    v19_rows = v22.build_fallback(warmup, aligned)
    baseline = v22.audit(v11_rows, v19_rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout, True)
    development_survivors = []
    for candidate in CANDIDATES:
        rows = build_trades(candidate, warmup, features, sec_events)
        candidate_audit = audit(candidate, v11_rows, v19_rows, rows, target, splits["DEVELOPMENT"], splits["VALIDATION"], splits["FINAL_REUSED"], holdout)
        if development_pass(candidate_audit, baseline):
            development_survivors.append((candidate, rows, candidate_audit))
    development_survivors.sort(key=lambda item: selection_score(item[2]), reverse=True)
    validation_survivors = [item for item in development_survivors[:40] if validation_pass(item[2], baseline)]
    validation_survivors.sort(key=lambda item: selection_score(item[2]), reverse=True)
    winner = validation_survivors[0] if validation_survivors else None
    status = "ASTER_ONLY_V30_NO_VALIDATED_SEC_EVENT_ROUTER"
    winner_payload = None
    if winner is not None:
        candidate, rows, candidate_audit = winner
        accepted = all(candidate_audit["checks"].values())
        status = "ASTER_ONLY_V30_VALIDATED_SEC_EVENT_SHADOW_LEAD" if accepted else "ASTER_ONLY_V30_WINNER_DID_NOT_CLEAR_FINAL_AUDIT"
        winner_payload = {"candidate": asdict(candidate), "audit": candidate_audit, "accepted": accepted, "tradeCountRaw": len(rows)}
    return rounded({
        "version": 30,
        "strategyId": STRATEGY_ID,
        "status": status,
        "candidateCount": len(CANDIDATES),
        "developmentSurvivors": len(development_survivors),
        "validationSurvivors": len(validation_survivors),
        "baseline": baseline,
        "winner": winner_payload,
        "topDevelopment": [
            {
                "candidate": asdict(candidate),
                "development": candidate_audit["development"],
                "validation": candidate_audit["validation"],
                "developmentEventTrades": candidate_audit["developmentEventTrades"],
                "validationEventTrades": candidate_audit["validationEventTrades"],
            }
            for candidate, _rows, candidate_audit in development_survivors[:10]
        ],
        "period": {
            "startInclusiveUtc": v19.BT_START.isoformat(),
            "endExclusiveUtc": v19.BT_END_EXCLUSIVE.isoformat(),
            "calendarDays": 365,
            "sessions": len(target),
            "holdoutSessions": len(holdout),
        },
        "architecture": {
            "venue": "ASTER_ONLY",
            "maximumConcurrentGross": 1.0,
            "maximumConcurrentPositions": 1,
            "sequentialIntradayEntriesAllowed": True,
            "hyperliquidUsed": False,
        },
        "selectionDiscipline": {
            "candidateCountFrozenBeforeExecution": True,
            "developmentSelectsTopForty": True,
            "validationSelectsAtMostOne": True,
            "finalAndHoldoutUsedForSelection": False,
            "productionPromotionAllowed": False,
        },
        "eventData": {
            "source": "SEC data.sec.gov submissions API",
            "forms": ["10-Q", "10-K", "8-K Item 2.02"],
            "diagnostics": sec_diagnostics,
        },
        "data": diagnostics,
        "v11Diagnostics": v11_diagnostics,
        "limitations": [
            "SEC filing presence and timing are used; analyst consensus surprise is not available.",
            "Cash history is Yahoo 60-minute data rather than Pyth tick data.",
            "Aster history is candle-based and cannot reconstruct exact spread, depth, queue or post-only fills.",
            "The one-year history is reused and is not an independent Holdout.",
        ],
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
        "# Aster-only V30 SEC Earnings Event Router",
        "",
        f"Status: **{result['status']}**",
        "",
        f"Candidates: {result['candidateCount']}",
        f"Development survivors: {result['developmentSurvivors']}",
        f"Validation survivors: {result['validationSurvivors']}",
        "",
    ]
    if result["winner"]:
        winner, candidate_audit = result["winner"], result["winner"]["audit"]
        lines += [
            f"Winner: `{winner['candidate']['candidate_id']}`",
            f"Accepted: {winner['accepted']}",
            f"Router Normal: {candidate_audit['full']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Router P95: {candidate_audit['full']['P95']['compoundedReturnPct']:.6f}%",
            f"Event Normal: {candidate_audit['eventFull']['NORMAL']['compoundedReturnPct']:.6f}%",
            f"Event P95: {candidate_audit['eventFull']['P95']['compoundedReturnPct']:.6f}%",
            f"Validation event trades: {candidate_audit['validationEventTrades']}",
            "",
        ]
    lines += [
        "SEC submissions are fetched without authentication using a declared User-Agent.",
        "Research only. No Production, LIVE, VPS or order state was changed.",
        "",
    ]
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
        "topDevelopment": result["topDevelopment"][:3],
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
