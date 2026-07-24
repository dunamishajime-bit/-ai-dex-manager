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
from typing import Any
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
NY = ZoneInfo("America/New_York")


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected object: {path}")
    return payload


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


def read_events(path: Path) -> list[dict[str, Any]]:
    rows = []
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
                rows.append(row)
    return rows


def choose_candidate(candidates: list[dict[str, Any]], blocked: str | None = None) -> dict[str, Any] | None:
    eligible = [
        row for row in candidates
        if row.get("eligibleForFrozenArms") is True and row.get("symbol") != blocked
    ]
    if not eligible:
        return None
    return sorted(eligible, key=lambda row: (-abs(float(row["basisDislocationBps"])), str(row["symbol"])))[0]


def discover_chunks(input_dir: Path) -> list[dict[str, Any]]:
    rows = []
    if not input_dir.exists():
        return rows
    for meta_path in sorted(input_dir.rglob("chunk.json")):
        directory = meta_path.parent
        result_path = directory / "result.json"
        event_path = directory / "v13-events.jsonl.gz"
        funding_path = directory / "funding.json"
        rows.append({
            "dir": directory,
            "meta": load_json(meta_path),
            "result": load_json(result_path) if result_path.exists() else None,
            "eventsPath": event_path,
            "funding": load_json(funding_path) if funding_path.exists() else None,
        })
    return rows


def quality_eligible(chunk: dict[str, Any], config: dict[str, Any]) -> bool:
    result = chunk["result"]
    funding = chunk["funding"]
    if result is None or funding is None or not chunk["eventsPath"].exists():
        return False
    if int(chunk["meta"].get("collectorExitCode", 1)) != 0:
        return False
    coverage = result.get("coverage", {})
    if sorted(coverage.get("completeSymbols", [])) != sorted(config["universe"]):
        return False
    if int(coverage.get("collectorErrors", 0) or 0) != 0:
        return False
    fixed = result.get("fixedDualEvidence", {})
    if fixed.get("decisionDone") is not True or int(fixed.get("candidateCount", 0)) != len(config["universe"]):
        return False
    if funding.get("errors"):
        return False
    return result.get("safety", {}).get("orderSubmissionAllowed") is False


