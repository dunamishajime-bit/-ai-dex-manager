"""Read-only independent equity-DD audit of private Stable4 *research* replays.

Never certifies release/venue parity, authorizes deployment, runs orders, or
changes artifacts. The misleading historical EQUITY_30MIN filename is checked
against actual five-minute UTC rows. Research must remain distinct from LIVE.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

START = "2025-10-01T00:00:00Z"
END = "2026-10-01T00:00:00Z"
STEP = 300
MAX_DD_PCT = 20.0


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def iso_ms(utc):
    if not isinstance(utc, str) or not utc.endswith("Z"):
        raise ValueError("INVALID_UTC_TIMESTAMP")
    return int(datetime.fromisoformat(utc.replace("Z", "+00:00")).timestamp())


def compute_equity_dd(csv_path, *, start=START, end=END, interval=STEP):
    expected = (iso_ms(end) - iso_ms(start)) // interval + 1
    if expected <= 1 or (iso_ms(end) - iso_ms(start)) % interval:
        raise ValueError("INVALID_PERIOD_GRID")
    prev = None
    peak = 0.0
    worst = 0.0
    trough = None
    first = None
    final = None
    rows = 0
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        mandatory = {"utc", "compounded_mtm_equity_jpy"}
        if reader.fieldnames is None or not mandatory.issubset(reader.fieldnames):
            raise ValueError("EQUITY_COLUMNS_MISSING")
        for row in reader:
            t = iso_ms(row["utc"])
            if rows == 0:
                if t != iso_ms(start):
                    raise ValueError("EQUITY_START_MISMATCH")
            elif t != prev + interval:
                raise ValueError("EQUITY_GRID_GAP_OR_DUPLICATE")
            equity = float(row["compounded_mtm_equity_jpy"])
            if not math.isfinite(equity) or equity <= 0:
                raise ValueError("EQUITY_INVALID")
            if first is None:
                first = equity
            peak = max(peak, equity)
            dd = 100.0 * (equity / peak - 1.0)
            if dd < worst:
                worst, trough = dd, row["utc"]
            final = equity
            prev = t
            rows += 1
    if rows != expected or prev != iso_ms(end):
        raise ValueError("EQUITY_END_OR_ROWCOUNT_MISMATCH")
    return {"rows": rows, "firstEquityJpy": first, "lastEquityJpy": final,
            "maxDrawdownPct": worst, "drawdownTroughUtc": trough,
            "actualSamplingSeconds": interval, "sourceFilenameLabel": "EQUITY_30MIN"}


def audit_case(folder, *, start=START, end=END, dd_limit=MAX_DD_PCT):
    folder = Path(folder)
    manifest_path = folder / "RUN_MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("period") != [start, end] or len(manifest.get("results", [])) != 2:
        raise ValueError("RESEARCH_MANIFEST_PERIOD_OR_CASE_INVALID")
    status = manifest.get("status")
    if not isinstance(status, str) or "RESEARCH_ONLY" not in status:
        raise ValueError("RESEARCH_ONLY_CLASSIFICATION_REQUIRED")
    results = {}
    for entry in manifest["results"]:
        bps = entry.get("cost_bps_roundtrip")
        if type(bps) is not int or bps not in (10, 30) or bps in results:
            raise ValueError("DUPLICATE_OR_UNKNOWN_COST_BPS")
        files = list(folder.glob("*" + str(bps) + "BPS_EQUITY_30MIN.csv"))
        if len(files) != 1 or not files[0].is_file() or files[0].is_symlink():
            raise ValueError("MISSING_OR_AMBIGUOUS_SOURCE_EQUITY")
        computed = compute_equity_dd(files[0], start=start, end=end)
        reported = entry.get("max_hourly_dd_pct")
        initial = entry.get("initial_jpy")
        final = entry.get("final_compounded_jpy")
        if any(type(v) not in (int, float) or not math.isfinite(v)
               for v in (reported, initial, final)):
            raise ValueError("MANIFEST_NUMERIC_INVALID")
        if (abs(reported - computed["maxDrawdownPct"]) > 1e-6
                or abs(initial - computed["firstEquityJpy"]) > 1e-6
                or abs(final - computed["lastEquityJpy"]) > max(1e-6, abs(final) * 1e-10)):
            raise ValueError("INDEPENDENT_METRICS_MISMATCH")
        results[bps] = {
            **computed,
            "reportedDrawdownPct": reported,
            "winRatePct": entry.get("win_rate_pct"),
            "modeledFills": entry.get("modeled_fills"),
            "equityFileSha256": sha256(files[0]),
            "dd20Passed": abs(computed["maxDrawdownPct"]) <= dd_limit,
            "status": "RESEARCH_RECONCILED_NOT_PRODUCTION_PARITY",
        }
    if set(results) != {10, 30}:
        raise ValueError("TEN_AND_THIRTY_BPS_REQUIRED")
    return {
        "schema": "disdex-stable4-research-dd-independent-audit/v1",
        "researchModelDirectoryName": folder.name,
        "manifestSha256": sha256(manifest_path),
        "period": [start, end],
        "resultsByCostBps": {str(k): v for k, v in sorted(results.items())},
        "riskDdLimitPct": dd_limit,
        "riskDdPassed": all(row["dd20Passed"] for row in results.values()),
        "productionParityVerified": False,
        "liveCutoverAuthorized": False,
        "status": "BLOCKED_RESEARCH_ONLY_AND_DD" if not all(row["dd20Passed"] for row in results.values())
                  else "BLOCKED_RESEARCH_ONLY_NOT_LIVE_PARITY",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--research-root", type=Path, required=True)
    parser.add_argument("--case", action="append", required=True)
    parser.add_argument("--output-json", type=Path)
    args = parser.parse_args()
    if len(args.case) != len(set(args.case)) or not args.case:
        parser.error("DUPLICATE_OR_EMPTY_CASE")
    root = args.research_root.resolve()
    rows = []
    for name in args.case:
        if "/" in name or "\\" in name or name in (".", "..") or not name:
            parser.error("CASE_MUST_BE_DIRECT_CHILD_DIRECTORY")
        p = root / name
        if not p.is_dir() or p.is_symlink():
            parser.error("CASE_DIRECTORY_MISSING_OR_SYMLINK")
        rows.append(audit_case(p))
    report = {
        "schema": "disdex-stable4-research-replay-risk-check/v1",
        "status": "BLOCKED_NONLIVE_RESEARCH_MODEL",
        "researchCases": rows,
        "liveCutoverAuthorized": False,
        "productionEconomicParityVerified": False,
        "venueSignedOrderParityVerified": False,
        "ownerApprovalVerified": False,
    }
    serialized = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output_json:
        if args.output_json.exists():
            parser.error("OUTPUT_ALREADY_EXISTS")
        args.output_json.write_text(serialized, encoding="utf-8")
    print(serialized)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())