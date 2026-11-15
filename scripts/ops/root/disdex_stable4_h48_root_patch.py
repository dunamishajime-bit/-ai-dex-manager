"""Build reviewed H48-only root source patches; never install or activate them.

The root operator must install/review the generated sources and independently
stage the exact-source certificate through the existing formal approval route.
No approval artifact or plan hash is synthesized by this module.
"""
import ast
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
import time
from disdex_stable4_h48_policy import validate_h48_certificate,validate_h48_certificate_metadata,validate_hype_flat_with_v4_inventory
from disdex_v4_nonflat_ownership import attest_sole_v4_inventory

HYPE_BASE_SHA256='710ae088dcb9a8a2793bd3890f276696dd2ae3cddebe365757bcda6c5eb80882'
GATE_BASE_SHA256='dd8ea03b2d890c355050e5d029f0fc74dbc101ae37ab766907c108966c25f529'
def _require(value,reason):
 if not value:raise ValueError('STABLE4_H48_PATCH_'+reason)

def _immutable_binding_bytes(path):
 before=path.lstat()
 _require(stat.S_ISREG(before.st_mode) and not path.is_symlink() and before.st_uid==0 and before.st_gid==0 and before.st_mode&0o222==0,'BINDING_FILE_NOT_IMMUTABLE')
 raw=path.read_bytes();after=path.lstat()
 _require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_mode,before.st_uid,before.st_gid)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_mode,after.st_uid,after.st_gid) and path.read_bytes()==raw,'BINDING_FILE_CHANGED')
 return raw

def build_h48_manifest_binding(release,sha):
 _require(isinstance(sha,str) and re.fullmatch('[a-f0-9]{40}',sha) and release==Path('/home/deploy/disdex-trading/releases')/sha,'BINDING_RELEASE_INVALID')
 files={'authoritySha256':release/'lib/hype-stable4-time-only-authority.ts','contractSha256':release/'lib/hype-stable4-time-only-contract.ts','certificateSha256':Path('/etc/disdex/stable4/h48-time-only')/(sha+'.json')}
 hashes={key:hashlib.sha256(_immutable_binding_bytes(path)).hexdigest() for key,path in files.items()}
 return {'schema':'disdex-pending-h48-authority-binding/v1','sourceSha':sha,**hashes}

