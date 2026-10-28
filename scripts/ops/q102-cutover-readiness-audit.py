#!/usr/bin/env python3
"""Read-only Q102 cutover gate inventory; never activates or mutates trading.

This is an evidence preflight, NOT an operator authorization or a promoter.
Every input is treated as untrusted and must be independently certified.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

SHA = re.compile(r"^[a-f0-9]{40}$")
RUNNER = "QUALITY102_CAUSAL_V1"
READINESS_SCHEMA = "disdex-current-implementation-readiness/v1"

@dataclass(frozen=True)
class Inputs:
    old_sha: str
    target_sha: str
    old_release: Path
    staged_release: Path
    q102_state: Path
    global_operator_approval: Path
    q102_operator_approval: Path
    shared_kill_switch: Path
    shared_daily_risk: Path

def load_json(path: Path) -> dict:
    if path.is_symlink():
        raise ValueError("SYMLINK_REJECTED")
    result = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(result, dict):
        raise ValueError("NOT_JSON_OBJECT")
    return result

def audit(i: Inputs) -> dict:
    errors: list[str] = []
    def check(condition: bool, reason: str) -> None:
        if not condition:
            errors.append(reason)
    def read(path: Path, label: str) -> dict:
        try:
            return load_json(path)
        except (OSError, ValueError, json.JSONDecodeError) as e:
            errors.append(f"{label}_NOT_READABLE:{type(e).__name__}")
            return {}

    check(bool(SHA.fullmatch(i.old_sha)) and bool(SHA.fullmatch(i.target_sha))
          and i.old_sha != i.target_sha, "EXACT_DISTINCT_SHAS_REQUIRED")
    check(i.old_release.is_dir() and not i.old_release.is_symlink(),
          "OLD_RELEASE_NOT_ISOLATED_DIRECTORY")
    check(i.staged_release.is_dir() and not i.staged_release.is_symlink(),
          "CANDIDATE_NOT_ISOLATED_DIRECTORY")
    for label, path, expected in (
        ("OLD_RELEASE", i.old_release, i.old_sha),
        ("TARGET_STAGE", i.staged_release, i.target_sha),
    ):
        try:
            marker = path / ".disdex-release-sha"
            check(not marker.is_symlink() and marker.read_text().strip() == expected,
                  f"{label}_MARKER_SHA_MISMATCH")
        except OSError:
            errors.append(f"{label}_MARKER_MISSING")

    readiness = read(i.staged_release / "docs/production/current-implementation-readiness.json",
                     "CANDIDATE_READINESS")
    check(readiness.get("schema") == READINESS_SCHEMA
          and readiness.get("implementationStatus") == "READY",
          "CANDIDATE_IMPLEMENTATION_NOT_READY")
    blockers = readiness.get("blockers")
    check(isinstance(blockers, list) and
          set(blockers) <= {"OPERATOR_LIVE_ACTIVATION_REQUIRED"},
          "CANDIDATE_HAS_OTHER_BLOCKERS")

    state = read(i.q102_state, "Q102_DURABLE_STATE")
    check(state.get("runtimeCommitSha") == i.old_sha, "Q102_STATE_NOT_OLD_SHA")
    check(state.get("mode") == "LIVE", "Q102_STATE_NOT_LIVE")
    check(not state.get("position") and not state.get("pending"),
          "Q102_EXPOSURE_OR_PENDING_NOT_FLAT")

    global_gate = read(i.global_operator_approval, "SHARED_OPERATOR_GATE")
    check(global_gate.get("approvedSha") == i.old_sha,
          "SHARED_OPERATOR_GATE_CHANGED_OR_UNEXPECTED")
    check(RUNNER in (global_gate.get("approvedRunners") or []),
          "SHARED_OPERATOR_Q102_NOT_APPROVED")
    check(global_gate.get("ordersEnabled") is True,
          "SHARED_OPERATOR_ORDERS_DISABLED")

    dedicated = read(i.q102_operator_approval, "Q102_SCOPED_OPERATOR_GATE")
    check(dedicated.get("schema") == "disdex-live-operator-activation/v1"
          and dedicated.get("approvedSha") == i.target_sha,
          "Q102_SCOPED_OPERATOR_SHA_OR_SCHEMA_MISMATCH")
    check(dedicated.get("approvedRunners") == [RUNNER],
          "Q102_SCOPED_OPERATOR_MUST_ONLY_APPROVE_Q102")
    check(dedicated.get("ordersEnabled") is True,
          "Q102_SCOPED_OPERATOR_NOT_ARMED")
    check(dedicated.get("target") == readiness.get("target"),
          "Q102_SCOPED_OPERATOR_TARGET_MISMATCH")
    check(dedicated.get("operatorAcknowledgement") ==
          "I_ACK_REAL_MONEY_LIVE_ACTIVATION",
          "Q102_SCOPED_OPERATOR_ACK_MISSING")
    try:
        mode = i.q102_operator_approval.stat().st_mode
        owner = i.q102_operator_approval.stat().st_uid
        check(owner == 0 and (mode & 0o022) == 0,
              "Q102_SCOPED_OPERATOR_NOT_ROOT_PROTECTED")
    except OSError:
        errors.append("Q102_SCOPED_OPERATOR_FILE_MISSING")

    kill = read(i.shared_kill_switch, "SHARED_KILL_SWITCH")
    check(kill.get("active") is False, "SHARED_KILL_SWITCH_ACTIVE_OR_UNPROVEN")
    risk = read(i.shared_daily_risk, "SHARED_DAILY_RISK")
    try:
        loss, limit = float(risk.get("lossPct")), float(risk.get("maximumLossPct"))
        check(0 <= loss < limit <= 7.5 and risk.get("tripped") is False,
              "SHARED_DAILY_RISK_UNSAFE")
    except (ValueError, TypeError):
        errors.append("SHARED_DAILY_RISK_NOT_NUMERIC")

    # Not sufficient for permission to mutate: a genuine signed Aster GET,
    # exact latest integrated 10bps/30bps economics, promotion journal,
    # systemd lineage, and live lock/margin/STOP inspection remain external.
    return {
        "status": ("Q102_LOCAL_PRECHECK_PASS_NOT_AUTHORIZED_TO_DEPLOY"
                   if not errors else "Q102_LOCAL_PRECHECK_BLOCKED"),
        "oldSha": i.old_sha,
        "targetSha": i.target_sha,
        "blockers": errors,
        "venueCertified": False,
        "economicBtCertified": False,
        "deploymentAuthorized": False,
        "ordersSent": 0,
        "cancelsSent": 0,
        "positionChangesSent": 0,
    }

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--old-sha", required=True)
    p.add_argument("--target-sha", required=True)
    p.add_argument("--old-release", required=True, type=Path)
    p.add_argument("--staged-release", required=True, type=Path)
    p.add_argument("--q102-state", type=Path,
                   default=Path("/var/lib/disdex/quality102-causal-v1/state.json"))
    p.add_argument("--global-operator-approval", type=Path,
                   default=Path("/var/lib/disdex/shared/operator-activation/current.json"))
    p.add_argument("--q102-operator-approval", type=Path,
                   default=Path("/var/lib/disdex/quality102-causal-v1/operator-activation/current.json"))
    p.add_argument("--shared-kill-switch", type=Path,
                   default=Path("/var/lib/disdex/shared/kill-switch.json"))
    p.add_argument("--shared-daily-risk", type=Path,
                   default=Path("/var/lib/disdex/shared/crypto-daily-risk.json"))
    args = p.parse_args()
    outcome = audit(Inputs(
        old_sha=args.old_sha, target_sha=args.target_sha,
        old_release=args.old_release, staged_release=args.staged_release,
        q102_state=args.q102_state,
        global_operator_approval=args.global_operator_approval,
        q102_operator_approval=args.q102_operator_approval,
        shared_kill_switch=args.shared_kill_switch,
        shared_daily_risk=args.shared_daily_risk,
    ))
    print(json.dumps(outcome, sort_keys=True))
    return 0 if outcome["status"] == "Q102_LOCAL_PRECHECK_PASS_NOT_AUTHORIZED_TO_DEPLOY" else 2

if __name__ == "__main__":
    sys.exit(main())
