"""HYPE_TREND_LONG-only protected-hold cutover.

Requires a fresh exact owner/SSH authority, signed flat venue evidence and a
pre-existing GLOBAL HOLD_PROTECTED. Never clears the hold or submits orders.
Does not touch other runners, the current symlink or other STOP owners.
"""
from __future__ import annotations
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from disdex_deployment_plan import canonical, digest

RUNNER = "HYPE_TREND_LONG"
OLD = "7688ed7c93a1918d8b44837339b7da5584a868f5"
SERVICE = "disdex-hype-long"
STATE = Path("/var/lib/disdex/hype-zec-long/runner.json")
KILL = Path("/var/lib/disdex/shared/kill-switch.json")
MARGIN = Path("/var/lib/disdex/shared/margin-risk/guard-live.json")
PENDING = Path("/var/lib/disdex/shared/pending-exposure.json")
TICK = Path("/var/lib/disdex/runner-health/ticks/hype-trend-long.json")
SDK_SHA = "7b7719c65d2c6116d02463fc4603200f28e20762"
SHA = re.compile(r"^[a-f0-9]{40}$")


def require(condition, reason):
    if not condition:
        raise ValueError("HYPE_SCOPED_" + reason)


def validate_hype_plan(desired, current, pins, target_sha):
    plan_hash, changes = digest(desired, current)
    require(desired["scope"] == RUNNER and desired["ordersEnabled"] is True,
            "LIVE_SCOPE_AND_PERMISSION")
    require(desired["sourceSha"] == target_sha == desired["runners"][RUNNER],
            "EXACT_SOURCE_SHA")
    require(current["runners"] == pins and pins[RUNNER] == OLD,
            "PIN_BASELINE_CHANGED")
    require(changes["changedRunners"] == [RUNNER]
            and not changes["uiChanged"] and not changes["monitorChanged"]
            and not changes["releaseRootsChanged"], "HYPE_ONLY_DELTA")
    return plan_hash


def validate_flat_hype_state(row, expected):
    require(isinstance(row, dict) and row.get("schema") == "disdex-hype-zec-long/v1"
            and row.get("runtimeCommitSha") == expected and row.get("mode") == "LIVE",
            "LEDGER_LINEAGE")
    require(row.get("positions") in (None, []) and not row.get("pending")
            and not row.get("manualReview")
            and isinstance(row.get("failures"), list), "LEDGER_NOT_FLAT")
    require(type(row.get("updatedAt")) is int and row["updatedAt"] > 0,
            "LEDGER_TIMESTAMP")
    return row


def valid_hold(row):
    require(isinstance(row, dict) and row.get("active") is True
            and row.get("action") == "HOLD_PROTECTED"
            and row.get("scope") == "GLOBAL", "GLOBAL_PROTECTED_HOLD_REQUIRED")
    return row


def validate_hype_tick(row, *, sha, pid, release, previous=None):
    now = time.time_ns() // 1000000
    require(isinstance(row, dict) and row.get("schema") == "disdex-runner-tick/v1"
            and row.get("runnerId") == RUNNER and row.get("runtimeSha") == sha
            and row.get("expectedSha") == sha
            and row.get("serviceUnit") == SERVICE + "@" + sha + ".service"
            and row.get("workingDirectory") == str(release)
            and row.get("mainPid") == pid
            and row.get("newOrdersAllowed") is False,
            "TICK_IDENTITY_OR_AUTHORITY")
    started, completed = row.get("tickStartedAt"), row.get("tickCompletedAt")
    require(type(started) is int and type(completed) is int
            and started <= completed and 0 <= now - completed <= 120000
            and (previous is None or completed > previous), "TICK_TIME_NOT_ADVANCING")
    require(row.get("status") not in ("manual-review", "fatal", "")
            and isinstance(row.get("status"), str), "TICK_RUNNER_FAIL_CLOSED")
    for key in ("ordersSent", "cancelsSent", "positionChangesSent"):
        require(row.get(key, 0) == 0 and type(row.get(key, 0)) is int,
                "TICK_MUTATION_TELEMETRY")
    return completed


def _safe_bytes(path):
    from disdex_shared_risk_witness import file_bytes
    return file_bytes(path)


