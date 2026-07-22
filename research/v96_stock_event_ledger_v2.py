from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import time
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import v96_stock_event_ledger as base

COLLECTOR_VERSION = 2
BLS_HTML_URL = "https://www.bls.gov/schedule/2026/home.htm"

SEC_CIKS: Dict[str, int] = {
    "ADBEUSDT": 796343,
    "AMATUSDT": 6951,
    "AMDUSDT": 2488,
    "AMZNUSDT": 1018724,
    "ARMUSDT": 1973239,
    "ASMLUSDT": 937966,
    "AVGOUSDT": 1730168,
    "CRMUSDT": 1108524,
    "GOOGLUSDT": 1652044,
    "INTCUSDT": 50863,
    "METAUSDT": 1326801,
    "MRVLUSDT": 1835632,
    "MSFTUSDT": 789019,
    "MUUSDT": 723125,
    "NVDAUSDT": 1045810,
    "ORCLUSDT": 1341439,
    "PLTRUSDT": 1321655,
    "QCOMUSDT": 804328,
    "SNDKUSDT": 2023554,
    "TSLAUSDT": 1318605,
    "TSMUSDT": 1046179,
}

FOMC_2026: Tuple[Tuple[int, int, int], ...] = (
    (1, 27, 28),
    (3, 17, 18),
    (4, 28, 29),
    (6, 16, 17),
    (7, 28, 29),
    (9, 15, 16),
    (10, 27, 28),
    (12, 8, 9),
)


def parse_event_time(event: Dict[str, Any]) -> Optional[dt.datetime]:
    value = event.get("publishedAt") or event.get("effectiveAt")
    if not value:
        return None
    try:
        return base.parse_utc(str(value))
    except Exception:
        return None


