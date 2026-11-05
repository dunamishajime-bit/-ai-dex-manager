"""Scoped, no-order switch of an already verified standalone HP build."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import time
from types import SimpleNamespace
import urllib.error
import urllib.request

from disdex_deployment_plan import approve_diff, canonical
from disdex_deployment_serialization import deployment_lock
from disdex_shared_risk_monitor_wiring import atomic_text
from disdex_shared_risk_witness import ProductionSharedRiskReader
from disdex_unified_root_gate import (
    ROOT, assert_codex_ssh_session, assert_regular_secure, build_codex_ssh_authorization,
    read_root_json, _consume_codex_ssh_nonce,
)

UNIT = "ai-dex-manager-ui.service"
UI_ROOT = Path("/home/deploy/disdex-trading/ui-releases")
DATA = Path("/home/deploy/disdex-ui/shared/data")
SESSION = Path("/etc/disdex/hp-owner-session.env")
PINS = Path("/etc/disdex/runner-pins.json")
TRADING_CURRENT = Path("/home/deploy/disdex-trading/current")


def require(condition, reason):
    if not condition:
        raise ValueError("HP_CUTOVER_" + reason)


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def systemctl(*args):
    return subprocess.run(["/usr/bin/systemctl", *args], check=True,
                          capture_output=True, text=True, timeout=55).stdout.strip()


def property_value(name):
    return systemctl("show", UNIT, "-p", name, "--value")


def render_dropin(raw, current, target):
    text = raw.decode("utf8")
    old_line = "WorkingDirectory=" + str(current)
    lines = text.splitlines()
    commands = [line for line in lines if line.startswith("ExecStart=") and line != "ExecStart="]
    require(lines.count(old_line) == 1 and lines.count("ExecStart=") == 1 and len(commands) == 1,
            "EFFECTIVE_DROPIN_STRUCTURE")
    require(lines.count("[Service]") == 1 and all(not line.startswith("EnvironmentFile=" + str(SESSION))
            for line in lines), "EFFECTIVE_DROPIN_SCOPE")
    lines[lines.index(old_line)] = "WorkingDirectory=" + str(target)
    lines[lines.index(commands[0])] = "ExecStart=/usr/bin/node " + str(target / "server.js")
    lines.insert(lines.index("[Service]") + 1, "EnvironmentFile=" + str(SESSION))
    return ("\n".join(lines) + "\n").encode("utf8")


def trading_context():
    value = ProductionSharedRiskReader().read_context()
    value.pop("pendingHash")
    value["pinsHash"] = sha256(PINS.read_bytes())
    value["current"] = str(TRADING_CURRENT.resolve(strict=True))
    return value


def root_metadata(path, private=False):
    row = assert_regular_secure(path, root_uid=0, private=private)
    return row.st_uid, row.st_gid, stat.S_IMODE(row.st_mode)


def write_exclusive(path, raw, mode):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "wb") as file:
        file.write(raw)
        file.flush()
        os.fsync(file.fileno())


def ensure_session_key():
    if not SESSION.exists() and not SESSION.is_symlink():
        write_exclusive(SESSION, ("DISDEX_OWNER_SESSION_HMAC_KEY=" + secrets.token_urlsafe(48) + "\n").encode(), 0o600)
    require(root_metadata(SESSION, private=True)[2] == 0o600, "SESSION_KEY_FILE_MODE")
    raw = SESSION.read_bytes().strip()
    key = raw.removeprefix(b"DISDEX_OWNER_SESSION_HMAC_KEY=")
    require(raw != key and len(key) >= 43 and all(chr(c).isalnum() or c in b"_-"
            for c in key) and key.isascii(), "SESSION_KEY_FILE_FORMAT")


def verify_serving(target):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for _ in range(20):
        try:
            with opener.open("http://127.0.0.1:3001/login", timeout=3) as result:
                if result.status == 200 and b"Professional DisManager" in result.read(65536):
                    break
        except urllib.error.URLError:
            pass
        time.sleep(1)
    else:
        raise ValueError("HP_CUTOVER_LOGIN_NOT_SERVED")
    pid = int(property_value("MainPID"))
    require(pid > 0 and property_value("ActiveState") == "active"
            and Path(f"/proc/{pid}/cwd").resolve(strict=True) == target, "ACTIVE_PID_CWD")
    req = urllib.request.Request("http://127.0.0.1:3001/api/system/runner-health",
                                 headers={"Cookie": "disdex_auth=1"})
    try:
        with opener.open(req, timeout=5):
            pass
    except urllib.error.HTTPError as error:
        require(error.code in (401, 403), "LEGACY_COOKIE_REJECTION_STATUS")
    else:
        raise ValueError("HP_CUTOVER_LEGACY_COOKIE_ACCEPTED")
    return pid


def cutover(sha, archive_hash, expected_plan_hash):
    target = UI_ROOT / ("ui-hp-immutable-" + sha)
    require(target.resolve(strict=True) == target and target.stat().st_uid == 0
            and target.stat().st_mode & 0o222 == 0, "IMMUTABLE_TARGET")
    build = read_root_json(target / ".disdex-ui-build.json", private=False)
    require(build.get("sourceSha") == sha and build.get("archiveSha256") == archive_hash
            and build.get("authorizesTrading") is False and build.get("scope") == "HP_ONLY",
            "BUILD_PROVENANCE")
    root_metadata(target / "server.js")
    require((target / ".disdex-release-sha").read_text().strip() == sha, "TARGET_MARKER")
    current_path = ROOT / "current-plan.json"
    current_raw = current_path.read_bytes()
    current = read_root_json(current_path)
    pid = int(property_value("MainPID"))
    old = Path(property_value("WorkingDirectory"))
    require(pid > 0 and old.parent == UI_ROOT and old != target and old.resolve(strict=True) == old
            and Path(f"/proc/{pid}/cwd").resolve(strict=True) == old, "EXISTING_UI_IDENTITY")
    require((old / "data").is_symlink() and (old / "data").resolve(strict=True) == DATA
            and DATA.is_dir() and DATA.resolve(strict=True) == DATA, "PERSISTENT_DATA_BINDING")
    paths = [Path(item) for item in property_value("DropInPaths").split()]
    require(paths and paths[-1].parent == Path("/etc/systemd/system") / (UNIT + ".d"), "EFFECTIVE_DROPIN")
    path = paths[-1]
    metadata = root_metadata(path)
    before = path.read_bytes()
    after = render_dropin(before, old, target)
    next_current = {**current, "uiSha": sha, "releaseRoots": {**current["releaseRoots"], "ui": str(target)}}
    desired = {**next_current, "sourceSha": sha, "scope": "HP_ONLY", "ordersEnabled": False}
    approve_diff(desired, current)
    context = trading_context()
    observed_pins = {key: value["sha"] for key, value in context["peers"].items()}
    observed_pins["SHARED_CRYPTO_RISK"] = context["writer"]["sha"]
    require(current["runners"] == observed_pins, "REGISTRY_RUNNER_PINS")
    plan = dict(desired=desired, beforeRegistryHash=sha256(current_raw), currentUiPid=pid,
                currentUiRoot=str(old), dropin=str(path), beforeDropinHash=sha256(before),
                afterDropinHash=sha256(after), archiveSha256=archive_hash, dataRoot=str(DATA),
                sessionKeyPath=str(SESSION), tradingContext=context)
    plan_hash = sha256(canonical(plan))
    if expected_plan_hash is None:
        return dict(status="HP_ONLY_PREVIEW", planSha256=plan_hash, uiSha=sha, ordersEnabled=False)
    require(plan_hash == expected_plan_hash, "PLAN_CHANGED")
    auth = build_codex_ssh_authorization(SimpleNamespace(route="CODEX_SSH", owner="codex-ssh",
        _codex_ssh_authenticated=True, scope="HP_ONLY", orders_enabled="false", sha=sha,
        plan_sha256=plan_hash))
    _consume_codex_ssh_nonce(ROOT / "nonces", auth["nonce"], root_uid=0)
    audit = ROOT / "receipts" / ("hp-only-" + sha + "-" + auth["nonce"][:8])
    audit.mkdir(mode=0o700)
    write_exclusive(audit / "plan.json", canonical(plan), 0o400)
    write_exclusive(audit / "dropin.before", before, 0o400)
    write_exclusive(audit / "registry.before", current_raw, 0o400)
    ensure_session_key()
    link = target / "data"
    if not link.exists() and not link.is_symlink():
        link.symlink_to(DATA, target_is_directory=True)
    require(link.is_symlink() and link.lstat().st_uid == 0 and link.resolve(strict=True) == DATA,
            "NEW_PERSISTENT_DATA_BINDING")
    changed = False
    registry_after = canonical(next_current) + b"\n"
    registry_meta = root_metadata(current_path, private=True)
    try:
        require(trading_context() == context and current_path.read_bytes() == current_raw
                and path.read_bytes() == before and int(property_value("MainPID")) == pid, "BASELINE_CHANGED")
        atomic_text(path, after, metadata)
        changed = True
        systemctl("daemon-reload")
        require(property_value("WorkingDirectory") == str(target)
                and str(target / "server.js") in property_value("ExecStart"), "EFFECTIVE_TARGET")
        systemctl("restart", UNIT)
        new_pid = verify_serving(target)
        require(trading_context() == context and current_path.read_bytes() == current_raw, "TRADING_CONTEXT_CHANGED")
        atomic_text(current_path, registry_after, registry_meta)
    except Exception:
        if changed:
            actual_registry = current_path.read_bytes()
            require(actual_registry in (current_raw, registry_after), "ROLLBACK_REGISTRY_CHANGED")
            if actual_registry == registry_after:
                atomic_text(current_path, current_raw, registry_meta)
            require(path.read_bytes() == after, "ROLLBACK_DROPIN_CHANGED")
            atomic_text(path, before, metadata)
            systemctl("daemon-reload")
            systemctl("restart", UNIT)
        raise
    result = dict(status="HP_ONLY_PRODUCTION_HTTP_VERIFIED", uiSha=sha, uiPid=new_pid,
        planSha256=plan_hash, ordersEnabled=False, ordersSent=0, cancelsSent=0, positionChangesSent=0,
        authenticatedOwnerSessionObserved=False, priorTradingAuthorityPreserved=True)
    write_exclusive(audit / "receipt.json", canonical(result), 0o400)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    parser.add_argument("--archive-sha256", required=True)
    parser.add_argument("--plan-sha256")
    args = parser.parse_args()
    for value, size in ((args.sha, 40), (args.archive_sha256, 64)):
        require(len(value) == size and all(ch in "0123456789abcdef" for ch in value), "HASH_FORMAT")
    assert_codex_ssh_session()
    with deployment_lock(ROOT, "HP_ONLY", False):
        print(json.dumps(cutover(args.sha, args.archive_sha256, args.plan_sha256), sort_keys=True))


if __name__ == "__main__":
    main()
