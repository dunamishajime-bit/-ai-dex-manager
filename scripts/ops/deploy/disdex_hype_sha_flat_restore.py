#!/usr/bin/env python3
"""Owner-signed HYPE candidate recovery using current-flat evidence. Preflight is read only."""
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

from disdex_hype_sha_flat_restore_contract import (
    CANDIDATE, HOST, LEGACY, OPERATION, OPERATOR_TARGET, OWNER, PLAN,
    REPOSITORY, RUNNER, V4_SCOPE, build_v4_continuity_activation,
    proposed_pins, require, v4_continuity_plan, validate_args, verify_result,
)
from disdex_hype_sha_flat_restore_venue import PRECHECK_MIGRATE

STATE = Path("/var/lib/disdex/hype-zec-long/runner.json")
V4 = Path("/var/lib/disdex/v12-v4/orders.json")
SHARED = Path("/var/lib/disdex/shared")
SNAPSHOT = Path("/var/lib/disdex/runner-health/current.json")
PENDING_MAINTENANCE_SHA = "22ceb5fe44a6ac10a8880b1c8dcb7d5a20d479e5"
REVIEW = "HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT"
REPAIRED = "HYPE_CURRENT_FLAT_REVIEW_REPAIRED_AFTER_SIGNED_SCOPED_FLAT"
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


