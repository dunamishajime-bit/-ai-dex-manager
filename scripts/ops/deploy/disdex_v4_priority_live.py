#!/usr/bin/env python3
"""V4-first recovery through authenticated root SSH, never a gate override.

Peer sources and approval files remain unchanged. Clearing the one obsolete
shared V52 hold can restore peers' existing permissions; it issues no peer
approval. New V4 order authority is issued only by the full scoped executor.
"""
from __future__ import annotations
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import time
import os
import subprocess
import shlex
import re
import importlib.util
import math
from types import SimpleNamespace

FIXED_V52_SHA='041653b7b808fd46be2fef408c8e41a1c6d3a55b'
Q102_SHA='ef1ab178e26a7bf5bddb6473467765edba242e1d'
REASON='V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha'
SCOPE='V12_V4'
CANDIDATE_SHA='2a6f27c6d2896aee420cbc44fe1ab8103750376c'
PRIOR_SHA='53a0be396719f0284af4e11b35c66a4ac7d58f79'
ROOT=Path('/var/lib/disdex/unified-deploy')
RELEASES=Path('/home/deploy/disdex-trading/releases')
SHARED=Path('/var/lib/disdex/shared')
STATE=Path('/var/lib/disdex/v12-v4/orders.json')
STATIC=Path('/var/lib/disdex/ops-audit/resume-7b5058a9-82ec7885/v4-2a6-static-evidence-1793745207978')
ECONOMIC_FILES=('lib/v12-v4-production-lifecycle.ts','lib/v12-v4-v2-shadow.ts',
 'lib/v12-v4-production-features.ts','lib/v12-v4-native-source.ts','lib/v12-v4-native-core.ts',
 'lib/v12-v4-time-stop-approval.ts','lib/v12-v4-production-contract.ts','config/v12X1AllRuntime.ts')

def digest(raw):return hashlib.sha256(raw).hexdigest()
def economic_source_equal(a,b):return a.replace(b'\r\n',b'\n')==b.replace(b'\r\n',b'\n')

def render_refresh_service(raw,sha):
    prefix='ExecStart=/usr/bin/flock -n /run/disdex-v4-evidence-refresh/refresh.lock '
    release='/home/deploy/disdex-trading/releases/'+sha
    old=prefix+'/usr/bin/node '+release+'/node_modules/tsx/dist/cli.mjs '+release+'/scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts --sha '+sha+' --apply --lease /var/lib/disdex/unified-deploy/refresh-leases/v4/'+sha+'.json'
    require(raw.count(old.encode())==1,'EXACT_REFRESH_COMMAND_REQUIRED')
    return raw.replace(old.encode(),(prefix+'/usr/bin/python3 /usr/local/libexec/disdex-unified/disdex_v4_refresh_exec.py --sha '+sha).encode())
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def same_release_recovery_hash(current,pins,current_symlink_sha,sha):
    require(current.get('runners')==pins and pins.get('V12_V4')==sha
        and current.get('sourceSha')==current_symlink_sha and current.get('scope')==SCOPE
        and current.get('ordersEnabled') is True,'RECOVERY_EXACT_EXISTING_PLAN')
    return digest(canonical(dict(operation='V4_SAME_RELEASE_PROTECTED_RECOVERY',candidateSha=sha,
        runners=pins,currentPlanSha256=digest(canonical(current)))))

def validate_recovery_document(d,sha):
    require(d.get('schema')==2 and d.get('releaseSha')==sha,'RECOVERY_LEDGER_SHA')
    state=d.get('state',{})
    require(state.get('initial',{}).get('holdProtected') is False and not state.get('executionReview')
        and state.get('foreign')==[],'RECOVERY_LEDGER_REVIEW_OR_FOREIGN')
    require(isinstance(d.get('intents'),dict) and all(x.get('stage')=='TERMINAL' for x in d['intents'].values())
        and isinstance(d.get('protections'),dict) and all(x.get('phase')=='CLOSED' for x in d['protections'].values()),'RECOVERY_UNRESOLVED_ORDER')
    require(isinstance(state.get('legs'),dict),'RECOVERY_LEGS_MISSING')
    for leg in state['legs'].values():
        require(leg.get('status') in ('CLOSED','CANCELLED'),'RECOVERY_ACTIVE_LEG')
        for key in ['qty','entryNotional','reservationUsd','exitRemainingQty']:
            value=leg.get(key)
            require(type(value) in (float,int) and math.isfinite(value) and 0<=value<=1e-8,'RECOVERY_ACTIVE_OR_INVALID_QUANTITY')
    return True
def bytes_at(path):
    from disdex_shared_risk_witness import file_bytes
    return file_bytes(Path(path))
def json_at(path):return json.loads(bytes_at(path))
def private_dir(path):
    from disdex_unified_root_gate import assert_private_dir
    if not path.exists():
        assert_private_dir(path.parent,root_uid=0);path.mkdir(mode=0o700)
    assert_private_dir(path,root_uid=0)
def exclusive_json(path,value):
    from disdex_unified_root_gate import assert_private_dir
    assert_private_dir(path.parent,root_uid=0)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    with os.fdopen(fd,'wb') as handle:
        handle.write(canonical(value));handle.flush();os.fsync(handle.fileno())

