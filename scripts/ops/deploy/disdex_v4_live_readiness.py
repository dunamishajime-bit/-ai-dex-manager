#!/usr/bin/env python3
"""Root-side, read-only readiness inventory. NOT an authorization or deployment.

All evidence is gathered directly from the local VPS. Failure to read any
required datum is a BLOCKER, never proof of readiness. This executable never
writes any file, changes any systemd unit or makes a venue request.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import stat
import subprocess
import time

INSTALLED_SOURCE_MARKER = Path("/usr/local/libexec/disdex-unified/installed-source-sha")
SHA = re.compile(r"^[a-f0-9]{40}$")
ROOT = Path("/var/lib/disdex/unified-deploy")
RELEASES = Path("/home/deploy/disdex-trading/releases")
CURRENT = Path("/home/deploy/disdex-trading/current")
PINS = Path("/etc/disdex/runner-pins.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
RUNTIME_ACTIVATION = Path("/var/lib/disdex/shared/operator-activation/v12-v4-full.json")
PREFIXES = {
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
REQUIRED_ROOT = {
    "ownerSignaturePublicKey": ROOT / "owner-approval-public.pem",
    "currentPlan": ROOT / "current-plan.json",
    "runnerPinManifest": PINS,
    "v4DesiredPlans": ROOT / "plans" / "V12_V4",
    "v4Activations": ROOT / "activations" / "V12_V4",
    "venueBefore": ROOT / "venue-before.json",
    "venueAfter": ROOT / "venue-after.json",
    "v4RuntimeActivation": RUNTIME_ACTIVATION,
}


def _json(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) > 65536:
        raise ValueError("oversized JSON")
    result = json.loads(data)
    if not isinstance(result, dict):
        raise ValueError("JSON document not object")
    return result


def _path(path: Path) -> dict:
    try:
        s = path.lstat()
        kind = "directory" if stat.S_ISDIR(s.st_mode) else (
            "file" if stat.S_ISREG(s.st_mode) else "other"
        )
        return {"present": True, "kind": kind,
                "rootOwned": s.st_uid == 0, "mode": oct(s.st_mode & 0o777)}
    except OSError:
        return {"present": False}


def _unit_states():
    proc = subprocess.run(
        ["/usr/bin/systemctl", "list-units", "--all", "--plain",
         "--no-legend", "--no-pager", "disdex-*.service"],
        capture_output=True, text=True, check=False, timeout=15)
    if proc.returncode:
        raise RuntimeError("systemctl list-units unavailable")
    result = {}
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0].endswith(".service"):
            result[parts[0]] = {"load": parts[1], "active": parts[2],
                                "sub": parts[3]}
    return result


def _installed_candidate_sha(marker: Path = INSTALLED_SOURCE_MARKER) -> str | None:
    try:
        st = marker.lstat()
        if (not stat.S_ISREG(st.st_mode) or st.st_uid != 0
                or st.st_mode & 0o222):
            return None
        value = marker.read_text(encoding="ascii").strip()
        return value if SHA.fullmatch(value) else None
    except OSError:
        return None


def _candidate(sha: str) -> dict:
    if not SHA.fullmatch(sha):
        raise ValueError("candidate SHA invalid")
    root = RELEASES / sha
    x = {"release": _path(root), "marker": _path(root / ".disdex-release-sha"),
         "localRuntime": (root / "node_modules/tsx/dist/cli.mjs").is_file(),
         "sourceGate": (root / "scripts/ops/deploy/disdex_v4_root_cutover.py").is_file(),
         "readyProof": (root / "docs/production/v12-v4-implementation-readiness.json").is_file()}
    try:
        x["markerMatches"] = ((root / ".disdex-release-sha").read_text().strip() == sha)
    except OSError:
        x["markerMatches"] = False
    return x


def assess(raw: dict) -> list[str]:
    blockers: list[str] = []
    if not raw.get("currentReleaseSha"):
        blockers.append("CURRENT_RELEASE_SHA_UNPROVEN")
    if raw.get("killSwitchActive") is not False:
        blockers.append("SHARED_KILL_SWITCH_NOT_HEALTHY")
    for label, value in raw.get("rootPrerequisites", {}).items():
        if not value.get("present"):
            blockers.append("MISSING_" + label)
    for label in REQUIRED_ROOT:
        if label not in raw.get("rootPrerequisites", {}):
            blockers.append("UNREADABLE_" + label)
    units = raw.get("runnerUnits", {})
    for key in PREFIXES:
        instances = units.get(key, [])
        if not instances:
            blockers.append("MISSING_RUNNER_UNIT_" + key)
        elif key == "V12_V4" and not any(x["active"] == "active" for x in instances):
            blockers.append("V4_BASELINE_RUNNER_NOT_ACTIVE")
        elif key != "V12_V4" and not any(x["active"] == "active" for x in instances):
            blockers.append("PEER_RUNNER_NOT_ACTIVE_" + key)
    candidate = raw.get("candidate", {})
    if not (candidate.get("markerMatches") and candidate.get("localRuntime")
            and candidate.get("sourceGate") and candidate.get("readyProof")
            and candidate.get("release", {}).get("rootOwned")):
        blockers.append("CANDIDATE_RELEASE_NOT_CERTIFIED")
    if raw.get("legacyRunnerReleaseOwnership") not in ("all-root-owned",):
        blockers.append("LEGACY_RUNNER_RELEASE_TRUST_TRANSITION_UNPROVEN")
    if not raw.get("auxiliaryLiveRootsVerified"):
        blockers.append("UI_MONITOR_RELEASE_TRUST_UNPROVEN")
    # The authentication ceremony is route-specific.  A Codex deployment is
    # authorized by the root SSH session and the exact runtime activation; an
    # Actions deployment is authorized by its owner-signed grant.  Do not
    # report the Actions-only blocker after a valid Codex cutover.
    authorization = raw.get("authorization", {})
    auth_ok = (
        authorization.get("route") in ("GITHUB_ACTIONS", "CODEX_SSH")
        and authorization.get("authorizationMethod") in
        ("OWNER_SIGNED_TOKEN", "ROOT_SSH_SESSION")
        and authorization.get("approvedSha") == raw.get("candidateSha")
        and authorization.get("ordersEnabled") is True
    )
    if not auth_ok:
        blockers.append("OWNER_SIGNATURE_AND_GITHUB_REVIEW_NOT_ATTESTED")
    blockers.append("VENUE_SIGNED_STOP_PRESERVATION_NOT_ATTESTED")
    return sorted(set(blockers))


def inventory(candidate_sha: str | None = None) -> dict:
    candidate_sha = candidate_sha or _installed_candidate_sha()
    units = _unit_states()
    grouped = {
        key: [{"unit": name, **state} for name, state in sorted(units.items())
              if name.startswith(prefix + "@")]
        for key, prefix in PREFIXES.items()
    }
    try:
        current = CURRENT.resolve(strict=True).name
        if not SHA.fullmatch(current):
            current = None
    except OSError:
        current = None
    try:
        kill = _json(KILL)
        kill_state = kill.get("active")
        if type(kill_state) is not bool:
            kill_state = None
    except (OSError, ValueError, json.JSONDecodeError):
        kill_state = None
    legacy_shas = {
        m.group(1) for name in units
        if (m := re.search(r"@([0-9a-f]{40})\.service$", name))
    }
    ownership = []
    for sha in sorted(legacy_shas):
        path = RELEASES / sha
        meta = _path(path)
        ownership.append({"sha": sha, "rootOwned": meta.get("rootOwned", False),
                          "kind": meta.get("kind", "missing")})
    paths = {key: _path(value) for key, value in REQUIRED_ROOT.items()}
    x = {
        "schema": "disdex-v4-live-readiness-observation/v1",
        "purpose": "READ_ONLY_NO_LIVE_AUTHORIZATION",
        "observedAt": int(time.time()),
        "candidateSha": candidate_sha,
        "currentReleaseSha": current,
        "killSwitchActive": kill_state,
        "rootPrerequisites": paths,
        "runnerUnits": grouped,
        "candidate": (_candidate(candidate_sha) if candidate_sha
                      else {"release": {"present": False}, "markerMatches": False,
                            "localRuntime": False, "sourceGate": False,
                            "readyProof": False}),
        "legacyRunnerReleaseOwnership": (
            "all-root-owned" if ownership and all(r["rootOwned"] for r in ownership)
            else "legacy-deploy-owned-or-absent"),
        "legacyRunnerReleases": ownership,
        "auxiliaryLiveRootsVerified": False,
    }
    try:
        runtime = _json(RUNTIME_ACTIVATION)
        x["authorization"] = {
            key: runtime.get(key)
            for key in ("route", "authorizationMethod", "approvedSha", "ordersEnabled")
        }
    except (OSError, ValueError, json.JSONDecodeError):
        x["authorization"] = {}
    x["blockers"] = assess(x)
    x["status"] = "BLOCKED" if x["blockers"] else "READ_ONLY_PREFLIGHT_NOT_LIVE"
    return x


if __name__ == "__main__":
    print(json.dumps(inventory(), sort_keys=True, separators=(",", ":")))
