"""Read-only Q102 old-writer exclusion observation, not a bootstrap certificate.

This script reports identity/flags/metadata only. No untrusted source is
imported; no process changes, state writes, venue calls or deploy operations.
Even an observed OFF flag is NOT a proof of no writer without full source review.
"""
import argparse
import hashlib
import json
import os
import stat
import time
from pathlib import Path
import re
import subprocess

PINS = Path("/etc/disdex/runner-pins.json")
RELEASES = Path("/home/deploy/disdex-trading/releases")
TARGET = Path("/var/lib/disdex/quality102-causal-v1/stable4-online-state.json")
LEGACY_STATE = Path("/var/lib/disdex/quality102-causal-v1/state.json")
OLD_UNIT_PREFIX = "disdex-quality102-causal-v1@"


def sha40(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def assess(*, expected_sha, pinned_sha, active_state, pid, cwd, mode_flags, new_state_exists):
    if not sha40(expected_sha) or not sha40(pinned_sha):
        raise ValueError("Q102_SOURCE_SHA_INVALID")
    correct = expected_sha == pinned_sha
    real_cwd = RELEASES.as_posix().rstrip('/') + '/' + expected_sha
    mode_off = len(mode_flags) == 1 and mode_flags[0].strip().upper() == "OFF"
    if not correct:
        status = "BLOCKED_Q102_PIN_DRIFT"
    elif new_state_exists:
        status = "BLOCKED_Q102_BOOTSTRAP_DESTINATION_OCCUPIED"
    elif active_state == "active" and pid > 0 and cwd == real_cwd and not mode_off:
        status = "BLOCKED_OLD_Q102_WRITER_EXCLUSION_UNPROVEN"
    elif active_state == "active" and pid > 0 and cwd == real_cwd and mode_off:
        status = "OLD_OFF_FLAG_OBSERVED_WRITER_PROOF_UNVERIFIED"
    elif active_state in ("inactive", "failed") and pid == 0:
        status = "OLD_UNIT_INACTIVE_OTHER_WRITERS_UNVERIFIED"
    else:
        status = "BLOCKED_OLD_Q102_IDENTITY_OR_SERVICE_AMBIGUOUS"
    return {
        "schema": "disdex-stable4-q102-old-writer-readonly/v1",
        "status": status,
        "expectedOldSourceSha": expected_sha,
        "pinMatches": correct,
        "mainPidPresent": type(pid) is int and pid > 0,
        "oldProcessCwdMatchesPin": cwd == real_cwd,
        "oldModeExplicitOffObserved": mode_off,
        "newBootstrapStatePathExists": new_state_exists,
        "sourceParserReviewed": False,
        "writerExclusionCertified": False,
        "bootstrapInstallationAuthorized": False,
        "ordersEnabled": False,
        "productionMutated": False,
    }



def inspect_legacy_state(*, expected_sha, state_path=LEGACY_STATE, now_ms=None):
    """Read legacy state under source hash; never infer venue flatness from it.

    This intentionally cannot release a Writer, install bootstrap state,
    authenticate an Owner approval, or change trading state.
    """
    if not sha40(expected_sha):
        raise ValueError("Q102_SOURCE_SHA_INVALID")
    clock = time.time_ns() // 1_000_000 if now_ms is None else now_ms
    if type(clock) is not int or clock <= 0:
        raise ValueError("Q102_LEGACY_CLOCK_INVALID")
    before = state_path.lstat()
    if (state_path.is_symlink() or not stat.S_ISREG(before.st_mode)
            or before.st_size <= 0 or before.st_size > 2_000_000):
        raise ValueError("Q102_LEGACY_STATE_FILE_UNTRUSTED")
    raw = state_path.read_bytes()
    after = state_path.lstat()
    identity = lambda x: (x.st_dev, x.st_ino, x.st_size, x.st_mtime_ns)
    if identity(before) != identity(after) or len(raw) != before.st_size:
        raise ValueError("Q102_LEGACY_STATE_CHANGED")
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError("Q102_LEGACY_JSON_DUPLICATE")
            out[key] = value
        return out
    def reject_nonfinite(value):
        raise ValueError("Q102_LEGACY_JSON_NONFINITE:" + value)
    data = json.loads(raw, object_pairs_hook=unique,
                      parse_constant=reject_nonfinite)
    if (not isinstance(data, dict) or "position" not in data
            or "pending" not in data):
        raise ValueError("Q102_LEGACY_STATE_SCHEMA_INVALID")
    source_matches = data.get("runtimeCommitSha") == expected_sha
    mode_live = data.get("mode") == "LIVE"
    updated = data.get("updatedAt")
    time_valid = (type(updated) is int and 0 < updated <= clock + 5000)
    age = clock - updated if time_valid else None
    recent = age is not None and -5000 <= age <= 300000
    local_flat = data["position"] is None and data["pending"] is None
    status = ("LEGACY_LOCAL_FLAT_OBSERVED_NOT_VENUE_CERTIFIED"
              if source_matches and mode_live and recent and local_flat
              else "BLOCKED_LEGACY_STATE_OR_FRESHNESS_UNVERIFIED")
    return {
        "schema": "disdex-stable4-q102-legacy-local-state-readonly/v1",
        "status": status,
        "stateSha256": hashlib.sha256(raw).hexdigest(),
        "sourceShaMatchesPin": source_matches,
        "modeLiveObserved": mode_live,
        "updatedAtMs": updated if type(updated) is int else None,
        "stateAgeMs": age,
        "localPositionAbsent": data["position"] is None,
        "localPendingAbsent": data["pending"] is None,
        "localStateFresh": recent,
        "localFlatnessObserved": local_flat,
        "signedVenueFlatnessCertified": False,
        "writerExclusionCertified": False,
        "bootstrapInstallationAuthorized": False,
        "ordersEnabled": False,
        "productionMutated": False,
    }


def observe(*, expected_sha, pins=PINS, target=TARGET, releases=RELEASES,
            proc=Path("/proc"), run=subprocess.run):
    if not sha40(expected_sha):
        raise ValueError("Q102_SOURCE_SHA_INVALID")
    pin_data = json.loads(pins.read_text(encoding="utf-8"))
    pinned = pin_data["runners"]["QUALITY102_CAUSAL_V1"]["sha"]
    unit = OLD_UNIT_PREFIX + expected_sha + ".service"
    response = run(["systemctl", "show", unit, "--property=ActiveState,MainPID", "--no-pager"],
                   capture_output=True, text=True, timeout=15)
    if response.returncode:
        raise RuntimeError("Q102_SYSTEMD_READONLY_UNAVAILABLE")
    pairs = dict(line.split("=", 1) for line in response.stdout.splitlines() if "=" in line)
    pid_field = pairs.get("MainPID", "")
    if not pid_field.isdecimal():
        raise ValueError("Q102_MAIN_PID_UNKNOWN")
    pid = int(pid_field)
    cwd = None
    modes = []
    if pid > 0:
        path = proc / str(pid)
        try:
            cwd = str((path / "cwd").resolve(strict=True))
            environment = (path / "environ").read_bytes().split(b"\0")
            modes = [item.split(b"=", 1)[1].decode("ascii", errors="replace")
                     for item in environment if item.startswith(b"DISDEX_STABLE4_MODE=")]
        except OSError as ex:
            raise RuntimeError("Q102_PROCESS_METADATA_UNAVAILABLE") from ex
    row = assess(expected_sha=expected_sha, pinned_sha=pinned,
                 active_state=pairs.get("ActiveState"), pid=pid,
                 cwd=cwd, mode_flags=modes,
                 new_state_exists=(target.exists() or target.is_symlink()))
    row["observedUnit"] = unit
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--old-sha", required=True)
    args = parser.parse_args()
    observed = observe(expected_sha=args.old_sha)
    try:
        observed["legacyLocalState"] = inspect_legacy_state(expected_sha=args.old_sha)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        observed["legacyLocalState"] = {
            "status": "BLOCKED_Q102_LEGACY_STATE_READ",
            "reason": type(exc).__name__,
            "localFlatnessObserved": False,
            "signedVenueFlatnessCertified": False,
            "writerExclusionCertified": False,
            "bootstrapInstallationAuthorized": False,
        }
    print(json.dumps(observed, indent=2, sort_keys=True))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())