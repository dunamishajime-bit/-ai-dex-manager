#!/usr/bin/env python3
"""Signed HYPE-only production recovery. Preflight has no write access path."""
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys
import time
from types import SimpleNamespace

from disdex_hype_sha_restore_contract import (
    CANDIDATE, COMMAND, HOST, LEGACY, OPERATION, OPERATOR_TARGET, OWNER, PLAN,
    REPOSITORY, RUNNER, XRP_STOP, parse_command, proposed_pins, require, validate_forced_command,
    verify_peer_authority, verify_result,
)

STATE = Path("/var/lib/disdex/hype-zec-long/runner.json")
V4 = Path("/var/lib/disdex/v12-v4/orders.json")
SHARED = Path("/var/lib/disdex/shared")
SNAPSHOT = Path("/var/lib/disdex/runner-health/current.json")
REVIEW = "HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT"
AUDITED = {
    "lib/v12-v4-production-lifecycle.ts": "d44338ab3086420830261ff0a983a2579fbd8dc926049602509992ec8425226a",
    "scripts/disdex-hype-owner-sha-recovery.ts": "b8f7956070a29cba5707f31c15b45384cd68d3c8e31f3137d19204d7bfb7460e",
    "tests/hype-owner-sha-recovery.test.ts": "39ecdf1a573f593e391355074eabaf53dd0e2227a2619e7349b82e0ec0e03c92",
    "tests/hype-v4-review-journal-replay.test.ts": "321d5769aa76bcf10d9252a4127a0b0036e3f40a4ef52ac205aae86e652802a8",
}
ZERO = dict(ordersSent=0,cancelsSent=0,positionChangesSent=0)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def json_bytes(row):
    return (json.dumps(row,sort_keys=True,separators=(",",":"),allow_nan=False)+"\n").encode()


def system(*argv):
    proc = subprocess.run(["/usr/bin/systemctl",*argv],capture_output=True,text=True,timeout=45)
    require(proc.returncode==0,"SYSTEMD_"+argv[0].replace("-","_").upper())
    return proc.stdout


def trusted_source(path, assert_regular):
    st=assert_regular(path,root_uid=0,private=False)
    require(not st.st_mode&0o222,"WRITABLE_RELEASE_SOURCE")
    return path.read_bytes().replace(b"\r\n",b"\n")


def monitoring(release):
    from disdex_shared_risk_monitor_wiring import SharedRiskMonitorWiring
    files = []
    for unit,prefix in (("disdex-runner-health-snapshot.service","DISDEX_HEALTH_SNAPSHOT_HYPE_"),
                        ("disdex-runner-watchdog.service","DISDEX_WATCHDOG_HYPE_")):
        found = set()
        for raw_path in re.findall(r"(/etc/disdex/current-runtime/[^\s()]+) \(ignore_errors=",system("show",unit,"-pEnvironmentFiles","--value")):
            path=Path(raw_path)
            old,new={},{}
            for line in path.read_text().splitlines():
                key,sep,value=line.partition("=")
                values={"EXPECTED_SHA":(r"[a-f0-9]{40}",CANDIDATE),
                        "RELEASE_ROOT":(r"/home/deploy/disdex-trading/releases/[a-f0-9]{40}",str(release)),
                        "SERVICE_UNIT":(r"disdex-hype-long@[a-f0-9]{40}\.service",f"disdex-hype-long@{CANDIDATE}.service")}
                if not key.startswith(prefix) or key[len(prefix):] not in values:
                    continue
                shape,target=values[key[len(prefix):]]
                require(sep and key not in old and re.fullmatch(shape,value),"MONITOR_KEY_OR_VALUE")
                old[key],new[key]=value,target
                found.add(key)
            if old and old!=new:files.append((path,old,new))
        require({prefix+"EXPECTED_SHA",prefix+"RELEASE_ROOT"}<=found,"MONITOR_BINDING_MISSING")
    return SharedRiskMonitorWiring(files)


