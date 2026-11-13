#!/usr/bin/env python3
"""Bind a GitHub-owned HP approval bridge secret to the existing UI, never trading.

Secret arrives only via protected GitHub Actions environment and SSH stdin.
This helper refuses mismatched releases, unexpected service configuration, and
preexisting different bridge values. All logs exclude secret material.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


ENV_FILE = Path("/etc/disdex/hp-approval.env")
UI_SERVICE = "ai-dex-manager-ui.service"
TRADING_LINK = Path("/home/deploy/disdex-trading/current")
SHA_RE = re.compile(r"[0-9a-f]{40}")
RUN_RE = re.compile(r"[0-9]{1,20}")
BRIDGE_RE = re.compile(r"[0-9a-f]{64}")
PREFIX = "DISDEX_HP_APPROVAL_BRIDGE_SECRET="


def command(*args: str) -> str:
    result = subprocess.run(args, check=True, text=True, capture_output=True, timeout=25)
    return result.stdout.strip()


def atomic_replace(data: bytes) -> None:
    fd, name = tempfile.mkstemp(prefix=".hp-approval-bridge-", dir=str(ENV_FILE.parent))
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chown(name, 0, 0)
        os.replace(name, ENV_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def check_health(bridge: str) -> None:
    last_error: Exception | None = None
    for _ in range(40):
        try:
            if command("systemctl", "is-active", UI_SERVICE) != "active":
                raise RuntimeError("UI service is not active")
            for target in ("/", "/production-approval"):
                req = urllib.request.Request(
                    "http://127.0.0.1:3001" + target,
                    headers={"Cookie": "disdex_auth=1"},
                )
                with urllib.request.urlopen(req, timeout=4) as res:
                    if res.status != 200:
                        raise RuntimeError(f"UI route {target} HTTP {res.status}")
            break
        except Exception as error:
            last_error = error
            time.sleep(1)
    else:
        raise RuntimeError("UI health failed after restart") from last_error

    pid = int(command("systemctl", "show", UI_SERVICE, "--property=MainPID", "--value"))
    if pid <= 1:
        raise RuntimeError("UI MainPID invalid")
    proc_env = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
    if b"DISDEX_HP_APPROVAL_BRIDGE_SECRET=" + bridge.encode("ascii") not in proc_env:
        raise RuntimeError("HP bridge variable not loaded into UI process")

    # Invalid JSON is read-only. An authenticated API must reject it with 400;
    # an absent/mismatched bridge returns 401/503.
    req = urllib.request.Request(
        "http://127.0.0.1:3001/api/system/deploy-approval",
        data=b"{invalid-json",
        method="POST",
        headers={
            "Authorization": "Bearer " + bridge,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            status = res.status
    except urllib.error.HTTPError as error:
        status = error.code
    if status != 400:
        raise RuntimeError(f"HP approval bridge authorization failed, HTTP {status}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-ui-sha", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    if not SHA_RE.fullmatch(args.expected_ui_sha) or not RUN_RE.fullmatch(args.run_id):
        raise SystemExit("INVALID_RELEASE_BINDING")

    bridge = sys.stdin.buffer.read(256).decode("ascii").strip()
    if not BRIDGE_RE.fullmatch(bridge):
        raise SystemExit("BRIDGE_SECRET_FORMAT_INVALID")

    if not ENV_FILE.is_file() or ENV_FILE.is_symlink():
        raise SystemExit("HP_APPROVAL_ENV_MISSING_OR_SYMLINK")
    stat = ENV_FILE.stat()
    if stat.st_uid != 0 or stat.st_mode & 0o077:
        raise SystemExit("HP_APPROVAL_ENV_INSECURE_PERMISSIONS")
    ui_workdir = Path(command("systemctl", "show", UI_SERVICE, "--property=WorkingDirectory", "--value"))
    actual_sha = (ui_workdir / ".disdex-release-sha").read_text(encoding="ascii").strip()
    if actual_sha != args.expected_ui_sha:
        raise SystemExit("UI_RELEASE_SHA_CHANGED_ABORT")
    trading_before = str(TRADING_LINK.resolve(strict=True))

    old = ENV_FILE.read_bytes()
    text = old.decode("utf-8")
    for required in ("DISDEX_DEPLOY_OTP_PEPPER=", "DISDEX_HP_APPROVER_PRIVATE_KEY_PATH=",
                     "DISDEX_DEPLOY_APPROVAL_STORE_PATH="):
        if text.count(required) != 1:
            raise SystemExit("HP_APPROVAL_EXISTING_ENV_INVALID")
    matches = [line for line in text.splitlines() if line.startswith(PREFIX)]
    if len(matches) > 1:
        raise SystemExit("HP_BRIDGE_DUPLICATE_KEYS")
    if matches and matches[0] != PREFIX + bridge:
        raise SystemExit("HP_BRIDGE_DIFFERENT_SECRET_REFUSE_TO_OVERWRITE")

    changed = not matches
    backup_dir = Path("/var/lib/disdex-hp-deploy") / ("hp-bridge-" + args.run_id)
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chmod(backup_dir, 0o700)
    backup = backup_dir / "hp-approval.env.before"
    with backup.open("xb") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(old)
        output.flush()
        os.fsync(output.fileno())

    try:
        if changed:
            updated = (text.rstrip("\n") + "\n" + PREFIX + bridge + "\n").encode("utf-8")
            atomic_replace(updated)
        subprocess.run(["systemctl", "restart", UI_SERVICE], check=True, timeout=30)
        check_health(bridge)
        after_sha = (ui_workdir / ".disdex-release-sha").read_text(encoding="ascii").strip()
        if after_sha != args.expected_ui_sha:
            raise RuntimeError("UI release SHA drift")
        if str(TRADING_LINK.resolve(strict=True)) != trading_before:
            raise RuntimeError("Trading release symlink changed")
    except Exception:
        if changed:
            atomic_replace(old)
        try:
            subprocess.run(["systemctl", "restart", UI_SERVICE], check=True, timeout=30)
        finally:
            print("HP_BRIDGE_ROLLBACK_ATTEMPTED=TRUE", flush=True)
        raise

    print("HP_APPROVAL_BRIDGE_CONFIGURED=TRUE")
    print("UI_HTTP_200=TRUE")
    print("HP_BRIDGE_AUTH_400_AS_EXPECTED=TRUE")
    print("TRADING_RELEASE_UNCHANGED=TRUE")
    print("TRADING_SERVICE_NOT_RESTARTED=TRUE")
    print("ORDERS_SENT_BY_BRIDGE_SETUP=0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
