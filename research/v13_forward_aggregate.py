from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import math
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

UTC = dt.timezone.utc


def parse_iso(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def iso(value: dt.datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return payload


def config_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_events(path: Path) -> Iterable[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSONL {path}:{line_number}: {exc}") from exc
            if isinstance(row, dict):
                yield row


def discover_chunks(input_dir: Path) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    if not input_dir.exists():
        return chunks
    for meta_path in sorted(input_dir.rglob("chunk.json")):
        chunk_dir = meta_path.parent
        meta = load_json(meta_path)
        result_path = chunk_dir / "result.json"
        events_path = chunk_dir / "v13-events.jsonl.gz"
        result = load_json(result_path) if result_path.exists() else None
        chunks.append(
            {
                "dir": chunk_dir,
                "metaPath": meta_path,
                "resultPath": result_path,
                "eventsPath": events_path,
                "meta": meta,
                "result": result,
            }
        )
    return chunks


def is_quality_eligible(chunk: dict[str, Any], universe: list[str]) -> bool:
    meta, result = chunk["meta"], chunk["result"]
    if result is None or not chunk["eventsPath"].exists():
        return False
    if int(meta.get("collectorExitCode", 1)) != 0:
        return False
    coverage = result.get("coverage", {})
    if sorted(coverage.get("completeSymbols", [])) != sorted(universe):
        return False
    if int(coverage.get("collectorErrors", 0) or 0) != 0:
        return False
    safety = result.get("safety", {})
    return safety.get("orderSubmissionAllowed") is False


def choose_canonical_chunks(
    chunks: list[dict[str, Any]], config: dict[str, Any]
) -> tuple[dict[tuple[str, str], dict[str, Any]], list[dict[str, Any]]]:
    allowed_dates = set(config["sessionDates"])
    allowed_segments = set(config["segments"])
    universe = list(config["universe"])
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    ignored: list[dict[str, Any]] = []
    for chunk in chunks:
        meta = chunk["meta"]
        key = (str(meta.get("sessionDate")), str(meta.get("segment")))
        if key[0] not in allowed_dates or key[1] not in allowed_segments:
            ignored.append(
                {
                    "path": str(chunk["dir"]),
                    "reason": "OUTSIDE_FROZEN_WINDOW_OR_SEGMENT",
                    "sessionDate": key[0],
                    "segment": key[1],
                }
            )
            continue
        grouped[key].append(chunk)

    canonical: dict[tuple[str, str], dict[str, Any]] = {}
    for key, attempts in grouped.items():
        attempts.sort(
            key=lambda item: (
                str(item["meta"].get("startedAtUtc", "")),
                str(item["meta"].get("runId", "")),
            )
        )
        eligible = [item for item in attempts if is_quality_eligible(item, universe)]
        if eligible:
            canonical[key] = eligible[0]
            for item in attempts:
                if item is not eligible[0]:
                    ignored.append(
                        {
                            "path": str(item["dir"]),
                            "reason": (
                                "LATER_DUPLICATE_NOT_SELECTED"
                                if is_quality_eligible(item, universe)
                                else "DATA_QUALITY_ATTEMPT_NOT_SELECTED"
                            ),
                            "sessionDate": key[0],
                            "segment": key[1],
                        }
                    )
        else:
            for item in attempts:
                ignored.append(
                    {
                        "path": str(item["dir"]),
                        "reason": "NO_QUALITY_ELIGIBLE_ATTEMPT",
                        "sessionDate": key[0],
                        "segment": key[1],
                    }
                )
    return canonical, ignored


def scenario_metrics(
    cycles: list[dict[str, Any]],
    costs: dict[str, Any],
    universe: list[str],
) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for scenario, scenario_costs in costs.items():
        rows: list[float] = []
        by_symbol = {symbol: 0.0 for symbol in universe}
        profiles = Counter()
        for cycle in cycles:
            gross = finite(cycle.get("grossBps"))
            symbol = str(cycle.get("symbol", ""))
            profile = str(cycle.get("profile", ""))
            if gross is None or symbol not in by_symbol:
                continue
            if profile == "MAKER_CYCLE":
                cost = float(scenario_costs["twoMakerCycle"])
            elif profile == "FORCED_TAKER":
                cost = float(scenario_costs["forcedTakerCycle"])
            else:
                continue
            net = gross - cost
            rows.append(net)
            by_symbol[symbol] += net
            profiles[profile] += 1
        positive_total = sum(max(0.0, value) for value in by_symbol.values())
        max_share = (
            max((max(0.0, value) for value in by_symbol.values()), default=0.0)
            / positive_total
            if positive_total > 0
            else None
        )
        output[scenario] = {
            "completedCycles": len(rows),
            "makerCycles": profiles["MAKER_CYCLE"],
            "forcedTakerCycles": profiles["FORCED_TAKER"],
            "averageNetBps": sum(rows) / len(rows) if rows else None,
            "totalNetBps": sum(rows),
            "positiveNetRate": (
                sum(value > 0 for value in rows) / len(rows) if rows else None
            ),
            "minimumNetBps": min(rows) if rows else None,
            "maximumNetBps": max(rows) if rows else None,
            "bySymbolNetBps": by_symbol,
            "maxPositiveProfitContributionShare": max_share,
            "twoMakerCycleCostBps": float(scenario_costs["twoMakerCycle"]),
            "forcedTakerCycleCostBps": float(scenario_costs["forcedTakerCycle"]),
        }
    return output


def evaluate(
    config: dict[str, Any],
    config_sha256: str,
    chunks: list[dict[str, Any]],
    as_of: dt.datetime,
) -> dict[str, Any]:
    canonical, ignored = choose_canonical_chunks(chunks, config)
    required_dates = list(config["sessionDates"])
    required_segments = list(config["segments"])
    complete_sessions: list[str] = []
    session_rows: list[dict[str, Any]] = []
    cycles: list[dict[str, Any]] = []
    safety = Counter()
    coverage_totals = Counter()
    cancellation_totals = Counter()

    for session_date in required_dates:
        present = []
        for segment in required_segments:
            chunk = canonical.get((session_date, segment))
            if chunk is None:
                continue
            present.append(segment)
            result = chunk["result"]
            execution = result.get("virtualExecution", {})
            coverage = result.get("coverage", {})
            coverage_totals["asterBooks"] += int(coverage.get("asterBooks", 0) or 0)
            coverage_totals["xyzBooks"] += int(coverage.get("xyzBooks", 0) or 0)
            coverage_totals["asterTrades"] += int(coverage.get("asterTrades", 0) or 0)
            coverage_totals["xyzTrades"] += int(coverage.get("xyzTrades", 0) or 0)
            safety["partialFillFailures"] += int(execution.get("partialFillFailures", 0) or 0)
            safety["unhedgedRejected"] += int(execution.get("unhedgedRejected", 0) or 0)
            safety["unresolvedInventory"] += int(execution.get("unresolvedInventory", 0) or 0)
            safety["unresolvedCloseAttempts"] += int(execution.get("unresolvedCloseAttempts", 0) or 0)
            safety["pendingHedgesAtEnd"] += int(execution.get("pendingHedges", 0) or 0)
            safety["openInventoriesAtEnd"] += int(execution.get("openInventories", 0) or 0)
            for reason, count in execution.get("cancellations", {}).items():
                cancellation_totals[str(reason)] += int(count or 0)
            for row in read_events(chunk["eventsPath"]):
                if row.get("recordType") == "virtual_cycle_complete":
                    cycle = dict(row)
                    cycle["_sessionDate"] = session_date
                    cycle["_segment"] = segment
                    cycle["_runId"] = chunk["meta"].get("runId")
                    cycles.append(cycle)
        complete = sorted(present) == sorted(required_segments)
        if complete:
            complete_sessions.append(session_date)
        session_rows.append(
            {
                "sessionDate": session_date,
                "segmentsPresent": sorted(present),
                "complete": complete,
            }
        )

    scenarios = scenario_metrics(cycles, config["costBps"], list(config["universe"]))
    gate = config["reviewGate"]
    final_close = parse_iso(f"{required_dates[-1]}T20:10:00Z")
    collection_window_finished = as_of >= final_close
    coverage_pass = len(complete_sessions) == int(gate["requiredCompleteSessions"])
    safety_pass = (
        safety["partialFillFailures"] <= int(gate["maximumPartialFillFailures"])
        and safety["unhedgedRejected"] <= int(gate["maximumUnhedgedHedgeFailures"])
        and safety["unresolvedInventory"] <= int(gate["maximumUnresolvedEndingInventory"])
        and safety["pendingHedgesAtEnd"] == 0
        and safety["openInventoriesAtEnd"] == 0
    )
    cycle_pass = len(cycles) >= int(gate["minimumCompletedCycles"])
    normal = scenarios["NORMAL"]
    p95 = scenarios["P95"]
    severe = scenarios["SEVERE"]
    performance_pass = (
        normal["averageNetBps"] is not None
        and normal["averageNetBps"] > 0
        and p95["averageNetBps"] is not None
        and p95["averageNetBps"] > 0
        and severe["averageNetBps"] is not None
        and severe["averageNetBps"] > 0
        and normal["positiveNetRate"] is not None
        and normal["positiveNetRate"] >= float(gate["minimumNormalPositiveNetRate"])
        and normal["maxPositiveProfitContributionShare"] is not None
        and normal["maxPositiveProfitContributionShare"] <= float(gate["maximumSingleSymbolPositiveProfitShare"])
    )

    if not collection_window_finished:
        status = "V13_FORWARD_COLLECTION_IN_PROGRESS"
    elif not coverage_pass:
        status = "V13_FORWARD_COVERAGE_INCOMPLETE"
    elif not safety_pass:
        status = "V13_FORWARD_EXECUTION_SAFETY_FAILED"
    elif not cycle_pass:
        status = "V13_FORWARD_INSUFFICIENT_COMPLETED_CYCLES"
    elif not performance_pass:
        status = "V13_FORWARD_PERFORMANCE_FAILED"
    else:
        status = str(gate["passingStatus"])

    return {
        "strategyId": config["strategyId"],
        "status": status,
        "generatedAt": iso(as_of),
        "configSha256": config_sha256,
        "sourceCommit": config["sourceCommit"],
        "window": {
            "firstSession": required_dates[0],
            "lastSession": required_dates[-1],
            "requiredSessions": len(required_dates),
            "completeSessions": len(complete_sessions),
            "completeSessionDates": complete_sessions,
            "collectionWindowFinished": collection_window_finished,
        },
        "sessions": session_rows,
        "coverage": dict(coverage_totals),
        "executionSafety": {
            **dict(safety),
            "cancellations": dict(cancellation_totals),
            "passed": safety_pass,
        },
        "cycles": {
            "completed": len(cycles),
            "minimumRequired": int(gate["minimumCompletedCycles"]),
            "passed": cycle_pass,
        },
        "costScenarios": scenarios,
        "gates": {
            "coveragePassed": coverage_pass,
            "executionSafetyPassed": safety_pass,
            "minimumCyclesPassed": cycle_pass,
            "performancePassed": performance_pass,
            "retuningAllowed": False,
            "productionOrLiveAuthorized": False,
        },
        "canonicalChunks": [
            {
                "sessionDate": key[0],
                "segment": key[1],
                "path": str(value["dir"]),
                "runId": value["meta"].get("runId"),
                "startedAtUtc": value["meta"].get("startedAtUtc"),
            }
            for key, value in sorted(canonical.items())
        ],
        "ignoredAttempts": ignored,
        "safety": config["safety"],
    }


def fmt(value: Any, digits: int = 4) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, bool):
        return "YES" if value else "NO"
    if isinstance(value, (int, float)):
        return f"{value:.{digits}f}"
    return str(value)


def render_report(result: dict[str, Any]) -> str:
    lines = [
        "# V13 Maker Hedge Fixed Forward Report",
        "",
        f"**Status: `{result['status']}`**",
        "",
        f"- Generated: {result['generatedAt']}",
        f"- Frozen source commit: `{result['sourceCommit']}`",
        f"- Frozen config SHA-256: `{result['configSha256']}`",
        f"- Complete sessions: {result['window']['completeSessions']} / {result['window']['requiredSessions']}",
        f"- Completed hedged cycles: {result['cycles']['completed']} / {result['cycles']['minimumRequired']}",
        "",
        "## Cost scenarios",
        "",
        "| Scenario | Cycles | Maker | Forced | Avg net bps | Positive rate | Max symbol share |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name in ("FORWARD_MEDIAN", "NORMAL", "P95", "SEVERE"):
        row = result["costScenarios"][name]
        lines.append(
            "| {name} | {cycles} | {maker} | {forced} | {avg} | {positive} | {share} |".format(
                name=name,
                cycles=row["completedCycles"],
                maker=row["makerCycles"],
                forced=row["forcedTakerCycles"],
                avg=fmt(row["averageNetBps"]),
                positive=fmt(row["positiveNetRate"]),
                share=fmt(row["maxPositiveProfitContributionShare"]),
            )
        )
    lines += [
        "",
        "## Safety",
        "",
        f"- Partial-fill safety failures: {result['executionSafety'].get('partialFillFailures', 0)}",
        f"- Unhedged hedge failures: {result['executionSafety'].get('unhedgedRejected', 0)}",
        f"- Unresolved ending inventory: {result['executionSafety'].get('unresolvedInventory', 0)}",
        f"- Pending hedges at chunk end: {result['executionSafety'].get('pendingHedgesAtEnd', 0)}",
        f"- Open inventories at chunk end: {result['executionSafety'].get('openInventoriesAtEnd', 0)}",
        "",
        "## Session coverage",
        "",
        "| Session | Segments | Complete |",
        "| --- | --- | --- |",
    ]
    for row in result["sessions"]:
        lines.append(
            f"| {row['sessionDate']} | {', '.join(row['segmentsPresent']) or 'NONE'} | {'YES' if row['complete'] else 'NO'} |"
        )
    lines += [
        "",
        "## Interpretation",
        "",
        "- This report uses only the earliest data-quality-eligible attempt for each frozen session segment.",
        "- Later duplicate attempts are excluded before any PnL inspection.",
        "- Missing sessions are not replaced by later dates.",
        "- Passing authorizes only a longer Paper/Shadow review.",
        "- Production, LIVE and real orders remain unauthorized.",
        "",
    ]
    return "\n".join(lines)


def write_outputs(result: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "aggregate-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "aggregate-report.md").write_text(render_report(result), encoding="utf-8")


def self_test() -> None:
    config = {
        "strategyId": "TEST",
        "sourceCommit": "abc",
        "sessionDates": [
            (dt.date(2026, 1, 5) + dt.timedelta(days=index)).isoformat()
            for index in range(20)
        ],
        "segments": {"OPEN_CORE": {}, "LATE_CLOSE": {}},
        "universe": ["AMZN", "META", "MSFT", "NVDA", "TSLA"],
        "costBps": {
            "FORWARD_MEDIAN": {"twoMakerCycle": 6, "forcedTakerCycle": 10},
            "NORMAL": {"twoMakerCycle": 10, "forcedTakerCycle": 16},
            "P95": {"twoMakerCycle": 17, "forcedTakerCycle": 26},
            "SEVERE": {"twoMakerCycle": 30, "forcedTakerCycle": 45},
        },
        "reviewGate": {
            "requiredCompleteSessions": 20,
            "minimumCompletedCycles": 100,
            "minimumNormalPositiveNetRate": 0.55,
            "maximumSingleSymbolPositiveProfitShare": 0.40,
            "maximumPartialFillFailures": 0,
            "maximumUnhedgedHedgeFailures": 0,
            "maximumUnresolvedEndingInventory": 0,
            "passingStatus": "PASS",
        },
        "safety": {"orderSubmissionAllowed": False},
    }
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for date_index, session_date in enumerate(config["sessionDates"]):
            for segment in config["segments"]:
                chunk = root / session_date / segment / "1"
                chunk.mkdir(parents=True)
                meta = {
                    "sessionDate": session_date,
                    "segment": segment,
                    "runId": f"{date_index}-{segment}",
                    "startedAtUtc": f"{session_date}T13:25:00Z",
                    "collectorExitCode": 0,
                }
                result = {
                    "coverage": {"completeSymbols": config["universe"], "collectorErrors": 0},
                    "safety": {"orderSubmissionAllowed": False},
                    "virtualExecution": {
                        "partialFillFailures": 0,
                        "unhedgedRejected": 0,
                        "unresolvedInventory": 0,
                        "pendingHedges": 0,
                        "openInventories": 0,
                    },
                }
                (chunk / "chunk.json").write_text(json.dumps(meta))
                (chunk / "result.json").write_text(json.dumps(result))
                rows = []
                if segment == "OPEN_CORE":
                    for cycle_index in range(5):
                        rows.append(
                            {
                                "recordType": "virtual_cycle_complete",
                                "symbol": config["universe"][(date_index + cycle_index) % 5],
                                "profile": "MAKER_CYCLE",
                                "grossBps": 50.0,
                            }
                        )
                with gzip.open(chunk / "v13-events.jsonl.gz", "wt", encoding="utf-8") as handle:
                    for row in rows:
                        handle.write(json.dumps(row) + "\n")
        evaluated = evaluate(
            config,
            "test",
            discover_chunks(root),
            dt.datetime(2026, 2, 1, tzinfo=UTC),
        )
        assert evaluated["status"] == "PASS", evaluated["status"]
        assert evaluated["cycles"]["completed"] == 100
        assert evaluated["window"]["completeSessions"] == 20
        assert evaluated["gates"]["performancePassed"] is True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=False)
    parser.add_argument("--input-dir", required=False)
    parser.add_argument("--output-dir", required=False)
    parser.add_argument("--as-of", required=False)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print("V13 Forward aggregate self-test: PASS")
        return 0
    if not args.config or not args.input_dir or not args.output_dir:
        parser.error("--config, --input-dir and --output-dir are required")
    config_path = Path(args.config)
    config = load_json(config_path)
    as_of = parse_iso(args.as_of) if args.as_of else dt.datetime.now(UTC)
    result = evaluate(
        config,
        config_digest(config_path),
        discover_chunks(Path(args.input_dir)),
        as_of,
    )
    write_outputs(result, Path(args.output_dir))
    print(
        json.dumps(
            {
                "strategyId": result["strategyId"],
                "status": result["status"],
                "completeSessions": result["window"]["completeSessions"],
                "completedCycles": result["cycles"]["completed"],
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