def verify_approval(paths, token, *, consume=False):
    from disdex_owner_approval import verify
    from disdex_unified_root_gate import assert_regular_secure
    assert_regular_secure(paths.public_key,root_uid=0,private=False)
    authority=verify(token,paths.public_key,REPOSITORY,CANDIDATE,RUNNER,OWNER,PLAN,
        route="GITHUB_ACTIONS",deployment_target=HOST,operator_target=OPERATOR_TARGET,
        orders_enabled=True,nonce_dir=paths.nonce_dir if consume else None)
    require(authority["issuedAt"]<=int(time.time())<authority["expiresAt"],"EXPIRED_APPROVAL")
    return authority


class Restore:
    def __init__(self):
        from disdex_hype_scoped_root_cutover import HypeScopedOperations
        from disdex_shared_risk_witness import ProductionSharedRiskReader
        from disdex_unified_root_gate import RootDeploymentExecutor, default_execution_paths
        self.paths=default_execution_paths()
        self.parent=RootDeploymentExecutor(self.paths)
        self.legacy=HypeScopedOperations(self.parent,SimpleNamespace(sha=CANDIDATE),"")
        self.release=self.paths.releases/CANDIDATE
        self.reader=ProductionSharedRiskReader()
        self.systemd=self.parent.systemd
        self.old=f"disdex-hype-long@{LEGACY}.service"
        self.new=self.legacy.new_unit
        self.created=[]
        self.installed=[]
        self.started=False
        self.ledger_after=None

    def secure_context(self):
        current=self.reader.read_context()
        current["peers"].pop(RUNNER)
        current.pop("pendingHash")
        return current

    def only_writer(self, expected=None):
        rows=system("list-units","--plain","--no-legend","--no-pager","--type=service",
            "--state=active,activating,deactivating,reloading","disdex-hype-long@*.service")
        require([line.split()[0] for line in rows.splitlines() if line.strip()]==
                ([expected] if expected else []),"HYPE_WRITER_INVENTORY")

    def health(self):
        from disdex_hype_scoped_root_cutover import validate_hype_pending
        from disdex_shared_risk_witness import file_bytes
        risk=self.reader.read_risk()
        now=time.time_ns()//1000000
        margin=json.loads(file_bytes(SHARED/"margin-risk/guard-live.json"))
        kill=file_bytes(SHARED/"kill-switch.json")
        require(risk.get("maximumLossPct")==7.5 and risk.get("sourceComplete") is True
                and risk.get("tripped") is False and 0<=risk.get("lossPct",-1)<7.5,"SHARED_RISK")
        require(margin.get("stage")=="HEALTHY" and margin.get("ordersAllowed") is True
                and 0<=now-margin["checkedAt"]<=360000,"MARGIN_GUARD")
        require(json.loads(kill).get("active") is False and digest(kill)==self.context["killHash"],"KILL_SWITCH")
        try:
            validate_hype_pending(file_bytes(SHARED/"pending-exposure.json"),now)
        except ValueError:
            raise ValueError("HYPE_SHA_RESTORE_PENDING_RECONCILIATION_REQUIRED") from None
        require(self.secure_context()==self.context,"PEER_RUNTIME_CHANGED")

    def preview(self):
        from disdex_shared_risk_witness import file_bytes
        from disdex_unified_root_gate import (
            assert_regular_secure, parse_live_pins, read_root_json, release_marker,
        )
        from disdex_v4_canonical_prestart import validate_activation
        release_marker(CANDIDATE,self.paths.releases,root_uid=0)
        for name,expected in AUDITED.items():
            require(digest(trusted_source(self.release/name,assert_regular_secure))==expected,"SOURCE_DIGEST")
        for name in ("lib/hype-zec-long-runner.ts","config/hypeZecLongRuntime.ts",
                     "scripts/disdex-hype-trend-live-runner.ts","scripts/disdex-hype-zec-long-live-runner.ts",
                     "scripts/ops/root/disdex-live-operator-activation-gate.mjs"):
            require(trusted_source(self.release/name,assert_regular_secure)==
                    file_bytes(self.paths.releases/LEGACY/name).replace(b"\r\n",b"\n"),"UNREVIEWED_RUNTIME_DELTA")
        self.manifest=read_root_json(self.paths.pins,private=False)
        self.pins=parse_live_pins(self.manifest,releases=self.paths.releases)
        self.desired=proposed_pins(self.pins)
        current=read_root_json(self.paths.current_plan)
        require(current["runners"]==self.pins and current["sourceSha"]==self.paths.current.resolve().name,"CURRENT_PLAN")
        self.current=current
        self.context=self.secure_context()
        for u in (self.old,self.new):
            require(self.systemd.main_pid(u)==0 and self.systemd.active_state(u) in ("inactive","failed"),"WRITER_ACTIVE")
        self.only_writer()
        require(not self.systemd.is_enabled(self.new),"NEW_WRITER_ENABLED")
        self.state=file_bytes(STATE)
        self.state_meta=STATE.lstat()
        d=json.loads(self.state)
        require(d.get("runtimeCommitSha")==LEGACY and d.get("mode")=="LIVE" and
                d.get("manualReview")==REVIEW and not d.get("positions") and not d.get("pending"),"REVIEW_BASELINE")
        self.deploy=pwd.getpwnam("deploy")
        require((self.state_meta.st_uid,self.state_meta.st_gid)==(self.deploy.pw_uid,self.deploy.pw_gid)
                and self.state_meta.st_mode&0o777==0o600,"STATE_OWNER")
        output=self.node(["--input-type=module","--eval",
            "import {readFileSync} from 'node:fs';"
            "import {assertRecoveredV4Ledger as check} from './scripts/disdex-hype-owner-sha-recovery.ts';"
            f"console.log(JSON.stringify(check(JSON.parse(readFileSync({json.dumps(str(V4))},'utf8')))));"],
            {"PATH":"/usr/bin:/bin"},deploy=False)
        self.journal_count=output["journalCount"]
        sha=self.pins["V12_V4"]
        prestart=Path("/usr/local/libexec/disdex-unified/disdex_v4_canonical_prestart.py")
        assert_regular_secure(prestart,root_uid=0,private=False)
        require(str(prestart) in self.systemd._state(self.manifest["runners"]["V12_V4"]["serviceUnit"],"ExecStartPre"),
                "V4_GATE_IDENTITY")
        approval_path=SHARED/"operator-activation/v12-v4-full.json"
        approval=read_root_json(approval_path)
        readiness=read_root_json(self.paths.releases/sha/"docs/production/v12-v4-implementation-readiness.json",private=False)
        verify_peer_authority(self.pins,self.desired,
            lambda pins:validate_activation(approval,sha,pins,readiness,int(time.time())))
        self.v4_approval_hash=digest(file_bytes(approval_path))
        self.health()
        self.wiring=monitoring(self.release)
        return dict(status="HYPE_SHA_RESTORE_PREFLIGHT_PASS",candidateSha=CANDIDATE,
                    planSha256=PLAN,journalCount=self.journal_count,**ZERO)

    def node(self, args, env, *, deploy=True):
        opts=dict(user=self.deploy.pw_uid,group=self.deploy.pw_gid,extra_groups=[]) if deploy else {}
        out=subprocess.run(["/usr/bin/node","--import",str(self.release/"node_modules/tsx/dist/loader.mjs"),*args],
            cwd=self.release,env=env,capture_output=True,text=True,timeout=85,**opts)
        if out.returncode:
            codes=re.findall(r"\b(?:HYPE|V4|ASTER|PENDING)_[A-Z0-9_]+\b",out.stderr)
            raise ValueError("HYPE_SHA_RESTORE_CHILD_BLOCKED"+(":"+codes[-1] if codes else ""))
        return json.loads(out.stdout.strip().splitlines()[-1])

    def apply(self, run_id, token):
        from disdex_hype_scoped_root_cutover import _atomic, _root_file, _runtime_env
        from disdex_pending_maintenance_install import _load_sdk
        from disdex_shared_risk_witness import file_bytes
        from disdex_unified_root_gate import assert_private_dir, assert_regular_secure
        verify_approval(self.paths,token)
        self.preview()
        tx=self.paths.receipts/f"hype-sha-restore-{run_id}"
        assert_private_dir(self.paths.receipts,root_uid=0)
        for p in (self.legacy.env,self.legacy.operator_env,self.legacy.dropin,self.legacy.approval,tx):
            require(not p.exists() and not p.is_symlink(),"TARGET_ALREADY_EXISTS")
        old_env=Path("/etc/disdex/current-runtime")/(LEGACY+".env")
        old_operator=Path("/etc/disdex/current-runtime")/(LEGACY+".hype-operator.env")
        for p in (old_env,old_operator):assert_regular_secure(p,root_uid=0)
        runtime=_runtime_env(file_bytes(old_env),LEGACY,CANDIDATE,self.release)
        operator=[l for l in file_bytes(old_operator).decode().splitlines()
                  if not l.startswith("DISDEX_HYPE_ZEC_OPERATOR_ARMED=")]
        require(not any(re.search(r"PRIVATE_KEY|API_SECRET|PASSWORD|TOKEN",l.partition("=")[0],re.I)
                        for l in operator),"OPERATOR_ENV_HAS_SECRET")
        operator_bytes=("\n".join([*operator,"DISDEX_HYPE_ZEC_OPERATOR_ARMED=true"])+"\n").encode()
        baseline={p:(file_bytes(p),p.lstat()) for p in (self.paths.pins,self.paths.current_plan)}
        self.health()
        require(file_bytes(STATE)==self.state,"STATE_CAS")
        auth=verify_approval(self.paths,token,consume=True)
        tx.mkdir(mode=0o700)
        for name,raw in (("state.before",self.state),("pins.before",baseline[self.paths.pins][0]),
                         ("plan.before",baseline[self.paths.current_plan][0]),
                         ("monitor-wiring.json",json_bytes(self.wiring.journal()))):
            _root_file(tx/name,raw,0o400,[])
        before_enable=self.systemd.is_enabled(self.old)
        try:
            sdk=_load_sdk(self.paths.releases/"7b7719c65d2c6116d02463fc4603200f28e20762")
            env=sdk.child_environment(CANDIDATE,self.deploy.pw_dir,credentials=sdk.load_server_credentials())
            require(env.get("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH")==str(SHARED/"aster-rate-budget.json")
                    and not env.get("DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET"),"SHARED_RATE_BUDGET")
            self.venue_env=env.copy()
            env.update(DISDEX_HYPE_TARGET_SHA=CANDIDATE,DISDEX_HYPE_APPROVAL_PLAN_SHA256=PLAN,
                DISDEX_HYPE_APPROVAL_OPERATION=OPERATION,DISDEX_HYPE_SIGNED_GRANT_VERIFIED="TRUE",
                DISDEX_HYPE_APPROVAL_ORDERS_ENABLED="true",DISDEX_CONTROL_REQUEST_ID=run_id)
            evidence=self.node([str(self.release/"scripts/disdex-hype-owner-sha-recovery.ts")],env)
            self.ledger_after=file_bytes(STATE)
            venue_digest=verify_result(evidence)
            self.check_ledger()
            self.health()
            require(int(time.time())<auth["expiresAt"],"APPROVAL_EXPIRED_BEFORE_START")
            require(digest(file_bytes(SHARED/"operator-activation/v12-v4-full.json"))==self.v4_approval_hash,
                    "V4_APPROVAL_CHANGED")
            activation=dict(schema="disdex-live-operator-activation/v1",repository=REPOSITORY,
                deploymentTarget=HOST,target=OPERATOR_TARGET,scope=RUNNER,operation=OPERATION,
                approvedSha=CANDIDATE,approvedRunners=[RUNNER],approvedShaByRunner={RUNNER:CANDIDATE},
                ordersEnabled=True,activationClass="FULL_LIVE",route="GITHUB_ACTIONS",
                authorizationMethod="OWNER_SIGNED_TOKEN",approvedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(auth["issuedAt"])),
                operatorAcknowledgement="I_ACK_REAL_MONEY_LIVE_ACTIVATION",planSha256=PLAN,
                nonceDigest=digest(auth["nonce"].encode()),githubRunId=run_id,venueProofSha256=venue_digest)
            self.legacy.dropin.mkdir(mode=0o755)
            for p,raw,mode in ((self.legacy.env,runtime,0o600),(self.legacy.operator_env,operator_bytes,0o600),
                (self.legacy.approval,json_bytes(activation),0o600),(self.legacy.override,self.legacy.unit_override_bytes(),0o644)):
                _root_file(p,raw,mode,self.created)
            system("daemon-reload")
            check=subprocess.run(["/usr/bin/systemd-analyze","verify",self.new],capture_output=True,timeout=45)
            require(check.returncode==0,"UNIT_VERIFY")
            m=copy.deepcopy(self.manifest)
            m["runners"][RUNNER].update(sha=CANDIDATE,serviceUnit=self.new,releaseRoot=str(self.release),evidenceMode="tick-v1")
            for p,row in ((self.paths.pins,m),(self.paths.current_plan,{**self.current,"runners":self.desired})):
                raw=json_bytes(row)
                require(file_bytes(p)==baseline[p][0],"PIN_CAS")
                self.installed.append((p,raw))
                _atomic(p,raw,baseline[p][1])
            self.wiring.apply()
            self.systemd.disable(self.old)
            self.only_writer()
            self.parent._assert_expected_pins(self.desired)
            self.health()
            require(int(time.time())<auth["expiresAt"],"APPROVAL_EXPIRED_BEFORE_START")
            started_at=time.time_ns()//1000000
            self.started=True
            self.systemd.start(self.new)
            result=self.audit(started_at)
            self.systemd.enable(self.new)
            receipt={**result,"status":"HYPE_SHA_RESTORE_LIVE_VERIFIED","sourceSha":CANDIDATE,
                     "previousSha":LEGACY,"ordersEnabled":True,"githubRunId":run_id,"planSha256":PLAN,
                     "signedPreflightReads":evidence["signedVenueReads"],"reviewEvents":evidence["reviewEvents"],**ZERO}
            _root_file(tx/"receipt.json",json_bytes(receipt),0o400,[])
            return receipt
        except Exception:
            if self.started:
                # Preserve the candidate's durable ownership after any attempted start.
                _root_file(tx/"blocked.json",json_bytes(dict(status="HYPE_SHA_RESTORE_RECONCILE_AFTER_START")),0o400,[])
                require(file_bytes(self.legacy.approval)==json_bytes(activation),"ROLLBACK_AUTHORITY_CAS")
                # Revoke only the new HYPE startup authority. The signed artifact
                # remains available to the incident reviewer in the private receipt.
                revoked=tx/"activation.revoked"
                _root_file(revoked,json_bytes(activation),0o400,[])
                self.legacy.approval.unlink()
                self.systemd.stop(self.new)
                self.systemd.disable(self.new)
                raise
            if self.ledger_after is None and file_bytes(STATE)!=self.state:
                _root_file(tx/"blocked.json",json_bytes(dict(status="HYPE_SHA_RESTORE_LEDGER_WRITE_UNCERTAIN")),0o400,[])
                raise
            self.wiring.restore()
            for p,raw in reversed(self.installed):
                require(file_bytes(p) in (raw,baseline[p][0]),"ROLLBACK_PIN_CAS")
                if file_bytes(p)==raw:_atomic(p,*baseline[p])
            if self.ledger_after is not None:
                require(file_bytes(STATE)==self.ledger_after,"ROLLBACK_LEDGER_CAS")
                _atomic(STATE,self.state,self.state_meta)
            for p in reversed(self.created):p.unlink()
            if self.legacy.dropin.exists():self.legacy.dropin.rmdir()
            system("daemon-reload")
            if before_enable:self.systemd.enable(self.old)
            _root_file(tx/"blocked.json",json_bytes(dict(status="HYPE_SHA_RESTORE_ROLLED_BACK")),0o400,[])
            raise

    def check_ledger(self):
        from disdex_shared_risk_witness import file_bytes
        row=json.loads(file_bytes(STATE))
        require(row.get("runtimeCommitSha")==CANDIDATE and row.get("mode")=="LIVE"
                and not row.get("manualReview"),"CANDIDATE_LEDGER_UNHEALTHY")

    def audit(self, started_at):
        from disdex_shared_risk_witness import file_bytes
        tick=Path("/var/lib/disdex/runner-health/ticks/hype-trend-long.json")
        pid=self.systemd.main_pid(self.new)
        require(pid>1,"NEW_PID_MISSING")
        deadline=time.monotonic()+1900
        times=[]
        while len(times)<2:
            require(time.monotonic()<deadline,"AUDIT_TICK_TIMEOUT")
            require(self.systemd.active_state(self.new)=="active" and self.systemd.main_pid(self.new)==pid
                    and self.systemd._state(self.new,"NRestarts")=="0"
                    and self.systemd.main_pid(self.old)==0
                    and Path("/proc",str(pid),"cwd").resolve()==self.release,"AUDIT_RUNTIME")
            self.only_writer(self.new)
            self.parent._assert_expected_pins(self.desired)
            self.wiring.assert_applied()
            self.health()
            self.check_ledger()
            if tick.exists():
                row=json.loads(file_bytes(tick));ts=row.get("tickCompletedAt",0)
                if (row.get("runtimeSha")==CANDIDATE and row.get("mainPid")==pid and
                    row.get("serviceUnit")==self.new and row.get("workingDirectory")==str(self.release) and
                    row.get("status") in ("no-change","completed") and
                    type(ts) is int and started_at<=ts<=time.time_ns()//1000000 and ts not in times):
                    times.append(ts)
            if len(times)<2:time.sleep(3)
        until=time.monotonic()+90
        while True:
            raw=json.loads(file_bytes(SNAPSHOT))
            hp=raw.get("runners",{}).get(RUNNER,{})
            if (hp.get("expectedSha")==hp.get("runtimeSha")==CANDIDATE
                    and hp.get("serviceUnit")==self.new and hp.get("tickVerified") is True
                    and hp.get("processHealthy") is True and type(hp.get("lastTickAt")) is int
                    and hp["lastTickAt"]>=times[-1]):
                break
            require(time.monotonic()<until,"HP_SNAPSHOT_NOT_VERIFIED")
            time.sleep(3)
        return dict(mainPid=pid,realTickTimes=times,workingDirectory=str(self.release),
                    healthSnapshotAt=raw["generatedAt"],**self.verify_resident_stop())

    def verify_resident_stop(self):
        from disdex_hype_sha_restore_venue import POST_CHECK
        return self.node(["--input-type=module","--eval",POST_CHECK,XRP_STOP],self.venue_env)


def main():
    from disdex_unified_root_gate import _assert_execution_root, assert_regular_secure, default_execution_paths
    try:
        _assert_execution_root(0)
        validate_forced_command([COMMAND,*sys.argv[1:]])
        preview=sys.argv[1:]==["--preflight-readonly"]
        run_id=None if preview else parse_command([COMMAND,*sys.argv[1:]])
        lock=default_execution_paths().root/"deployment-execution.lock"
        with os.fdopen(os.open(lock,os.O_RDWR|os.O_NOFOLLOW),"rb+") as fd:
            st=assert_regular_secure(lock,root_uid=0,private=True)
            op=os.fstat(fd.fileno())
            require((st.st_dev,st.st_ino)==(op.st_dev,op.st_ino),"DEPLOY_LOCK_REPLACED")
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            restore=Restore()
            if preview:result=restore.preview()
            else:result=restore.apply(run_id,sys.stdin.read(16385).strip())
        print(json.dumps(result,sort_keys=True))
    except Exception as error:
        reason=str(error)
        if not re.fullmatch(r"HYPE_SHA_RESTORE_[A-Z0-9_:]+",reason):
            reason=type(error).__name__
        print(json.dumps(dict(status="HYPE_SHA_RESTORE_BLOCKED",reason=reason)),file=sys.stderr)
        return 2
    return 0


if __name__=="__main__":
    sys.exit(main())