def canonical_chunks(chunks: list[dict[str, Any]], config: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    allowed = set(config["sessionDates"])
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    ignored = []
    for chunk in chunks:
        date = str(chunk["meta"].get("sessionDate", ""))
        if date not in allowed:
            ignored.append({"path": str(chunk["dir"]), "reason": "OUTSIDE_FROZEN_WINDOW"})
            continue
        grouped[date].append(chunk)
    canonical = {}
    for date, attempts in grouped.items():
        attempts.sort(key=lambda row: (str(row["meta"].get("startedAtUtc", "")), str(row["meta"].get("runId", ""))))
        eligible = [row for row in attempts if quality_eligible(row, config)]
        if eligible:
            canonical[date] = eligible[0]
            for row in attempts:
                if row is not eligible[0]:
                    ignored.append({"path": str(row["dir"]), "reason": "LATER_OR_INELIGIBLE_DUPLICATE"})
        else:
            for row in attempts:
                ignored.append({"path": str(row["dir"]), "reason": "NO_QUALITY_ELIGIBLE_ATTEMPT"})
    return canonical, ignored


def funding_points(rows: list[dict[str, Any]], venue: str) -> list[tuple[int, float]]:
    result = []
    for row in rows:
        ts_key = "fundingTime" if venue == "ASTER" else "time"
        ts = int(row.get(ts_key, 0) or 0)
        rate = finite(row.get("fundingRate") if row.get("fundingRate") is not None else row.get("funding"))
        if ts > 0 and rate is not None:
            result.append((ts, rate))
    return sorted(result)


def cycle_funding_bps(cycle: dict[str, Any], funding: dict[str, Any]) -> float:
    symbol = str(cycle["symbol"])
    opened = int(cycle["openedMs"])
    closed = int(cycle["closedMs"])
    aster_side = 1 if cycle["openSide"] == "BUY" else -1
    xyz_side = -aster_side
    rows = funding.get("rows", {}).get(symbol, {})
    aster = sum(rate for ts, rate in funding_points(rows.get("ASTER", []), "ASTER") if opened <= ts < closed)
    xyz = sum(rate for ts, rate in funding_points(rows.get("XYZ", []), "XYZ") if opened <= ts < closed)
    return (-aster_side * aster - xyz_side * xyz) * 10_000.0


def session_evidence(chunk: dict[str, Any]) -> dict[str, Any]:
    events = read_events(chunk["eventsPath"])
    candidates = [row for row in events if row.get("recordType") == "dual_entry_candidate"]
    cycles = [row for row in events if row.get("recordType") == "virtual_cycle_complete"]
    safety_by_symbol: dict[str, Counter] = defaultdict(Counter)
    mapping = {
        "virtual_partial_fill_safety_failure": "partialFillFailures",
        "virtual_unhedged_rejection": "unhedgedFailures",
        "virtual_inventory_unresolved": "unresolvedInventory",
    }
    for row in events:
        key = mapping.get(str(row.get("recordType")))
        symbol = str(row.get("symbol", ""))
        if key and symbol:
            safety_by_symbol[symbol][key] += 1
    return {
        "candidates": candidates,
        "cyclesBySymbol": {str(row["symbol"]): row for row in cycles},
        "safetyBySymbol": {symbol: dict(counter) for symbol, counter in safety_by_symbol.items()},
    }


def profit_factor(values: list[float]) -> float | None:
    gains = sum(value for value in values if value > 0)
    losses = -sum(value for value in values if value < 0)
    if losses > 1e-12:
        return gains / losses
    return 999.0 if gains > 0 else None


def arm_metrics(cycles: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, Any]:
    output = {}
    for scenario, cost in config["costBps"].items():
        nets = [float(row["grossWithFundingBps"]) - float(cost) for row in cycles]
        by_symbol = {symbol: 0.0 for symbol in config["universe"]}
        for row, net in zip(cycles, nets):
            by_symbol[row["symbol"]] += net
        positive_total = sum(max(0.0, value) for value in by_symbol.values())
        output[scenario] = {
            "completedCycles": len(nets),
            "averageNetBps": sum(nets) / len(nets) if nets else None,
            "totalNetBps": sum(nets),
            "positiveNetRate": sum(value > 0 for value in nets) / len(nets) if nets else None,
            "profitFactor": profit_factor(nets),
            "minimumNetBps": min(nets) if nets else None,
            "maximumNetBps": max(nets) if nets else None,
            "bySymbolNetBps": by_symbol,
            "maxPositiveProfitContributionShare": (
                max((max(0.0, value) for value in by_symbol.values()), default=0.0) / positive_total
                if positive_total > 0 else None
            ),
            "costBps": float(cost),
        }
    return output


def evaluate(config: dict[str, Any], chunks: list[dict[str, Any]], as_of: dt.datetime) -> dict[str, Any]:
    canonical, ignored = canonical_chunks(chunks, config)
    arm_cycles: dict[str, list[dict[str, Any]]] = {"V13G": [], "V13D": []}
    previous_completed_symbol: str | None = None
    selections = []
    arm_safety = {"V13G": Counter(), "V13D": Counter()}

    for session_date in config["sessionDates"]:
        chunk = canonical.get(session_date)
        if chunk is None:
            selections.append({"sessionDate": session_date, "complete": False, "arms": {}})
            continue
        evidence = session_evidence(chunk)
        arm_rows = {}
        for arm in ("V13G", "V13D"):
            blocked = previous_completed_symbol if arm == "V13D" else None
            selected = choose_candidate(evidence["candidates"], blocked=blocked)
            if selected is None:
                arm_rows[arm] = {"selectedSymbol": None, "blockedSymbol": blocked, "completed": False}
                continue
            symbol = str(selected["symbol"])
            cycle = evidence["cyclesBySymbol"].get(symbol)
            safety = evidence["safetyBySymbol"].get(symbol, {})
            for key, value in safety.items():
                arm_safety[arm][key] += int(value)
            completed = cycle is not None
            arm_rows[arm] = {
                "selectedSymbol": symbol,
                "blockedSymbol": blocked,
                "basisDislocationBps": selected.get("basisDislocationBps"),
                "completed": completed,
                "safety": safety,
            }
            if completed:
                row = dict(cycle)
                row["sessionDate"] = session_date
                row["arm"] = arm
                row["fundingBps"] = cycle_funding_bps(row, chunk["funding"])
                row["grossWithFundingBps"] = float(row["grossBps"]) + float(row["fundingBps"])
                arm_cycles[arm].append(row)
                if arm == "V13D":
                    previous_completed_symbol = symbol
        selections.append({"sessionDate": session_date, "complete": True, "arms": arm_rows})

    metrics = {arm: arm_metrics(rows, config) for arm, rows in arm_cycles.items()}
    gate = config["reviewGate"]
    last_date = dt.date.fromisoformat(config["sessionDates"][-1])
    finish_local = dt.datetime.combine(last_date, dt.time(15, 20), tzinfo=NY)
    window_finished = as_of >= finish_local.astimezone(UTC)
    coverage_pass = len(canonical) == int(gate["requiredCompleteSessions"])

    arm_gates = {}
    for arm in ("V13G", "V13D"):
        normal, p95, severe = metrics[arm]["NORMAL"], metrics[arm]["P95"], metrics[arm]["SEVERE"]
        safety_pass = (
            arm_safety[arm]["partialFillFailures"] <= int(gate["maximumPartialFillFailures"])
            and arm_safety[arm]["unhedgedFailures"] <= int(gate["maximumUnhedgedHedgeFailures"])
            and arm_safety[arm]["unresolvedInventory"] <= int(gate["maximumUnresolvedEndingInventory"])
        )
        cycles_pass = len(arm_cycles[arm]) >= int(gate["minimumCompletedCyclesPerArm"])
        performance_pass = (
            all(row["averageNetBps"] is not None and row["averageNetBps"] > 0 for row in (normal, p95, severe))
            and normal["positiveNetRate"] is not None
            and normal["positiveNetRate"] >= float(gate["minimumNormalPositiveNetRate"])
        )
        concentration_limit = float(
            gate["maximumGrowthSingleSymbolPositiveProfitShare"]
            if arm == "V13G" else gate["maximumDiversifiedSingleSymbolPositiveProfitShare"]
        )
        concentration_pass = (
            normal["maxPositiveProfitContributionShare"] is not None
            and normal["maxPositiveProfitContributionShare"] <= concentration_limit
        )
        arm_gates[arm] = {
            "cyclesPassed": cycles_pass,
            "executionSafetyPassed": safety_pass,
            "performancePassed": performance_pass,
            "concentrationPassed": concentration_pass,
            "passed": cycles_pass and safety_pass and performance_pass and concentration_pass,
            "concentrationLimit": concentration_limit,
        }

    if not window_finished:
        status = "V13G_V13D_FIXED_FORWARD_IN_PROGRESS"
    elif not coverage_pass:
        status = "V13G_V13D_FIXED_FORWARD_COVERAGE_INCOMPLETE"
    elif any(not arm_gates[arm]["executionSafetyPassed"] for arm in arm_gates):
        status = "V13G_V13D_FIXED_FORWARD_EXECUTION_SAFETY_FAILED"
    elif any(not arm_gates[arm]["cyclesPassed"] for arm in arm_gates):
        status = "V13G_V13D_FIXED_FORWARD_INSUFFICIENT_CYCLES"
    elif all(arm_gates[arm]["passed"] for arm in arm_gates):
        status = str(gate["passingStatus"])
    elif arm_gates["V13G"]["passed"]:
        status = "V13G_FIXED_FORWARD_PASS_V13D_FAILED"
    elif arm_gates["V13D"]["passed"]:
        status = "V13D_FIXED_FORWARD_PASS_V13G_FAILED"
    else:
        status = "V13G_V13D_FIXED_FORWARD_PERFORMANCE_FAILED"

    return {
        "strategyId": config["strategyId"],
        "status": status,
        "generatedAt": iso(as_of),
        "configSha256": hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(),
        "window": {
            "firstSession": config["sessionDates"][0],
            "lastSession": config["sessionDates"][-1],
            "requiredSessions": len(config["sessionDates"]),
            "completeSessions": len(canonical),
            "collectionWindowFinished": window_finished,
        },
        "frozenArms": config["arms"],
        "selections": selections,
        "arms": {
            arm: {
                "completedCycles": len(arm_cycles[arm]),
                "costScenarios": metrics[arm],
                "executionSafety": dict(arm_safety[arm]),
                "gates": arm_gates[arm],
            }
            for arm in ("V13G", "V13D")
        },
        "gates": {
            "coveragePassed": coverage_pass,
            "retuningAllowed": False,
            "productionOrLiveAuthorized": False,
        },
        "canonicalChunks": [
            {"sessionDate": date, "path": str(chunk["dir"]), "runId": chunk["meta"].get("runId")}
            for date, chunk in sorted(canonical.items())
        ],
        "ignoredAttempts": ignored,
        "safety": config["safety"],
    }


def render_report(result: dict[str, Any]) -> str:
    lines = [
        "# V13G / V13D Fixed Forward Report",
        "",
        f"**Status: `{result['status']}`**",
        "",
        f"- Complete sessions: {result['window']['completeSessions']} / {result['window']['requiredSessions']}",
        "- Retuning: prohibited",
        "- Production / LIVE authorization: NO",
        "",
        "| Arm | Cycles | Normal avg | P95 avg | Severe avg | Normal win rate | Max symbol share | Pass |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for arm in ("V13G", "V13D"):
        node = result["arms"][arm]
        normal = node["costScenarios"]["NORMAL"]
        p95 = node["costScenarios"]["P95"]
        severe = node["costScenarios"]["SEVERE"]
        lines.append(
            f"| {arm} | {node['completedCycles']} | {normal['averageNetBps']} | {p95['averageNetBps']} | "
            f"{severe['averageNetBps']} | {normal['positiveNetRate']} | "
            f"{normal['maxPositiveProfitContributionShare']} | {node['gates']['passed']} |"
        )
    return "\n".join(lines) + "\n"


def write_outputs(result: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "aggregate-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "aggregate-report.md").write_text(render_report(result), encoding="utf-8")


def self_test() -> None:
    assert choose_candidate([
        {"symbol": "META", "basisDislocationBps": 25, "eligibleForFrozenArms": True},
        {"symbol": "AMZN", "basisDislocationBps": -30, "eligibleForFrozenArms": True},
    ])["symbol"] == "AMZN"
    assert choose_candidate([
        {"symbol": "META", "basisDislocationBps": 25, "eligibleForFrozenArms": True},
        {"symbol": "AMZN", "basisDislocationBps": -30, "eligibleForFrozenArms": True},
    ], blocked="AMZN")["symbol"] == "META"
    config = {
        "strategyId": "TEST", "sessionDates": ["2026-01-05"], "universe": ["AMZN", "META"],
        "arms": {"V13G": {}, "V13D": {}},
        "costBps": {"FORWARD_MEDIAN": 10, "NORMAL": 16, "P95": 26, "SEVERE": 45},
        "reviewGate": {
            "requiredCompleteSessions": 1, "minimumCompletedCyclesPerArm": 1,
            "minimumNormalPositiveNetRate": 0.55,
            "maximumGrowthSingleSymbolPositiveProfitShare": 1.0,
            "maximumDiversifiedSingleSymbolPositiveProfitShare": 1.0,
            "maximumPartialFillFailures": 0, "maximumUnhedgedHedgeFailures": 0,
            "maximumUnresolvedEndingInventory": 0, "passingStatus": "PASS"
        },
        "safety": {"orderSubmissionAllowed": False}
    }
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "2026-01-05" / "1"
        root.mkdir(parents=True)
        meta = {"sessionDate": "2026-01-05", "runId": "1", "startedAtUtc": "2026-01-05T14:00:00Z", "collectorExitCode": 0}
        result = {
            "coverage": {"completeSymbols": ["AMZN", "META"], "collectorErrors": 0},
            "fixedDualEvidence": {"decisionDone": True, "candidateCount": 2},
            "safety": {"orderSubmissionAllowed": False}
        }
        funding = {"rows": {"AMZN": {"ASTER": [], "XYZ": []}, "META": {"ASTER": [], "XYZ": []}}, "errors": []}
        (root / "chunk.json").write_text(json.dumps(meta))
        (root / "result.json").write_text(json.dumps(result))
        (root / "funding.json").write_text(json.dumps(funding))
        events = [
            {"recordType": "dual_entry_candidate", "symbol": "AMZN", "basisDislocationBps": 30, "eligibleForFrozenArms": True},
            {"recordType": "dual_entry_candidate", "symbol": "META", "basisDislocationBps": 25, "eligibleForFrozenArms": True},
            {"recordType": "virtual_cycle_complete", "symbol": "AMZN", "openSide": "BUY", "grossBps": 100, "openedMs": 1, "closedMs": 2},
        ]
        with gzip.open(root / "v13-events.jsonl.gz", "wt", encoding="utf-8") as handle:
            for row in events:
                handle.write(json.dumps(row) + "\n")
        evaluated = evaluate(config, discover_chunks(Path(tmp)), dt.datetime(2026, 1, 6, tzinfo=UTC))
        assert evaluated["arms"]["V13G"]["completedCycles"] == 1
        assert evaluated["arms"]["V13D"]["completedCycles"] == 1
    print("V13G/V13D aggregate self-test: PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config")
    parser.add_argument("--input-dir")
    parser.add_argument("--output-dir")
    parser.add_argument("--as-of")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    self_test()
    if args.self_test:
        return 0
    if not args.config or not args.input_dir or not args.output_dir:
        parser.error("--config, --input-dir and --output-dir are required")
    config = load_json(Path(args.config))
    as_of = parse_iso(args.as_of) if args.as_of else dt.datetime.now(UTC)
    result = evaluate(config, discover_chunks(Path(args.input_dir)), as_of)
    write_outputs(result, Path(args.output_dir))
    print(json.dumps({"strategyId": result["strategyId"], "status": result["status"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
