"""Resume only the same approved V4 transaction after its initial audit timed out.

Does not issue trade/cancel calls, revise approval scope, or restore an old source.
The original fixed plan hash is supplied by the operator, never self-approved.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace


def validate_resume_binding(*,sha,approved_plan_hash,approved_plan,journal,pins,desired,unit_bytes):
    if not isinstance(sha,str) or not re.fullmatch('[a-f0-9]{40}',sha):raise ValueError('RESUME_SHA_INVALID')
    if not isinstance(approved_plan_hash,str) or not re.fullmatch('[a-f0-9]{64}',approved_plan_hash):raise ValueError('RESUME_APPROVED_PLAN_INVALID')
    if approved_plan.get('sourceSha')!=sha or approved_plan.get('planSha256')!=approved_plan_hash:raise ValueError('RESUME_ORIGINAL_APPROVAL_MISMATCH')
    old=approved_plan.get('oldSha')
    if not isinstance(old,str) or not re.fullmatch('[a-f0-9]{40}',old) or old==sha:raise ValueError('RESUME_OLD_SHA_INVALID')
    if not (journal.get('phase')=='RECOVERY_REQUIRED_PROTECTED' and journal.get('scope')=='V12_V4'
            and journal.get('newSha')==sha and journal.get('oldSha')==old
            and journal.get('reason') in ('V4_REAL_DECISION_CYCLE_TIMEOUT','DYNAMIC_EVIDENCE_REFRESH_FAILED','GENUINE_PENDING_MAINTENANCE_FAILED')
            and journal.get('candidateOwnershipRetained') is True
            and journal.get('oldSourceRestartAuthorized') is False
            and journal.get('requiresFreshVenueAndDurableCompatibility') is True):raise ValueError('RESUME_NOT_INITIAL_TIMEOUT_PROTECTED')
    if desired.get('sourceSha')!=sha or desired.get('scope')!='V12_V4' or desired.get('ordersEnabled') is not True or desired.get('runners')!=pins or pins.get('V12_V4')!=sha:raise ValueError('RESUME_PIN_OR_APPROVED_SCOPE_CHANGED')
    root=('/home/deploy/disdex-trading/releases/'+sha).encode()
    if root not in unit_bytes or b'disdex_v4_canonical_prestart.py' not in unit_bytes or b' --daemon' not in unit_bytes or b'--monitor-only' in unit_bytes:raise ValueError('RESUME_UNIT_NOT_EXACT_FULL_SOURCE')
    return old


@contextmanager
def shared_readonly_audit(lock,flock_module=None):
    """Block deployment writers while admitting committed no-order maintenance.

    Restore exclusive ownership before every lifecycle mutation or cleanup.
    """
    if flock_module is None:import fcntl as flock_module
    flock_module.flock(lock,flock_module.LOCK_SH)
    try:yield
    finally:flock_module.flock(lock,flock_module.LOCK_EX)


def refresh_committed_pending_maintenance():
    # This actual systemd service validates its own PID, committed root receipt,
    # signed account and deploy-owned account lease before its CAS registry write.
    unit='disdex-pending-exposure-reconcile.service';deadline=time.monotonic()+600
    while True:
        result=subprocess.run(['/usr/bin/systemctl','start','--wait',unit],capture_output=True,text=True,timeout=90)
        if result.returncode==0:break
        invocation=subprocess.check_output(['/usr/bin/systemctl','show',unit,'-p','InvocationID','--value'],text=True).strip()
        rows=subprocess.check_output(['/usr/bin/journalctl','-u',unit,'-n','30','--no-pager','-o','json'],text=True).splitlines()
        reason=None
        for raw in rows:
            try:
                event=json.loads(raw)
                if not invocation or event.get('_SYSTEMD_INVOCATION_ID')!=invocation:continue
                payload=json.loads(event.get('MESSAGE','{}'))
                if payload.get('status')=='PENDING_MAINTENANCE_FAIL_CLOSED':reason=payload.get('reason')
            except (ValueError,TypeError,AttributeError):continue
        if reason!='PENDING_MAINTENANCE_CHILD_REJECTED:PENDING_RECONCILE_ACCOUNT_LOCK_BUSY' or time.monotonic()>=deadline:raise ValueError('GENUINE_PENDING_MAINTENANCE_FAILED')
        time.sleep(2)
    row=json.loads(Path('/var/lib/disdex/shared/pending-exposure.json').read_text());now=int(time.time()*1000)
    updated=row.get('updatedAt')
    if type(updated)is not int or not 0<updated<=now+1000 or now-updated>90000:raise ValueError('GENUINE_PENDING_MAINTENANCE_NOT_FRESH')


def protect_resume_failure(systemd,unit,prior_journal,reason,write_journal):
    """Attempt every isolation action even if a prior action reports failure."""
    errors=[]
    for action in ['stop','disable','mask']:
        try:
            if action=='stop' and not systemd.is_active(unit):continue
            if action=='disable' and not systemd.is_enabled(unit):continue
            getattr(systemd,action)(unit)
        except Exception as error:errors.append(action+':'+type(error).__name__)
    isolated=systemd.main_pid(unit)==0 and not systemd.is_active(unit) and systemd.is_masked(unit)
    write_journal({**prior_journal,'phase':'RECOVERY_REQUIRED_PROTECTED' if isolated else 'RECOVERY_ISOLATION_FAILED','reason':reason[:240],'sameApprovedTransactionResume':True,'isolationErrors':errors})
    if not isolated:raise RuntimeError('RESUME_FAILURE_ISOLATION_INCOMPLETE')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--sha',required=True);parser.add_argument('--approved-plan-sha256',required=True);parser.add_argument('--audit-root',required=True)
    args=parser.parse_args()
    import sys,fcntl,stat
    sys.path.insert(0,'/usr/local/libexec/disdex-unified')
    from disdex_unified_root_gate import (assert_codex_ssh_session,read_root_json,parse_live_pins,release_marker,_atomic_json,_validate_venue_evidence,build_codex_ssh_authorization,_consume_codex_ssh_nonce,assert_private_dir)
    from disdex_v4_priority_live import V4LocalUnitSystemdAdapter
    from disdex_v4_canonical_prestart import validate_activation
    from disdex_v4_root_cutover import await_v4_decision_cycle
    from disdex_v4_venue_witness import collect_v4_venue_evidence
    assert_codex_ssh_session()
    root=Path('/var/lib/disdex/unified-deploy');audit=Path(args.audit_root)
    if not audit.is_relative_to(Path('/var/lib/disdex/ops-audit')) or '..' in audit.parts:raise ValueError('RESUME_AUDIT_SCOPE')
    assert_private_dir(audit,root_uid=0)
    sha=args.sha;unit='disdex-v12-v4@'+sha+'.service';release=Path('/home/deploy/disdex-trading/releases')/sha
    lock=os.open(root/'deployment-execution.lock',os.O_RDWR)
    for attempt in range(45):
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
        except BlockingIOError:
            if attempt==44:os.close(lock);raise
            time.sleep(1)
    attempted=False;systemd=None;transaction=None;prior_journal=None
    digest=lambda b:hashlib.sha256(b).hexdigest()
    try:
        release_marker(sha)
        manifest=read_root_json(Path('/etc/disdex/runner-pins.json'),private=False);pins=parse_live_pins(manifest)
        prior_journal=read_root_json(root/'transaction.json')
        approved=read_root_json(audit/'direct-cutover-plan.json')
        desired=read_root_json(root/'plans/V12_V4'/(sha+'.json'))
        backup=audit/'direct-cutover-unit-backups'/(unit+'.original')
        meta=backup.lstat()
        if not stat.S_ISREG(meta.st_mode) or meta.st_uid!=0 or meta.st_mode&0o077:raise ValueError('RESUME_UNIT_BACKUP_UNTRUSTED')
        raw=backup.read_bytes()
        old=validate_resume_binding(sha=sha,approved_plan_hash=args.approved_plan_sha256,approved_plan=approved,journal=prior_journal,pins=pins,desired=desired,unit_bytes=raw)
        oldunit='disdex-v12-v4@'+old+'.service'
        runtime_path=Path('/var/lib/disdex/shared/operator-activation/v12-v4-full.json')
        runtime=read_root_json(runtime_path)
        readiness=read_root_json(release/'docs/production/v12-v4-implementation-readiness.json',private=False)
        validate_activation(runtime,sha,pins,readiness,int(time.time()))
        protected={p:digest(p.read_bytes()) for p in [runtime_path,Path('/etc/disdex/runner-pins.json'),root/'current-plan.json']}
        original_journal_hash=digest((root/'transaction.json').read_bytes())
        authority=build_codex_ssh_authorization(SimpleNamespace(route='CODEX_SSH',owner='codex-ssh',_codex_ssh_authenticated=True,sha=sha,scope='V12_V4',orders_enabled='true',plan_sha256=args.approved_plan_sha256))
        # This is the previously approved fixed transaction, with a fresh replay-protected root session nonce.
        _consume_codex_ssh_nonce(root/'nonces',authority['nonce'],root_uid=0)
        transaction=audit/('authorized-timeout-resume-'+authority['nonce']);transaction.mkdir(mode=0o700)
        _atomic_json(transaction/'authorization.json',authority,root_uid=0)
        systemd=V4LocalUnitSystemdAdapter({unit},transaction)
        unitpath=Path('/etc/systemd/system')/unit
        if systemd.main_pid(unit)!=0 or systemd.main_pid(oldunit)!=0 or not systemd.is_masked(unit) or not systemd.is_masked(oldunit):raise ValueError('RESUME_DUPLICATE_OR_UNPROTECTED_WRITER')
        if not unitpath.is_symlink() or str(unitpath.readlink())!='/dev/null':raise ValueError('RESUME_UNIT_MASK_CHANGED')
        # While V4 is masked the regular maintenance service correctly refuses
        # its running-peer proof. The caller first performs the separately
        # signed stopped-owner reconciliation. Revalidate fresh full venue
        # evidence here; do not invent freshness or pretend V4 is running.
        before=_validate_venue_evidence(collect_v4_venue_evidence(sha=sha,expected_pins=pins,phase='before'),now=int(time.time()),label='authorized-resume-before',require_v4_runtime=False)
        if digest((root/'transaction.json').read_bytes())!=original_journal_hash or any(digest(p.read_bytes())!=h for p,h in protected.items()) or backup.read_bytes()!=raw:raise ValueError('RESUME_AUTHORITY_CAS_CHANGED')
        _atomic_json(transaction/'before.json',before,root_uid=0)
        print(json.dumps({'status':'AUTHORIZED_V4_RESUME_PREFLIGHT_VERIFIED','sha':sha,'approvedPlanSha256':args.approved_plan_sha256}),flush=True)
        temp=unitpath.with_name('.authorized-resume-'+authority['nonce'])
        fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
        with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        if not unitpath.is_symlink() or str(unitpath.readlink())!='/dev/null':raise ValueError('RESUME_UNIT_RESTORE_CAS')
        # Once the mask may be replaced, every later error must restore isolation,
        # including daemon-reload failures before start has been attempted.
        attempted=True
        os.replace(temp,unitpath);subprocess.run(['/usr/bin/systemctl','daemon-reload'],check=True,capture_output=True)
        started=int(time.time()*1000);systemd.start(unit);pid=systemd.main_pid(unit)
        print(json.dumps({'status':'AUTHORIZED_V4_RESUME_PROCESS_STARTED','sha':sha,'mainPid':pid}),flush=True)
        _atomic_json(root/'transaction.json',{**prior_journal,'phase':'ACTIVE_AWAITING_AUDIT','sameApprovedTransactionResume':True},root_uid=0)
        rows=[];previous=None;captured=before['capturedAt']
        with shared_readonly_audit(lock):
            for cycle in range(3):
                if systemd.main_pid(oldunit)!=0:raise RuntimeError('RESUME_OLD_WRITER_STARTED')
                decision=await_v4_decision_cycle(systemd,sha=sha,release=release,pid=pid,started_after_ms=started,previous_tick=previous)
                if previous is not None and decision['tickCompletedAt']<=previous:raise RuntimeError('RESUME_TICK_NOT_ADVANCED')
                previous=decision['tickCompletedAt']
                refresh_committed_pending_maintenance()
                after=_validate_venue_evidence(collect_v4_venue_evidence(sha=sha,expected_pins=pins,phase='after'),now=int(time.time()),label='authorized-resume-after-'+str(cycle+1),baseline=before)
                if after['capturedAt']<=captured:raise RuntimeError('RESUME_SIGNED_WITNESS_NOT_ADVANCED')
                captured=after['capturedAt'];after['decisionCycle']=decision;rows.append(after)
                _atomic_json(transaction/('cycle-'+str(cycle+1)+'.json'),after,root_uid=0)
                print(json.dumps({'status':'AUTHORIZED_V4_REAL_CYCLE_VERIFIED','cycle':cycle+1,'tickCompletedAt':previous,'sha':sha}),flush=True)
        if any(digest(p.read_bytes())!=h for p,h in protected.items()):raise RuntimeError('RESUME_FINAL_AUTHORITY_CHANGED')
        receipt=dict(schema='disdex-unified-deploy-receipt/v1',status='V4_LIVE_CUTOVER_VERIFIED',targetSha=sha,scope='V12_V4',ordersEnabled=True,route='CODEX_SSH',sameApprovedTransactionResume=True,planSha256=args.approved_plan_sha256,newUnit=unit,oldUnit=oldunit,approvedRunners=['V12_V4'],approvedShaByRunner=pins,authorizationMethod='ROOT_SSH_SESSION',nonceDigest=digest(authority['nonce'].encode()),auditCycles=rows,ordersSent=0,cancelsSent=0,positionChangesSent=0)
        systemd.enable(unit)
        subprocess.run(['/usr/bin/systemctl','enable','--now','disdex-v4-dynamic-evidence-refresh@'+sha+'.timer'],check=True,capture_output=True)
        subprocess.run(['/usr/bin/systemctl','disable','--now','disdex-v4-dynamic-evidence-refresh@'+old+'.timer'],check=True,capture_output=True)
        subprocess.run(['/usr/bin/systemctl','stop','disdex-v4-dynamic-evidence-refresh@'+old+'.service'],check=True,capture_output=True)
        _atomic_json(transaction/'live-receipt.json',receipt,root_uid=0)
        _atomic_json(root/'transaction.json',dict(schema=prior_journal['schema'],phase='COMMITTED',scope='V12_V4',oldSha=old,newSha=sha,receipt=str(transaction/'live-receipt.json'),sameApprovedTransactionResume=True),root_uid=0)
        _atomic_json(audit/'direct-cutover-result.json',receipt,root_uid=0)
        print(json.dumps({'status':receipt['status'],'sha':sha,'auditCycles':3,'sameApprovedTransactionResume':True,'ordersSent':0,'cancelsSent':0}),flush=True)
    except Exception as error:
        if attempted:
            try:
                protect_resume_failure(systemd,unit,prior_journal,str(error),lambda row:_atomic_json(root/'transaction.json',row,root_uid=0))
            finally:
                failure=dict(status='V4_RESUME_FAILED',targetSha=sha,scope='V12_V4',planSha256=args.approved_plan_sha256,reason=str(error)[:240],ordersSent=0,cancelsSent=0)
                _atomic_json(transaction/'live-receipt.json',failure,root_uid=0)
        raise
    finally:
        fcntl.flock(lock,fcntl.LOCK_UN);os.close(lock)


if __name__=='__main__':main()
