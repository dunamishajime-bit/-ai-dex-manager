from __future__ import annotations

import argparse
import gzip
import json
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Set

EXPECTED_SYMBOLS = {
    "ADBEUSDT", "AMATUSDT", "AMDUSDT", "AMZNUSDT", "ARMUSDT", "ASMLUSDT",
    "AVGOUSDT", "CRMUSDT", "DRAMUSDT", "GOOGLUSDT", "INTCUSDT", "METAUSDT",
    "MRVLUSDT", "MSFTUSDT", "MUUSDT", "NVDAUSDT", "ORCLUSDT", "PLTRUSDT",
    "QCOMUSDT", "SNDKUSDT", "TSLAUSDT", "TSMUSDT",
}
FAST_SOURCES = {"googleNewsRss", "nasdaqTradeHalts", "asterExchangeInfo"}
SLOW_SOURCES = {"secEdgar", "nasdaqEarnings", "blsCalendar", "fomcCalendar", "beaCalendar"}
FORBIDDEN_TEXT_KEYS = {"body", "content", "articleText", "fullText", "articleBody"}


def read_gzip_json(path: Path) -> Dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} did not contain an object")
    return payload


def nested_forbidden_keys(value: Any) -> Set[str]:
    found: Set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key in FORBIDDEN_TEXT_KEYS:
                found.add(key)
            found |= nested_forbidden_keys(item)
    elif isinstance(value, list):
        for item in value:
            found |= nested_forbidden_keys(item)
    return found


def analyze(input_dir: Path) -> Dict[str, Any]:
    paths = sorted(input_dir.rglob("event-ledger-*.json.gz"))
    snapshots: List[Dict[str, Any]] = []
    parse_errors: List[str] = []
    for path in paths:
        try:
            snapshots.append(read_gzip_json(path))
        except Exception as exc:
            parse_errors.append(f"{path.name}: {type(exc).__name__}: {exc}")

    source_attempts: Counter[str] = Counter()
    source_successes: Counter[str] = Counter()
    modes: Counter[str] = Counter()
    event_observations = 0
    unique_events: Dict[str, Dict[str, Any]] = {}
    event_seen: Dict[str, List[str]] = defaultdict(list)
    events_by_source: Counter[str] = Counter()
    events_by_type: Counter[str] = Counter()
    events_by_symbol: Counter[str] = Counter()
    risk_hints: Counter[str] = Counter()
    missing_time_events: List[str] = []
    forbidden_keys: Set[str] = set()
    safety_failures: List[str] = []
    universe_failures: List[str] = []

    for index, snapshot in enumerate(snapshots):
        fetched_at = str(snapshot.get("fetchedAt", ""))
        mode = str(snapshot.get("mode", "unknown"))
        modes[mode] += 1
        observed = set(snapshot.get("symbolUniverse", []))
        if observed != EXPECTED_SYMBOLS:
            universe_failures.append(f"snapshot {index}: expected 22 symbols, got {len(observed)}")
        safety = snapshot.get("safety", {}) if isinstance(snapshot.get("safety"), dict) else {}
        if not (
            safety.get("mode") == "SHADOW_OBSERVATION_ONLY"
            and safety.get("orderSubmissionAllowed") is False
            and safety.get("entryDecisionChanged") is False
            and safety.get("productionStrategyChanged") is False
            and safety.get("currentV96WeightsMutable") is False
            and safety.get("articleBodiesStored") is False
            and safety.get("sentimentUsedForDirection") is False
        ):
            safety_failures.append(f"snapshot {index}: safety flags failed")

        source_results = snapshot.get("sourceResults", {})
        if isinstance(source_results, dict):
            for source, result in source_results.items():
                source_attempts[source] += 1
                if isinstance(result, dict) and result.get("ok"):
                    source_successes[source] += 1

        events = snapshot.get("events", [])
        if not isinstance(events, list):
            continue
        event_observations += len(events)
        for event in events:
            if not isinstance(event, dict):
                continue
            event_id = str(event.get("eventId", ""))
            if not event_id:
                continue
            unique_events.setdefault(event_id, event)
            event_seen[event_id].append(fetched_at)
            events_by_source[str(event.get("source", "UNKNOWN"))] += 1
            events_by_type[str(event.get("eventType", "UNKNOWN"))] += 1
            if event.get("symbol"):
                events_by_symbol[str(event["symbol"])] += 1
            for hint in event.get("riskHints", []) if isinstance(event.get("riskHints"), list) else []:
                risk_hints[str(hint)] += 1
            if not event.get("publishedAt") and not event.get("effectiveAt"):
                if str(event.get("eventType", "")).startswith("ASTER_CONTRACT"):
                    pass
                else:
                    missing_time_events.append(event_id)
            forbidden_keys |= nested_forbidden_keys(event)

    source_success_pct = {
        source: (source_successes[source] / attempts * 100.0 if attempts else 0.0)
        for source, attempts in sorted(source_attempts.items())
    }
    full_snapshots = modes.get("full", 0)
    fast_covered = all(source_successes[source] > 0 for source in FAST_SOURCES)
    slow_success_count = sum(source_successes[source] > 0 for source in SLOW_SOURCES)
    quality_pass = bool(
        snapshots
        and not parse_errors
        and not safety_failures
        and not universe_failures
        and not forbidden_keys
        and fast_covered
        and full_snapshots >= 1
        and slow_success_count >= 3
    )

    first_seen_rows = []
    for event_id, event in unique_events.items():
        seen = sorted(timestamp for timestamp in event_seen[event_id] if timestamp)
        first_seen_rows.append({
            "eventId": event_id,
            "source": event.get("source"),
            "symbol": event.get("symbol"),
            "eventType": event.get("eventType"),
            "headline": event.get("headline"),
            "publishedAt": event.get("publishedAt"),
            "effectiveAt": event.get("effectiveAt"),
            "firstFetchedAt": seen[0] if seen else None,
            "lastFetchedAt": seen[-1] if seen else None,
            "observationCount": len(seen),
            "riskHints": event.get("riskHints", []),
        })
    first_seen_rows.sort(key=lambda row: (row.get("firstFetchedAt") or "", row["eventId"]))

    return {
        "status": "STOCK_EVENT_LEDGER_QUALITY_PASS" if quality_pass else "STOCK_EVENT_LEDGER_INCOMPLETE_OR_FAIL",
        "dataQualityPass": quality_pass,
        "input": {
            "files": len(paths),
            "snapshots": len(snapshots),
            "modes": dict(modes),
            "eventObservations": event_observations,
            "uniqueEvents": len(unique_events),
            "parseErrors": parse_errors,
        },
        "sources": {
            "attempts": dict(source_attempts),
            "successes": dict(source_successes),
            "successPct": source_success_pct,
            "fastSourcesCovered": fast_covered,
            "slowSourcesSucceeded": slow_success_count,
        },
        "events": {
            "bySource": dict(events_by_source),
            "byType": dict(events_by_type),
            "bySymbol": dict(events_by_symbol),
            "riskHints": dict(risk_hints),
            "missingPublishedOrEffectiveTime": sorted(set(missing_time_events)),
            "firstSeen": first_seen_rows,
        },
        "safety": {
            "safetyFailures": safety_failures,
            "universeFailures": universe_failures,
            "forbiddenArticleTextKeys": sorted(forbidden_keys),
            "entryDecisionChanged": False,
            "productionStrategyChanged": False,
            "mode": "SHADOW_OBSERVATION_ONLY",
        },
        "interpretation": {
            "allowedConclusion": "Event-source availability, timestamp chronology, revision history, and later Baseline-versus-Overlay analysis only.",
            "forbiddenConclusion": "This ledger alone cannot select trade direction, prove an edge, approve Production, or alter current V96 entries.",
            "currentSevenDayBaselineMutable": False,
            "eventGateActive": False,
        },
    }


