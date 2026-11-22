"""P107 candidate-slot concurrency evidence; explicitly NOT an order-admission simulator."""
import collections
import datetime
import hashlib
import json
from decimal import Decimal
from pathlib import Path

BASE = Path(__file__).resolve().parent
INPUT = BASE / "P107_SIX_RUNNER_1790_CHRONOLOGICAL_NATIVE_CANDIDATES_20261123.jsonl"
MANIFEST = BASE / "P107_SIX_RUNNER_1790_RAW_CANDIDATE_CONCURRENCY_AUDIT_20261123.json"
OUTPUT = BASE / "P107_SIX_RUNNER_ENTRY_SLOT_OWNERSHIP_GAP_20261123.json"
EXPECTED = {"V4": 1394, "PENGU": 117, "Q102": 49, "IDLE": 184, "FET": 11, "HYPE": 35}
START_MS, END_MS = 1759276800000, 1790812800000

def utc(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")

def compute(rows):
    grouped = collections.defaultdict(list)
    keys = set()
    for e in rows:
        for required in ("entryTs", "sourceDecisionTs", "runner", "sourcePinnedSHA",
                         "symbol", "side", "route", "requestedGross",
                         "rawCandidateOnly", "signedFill", "simulatedOrder"):
            assert required in e, (required, e)
        assert e["sourceDecisionTs"] <= e["entryTs"]
        assert START_MS <= e["entryTs"] < END_MS
        assert e["rawCandidateOnly"] is True
        assert e["signedFill"] is False
        assert e["simulatedOrder"] is False
        assert e["runner"] in EXPECTED
        assert Decimal(str(e["requestedGross"])) > 0
        key = (e["entryTs"], e["runner"], e["symbol"], e["side"], e["route"])
        assert key not in keys, key
        keys.add(key)
        grouped[e["entryTs"]].append(e)
    stats = collections.Counter(e["runner"] for e in rows)
    multi = [grouped[t] for t in sorted(grouped) if len(grouped[t]) > 1]
    cross = [g for g in multi if len({r["runner"] for r in g}) > 1]
    same_symbol = [g for g in multi if len({r["symbol"] for r in g}) < len(g)]
    total_gross = lambda g: sum((Decimal(str(r["requestedGross"])) for r in g), Decimal(0))
    return {
        "sourceCandidateCount": len(rows),
        "candidateCountByRunner": dict(sorted(stats.items())),
        "uniqueEntryTimestampCount": len(grouped),
        "concurrentCandidateTimestampCount": len(multi),
        "concurrentCrossRunnerTimestampCount": len(cross),
        "concurrentSameRunnerOnlyTimestampCount": len(multi) - len(cross),
        "sameSymbolSameTimestampCandidateGroups": len(same_symbol),
        "maximumCandidatesAtOneTimestamp": max(len(g) for g in grouped.values()),
        "maximumSameTimestampRequestedGrossIfAllAccepted": float(max(map(total_gross, grouped.values()))),
        "sameTimestampAllCandidateGrossOver3p5Count": sum(total_gross(g) > Decimal("3.5") for g in grouped.values()),
        "sameTimestampAllCandidateGrossOver4p25Count": sum(total_gross(g) > Decimal("4.25") for g in grouped.values()),
        "crossRunnerCandidateSlots": [{
            "entryTs": g[0]["entryTs"],
            "entryUtc": utc(g[0]["entryTs"]),
            "runnerCount": len({r["runner"] for r in g}),
            "candidateCount": len(g),
            "requestedGrossSumIfAllAccepted": float(total_gross(g)),
            "candidates": [
                {"runner": r["runner"], "symbol": r["symbol"], "side": r["side"],
                 "route": r["route"], "requestedGross": r["requestedGross"]}
                for r in g
            ],
            "positionOwnershipResolved": False,
            "orderAdmissionResolved": False
        } for g in cross]
    }

def main():
    raw = INPUT.read_bytes()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    digest = hashlib.sha256(raw).hexdigest()
    canonical_lf = raw.replace(b"\r\n", b"\n")
    windows_crlf_digest = hashlib.sha256(canonical_lf.replace(b"\n", b"\r\n")).hexdigest()
    assert windows_crlf_digest == manifest["sourceResultSHA256"], (
        "REGISTRY_CONTENT_MISMATCH_AFTER_EOL_CANONICALIZATION", digest, windows_crlf_digest
    )
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
    result = compute(rows)
    assert result["candidateCountByRunner"] == EXPECTED
    assert result["sourceCandidateCount"] == manifest["totalRawCandidates"]
    assert result["concurrentCandidateTimestampCount"] == manifest["simultaneousMultipleCandidateTimeCount"]
    assert result["sameSymbolSameTimestampCandidateGroups"] == manifest["simultaneousSameSymbolCandidateSlotCount"]
    output = {
        "schema": "p107-six-runner-candidate-slot-concurrency-and-unproven-portfolio-admission/v1",
        "status": "BLOCKED_NOT_FULL_PARITY",
        "periodUtc": ["2025-10-01T00:00:00Z", "2026-10-01T00:00:00Z"],
        "inputRelativePath": INPUT.name,
        "inputSHA256": digest,
        "manifestOriginalWindowsCRLFSHA256": manifest["sourceResultSHA256"],
        "verifiedReconstructedWindowsCRLFSHA256": windows_crlf_digest,
        "sourceNormalization": "Windows CRLF original vs Git-tracked LF; both SHA256 recorded",
        "completeNativeRunnerCoverage": False,
        "coveredSourceNativeRunners": sorted(EXPECTED),
        "missingNativeRunner": ["V52"],
        "sourceCandidateOnly": True,
        "historicalSignedFillCountInThisRegistry": 0,
        "verifiedHistoricalPositionTimeline": False,
        "verifiedCrossRunnerOrderAdmission": False,
        "verifiedCrossRunnerOpenPositionGrossAtTimestamp": False,
        "verifiedOwnerApprovedDD21Resets": False,
        "verifiedActualEffectiveTotalGrossCap": False,
        "comparedGrossCapsIllustrativeOnly": [3.5, 4.25],
        "grossCapCaution": "A same-time candidate sum <= a cap does not prove cap compliance: pre-existing positions, fills, reservations, cooldowns and admission ordering are unobserved.",
        "V52Caution": "The legacy 87 H1 price-only proxy fills are not current pinned V52-native executions.",
        "noInferredFillsOrNAVOrDD": True,
        "fullCurrentSTABLE4PortfolioParity": False,
        "analysis": result
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "crossRunnerCandidateSlots"}, ensure_ascii=False))
    print("CROSS_RUNNER_SLOTS", len(result["crossRunnerCandidateSlots"]))
    print("REPORT", OUTPUT)

if __name__ == "__main__":
    main()
