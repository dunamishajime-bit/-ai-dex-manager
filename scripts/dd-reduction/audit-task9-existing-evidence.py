#!/usr/bin/env python3
"""Read-only source-evidence audit for the Task 9 eight-strategy dynamic replay.

Only physically present data is counted. This script cannot certify economic parity.
"""
from __future__ import annotations
import argparse
import collections
import hashlib
import json
from pathlib import Path


STRATEGIES = ("V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG")
DECISIONS = ("ACCEPTED_MODELED_ENTRY", "REJECTED_PORTFOLIO", "EXCLUDED_PREALLOCATION")
EVENT_TYPES = ("MODELED_ENTRY", "MODELED_EXIT", "MODELED_PARTIAL_EXIT", "HYPE_PRIORITY_PARTIAL_EXIT", "FUNDING")


class EvidenceAuditError(ValueError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def load_rows(path: Path) -> list[dict]:
    if not path.is_file():
        raise EvidenceAuditError(f"missing required input file: {path.name}")
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as stream:
        for index, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except ValueError as exc:
                raise EvidenceAuditError(f"invalid JSONL: {path.name}:{index}") from exc
            if not isinstance(row, dict):
                raise EvidenceAuditError(f"source row must be object: {path.name}:{index}")
            rows.append(row)
    if not rows:
        raise EvidenceAuditError(f"empty source file: {path.name}")
    return rows


def unique_by_id(rows: list[dict], source_name: str) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for row in rows:
        key = row.get("candidate_id")
        if not isinstance(key, str) or not key:
            raise EvidenceAuditError(f"missing candidate_id in {source_name}")
        if key in result:
            raise EvidenceAuditError(f"duplicate candidate_id {key} in {source_name}")
        result[key] = row
    return result


def verify_h1(path: Path) -> dict:
    if not path.is_file():
        return {"available": False, "reason": "NO_SAVED_H1_SERIES"}
    with path.open("r", encoding="utf-8") as stream:
        bars = json.load(stream)
    if not isinstance(bars, list) or not bars:
        return {"available": False, "reason": "EMPTY_OR_MALFORMED_H1_SERIES"}
    ts = []
    for bar in bars:
        if not isinstance(bar, dict) or not isinstance(bar.get("ts"), int):
            return {"available": False, "reason": "MALFORMED_H1_TIMESTAMP"}
        ts.append(bar["ts"])
    valid = all(ts[i] - ts[i-1] == 3_600_000 for i in range(1, len(ts)))
    return {
        "available": True,
        "sourceSha256": sha256(path),
        "bars": len(ts),
        "startTsMs": ts[0],
        "endTsMs": ts[-1],
        "continuousH1": valid,
    }


def audit(baseline_root: Path, h1_data_dir: Path, cost_bps: int) -> dict:
    if cost_bps not in (10, 30):
        raise EvidenceAuditError("cost_bps must be 10 or 30")
    case = baseline_root / f"{cost_bps}bps" / "cases" / "V2_M150_D05_CORE_NATIVE" / "runs" / f"PRICE_MODEL_{cost_bps}BPS"
    files = {
        "candidateDecisions": case / "candidate-decisions.jsonl",
        "portfolioEvents": case / "portfolio-events.jsonl",
        "portfolioTrades": case / "portfolio-trades.jsonl",
    }
    sources = {name: load_rows(path) for name, path in files.items()}
    decisions = sources["candidateDecisions"]
    events = sources["portfolioEvents"]
    trades = sources["portfolioTrades"]
    by_id = unique_by_id(decisions, "candidateDecisions")
    entries = [row for row in events if row.get("event_type") == "MODELED_ENTRY"]
    by_entry = unique_by_id(entries, "MODELED_ENTRY")
    by_trade = unique_by_id(trades, "portfolioTrades")
    accepted = {cid for cid, row in by_id.items() if row.get("decision") == "ACCEPTED_MODELED_ENTRY"}
    rejected = {cid for cid, row in by_id.items() if row.get("decision") == "REJECTED_PORTFOLIO"}
    excluded = {cid for cid, row in by_id.items() if row.get("decision") == "EXCLUDED_PREALLOCATION"}
    decision_kinds = collections.Counter(row.get("decision", "<missing>") for row in decisions)
    strategies = collections.Counter(row.get("strategy_id", "<missing>") for row in decisions)
    event_types = collections.Counter(row.get("event_type", "<missing>") for row in events)
    verification = collections.Counter(str(row.get("historical_fill_verified")) for row in entries)
    symbols = sorted({row.get("symbol") for row in decisions if isinstance(row.get("symbol"), str)})
    available_h1 = {}
    missing = []
    for symbol in symbols:
        details = verify_h1(h1_data_dir / f"{symbol}-1h.json")
        if details["available"]:
            available_h1[symbol] = details
        else:
            missing.append(symbol)
    checks = {
        "strategyIdsExact": set(strategies) == set(STRATEGIES),
        "allowedDecisionKinds": set(decision_kinds) <= set(DECISIONS),
        "acceptedToModeledEntryIdsExact": accepted == set(by_entry),
        "acceptedToTradeIdsExact": accepted == set(by_trade),
        "allModeledEntriesHistoricalFillVerified": bool(entries) and all(row.get("historical_fill_verified") is True for row in entries),
        "allCandidateSymbolsHaveSavedH1": not missing and bool(available_h1),
        "savedH1Continuity": all(info["continuousH1"] for info in available_h1.values()),
        "allCandidateRowsPresent": len(decisions) == len(by_id),
        "allocatorDecisionPriorityAndExpiryPresent": all(
            row.get("priority") is not None and row.get("entry_valid_until_ms") is not None
            for row in decisions if row.get("decision") != "EXCLUDED_PREALLOCATION"
        ),
        "allRejectedRowsCarryQuantityAndEquity": all(
            row.get("modeled_entry_quantity") is not None and row.get("entry_equity_settlement") is not None
            for row in decisions if row.get("decision") == "REJECTED_PORTFOLIO"
        ),
    }
    result = {
        "schemaVersion": 1,
        "classification": "BLOCKED_INCOMPLETE_SOURCE_COVERAGE",
        "formalParity": False,
        "economicBacktest": False,
        "sourceKind": "PRESERVED_H1_MODELED_RESEARCH",
        "costBps": cost_bps,
        "observedCandidates": len(decisions),
        "acceptedCandidates": len(accepted),
        "rejectedPortfolioCandidates": len(rejected),
        "verifiedPreallocationExclusionRows": sum(
            bool(by_id[cid].get("reason")) and by_id[cid].get("strategy_id") in STRATEGIES
            for cid in excluded
        ),
        "preallocationExclusions": len(excluded),
        "modeledEntryEvents": len(entries),
        "modeledTradeRows": len(trades),
        "allPortfolioEventRows": len(events),
        "decisionCounts": dict(sorted(decision_kinds.items())),
        "strategyCounts": {k: strategies.get(k, 0) for k in STRATEGIES},
        "eventTypeCounts": dict(sorted(event_types.items())),
        "historicalFillVerification": dict(sorted(verification.items())),
        "symbolsInCandidates": len(symbols),
        "savedH1Symbols": len(available_h1),
        "candidateSymbolsWithoutH1InExaminedInputDirectory": missing,
        "savedH1Series": available_h1,
        "checks": checks,
        "inputSha256": {k: sha256(v) for k, v in files.items()},
        "knownNotEstablished": [
            "rejected-candidate dynamic sizing/equity/lot validation",
            "same-timestamp allocator priority and tie-break",
            "candidate validity/expiry and preemption re-admission",
            "all 35 symbols full market/MTM marks, including V52 non-crypto source",
            "fee/funding/protection/execution truth for hypothetical alternative trades",
            "dynamic integrated baseline exact parity, OOS, holdout and DD improvement",
        ],
        "productionChanges": 0,
        "liveClaim": False,
    }
    if not checks["acceptedToModeledEntryIdsExact"] or not checks["acceptedToTradeIdsExact"] or not checks["strategyIdsExact"]:
        result["classification"] = "BLOCKED_SOURCE_INTEGRITY"
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-root", type=Path, required=True)
    parser.add_argument("--h1-data-dir", type=Path, required=True)
    parser.add_argument("--cost-bps", type=int, choices=(10, 30), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.baseline_root, args.h1_data_dir, args.cost_bps)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in (
        "classification", "costBps", "observedCandidates", "acceptedCandidates",
        "preallocationExclusions", "savedH1Symbols", "symbolsInCandidates", "checks"
    )}, ensure_ascii=False))


if __name__ == "__main__":
    main()
