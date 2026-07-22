from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import v96_stock_event_ledger as base
import v96_stock_event_ledger_v2 as v2

COLLECTOR_VERSION = 3
NASDAQ_SEC_URL = "https://api.nasdaq.com/api/company/{ticker}/sec-filings"

# Point-in-time fallback copied from the BLS official 2026 release calendar as
# published before this Forward window. It is intentionally explicit and is
# never represented as a live BLS fetch when GitHub-hosted runners receive 403.
BLS_FROZEN_SCHEDULE: Tuple[Tuple[str, str, str], ...] = (
    ("2026-07-31T08:30:00", "Employment Cost Index", "Second Quarter 2026"),
    ("2026-08-04T10:00:00", "Job Openings and Labor Turnover Survey", "June 2026"),
    ("2026-08-06T08:30:00", "Productivity and Costs (P)", "Second Quarter 2026"),
    ("2026-08-07T08:30:00", "Employment Situation", "July 2026"),
    ("2026-08-12T08:30:00", "Consumer Price Index", "July 2026"),
    ("2026-08-12T08:30:00", "Real Earnings", "July 2026"),
    ("2026-08-13T08:30:00", "Producer Price Index", "July 2026"),
    ("2026-08-18T08:30:00", "U.S. Import and Export Price Indexes", "July 2026"),
)


def walk_dict_lists(value: Any) -> Iterable[List[Dict[str, Any]]]:
    if isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
        yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from walk_dict_lists(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_dict_lists(child)


def choose_filing_rows(payload: Any) -> List[Dict[str, Any]]:
    best: List[Dict[str, Any]] = []
    best_score = -1
    filing_keys = {
        "form", "formType", "type", "filingType", "filed", "filedDate",
        "filingDate", "acceptedDate", "accessionNumber", "accessionNo",
    }
    for rows in walk_dict_lists(payload):
        keys = set().union(*(row.keys() for row in rows[:5])) if rows else set()
        score = len(keys & filing_keys)
        if score > best_score:
            best = rows
            best_score = score
    return best if best_score >= 2 else []


def first_value(row: Dict[str, Any], *keys: str) -> Optional[Any]:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def parse_datetime(value: Any) -> Optional[dt.datetime]:
    if value in (None, ""):
        return None
    text = str(value).strip()
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=base.NY)
        return parsed.astimezone(base.UTC)
    except ValueError:
        pass
    for fmt in (
        "%m/%d/%Y", "%b %d, %Y", "%B %d, %Y", "%Y-%m-%d",
        "%m/%d/%Y %I:%M:%S %p", "%Y-%m-%d %H:%M:%S",
    ):
        try:
            parsed = dt.datetime.strptime(text, fmt).replace(tzinfo=base.NY)
            return parsed.astimezone(base.UTC)
        except ValueError:
            continue
    return None


def normalize_form(value: Any) -> str:
    text = str(value or "").strip().upper()
    match = re.search(
        r"(?:^|\b)(8-K(?:/A)?|6-K(?:/A)?|10-Q(?:/A)?|10-K(?:/A)?|20-F(?:/A)?|40-F(?:/A)?|"
        r"S-3(?:ASR)?|F-3(?:ASR)?|424B[2345]|DEF 14A|SC 13D(?:/A)?|SC 13G(?:/A)?|25(?:-NSE)?)(?:\b|$)",
        text,
    )
    return match.group(1) if match else text


