"""Fail-closed source/route completeness audit for dynamic score economic BT.

This checks evidence only, never interacts with an exchange, and never
converts modeled H1 fills into venue-certified trades.
"""
from __future__ import annotations
import argparse
from collections import Counter
import json
from pathlib import Path

REQUIRED_FAMILIES = ("V12", "PENGU", "Q102", "FET", "V52", "HYPE", "IDLE", "ZEC")


def load_jsonl(path: Path):
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def audit(output_root: Path, expected_v4_sha: str, required=REQUIRED_FAMILIES):
    base = output_root / "DYNAMIC_SCORE" / "PRICE_MODEL_10BPS"
    decisions = load_jsonl(base / "candidate-decisions.jsonl")
    trades = load_jsonl(base / "portfolio-trades.jsonl")
    by_strategy = Counter(str(row.get("strategy_id") or "") for row in decisions)
    strategy_families = sorted(k for k, n in by_strategy.items() if n)
    missing = sorted(set(required) - set(strategy_families))
    v12_rows = [r for r in trades if r.get("strategy_id") == "V12"]
    unknown_routes = sum(not isinstance(r.get("route"), str) or not r["route"].strip() for r in v12_rows)
    mismatch = sum(r.get("source_runtime_sha") != expected_v4_sha for r in v12_rows)
    source_shas = dict(Counter(str(r.get("source_runtime_sha")) for r in v12_rows))
    scores = dict(Counter(str(r.get("market_fit_score_source")) for r in decisions))
    full_parity = bool(v12_rows and not missing and not unknown_routes and not mismatch)
    return {
        "status": "SOURCE_PARITY_PASS_RESEARCH_ONLY" if full_parity else "BLOCKED_INCOMPLETE_LATEST_SOURCE_COVERAGE",
        "requiredFamilies": list(required),
        "observedFamilies": strategy_families,
        "missingFamilies": missing,
        "candidateRows": len(decisions),
        "tradeRows": len(trades),
        "v12ModeledTrades": len(v12_rows),
        "v12MissingRouteIdentity": unknown_routes,
        "v12WrongSourceSha": mismatch,
        "expectedV4Sha": expected_v4_sha,
        "observedV12SourceShas": source_shas,
        "scoreSourceCounts": scores,
        "strategyCandidateCounts": dict(by_strategy),
        "fullIntegratedSourceParity": full_parity,
        "venueL2FillCertified": False,
        "eligibleForAutomaticLiveCutover": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bt-root", required=True, type=Path)
    parser.add_argument("--expected-v4-sha", required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = audit(args.bt_root, args.expected_v4_sha)
    result_text = json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    if args.report:
        args.report.parent.mkdir(exist_ok=True, parents=True)
        args.report.write_text(result_text, encoding="utf-8")
    print(result_text)
    raise SystemExit(0 if result["fullIntegratedSourceParity"] else 2)


if __name__ == "__main__":
    main()
