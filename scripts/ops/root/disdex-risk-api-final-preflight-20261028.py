#!/usr/bin/env python3
"""Fail-closed, read-only source/portfolio preflight. NEVER grants order authority.

Run on Xserver VPS before/after the Codex-controlled immutable release cutover.
No HTTP requests, no trading credentials, no state writes and no service mutation.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

V4_SHA = "53a0be396719f0284af4e11b35c66a4ac7d58f79"
Q102_SHA = "ef1ab178e26a7bf5bddb6473467765edba242e1d"
V52_SHA = "97830672e2f139b39f7194166d7dc8c36e8c8933"
PENGU_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
FET_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
HYPE_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
IDLE_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
RISK_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"
MARGIN_SHA = "7688ed7c93a1918d8b44837339b7da5584a868f5"

RUNNER_PIN_SCHEMA = "disdex-runner-pin-manifest/v1"
RUNNER_PIN_IDS = (
    "V12_V4", "PENGU_V8", "QUALITY102_CAUSAL_V1", "V52", "FET_BRK48_RESIDUAL",
    "HYPE_TREND_LONG", "IDLE_PRIORITY_SHORT", "SHARED_CRYPTO_RISK", "MARGIN_GUARD",
)
RUNNER_SERVICE_PREFIXES = {
    "V12_V4": "disdex-v12-v4",
    "PENGU_V8": "disdex-pengu-dual-ls-v2",
    "QUALITY102_CAUSAL_V1": "disdex-quality102-causal-v1",
    "V52": "disdex-v52-aster-only",
    "FET_BRK48_RESIDUAL": "disdex-fet-brk48",
    "HYPE_TREND_LONG": "disdex-hype-long",
    "IDLE_PRIORITY_SHORT": "disdex-idle-priority-short",
    "SHARED_CRYPTO_RISK": "disdex-shared-crypto-risk",
    "MARGIN_GUARD": "disdex-v12-v52-margin-guard",
}
RUNNER_STOP_OWNERS = {
    "V12_V4": "V4_PRIMARY",
    "PENGU_V8": "PENGU_V8",
    "QUALITY102_CAUSAL_V1": "Q102_PRIMARY",
    "V52": "V52",
    "FET_BRK48_RESIDUAL": "FET_BRK48_RESIDUAL",
    "HYPE_TREND_LONG": "HYPE_TREND_LONG",
    "IDLE_PRIORITY_SHORT": "IDLE_PRIORITY_SHORT",
    "SHARED_CRYPTO_RISK": "SHARED_RISK",
    "MARGIN_GUARD": "MARGIN_GUARD",
}
SERVICE_RUNNER_IDS = {
    "V4": "V12_V4",
    "Q102": "QUALITY102_CAUSAL_V1",
    "PENGU": "PENGU_V8",
    "V52": "V52",
    "FET": "FET_BRK48_RESIDUAL",
    "HYPE": "HYPE_TREND_LONG",
    "IDLE": "IDLE_PRIORITY_SHORT",
    "RISK": "SHARED_CRYPTO_RISK",
    "MARGIN": "MARGIN_GUARD",
}
SHA_PATTERN = r"^[0-9a-f]{40}$"


def _default_pin(runner_id: str, sha: str, evidence_mode: str = "legacy") -> dict:
    return {
        "sha": sha,
        "releaseRoot": f"/home/deploy/disdex-trading/releases/{sha}",
        "serviceUnit": f"{RUNNER_SERVICE_PREFIXES[runner_id]}@{sha}.service",
        "evidenceMode": evidence_mode,
        "stopOwner": RUNNER_STOP_OWNERS[runner_id],
    }


DEFAULT_RUNNER_PIN_MANIFEST = {
    "schema": RUNNER_PIN_SCHEMA,
    "target": "fixture-default-only",
    "runners": {
        "V12_V4": _default_pin("V12_V4", V4_SHA),
        "PENGU_V8": _default_pin("PENGU_V8", PENGU_SHA),
        "QUALITY102_CAUSAL_V1": _default_pin("QUALITY102_CAUSAL_V1", Q102_SHA),
        "V52": _default_pin("V52", V52_SHA),
        "FET_BRK48_RESIDUAL": _default_pin("FET_BRK48_RESIDUAL", FET_SHA),
        "HYPE_TREND_LONG": _default_pin("HYPE_TREND_LONG", HYPE_SHA),
        "IDLE_PRIORITY_SHORT": _default_pin("IDLE_PRIORITY_SHORT", IDLE_SHA),
        "SHARED_CRYPTO_RISK": _default_pin("SHARED_CRYPTO_RISK", RISK_SHA),
        "MARGIN_GUARD": _default_pin("MARGIN_GUARD", MARGIN_SHA),
    },
}


def validate_runner_pin_manifest(manifest: dict) -> list[str]:
    errors: list[str] = []
    if not isinstance(manifest, dict):
        return ["MANIFEST_NOT_OBJECT"]
    if manifest.get("schema") != RUNNER_PIN_SCHEMA:
        errors.append("SCHEMA_INVALID")
    if not isinstance(manifest.get("target"), str) or not manifest["target"].strip():
        errors.append("TARGET_INVALID")
    runners = manifest.get("runners")
    if not isinstance(runners, dict):
        return [*errors, "RUNNERS_INVALID"]
    for runner_id in RUNNER_PIN_IDS:
        row = runners.get(runner_id)
        if not isinstance(row, dict):
            errors.append(f"{runner_id}_MISSING")
            continue
        sha = str(row.get("sha", "")).strip().lower()
        if not __import__("re").match(SHA_PATTERN + r"$", sha):
            errors.append(f"{runner_id}_SHA_INVALID")
        root = str(row.get("releaseRoot", ""))
        if not root:
            errors.append(f"{runner_id}_RELEASE_ROOT_INVALID")
        elif __import__("re").match(SHA_PATTERN + r"$", sha) and not root.replace("\\", "/").endswith(f"/{sha}"):
            errors.append(f"{runner_id}_RELEASE_ROOT_SHA_MISMATCH")
        if row.get("evidenceMode") not in {"legacy", "tick-v1"}:
            errors.append(f"{runner_id}_EVIDENCE_MODE_INVALID")
        if row.get("stopOwner") != RUNNER_STOP_OWNERS[runner_id]:
            errors.append(f"{runner_id}_STOP_OWNER_INVALID")
        if __import__("re").match(SHA_PATTERN + r"$", sha):
            expected_unit = f"{RUNNER_SERVICE_PREFIXES[runner_id]}@{sha}.service"
            if row.get("serviceUnit") != expected_unit:
                errors.append(f"{runner_id}_SERVICE_UNIT_SHA_MISMATCH")
    for runner_id in runners:
        if runner_id not in RUNNER_PIN_IDS:
            errors.append(f"{runner_id}_UNKNOWN")
    return errors


def services_for_runner_pins(manifest: dict) -> dict[str, str]:
    errors = validate_runner_pin_manifest(manifest)
    if errors:
        raise ValueError("RUNNER_PIN_MANIFEST_INVALID:" + ",".join(errors))
    return {label: manifest["runners"][runner_id]["serviceUnit"] for label, runner_id in SERVICE_RUNNER_IDS.items()}


SERVICES = services_for_runner_pins(DEFAULT_RUNNER_PIN_MANIFEST)
STATE = "/var/lib/disdex/shared"


def load_json(path: Path) -> dict:
    result = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(result, dict):
        raise ValueError("NOT_AN_OBJECT")
    return result


def validate_risk_and_protection(
    d: dict,
    v4: dict,
    old: dict,
    now_ms: int,
    runner_pins: dict | None = None,
) -> list[str]:
    blockers: list[str] = []
    runner_pins = DEFAULT_RUNNER_PIN_MANIFEST if runner_pins is None else runner_pins
    pin_errors = validate_runner_pin_manifest(runner_pins)
    if pin_errors:
        blockers.append("RUNNER_PIN_MANIFEST_INVALID")
        return blockers
    services = services_for_runner_pins(runner_pins)
    if d.get("sourceComplete") is not True:
        blockers.append("RISK_SOURCE_INCOMPLETE")
    if d.get("tripped") is not False:
        blockers.append("RISK_TRIPPED_OR_UNKNOWN")
    if d.get("maximumLossPct") != 7.5:
        blockers.append("DAILY_LOSS_7P5_CONTRACT_MISMATCH")
    if not isinstance(d.get("updatedAt"), (int, float)) or not (0 <= now_ms - d["updatedAt"] <= 120000):
        blockers.append("RISK_STATE_STALE")
    expected_utc_day = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc).date().isoformat()
    if d.get("accountScope") != "ASTER_FUTURES" or d.get("utcDay") != expected_utc_day:
        blockers.append("RISK_UTC_DAY_MISMATCH")
    if v4.get("status") != "HEALTHY" or v4.get("effectiveUnprotectedCount") != 0 or v4.get("readOnly") is not True:
        blockers.append("V4_STOP_COMPANION_NOT_VERIFIED")
    if not isinstance(v4.get("checkedAt"), (int, float)) or not (0 <= now_ms - v4["checkedAt"] <= 180000):
        blockers.append("V4_STOP_COMPANION_STALE")
    if v4.get("v4Sha") != runner_pins["runners"]["V12_V4"]["sha"]:
        blockers.append("V4_STOP_COMPANION_SHA_MISMATCH")
    if v4.get("serviceUnit") != services["V4"]:
        blockers.append("V4_STOP_COMPANION_SERVICE_MISMATCH")
    if old.get("ok") is not True or old.get("readOnly") is not True:
        blockers.append("LEGACY_SHARED_STOP_OBSERVER_UNHEALTHY")
    owner_projection = old.get("ownerShaByStrategy")
    if owner_projection is not None:
        expected_owner_projection = {
            "V12": runner_pins["runners"]["V12_V4"]["sha"],
            "Q102": runner_pins["runners"]["QUALITY102_CAUSAL_V1"]["sha"],
            "PENGU": runner_pins["runners"]["PENGU_V8"]["sha"],
            "V52": runner_pins["runners"]["V52"]["sha"],
            "FET": runner_pins["runners"]["FET_BRK48_RESIDUAL"]["sha"],
            "HYPE": runner_pins["runners"]["HYPE_TREND_LONG"]["sha"],
            "IDLE": runner_pins["runners"]["IDLE_PRIORITY_SHORT"]["sha"],
            "RESIDUAL": runner_pins["runners"]["IDLE_PRIORITY_SHORT"]["sha"],
        }
        if owner_projection != expected_owner_projection:
            blockers.append("STOP_OWNER_PIN_PROJECTION_MISMATCH")
    # The legacy observer is expected to move from its known V4 false-positive
    # count to zero when the new writer is active. Accept both phases only when
    # the independent signed venue audit accounts for every pre-cutover false
    # positive; any other non-zero count remains unexplained and blocks.
    original = v4.get("originalUnprotectedCount")
    legacy_count = old.get("unprotectedCount")
    independently_verified = len(v4.get("v4Verified") or [])
    if (not isinstance(original, int) or original < 0
        or not isinstance(legacy_count, int) or legacy_count < 0
        or original not in (0, independently_verified)
        or (legacy_count != 0 and (legacy_count != original or original != independently_verified))):
        blockers.append("LEGACY_V4_STOP_DIAGNOSTICS_INCOHERENT")
    if (not isinstance(original, int) or original < 0
        or original not in (0, independently_verified)):
        blockers.append("UNEXPLAINED_UNPROTECTED_EXPOSURE")
    if v4.get("unresolved"):
        blockers.append("VENUE_UNRESOLVED_PROTECTION")
    return blockers


def verify_live(now_ms: int, runner_pins_path: str | None = None) -> dict:
    blockers: list[str] = []
    evidence: dict = {"checkedAt": now_ms}
    pin_path = str(runner_pins_path or os.environ.get("DISDEX_RUNNER_PINS_PATH", "")).strip()
    runner_pins: dict | None = None
    services: dict[str, str] = {}
    if not pin_path:
        blockers.append("RUNNER_PIN_MANIFEST_REQUIRED")
    else:
        try:
            runner_pins = load_json(Path(pin_path))
            services = services_for_runner_pins(runner_pins)
            evidence["runnerPinManifest"] = pin_path
            evidence["runnerShaById"] = {runner_id: runner_pins["runners"][runner_id]["sha"] for runner_id in RUNNER_PIN_IDS}
        except Exception as error:
            blockers.append("RUNNER_PIN_MANIFEST_UNREADABLE:" + type(error).__name__)
    if not blockers:
        for label, unit in services.items():
            check = subprocess.run(["systemctl", "is-active", unit], text=True, capture_output=True, timeout=6)
            active = check.stdout.strip() == "active"
            evidence[label + "_active"] = active
            if not active:
                blockers.append("INACTIVE_" + label)
    try:
        risk = load_json(Path(STATE) / "crypto-daily-risk.json")
        v4 = load_json(Path(STATE) / "resident-stop-v4-verification.json")
        old = load_json(Path(STATE) / "resident-stop-observation.json")
        if runner_pins is None:
            blockers.append("RISK_STOP_PIN_CONTEXT_MISSING")
        else:
            blockers.extend(validate_risk_and_protection(risk, v4, old, now_ms, runner_pins))
        evidence["riskLossPct"] = risk.get("lossPct")
        evidence["v4Verified"] = len(v4.get("v4Verified") or [])
    except Exception as error:
        blockers.append("RISK_STOP_EVIDENCE_UNREADABLE:" + type(error).__name__)
    try:
        hb = load_json(Path("/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json"))
        q102_sha = runner_pins["runners"]["QUALITY102_CAUSAL_V1"]["sha"] if runner_pins else ""
        if (hb.get("runtimeSha") != q102_sha or hb.get("expectedSha") != q102_sha
            or hb.get("serviceUnit") != services.get("Q102") or hb.get("safetyState") != "HEALTHY"):
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
    base = {"sourceComplete": True, "tripped": False, "maximumLossPct": 7.5, "updatedAt": now, "accountScope": "ASTER_FUTURES", "utcDay": "2026-10-28"}
    v4 = {"status": "HEALTHY", "effectiveUnprotectedCount": 0, "readOnly": True, "checkedAt": now, "v4Sha": V4_SHA,
          "serviceUnit": SERVICES["V4"], "originalUnprotectedCount": 1, "v4Verified": [{"symbol": "DOGEUSDT"}], "unresolved": []}
    old = {"ok": True, "readOnly": True, "unprotectedCount": 1}
    assert validate_risk_and_protection(base, v4, old, now) == []
    assert validate_risk_and_protection(base, v4, {**old, "unprotectedCount": 0}, now) == []
    assert validate_risk_and_protection(base, {**v4, "originalUnprotectedCount": 0}, {**old, "unprotectedCount": 0}, now) == []
    assert "LEGACY_V4_STOP_DIAGNOSTICS_INCOHERENT" in validate_risk_and_protection(base, v4, {**old, "unprotectedCount": 2}, now)
    assert "RISK_TRIPPED_OR_UNKNOWN" in validate_risk_and_protection({**base, "tripped": True}, v4, old, now)
    assert "UNEXPLAINED_UNPROTECTED_EXPOSURE" in validate_risk_and_protection(base, {**v4, "v4Verified": []}, old, now)
    assert "V4_STOP_COMPANION_STALE" in validate_risk_and_protection(base, {**v4, "checkedAt": now - 200000}, old, now)
    assert "DAILY_LOSS_7P5_CONTRACT_MISMATCH" in validate_risk_and_protection({**base, "maximumLossPct": 8}, v4, old, now)
    print("PREFLIGHT_READONLY_SELFTEST_PASS")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--runner-pins", default=None)
    args = parser.parse_args()
    if args.self_test:
        selftest()
        return 0
    result = verify_live(int(time.time() * 1000), args.runner_pins)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["status"] == "READ_ONLY_SOURCE_PREFLIGHT_PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
