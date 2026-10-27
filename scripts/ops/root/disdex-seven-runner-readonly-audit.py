#!/usr/bin/env python3
"""DisDex read-only audit: seven live runners, margin dependency and V52 forward gate.

Reads only local state and systemd. Does NOT call exchanges, place/cancel orders,
change Gross, activate runners, or alter protective positions. Writes one audit JSON.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from zoneinfo import ZoneInfo

BASE = Path("/var/lib/disdex")
HBS = BASE / "runner-health/heartbeats"
RUNNERS = {
    "V12_V4": "v12-v4.json",
    "PENGU": "pengu-v8.json",
    "Q102": "quality102-causal-v1.json",
    "V52": "v52.json",
    "FET": "fet-brk48-residual.json",
    "HYPE": "hype-trend-long.json",
    "IDLE": "idle-priority-short.json",
}
SHA = re.compile(r"^[a-f0-9]{40}$")
GUARD = re.compile(r"^disdex-v12-v52-margin-guard@([a-f0-9]{40})\.service$")
FRESH_MS = 180_000

def get_json(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))

def age(ts, now):
    try:
        return max(0, int(now - float(ts)))
    except (ValueError, TypeError):
        return 10**15

def systemd(name):
    if not re.fullmatch(r"[A-Za-z0-9_.@-]+", name):
        raise ValueError("invalid-unit")
    fields = ("ActiveState", "MainPID", "NRestarts", "WorkingDirectory", "Requires", "After")
    p = subprocess.run(["systemctl", "show", name,
             *["--property=" + v for v in fields], "--no-pager"],
             capture_output=True, text=True, timeout=8, check=False)
    if p.returncode:
        raise ValueError("systemd-show-failed")
    return dict(line.split("=", 1) for line in p.stdout.splitlines() if "=" in line)

def marker_ok(sha, workdir):
    return (bool(SHA.fullmatch(str(sha)))
            and workdir == "/home/deploy/disdex-trading/releases/" + sha
            and (Path(workdir) / ".disdex-release-sha").read_text().strip() == sha)

def assert_health(hb, unit, now):
    faults = []
    sha = hb.get("runtimeSha")
    if not SHA.fullmatch(str(sha)) or sha != hb.get("expectedSha"):
        faults.append("SHA_PARITY")
    if unit.get("ActiveState") != "active":
        faults.append("NOT_ACTIVE")
    try:
        if int(unit.get("MainPID") or 0) <= 0 or int(unit["MainPID"]) != int(hb.get("mainPid") or 0):
            faults.append("PID_MISMATCH")
    except (ValueError, TypeError):
        faults.append("BAD_PID")
    if hb.get("safetyState") != "HEALTHY" or hb.get("orderPermission") != "ALLOWED":
        faults.append("HEALTH_GATE")
    if age(hb.get("heartbeatAt"), now) > FRESH_MS:
        faults.append("STALE_HEARTBEAT")
    try:
        if not marker_ok(sha, unit.get("WorkingDirectory", "")):
            faults.append("RELEASE_PIN")
    except (FileNotFoundError, PermissionError, OSError):
        faults.append("RELEASE_MISSING")
    return faults

def v52_event():
    p = BASE / "v52-aster-only/audit-live.jsonl"
    try:
        raw = subprocess.run(["tail", "-n", "12", str(p)], capture_output=True,
                             text=True, timeout=8, check=False).stdout.splitlines()
        for line in reversed(raw):
            e = json.loads(line)
            if isinstance(e, dict):
                return {k: e[k] for k in ("event", "timestamp", "referenceFetch",
                        "newOrdersAllowed", "reason") if isinstance(e.get(k), (str, bool))}
    except (ValueError, json.JSONDecodeError, OSError, subprocess.TimeoutExpired):
        pass
    return {}

def audit(now=None):
    now = int(now if now is not None else time.time() * 1000)
    issues = []
    out = {"schema": "disdex-readonly-seven-runner-audit/v1", "asOf": now,
           "runners": {}, "marginDependency": {}, "v52Market": {}, "issues": issues}
    v52 = None
    for name, hbname in RUNNERS.items():
        try:
            hb = get_json(HBS / hbname)
            info = systemd(hb["serviceUnit"])
            faults = assert_health(hb, info, now)
            issues.extend(name + ":" + f for f in faults)
            out["runners"][name] = {
                "sha": hb.get("runtimeSha"), "unit": hb["serviceUnit"],
                "pid": info.get("MainPID"), "restarts": info.get("NRestarts"),
                "heartbeatAgeMs": age(hb.get("heartbeatAt"), now), "ok": not faults,
            }
            if name == "V52":
                v52 = info
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired) as e:
            out["runners"][name] = {"ok": False}
            issues.append(name + ":READ_ERROR:" + type(e).__name__)
    try:
        if not v52:
            raise ValueError("v52-unavailable")
        req = set(v52.get("Requires", "").split())
        aft = set(v52.get("After", "").split())
        targets = sorted(x for x in req if GUARD.fullmatch(x))
        if len(targets) != 1 or targets[0] not in aft:
            raise ValueError("guard-requires-after-mismatch")
        unit_name = targets[0]
        shared_sha = GUARD.fullmatch(unit_name).group(1)
        guard = systemd(unit_name)
        if guard.get("ActiveState") != "active" or int(guard.get("MainPID") or 0) < 1:
            raise ValueError("guard-not-running")
        if not marker_ok(shared_sha, guard.get("WorkingDirectory", "")):
            raise ValueError("guard-release-pin-broken")
        state = get_json(BASE / "shared/margin-risk/guard-live.json")
        if state.get("stage") != "HEALTHY" or state.get("ordersAllowed") is not True:
            raise ValueError("guard-not-healthy")
        max_age = max(360_000, int(state.get("pollIntervalMs") or 300_000) * 2 + 90_000)
        if age(state.get("checkedAt"), now) > max_age:
            raise ValueError("guard-state-stale")
        out["marginDependency"] = {"ok": True, "unit": unit_name,
               "sha": shared_sha, "pid": guard["MainPID"],
               "status": "HEALTHY", "ageMs": age(state["checkedAt"], now)}
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, subprocess.TimeoutExpired) as e:
        issues.append("MARGIN_DEPENDENCY:" + str(e)[:100])
        out["marginDependency"] = {"ok": False}
    for service in ("disdex-stock-reference-free.service", "ai-dex-manager-ui.service"):
        try:
            val = systemd(service)
            if val.get("ActiveState") != "active" or int(val.get("MainPID") or 0) < 1:
                issues.append("SUPPORT_SERVICE_DOWN:" + service)
        except (ValueError, TypeError, subprocess.TimeoutExpired):
            issues.append("SUPPORT_SERVICE_UNVERIFIED:" + service)
    try:
        risk = get_json(BASE / "shared/crypto-daily-risk.json")
        kill = get_json(BASE / "shared/kill-switch.json")
        if kill.get("active") is not False:
            issues.append("SHARED_KILL_ACTIVE_OR_UNKNOWN")
        if risk.get("sourceComplete") is not True or risk.get("tripped") is not False:
            issues.append("SHARED_RISK_BLOCKED_OR_INCOMPLETE")
        if age(risk.get("updatedAt"), now) > FRESH_MS:
            issues.append("SHARED_RISK_STALE")
    except (OSError, ValueError, json.JSONDecodeError):
        issues.append("SHARED_RISK_READ_ERROR")
    try:
        r = get_json(BASE / "v52-aster-only/runner-live.json")
        if r.get("runtimeCommitSha") != out.get("runners", {}).get("V52", {}).get("sha"):
            issues.append("V52_LEDGER_SHA_MISMATCH")
        if r.get("status") != "ready" or r.get("mode") != "LIVE":
            issues.append("V52_NOT_READY")
        if age(r.get("updatedAt"), now) > FRESH_MS:
            issues.append("V52_LEDGER_STALE")
        ny = dt.datetime.fromtimestamp(now / 1000, tz=ZoneInfo("America/New_York"))
        out["v52Market"] = {"nyDate": ny.date().isoformat(), "nyTime": ny.strftime("%H:%M:%S"),
            "nyWeekdaySessionByClock": ny.weekday() < 5 and
                  (9, 30) <= (ny.hour, ny.minute) < (16, 0),
            "v52Status": r.get("status"), "latestEvent": v52_event(),
            "liveOrderLifecycleCertified": False}
    except (OSError, ValueError, json.JSONDecodeError):
        issues.append("V52_LEDGER_READ_ERROR")
    out["status"] = "PASS" if not issues else "ALERT"
    return out

def selftest():
    base = {"runtimeSha": "a"*40, "expectedSha": "a"*40,
        "safetyState": "HEALTHY", "orderPermission": "ALLOWED",
        "heartbeatAt": 1_000_000, "mainPid": 12}
    unit = {"ActiveState": "active", "MainPID": "12",
        "WorkingDirectory": "/home/deploy/disdex-trading/releases/" + "a"*40}
    assert "RELEASE_MISSING" in assert_health(base, unit, 1_001_000)
    assert "STALE_HEARTBEAT" in assert_health(dict(base, heartbeatAt=1), unit, 1_001_000)
    assert "PID_MISMATCH" in assert_health(dict(base, mainPid=13), unit, 1_001_000)
    assert "HEALTH_GATE" in assert_health(dict(base, safetyState="BLOCKED"), unit, 1_001_000)
    assert GUARD.fullmatch("disdex-v12-v52-margin-guard@" + "b"*40 + ".service")
    print("DISDEX_READONLY_SEVEN_RUNNER_AUDIT_SELFTEST_PASS")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--no-write", action="store_true")
    ap.add_argument("--output", default="/var/lib/disdex/ops-audit/seven-runner-latest.json")
    args = ap.parse_args()
    if args.self_test:
        selftest()
        return 0
    value = audit()
    if not args.no_write:
        p = Path(args.output)
        p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(p.parent, 0o700)
        tmp = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=p.parent,
                    prefix=".seven-runner-", suffix=".tmp", delete=False) as f:
                tmp = Path(f.name)
                json.dump(value, f, ensure_ascii=False, separators=(",", ":"))
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, p)
        finally:
            if tmp and tmp.exists():
                tmp.unlink()
    print(json.dumps({"status": value["status"], "asOf": value["asOf"],
        "runnerCount": len(value["runners"]), "issues": value["issues"],
        "marginDependency": value["marginDependency"],
        "v52Market": value["v52Market"]}, ensure_ascii=False))
    return 0 if value["status"] == "PASS" else 2

if __name__ == "__main__":
    sys.exit(main())
