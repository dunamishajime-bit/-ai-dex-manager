"""BLOCKED DRAFT: inspection utilities for a Q102 learning bootstrap.

Root caller must hold the existing exclusive deployment lock. No trading order,
runner stop/start, plan mutation or credential access is performed here.
All source SHA and file digests are independently supplied by the caller.
prepare/install deliberately fail closed until an independently reviewed writer
exclusion, immutable source and provenance implementation replaces this draft.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

HOUR=3600000
RELEASES=Path('/home/deploy/disdex-trading/releases')
STATE=Path('/var/lib/disdex/quality102-causal-v1/stable4-online-state.json')
RECEIPTS=Path('/etc/disdex/stable4/q102-bootstrap')
RECOVERY='config/stable4/q102-online-recovery-seed-20261114.json'
AVAX='config/stable4/q102-avax-knn-seed-20261114.json'

def require(value,reason):
 if not value:raise ValueError('Q102_BOOTSTRAP_'+reason)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def sha(s,n=64):return isinstance(s,str) and re.fullmatch('[a-f0-9]{'+str(n)+'}',s) is not None
def parse(raw):
 # JSON is an externally hashed evidence format, not Python's permissive
 # JavaScript-like numeric dialect. NaN/Infinity can evade downstream checks.
 def unique(pairs):
  out={}
  for k,v in pairs:
   require(k not in out,'DUPLICATE_JSON');out[k]=v
  return out
 def invalid_constant(value):
  raise ValueError('Q102_BOOTSTRAP_NONFINITE_JSON_NUMBER:'+value)
 return json.loads(raw,object_pairs_hook=unique,parse_constant=invalid_constant)

def validate_candidate(*,state_raw,result_raw,source_cache_raw,request_plan_raw,evidence_files,expected_state_sha256,expected_result_sha256,now_ms):
 require(sha(expected_state_sha256) and sha(expected_result_sha256) and digest(state_raw)==expected_state_sha256 and digest(result_raw)==expected_result_sha256,'EXTERNAL_HASH_MISMATCH')
 state=parse(state_raw);result=parse(result_raw)
 require(isinstance(state,dict) and state.get('schemaVersion')==1 and isinstance(result,dict) and result.get('schema')=='disdex-stable4-outcome-bootstrap/v1' and result.get('status') in ('OBSERVATIONS_CAUGHT_UP_WITH_EXPLICIT_UNRESOLVED_LABELS','CAUSAL_OBSERVATIONS_AND_OUTCOMES_BOOTSTRAPPED'),'SCHEMA')
 require(result.get('ordersEnabled') is False and type(result.get('ordersSent')) is int and result['ordersSent']==0 and result.get('stateSha256')==expected_state_sha256,'EVIDENCE_BINDING')
 observed=state.get('observedThrough');model=result.get('model')
 require(type(now_ms)is int and type(observed)is int and observed%HOUR==0 and observed==now_ms//HOUR*HOUR-HOUR and isinstance(model,dict) and model.get('observedThrough')==observed and result.get('through')==observed+HOUR,'OBSERVATION_FRONTIER_STALE')
 require(isinstance(state.get('recoveryUnresolved'),list) and result.get('unresolvedLabelsExcludedFromTraining')==state['recoveryUnresolved'] and sha(result.get('sourceCacheSha256')) and sha(result.get('requestPlanSha256')) and isinstance(result.get('evidenceSha256'),dict) and all(sha(x) for x in result['evidenceSha256'].values()),'EVIDENCE_OR_UNRESOLVED')
 require(isinstance(source_cache_raw,bytes) and digest(source_cache_raw)==result['sourceCacheSha256'] and isinstance(request_plan_raw,bytes) and digest(request_plan_raw)==result['requestPlanSha256'] and isinstance(evidence_files,dict) and set(evidence_files)==set(result['evidenceSha256']) and all(isinstance(raw,bytes) and digest(raw)==result['evidenceSha256'][symbol] for symbol,raw in evidence_files.items()),'SOURCE_EVIDENCE_HASH_MISMATCH')
 return {'stateSha256':expected_state_sha256,'resultSha256':expected_result_sha256,'observedThrough':observed,'unresolvedCount':len(state['recoveryUnresolved'])}

def immutable_file(path,expected):
 s=path.lstat();require(stat.S_ISREG(s.st_mode) and not path.is_symlink() and s.st_uid==0 and s.st_mode&0o222==0,'SOURCE_METADATA')
 raw=path.read_bytes();t=path.lstat();require((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns)==(t.st_dev,t.st_ino,t.st_size,t.st_mtime_ns) and (expected is None or digest(raw)==expected),'SOURCE_CHANGED');return raw

def native_validate(release,state_raw,expected_frontier,*,run=subprocess.run):
 # Imports the candidate's own parser and both immutable seeds; no runner or client.
 code='''import {Stable4Q102OnlineEngine} from './lib/disdex-quality102-stable4-online.ts';
const [path,expected]=process.argv.slice(2);const e=new Stable4Q102OnlineEngine({mode:'LIVE',statePath:path,recoverySeedPath:'config/stable4/q102-online-recovery-seed-20261114.json',avaxSeedPath:'config/stable4/q102-avax-knn-seed-20261114.json',requireHourlyCoverage:true});const s=e.learningStatus();if(s.observedThrough!==Number(expected))throw Error('FRONTIER');console.log(JSON.stringify({status:'Q102_NATIVE_BOOTSTRAP_VALID',observedThrough:s.observedThrough}));'''
 with tempfile.TemporaryDirectory(prefix='q102-native-verify-') as directory:
  path=Path(directory)/'state.json';path.write_bytes(state_raw)
  r=run(['/usr/bin/node','--import',str(release/'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-',str(path),str(expected_frontier)],input=code,cwd=release,capture_output=True,text=True,timeout=120,env={'PATH':'/usr/bin:/bin','HOME':'/root'})
  require(r.returncode==0 and path.read_bytes()==state_raw,'NATIVE_STATE_REJECTED')
  rows=[json.loads(line) for line in r.stdout.splitlines() if line.startswith('{')]
  require(rows==[{'status':'Q102_NATIVE_BOOTSTRAP_VALID','observedThrough':expected_frontier}],'NATIVE_VALIDATION_BINDING')

def assert_old_q_not_learning(source_sha,*,run=subprocess.run,proc=Path('/proc')):
 require(sha(source_sha,40),'OLD_SOURCE_SHA')
 unit='disdex-quality102-causal-v1@'+source_sha+'.service'
 def observe():
  r=run(['/usr/bin/systemctl','show',unit,'--property=ActiveState,MainPID'],capture_output=True,text=True,timeout=10)
  require(r.returncode==0,'OLD_UNIT_QUERY');rows=dict(x.split('=',1) for x in r.stdout.splitlines() if '=' in x)
  require(rows.get('MainPID','').isdigit(),'OLD_UNIT_PID')
  pid=int(rows['MainPID'])
  if pid==0:
   require(rows.get('ActiveState') not in ('active','activating'),'OLD_UNIT_STARTING');return 0
  require(rows.get('ActiveState')=='active' and (proc/str(pid)/'cwd').resolve()==RELEASES/source_sha,'OLD_UNIT_IDENTITY')
  env=(proc/str(pid)/'environ').read_bytes().split(b'\0')
  modes=[x.split(b'=',1)[1] for x in env if x.startswith(b'DISDEX_STABLE4_MODE=')]
  require(len(modes)==1 and modes[0].strip().upper()==b'OFF','OLD_Q102_WRITER_EXCLUSION_NOT_PROVEN')
  # The deployed ef1ab178 legacy Q102 runner does not read this flag.
  # Even OFF cannot prove a live process has stopped writing/admitting.
  # Future migration must independently prove quiescence/exit protection
  # before allowing any bootstrap; the draft remains blocked regardless.
  require(False,'OLD_ACTIVE_Q102_WRITER_CANNOT_BE_PROVEN_QUIESCED_BY_ENV_FLAG')
  return pid
 before=observe();require(observe()==before,'OLD_UNIT_CHANGED');return before

def require_receipt_directory(path):
 require(path.is_dir() and not path.is_symlink() and path.stat().st_uid==0 and path.stat().st_mode&0o022==0,'RECEIPT_DIR')

def prepare(*,candidate_sha,current_q_sha,expected_state_sha256,expected_result_sha256,expected_recovery_sha256,expected_avax_sha256,state_raw,result_raw,source_cache_raw,request_plan_raw,evidence_files,pins,now_ms,release_root=RELEASES,run=subprocess.run):
 require(sha(candidate_sha,40) and sha(current_q_sha,40) and isinstance(pins,dict) and pins.get('QUALITY102_CAUSAL_V1')==current_q_sha,'PIN_BINDING')
 release=release_root/candidate_sha;require(release.resolve()==release,'RELEASE_PATH')
 for name,expected in [(RECOVERY,expected_recovery_sha256),(AVAX,expected_avax_sha256)]:
  require(sha(expected),'SEED_HASH_INVALID');immutable_file(release/name,expected)
 marker=release/'.disdex-release-sha';require(immutable_file(marker,None).decode().strip()==candidate_sha,'MARKER')
 validated=validate_candidate(state_raw=state_raw,result_raw=result_raw,source_cache_raw=source_cache_raw,request_plan_raw=request_plan_raw,evidence_files=evidence_files,expected_state_sha256=expected_state_sha256,expected_result_sha256=expected_result_sha256,now_ms=now_ms)
 native_validate(release,state_raw,validated['observedThrough'],run=run)
 return {'schema':'disdex-stable4-q102-bootstrap-receipt/v1','candidateSha':candidate_sha,'priorQ102Sha':current_q_sha,**validated,'recoverySeedSha256':expected_recovery_sha256,'avaxSeedSha256':expected_avax_sha256,'preparedAt':now_ms,'authorizesTrading':False,'ordersSent':0,'positionChangesSent':0}

def install(*,receipt,state_raw,expected_prior_sha256,pins_path,pins_before,state_path=STATE,receipt_dir=RECEIPTS,deploy_uid,deploy_gid,now_ms=None):
 """Caller has deployment lock and independently verified Q102 old process does not write this path."""
 now_ms=time.time_ns()//1000000 if now_ms is None else now_ms
 require(receipt.get('authorizesTrading') is False and digest(state_raw)==receipt.get('stateSha256') and receipt.get('observedThrough')==now_ms//HOUR*HOUR-HOUR,'PREPARED_RECEIPT_STALE')
 require(pins_path.read_bytes()==pins_before,'PIN_CAS')
 old_pid=assert_old_q_not_learning(receipt['priorQ102Sha'])
 prior_raw=None;prior_meta=None
 if state_path.exists():
  require(not state_path.is_symlink() and sha(expected_prior_sha256) and digest(state_path.read_bytes())==expected_prior_sha256,'STATE_CAS')
  prior_raw=state_path.read_bytes();prior_meta=state_path.stat()
 else:require(expected_prior_sha256 is None and not state_path.is_symlink(),'STATE_EXPECTED_ABSENT')
 require_receipt_directory(receipt_dir)
 receipt_path=receipt_dir/(receipt['candidateSha']+'.json');require(not receipt_path.exists() and not receipt_path.is_symlink(),'RECEIPT_EXISTS')
 # No overwrite before exact CAS; atomic replacement uses target filesystem.
 fd,temp=tempfile.mkstemp(prefix='.stable4-bootstrap-',dir=state_path.parent)
 replaced=False
 try:
  with os.fdopen(fd,'wb') as f:f.write(state_raw);f.flush();os.fsync(f.fileno())
  os.chown(temp,deploy_uid,deploy_gid);os.chmod(temp,0o600)
  require(pins_path.read_bytes()==pins_before,'PIN_CAS')
  require(assert_old_q_not_learning(receipt['priorQ102Sha'])==old_pid,'OLD_UNIT_CHANGED')
  if expected_prior_sha256 is None:require(not state_path.exists() and not state_path.is_symlink(),'STATE_CAS')
  else:require(not state_path.is_symlink() and digest(state_path.read_bytes())==expected_prior_sha256,'STATE_CAS')
  os.replace(temp,state_path);replaced=True
  require(assert_old_q_not_learning(receipt['priorQ102Sha'])==old_pid and pins_path.read_bytes()==pins_before,'POSTINSTALL_CAS')
  flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0)
  with os.fdopen(os.open(receipt_path,flags,0o400),'wb') as f:f.write(json.dumps(receipt,sort_keys=True,separators=(',',':')).encode()+b'\n');f.flush();os.fsync(f.fileno())
 except Exception as failure:
  if replaced:
   try:
    require(not state_path.is_symlink() and digest(state_path.read_bytes())==receipt['stateSha256'],'ROLLBACK_STATE_CHANGED')
    if prior_raw is None:state_path.unlink()
    else:
     rollback_fd,rollback=tempfile.mkstemp(prefix='.stable4-bootstrap-rollback-',dir=state_path.parent)
     try:
      with os.fdopen(rollback_fd,'wb') as f:f.write(prior_raw);f.flush();os.fsync(f.fileno())
      os.chown(rollback,prior_meta.st_uid,prior_meta.st_gid);os.chmod(rollback,stat.S_IMODE(prior_meta.st_mode));os.replace(rollback,state_path)
     finally:
      if os.path.exists(rollback):os.unlink(rollback)
    if receipt_path.exists():receipt_path.unlink()
   except Exception as rollback_error:raise RuntimeError('Q102_BOOTSTRAP_ROLLBACK_REQUIRES_REVIEW') from rollback_error
  raise failure
 finally:
  if os.path.exists(temp):os.unlink(temp)
 return {'status':'Q102_BOOTSTRAP_INSTALLED_NO_ORDERS','stateSha256':receipt['stateSha256'],'receiptPath':str(receipt_path),'ordersSent':0,'positionChangesSent':0}