def collect_google_news(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    events, meta = base.collect_google_news()
    lower = now - dt.timedelta(hours=36)
    upper = now + dt.timedelta(minutes=10)
    filtered: List[Dict[str, Any]] = []
    stale = 0
    no_risk = 0
    ambiguous = 0
    for event in events:
        event_time = parse_event_time(event)
        if event_time is None or event_time < lower or event_time > upper:
            stale += 1
            continue
        if not event.get("riskHints"):
            no_risk += 1
            continue
        headline = str(event.get("headline", ""))
        if event.get("symbol") == "METAUSDT" and not (
            "Meta Platforms" in headline
            or re.search(r"(?<![A-Z0-9])META(?![A-Z0-9])", headline)
        ):
            ambiguous += 1
            continue
        filtered.append(event)
    meta = dict(meta)
    meta.update({
        "recordsBeforeChronologyFilter": len(events),
        "records": len(filtered),
        "staleOrInvalidTimeRejected": stale,
        "noRiskKeywordRejected": no_risk,
        "ambiguousMappingRejected": ambiguous,
        "chronologyWindowHours": 36,
    })
    return filtered, meta


def collect_sec_filings(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    companies: List[Dict[str, Any]] = []
    cutoff = (now - dt.timedelta(days=4)).date()
    successes = 0
    for symbol, cik in SEC_CIKS.items():
        ticker = base.SYMBOLS[symbol].get("ticker")
        payload, meta = base.fetch_json(base.SEC_SUBMISSIONS_URL.format(cik=cik), headers=base.SEC_HEADERS)
        meta.update({"symbol": symbol, "ticker": ticker, "cik": cik})
        companies.append(meta)
        if not meta.get("ok") or not isinstance(payload, dict):
            continue
        successes += 1
        recent = payload.get("filings", {}).get("recent", {})
        forms = recent.get("form", []) if isinstance(recent, dict) else []
        accessions = recent.get("accessionNumber", [])
        filed = recent.get("filingDate", [])
        accepted = recent.get("acceptanceDateTime", [])
        documents = recent.get("primaryDocument", [])
        descriptions = recent.get("primaryDocDescription", [])
        count = min(len(forms), len(accessions), len(filed))
        for index in range(count):
            form = str(forms[index])
            if form not in base.SEC_FORMS:
                continue
            try:
                filing_date = dt.date.fromisoformat(str(filed[index]))
            except Exception:
                continue
            if filing_date < cutoff:
                continue
            accepted_at: Optional[dt.datetime] = None
            if index < len(accepted) and accepted[index]:
                try:
                    accepted_at = dt.datetime.fromisoformat(str(accepted[index]).replace("Z", "+00:00"))
                    if accepted_at.tzinfo is None:
                        accepted_at = accepted_at.replace(tzinfo=base.NY)
                    accepted_at = accepted_at.astimezone(base.UTC)
                except Exception:
                    accepted_at = None
            if accepted_at is None:
                accepted_at = dt.datetime.combine(filing_date, dt.time(0, 0), tzinfo=base.NY).astimezone(base.UTC)
            accession = str(accessions[index])
            document = str(documents[index]) if index < len(documents) else ""
            description = str(descriptions[index]) if index < len(descriptions) else ""
            compact = accession.replace("-", "")
            url = (
                f"https://www.sec.gov/Archives/edgar/data/{cik}/{compact}/{document}"
                if document else
                f"https://www.sec.gov/Archives/edgar/data/{cik}/{compact}/"
            )
            event_type, hints = base.sec_event_type(form)
            events.append(base.make_event(
                source="SEC_EDGAR_SUBMISSIONS",
                source_record_id=accession,
                symbol=symbol,
                event_type=event_type,
                headline=f"{ticker} filed {form}" + (f": {description}" if description else ""),
                published_at=accepted_at,
                url=url,
                risk_hints=hints,
                details={
                    "form": form,
                    "cik": cik,
                    "filingDate": filing_date.isoformat(),
                    "primaryDocument": document,
                    "cikSource": "frozen_universe_mapping",
                },
            ))
        time.sleep(0.12)
    return events, {
        "ok": successes >= len(SEC_CIKS) - 3,
        "records": len(events),
        "successfulCompanies": successes,
        "expectedCompanies": len(SEC_CIKS),
        "companies": companies,
        "tickerMapDependencyRemoved": True,
    }


def parse_bls_html(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload, meta = base.fetch_bytes(BLS_HTML_URL, headers=base.DEFAULT_HEADERS)
    events: List[Dict[str, Any]] = []
    if not meta.get("ok"):
        return events, meta
    parser = base.TableExtractor()
    parser.feed(payload.decode("utf-8", errors="replace"))
    lower = now - dt.timedelta(days=1)
    upper = now + dt.timedelta(days=21)
    for cells in parser.rows:
        if len(cells) < 3:
            continue
        date_text, time_text = cells[0], cells[1]
        summary = " | ".join(cells[2:])
        if not any(keyword.lower() in summary.lower() for keyword in base.HIGH_IMPACT_BLS):
            continue
        parsed_date: Optional[dt.datetime] = None
        for fmt in ("%A, %B %d, %Y", "%B %d, %Y", "%m/%d/%Y"):
            try:
                parsed_date = dt.datetime.strptime(date_text.strip(), fmt)
                break
            except ValueError:
                continue
        if parsed_date is None:
            continue
        try:
            parsed_time = dt.datetime.strptime(time_text.strip().upper().replace(" ", ""), "%I:%M%p").time()
        except ValueError:
            continue
        effective = dt.datetime(
            parsed_date.year,
            parsed_date.month,
            parsed_date.day,
            parsed_time.hour,
            parsed_time.minute,
            tzinfo=base.NY,
        ).astimezone(base.UTC)
        if not (lower <= effective <= upper):
            continue
        events.append(base.make_event(
            source="BLS_OFFICIAL_HTML",
            source_record_id=f"BLS:{base.iso(effective)}:{summary}",
            event_type="MACRO_RELEASE_SCHEDULED",
            headline=summary,
            effective_at=effective,
            scheduled=True,
            url=BLS_HTML_URL,
            risk_hints=["MACRO_EVENT"],
        ))
    meta["records"] = len(events)
    meta["sourceSha256"] = hashlib.sha256(payload).hexdigest()
    return events, meta


def collect_bls_calendar(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    events, ics_meta = base.collect_bls_calendar(now)
    if ics_meta.get("ok"):
        return events, ics_meta
    html_events, html_meta = parse_bls_html(now)
    return html_events, {
        "ok": bool(html_meta.get("ok")),
        "records": len(html_events),
        "primaryIcs": ics_meta,
        "fallbackHtml": html_meta,
        "fallbackUsed": True,
    }


def collect_fomc_calendar(now: dt.datetime) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    payload, meta = base.fetch_bytes(base.FOMC_URL, headers=base.DEFAULT_HEADERS)
    events: List[Dict[str, Any]] = []
    source_hash = hashlib.sha256(payload).hexdigest() if payload else None
    for month, start_day, end_day in FOMC_2026:
        effective = dt.datetime(2026, month, end_day, 14, 0, tzinfo=base.NY).astimezone(base.UTC)
        if now - dt.timedelta(days=2) <= effective <= now + dt.timedelta(days=60):
            events.append(base.make_event(
                source="FEDERAL_RESERVE_FOMC_CALENDAR",
                source_record_id=f"FOMC-2026-{month:02d}-{end_day:02d}",
                event_type="FOMC_MEETING_DECISION_WINDOW",
                headline=f"FOMC meeting {2026}-{month:02d}-{start_day:02d} through {2026}-{month:02d}-{end_day:02d}",
                effective_at=effective,
                scheduled=True,
                url=base.FOMC_URL,
                risk_hints=["MACRO_EVENT"],
                details={
                    "meetingStartDay": start_day,
                    "meetingEndDay": end_day,
                    "decisionTimeAssumedET": "14:00",
                    "scheduleBasis": "official_2026_calendar_frozen_for_current_forward",
                    "sourceSha256": source_hash,
                },
            ))
    meta = dict(meta)
    meta.update({
        "records": len(events),
        "sourceSha256": source_hash,
        "overExtractionPrevented": True,
    })
    return events, meta


def collect_snapshot(mode: str, now: dt.datetime) -> Dict[str, Any]:
    all_events: List[Dict[str, Any]] = []
    source_results: Dict[str, Any] = {}

    news_events, news_meta = collect_google_news(now)
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

        fomc_events, fomc_meta = collect_fomc_calendar(now)
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
    base.self_test()
    now = dt.datetime(2026, 7, 23, 0, 0, tzinfo=base.UTC)
    recent = base.make_event(
        source="GOOGLE_NEWS_RSS",
        symbol="NVDAUSDT",
        event_type="COMPANY_NEWS_HEADLINE",
        headline="NVIDIA earnings guidance",
        published_at=now - dt.timedelta(hours=1),
    )
    stale = dict(recent)
    stale["eventId"] = "stale"
    stale["publishedAt"] = base.iso(now - dt.timedelta(days=10))
    assert parse_event_time(recent) is not None
    assert parse_event_time(stale) is not None
    assert SEC_CIKS["NVDAUSDT"] == 1045810
    assert len(FOMC_2026) == 8


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect corrected immutable stock event-risk evidence.")
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
        print("V96 stock event ledger v2 self-test: PASS")
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
            "status": "expired",
            "now": base.iso(now),
            "startUtc": base.iso(start),
            "endUtc": base.iso(end),
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
        "files": files,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
