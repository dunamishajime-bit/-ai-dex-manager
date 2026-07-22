from __future__ import annotations

import argparse
import datetime as dt
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Tuple

import v96_stock_event_ledger as base
import v96_stock_event_ledger_v2 as v2
import v96_stock_event_ledger_v3 as v3

COLLECTOR_VERSION = 4

# Point-in-time fallback captured from the official BEA release schedule before
# this Forward window. It is explicitly marked non-live when used.
BEA_FROZEN_SCHEDULE: Tuple[Tuple[str, str], ...] = (
    ("2026-07-30T08:30:00", "GDP (Advance Estimate), 2nd Quarter 2026"),
    ("2026-07-30T08:30:00", "Personal Income and Outlays, June 2026"),
    ("2026-08-04T08:30:00", "U.S. International Trade in Goods and Services, June 2026"),
)


def frozen_bea_events(now: dt.datetime) -> List[Dict[str, Any]]:
    lower = now - dt.timedelta(days=1)
    upper = now + dt.timedelta(days=21)
    events: List[Dict[str, Any]] = []
    for local_text, headline in BEA_FROZEN_SCHEDULE:
        local = dt.datetime.fromisoformat(local_text).replace(tzinfo=base.NY)
        effective = local.astimezone(base.UTC)
        if not (lower <= effective <= upper):
            continue
        events.append(base.make_event(
            source="BEA_OFFICIAL_SCHEDULE_FROZEN",
            source_record_id=f"BEA:{headline}:{base.iso(effective)}",
            event_type="MACRO_RELEASE_SCHEDULED",
            headline=headline,
            effective_at=effective,
            scheduled=True,
            url=base.BEA_SCHEDULE_URL,
            risk_hints=["MACRO_EVENT"],
            details={
                "sourceMode": "frozen_point_in_time_official_schedule",
                "frozenBeforeForwardUse": True,
                "liveFetchRepresented": False,
            },
        ))
    return events


def collect_bea_calendar(now: dt.datetime):
    live_events, live_meta = base.collect_bea_calendar(now)
    if live_meta.get("ok"):
        return live_events, {
            "ok": True,
            "records": len(live_events),
            "live": live_meta,
            "fallbackUsed": False,
            "sourceMode": "bea_official_live",
        }
    events = frozen_bea_events(now)
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
        sec_events, sec_meta = v3.collect_sec_filings(now)
        all_events.extend(sec_events)
        source_results["secEdgar"] = sec_meta

        earnings_events, earnings_meta = base.collect_nasdaq_earnings(now)
        all_events.extend(earnings_events)
        source_results["nasdaqEarnings"] = earnings_meta

        bls_events, bls_meta = v3.collect_bls_calendar(now)
        all_events.extend(bls_events)
        source_results["blsCalendar"] = bls_meta

        fomc_events, fomc_meta = v2.collect_fomc_calendar(now)
        all_events.extend(fomc_events)
        source_results["fomcCalendar"] = fomc_meta

        bea_events, bea_meta = collect_bea_calendar(now)
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
            "nonLiveFallbacks": [name for name, result in source_results.items() if result.get("fallbackIsNotLive") is True],
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
    v3.self_test()
    now = dt.datetime(2026, 7, 23, 0, 0, tzinfo=base.UTC)
    events = frozen_bea_events(now)
    assert len(events) == 3
    assert any(event["headline"].startswith("GDP") for event in events)


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect stock event-risk evidence with resilient macro fallbacks.")
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
        print("V96 stock event ledger v4 self-test: PASS")
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