def _atomic(path, data, stat_before):
    from disdex_shared_risk_monitor_wiring import atomic_text
    atomic_text(path, data, (stat_before.st_uid, stat_before.st_gid,
                             stat_before.st_mode & 0o777))


def _root_file(path, raw, mode, created):
    from disdex_pending_maintenance_install import _new_file
    _new_file(path, raw, mode, lambda: created.append(path))


def _runtime_env(old_raw, old_sha, new_sha, release):
    # Preserve foreign peer-specific identities and economic settings.
    values = {
        "DISDEX_RELEASE_SHA": new_sha,
        "DISDEX_RUNTIME_SHA": new_sha,
        "DISDEX_RUNTIME_COMMIT_SHA": new_sha,
        "DISDEX_RELEASE_ROOT": str(release),
        "DISDEX_HYPE_ZEC_RUNTIME_SHA": new_sha,
        "DISDEX_HYPE_ZEC_ENABLED": "true",
        "DISDEX_HYPE_ZEC_MODE": "LIVE",
        "DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED": "true",
        "DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED": "true",
        "DISDEX_HYPE_ZEC_OPERATOR_ARMED": "true",
        "DISDEX_HYPE_ZEC_SIGNAL_MODE": "TREND",
        "DISDEX_HYPE_ZEC_SYMBOLS": "HYPEUSDT",
        "DISDEX_RUNNER_TICK_HEARTBEAT_ROOT": "/var/lib/disdex/runner-health",
    }
    lines = old_raw.decode("utf8").splitlines()
    seen = {}
    out = []
    for line in lines:
        key, sep, value = line.partition("=")
        if not sep:
            out.append(line)
            continue
        require(not any(name in key.upper() for name in
                    ("PRIVATE_KEY", "API_SECRET", "PASSWORD", "ACCESS_TOKEN", "AUTH_TOKEN")),
                "CREDENTIAL_IN_RUNTIME_OVERRIDE")
        if key in seen:
            require(seen[key] == value, "CONFLICTING_DUPLICATE_ENVIRONMENT_KEY")
            continue
        seen[key] = value
        if key == "DISDEX_HYPE_ZEC_CORE_PREEMPT_SCRIPT":
            value = value.replace("/" + old_sha + "/", "/" + new_sha + "/")
        if key in values:
            value = values.pop(key)
        out.append(key + "=" + value)
    out.extend(k + "=" + v for k, v in values.items())
    return ("\n".join(out) + "\n").encode()


