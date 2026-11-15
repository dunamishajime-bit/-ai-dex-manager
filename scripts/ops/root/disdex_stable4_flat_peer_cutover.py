"""Whitelist-only authenticated source preparation for four flat STABLE4 peers.

This module builds source bytes and provides pure validation/coordinator helpers.
It has no CLI installer, no approval issuer and no venue order API. Generated
transactions retain the installed root verifier and its original nonce consume.
"""
import ast
import copy
import hashlib
import importlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from disdex_stable4_h48_root_patch import HYPE_BASE_SHA256,GATE_BASE_SHA256,build_h48_root_sources

ROLES={
 'QUALITY102_CAUSAL_V1':dict(slug='q102',service='disdex-quality102-causal-v1',state='/var/lib/disdex/quality102-causal-v1/state.json',tick='quality102-causal-v1.json',entry='scripts/disdex-quality102-causal-v1-live-runner.ts',runtime='runtimeCommitSha'),
 'PENGU_V8':dict(slug='pengu',service='disdex-pengu-dual-ls-v2',state='/var/lib/disdex/pengu-dual-ls-v2/runner-live.json',tick='pengu-v8.json',entry='scripts/disdex-pengu-dual-ls-v2-live-runner.ts',runtime='runtimeCommitSha'),
 'FET_BRK48_RESIDUAL':dict(slug='fet',service='disdex-fet-brk48',state='/var/lib/disdex/fet-brk48-residual/state.json',tick='fet-brk48-residual.json',entry='scripts/disdex-fet-brk48-live-runner.ts',runtime='runtimeCommitSha'),
 'IDLE_PRIORITY_SHORT':dict(slug='idle',service='disdex-idle-priority-short',state='/var/lib/disdex/idle-priority/state.json',tick='idle-priority-short.json',entry='scripts/disdex-idle-priority-short-live-runner.ts',runtime='runtimeSha'),
}
def _require(value,reason):
 if not value:raise ValueError('STABLE4_FLAT_PEER_'+reason)
def _sha(value):return isinstance(value,str) and re.fullmatch('[a-f0-9]{40}',value)

def validate_flat_peer_state(role,row,expected_sha):
 _require(role in ROLES and _sha(expected_sha) and isinstance(row,dict),'ROLE_STATE_OR_SOURCE_INVALID')
 _require(row.get(ROLES[role]['runtime'])==expected_sha,'STATE_LINEAGE_INVALID')
 shapes={
  'QUALITY102_CAUSAL_V1':row.get('version')==1 and row.get('strategyId')=='QUALITY102_CAUSAL_V1' and row.get('mode')=='LIVE',
  'PENGU_V8':row.get('version')==2 and row.get('strategyId')=='PENGU_DUAL_LS_V2_FINAL' and row.get('mode')=='LIVE',
  'FET_BRK48_RESIDUAL':row.get('schema')=='fet-brk48-residual-state/v1' and row.get('strategyId')=='FET_BRK48_RESIDUAL',
  'IDLE_PRIORITY_SHORT':row.get('schema')=='disdex-idle-priority-state/v2' and isinstance(row.get('positions'),list),
 }
 _require(shapes[role],'STATE_SCHEMA_INVALID')
 _require(row.get('position')is None and row.get('positions')in(None,[]) and row.get('pending')is None and row.get('pendingOrder')is None and row.get('manualReview')in(None,False,'') and row.get('manualReviewReason')in(None,'') and isinstance(row.get('failures'),list),'STATE_NOT_DEFINITELY_FLAT')
 _require(type(row.get('updatedAt'))is int and row['updatedAt']>0,'STATE_CLOCK_INVALID')
 return copy.deepcopy(row)

def migrate_flat_peer_state(role,row,old_sha,new_sha,now_ms):
 before=validate_flat_peer_state(role,row,old_sha)
 _require(_sha(new_sha) and type(now_ms)is int and now_ms>=before['updatedAt'],'MIGRATION_CLOCK_OR_SOURCE_INVALID')
 result={**before,ROLES[role]['runtime']:new_sha,'updatedAt':now_ms}
 return validate_flat_peer_state(role,result,new_sha)