class V4LocalUnitSystemdAdapter:
    """Preserve local instance files when masking the exact stopped V4 units."""
    def __init__(self,allowed,backups,*,unit_root=Path('/etc/systemd/system'),root_uid=0):
        from disdex_unified_root_gate import SystemdAdapter
        self.backend=SystemdAdapter();self.allowed=allowed;self.backups=backups
        self.unit_root=unit_root;self.root_uid=root_uid;self.originals={}
    def __getattr__(self,name):return getattr(self.backend,name)
    def _check_unit(self,unit):
        require(unit in self.allowed and re.fullmatch(r'disdex-v12-v4@[a-f0-9]{40}\.service',unit),'UNIT_MASK_SCOPE')
        require(self.active_state(unit) in ('inactive','failed') and self.main_pid(unit)==0,'UNIT_MASK_REQUIRES_STOPPED_PID')
    def _reload(self):subprocess.run(['/usr/bin/systemctl','daemon-reload'],check=True,capture_output=True)
    def _sync(self):
        fd=os.open(self.unit_root,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    def mask(self,unit):
        import stat,uuid
        self._check_unit(unit);path=self.unit_root/unit
        if path.is_symlink():
            require(str(path.readlink())=='/dev/null','UNIT_MASK_LINK_TARGET')
        elif path.exists():
            s=path.lstat();parent=self.unit_root.lstat()
            require(stat.S_ISREG(s.st_mode) and s.st_uid==self.root_uid and not s.st_mode&0o022
                and parent.st_uid==self.root_uid and not parent.st_mode&0o022,'UNIT_MASK_METADATA')
            raw=bytes_at(path);backup=self.backups/(unit+'.original')
            fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
            with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
            self.originals[unit]=(raw,s)
            temp=self.unit_root/('.v4-mask-'+uuid.uuid4().hex);os.symlink('/dev/null',temp)
            require(bytes_at(path)==raw and path.lstat().st_ino==s.st_ino,'UNIT_MASK_CAS')
            os.replace(temp,path);self._sync();self._reload()
        self._run('mask',unit)
    def unmask(self,unit):
        import stat,uuid
        self._check_unit(unit)
        if unit not in self.originals:return self._run('unmask',unit)
        path=self.unit_root/unit;raw,s=self.originals[unit]
        require(path.is_symlink() and str(path.readlink())=='/dev/null','UNIT_UNMASK_CAS')
        temp=self.unit_root/('.v4-restore-'+uuid.uuid4().hex)
        fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,stat.S_IMODE(s.st_mode))
        with os.fdopen(fd,'wb') as f:
            f.write(raw);os.fchown(f.fileno(),s.st_uid,s.st_gid);f.flush();os.fsync(f.fileno())
        require(path.is_symlink() and str(path.readlink())=='/dev/null','UNIT_UNMASK_CAS')
        os.replace(temp,path);self._sync();self._reload()

PROBE=r'''
import {readFile,lstat} from 'node:fs/promises';
import {v4PeerOwners} from './lib/v12-v4-peer-state-owners.ts';
import {observeV4PeerService,observeCurrentV4PeerService} from './lib/v12-v4-peer-service-attestation.ts';
import {validateOperatorActivationArtifact,validateOperatorActivationFileMetadata} from './scripts/ops/root/disdex-live-operator-activation-gate.mjs';
const sources=[];
for(const [kind,path] of Object.entries(JSON.parse(process.env.PEER_PATHS))){
 const raw=JSON.parse(await readFile(path,'utf8'));let sha=String(raw.runtimeCommitSha??raw.runtimeSha??'');
 let service,programShaSource='STATE';
 if(!sha){const actual=await observeCurrentV4PeerService(kind);sha=actual.sha;service=actual.service;programShaSource='SYSTEMD';}
 else service=await observeV4PeerService(kind,sha);
 sources.push({kind,programSha:sha,programShaSource,raw,service});
}
const owners=v4PeerOwners(sources,process.env.DISDEX_RELEASE_SHA,Date.now(),'ATTEST_EACH_PEER');
if(owners.length)throw Error('PRIORITY_FOREIGN_EXPOSURE');
for(const row of JSON.parse(process.env.PEER_GATES)){
 const s=await lstat(row.path);if(!validateOperatorActivationFileMetadata(s).allowed)throw Error('PEER_ARTIFACT_METADATA');
 const result=validateOperatorActivationArtifact(JSON.parse(await readFile(row.path,'utf8')),
  {runner:row.runner,sha:row.sha,target:'DD1296_FINAL_ALLIN_10BPS'});
 if(!result.allowed)throw Error('PEER_ARTIFACT_REJECTED');
}
console.log(JSON.stringify({status:'V4_PRIORITY_PEERS_READY',verifiedAt:Date.now(),peers:sources.length,owners:owners.length}));
'''