def build_activation(desired, authority, inventory_digest, at):
    sha = desired["sourceSha"]
    require(authority.get("sourceSha") == sha
            and authority.get("scope") == RUNNER
            and authority.get("planSha256") == hashlib.sha256(canonical(desired)).hexdigest()
            and authority.get("ordersEnabled") is True
            and authority.get("route") in ("CODEX_SSH", "GITHUB_ACTIONS")
            and type(authority.get("issuedAt")) is int
            and type(authority.get("expiresAt")) is int
            and authority["issuedAt"] <= at < authority["expiresAt"]
            and authority["expiresAt"] - authority["issuedAt"] <= 300,
            "EXACT_FRESH_APPROVAL_REQUIRED")
    return {
        "schema": "disdex-live-operator-activation/v1",
        "target": "DD1296_FINAL_ALLIN_10BPS",
        "approvedSha": sha,
        "approvedRunners": [RUNNER],
        "approvedShaByRunner": {RUNNER: sha},
        "activationClass": "FULL_LIVE",
        "operatorAcknowledgement": "I_ACK_REAL_MONEY_LIVE_ACTIVATION",
        "ordersEnabled": True,
        "approvedAt": datetime.datetime.fromtimestamp(
            authority["issuedAt"], datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "deploymentApprovalExpiresAt": authority["expiresAt"],
        "route": authority["route"],
        "authorizationMethod": authority.get("authorizationMethod"),
        "authorizedOperator": authority.get("operator"),
        "planSha256": authority["planSha256"],
        "nonceDigest": hashlib.sha256(authority["nonce"].encode()).hexdigest(),
        "formalCertification": False,
        "venueLifecycleCertified": False,
        "authorizesKillClearance": False,
        "evidence": {
            "signedAsterReadOnly": True,
            "inventoryDigest": inventory_digest,
            "startUnderProtectedHold": True,
            "killSwitchActive": True,
            "ordersSent": 0,
            "cancelsSent": 0,
            "positionChangesSent": 0,
        },
        "notes": "HYPE-only protected-hold start. No owner authority for other runners or Kill clearance.",
    }


class HypeScopedOperations:
    def __init__(self, parent, args, token):
        self.parent, self.args, self.token = parent, args, token
        self.paths, self.systemd = parent.paths, parent.systemd
        self.old_unit = f"{SERVICE}@{OLD}.service"
        self.new_unit = f"{SERVICE}@{args.sha}.service"
        self.release = self.paths.releases / args.sha
        self.dropin = Path("/etc/systemd/system") / (self.new_unit + ".d")
        self.override = self.dropin / "zzzzzzzzzzzzzzzzzzzzzz-hype-certified.conf"
        self.env = Path("/etc/disdex/current-runtime") / (args.sha + ".env")
        self.operator_env = Path("/etc/disdex/current-runtime") / (args.sha + ".hype-operator.env")
        self.approval = Path("/var/lib/disdex/shared/operator-activation") / ("hype-" + args.sha + ".json")
        self.receipt = self.paths.receipts / ("hype-protected-hold-" + args.sha + ".json")
        self.created, self.replaced = [], []
        self.dropin_created = False
        self.state_changed = False
        self.new_started = False

    def command(self, *args):
        proc = subprocess.run(["/usr/bin/systemctl", *args], text=True, capture_output=True, timeout=50)
        require(proc.returncode == 0, "SYSTEMD_" + args[0].upper())
        return proc.stdout

    def signed_flat(self):
        result = self.sdk.run_signed_child(self.sdk_release, self.deploy, credentials=self.credentials)
        require(result.get("status") == "PENDING_READONLY_RECONCILE_VERIFIED"
                and all(type(result.get(key)) is int and result[key] == 0
                    for key in ("positionCount", "openOrderCount", "ordersSent", "cancelsSent",
                                "positionChangesSent")), "FRESH_SIGNED_FLAT_REQUIRED")
        verified = result.get("verifiedAt")
        require(type(verified) is int and 0 <= time.time_ns()//1000000 - verified <= 30000,
                "SIGNED_PROOF_STALE")
        return result

    def health(self):
        risk = self.reader.read_risk()
        require(risk.get("sourceComplete") is True and risk.get("tripped") is False
                and risk.get("maximumLossPct") == 7.5
                and type(risk.get("lossPct")) in (float, int)
                and 0 <= risk["lossPct"] < 7.5, "SHARED_RISK_BLOCK")
        now = time.time_ns() // 1000000
        margin = json.loads(_safe_bytes(MARGIN))
        pending = json.loads(_safe_bytes(PENDING))
        require(margin.get("stage") == "HEALTHY" and margin.get("ordersAllowed") is True
                and type(margin.get("checkedAt")) is int
                and 0 <= now-margin["checkedAt"] <= 900000, "MARGIN_UNHEALTHY")
        require(type(pending.get("updatedAt")) is int
                and 0 <= now-pending["updatedAt"] <= 900000
                and isinstance(pending.get("entries"), list)
                and all(isinstance(x, dict) and x.get("status") == "RELEASED"
                        for x in pending["entries"]), "PENDING_UNRECONCILED")
        raw = _safe_bytes(KILL)
        valid_hold(json.loads(raw))
        require(hashlib.sha256(raw).hexdigest() == self.hold_hash, "KILL_CHANGED")

    def prepare(self):
        import pwd
        from disdex_unified_root_gate import (assert_private_dir, read_root_json,
            parse_live_pins, release_marker, assert_regular_secure)
        from disdex_shared_risk_witness import ProductionSharedRiskReader
        from disdex_pending_maintenance_install import _load_sdk
        require(self.args.scope == RUNNER and self.args.orders_enabled == "true",
                "EXACT_SCOPE")
        for p in (self.paths.root, self.paths.root/"plans", self.paths.root/"plans"/RUNNER,
                  self.paths.nonce_dir, self.paths.receipts):
            assert_private_dir(p, root_uid=self.parent.root_uid)
        self.desired = read_root_json(self.paths.root/"plans"/RUNNER/(self.args.sha+".json"))
        self.current = read_root_json(self.paths.current_plan)
        self.manifest = read_root_json(self.paths.pins, private=False)
        self.pins = parse_live_pins(self.manifest, releases=self.paths.releases)
        require(validate_hype_plan(self.desired, self.current, self.pins, self.args.sha)
                == self.args.plan_sha256, "PLAN_HASH_MISMATCH")
        require(self.parent._read_current_sha(unchanged_identity_only=True)
                == self.current["sourceSha"], "CURRENT_SYMLINK_CHANGED")
        release_marker(self.args.sha, self.paths.releases)
        for relative in ("scripts/disdex-hype-trend-live-runner.ts",
                         "scripts/disdex-hype-zec-long-live-runner.ts",
                         "lib/hype-zec-long-runner.ts",
                         "scripts/ops/root/disdex-live-operator-activation-gate.mjs"):
            require((self.release/relative).is_file(), "CANDIDATE_SOURCE_MISSING")
        require(not self.systemd.is_active(self.old_unit)
                and self.systemd.main_pid(self.old_unit) == 0
                and not self.systemd.is_active(self.new_unit)
                and self.systemd.main_pid(self.new_unit) == 0, "HYPE_ALREADY_ACTIVE")
        for path in (self.dropin, self.env, self.operator_env, self.approval, self.receipt):
            require(not path.exists() and not path.is_symlink(), "TARGET_ALREADY_EXISTS")
        self.old_enabled = self.systemd.is_enabled(self.old_unit)
        self.hold_hash = hashlib.sha256(_safe_bytes(KILL)).hexdigest()
        valid_hold(json.loads(_safe_bytes(KILL)))
        self.reader = ProductionSharedRiskReader()
        self.sdk_release = self.paths.releases/SDK_SHA
        self.sdk = _load_sdk(self.sdk_release)
        self.credentials = self.sdk.load_server_credentials()
        self.deploy = pwd.getpwnam("deploy")
        self.parent._verify_token(self.args, self.token)
        self.health()
        self.before_proof = self.signed_flat()
        self.inventory_digest = hashlib.sha256(canonical({
            "positions": 0, "openOrders": 0,
            "accountSha256": hashlib.sha256(
                self.credentials["ASTER_USER_ADDRESS"].lower().encode()).hexdigest(),
        })).hexdigest()
        self.state_before = _safe_bytes(STATE)
        self.state_stat = STATE.lstat()
        validate_flat_hype_state(json.loads(self.state_before), OLD)
        self.baselines = {p: (_safe_bytes(p), p.lstat())
                          for p in (self.paths.pins, self.paths.current_plan)}
        self.next_manifest = copy.deepcopy(self.manifest)
        self.next_manifest["runners"][RUNNER].update(
            sha=self.args.sha, serviceUnit=self.new_unit, releaseRoot=str(self.release),
            evidenceMode="tick-v1")
        self.next_current = copy.deepcopy(self.current)
        self.next_current["runners"] = self.desired["runners"].copy()
        old_env = Path("/etc/disdex/current-runtime")/(OLD+".env")
        old_operator = Path("/etc/disdex/current-runtime")/(OLD+".hype-operator.env")
        assert_regular_secure(old_env)
        assert_regular_secure(old_operator)
        self.runtime_bytes = _runtime_env(_safe_bytes(old_env), OLD, self.args.sha, self.release)
        # Only the existing HYPE notification configuration is inherited.
        operator_lines = _safe_bytes(old_operator).decode("utf-8").splitlines()
        require(not any(word in line.split("=", 1)[0].upper()
                        for line in operator_lines
                        for word in ("PRIVATE_KEY", "API_SECRET", "PASSWORD")),
                "SECRET_IN_OPERATOR_ENV")
        operator_lines = [line for line in operator_lines
                          if not line.startswith("DISDEX_HYPE_ZEC_OPERATOR_ARMED=")]
        operator_lines.append("DISDEX_HYPE_ZEC_OPERATOR_ARMED=true")
        self.operator_bytes = ("\n".join(operator_lines) + "\n").encode()
        self.health()

    def consume(self):
        self.parent._assert_expected_pins(self.pins)
        self.health()
        proof = self.signed_flat()
        authority = self.parent._verify_token(self.args, self.token,
                                              nonce_dir=self.paths.nonce_dir)
        self.authorization_at = self.parent.clock()
        self.activation = build_activation(self.desired, authority,
                                           self.inventory_digest, self.authorization_at)
        require(proof["positionCount"] == self.before_proof["positionCount"],
                "VENUE_CHANGED")

    def publish(self):
        self.dropin.mkdir(mode=0o755)
        self.dropin_created = True
        self.dropin.chmod(0o755)
        root = str(self.release)
        sha = self.args.sha
        prestart = [
            "ExecStartPre=",
            "ExecStartPre=+/usr/bin/install -d -o deploy -g deploy -m 0700 /var/lib/disdex/hype-zec-long",
            "ExecStartPre=+/bin/sh -c 'if [ -e /var/lib/disdex/hype-zec-long/runner.json ]; then chown deploy:deploy /var/lib/disdex/hype-zec-long/runner.json && chmod 600 /var/lib/disdex/hype-zec-long/runner.json; fi'",
            "ExecStartPre=/usr/bin/test -f " + root + "/.disdex-release-sha",
            "ExecStartPre=/usr/bin/grep -Fxq " + sha + " " + root + "/.disdex-release-sha",
            "ExecStartPre=" + root + "/node_modules/.bin/tsx scripts/disdex-current-live-target-readiness.ts --require-implementation-ready",
            "ExecStartPre=+/usr/bin/node " + root + "/scripts/ops/root/disdex-live-operator-activation-gate.mjs --release-root " + root + " --sha " + sha + " --runner " + RUNNER + " --activation-path " + str(self.approval),
        ]
        unit = ("\n".join(["[Service]",
            "EnvironmentFile=" + str(self.env),
            "EnvironmentFile=" + str(self.operator_env),
            *prestart,
            "ReadWritePaths=/var/lib/disdex/runner-health/ticks",
            ""])).encode()
        for path, content, mode in (
            (self.env, self.runtime_bytes, 0o600),
            (self.operator_env, self.operator_bytes, 0o600),
            (self.approval, canonical(self.activation)+b"\n", 0o600),
            (self.override, unit, 0o644)):
            _root_file(path, content, mode, self.created)
        self.command("daemon-reload")
        proc = subprocess.run(["/usr/bin/systemd-analyze","verify",self.new_unit],
                              capture_output=True, text=True, timeout=45)
        require(proc.returncode == 0, "UNIT_VERIFY_FAIL")
        show = self.command("show",self.new_unit,"-p","ExecStartPre",
                            "-p","ExecStart","-p","WorkingDirectory","-p","User")
        require(str(self.release) in show and str(self.approval) in show
                and "User=deploy" in show and OLD not in show,
                "EFFECTIVE_UNIT_MISMATCH")
        self.health()

    def switch(self):
        require(self.systemd.main_pid(self.old_unit)==0 and
                not self.systemd.is_active(self.old_unit), "OLD_UNIT_RACE")
        require(_safe_bytes(STATE)==self.state_before, "LEDGER_RACE")
        self.health()
        self.signed_flat()
        new_state = dict(json.loads(self.state_before),
                         runtimeCommitSha=self.args.sha,
                         updatedAt=int(time.time()*1000))
        self.state_after = json.dumps(new_state, sort_keys=True,
                                      separators=(",", ":")).encode()+b"\n"
        validate_flat_hype_state(new_state, self.args.sha)
        _atomic(STATE, self.state_after, self.state_stat)
        self.state_changed = True
        for path, raw in ((self.paths.pins, canonical(self.next_manifest)+b"\n"),
                          (self.paths.current_plan,canonical(self.next_current)+b"\n")):
            old,meta=self.baselines[path]
            require(_safe_bytes(path)==old, "PIN_OR_PLAN_CAS")
            self.replaced.append((path,raw))
            _atomic(path, raw, meta)
        self.parent._assert_expected_pins(self.desired["runners"])
        self.health()
        self.new_started=True
        self.systemd.start(self.new_unit)

    def audit(self):
        stamps=[]
        deadline=time.monotonic()+2200
        pid=None
        while len(stamps)<3:
            require(time.monotonic()<deadline,"THREE_TICKS_TIMEOUT")
            require(not self.systemd.is_active(self.old_unit),
                    "DUPLICATE_HYPE")
            require(self.systemd.active_state(self.new_unit)=="active",
                    "NEW_UNIT_STOPPED")
            new_pid=self.systemd.main_pid(self.new_unit)
            require(new_pid>0 and (pid is None or new_pid==pid),"PID_CHANGED")
            pid=new_pid
            require(self.systemd._state(self.new_unit,"NRestarts")=="0",
                    "RUNNER_RESTARTED")
            require(Path("/proc",str(pid),"cwd").resolve(strict=True)==self.release,
                    "PID_CWD_MISMATCH")
            self.parent._assert_expected_pins(self.desired["runners"])
            self.health()
            state=json.loads(_safe_bytes(STATE))
            validate_flat_hype_state(state,self.args.sha)
            try:
                tick=json.loads(_safe_bytes(TICK))
            except FileNotFoundError:
                self.parent.sleep_fn(3);continue
            if tick.get("runtimeSha")!=self.args.sha or tick.get("tickCompletedAt") in stamps:
                self.parent.sleep_fn(3);continue
            stamp=validate_hype_tick(tick,sha=self.args.sha,pid=pid,release=self.release,
                                     previous=stamps[-1] if stamps else None)
            self.signed_flat()
            stamps.append(stamp)
            self.parent.sleep_fn(3)
        return stamps

    def commit(self, stamps):
        self.health()
        self.parent._assert_expected_pins(self.desired["runners"])
        receipt = {
            "status":"HYPE_PROTECTED_HOLD_VERIFIED_NOT_ORDER_ENABLED",
            "scope": RUNNER, "sourceSha":self.args.sha,
            "planSha256":self.args.plan_sha256,
            "runtimeLive":True,"effectiveNewOrdersAllowed":False,
            "protectedHoldPreserved":True,"authorizesKillClearance":False,
            "threeRealTickTimes":stamps,
            "ordersSent":0,"cancelsSent":0,"positionChangesSent":0,
            "committedAt":self.parent.clock(),
        }
        _root_file(self.receipt, canonical(receipt)+b"\n", 0o400, self.created)
        self.systemd.enable(self.new_unit)
        if self.old_enabled:
            self.systemd.disable(self.old_unit)
        return receipt

    def rollback(self):
        errors=[]
        def attempt(fn):
            try: fn()
            except Exception as error: errors.append(str(type(error).__name__))
        if self.new_started:
            attempt(lambda:self.systemd.stop(self.new_unit))
            require(self.systemd.main_pid(self.new_unit)==0 and
                    not self.systemd.is_active(self.new_unit),
                    "ROLLBACK_NEW_UNIT_STILL_RUNNING")
            attempt(lambda:self.systemd.disable(self.new_unit))
        if self.state_changed:
            cur=_safe_bytes(STATE)
            require(cur==self.state_after, "ROLLBACK_LEDGER_CHANGED")
            validate_flat_hype_state(json.loads(cur),self.args.sha)
            self.signed_flat()
            attempt(lambda:_atomic(STATE,self.state_before,self.state_stat))
        for path, written in reversed(self.replaced):
            old,meta=self.baselines[path]
            def undo(p=path,w=written,b=old,m=meta):
                require(_safe_bytes(p) in (b,w),"ROLLBACK_CAS_CONFLICT")
                _atomic(p,b,m)
            attempt(undo)
        for path in reversed(self.created):
            attempt(lambda p=path:p.unlink(missing_ok=True))
        if self.dropin_created:
            attempt(self.dropin.rmdir)
        attempt(lambda:self.command("daemon-reload"))
        if self.old_enabled:
            attempt(lambda:self.systemd.enable(self.old_unit))
        if errors:
            raise RuntimeError("HYPE_SCOPED_ROLLBACK_INCOMPLETE:" + ",".join(errors))


class HypeScopedRootExecutor:
    def __init__(self, parent):
        self.parent=parent
    def execute(self, args, token):
        from disdex_v52_scoped_root_cutover import run_scoped_transaction
        return run_scoped_transaction(HypeScopedOperations(self.parent,args,token))