PUBLIC_STATE_CHILD=r'''import {readFileSync} from 'node:fs';
const [role,path,sha]=process.argv.slice(2),before=readFileSync(path);let value;
async function source(path){const mod=await import(path);return {...mod.default,...mod};}
if(role==='QUALITY102_CAUSAL_V1'){const {FileQuality102CausalV1StateStore}=await source('./lib/disdex-quality102-causal-v1-state.ts');value=await new FileQuality102CausalV1StateStore(path,'LIVE',sha).load();}
else if(role==='PENGU_V8'){const {FilePenguDualLsV2RunnerStateStore}=await source('./lib/pengu-dual-ls-v2-runner-state.ts');value=await new FilePenguDualLsV2RunnerStateStore(path,'LIVE').load();}
else if(role==='FET_BRK48_RESIDUAL'){const {readFetBrk48State}=await source('./lib/fet-brk48-state.ts');value=await readFetBrk48State(path,sha,true);}
else if(role==='IDLE_PRIORITY_SHORT'){const {readIdleState}=await source('./lib/idle-priority-short-state.ts');value=await readIdleState(path,sha);}
else throw Error('ROLE_NOT_AUTHORIZED');
if(!before.equals(readFileSync(path)))throw Error('STATE_PUBLIC_PARSER_WROTE_INPUT');
console.log(JSON.stringify({status:'NATIVE_PUBLIC_STATE_VALIDATED',role,sha,value}));
'''
def public_validate_peer_state_bytes(release,role,raw,sha,*,run=subprocess.run):
 _require(role in ROLES and _sha(sha) and release.parent==Path('/home/deploy/disdex-trading/releases') and _sha(release.name),'PUBLIC_STATE_SOURCE_INVALID')
 # The fixed readonly child imports state parsers only. No credentials or
 # trading-client constructor is passed to this root-local validation process.
 with tempfile.TemporaryDirectory(prefix='disdex-flat-peer-state-') as directory:
  path=Path(directory)/'state.json';path.write_bytes(raw)
  result=run(['/usr/bin/node','--import',str(release/'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-',role,str(path),sha],input=PUBLIC_STATE_CHILD,cwd=release,env={'PATH':'/usr/bin:/bin','HOME':'/root'},capture_output=True,text=True,timeout=120)
  _require(result.returncode==0 and path.read_bytes()==raw,'NATIVE_PUBLIC_STATE_PARSER_REJECTED')
  rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
  _require(len(rows)==1 and rows[0].get('status')=='NATIVE_PUBLIC_STATE_VALIDATED' and rows[0].get('role')==role and rows[0].get('sha')==sha,'NATIVE_PUBLIC_STATE_BINDING_INVALID')
  validate_flat_peer_state(role,rows[0]['value'],sha)

def run_flat_peer_transaction(operations):
 try:
  operations.prepare();operations.consume();operations.publish();operations.switch()
  stamps=operations.audit();return operations.commit(stamps)
 except BaseException as failure:
  try:operations.rollback()
  except BaseException as rollback:
   raise RuntimeError('STABLE4_FLAT_PEER_RECOVERY_REQUIRED_PROTECTED:'+type(rollback).__name__) from failure
  raise

def peer_runtime_env(role,new_sha,release):
 _require(role in ROLES and _sha(new_sha),'RUNTIME_SCOPE_INVALID')
 common={'DISDEX_RELEASE_SHA':new_sha,'DISDEX_RUNTIME_SHA':new_sha,'DISDEX_RUNTIME_COMMIT_SHA':new_sha,'DISDEX_RELEASE_ROOT':str(release),'DISDEX_STABLE4_MODE':'LIVE','DISDEX_STABLE4_GLOBAL_LIVE_ACK':new_sha,'DISDEX_RUNNER_TICK_HEARTBEAT_ROOT':'/var/lib/disdex/runner-health','DISDEX_ACCOUNT_LOCK_PATH':'/var/lib/disdex/shared/account-order.lock','DISDEX_PENDING_EXPOSURE_REGISTRY_PATH':'/var/lib/disdex/shared/pending-exposure.json','DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH':'/var/lib/disdex/shared/crypto-daily-risk.json','DISDEX_SHARED_KILL_SWITCH_FILE':'/var/lib/disdex/shared/kill-switch.json','DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH':'/var/lib/disdex/shared/aster-rate-budget.json'}
 if role=='QUALITY102_CAUSAL_V1':
  common.update(QUALITY102_CAUSAL_V1_MODE='LIVE',QUALITY102_CAUSAL_V1_ENABLED='true',QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED='true',QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED='true',QUALITY102_CAUSAL_V1_OPERATOR_ARMED='true',QUALITY102_CAUSAL_V1_LIVE_ACK=new_sha,DISDEX_STABLE4_Q102_LIVE_ACK=new_sha,QUALITY102_CAUSAL_V1_SELECTOR_MODE='CAUSAL_V4',QUALITY102_Q102_ADOPTED_EXIT_POLICIES_ENABLED='true',QUALITY102_Q102_ADOPTED_EXIT_POLICIES_ACK=new_sha,QUALITY102_Q102_PROFIT_FLOOR_ENABLED='true',QUALITY102_CAUSAL_V1_STATE_PATH=ROLES[role]['state'],QUALITY102_CAUSAL_V1_STATE_DIR='/var/lib/disdex/quality102-causal-v1',QUALITY102_CAUSAL_V1_KILL_SWITCH_PATH='/var/lib/disdex/shared/kill-switch.json',DISDEX_STABLE4_Q102_STATE_PATH='/var/lib/disdex/quality102-causal-v1/stable4-online-state.json')
 elif role=='PENGU_V8':common.update(PENGU_DUAL_LS_V2_MODE='LIVE',PENGU_DUAL_LS_V2_ENABLED='true',PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED='true',PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED='true',PENGU_DUAL_LS_V2_STATE_DIR='/var/lib/disdex/pengu-dual-ls-v2',PENGU_DUAL_LS_V2_KILL_SWITCH_FILE='/var/lib/disdex/shared/kill-switch.json')
 elif role=='FET_BRK48_RESIDUAL':common.update(FET_BRK48_LIVE_ENABLED='true',FET_BRK48_STATE_PATH=ROLES[role]['state'])
 else:common.update(DISDEX_IDLE_PRIORITY_MODE='LIVE',DISDEX_IDLE_PRIORITY_ENABLED='true',DISDEX_IDLE_PRIORITY_OPERATOR_ARMED='true',DISDEX_IDLE_PRIORITY_STATE_PATH=ROLES[role]['state'])
 return common

def execute_flat_peer(parent,args,token):
 _require(args.scope in ROLES and args.orders_enabled=='true','EXPLICIT_LIVE_ROLE_REQUIRED')
 _require(getattr(args,'route',None)=='CODEX_SSH' and getattr(args,'owner',None)=='codex-ssh' and getattr(args,'_codex_ssh_authenticated',False)is True,'AUTHENTICATED_ROOT_SSH_REQUIRED')
 # RootDeploymentExecutor already authenticated this request. The generated
 # operations repeat exact plan checks and consume its original nonce once.
 name='disdex_stable4_flat_'+ROLES[args.scope]['slug']+'_scoped_root_cutover'
 module=importlib.import_module(name)
 return module.HypeScopedRootExecutor(parent).execute(args,token)

def preflight_flat_peer(parent,args,token):
 _require(args.scope in ROLES and args.orders_enabled=='true','EXPLICIT_LIVE_ROLE_REQUIRED')
 _require(getattr(args,'route',None)=='CODEX_SSH' and getattr(args,'owner',None)=='codex-ssh' and getattr(args,'_codex_ssh_authenticated',False)is True,'AUTHENTICATED_ROOT_SSH_REQUIRED')
 module=importlib.import_module('disdex_stable4_flat_'+ROLES[args.scope]['slug']+'_scoped_root_cutover')
 operations=module.HypeScopedOperations(parent,args,token)
 operations.prepare() # No publish/stop/state migration/nonce consume in preview.
 return dict(status='READONLY_PREFLIGHT_PASS_NOT_LIVE',transaction='ROOT_STABLE4_FLAT_PEER',scope=args.scope,route=args.route,targetSha=args.sha,ordersEnabled=False,authorizesTrading=False,planSha256=args.plan_sha256,v4PreservationSha256=operations.v4_preservation,unproven=['NATIVE_STATE_CUTOVER','THREE_REAL_DECISION_CYCLES'])

def build_stable4_flat_peer_sources(hype_source,gate_source,*,old_by_role,h48_old_sha=None):
 _require(set(old_by_role)==set(ROLES) and all(_sha(s) for s in old_by_role.values()),'EXACT_FOUR_BASELINES_REQUIRED')
 _require(hashlib.sha256(hype_source).hexdigest()==HYPE_BASE_SHA256 and hashlib.sha256(gate_source).hexdigest()==GATE_BASE_SHA256,'INSTALLED_SOURCE_HASH_CHANGED')
 out={};generic=gate_source.decode()
 if h48_old_sha is not None:
  out.update(build_h48_root_sources(hype_source,gate_source,old_hype_sha=h48_old_sha));generic=out.pop('disdex_unified_root_gate.py').decode()
 for role,meta in ROLES.items():
  h=hype_source.decode()
  def once(old,new):
   nonlocal h
   _require(h.count(old)==1,'ANCHOR_NOT_UNIQUE:'+role);h=h.replace(old,new,1)
  once('OLD = "7688ed7c93a1918d8b44837339b7da5584a868f5"','OLD = "'+old_by_role[role]+'"')
  once('RUNNER = "HYPE_TREND_LONG"','from disdex_stable4_flat_peer_cutover import validate_flat_peer_state, migrate_flat_peer_state, public_validate_peer_state_bytes, peer_runtime_env, run_flat_peer_transaction\nfrom disdex_stable4_h48_root_patch import collect_h48_signed_inventory\n\nRUNNER = "'+role+'"')
  once('SERVICE = "disdex-hype-long"','SERVICE = "'+meta['service']+'"')
  once('STATE = Path("/var/lib/disdex/hype-zec-long/runner.json")','STATE = Path("'+meta['state']+'")')
  h=h.replace('/var/lib/disdex/hype-zec-long/runner.json',meta['state']).replace('/var/lib/disdex/hype-zec-long',meta['state'].rsplit('/',1)[0])
  once('    validate_hype_plan(desired, current, pins, target_sha)\n    return "fresh" if pins[RUNNER] == OLD else "resume"','    require(pins.get(RUNNER) == OLD, "RESUME_REQUIRES_SEPARATE_REVIEW")\n    validate_hype_plan(desired, current, pins, target_sha)\n    return "fresh"')
  once('TICK = Path("/var/lib/disdex/runner-health/ticks/hype-trend-long.json")','TICK = Path("/var/lib/disdex/runner-health/ticks/'+meta['tick']+'")')
  start=h.index('def validate_flat_hype_state(');end=h.index('\n\ndef validate_hype_candidate_sources',start)
  h=h[:start]+'''def validate_flat_hype_state(row, expected):
    return validate_flat_peer_state(RUNNER, row, expected)
'''+h[end:]
  start=h.index('def rebase_hype_state_for_rollback(');end=h.index('\n\ndef validate_flat_hype_state',start)
  h=h[:start]+'''def rebase_hype_state_for_rollback(current, candidate_baseline, old_sha, new_sha):
    validate_flat_hype_state(current, new_sha)
    restored = migrate_flat_peer_state(RUNNER, current, new_sha, old_sha, current["updatedAt"])
    public_validate_peer_state_bytes(Path("/home/deploy/disdex-trading/releases")/old_sha, RUNNER, canonical(restored), old_sha)
    return restored
'''+h[end:]
  start=h.index('def validate_hype_candidate_safety(');end=h.index('\n\ndef valid_hold',start)
  h=h[:start]+'''def validate_hype_candidate_safety(release):
    require((release/ENTRYPOINT).is_file(), "CANDIDATE_ENTRYPOINT_MISSING")
    entry = (release/ENTRYPOINT).read_text(encoding="utf8")
    require("observePeerDecisionCycle" in entry and RUNNER in entry, "CANDIDATE_REAL_CYCLE_MISSING")
    public_validate_peer_state_bytes(release, RUNNER, _safe_bytes(STATE), OLD)
    return True
'''+h[end:]
  once('RUNNER = "'+role+'"','RUNNER = "'+role+'"\nENTRYPOINT = "'+meta['entry']+'"')
  start=h.index('def _runtime_env(');end=h.index('\n\ndef build_activation',start)
  h=h[:start]+'''def _runtime_env(old_raw, old_sha, new_sha, release):
    values = peer_runtime_env(RUNNER,new_sha,release)
    seen = {}; output = []
    for line in old_raw.decode("utf8").splitlines():
        key,sep,value = line.partition("=")
        if not sep: output.append(line); continue
        require(not any(s in key.upper() for s in ("PRIVATE_KEY","API_SECRET","API_KEY","PASSWORD","TOKEN","WALLET","ASTER_USER_ADDRESS")),"CREDENTIAL_IN_RUNTIME_OVERRIDE")
        require(key not in seen or seen[key] == value,"CONFLICTING_DUPLICATE_ENVIRONMENT_KEY")
        if key in seen: continue
        seen[key] = value
        output.append(key+"="+values.pop(key,value))
    require(RUNNER != "IDLE_PRIORITY_SHORT" or not any(seen.get(k, "").strip().lower() in ("1","true","yes","on") for k in ("DISDEX_IDLE_RESIDUAL_LONG_ENABLED","DISDEX_IDLE_RESIDUAL_LONG_OPERATOR_ARMED")),"IDLE_RESIDUAL_OVERLAY_REQUIRES_SEPARATE_MIGRATION")
    output.extend(k+"="+v for k,v in values.items())
    return ("\\n".join(output)+"\\n").encode()
'''+h[end:]
  once('f"{self.release}/scripts/disdex-hype-trend-live-runner.ts --daemon"','f"{self.release}/{ENTRYPOINT} --daemon"')
  # Keep each role's files disjoint when several peers share one source SHA.
  once('(args.sha + ".env")','(args.sha + ".stable4-'+meta['slug']+'.env")')
  h=h.replace('.hype-operator.env','.stable4-'+meta['slug']+'-operator.env').replace('hype-" + args.sha','stable4-'+meta['slug']+'-" + args.sha').replace('hype-protected-hold-','stable4-'+meta['slug']+'-protected-hold-')
  start=h.index('    def signed_flat(self):');end=h.index('    def health(',start)
  h=h[:start]+'''    def signed_flat(self):
        proof = collect_h48_signed_inventory(release=self.venue_release,deploy=self.deploy,sdk=self.sdk,
            credentials=self.credentials,v4_sha=self.pins["V12_V4"],hype_state_sha=self.pins["HYPE_TREND_LONG"])
        prior = getattr(self,"v4_preservation",None)
        require(prior is None or proof["preservationSha256"] == prior,"V4_PRESERVATION_CHANGED")
        self.v4_preservation = proof["preservationSha256"]
        self.last_signed_flat = proof
        return proof

'''+h[end:]
  # Require candidate absent; stop ONLY the already signed-flat old role at switch.
  once('''        require(not self.systemd.is_active(self.old_unit)
                and self.systemd.main_pid(self.old_unit) == 0
                and not self.systemd.is_active(self.new_unit)
                and self.systemd.main_pid(self.new_unit) == 0, "HYPE_ALREADY_ACTIVE")''','''        require(not self.systemd.is_active(self.new_unit)
                and self.systemd.main_pid(self.new_unit) == 0, "CANDIDATE_ALREADY_ACTIVE")''')
  # Do not inherit or copy a notification/secret configuration from another role.
  start=h.index('        old_operator = Path(');end=h.index('        if self.plan_mode == "resume":',start)
  h=h[:start]+'''        assert_regular_secure(old_env)
        self.runtime_bytes = _runtime_env(_safe_bytes(old_env),OLD,self.args.sha,self.release)
        self.operator_bytes = b"# Exact-role operator authority is in the root activation artifact.\\n"
'''+h[end:]
  # The original protected transaction captures real account identity, not a
  # fabricated globally-flat position count.
  once('"positions": 0, "openOrders": 0,','"v4PreservationSha256": self.before_proof["preservationSha256"], "targetPeerFlat": True,')
  once('''    def switch(self):
        self.failure_phase = "switch"''','''    def switch(self):
        self.failure_phase = "switch"
        self.health(); self.signed_flat()
        self.systemd.stop(self.old_unit)
        require(self.systemd.main_pid(self.old_unit) == 0 and not self.systemd.is_active(self.old_unit),"OLD_ROLE_DID_NOT_STOP")
        self.systemd.mask(self.old_unit)
        self.signed_flat()
        self.state_before = _safe_bytes(STATE); self.state_stat = STATE.lstat()
        self.state_before_row = json.loads(self.state_before)
        validate_flat_hype_state(self.state_before_row,OLD)
        public_validate_peer_state_bytes(self.release,RUNNER,self.state_before,OLD)''')
  once('''            new_state = dict(self.state_before_row,
                             runtimeCommitSha=self.args.sha,
                             updatedAt=int(time.time()*1000))''','''            new_state = migrate_flat_peer_state(RUNNER,self.state_before_row,OLD,self.args.sha,int(time.time()*1000))''')
  once('''            validate_flat_hype_state(new_state, self.args.sha)
            self.candidate_state_baseline = new_state''','''            validate_flat_hype_state(new_state, self.args.sha)
            public_validate_peer_state_bytes(self.release,RUNNER,self.state_after,self.args.sha)
            self.candidate_state_baseline = new_state''')
  # Replace HYPE-specific presence checks with this role's actual entrypoint.
  start=h.index('        for relative in ("scripts/disdex-hype-trend-live-runner.ts",');end=h.index('        validate_hype_candidate_safety(self.release)',start)
  h=h[:start]+'''        for relative in (ENTRYPOINT,"node_modules/tsx/dist/loader.mjs","lib/disdex-peer-decision-cycle.ts","lib/disdex-runner-tick-heartbeat.ts","scripts/ops/root/disdex-live-operator-activation-gate.mjs"):
            require((self.release/relative).is_file(),"CANDIDATE_SOURCE_MISSING")
'''+h[end:]
  # Reuse the existing formal root approval verifier synchronously. Do not
  # queue these roles into the legacy HYPE worker or fabricate its authority.
  start=h.index('class HypeScopedRootExecutor:')
  h=h[:start]+'''class HypeScopedRootExecutor:
    def __init__(self,parent): self.parent = parent
    def execute(self,args,token):
        require(args.scope == RUNNER and args.orders_enabled == "true","EXACT_LIVE_ROLE_REQUIRED")
        require(getattr(args,"route",None) == "CODEX_SSH" and getattr(args,"owner",None) == "codex-ssh" and getattr(args,"_codex_ssh_authenticated",False) is True,"AUTHENTICATED_ROOT_SSH_REQUIRED")
        return run_flat_peer_transaction(HypeScopedOperations(self.parent,args,token))
'''
  ast.parse(h)
  out['disdex_stable4_flat_'+meta['slug']+'_scoped_root_cutover.py']=h.encode()
 anchor="        if args.scope == 'V52':"
 _require(generic.count(anchor)==1,'GENERIC_DISPATCH_ANCHOR_CHANGED')
 branch="        if args.scope in ('QUALITY102_CAUSAL_V1', 'PENGU_V8', 'FET_BRK48_RESIDUAL', 'IDLE_PRIORITY_SHORT') and args.orders_enabled == 'true':\n            from disdex_stable4_flat_peer_cutover import execute_flat_peer\n            return execute_flat_peer(self,args,token)\n"
 generic=generic.replace(anchor,branch+anchor,1);ast.parse(generic)
 anchor="    validate_order_permission(args.scope, orders_enabled)\n    if args.scope == 'API_MONITORS':"
 _require(generic.count(anchor)==1,'GENERIC_PREFLIGHT_ANCHOR_CHANGED')
 branch='''    validate_order_permission(args.scope, orders_enabled)
    if args.scope in ('QUALITY102_CAUSAL_V1', 'PENGU_V8', 'FET_BRK48_RESIDUAL', 'IDLE_PRIORITY_SHORT') and orders_enabled:
        from types import SimpleNamespace
        from disdex_stable4_flat_peer_cutover import preflight_flat_peer
        paths=SimpleNamespace(root=root,pins=pins_path,current_plan=root/'current-plan.json',current=current,
            releases=releases,nonce_dir=root/'nonces',public_key=root/'owner-approval-public.pem',
            activation_dir=root/'activations',receipts=root/'receipts')
        return preflight_flat_peer(RootDeploymentExecutor(paths,root_uid=root_uid),args,token)
    if args.scope == 'API_MONITORS':'''
 generic=generic.replace(anchor,branch,1);ast.parse(generic)
 out['disdex_unified_root_gate.py']=generic.encode()
 return out
