"""Verify the independently pinned Q102 process before using its state.

This module is source-only until installed into a separately certified V52
release. It never modifies services, approvals, orders, or the kill switch.
"""
import json
import os
import re
import stat
import subprocess

MANIFEST = "/etc/disdex/runner-pins.json"
ROOT = "/home/deploy/disdex-trading/releases/"
SHA = re.compile(r"^[0-9a-f]{40}$")
PREFIX = {"QUALITY102_CAUSAL_V1": "disdex-quality102-causal-v1",
          "FET_BRK48_RESIDUAL": "disdex-fet-brk48",
          "IDLE_PRIORITY_SHORT": "disdex-idle-priority-short"}


def validate_peer_identity(*, runner, manifest, manifest_uid, manifest_mode, parent_uid, parent_mode,
                           active, pid, service_cwd, process_cwd, marker_sha, state_sha):
    def require(value):
        if not value:
            raise RuntimeError("QUALITY102_PEER_IDENTITY_UNTRUSTED")
    require(manifest_uid == parent_uid == 0 and not (manifest_mode & 0o022) and not (parent_mode & 0o022))
    require(isinstance(manifest, dict) and manifest.get("schema") in
            ("disdex-runner-pin-manifest/v1", "disdex-runner-pin-manifest/v2"))
    require(manifest.get("target") == "professional-dismanager.net")
    require(manifest.get("operatorTarget") in (None, "DD1296_FINAL_ALLIN_10BPS"))
    if manifest["schema"].endswith("/v2"):
        require(manifest.get("operatorTarget") == "DD1296_FINAL_ALLIN_10BPS")
    runners = manifest.get("runners")
    require(runner in PREFIX and isinstance(runners, dict) and isinstance(runners.get(runner), dict))
    pin = runners[runner]
    sha = pin.get("sha")
    require(isinstance(sha, str) and bool(SHA.fullmatch(sha)))
    root = ROOT + sha
    require(pin.get("releaseRoot") == root and pin.get("serviceUnit") ==
            PREFIX[runner] + "@" + sha + ".service")
    require(active is True and isinstance(pid, int) and not isinstance(pid, bool) and pid > 0)
    require(service_cwd == root and process_cwd == root and marker_sha == sha and state_sha == sha)
    return sha


def validate_q102_identity(**kwargs):
    return validate_peer_identity(runner="QUALITY102_CAUSAL_V1", **kwargs)


def _open_regular(path, limit):
    if not hasattr(os, "O_NOFOLLOW"):
        raise RuntimeError("QUALITY102_PEER_IDENTITY_UNTRUSTED")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise RuntimeError("QUALITY102_PEER_IDENTITY_UNTRUSTED")
        data = b""
        while len(data) <= limit:
            chunk = os.read(fd, min(4096, limit + 1 - len(data)))
            if not chunk:
                break
            data += chunk
        if len(data) > limit:
            raise RuntimeError("QUALITY102_PEER_IDENTITY_UNTRUSTED")
        return info, data
    finally:
        os.close(fd)


def verify_peer_identity(runner, state_sha):
    """Use only the root-owned canonical pin and the real peer process."""
    try:
        if runner not in PREFIX:
            raise RuntimeError("QUALITY102_PEER_IDENTITY_UNTRUSTED")
        parent = os.stat("/etc/disdex", follow_symlinks=False)
        if not stat.S_ISDIR(parent.st_mode):
            raise RuntimeError("bad parent")
        meta, raw = _open_regular(MANIFEST, 65536)
        manifest = json.loads(raw)
        pin = manifest["runners"][runner]
        sha = pin["sha"]
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise RuntimeError("bad pin")
        unit = PREFIX[runner] + "@" + sha + ".service"
        result = subprocess.run(["/usr/bin/systemctl", "show", unit, "--property=ActiveState",
                                 "--property=MainPID", "--property=WorkingDirectory"],
                                capture_output=True, text=True, check=True, timeout=5)
        lines = [line.split("=", 1) for line in result.stdout.splitlines() if "=" in line]
        if len(lines) != 3 or len(dict(lines)) != 3:
            raise RuntimeError("bad systemd response")
        values = dict(lines)
        pid = int(values["MainPID"])
        process_cwd = os.readlink(f"/proc/{pid}/cwd")
        _, marker = _open_regular(ROOT + sha + "/.disdex-release-sha", 128)
        return validate_peer_identity(runner=runner, manifest=manifest, manifest_uid=meta.st_uid, manifest_mode=meta.st_mode,
            parent_uid=parent.st_uid, parent_mode=parent.st_mode, active=values["ActiveState"] == "active",
            pid=pid, service_cwd=values["WorkingDirectory"], process_cwd=process_cwd,
            marker_sha=marker.decode("ascii").strip(), state_sha=state_sha)
    except (OSError, ValueError, KeyError, TypeError, UnicodeError, json.JSONDecodeError,
            subprocess.SubprocessError) as error:
        raise RuntimeError("QUALITY102_PEER_IDENTITY_UNTRUSTED") from error


def verify_q102_identity(state_sha):
    return verify_peer_identity("QUALITY102_CAUSAL_V1", state_sha)
