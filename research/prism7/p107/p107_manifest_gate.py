#!/usr/bin/env python3
"""P107 research-only audit: identify incompatible historic BT manifests.
Read-only inputs; never invokes a broker, GitHub, or production runner.
NOT a production-parity verifier; it fails closed on missing evidence.
"""
import argparse
import hashlib
import json
from pathlib import Path

EXPECTED_PERIOD = ["2025-10-01T00:00:00Z", "2026-10-01T00:00:00Z"]
P106_30BPS = {
    "baseline_final_jpy": 551075,
    "baseline_max_dd_pct": 29.95,
    "selected_final_jpy": 607456,
    "selected_max_dd_pct": 23.17,
    "selected_win_rate_pct": 60.34,
    "model": "P92 old STRICT_V2; V4 DD21 HOLD not represented",
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def assess(manifest_path):
    raw = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    results = raw.get("results", [])
    caveats = raw.get("caveats", [])
    reasons = []
    observations = []
    status = str(raw.get("status", ""))
    if raw.get("period") != EXPECTED_PERIOD:
        reasons.append("PERIOD_NOT_FIXED_CONTRACT")
    if "NOT_FULL_PRODUCTION_PARITY" in status or "RESEARCH_ONLY" in status:
        reasons.append("EXPLICIT_RESEARCH_ONLY_NOT_PRODUCTION_PARITY")
    if len({r.get("cost_bps_roundtrip") for r in results}) != 2 or {r.get("cost_bps_roundtrip") for r in results} != {10, 30}:
        reasons.append("INCOMPLETE_SEPARATE_10_30BPS")
    if any(abs(float(r.get("initial_jpy", -1)) - 10000) > 1e-6 for r in results):
        reasons.append("INITIAL_CAPITAL_MISMATCH")
    if not any("V4_MAX_DRAWDOWN_21PCT_HOLD" in r.get("blocked_by_reason", {}) for r in results):
        reasons.append("NO_REPLAYED_DD21_HOLD_EVENT_EVIDENCE")
    if any(float(r.get("stock_cap", 1e6)) > 1.5 + 1e-8 for r in results):
        reasons.append("STOCK_GROSS_ABOVE_1P5")
    if any(float(r.get("total_cap", 1e6)) > 3.5 + 1e-8 for r in results):
        reasons.append("TOTAL_GROSS_ABOVE_3P5")
    if any(float(r.get("crypto_cap", 1e6)) > 3.0 + 1e-8 for r in results):
        reasons.append("CRYPTO_GROSS_ABOVE_3P0")
    joined = " ".join(str(x) for x in caveats)
    if "HIGH_VOL missing" in joined or "66 fail-closed" in joined:
        reasons.append("Q102_HIGH_VOL_OR_66_UNRESOLVED")
    observations.append("Manifest records model-level DD21 holds, but does not by itself prove exact Runner replay.")
    observations.append("P106 uses a different PENGU Native Binance/M5 pathway; candidate and order counts cannot be compared one-to-one.")
    observations.append("H48, exact production Runner pin, intrabar STOP/Funding and fill parity are not proven by this manifest.")
    summaries = []
    for r in sorted(results, key=lambda x: x.get("cost_bps_roundtrip", 0)):
        summaries.append({
            "bps": r.get("cost_bps_roundtrip"),
            "final_jpy": round(float(r.get("final_compounded_jpy", 0)), 2),
            "max_hourly_dd_pct_signed": r.get("max_hourly_dd_pct"),
            "win_rate_pct": r.get("win_rate_pct"),
            "modeled_fills": r.get("modeled_fills"),
            "v4_dd21_blocked_candidates": r.get("blocked_by_reason", {}).get("V4_MAX_DRAWDOWN_21PCT_HOLD"),
            "stock_cap": r.get("stock_cap"), "crypto_cap": r.get("crypto_cap"), "total_cap": r.get("total_cap"),
            "PENGU_admissions": r.get("admitted_by_runner", {}).get("PENGU")
        })
    # Current production parity ALWAYS requires a separate full replay and exact-SHA evidence.
    reasons.append("EXACT_SHA_AND_FILLS_PARITY_NOT_ATTESTED")
    return {
        "manifest": str(manifest_path),
        "manifest_sha256": sha(manifest_path),
        "status": "P107_GATE_BLOCKED_RESEARCH_ONLY",
        "reasons": sorted(set(reasons)),
        "observations": observations,
        "summaries": summaries,
        "source_status": status,
    }

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--root", required=True, help="existing research data root; read-only")
    p.add_argument("--out", required=True, help="isolated JSON report path")
    a = p.parse_args()
    root = Path(a.root)
    names = [
        "STABLE4_NORMALGROSS_3P5_V4_475_EXPLORATORY_20261116_V2",
        "STABLE4_OPPORTUNITY_PROD_CAPS_20261114",
        "STABLE4_GROSS425_V4_475_L3_Q102_DUALH48_RESEARCH_20261116_V1",
        "DD_PRISM3_PENGU_IDLE_VOLUME_AWARE_20261122",
    ]
    checks = []
    for name in names:
        mp = root / name / "RUN_MANIFEST.json"
        if not mp.is_file():
            checks.append({"manifest": str(mp), "status": "P107_GATE_BLOCKED_MISSING_INPUT"})
        else:
            checks.append(assess(mp))
    out = {
        "phase": "P107-A", "prod_changes": False, "orders_sent": 0,
        "current_STABLE4_PARITY_PASS": False,
        "p106": P106_30BPS, "checks": checks,
        "next": "Exact live pins -> no-change full engine baseline parity -> native Binance re-fire -> OOS/portfolio tests",
    }
    dest = Path(a.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    for c in checks:
        print(Path(c["manifest"]).parent.name, c["status"], ";".join(c.get("reasons", [])))
        for r in c.get("summaries", []):
            print(" ", r["bps"], "bps", "JPY", r["final_jpy"], "DD", r["max_hourly_dd_pct_signed"], "trades", r["modeled_fills"])
    print("OUT", dest)

if __name__ == "__main__":
    main()