class ProductionOperations:
    def __init__(self,expected_hash=None,recovery=False):
        self.expected_hash=expected_hash;self.bootstrap=None
        self.recovery=recovery
        self.release=RELEASES/CANDIDATE_SHA

    def _node(self,program,*,env=None,timeout=60):
        base=dict(PATH='/usr/bin:/bin',NODE_ENV='production',DISDEX_RELEASE_SHA=CANDIDATE_SHA,
            DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=str(SHARED/'aster-rate-budget.json'))
        if env:base.update(env)
        result=subprocess.run(['/usr/bin/node','--import',str(self.release/'node_modules/tsx/dist/loader.mjs'),
            '--input-type=module','-'],input=program,cwd=self.release,env=base,capture_output=True,text=True,timeout=timeout)
        require(result.returncode==0,'READONLY_NODE_PROBE_FAILED')
        return json.loads(result.stdout)

    def _peer_gate_rows(self):
        rows=[]
        for runner,item in self.manifest['runners'].items():
            if runner in ('V12_V4','SHARED_CRYPTO_RISK','MARGIN_GUARD'):continue
            text=subprocess.run(['/usr/bin/systemctl','show',item['serviceUnit'],'-p','ExecStartPre','--value'],
                capture_output=True,text=True,check=True).stdout
            paths=set(re.findall(r'--activation-path\s+([^\s;]+)',text))
            require(bool(paths),'PEER_ACTIVATION_GATE_MISSING')
            for path in sorted(paths):
                require(path.startswith('/var/lib/disdex/') and '/operator-activation/' in path and path.endswith('.json'),'PEER_GATE_PATH')
                rows.append(dict(runner=runner,sha=item['sha'],path=path))
        return rows

    def _context(self):
        value=self.reader.read_context();value.pop('pendingHash')
        value['peerApprovalHashes']={row['path']:digest(bytes_at(row['path'])) for row in self.gates}
        return value

    def preflight(self):
        import pwd
        from disdex_unified_root_gate import (_assert_execution_root,assert_codex_ssh_session,
            read_root_json,parse_live_pins,release_marker,validate_bootstrap_plan)
        from disdex_shared_risk_witness import ProductionSharedRiskReader
        from disdex_pending_maintenance_install import _load_sdk
        from disdex_v4_monitor_cutover import validate_monitor_observation
        _assert_execution_root(0);assert_codex_ssh_session()
        self.deploy=pwd.getpwnam('deploy');release_marker(CANDIDATE_SHA,RELEASES,root_uid=0)
        self.manifest=read_root_json(Path('/etc/disdex/runner-pins.json'),private=False)
        self.pins=parse_live_pins(self.manifest,releases=RELEASES)
        self.current=read_root_json(ROOT/'current-plan.json')
        self.desired=json.loads(json.dumps(self.current));self.desired.update(sourceSha=CANDIDATE_SHA,scope=SCOPE,ordersEnabled=True)
        self.desired['runners']['V12_V4']=CANDIDATE_SHA
        current_link=Path('/home/deploy/disdex-trading/current').resolve(strict=True).name
        if self.recovery:
            from disdex_deployment_plan import validate
            validate(self.current)
            self.deployment_hash=same_release_recovery_hash(self.current,self.pins,current_link,CANDIDATE_SHA)
        else:self.deployment_hash,_=validate_bootstrap_plan(self.desired,self.current,self.pins,current_link)
        self.reader=ProductionSharedRiskReader();self.gates=self._peer_gate_rows();context=self._context()
        from disdex_shared_risk_monitor_wiring import SharedRiskMonitorWiring
        base=Path('/etc/disdex/current-runtime');common='7688ed7c93a1918d8b44837339b7da5584a868f5'
        def values(sha,prefix,unit=False):
            result={prefix+'EXPECTED_SHA':sha,prefix+'RELEASE_ROOT':str(RELEASES/sha)}
            if unit:result[prefix+'SERVICE_UNIT']='disdex-v12-v4@'+sha+'.service'
            return result
        old=self.pins['V12_V4']
        self.wiring=SharedRiskMonitorWiring([
            (base/(common+'.health-snapshot.env'),values(old,'DISDEX_HEALTH_SNAPSHOT_V12_'),values(CANDIDATE_SHA,'DISDEX_HEALTH_SNAPSHOT_V12_')),
            (base/(common+'.watchdog.env'),values(old,'DISDEX_WATCHDOG_V12_',True),values(CANDIDATE_SHA,'DISDEX_WATCHDOG_V12_',True))])
        v4=context['peers']['V12_V4'];now=time.time_ns()//1000000
        if self.recovery:
            journal=read_root_json(ROOT/'transaction.json')
            require(journal.get('phase')=='RECOVERY_REQUIRED_PROTECTED' and journal.get('newSha')==CANDIDATE_SHA
                and journal.get('candidateOwnershipRetained') is True and self.pins['V12_V4']==CANDIDATE_SHA
                and v4['pid']==0 and v4['activeState'] in ('inactive','failed'),'PROTECTED_RECOVERY_BASELINE')
            from disdex_v4_canonical_prestart import validate_activation
            self.runtime_approval_path=SHARED/'operator-activation/v12-v4-full.json'
            approval=read_root_json(self.runtime_approval_path)
            implementation=read_root_json(self.release/'docs/production/v12-v4-implementation-readiness.json',private=False)
            validate_activation(approval,CANDIDATE_SHA,self.pins,implementation,int(time.time()))
            self.recovery_journal_hash=digest(bytes_at(ROOT/'transaction.json'))
            self.runtime_approval_hash=digest(bytes_at(self.runtime_approval_path))
            unit=f'disdex-v12-v4@{CANDIDATE_SHA}.service'
            self.recovery_unit_path=Path('/etc/systemd/system')/unit
            require(self.recovery_unit_path.is_symlink() and str(self.recovery_unit_path.readlink())=='/dev/null','RECOVERY_CANDIDATE_NOT_MASKED')
            backups=list((ROOT/'v4-priority/transactions').glob('*/'+unit+'.original'))
            require(bool(backups),'RECOVERY_UNIT_BACKUP_MISSING')
            self.recovery_unit_backup=max(backups,key=lambda p:p.stat().st_mtime_ns)
            s=self.recovery_unit_backup.lstat()
            require(s.st_uid==0 and not s.st_mode&0o077,'RECOVERY_UNIT_BACKUP_METADATA')
            self.recovery_unit_bytes=bytes_at(self.recovery_unit_backup)
            require(str(self.release).encode() in self.recovery_unit_bytes and b'disdex_v4_canonical_prestart.py' in self.recovery_unit_bytes
                and b' --daemon' in self.recovery_unit_bytes and b'--monitor-only' not in self.recovery_unit_bytes,'RECOVERY_EXACT_FULL_UNIT')
            require(subprocess.check_output(['/usr/bin/systemctl','show',journal['oldUnit'],'-p','MainPID','--value'],text=True).strip()=='0','RECOVERY_OLD_WRITER_ALIVE')
        else:
            health=json_at('/var/lib/disdex/v12-v4/heartbeat.json');tick=json_at('/var/lib/disdex/runner-health/ticks/v12-v4.json')
            validate_monitor_observation(health,tick,sha=self.pins['V12_V4'],pid=v4['pid'],now=now,previous_tick=None)
        paths={}
        for line in bytes_at('/etc/disdex/disdex-v12-v4.env').decode().splitlines():
            if line.startswith('V12_V4_PEER_STATE_PATHS_JSON='):paths=json.loads(' '.join(shlex.split(line.split('=',1)[1])))
        require(len(paths)==8,'EIGHT_PEER_PATHS')
        probe=self._node(PROBE,env=dict(PEER_PATHS=json.dumps(paths),PEER_GATES=json.dumps(self.gates)))
        require(probe.get('status')=='V4_PRIORITY_PEERS_READY' and probe.get('peers')==8,'PEERS_NOT_READY')
        economic={name:digest(bytes_at(self.release/name)) for name in ECONOMIC_FILES}
        require(all(economic_source_equal(bytes_at(RELEASES/PRIOR_SHA/name),bytes_at(self.release/name))
            for name in ECONOMIC_FILES),'ECONOMICS_CHANGED')
        prior_time_path=Path('/etc/disdex/v12-v4-time-stop-approvals')/(PRIOR_SHA+'.json')
        prior_time=read_root_json(prior_time_path,private=False)
        require(prior_time.get('approvedSha')==PRIOR_SHA and prior_time.get('routeCount')==37
            and prior_time.get('operatorAcknowledgement')=='I_APPROVE_V12_V4_TIME37_FIXED8_EMERGENCY_STOP','PRIOR_TIME_POLICY_NOT_APPROVED')
        static={};payloads={}
        for key,name in [('routeSourceParity','route-source-parity.json'),('v4ExecutionTests','v4-execution-tests.json')]:
            p=STATIC/name;d=read_root_json(p,private=False)
            require(d.get('candidateSha')==CANDIDATE_SHA and d.get('status')=='PASS','STATIC_SHA_OR_STATUS')
            static[key]=dict(path=str(p),sha256=digest(bytes_at(p)));payloads[key]=d
        self.sdk=_load_sdk(RELEASES/'7b7719c65d2c6116d02463fc4603200f28e20762')
        self.credentials=self.sdk.load_server_credentials()
        account=self.credentials.get('ASTER_USER_ADDRESS','').lower()
        require(bool(account),'SIGNED_ACCOUNT_IDENTITY')
        for row in [context['writer'],*context['peers'].values()]:
            if row['sha']==self.pins['V12_V4']:continue
            environment={}
            for raw in Path('/proc',str(row['pid']),'environ').read_bytes().split(b'\0'):
                if b'=' in raw:
                    key,value=raw.split(b'=',1)
                    if key==b'ASTER_USER_ADDRESS':environment['account']=value.decode().lower()
            require(environment.get('account')==account,'PEER_SIGNED_ACCOUNT_MISMATCH')
        signed=self.sdk.run_signed_child(self.sdk.source_release(),self.deploy,credentials=self.credentials)
        require(signed.get('status')=='PENDING_READONLY_RECONCILE_VERIFIED'
            and all(type(signed.get(k)) is int and signed[k]==0 for k in ['ordersSent','cancelsSent','positionChangesSent']),
            'SIGNED_READONLY_MUTATION_BOUNDARY')
        self.signed=signed
        risk=self.reader.read_risk();margin=json_at(SHARED/'margin-risk/guard-live.json');kill=json_at(SHARED/'kill-switch.json')
        pending=json_at(SHARED/'pending-exposure.json')
        require(self._context()==context,'PEER_OR_HOLD_CHANGED_DURING_PREFLIGHT')
        document=json_at(STATE);state_hash=digest(bytes_at(STATE))
        self.reuse_migration=document.get('releaseSha')==CANDIDATE_SHA
        self.migration_receipt=ROOT/'v4-priority/migrations'/(CANDIDATE_SHA+'.json')
        if self.recovery:
            validate_recovery_document(document,CANDIDATE_SHA)
            probe=self._node("import {V4ExecutionStore} from './lib/v12-v4-execution-store.ts';new V4ExecutionStore('/var/lib/disdex/v12-v4/orders.json',process.env.DISDEX_RELEASE_SHA).read();console.log(JSON.stringify({status:'DURABLE_COMPATIBILITY_VERIFIED'}));")
            require(probe.get('status')=='DURABLE_COMPATIBILITY_VERIFIED','RECOVERY_DURABLE_COMPATIBILITY')
        elif self.reuse_migration:
            prior=read_root_json(self.migration_receipt)
            require(prior.get('afterStateSha256')==state_hash and prior.get('newSha')==CANDIDATE_SHA,'MIGRATION_RECEIPT_MISMATCH')
        else:require(document.get('releaseSha')==PRIOR_SHA,'OLD_LEDGER_SHA')
        require(not any(x.get('status')!='RELEASED' for x in pending['entries']),'ACTIVE_PENDING')
        self.facts=dict(candidateSha=CANDIDATE_SHA,oldStateSha=PRIOR_SHA,monitorOnly=not self.recovery,
            recoveryAuthorized=self.recovery,sameSourceProtected=self.recovery,
            positions=signed['positionCount'],openOrders=signed['openOrderCount'],activePending=0,signedVerifiedAt=signed['verifiedAt'],
            risk=risk,margin=margin,kill=kill,v52Sha=self.pins['V52'],q102Sha=self.pins['QUALITY102_CAUSAL_V1'],
            allPeersAttested=True,peerPermissionsUnchanged=True,economicsIdentical=True,time37PriorApprovalVerified=True,
            staticEvidence=dict(candidateSha=CANDIDATE_SHA,routeCount=payloads['routeSourceParity']['routeCount'],sourceParity=payloads['routeSourceParity']['sourceParity'],
                testPasses=payloads['v4ExecutionTests']['testPasses'],typecheck=payloads['v4ExecutionTests']['typecheck']),
            durableHash=state_hash,killHash=digest(bytes_at(SHARED/'kill-switch.json')))
        now=time.time_ns()//1000000;validate_priority_evidence(self.facts,now)
        self.original_kill=bytes_at(SHARED/'kill-switch.json')
        require(digest(self.original_kill)==context['killHash']==self.facts['killHash'],'KILL_CHANGED_DURING_PLAN')
        files=dict(routeSourceParity='route-source-parity.json',v4ExecutionTests='v4-execution-tests.json',
            establishedAsterOrders='established-aster-orders.json',signedAsterAccount='signed-aster-account.json',sharedRiskAndPeers='shared-risk-and-peers.json')
        optional=lambda path:digest(bytes_at(path)) if path.exists() else None
        self.plan=dict(schema='disdex-v4-priority-live-plan/v1',repository='dunamishajime-bit/-ai-dex-manager',
            deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS',candidateSha=CANDIDATE_SHA,
            scope=SCOPE,route='CODEX_SSH',ordersEnabled=True,approvedRunners=['V12_V4'],
            oldStateSha=PRIOR_SHA,durableHash=state_hash,killHash=self.facts['killHash'],context=context,
            deploymentPlanSha256=self.deployment_hash,deployUid=self.deploy.pw_uid,deployGid=self.deploy.pw_gid,
            monitorWiring=self.wiring.journal(),
            economicFileHashes=economic,staticEvidence=static,timePolicyId=prior_time['policyId'],priorTimeApprovalHash=digest(bytes_at(prior_time_path)),
            certificateHash=digest(bytes_at('/etc/disdex/v12-v4-production-certification.json')),
            evidenceTargetHashes={k:digest(bytes_at(Path('/etc/disdex/v12-v4-evidence')/name)) for k,name in files.items()},
            commitHash=optional(Path('/etc/disdex/v12-v4-evidence/refresh-commit.json')),
            timeApprovalTargetHash=optional(Path('/etc/disdex/v12-v4-time-stop-approvals')/(CANDIDATE_SHA+'.json')),
            bootstrapProgramSha256=digest(bytes_at(Path(__file__).with_suffix('.mjs').with_name('disdex_v4_priority_bootstrap.mjs'))),
            canonicalPrestartSha256=digest(bytes_at(Path(__file__).with_name('disdex_v4_canonical_prestart.py'))),
            refreshSerializationSha256=digest(bytes_at(Path(__file__).with_name('disdex_v4_refresh_exec.py'))),
            executorProgramSha256=digest(bytes_at(__file__)))
        if self.recovery:self.plan.update(sameReleaseRecovery=True,recoveryJournalHash=self.recovery_journal_hash,
            existingRuntimeApprovalHash=self.runtime_approval_hash,unitBackupPath=str(self.recovery_unit_backup),unitBackupHash=digest(self.recovery_unit_bytes))
        self.plan_hash=digest(canonical(self.plan));return dict(planSha256=self.plan_hash,plan=self.plan)

    def authorize(self,plan):
        from disdex_unified_root_gate import (assert_codex_ssh_session,build_codex_ssh_authorization,_consume_codex_ssh_nonce,assert_private_dir)
        require(self.expected_hash==self.plan_hash,'APPROVED_PLAN_HASH_MISMATCH');assert_codex_ssh_session()
        args=SimpleNamespace(route='CODEX_SSH',owner='codex-ssh',_codex_ssh_authenticated=True,
            sha=CANDIDATE_SHA,scope=SCOPE,orders_enabled='true',plan_sha256=self.plan_hash)
        auth=build_codex_ssh_authorization(args);_consume_codex_ssh_nonce(ROOT/'nonces',auth['nonce'],root_uid=0)
        self.authorization=auth
        for folder in [ROOT/'v4-priority',ROOT/'v4-priority/transactions',ROOT/'v4-priority/migrations',
            ROOT/'plans'/SCOPE,ROOT/'activations'/SCOPE]:private_dir(folder)
        self.transaction=ROOT/'v4-priority/transactions'/auth['nonce'];private_dir(self.transaction)
        exclusive_json(self.transaction/'plan.json',self.plan);exclusive_json(self.transaction/'authorization.json',auth)
        return auth

    def _stage_unit(self):
        require(self._context()==self.plan['context'],'PEERS_CHANGED_BEFORE_STAGING')
        sha=CANDIDATE_SHA
        env=dict(DISDEX_RELEASE_SHA=sha,DISDEX_RUNTIME_COMMIT_SHA=sha,DISDEX_RELEASE_ROOT=str(self.release),V12_V4_LIVE_ACK=sha,
            V12_V4_OPERATION_MODE='CERTIFIED',V12_V4_EXECUTION_STORE_PATH=str(STATE),V12_V4_SERVICE_UNIT=f'disdex-v12-v4@{sha}.service',
            DISDEX_RUNNER_PIN_MANIFEST_PATH='/etc/disdex/runner-pins.json',DISDEX_ACCOUNT_LOCK_PATH=str(SHARED/'account-order.lock'),
            DISDEX_PENDING_EXPOSURE_REGISTRY_PATH=str(SHARED/'pending-exposure.json'),DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=str(SHARED/'aster-rate-budget.json'),
            DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET='/run/disdex-v4-budget-'+sha+'/budget.sock')
        for name in ['DISDEX_SHARED_KILL_SWITCH_FILE','DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE','DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE','DISDEX_V96_KILL_SWITCH_FILE','PENGU_DUAL_LS_V2_KILL_SWITCH_FILE']:env[name]=str(SHARED/'kill-switch.json')
        targets={Path('/etc/disdex/current-runtime')/(sha+'.env'):('\n'.join(k+'='+v for k,v in env.items())+'\n').encode(),
            Path('/etc/systemd/system')/f'disdex-v12-v4@{sha}.service':bytes_at(self.release/'deploy/systemd/disdex-v12-v4@.service').replace(b'%i',sha.encode()),
            Path('/etc/systemd/system')/f'disdex-v4-dynamic-evidence-refresh@{sha}.service':bytes_at(self.release/'ops/systemd/disdex-v4-dynamic-evidence-refresh@.service').replace(b'%i',sha.encode()),
            Path('/etc/systemd/system')/f'disdex-v4-dynamic-evidence-refresh@{sha}.timer':bytes_at(self.release/'ops/systemd/disdex-v4-dynamic-evidence-refresh@.timer').replace(b'%i',sha.encode())}
        unit=Path('/etc/systemd/system')/f'disdex-v12-v4@{sha}.service'
        original=targets[unit].decode()
        original=original.replace('EnvironmentFile=/etc/disdex/current-runtime/'+sha+'.env',
            'EnvironmentFile=/etc/disdex/disdex-v12-aster-credentials.env\nEnvironmentFile=/etc/disdex/current-runtime/'+sha+'.env')
        lines=[line for line in original.splitlines() if not (line.startswith('ExecStartPre=') and 'disdex-live-operator-activation-gate.mjs' in line)]
        require(len(lines)==len(original.splitlines())-1,'ONE_LEGACY_POLICY_GATE_EXPECTED')
        lines.insert(lines.index(next(line for line in lines if line.startswith('ExecStart='))),
            'ExecStartPre=+/usr/bin/python3 /usr/local/libexec/disdex-unified/disdex_v4_canonical_prestart.py --sha '+sha)
        targets[unit]=('\n'.join(lines)+'\n').encode()
        refresh_unit=Path('/etc/systemd/system')/f'disdex-v4-dynamic-evidence-refresh@{sha}.service'
        legacy_refresh=targets[refresh_unit]
        targets[refresh_unit]=render_refresh_service(legacy_refresh,sha)
        for path,raw in targets.items():
            if path.exists():
                actual=bytes_at(path)
                if path==refresh_unit and actual==legacy_refresh:
                    # Only this immutable candidate's exact prior refresh unit
                    # can receive the lossless serialization adapter.
                    exclusive_json(self.transaction/'refresh-unit-replacement.json',dict(path=str(path),beforeSha256=digest(actual),afterSha256=digest(raw)))
                    temp=path.with_name('.v4-refresh-'+self.authorization['nonce'])
                    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
                    with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
                    require(bytes_at(path)==actual,'REFRESH_UNIT_CAS');os.replace(temp,path)
                else:require(actual==raw,'EXISTING_SCOPED_CONFIG_DIFFERS')
            else:
                fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600 if path.suffix=='.env' else 0o644)
                with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        out=Path('/var/lib/disdex/unified-deploy/v4-evidence');out.mkdir(mode=0o750,exist_ok=True)
        subprocess.run(['/usr/bin/systemctl','daemon-reload'],check=True,capture_output=True)

    def prepare(self,grant):
        from disdex_unified_root_gate import assert_private_dir
        require(int(time.time())<grant['expiresAt'],'PREPARATION_AUTHORITY_EXPIRED')
        if self.recovery:
            require(digest(bytes_at(ROOT/'transaction.json'))==self.recovery_journal_hash and digest(bytes_at(STATE))==self.plan['durableHash']
                and digest(bytes_at(self.runtime_approval_path))==self.runtime_approval_hash,'RECOVERY_BASELINE_CHANGED')
            require(self.recovery_unit_path.is_symlink() and str(self.recovery_unit_path.readlink())=='/dev/null'
                and digest(bytes_at(self.recovery_unit_backup))==self.plan['unitBackupHash'],'RECOVERY_UNIT_CAS')
            temp=self.recovery_unit_path.with_name('.recovery-'+grant['nonce'])
            fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
            with os.fdopen(fd,'wb') as f:f.write(self.recovery_unit_bytes);f.flush();os.fsync(f.fileno())
            os.replace(temp,self.recovery_unit_path)
            subprocess.run(['/usr/bin/systemctl','daemon-reload'],check=True,capture_output=True)
        else:self._stage_unit()
        if not self.reuse_migration:
            require(digest(bytes_at(STATE))==self.plan['durableHash'],'DURABLE_CHANGED')
            env=self.sdk.child_environment(CANDIDATE_SHA,self.deploy.pw_dir,credentials=self.credentials)
            env.update(V12_V4_EXECUTION_STORE_PATH=str(STATE),DISDEX_PENDING_EXPOSURE_REGISTRY_PATH=str(SHARED/'pending-exposure.json'),
                DISDEX_ACCOUNT_LOCK_PATH=str(SHARED/'account-order.lock'),V12_V4_STATE_OWNER_UID=str(self.deploy.pw_uid),V12_V4_STATE_OWNER_GID=str(self.deploy.pw_gid))
            result=subprocess.run(['/usr/bin/node','--import',str(self.release/'node_modules/tsx/dist/loader.mjs'),
                str(self.release/'scripts/v12-v4-flat-lineage-migration.ts'),'--apply','--old-sha',PRIOR_SHA,'--new-sha',CANDIDATE_SHA,
                '--ack','I_ACK_V12_V4_FLAT_LINEAGE_MIGRATION_AFTER_SIGNED_RECONCILIATION'],cwd=self.release,env=env,capture_output=True,text=True,timeout=90)
            require(result.returncode==0,'SCOPED_MIGRATION_FAILED');migration=json.loads(result.stdout)
            require(migration.get('status')=='V4_FLAT_LINEAGE_MIGRATION_APPLY_PASS' and migration.get('newSha')==CANDIDATE_SHA
                and migration.get('activeV4Legs')==migration.get('activeIntents')==migration.get('activeProtections')==migration.get('foreignCount')==0,'MIGRATION_RESULT')
            require(migration.get('beforeStateSha256')==self.plan['durableHash'] and migration.get('afterStateSha256')==digest(bytes_at(STATE)),'MIGRATION_HASH')
            exclusive_json(self.migration_receipt,{**migration,'authorizationPlanSha256':self.plan_hash,'appliedAt':time.time_ns()//1000000})
        # Load the immutable matching helper; never rewrite or re-date an old lease.
        file=self.release/'scripts/ops/deploy/disdex_v4_evidence_refresh_activation.py'
        spec=importlib.util.spec_from_file_location('priority_v4_refresh_helper',file);helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
        path=helper.LEASE_ROOT/(CANDIDATE_SHA+'.json');assert_private_dir(path.parent,root_uid=0)
        if path.exists():helper.validate_refresh_lease(json_at(path),sha=CANDIDATE_SHA,now=int(time.time()))
        else:helper.install_refresh_lease(token='',sha=CANDIDATE_SHA,operator='codex-ssh',route='CODEX_SSH',
            plan_sha256=helper.refresh_plan_sha256(CANDIDATE_SHA),public_key=ROOT/'owner-approval-public.pem',nonce_dir=ROOT/'nonces',lease_path=path,codex_ssh_authenticated=True)
        now=time.time_ns()//1000000
        child_grant=dict(schema='disdex-v4-priority-root-grant/v1',repository=self.plan['repository'],deploymentTarget=self.plan['deploymentTarget'],
            operatorTarget=self.plan['operatorTarget'],candidateSha=CANDIDATE_SHA,scope='V12_V4_PREPARATION_ONLY',ordersEnabled=False,authorizesTrading=False,
            authorizationMethod='ROOT_SSH_SESSION',parentPid=os.getpid(),issuedAt=now,expiresAt=min(now+300000,grant['expiresAt']*1000),
            nonce=grant['nonce'],planSha256=self.plan_hash,signedVerifiedAt=self.signed['verifiedAt'],migratedStateHash=digest(bytes_at(STATE)))
        exclusive_json(self.transaction/'grant.json',child_grant)
        env=self.sdk.child_environment(CANDIDATE_SHA,self.deploy.pw_dir,credentials=self.credentials)
        program=Path(__file__).with_name('disdex_v4_priority_bootstrap.mjs')
        from disdex_v4_canonical_prestart import run_certificate_process
        result=run_certificate_process(['/usr/bin/node','--import',str(self.release/'node_modules/tsx/dist/loader.mjs'),str(program),'--grant',str(self.transaction/'grant.json')],
            deploy_gid=self.deploy.pw_gid,cwd=self.release,env=env,capture_output=True,text=True,timeout=180)
        if result.returncode:
            reason='REDACTED'
            try:
                code=json.loads(result.stderr.strip().splitlines()[-1]).get('reason')
                if isinstance(code,str) and re.fullmatch('[A-Z0-9_:]+',code):reason=code
            except (ValueError,IndexError,AttributeError):pass
            require(False,'CERTIFICATE_BOOTSTRAP_FAILED:'+reason)
        self.bootstrap=json.loads(result.stdout);require(self.bootstrap.get('status')=='V4_BOOTSTRAP_READY_NOT_ORDER_ACTIVATED','BOOTSTRAP_STATUS')
        exclusive_json(self.transaction/'bootstrap.json',self.bootstrap)

    def activate(self):
        if self.recovery:return self._activate_recovery()
        from disdex_unified_root_gate import (RootDeploymentExecutor,default_execution_paths,assert_private_dir,_atomic_json)
        require(self.bootstrap is not None,'BOOTSTRAP_REQUIRED')
        directory=ROOT/'plans'/SCOPE;assert_private_dir(directory,root_uid=0)
        path=directory/(CANDIDATE_SHA+'.json')
        if path.exists():require(json_at(path)==self.desired,'EXISTING_DEPLOYMENT_PLAN_DIFFERS')
        else:exclusive_json(path,self.desired)
        args=SimpleNamespace(deployment_target=self.plan['deploymentTarget'],operator_target=self.plan['operatorTarget'],
            sha=CANDIDATE_SHA,scope=SCOPE,route='CODEX_SSH',owner='codex-ssh',orders_enabled='true',plan_sha256=self.deployment_hash,_codex_ssh_authenticated=True)
        units={f'disdex-v12-v4@{s}.service' for s in [self.pins['V12_V4'],CANDIDATE_SHA]}
        executor=RootDeploymentExecutor(default_execution_paths(),systemd=V4LocalUnitSystemdAdapter(units,self.transaction))
        self.wiring.apply()
        result=executor.execute(args,'')
        # The refresh-only timer cannot grant order authority.
        subprocess.run(['/usr/bin/systemctl','enable','--now',f'disdex-v4-dynamic-evidence-refresh@{CANDIDATE_SHA}.timer'],check=True,capture_output=True)
        exclusive_json(self.transaction/'live-receipt.json',result);return result

    def _activate_recovery(self):
        from disdex_unified_root_gate import _atomic_json,_validate_venue_evidence
        from disdex_v4_root_cutover import await_v4_decision_cycle
        from disdex_v4_venue_witness import collect_v4_venue_evidence
        unit=f'disdex-v12-v4@{CANDIDATE_SHA}.service'
        systemd=V4LocalUnitSystemdAdapter({unit},self.transaction)
        require(systemd.main_pid(unit)==0 and not systemd.is_masked(unit),'RECOVERY_START_BASELINE')
        require(digest(bytes_at(self.runtime_approval_path))==self.runtime_approval_hash
            and json_at('/etc/disdex/runner-pins.json')==self.manifest,'RECOVERY_AUTHORITY_OR_PINS_CHANGED')
        before=_validate_venue_evidence(collect_v4_venue_evidence(sha=CANDIDATE_SHA,expected_pins=self.pins,phase='before'),
            now=int(time.time()),label='recovery-before',require_v4_runtime=False)
        started=int(time.time()*1000);attempted=False
        try:
            attempted=True;systemd.start(unit);pid=systemd.main_pid(unit)
            _atomic_json(ROOT/'transaction.json',dict(schema='disdex-unified-deploy-transaction/v1',phase='ACTIVE_AWAITING_AUDIT',
                scope=SCOPE,newSha=CANDIDATE_SHA,newUnit=unit,sameReleaseRecovery=True),root_uid=0)
            rows=[];previous=None
            for cycle in range(3):
                decision=await_v4_decision_cycle(systemd,sha=CANDIDATE_SHA,release=self.release,pid=pid,
                    started_after_ms=started,previous_tick=previous)
                previous=decision['tickCompletedAt']
                after=_validate_venue_evidence(collect_v4_venue_evidence(sha=CANDIDATE_SHA,expected_pins=self.pins,phase='after'),
                    now=int(time.time()),label='recovery-after-'+str(cycle+1),baseline=before)
                after['decisionCycle']=decision;rows.append(after)
            now_context=self._context()
            for key,value in self.plan['context']['peers'].items():
                if key!='V12_V4':require(now_context['peers'][key]==value,'RECOVERY_PEER_CHANGED')
            require(now_context['writer']==self.plan['context']['writer']
                and now_context['peerApprovalHashes']==self.plan['context']['peerApprovalHashes'],'RECOVERY_SHARED_WRITER_OR_PEER_AUTHORITY_CHANGED')
            require(digest(bytes_at(self.runtime_approval_path))==self.runtime_approval_hash
                and json_at('/etc/disdex/runner-pins.json')==self.manifest,'RECOVERY_FINAL_AUTHORITY_OR_PINS_CHANGED')
            result=dict(schema='disdex-unified-deploy-receipt/v1',status='V4_LIVE_CUTOVER_VERIFIED',targetSha=CANDIDATE_SHA,
                scope=SCOPE,ordersEnabled=True,route='CODEX_SSH',sameReleaseRecovery=True,planSha256=self.plan_hash,newUnit=unit,
                repository=self.plan['repository'],deploymentTarget=self.plan['deploymentTarget'],operatorTarget=self.plan['operatorTarget'],
                approvedRunners=['V12_V4'],approvedShaByRunner=self.pins,authorizationMethod='ROOT_SSH_SESSION',
                nonceDigest=digest(self.authorization['nonce'].encode()),auditCycles=rows,ordersSent=0,cancelsSent=0,positionChangesSent=0)
            exclusive_json(self.transaction/'live-receipt.json',result)
            systemd.enable(unit)
            subprocess.run(['/usr/bin/systemctl','enable','--now',f'disdex-v4-dynamic-evidence-refresh@{CANDIDATE_SHA}.timer'],check=True,capture_output=True)
            _atomic_json(ROOT/'transaction.json',dict(schema='disdex-unified-deploy-transaction/v1',phase='COMMITTED',scope=SCOPE,
                newSha=CANDIDATE_SHA,newUnit=unit,receipt=str(self.transaction/'live-receipt.json'),sameReleaseRecovery=True),root_uid=0)
            return result
        except Exception:
            if attempted and systemd.is_active(unit):systemd.stop(unit)
            if systemd.is_enabled(unit):systemd.disable(unit)
            systemd.mask(unit)
            _atomic_json(ROOT/'transaction.json',dict(schema='disdex-unified-deploy-transaction/v1',phase='RECOVERY_REQUIRED_PROTECTED',
                scope=SCOPE,newSha=CANDIDATE_SHA,newUnit=unit,oldUnit='disdex-v12-v4@b3468849cfee0f334b8a1b6a545dbd6c2e48da9a.service',
                candidateOwnershipRetained=True,oldSourceRestartAuthorized=False,requiresFreshVenueAndDurableCompatibility=True),root_uid=0)
            raise

    def protect_on_failure(self):
        # Child failures restore only their own cleared hash. A failed full
        # executor keeps new ownership/state and masks the failed candidate.
        actual=bytes_at(SHARED/'kill-switch.json');row=json.loads(actual)
        ours=(row.get('active') is False and row.get('recoveryPlanSha256')==self.plan_hash
            and row.get('recoveryNonceDigest')==digest(self.authorization['nonce'].encode())
            and row.get('clearedBy')=='codex-ssh' and row.get('reason')==REASON)
        if ours:
            restore_owned_hold(SHARED/'kill-switch.json',digest(actual),self.original_kill)
        if self.recovery:
            unit=f'disdex-v12-v4@{CANDIDATE_SHA}.service'
            systemd=V4LocalUnitSystemdAdapter({unit},self.transaction)
            if systemd.is_active(unit):systemd.stop(unit)
            if systemd.is_enabled(unit):systemd.disable(unit)
            systemd.mask(unit)
        # Only a failure before the V4 ownership switch can restore old pins.
        if hasattr(self,'wiring') and json_at('/etc/disdex/runner-pins.json')['runners']['V12_V4']['sha']==self.pins['V12_V4']:
            self.wiring.restore()

def main():
    import argparse,fcntl
    parser=argparse.ArgumentParser();mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--preview',action='store_true');mode.add_argument('--apply',action='store_true')
    parser.add_argument('--plan-sha256');parser.add_argument('--recover-protected',action='store_true');args=parser.parse_args()
    lock=os.open(ROOT/'deployment-execution.lock',os.O_RDWR)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        op=ProductionOperations(args.plan_sha256,recovery=args.recover_protected)
        if args.preview:result=op.preflight();print(json.dumps(result,sort_keys=True));return
        require(args.plan_sha256 is not None,'EXACT_PLAN_REQUIRED')
        print(json.dumps(execute_priority(op),sort_keys=True))
    except Exception as error:
        # No raw child stderr, credential-bearing URL or environment is logged.
        reason=str(error) if isinstance(error,ValueError) and str(error).startswith('V4_PRIORITY_') else type(error).__name__
        print(json.dumps(dict(status='V4_PRIORITY_FAILED_CLOSED',reason=reason)),file=__import__('sys').stderr)
        raise SystemExit(2)
    finally:fcntl.flock(lock,fcntl.LOCK_UN);os.close(lock)

def require(value,reason):
    if not value:raise ValueError('V4_PRIORITY_'+reason)

def validate_priority_evidence(f,now_ms):
    require(isinstance(f,dict),'FACTS')
    require(f.get('monitorOnly') is True or (f.get('recoveryAuthorized') is True
        and f.get('sameSourceProtected') is True),'MONITOR_OR_PROTECTED_SAME_SOURCE_REQUIRED')
    for key in ['allPeersAttested','peerPermissionsUnchanged',
                'economicsIdentical','time37PriorApprovalVerified']:
        require(f.get(key) is True,key.upper())
    for key in ['positions','openOrders','activePending']:
        require(type(f.get(key)) is int and f[key]==0,'SIGNED_FLAT_REQUIRED')
    timestamp=f.get('signedVerifiedAt')
    require(type(timestamp) is int and 0<=now_ms-timestamp<=30000,'SIGNED_PROOF_FRESHNESS')
    require(f.get('v52Sha')==FIXED_V52_SHA and f.get('q102Sha')==Q102_SHA,'REPAIRED_PEER_SHA')
    risk=f.get('risk',{});margin=f.get('margin',{});kill=f.get('kill',{})
    require(risk.get('maximumLossPct')==7.5 and risk.get('tripped') is False
        and risk.get('sourceComplete') is True,'SHARED_RISK')
    day=datetime.fromtimestamp(now_ms/1000,timezone.utc).date().isoformat()
    require(risk.get('utcDay')==day,'RISK_UTC_DAY')
    for obj,key,age in [(risk,'updatedAt',120000),(margin,'checkedAt',360000)]:
        require(type(obj.get(key)) in (int,float) and 0<=now_ms-obj[key]<=age,'SOURCE_FRESHNESS')
    require(margin.get('stage')=='HEALTHY' and margin.get('ordersAllowed') is True,'MARGIN')
    require(kill.get('active') is True and kill.get('action')=='HOLD_PROTECTED'
        and kill.get('operator')=='disdex-v52-aster-only' and kill.get('recoverable') is True
        and kill.get('reason')==REASON,'EXACT_OBSOLETE_HOLD_REQUIRED')
    evidence=f.get('staticEvidence',{})
    require(evidence.get('candidateSha')==f.get('candidateSha')
        and evidence.get('routeCount')==41 and evidence.get('sourceParity') is True
        and type(evidence.get('testPasses')) is int and evidence['testPasses']>0
        and evidence.get('typecheck') is True,'STATIC_RELEASE_EVIDENCE')
    return True

def execute_priority(operations):
    plan=operations.preflight()
    grant=operations.authorize(plan)
    try:
        operations.prepare(grant)
        receipt=operations.activate()
        require(receipt.get('status')=='V4_LIVE_CUTOVER_VERIFIED','FULL_EXECUTOR_NOT_VERIFIED')
        cycles=receipt.get('auditCycles')
        require(isinstance(cycles,list) and len(cycles)==3,'THREE_REAL_CYCLES_REQUIRED')
        ticks=[row.get('decisionCycle',{}).get('tickCompletedAt') for row in cycles]
        require(all(type(t) is int and t>0 for t in ticks)
            and ticks==sorted(set(ticks)),'REAL_CYCLES_DID_NOT_ADVANCE')
        return receipt
    except Exception:
        operations.protect_on_failure()
        raise

def restore_owned_hold(path,expected_hash,original):
    """Restore protection only over our own exact clear, retaining file owner."""
    import stat,uuid
    old=json.loads(original)
    require(old.get('active') is True and old.get('action')=='HOLD_PROTECTED','RESTORE_MUST_PROTECT')
    metadata=path.lstat()
    require(stat.S_ISREG(metadata.st_mode) and not path.is_symlink(),'RESTORE_FILE_TYPE')
    require(digest(bytes_at(path))==expected_hash,'RESTORE_CAS_MISMATCH')
    temp=path.parent/('.'+uuid.uuid4().hex+'.tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,stat.S_IMODE(metadata.st_mode))
    try:
        with os.fdopen(fd,'wb') as handle:handle.write(original);handle.flush();os.fsync(handle.fileno())
        os.chown(temp,metadata.st_uid,metadata.st_gid)
        require(digest(bytes_at(path))==expected_hash,'RESTORE_CAS_MISMATCH')
        os.replace(temp,path)
        directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        try:temp.unlink()
        except FileNotFoundError:pass

if __name__=='__main__':main()
