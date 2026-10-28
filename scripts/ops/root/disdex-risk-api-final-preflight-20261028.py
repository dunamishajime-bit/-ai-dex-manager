#!/usr/bin/env python3
"""Fail-closed, read-only source/portfolio preflight. NEVER grants order authority.

Run on Xserver VPS before/after the Codex-controlled immutable release cutover.
No HTTP requests, no trading credentials, no state writes and no service mutation.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

COMMON_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
V4_SHA = "53a0be396719f0284af4e11b35c66a4ac7d58f79"
Q102_SHA = "ef1ab178e26a7bf5bddb6473467765edba242e1d"
V52_SHA = "97830672e2f139b39f7194166d7dc8c36e8c8933"
SERVICES = {
    "V4": f"disdex-v12-v4@{V4_SHA}.service",
    "Q102": f"disdex-quality102-causal-v1@{Q102_SHA}.service",
    "PENGU": f"disdex-pengu-dual-ls-v2@{COMMON_SHA}.service",
    "V52": f"disdex-v52-aster-only@{V52_SHA}.service",
    "FET": f"disdex-fet-brk48@{COMMON_SHA}.service",
    "HYPE": f"disdex-hype-long@{COMMON_SHA}.service",
    "IDLE": f"disdex-idle-priority-short@{COMMON_SHA}.service",
    "RISK": f"disdex-shared-crypto-risk@{COMMON_SHA}.service",
}
STATE = "/var/lib/disdex/shared"


def load_json(path: Path) -> dict:
    result = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(result, dict):
        raise ValueError("NOT_AN_OBJECT")
    return result


def validate_risk_and_protection(d: dict, v4: dict, old: dict, now_ms: int) -> list[str]:
    blockers: list[str] = []
    if d.get("sourceComplete") is not True:
        blockers.append("RISK_SOURCE_INCOMPLETE")
    if d.get("tripped") is not False:
        blockers.append("RISK_TRIPPED_OR_UNKNOWN")
    if d.get("maximumLossPct") != 7.5:
        blockers.append("DAILY_LOSS_7P5_CONTRACT_MISMATCH")
    if not isinstance(d.get("updatedAt"), (int, float)) or not (0 <= now_ms - d["updatedAt"] <= 120000):
        blockers.append("RISK_STATE_STALE")
    if v4.get("status") != "HEALTHY" or v4.get("effectiveUnprotectedCount") != 0 or v4.get("readOnly") is not True:
        blockers.append("V4_STOP_COMPANION_NOT_VERIFIED")
    if not isinstance(v4.get("checkedAt"), (int, float)) or not (0 <= now_ms - v4["checkedAt"] <= 180000):
        blockers.append("V4_STOP_COMPANION_STALE")
    if v4.get("v4Sha") != V4_SHA:
        blockers.append("V4_STOP_COMPANION_SHA_MISMATCH")
    if old.get("ok") is not True or old.get("readOnly") is not True:
        blockers.append("LEGACY_SHARED_STOP_OBSERVER_UNHEALTHY")
    if old.get("unprotectedCount") != v4.get("originalUnprotectedCount"):
        blockers.append("LEGACY_V4_STOP_DIAGNOSTICS_INCOHERENT")
    # Source preflight allows old diagnostic false positives ONLY when the
    # independent signed venue audit accounts for every one of them.
    if old.get("unprotectedCount") != len(v4.get("v4Verified") or []):
        blockers.append("UNEXPLAINED_UNPROTECTED_EXPOSURE")
    if v4.get("unresolved"):
        blockers.append("VENUE_UNRESOLVED_PROTECTION")
    return blockers


def verify_live(now_ms: int) -> dict:
    blockers: list[str] = []
    evidence: dict = {"checkedAt": now_ms}
    for label, unit in SERVICES.items():
        check = subprocess.run(["systemctl", "is-active", unit], text=True, capture_output=True, timeout=6)
        active = check.stdout.strip() == "active"
        evidence[label + "_active"] = active
        if not active:
            blockers.append("INACTIVE_" + label)
    try:
        risk = load_json(Path(STATE) / "crypto-daily-risk.json")
        v4 = load_json(Path(STATE) / "resident-stop-v4-verification.json")
        old = load_json(Path(STATE) / "resident-stop-observation.json")
        blockers.extend(validate_risk_and_protection(risk, v4, old, now_ms))
        evidence["riskLossPct"] = risk.get("lossPct")
        evidence["v4Verified"] = len(v4.get("v4Verified") or [])
    except Exception as error:
        blockers.append("RISK_STOP_EVIDENCE_UNREADABLE:" + type(error).__name__)
    try:
        hb = load_json(Path("/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json"))
        if (hb.get("runtimeSha") != Q102_SHA or hb.get("expectedSha") != Q102_SHA
            or hb.get("serviceUnit") != SERVICES["Q102"] or hb.get("safetyState") != "HEALTHY"):
            blockers.append("Q102_RELEASE_HEALTH_NOT_ATTESTED")
    except Exception as error:
        blockers.append("Q102_HEALTH_EVIDENCE_UNREADABLE:" + type(error).__name__)
    try:
        v = load_json(Path(STATE) / "aster-rate-budget.json")
        wait = v.get("nextAllowedAt", 0) - now_ms
        evidence["globalApiQueuedMs"] = max(0, round(wait))
        if v.get("schema") != "disdex-aster-rate-budget/v1":
            blockers.append("GLOBAL_RATE_BUDGET_SCHEMA_MISMATCH")
        if (not isinstance(wait, (int, float))) or wait > 5000:
            blockers.append("GLOBAL_RATE_BUDGET_SATURATED")
        if v.get("cooldownUntil", 0) > now_ms:
            blockers.append("VENUE_GLOBAL_RATE_COOLDOWN_ACTIVE")
    except Exception as error:
        blockers.append("GLOBAL_RATE_BUDGET_UNREADABLE:" + type(error).__name__)
    evidence["blockers"] = blockers
    evidence["status"] = "READ_ONLY_SOURCE_PREFLIGHT_PASS" if not blockers else "BLOCKED"
    evidence["liveOrderAuthorityGranted"] = False
    evidence["formalVenueOrderExecutionCertified"] = False
    return evidence


def selftest() -> None:
    now = 1793196100000
    base = {"sourceComplete": True, "tripped": False, "maximumLossPct": 7.5, "updatedAt": now}
    v4 = {"status": "HEALTHY", "effectiveUnprotectedCount": 0, "readOnly": True, "checkedAt": now, "v4Sha": V4_SHA,
          "originalUnprotectedCount": 1, "v4Verified": [{"symbol": "DOGEUSDT"}], "unresolved": []}
    old = {"ok": True, "readOnly": True, "unprotectedCount": 1}
    assert validate_risk_and_protection(base, v4, old, now) == []
    assert "RISK_TRIPPED_OR_UNKNOWN" in validate_risk_and_protection({**base, "tripped": True}, v4, old, now)
    assert "UNEXPLAINED_UNPROTECTED_EXPOSURE" in validate_risk_and_protection(base, {**v4, "v4Verified": []}, old, now)
    assert "V4_STOP_COMPANION_STALE" in validate_risk_and_protection(base, {**v4, "checkedAt": now - 200000}, old, now)
    assert "DAILY_LOSS_7P5_CONTRACT_MISMATCH" in validate_risk_and_protection({**base, "maximumLossPct": 8}, v4, old, now)
    print("PREFLIGHT_READONLY_SELFTEST_PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        selftest()
        return 0
    result = verify_live(int(time.time() * 1000))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["status"] == "READ_ONLY_SOURCE_PREFLIGHT_PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