def build_h48_v4_priority_authority(*,certificate_raw,approved_sha,approved_plan_sha256,authorization,now_ms):
 """Build only after the transaction verifies and consumes its scoped nonce."""
 _require(isinstance(certificate_raw,bytes) and type(now_ms)is int,'PRIORITY_INPUT')
 certificate=validate_h48_certificate(json.loads(certificate_raw),approved_sha=approved_sha,approved_plan_sha256=approved_plan_sha256,now_ms=now_ms)
 a=authorization
 _require(isinstance(a,dict) and a.get('sourceSha')==approved_sha and a.get('scope')=='HYPE_TREND_LONG' and a.get('planSha256')==approved_plan_sha256 and a.get('ordersEnabled')is True and a.get('deploymentTarget')=='professional-dismanager.net' and a.get('route') in ('CODEX_SSH','GITHUB_ACTIONS') and isinstance(a.get('nonce'),str) and re.fullmatch('[a-f0-9]{32}',a['nonce']) and type(a.get('issuedAt'))is int and type(a.get('expiresAt'))is int and a['issuedAt']<=now_ms//1000<a['expiresAt'] and 1<=a['expiresAt']-a['issuedAt']<=300,'PRIORITY_AUTHORIZATION')
 return {'schema':'disdex-stable4-v4-h48-priority-authority/v1','approvedSha':approved_sha,'researchSha':certificate['researchSha'],'planSha256':approved_plan_sha256,'deploymentTarget':'professional-dismanager.net','scope':'V4_PRIORITY_H48_FULL_EXIT','h48CertificateSha256':hashlib.sha256(certificate_raw).hexdigest(),'issuedAt':now_ms,'expiresAt':certificate['expiresAt'],'operatorAcknowledgement':'V4_PRIORITY_H48_FULL_EXIT','authorizesOtherPolicies':False}

def assert_deploy_readable_policy(path,deploy,expected_hash,*,run=subprocess.run):
 _require(isinstance(path,Path) and isinstance(expected_hash,str) and re.fullmatch('[a-f0-9]{64}',expected_hash) and deploy.pw_uid>0 and deploy.pw_gid>0,'DEPLOY_READ_BINDING')
 code='import hashlib,pathlib,sys;print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())'
 child=run(['/usr/bin/python3','-c',code,str(path)],user=deploy.pw_uid,group=deploy.pw_gid,extra_groups=[],cwd='/',env={'PATH':'/usr/bin:/bin'},capture_output=True,text=True,timeout=10,check=False)
 _require(child.returncode==0 and child.stdout.strip()==expected_hash,'DEPLOY_POLICY_READ_DENIED')

def read_h48_policy_certificate(sha,plan_sha256,now_ms):
 _require(isinstance(sha,str) and re.fullmatch('[a-f0-9]{40}',sha),'SOURCE_INVALID')
 path=Path('/etc/disdex/stable4/h48-time-only')/(sha+'.json')
 before=path.lstat();validate_h48_certificate_metadata(before)
 _require(before.st_mode&0o004 and path.parent.stat().st_mode&0o001,'CERTIFICATE_NOT_DEPLOY_READABLE')
 _require(path.resolve()==path,'CERTIFICATE_PATH_INDIRECTION')
 raw=path.read_bytes();after=path.lstat();validate_h48_certificate_metadata(after)
 _require((before.st_dev,before.st_ino,before.st_mtime_ns,before.st_size)==(after.st_dev,after.st_ino,after.st_mtime_ns,after.st_size) and path.read_bytes()==raw,'CERTIFICATE_CHANGED')
 def unique(pairs):
  out={}
  for key,value in pairs:
   _require(key not in out,'CERTIFICATE_DUPLICATE_KEY');out[key]=value
  return out
 return validate_h48_certificate(json.loads(raw,object_pairs_hook=unique),approved_sha=sha,approved_plan_sha256=plan_sha256,now_ms=now_ms)

# Static readonly child. Credentials are inherited only through the original
# installed SDK loader; signing and the shared broker stay inside AsterV3Client.
SIGNED_INVENTORY_CHILD=r'''import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AsterV3Client} from './lib/aster-v3-client.ts';
import {FileAccountOrderLock} from './lib/disdex-account-order-lock.ts';
import {V4ExecutionStore} from './lib/v12-v4-execution-store.ts';
import {readPendingExposureRegistry} from './lib/disdex-pending-exposure-registry.ts';
const sha=process.argv[2],v4='/var/lib/disdex/v12-v4/orders.json',hype='/var/lib/disdex/hype-zec-long/runner.json',pending='/var/lib/disdex/shared/pending-exposure.json';
if(!/^[a-f0-9]{40}$/.test(sha)||process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH!=='/var/lib/disdex/shared/aster-rate-budget.json'||process.env.DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET!=='/run/disdex-v4-budget-'+sha+'/budget.sock')throw Error('READONLY_SOURCE_OR_BUDGET_INVALID');
const fetchImpl=(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url??String(input));if((init.method??'GET')!=='GET'||u.origin!=='https://fapi.asterdex.com'||!['/fapi/v3/positionRisk','/fapi/v3/openOrders','/fapi/v3/time'].includes(u.pathname)||init.body!=null)throw Error('PUBLIC_SIGNED_GET_ONLY');return fetch(input,{...init,redirect:'error'});};
const client=new AsterV3Client({userAddress:process.env.ASTER_USER_ADDRESS,privateKey:process.env.ASTER_API_PRIVATE_KEY,baseUrl:process.env.ASTER_FUTURES_BASE_URL,fetchImpl,requestTimeoutMs:10000,readOnlyRateLimitMaxRetries:0});
if(!client.hasTradingCredentials())throw Error('READONLY_CREDENTIAL_LOADER_MISSING');
const replayRaw=readFileSync(v4);new V4ExecutionStore(v4,sha).read();
if(!replayRaw.equals(readFileSync(v4)))throw Error('READONLY_REPLAY_STATE_CHANGED');
const lock=new FileAccountOrderLock('/var/lib/disdex/shared/account-order.lock',120000,pending);
const lease=await lock.acquire('ROOT_STABLE4_H48_SIGNED_INVENTORY');if(!lease)throw Error('READONLY_ACCOUNT_LOCK_BUSY');
try{
 await lease.document();const raw=readFileSync(v4),h=readFileSync(hype),p=readFileSync(pending);
 if(!raw.equals(replayRaw))throw Error('READONLY_REPLAY_STATE_CHANGED');
 const registry=await readPendingExposureRegistry(pending);if(registry.accountScope!=='ASTER_FUTURES'||registry.entries.some(r=>r.status!=='RELEASED'))throw Error('READONLY_ACTIVE_PENDING');
 const signedAt=Date.now(),positions=await client.getPositions(),orders=await client.getOpenOrders();
 if(Date.now()-signedAt>30000)throw Error('READONLY_SIGNED_SNAPSHOT_STALE');
 await lease.document();if(!raw.equals(readFileSync(v4))||!h.equals(readFileSync(hype))||!p.equals(readFileSync(pending)))throw Error('READONLY_STATE_CHANGED');
 console.log(JSON.stringify({schema:'disdex-stable4-h48-signed-inventory/v1',v4Sha:sha,v4Raw:raw.toString('utf8'),hypeState:JSON.parse(h),positions,orders,signedAt,pendingHash:createHash('sha256').update(p).digest('hex'),pendingEmpty:true,journalReplayVerified:true,accountLeaseVerified:true,ordersSent:0,cancelsSent:0,positionChangesSent:0}));
}finally{await lease.release();}
'''

def collect_h48_signed_inventory(*,release,deploy,sdk,credentials,v4_sha,hype_state_sha,now=None,run=subprocess.run):
 now=now or (lambda:time.time_ns()//1000000)
 _require(isinstance(v4_sha,str) and re.fullmatch('[a-f0-9]{40}',v4_sha) and release==Path('/home/deploy/disdex-trading/releases')/v4_sha,'IMMUTABLE_V4_SOURCE_REQUIRED')
 _require(deploy.pw_uid>0 and deploy.pw_gid>0,'DEPLOY_IDENTITY_REQUIRED')
 environment=sdk.child_environment(release.name,deploy.pw_dir,credentials=credentials)
 _require(environment.get('DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH')=='/var/lib/disdex/shared/aster-rate-budget.json' and environment.get('DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET')=='/run/disdex-v4-budget-'+v4_sha+'/budget.sock','EXISTING_SHARED_BUDGET_REQUIRED')
 result=run(['/usr/bin/node','--import',str(release/'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-',v4_sha],input=SIGNED_INVENTORY_CHILD,cwd=release,user=deploy.pw_uid,group=deploy.pw_gid,extra_groups=[],env=environment,capture_output=True,text=True,timeout=600)
 _require(result.returncode==0,'SIGNED_CHILD_FAILED')
 rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
 _require(len(rows)==1,'SIGNED_CHILD_RESULT_INVALID');row=rows[0]
 _require(row.get('schema')=='disdex-stable4-h48-signed-inventory/v1' and row.get('v4Sha')==v4_sha and row.get('journalReplayVerified')is True and row.get('accountLeaseVerified')is True and row.get('pendingEmpty')is True and isinstance(row.get('pendingHash'),str) and re.fullmatch('[a-f0-9]{64}',row['pendingHash']) and all(type(row.get(k))is int and row[k]==0 for k in ['ordersSent','cancelsSent','positionChangesSent']),'SIGNED_CHILD_PROOF_INVALID')
 raw=row['v4Raw'].encode();doc=json.loads(raw)
 recomputed=attest_sole_v4_inventory(doc,v4_sha,row['positions'],row['orders'])
 replay={**recomputed,'journalReplayVerified':True,'rawDocumentSha256':hashlib.sha256(raw).hexdigest()}
 proof=validate_hype_flat_with_v4_inventory(hype_state=row['hypeState'],hype_state_sha=hype_state_sha,v4_raw=raw,v4_sha=v4_sha,replay_proof=replay,positions=row['positions'],orders=row['orders'],signed_at=row['signedAt'],now_ms=now())
 return {**proof,'status':'STABLE4_H48_HYPE_FLAT_V4_PRESERVED','positionCount':recomputed['verifiedLegs'],'openOrderCount':recomputed['uniqueStopOrders'],'afterHash':row['pendingHash']}

def build_h48_root_sources(hype_source,gate_source,*,old_hype_sha):
 _require(hashlib.sha256(hype_source).hexdigest()==HYPE_BASE_SHA256 and hashlib.sha256(gate_source).hexdigest()==GATE_BASE_SHA256,'INSTALLED_SOURCE_HASH_CHANGED')
 _require(isinstance(old_hype_sha,str) and re.fullmatch('[a-f0-9]{40}',old_hype_sha),'OLD_PIN_INVALID')
 h=hype_source.decode();g=gate_source.decode()
 def replace_once(text,old,new):
  _require(text.count(old)==1,'SOURCE_ANCHOR_NOT_UNIQUE');return text.replace(old,new,1)
 h=replace_once(h,'OLD = "7688ed7c93a1918d8b44837339b7da5584a868f5"','OLD = "'+old_hype_sha+'"')
 h=replace_once(h,'RUNNER = "HYPE_TREND_LONG"','from disdex_stable4_h48_root_patch import read_h48_policy_certificate, collect_h48_signed_inventory, build_h48_manifest_binding, build_h48_v4_priority_authority, assert_deploy_readable_policy, _immutable_binding_bytes\n\nRUNNER = "HYPE_TREND_LONG"')
 h=replace_once(h,'    validate_hype_plan(desired, current, pins, target_sha)\n    return "fresh" if pins[RUNNER] == OLD else "resume"','    require(pins.get(RUNNER) == OLD, "H48_RESUME_REQUIRES_SEPARATE_REVIEW")\n    validate_hype_plan(desired, current, pins, target_sha)\n    return "fresh"')
 h=replace_once(h,'f"{self.release}/scripts/disdex-hype-trend-live-runner.ts --daemon"','f"{self.release}/scripts/disdex-hype-zec-long-live-runner.ts --daemon"')
 h=replace_once(h,'"DISDEX_HYPE_ZEC_SIGNAL_MODE": "TREND",','"DISDEX_HYPE_ZEC_SIGNAL_MODE": "STABLE4",\n        "DISDEX_STABLE4_MODE": "LIVE",\n        "DISDEX_STABLE4_GLOBAL_LIVE_ACK": new_sha,\n        "DISDEX_HYPE_ZEC_MAX_GROSS": "1",')
 start=h.index('    def signed_flat(self):');end=h.index('    def health(',start)
 replacement='''    def signed_flat(self):
        policy = read_h48_policy_certificate(self.args.sha, self.args.plan_sha256, time.time_ns()//1000000)
        require(policy == self.h48_policy, "H48_POLICY_CHANGED")
        proof = collect_h48_signed_inventory(release=self.venue_release, deploy=self.deploy,
            sdk=self.sdk, credentials=self.credentials, v4_sha=self.pins["V12_V4"],
            hype_state_sha=self.args.sha if self.state_changed or self.plan_mode == "resume" else OLD)
        prior = getattr(self, "h48_preservation", None)
        require(prior is None or proof["preservationSha256"] == prior, "V4_OWNERSHIP_CHANGED")
        self.h48_preservation = proof["preservationSha256"]
        self.last_signed_flat = proof
        return proof

'''
 h=h[:start]+replacement+h[end:]
 anchor='''        require(self.parent._read_current_sha(unchanged_identity_only=True)'''
 h=replace_once(h,anchor,'''        self.h48_policy = read_h48_policy_certificate(self.args.sha, self.args.plan_sha256, time.time_ns()//1000000)
'''+anchor)
 old='''        self.inventory_digest = hashlib.sha256(canonical({
            "positions": 0, "openOrders": 0,
            "accountSha256": hashlib.sha256(
                self.credentials["ASTER_USER_ADDRESS"].lower().encode()).hexdigest(),
        })).hexdigest()'''
 new='''        self.inventory_digest = hashlib.sha256(canonical({
            "hypeFlat": True, "v4PreservationSha256": self.before_proof["preservationSha256"],
            "accountSha256": hashlib.sha256(self.credentials["ASTER_USER_ADDRESS"].lower().encode()).hexdigest(),
        })).hexdigest()'''
 h=replace_once(h,old,new)
 h=replace_once(h,'''        require(not self.systemd.is_active(self.old_unit)
                and self.systemd.main_pid(self.old_unit) == 0
                and not self.systemd.is_active(self.new_unit)
                and self.systemd.main_pid(self.new_unit) == 0, "HYPE_ALREADY_ACTIVE")''','''        require(not self.systemd.is_active(self.new_unit)
                and self.systemd.main_pid(self.new_unit) == 0, "HYPE_CANDIDATE_ALREADY_ACTIVE")''')
 h=replace_once(h,'''    def switch(self):
        self.failure_phase = "switch"
        require(self.systemd.main_pid(self.old_unit)==0 and''','''    def switch(self):
        self.failure_phase = "switch"
        # Stop the exact previously pinned runner only after protected hold and
        # a fresh signed-flat HYPE proof. Re-read state after it has stopped.
        self.health(); self.signed_flat()
        if self.systemd.is_active(self.old_unit) or self.systemd.main_pid(self.old_unit):
            self.systemd.stop(self.old_unit)
            require(self.systemd.main_pid(self.old_unit)==0 and not self.systemd.is_active(self.old_unit), "HYPE_OLD_UNIT_DID_NOT_STOP")
            self.systemd.mask(self.old_unit)
            self.signed_flat()
            self.state_before = _safe_bytes(STATE); self.state_stat = STATE.lstat()
            self.state_before_row = json.loads(self.state_before)
            validate_flat_hype_state(self.state_before_row, OLD)
        require(self.systemd.main_pid(self.old_unit)==0 and''')
 h=replace_once(h,'''        self.next_manifest["runners"][RUNNER].update(
            sha=self.args.sha, serviceUnit=self.new_unit, releaseRoot=str(self.release),
            evidenceMode="tick-v1")''','''        self.next_manifest["runners"][RUNNER].update(
            sha=self.args.sha, serviceUnit=self.new_unit, releaseRoot=str(self.release),
            evidenceMode="tick-v1", h48TimeOnly=build_h48_manifest_binding(self.release,self.args.sha))''')
 h=replace_once(h,'''        self.activation = build_activation(self.desired, authority,
                                           self.inventory_digest, self.authorization_at)''','''        self.activation = build_activation(self.desired, authority,
                                           self.inventory_digest, self.authorization_at)
        self.priority_path = Path("/etc/disdex/stable4/v4-h48-priority")/(self.args.sha+".json")
        priority_parent = self.priority_path.parent.lstat()
        require(stat.S_ISDIR(priority_parent.st_mode) and priority_parent.st_uid==0 and priority_parent.st_gid==0 and not priority_parent.st_mode&0o022 and priority_parent.st_mode&0o001 and not self.priority_path.parent.is_symlink(), "PRIORITY_DIRECTORY_UNTRUSTED")
        require(not self.priority_path.exists() and not self.priority_path.is_symlink(), "PRIORITY_RECEIPT_EXISTS")
        priority_certificate = _immutable_binding_bytes(Path("/etc/disdex/stable4/h48-time-only")/(self.args.sha+".json"))
        self.priority_authority = build_h48_v4_priority_authority(certificate_raw=priority_certificate, approved_sha=self.args.sha, approved_plan_sha256=self.args.plan_sha256, authorization=authority, now_ms=time.time_ns()//1000000)
        require(self.priority_authority["h48CertificateSha256"]==self.next_manifest["runners"][RUNNER]["h48TimeOnly"]["certificateSha256"], "PRIORITY_CERTIFICATE_CHANGED")
        assert_deploy_readable_policy(Path("/etc/disdex/stable4/h48-time-only")/(self.args.sha+".json"), self.deploy, self.priority_authority["h48CertificateSha256"])''')
 h=replace_once(h,'''        self.approval_bytes = canonical(self.activation)+b"\\n"
        if self.plan_mode == "fresh":''','''        self.approval_bytes = canonical(self.activation)+b"\\n"
        _root_file(self.priority_path, canonical(self.priority_authority)+b"\\n", 0o444, self.created)
        assert_deploy_readable_policy(self.priority_path, self.deploy, hashlib.sha256(canonical(self.priority_authority)+b"\\n").hexdigest())
        if self.plan_mode == "fresh":''')
 # Keep existing HOLD, pending, signed-read, transaction, rollback and three-tick
 # requirements. This branch only selects a separately certified lifecycle.
 h=replace_once(h,'        validate_hype_candidate_safety(self.release)','''        validate_hype_candidate_safety(self.release)
        authority_source = self.release / "lib/hype-stable4-time-only-authority.ts"
        contract_source = self.release / "lib/hype-stable4-time-only-contract.ts"
        require(authority_source.is_file() and contract_source.is_file()
                and "createH48TimeOnlyPolicyAuthority" in authority_source.read_text(encoding="utf8")
                and "H48_TIME_ONLY" in contract_source.read_text(encoding="utf8"), "H48_SOURCE_CONTRACT_MISSING")''')
 for name in ['HypeScopedRootExecutor','HypeScopedOperations']:
  old='from disdex_hype_scoped_root_cutover import '+name
  _require(g.count(old)==1,'GENERIC_BRANCH_ANCHOR_CHANGED')
  line=next(line for line in g.splitlines() if old in line);indent=line[:len(line)-len(line.lstrip())]
  newer=indent+'''h48 = Path("/etc/disdex/stable4/h48-time-only") / (args.sha + ".json")
'''+indent+'''if h48.exists() or h48.is_symlink():
'''+indent+'    from disdex_stable4_h48_scoped_root_cutover import '+name+'\n'+indent+'else:\n'+indent+'    '+old
  g=replace_once(g,line,newer)
 ast.parse(h);ast.parse(g)
 return {'disdex_stable4_h48_scoped_root_cutover.py':h.encode(),'disdex_unified_root_gate.py':g.encode()}