def collect_nasdaq_sec_filings(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    companies: List[Dict[str, Any]] = []
    cutoff = now - dt.timedelta(days=4)
    successes = 0
    for symbol, cfg in base.SYMBOLS.items():
        ticker = cfg.get("ticker")
        if not ticker:
            continue
        url = NASDAQ_SEC_URL.format(ticker=ticker) + "?" + base.urllib.parse.urlencode({
            "limit": 50,
            "sortColumn": "filed",
            "sortOrder": "desc",
        })
        payload, meta = base.fetch_json(url, headers={
            **base.DEFAULT_HEADERS,
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://www.nasdaq.com",
            "Referer": f"https://www.nasdaq.com/market-activity/stocks/{str(ticker).lower()}/sec-filings",
        })
        rows = choose_filing_rows(payload) if meta.get("ok") else []
        meta.update({"symbol": symbol, "ticker": ticker, "rowsDetected": len(rows)})
        companies.append(meta)
        if not meta.get("ok"):
            continue
        successes += 1
        for row in rows:
            form = normalize_form(first_value(row, "form", "formType", "type", "filingType", "formName"))
            if form not in base.SEC_FORMS:
                continue
            filed_at = parse_datetime(first_value(
                row, "acceptedDate", "acceptedAt", "filedAt", "filedDate", "filed", "filingDate", "date"
            ))
            if filed_at is None or filed_at < cutoff:
                continue
            accession = str(first_value(row, "accessionNumber", "accessionNo", "accession", "id") or "")
            description = str(first_value(row, "description", "formDescription", "title") or "")
            filing_url = str(first_value(
                row, "viewUrl", "documentUrl", "reportUrl", "link", "url", "primaryDocumentUrl", "htmlUrl"
            ) or "")
            event_type, hints = base.sec_event_type(form)
            events.append(base.make_event(
                source="NASDAQ_SEC_FILINGS_FALLBACK",
                source_record_id=accession or f"{ticker}:{form}:{base.iso(filed_at)}",
                symbol=symbol,
                event_type=event_type,
                headline=f"{ticker} filed {form}" + (f": {description}" if description else ""),
                published_at=filed_at,
                url=filing_url or url,
                risk_hints=hints,
                details={
                    "form": form,
                    "fallbackReason": "SEC official endpoints returned 403 from GitHub-hosted runner",
                    "rawFieldNames": sorted(row.keys()),
                },
            ))
    return base.dedupe_events(events), {
        "ok": successes >= 15,
        "records": len(events),
        "successfulCompanies": successes,
        "expectedCompanies": sum(bool(cfg.get("ticker")) for cfg in base.SYMBOLS.values()),
        "companies": companies,
        "sourceMode": "nasdaq_public_fallback",
    }


def collect_sec_filings(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    primary_events, primary_meta = v2.collect_sec_filings(now)
    if primary_meta.get("ok"):
        return primary_events, {
            "ok": True,
            "records": len(primary_events),
            "primary": primary_meta,
            "fallbackUsed": False,
            "sourceMode": "sec_official_live",
        }
    fallback_events, fallback_meta = collect_nasdaq_sec_filings(now)
    return fallback_events, {
        "ok": bool(fallback_meta.get("ok")),
        "records": len(fallback_events),
        "primary": primary_meta,
        "fallback": fallback_meta,
        "fallbackUsed": True,
        "sourceMode": "nasdaq_public_fallback" if fallback_meta.get("ok") else "unavailable",
    }


def frozen_bls_events(now: dt.datetime) -> List[Dict[str, Any]]:
    lower = now - dt.timedelta(days=1)
    upper = now + dt.timedelta(days=21)
    events: List[Dict[str, Any]] = []
    for local_text, release_name, reference_period in BLS_FROZEN_SCHEDULE:
        local = dt.datetime.fromisoformat(local_text).replace(tzinfo=base.NY)
        effective = local.astimezone(base.UTC)
        if not (lower <= effective <= upper):
            continue
        events.append(base.make_event(
            source="BLS_OFFICIAL_SCHEDULE_FROZEN",
            source_record_id=f"BLS:{release_name}:{base.iso(effective)}",
            event_type="MACRO_RELEASE_SCHEDULED",
            headline=f"{release_name} for {reference_period}",
            effective_at=effective,
            scheduled=True,
            url="https://www.bls.gov/schedule/2026/home.htm",
            risk_hints=["MACRO_EVENT"],
            details={
                "referencePeriod": reference_period,
                "sourceMode": "frozen_point_in_time_official_schedule",
                "frozenBeforeForwardUse": True,
                "liveFetchRepresented": False,
            },
        ))
    return events


def collect_bls_calendar(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    live_events, live_meta = v2.collect_bls_calendar(now)
    if live_meta.get("ok"):
        return live_events, {
            "ok": True,
            "records": len(live_events),
            "live": live_meta,
            "fallbackUsed": False,
            "sourceMode": "bls_official_live",
        }
    events = frozen_bls_events(now)
    return events, {
        "ok": True,
        "records": len(events),
        "live": live_meta,
        "fallbackUsed": True,
        "sourceMode": "frozen_point_in_time_official_schedule",
        "liveSourceAvailable": False,
        "fallbackIsNotLive": True,
    }


def collect_snapshot(mode: str, now: dt.datetime) -> Dict[str, Any]:
    all_events: List[Dict[str, Any]] = []
    source_results: Dict[str, Any] = {}

    news_events, news_meta = v2.collect_google_news(now)
    all_events.extend(news_events)
    source_results["googleNewsRss"] = news_meta

    halt_events, halt_meta = base.collect_trade_halts()
    all_events.extend(halt_events)
    source_results["nasdaqTradeHalts"] = halt_meta

    aster_events, aster_meta, contracts = base.collect_aster_status()
    all_events.extend(aster_events)
    source_results["asterExchangeInfo"] = aster_meta

    if mode == "full":
        sec_events, sec_meta = collect_sec_filings(now)
        all_events.extend(sec_events)
        source_results["secEdgar"] = sec_meta

        earnings_events, earnings_meta = base.collect_nasdaq_earnings(now)
        all_events.extend(earnings_events)
        source_results["nasdaqEarnings"] = earnings_meta

        bls_events, bls_meta = collect_bls_calendar(now)
        all_events.extend(bls_events)
        source_results["blsCalendar"] = bls_meta

        fomc_events, fomc_meta = v2.collect_fomc_calendar(now)
        all_events.extend(fomc_events)
        source_results["fomcCalendar"] = fomc_meta

        bea_events, bea_meta = base.collect_bea_calendar(now)
        all_events.extend(bea_events)
        source_results["beaCalendar"] = bea_meta

    events = base.dedupe_events(all_events)
    return {
        "schemaVersion": 1,
        "collectorId": base.COLLECTOR_ID,
        "collectorVersion": COLLECTOR_VERSION,
        "mode": mode,
        "fetchedAt": base.iso(now),
        "symbolUniverse": list(base.SYMBOLS),
        "underlyingTickers": {symbol: cfg.get("ticker") for symbol, cfg in base.SYMBOLS.items()},
        "sourceResults": source_results,
        "events": events,
        "observations": {"asterContracts": contracts},
        "summary": {
            "eventCount": len(events),
            "eventsBySource": dict(Counter(event["source"] for event in events)),
            "eventsByType": dict(Counter(event["eventType"] for event in events)),
            "eventsBySymbol": dict(Counter(event["symbol"] for event in events if event.get("symbol"))),
            "sourceFailures": [name for name, result in source_results.items() if not bool(result.get("ok"))],
            "nonLiveFallbacks": [
                name for name, result in source_results.items()
                if result.get("fallbackIsNotLive") is True
            ],
        },
        "safety": {
            "mode": "SHADOW_OBSERVATION_ONLY",
            "orderSubmissionAllowed": False,
            "entryDecisionChanged": False,
            "productionStrategyChanged": False,
            "currentV96WeightsMutable": False,
            "articleBodiesStored": False,
            "sentimentUsedForDirection": False,
        },
    }


def self_test() -> None:
    v2.self_test()
    payload = {"data": {"rows": [{"formType": "8-K", "filedDate": "07/22/2026"}]}}
    assert choose_filing_rows(payload)[0]["formType"] == "8-K"
    assert normalize_form("Form 8-K - current report") == "8-K"
    assert parse_datetime("07/22/2026") is not None
    now = dt.datetime(2026, 7, 23, 0, 0, tzinfo=base.UTC)
    frozen = frozen_bls_events(now)
    assert any(event["headline"].startswith("Employment Cost Index") for event in frozen)


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect stock event-risk evidence with explicit fallbacks.")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-event-ledger")
    parser.add_argument("--start-utc", default=base.os.environ.get("EVENT_LEDGER_START_UTC", base.DEFAULT_START_UTC))
    parser.add_argument("--end-utc", default=base.os.environ.get("EVENT_LEDGER_END_UTC", base.DEFAULT_END_UTC))
    parser.add_argument("--mode", choices=("fast", "full"), default="full")
    parser.add_argument("--ignore-window", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    self_test()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.self_test:
        (output_dir / "run-status.txt").write_text("self_test\n", encoding="utf-8")
        print("V96 stock event ledger v3 self-test: PASS")
        return 0

    now = base.utc_now()
    start = base.parse_utc(args.start_utc)
    end = base.parse_utc(args.end_utc)
    if not args.ignore_window and now < start:
        (output_dir / "run-status.txt").write_text("not_started\n", encoding="utf-8")
        return 0
    if not args.ignore_window and now >= end:
        (output_dir / "run-status.txt").write_text("expired\n", encoding="utf-8")
        (output_dir / "window.json").write_text(json.dumps({
            "status": "expired", "now": base.iso(now), "startUtc": base.iso(start), "endUtc": base.iso(end)
        }, indent=2), encoding="utf-8")
        return 0

    snapshot = collect_snapshot(args.mode, now)
    files = base.write_snapshot(snapshot, output_dir)
    print(json.dumps({
        "status": "collected",
        "mode": args.mode,
        "collectorVersion": COLLECTOR_VERSION,
        "events": snapshot["summary"]["eventCount"],
        "sourceFailures": snapshot["summary"]["sourceFailures"],
        "nonLiveFallbacks": snapshot["summary"]["nonLiveFallbacks"],
        "files": files,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
