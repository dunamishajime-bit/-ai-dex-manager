"""Compare SHA-pinned Stable4 Gross policy to research model manifests.

Read-only negative gate. A research run with different economic caps, missing
V4 exception, or missing exact native source lineage is NOT a candidate replay.
This script cannot authorize any trading, ROOT cutover or owner approval.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

MODEL_KEYS = {
    "cryptoGrossCap": "crypto_cap",
    "stockGrossCap": "stock_cap",
    "totalGrossCap": "total_cap",
    "v4TotalGrossCap": "v4_total_cap",
}
CANDIDATE_PATH = "config/disdexStable4Opportunity.ts"


def source_policy(source_bytes):
    text = source_bytes.decode("utf-8")
    blocks = re.findall(r"\bconst\s+productionRisk\s*=\s*Object\.freeze\s*\(\s*\{([^{}]+)\}\s*\)", text)
    if len(blocks) != 1:
        raise ValueError("CANDIDATE_RISK_OBJECT_NOT_EXACTLY_ONE")
    fragment = blocks[0]
    parsed = {}
    for key in MODEL_KEYS:
        matches = re.findall(r"\b" + re.escape(key) + r"\s*:\s*(\d+(?:\.\d+)?)\b", fragment)
        if len(matches) != 1:
            raise ValueError("CANDIDATE_RISK_CAP_MISSING_OR_AMBIGUOUS:" + key)
        value = float(matches[0])
        if not math.isfinite(value) or value <= 0:
            raise ValueError("CANDIDATE_RISK_CAP_INVALID:" + key)
        parsed[key] = value
    return parsed


def compare_manifest(candidate, manifest):
    if not isinstance(manifest, dict) or manifest.get("period") != [
            "2025-10-01T00:00:00Z", "2026-10-01T00:00:00Z"]:
        raise ValueError("RESEARCH_MODEL_PERIOD_INVALID")
    if "RESEARCH_ONLY" not in str(manifest.get("status")):
        raise ValueError("RESEARCH_ONLY_SOURCE_REQUIRED")
    results = manifest.get("results")
    if not isinstance(results, list) or len(results) != 2 or {
            row.get("cost_bps_roundtrip") for row in results
            if isinstance(row, dict)} != {10, 30}:
        raise ValueError("RESEARCH_BPS_CASES_INVALID")
    reports = []
    for row in results:
        mismatches = []
        caps = {}
        for key, model_key in MODEL_KEYS.items():
            value = row.get(model_key)
            caps[key] = value if type(value) in (int, float) and math.isfinite(value) else None
            if caps[key] is None:
                mismatches.append({"cap": key, "reason": "MODEL_CAP_MISSING", "candidate": candidate[key]})
            elif abs(caps[key] - candidate[key]) > 1e-12:
                mismatches.append({"cap": key, "reason": "MODEL_CAP_MISMATCH",
                                   "candidate": candidate[key], "research": caps[key]})
        # No verified exact candidate-source SHA or cross-runner economic parity is
        # carried by this legacy research manifest, even when numeric caps match.
        reports.append({
            "costBps": row["cost_bps_roundtrip"],
            "modelCaps": caps,
            "capMismatches": mismatches,
            "numericGrossContractMatched": not mismatches,
            "candidateSourceAndVenueParityVerified": False,
            "eligibleForLiveCutover": False,
        })
    return sorted(reports, key=lambda x: x["costBps"])


def audit(root, source_sha, case_names, *, git="git"):
    if not isinstance(source_sha, str) or not re.fullmatch(r"[a-f0-9]{40}", source_sha):
        raise ValueError("EXACT_CANDIDATE_SHA_REQUIRED")
    code = subprocess.check_output([git, "show", source_sha + ":" + CANDIDATE_PATH])
    candidate = source_policy(code)
    if len(case_names) != len(set(case_names)) or not case_names:
        raise ValueError("RESEARCH_MODEL_CASE_NAMES_INVALID")
    reports = []
    for name in case_names:
        if (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_\-]+", name)):
            raise ValueError("CASE_NAME_INVALID")
        folder = Path(root) / name
        if not folder.is_dir() or folder.is_symlink():
            raise ValueError("MODEL_SOURCE_DIR_INVALID")
        source = folder / "RUN_MANIFEST.json"
        raw = source.read_bytes()
        manifest = json.loads(raw)
        rows = compare_manifest(candidate, manifest)
        reports.append({
            "case": name,
            "manifestSha256": hashlib.sha256(raw).hexdigest(),
            "costModels": rows,
            "matchedBothCostModels": all(row["numericGrossContractMatched"] for row in rows),
        })
    return {
        "schema": "disdex-stable4-source-gross-vs-research-parity/v1",
        "sourceSha": source_sha,
        "candidatePolicyFileSha256": hashlib.sha256(code).hexdigest(),
        "candidateCaps": candidate,
        "reports": reports,
        "allResearchCapsMatchCandidate": all(row["matchedBothCostModels"] for row in reports),
        "status": "BLOCKED_CANDIDATE_GROSS_NOT_REPLAYED",
        "candidateEconomicParityVerified": False,
        "venueProtectionVerified": False,
        "cutoverAuthorized": False,
        "productionMutated": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--research-root", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--case", action="append", required=True)
    parser.add_argument("--output-json", type=Path)
    args = parser.parse_args()
    result = audit(args.research_root, args.source_sha, args.case)
    text = json.dumps(result, sort_keys=True, indent=2) + "\n"
    if args.output_json:
        if args.output_json.exists():
            parser.error("OUTPUT_ALREADY_EXISTS")
        args.output_json.write_text(text, encoding="utf-8")
    print(text)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())