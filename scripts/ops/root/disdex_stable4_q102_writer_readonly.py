"""Read-only Q102 old-writer exclusion observation, not a bootstrap certificate.

This script reports identity/flags/metadata only. No untrusted source is
imported; no process changes, state writes, venue calls or deploy operations.
Even an observed OFF flag is NOT a proof of no writer without full source review.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

PINS = Path("/etc/disdex/runner-pins.json")
RELEASES = Path("/home/deploy/disdex-trading/releases")
TARGET = Path("/var/lib/disdex/quality102-causal-v1/stable4-online-state.json")
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
    print(json.dumps(observe(expected_sha=args.old_sha), indent=2, sort_keys=True))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())