def write_report(result: Dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "v96-stock-event-ledger-quality.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = [
        "# V96 Stock Event Ledger quality",
        "",
        f"Status: **{result['status']}**",
        "",
        f"- immutable files: {result['input']['files']}",
        f"- snapshots: {result['input']['snapshots']}",
        f"- event observations: {result['input']['eventObservations']}",
        f"- unique events: {result['input']['uniqueEvents']}",
        f"- fast source coverage: {result['sources']['fastSourcesCovered']}",
        f"- successful slow sources: {result['sources']['slowSourcesSucceeded']} / {len(SLOW_SOURCES)}",
        f"- forbidden article-body fields: {len(result['safety']['forbiddenArticleTextKeys'])}",
        "",
        "The ledger is observation-only. It does not change Entry decisions, Production, LIVE, VPS, orders, or V96 weights.",
    ]
    (output_dir / "v96-stock-event-ledger-quality.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def self_test() -> None:
    snapshot = {
        "fetchedAt": "2026-07-23T00:00:00Z",
        "mode": "full",
        "symbolUniverse": sorted(EXPECTED_SYMBOLS),
        "sourceResults": {
            "googleNewsRss": {"ok": True},
            "nasdaqTradeHalts": {"ok": True},
            "asterExchangeInfo": {"ok": True},
            "secEdgar": {"ok": True},
            "nasdaqEarnings": {"ok": True},
            "blsCalendar": {"ok": True},
            "fomcCalendar": {"ok": False},
            "beaCalendar": {"ok": False},
        },
        "events": [{
            "eventId": "x",
            "source": "SEC_EDGAR_SUBMISSIONS",
            "symbol": "NVDAUSDT",
            "eventType": "SEC_MATERIAL_FILING",
            "headline": "NVDA filed 8-K",
            "publishedAt": "2026-07-23T00:00:00Z",
            "effectiveAt": None,
            "riskHints": ["EARNINGS"],
            "details": {},
        }],
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
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "event-ledger-test.json.gz"
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            json.dump(snapshot, handle)
        result = analyze(Path(temporary))
        assert result["dataQualityPass"]
        assert result["input"]["uniqueEvents"] == 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default=".research-state/v96-stock-event-ledger")
    parser.add_argument("--output-dir", default=".research-state/v96-stock-event-ledger-report")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V96 stock event ledger validator self-test: PASS")
        return 0
    result = analyze(Path(args.input_dir).resolve())
    write_report(result, Path(args.output_dir).resolve())
    print(json.dumps({
        "status": result["status"],
        "snapshots": result["input"]["snapshots"],
        "uniqueEvents": result["input"]["uniqueEvents"],
        "sourceSuccessPct": result["sources"]["successPct"],
    }, ensure_ascii=False))
    return 0 if result["dataQualityPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