def verify_approval(paths, token, *, sha=CANDIDATE, scope=RUNNER, plan=PLAN, consume=False):
    from disdex_owner_approval import verify
    from disdex_unified_root_gate import assert_regular_secure
    assert_regular_secure(paths.public_key,root_uid=0,private=False)
    authority=verify(token,paths.public_key,REPOSITORY,sha,scope,OWNER,plan,
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

    def preview(self, run_id=None):
        from disdex_unified_root_gate import parse_live_pins, read_root_json
        manifest=read_root_json(self.paths.pins,private=False)
        pins=parse_live_pins(manifest,releases=self.paths.releases)
        if pins.get(RUNNER)==CANDIDATE:
            return self.preview_resume(run_id)
        return self.preview_fresh()

    def _resume_transaction(self, run_id):
        candidates=[]
        if run_id is not None:
            require(re.fullmatch(r"[0-9]{1,20}",run_id) is not None,"RESUME_RUN_ID")
            candidates=[self.paths.receipts/f"hype-sha-restore-{run_id}"]
        else:
            for path in self.paths.receipts.glob("hype-sha-restore-*"):
                suffix=path.name.removeprefix("hype-sha-restore-")
                if suffix.isdigit():candidates.append(path)
        valid=[]
        for tx in candidates:
            blocked=tx/"blocked.json"
            try:
                row=json.loads(blocked.read_bytes())
            except (FileNotFoundError,PermissionError,ValueError,json.JSONDecodeError):
                continue
            if row=={"status":"HYPE_SHA_RESTORE_RECONCILE_AFTER_START"} and not (tx/"receipt.json").exists():
                valid.append(tx)
        require(len(valid)==1,"RESUME_TRANSACTION_IDENTITY")
        tx=valid[0]
        suffix=tx.name.removeprefix("hype-sha-restore-")
        require(suffix.isdigit(),"RESUME_TRANSACTION_IDENTITY")
        if run_id is not None:require(suffix==run_id,"RESUME_RUN_ID_MISMATCH")
        return tx,suffix

    def preview_resume(self, run_id):
        from disdex_shared_risk_witness import file_bytes
        from disdex_unified_root_gate import (
            assert_private_dir, assert_regular_secure, parse_live_pins, read_root_json, release_marker,
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
        require(self.pins.get(RUNNER)==CANDIDATE,"RESUME_CANDIDATE_PIN")
        require(self.pins.get(V4_SCOPE)=="3ad65403013b701db5d9e53e8814e6ab827a28e8","V4_PIN_MISMATCH")
        self.desired=dict(self.pins)
        self.current=read_root_json(self.paths.current_plan)
        require(self.current["runners"]==self.pins and self.current["sourceSha"]==self.paths.current.resolve().name,
                "CURRENT_PLAN")
        self.context=self.secure_context()

        tx,resume_run_id=self._resume_transaction(run_id)
        assert_private_dir(tx,root_uid=0)
        self.resume_tx=tx
        self.resume_run_id=resume_run_id
        for name in ("blocked.json","activation.revoked","pins.before","plan.before",
                     "v4-activation.before","state.before","monitor-wiring.json"):
            assert_regular_secure(tx/name,root_uid=0,private=True)
        require(not (tx/"receipt.json").exists(),"RESUME_RECEIPT_EXISTS")
        self.resume_revoked_raw=file_bytes(tx/"activation.revoked")
        self.resume_stale_live_activation=False
        if self.legacy.approval.exists():
            assert_regular_secure(self.legacy.approval,root_uid=0,private=True)
            require(file_bytes(self.legacy.approval)==self.resume_revoked_raw,
                    "RESUME_UNEXPECTED_LIVE_AUTHORITY")
            self.resume_stale_live_activation=True
        else:
            require(not self.legacy.approval.is_symlink(),"RESUME_AUTHORITY_NOT_REVOKED")

        require(self.systemd.main_pid(self.old)==0
                and self.systemd.active_state(self.old) in ("inactive","failed"),"WRITER_ACTIVE")
        if self.resume_stale_live_activation:
            require(self.systemd.main_pid(self.new)>0 and self.systemd.active_state(self.new)=="active",
                    "RESUME_STALE_LIVE_WRITER_STATE")
            self.only_writer(self.new)
            # A prior interrupted recovery may also have enabled this exact
            # candidate unit. The reconcile path stops and disables it under
            # CAS before revoking the stale activation, so enabled is safe only
            # in this exact byte-identical revoked-authority state.
        else:
            require(self.systemd.main_pid(self.new)==0
                    and self.systemd.active_state(self.new) in ("inactive","failed"),"WRITER_ACTIVE")
            self.only_writer()
            require(not self.systemd.is_enabled(self.new),"NEW_WRITER_ENABLED")
        for path in (self.legacy.env,self.legacy.operator_env):
            assert_regular_secure(path,root_uid=0,private=True)
        assert_regular_secure(self.legacy.override,root_uid=0,private=False)
        drop=self.legacy.dropin.lstat()
        require(self.legacy.dropin.is_dir() and not self.legacy.dropin.is_symlink() and drop.st_uid==0
                and drop.st_gid==0 and drop.st_mode&0o777==0o755,"RESUME_DROPIN")

        self.state=file_bytes(STATE);self.state_meta=STATE.lstat()
        d=json.loads(self.state)
        require(d.get("runtimeCommitSha")==CANDIDATE and d.get("mode")=="LIVE"
                and d.get("manualReview") is None and not d.get("positions") and not d.get("pending"),
                "CANDIDATE_LEDGER_UNHEALTHY")
        self.deploy=pwd.getpwnam("deploy")
        require((self.state_meta.st_uid,self.state_meta.st_gid)==(self.deploy.pw_uid,self.deploy.pw_gid)
                and self.state_meta.st_mode&0o777==0o600,"STATE_OWNER")

        prior_manifest=json.loads(file_bytes(tx/"pins.before"))
        self.resume_prior_pins=parse_live_pins(prior_manifest,releases=self.paths.releases)
        require(self.pins==proposed_pins(self.resume_prior_pins),"RESUME_PIN_TRANSITION")
        prior_plan=json.loads(file_bytes(tx/"plan.before"))
        require(prior_plan.get("runners")==self.resume_prior_pins,"RESUME_PRIOR_PLAN")
        self.resume_prior_v4_hash=digest(file_bytes(tx/"v4-activation.before"))
        self.v4_plan=v4_continuity_plan(self.resume_prior_pins,self.pins,self.resume_prior_v4_hash)
        self.v4_approval_path=SHARED/"operator-activation/v12-v4-full.json"
        self.v4_approval_before=file_bytes(self.v4_approval_path)
        approval=read_root_json(self.v4_approval_path)
        sha=self.pins[V4_SCOPE]
        self.v4_readiness=read_root_json(self.paths.releases/sha/"docs/production/v12-v4-implementation-readiness.json",private=False)
        validate_activation(approval,sha,self.pins,self.v4_readiness,int(time.time()))
        require(approval.get("planSha256")==self.v4_plan and approval.get("approvedShaByRunner")==self.pins,
                "RESUME_V4_CONTINUITY")

        revoked=json.loads(self.resume_revoked_raw)
        require(revoked.get("scope")==RUNNER and revoked.get("operation")==OPERATION
                and revoked.get("approvedSha")==CANDIDATE and revoked.get("approvedShaByRunner")=={RUNNER:CANDIDATE}
                and revoked.get("ordersEnabled") is True and revoked.get("planSha256")==PLAN
                and revoked.get("route")=="GITHUB_ACTIONS" and revoked.get("githubRunId")==resume_run_id
                and re.fullmatch(r"[0-9a-f]{64}",str(revoked.get("venueProofSha256") or "")),
                "RESUME_REVOKED_AUTHORITY")
        self.resume_venue_proof=revoked["venueProofSha256"]
        self.venue_proof=self.resume_venue_proof

        output=self.node(["--input-type=module","--eval",
            "import {readFileSync} from 'node:fs';"
            "import {replayProductionJournal} from './lib/v12-v4-production-lifecycle.ts';"
            f"const d=JSON.parse(readFileSync({json.dumps(str(V4))},'utf8'));"
            "if(d.releaseSha!=='3ad65403013b701db5d9e53e8814e6ab827a28e8'||!d.state)throw Error('HYPE_V4_CURRENT_OWNERSHIP_CHANGED');"
            "const r=replayProductionJournal(d.state.initial,d.state.journal);"
            "const legs=Object.values(r.legs??{});"
            "if(r.executionReview!=null||(r.foreign??[]).length||r.initial?.holdProtected!==false||"
            "legs.some(x=>Math.abs(Number(x.qty??0))>1e-12||!['CLOSED','CANCELLED'].includes(String(x.status))))"
            "throw Error('HYPE_V4_CURRENT_OWNERSHIP_CHANGED');"
            "const reviewEvents=(d.state.journal??[]).filter(x=>x?.type==='EXECUTION_REVIEW_RESOLVED').length;"
            "if(reviewEvents<1)throw Error('HYPE_V4_REVIEW_EVENT_MISSING');"
            "console.log(JSON.stringify({journalCount:d.state.journal.length,reviewEvents}));"],
            {"PATH":"/usr/bin:/bin"},deploy=False)
        self.journal_count=output["journalCount"];self.review_events=output["reviewEvents"]
        self.wiring=monitoring(self.release);self.wiring.assert_applied()
        self.health()
        return dict(status="HYPE_SHA_RESTORE_PREFLIGHT_PASS",candidateSha=CANDIDATE,
                    planSha256=PLAN,v4Sha=sha,v4PlanSha256=self.v4_plan,journalCount=self.journal_count,
                    reviewEvents=self.review_events,evidenceContract="SIGNED_ASTER_FLAT_3X",
                    resumeAfterStart=True,resumeRunId=resume_run_id,**ZERO)

    def _pending_sdk(self):
        if getattr(self,"pending_sdk",None) is None:
            from disdex_pending_maintenance_install import _load_sdk
            release=self.paths.releases/PENDING_MAINTENANCE_SHA
            self.pending_sdk=_load_sdk(release)
            require(self.pending_sdk.source_release()==release,"PENDING_SDK_SOURCE")
        return self.pending_sdk

    def maintain_pending_freshness(self, force=False):
        """Refresh pending evidence under the already-held exclusive deploy lock.

        The systemd maintenance wrapper intentionally takes a shared deployment
        lock, so launching it from this helper self-deadlocks. Reuse the exact
        certified no-order maintenance core instead: committed authority,
        executor lock, 60-second root grant, deploy-user signed child, normal
        account-order lock/shared budget, and strict before/after verification.
        """
        import secrets
        from disdex_hype_scoped_root_cutover import validate_hype_pending
        from disdex_shared_risk_witness import file_bytes
        path=SHARED/"pending-exposure.json"
        def read_updated():
            raw=file_bytes(path);row=json.loads(raw);updated=row.get("updatedAt")
            require(type(updated) is int and updated>0,"PENDING_UPDATED_AT")
            return raw,updated
        raw,before=read_updated();now=time.time_ns()//1000000
        if not force and 0<=now-before<=240000:
            return before

        sdk=self._pending_sdk();release=self.paths.releases/PENDING_MAINTENANCE_SHA
        credentials=sdk.load_server_credentials()
        receipt_raw,_receipt=sdk.current_authority(release.name)
        sdk.secure(sdk.RUNTIME,directory=True,allowed_write=0o200)
        require(sdk.RUNTIME.stat().st_gid==self.deploy.pw_gid
                and (sdk.RUNTIME.stat().st_mode&0o777)==0o750,"PENDING_RUNTIME_GROUP")
        deadline=time.monotonic()+90
        last_busy=False
        while True:
            runtime_fd=os.open(sdk.RUNTIME/"executor.lock",os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
            grant_path=None
            try:
                sdk.secure(sdk.RUNTIME/"executor.lock",allowed_write=0o200)
                try:
                    fcntl.flock(runtime_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError:
                    last_busy=True
                    if time.monotonic()>=deadline:break
                    time.sleep(0.5);continue
                before_raw=sdk.PENDING.read_bytes();nonce=secrets.token_hex(16)
                grant=sdk.build_service_grant(release.name,sdk.digest(before_raw),os.getpid(),
                    time.time_ns()//1000000,nonce,sdk.digest(receipt_raw))
                grant_path=sdk.RUNTIME/(nonce+".json")
                sdk.exclusive_json(grant_path,grant,self.deploy.pw_gid,0o640)
                try:
                    result=sdk.run_signed_child(release,self.deploy,grant_path=grant_path,credentials=credentials)
                except ValueError as error:
                    if "PENDING_RECONCILE_ACCOUNT_LOCK_BUSY" in str(error):
                        last_busy=True
                        if time.monotonic()>=deadline:break
                        time.sleep(0.5);continue
                    raise
                after_raw=sdk.PENDING.read_bytes();sdk.verify_update(before_raw,after_raw,result)
                report=dict(status="PENDING_MAINTENANCE_RECONCILED",sourceSha=release.name,
                    scope="PENDING_RECONCILE_ONLY",authorizationMethod="ROOT_COMMITTED_NO_ORDER_MAINTENANCE",
                    ordersEnabled=False,result=result,completedAt=time.time_ns()//1000000,
                    caller="HYPE_SHA_RESTORE_EXCLUSIVE_DEPLOY_LOCK")
                sdk.exclusive_json(sdk.MAINTENANCE/"results"/(nonce+".json"),report)
                after_raw,after=read_updated();validate_hype_pending(after_raw,time.time_ns()//1000000)
                require(after>before and result.get("ordersSent")==result.get("cancelsSent")==
                        result.get("positionChangesSent")==0,"PENDING_REFRESH_RESULT")
                proofs=getattr(self,"pending_refresh_proofs",[]);proofs.append(dict(
                    verifiedAt=result.get("verifiedAt"),positionCount=result.get("positionCount"),
                    openOrderCount=result.get("openOrderCount"),ordersSent=0,cancelsSent=0,
                    positionChangesSent=0));self.pending_refresh_proofs=proofs
                return after
            finally:
                if grant_path is not None:grant_path.unlink(missing_ok=True)
                os.close(runtime_fd)
        raise ValueError("HYPE_SHA_RESTORE_PENDING_RECONCILIATION_REQUIRED" if last_busy
                         else "HYPE_SHA_RESTORE_PENDING_REFRESH_FAILED")

    def preview_fresh(self):
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
        failures=d.get("failures") if isinstance(d.get("failures"),list) else []
        last_failure=failures[-1] if failures and isinstance(failures[-1],dict) else {}
        last_decision=d.get("lastDecision") if isinstance(d.get("lastDecision"),dict) else {}
        require(d.get("runtimeCommitSha")==LEGACY and d.get("mode")=="LIVE" and
                d.get("manualReview") is None and not d.get("positions") and not d.get("pending") and
                d.get("updatedAt")==d.get("lastDecisionTs")==last_failure.get("occurredAt") and
                last_decision.get("reason")==REPAIRED and last_failure.get("message")==REPAIRED and
                any(isinstance(x,dict) and x.get("message")==REVIEW for x in failures),
                "REPAIRED_BASELINE")
        self.deploy=pwd.getpwnam("deploy")
        require((self.state_meta.st_uid,self.state_meta.st_gid)==(self.deploy.pw_uid,self.deploy.pw_gid)
                and self.state_meta.st_mode&0o777==0o600,"STATE_OWNER")
        output=self.node(["--input-type=module","--eval",
            "import {readFileSync} from 'node:fs';"
            "import {replayProductionJournal} from './lib/v12-v4-production-lifecycle.ts';"
            f"const d=JSON.parse(readFileSync({json.dumps(str(V4))},'utf8'));"
            "if(d.releaseSha!=='3ad65403013b701db5d9e53e8814e6ab827a28e8'||!d.state)throw Error('HYPE_V4_CURRENT_OWNERSHIP_CHANGED');"
            "const r=replayProductionJournal(d.state.initial,d.state.journal);"
            "const legs=Object.values(r.legs??{});"
            "if(r.executionReview!=null||(r.foreign??[]).length||r.initial?.holdProtected!==false||"
            "legs.some(x=>Math.abs(Number(x.qty??0))>1e-12||!['CLOSED','CANCELLED'].includes(String(x.status))))"
            "throw Error('HYPE_V4_CURRENT_OWNERSHIP_CHANGED');"
            "const reviewEvents=(d.state.journal??[]).filter(x=>x?.type==='EXECUTION_REVIEW_RESOLVED').length;"
            "if(reviewEvents<1)throw Error('HYPE_V4_REVIEW_EVENT_MISSING');"
            "console.log(JSON.stringify({journalCount:d.state.journal.length,reviewEvents}));"],
            {"PATH":"/usr/bin:/bin"},deploy=False)
        self.journal_count=output["journalCount"]
        self.review_events=output["reviewEvents"]
        sha=self.pins["V12_V4"]
        prestart=Path("/usr/local/libexec/disdex-unified/disdex_v4_canonical_prestart.py")
        assert_regular_secure(prestart,root_uid=0,private=False)
        require(str(prestart) in self.systemd._state(self.manifest["runners"]["V12_V4"]["serviceUnit"],"ExecStartPre"),
                "V4_GATE_IDENTITY")
        self.v4_approval_path=SHARED/"operator-activation/v12-v4-full.json"
        self.v4_approval_before=file_bytes(self.v4_approval_path)
        approval=read_root_json(self.v4_approval_path)
        require(file_bytes(self.v4_approval_path)==self.v4_approval_before,"V4_APPROVAL_CHANGED")
        self.v4_readiness=read_root_json(self.paths.releases/sha/"docs/production/v12-v4-implementation-readiness.json",private=False)
        validate_activation(approval,sha,self.pins,self.v4_readiness,int(time.time()))
        self.v4_approval_hash=digest(self.v4_approval_before)
        self.v4_plan=v4_continuity_plan(self.pins,self.desired,self.v4_approval_hash)
        self.health()
        self.wiring=monitoring(self.release)
        return dict(status="HYPE_SHA_RESTORE_PREFLIGHT_PASS",candidateSha=CANDIDATE,
                    planSha256=PLAN,v4Sha=sha,v4PlanSha256=self.v4_plan,journalCount=self.journal_count,
                    reviewEvents=self.review_events,evidenceContract="SIGNED_ASTER_FLAT_3X",**ZERO)

    def node(self, args, env, *, deploy=True):
        opts=dict(user=self.deploy.pw_uid,group=self.deploy.pw_gid,extra_groups=[]) if deploy else {}
        out=subprocess.run(["/usr/bin/node","--import",str(self.release/"node_modules/tsx/dist/loader.mjs"),*args],
            cwd=self.release,env=env,capture_output=True,text=True,timeout=85,**opts)
        if out.returncode:
            codes=re.findall(r"\b(?:HYPE|V4|ASTER|PENDING)_[A-Z0-9_]+\b",out.stderr)
            raise ValueError("HYPE_SHA_RESTORE_CHILD_BLOCKED"+(":"+codes[-1] if codes else ""))
        return json.loads(out.stdout.strip().splitlines()[-1])

    def apply(self, run_id, token, v4_token):
        from disdex_hype_scoped_root_cutover import _atomic, _root_file, _runtime_env
        from disdex_pending_maintenance_install import _load_sdk
        from disdex_shared_risk_witness import file_bytes
        from disdex_unified_root_gate import assert_private_dir, assert_regular_secure
        verify_approval(self.paths,token)
        preflight=self.preview(run_id)
        v4_verify=dict(sha=self.pins[V4_SCOPE],scope=V4_SCOPE,plan=self.v4_plan)
        verify_approval(self.paths,v4_token,**v4_verify)
        if preflight.get("resumeAfterStart") is True:
            return self.reconcile_after_start(run_id,token,v4_token,v4_verify)
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
        baseline={p:(file_bytes(p),p.lstat()) for p in (self.paths.pins,self.paths.current_plan,self.v4_approval_path)}
        require(baseline[self.v4_approval_path][0]==self.v4_approval_before,"V4_APPROVAL_CHANGED")
        self.health()
        require(file_bytes(STATE)==self.state,"STATE_CAS")
        auth=verify_approval(self.paths,token,consume=True)
        v4_auth=verify_approval(self.paths,v4_token,consume=True,**v4_verify)
        v4_activation=build_v4_continuity_activation(v4_auth,self.pins,self.desired,self.v4_approval_hash,int(time.time()))
        from disdex_v4_canonical_prestart import validate_activation
        validate_activation(v4_activation,self.pins[V4_SCOPE],self.desired,self.v4_readiness,int(time.time()))
        tx.mkdir(mode=0o700)
        for name,raw in (("state.before",self.state),("pins.before",baseline[self.paths.pins][0]),
                         ("plan.before",baseline[self.paths.current_plan][0]),("v4-activation.before",self.v4_approval_before),
                         ("monitor-wiring.json",json_bytes(self.wiring.journal()))):
            _root_file(tx/name,raw,0o400,[])
        before_enable=self.systemd.is_enabled(self.old)
        try:
            sdk=self._pending_sdk()
            env=sdk.child_environment(CANDIDATE,self.deploy.pw_dir,credentials=sdk.load_server_credentials())
            require(env.get("DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH")==str(SHARED/"aster-rate-budget.json")
                    and not env.get("DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET"),"SHARED_RATE_BUDGET")
            self.venue_env=env.copy()
            env.update(DISDEX_HYPE_TARGET_SHA=CANDIDATE,DISDEX_HYPE_APPROVAL_PLAN_SHA256=PLAN,
                DISDEX_HYPE_APPROVAL_OPERATION=OPERATION,DISDEX_HYPE_SIGNED_GRANT_VERIFIED="TRUE",
                DISDEX_HYPE_APPROVAL_ORDERS_ENABLED="true",DISDEX_CONTROL_REQUEST_ID=run_id)
            evidence=self.node(["--input-type=module","--eval",PRECHECK_MIGRATE,LEGACY,CANDIDATE,PLAN,run_id],env)
            self.ledger_after=file_bytes(STATE)
            venue_digest=verify_result(evidence)
            self.venue_proof=venue_digest
            self.check_ledger()
            self.health()
            require(int(time.time())<min(auth["expiresAt"],v4_auth["expiresAt"]),"APPROVAL_EXPIRED_BEFORE_START")
            require(digest(file_bytes(self.v4_approval_path))==self.v4_approval_hash,
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
            for p,row in ((self.paths.pins,m),(self.paths.current_plan,{**self.current,"runners":self.desired}),
                          (self.v4_approval_path,v4_activation)):
                raw=json_bytes(row)
                require(file_bytes(p)==baseline[p][0],"PIN_CAS")
                self.installed.append((p,raw))
                _atomic(p,raw,baseline[p][1])
            self.wiring.apply()
            self.systemd.disable(self.old)
            self.only_writer()
            self.parent._assert_expected_pins(self.desired)
            from disdex_unified_root_gate import read_root_json
            validate_activation(read_root_json(self.v4_approval_path),self.pins[V4_SCOPE],self.desired,
                                self.v4_readiness,int(time.time()))
            self.health()
            require(int(time.time())<min(auth["expiresAt"],v4_auth["expiresAt"]),"APPROVAL_EXPIRED_BEFORE_START")
            started_at=time.time_ns()//1000000
            self.started=True
            self.systemd.start(self.new)
            result=self.audit(started_at)
            self.systemd.enable(self.new)
            receipt={**result,"status":"HYPE_SHA_RESTORE_LIVE_VERIFIED","sourceSha":CANDIDATE,
                     "previousSha":LEGACY,"ordersEnabled":True,"githubRunId":run_id,"planSha256":PLAN,
                     "v4PlanSha256":self.v4_plan,"v4PidPreserved":self.context["peers"][V4_SCOPE]["pid"],
                     "signedPreflightReads":evidence["signedVenueReads"],"reviewEvents":evidence["reviewEvents"],
                     "accountFlatVerified":evidence["accountFlatVerified"],"venueProofSha256":venue_digest,**ZERO}
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

    def reconcile_after_start(self, run_id, token, v4_token, v4_verify):
        from disdex_hype_scoped_root_cutover import _root_file
        from disdex_shared_risk_witness import file_bytes
        from disdex_unified_root_gate import read_root_json
        from disdex_v4_canonical_prestart import validate_activation
        require(run_id==self.resume_run_id,"RESUME_RUN_ID_MISMATCH")
        require(file_bytes(STATE)==self.state,"STATE_CAS")
        require(file_bytes(self.v4_approval_path)==self.v4_approval_before,"V4_APPROVAL_CHANGED")
        # Refresh no-order pending evidence before any HYPE downtime. If the
        # service cannot obtain the legitimate shared lock, leave the currently
        # running stale-authority instance untouched and fail closed.
        self.maintain_pending_freshness(force=True)
        if self.resume_stale_live_activation:
            require(self.legacy.approval.exists()
                    and file_bytes(self.legacy.approval)==self.resume_revoked_raw,
                    "RESUME_STALE_AUTHORITY_CAS")
            self.systemd.stop(self.new);self.systemd.disable(self.new)
            require(self.systemd.main_pid(self.new)==0
                    and self.systemd.active_state(self.new) in ("inactive","failed"),
                    "RESUME_STALE_WRITER_STOP_FAILED")
            if not (self.resume_tx/"stale-live-cleared.json").exists():
                _root_file(self.resume_tx/"stale-live-cleared.json",json_bytes(dict(
                    status="HYPE_SHA_RESTORE_STALE_LIVE_AUTHORITY_CLEARED",
                    activationSha256=digest(self.resume_revoked_raw),githubRunId=run_id,
                    clearedAt=time.time_ns()//1000000)),0o400,[])
            require(file_bytes(self.legacy.approval)==self.resume_revoked_raw,
                    "RESUME_STALE_AUTHORITY_CAS")
            self.legacy.approval.unlink()
            system("daemon-reload")
            self.only_writer()
        auth=verify_approval(self.paths,token,consume=True)
        v4_auth=verify_approval(self.paths,v4_token,consume=True,**v4_verify)
        expected_v4=build_v4_continuity_activation(v4_auth,self.resume_prior_pins,self.pins,
                                                   self.resume_prior_v4_hash,int(time.time()))
        require(expected_v4.get("planSha256")==self.v4_plan
                and expected_v4.get("approvedShaByRunner")==self.pins,"RESUME_V4_TOKEN")
        validate_activation(read_root_json(self.v4_approval_path),self.pins[V4_SCOPE],self.pins,
                            self.v4_readiness,int(time.time()))
        require(int(time.time())<min(auth["expiresAt"],v4_auth["expiresAt"]),"APPROVAL_EXPIRED_BEFORE_START")
        activation=dict(schema="disdex-live-operator-activation/v1",repository=REPOSITORY,
            deploymentTarget=HOST,target=OPERATOR_TARGET,scope=RUNNER,operation=OPERATION,
            approvedSha=CANDIDATE,approvedRunners=[RUNNER],approvedShaByRunner={RUNNER:CANDIDATE},
            ordersEnabled=True,activationClass="FULL_LIVE",route="GITHUB_ACTIONS",
            authorizationMethod="OWNER_SIGNED_TOKEN",approvedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(auth["issuedAt"])),
            operatorAcknowledgement="I_ACK_REAL_MONEY_LIVE_ACTIVATION",planSha256=PLAN,
            nonceDigest=digest(auth["nonce"].encode()),githubRunId=run_id,venueProofSha256=self.resume_venue_proof)
        require(not self.legacy.approval.exists() and not self.legacy.approval.is_symlink(),"RESUME_AUTHORITY_NOT_REVOKED")
        _root_file(self.legacy.approval,json_bytes(activation),0o600,[])
        system("daemon-reload")
        check=subprocess.run(["/usr/bin/systemd-analyze","verify",self.new],capture_output=True,timeout=45)
        require(check.returncode==0,"UNIT_VERIFY")
        self.parent._assert_expected_pins(self.pins)
        self.wiring.assert_applied();self.check_ledger();self.only_writer()
        self.health()
        require(int(time.time())<min(auth["expiresAt"],v4_auth["expiresAt"]),"APPROVAL_EXPIRED_BEFORE_START")
        started_at=time.time_ns()//1000000
        self.started=True
        try:
            self.systemd.start(self.new)
            result=self.audit(started_at)
            self.systemd.enable(self.new)
            receipt={**result,"status":"HYPE_SHA_RESTORE_LIVE_VERIFIED","sourceSha":CANDIDATE,
                     "previousSha":LEGACY,"ordersEnabled":True,"githubRunId":run_id,"planSha256":PLAN,
                     "v4PlanSha256":self.v4_plan,"v4PidPreserved":self.context["peers"][V4_SCOPE]["pid"],
                     "signedPreflightReads":3,"reviewEvents":self.review_events,"accountFlatVerified":True,
                     "venueProofSha256":self.resume_venue_proof,"reconciledAfterStart":True,**ZERO}
            _root_file(self.resume_tx/"receipt.json",json_bytes(receipt),0o400,[])
            return receipt
        except Exception:
            if self.legacy.approval.exists():
                require(file_bytes(self.legacy.approval)==json_bytes(activation),"ROLLBACK_AUTHORITY_CAS")
                tag=digest(auth["nonce"].encode())[:16]
                _root_file(self.resume_tx/f"activation.reconcile-revoked.{tag}",json_bytes(activation),0o400,[])
                self.legacy.approval.unlink()
            self.systemd.stop(self.new);self.systemd.disable(self.new)
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
            self.maintain_pending_freshness()
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
                    healthSnapshotAt=raw["generatedAt"],venueProofSha256=self.venue_proof,
                    accountFlatVerified=True)


def main():
    from disdex_unified_root_gate import _assert_execution_root, assert_regular_secure, default_execution_paths
    try:
        _assert_execution_root(0)
        run_id=validate_args(sys.argv[1:])
        preview=run_id is None
        lock=default_execution_paths().root/"deployment-execution.lock"
        with os.fdopen(os.open(lock,os.O_RDWR|os.O_NOFOLLOW),"rb+") as fd:
            st=assert_regular_secure(lock,root_uid=0,private=True)
            op=os.fstat(fd.fileno())
            require((st.st_dev,st.st_ino)==(op.st_dev,op.st_ino),"DEPLOY_LOCK_REPLACED")
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            restore=Restore()
            if preview:result=restore.preview()
            else:
                payload=json.loads(sys.stdin.read(32769))
                require(isinstance(payload,dict) and set(payload)=={"hype","v4"}
                        and all(isinstance(v,str) and 0<len(v)<=16384 for v in payload.values()),"APPROVAL_ENVELOPE")
                result=restore.apply(run_id,payload["hype"],payload["v4"])
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
