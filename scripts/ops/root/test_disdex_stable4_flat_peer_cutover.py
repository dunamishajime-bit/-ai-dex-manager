import ast
import copy
import json
from pathlib import Path
import unittest
import sys
import types
import hashlib
import subprocess
import tempfile
import uuid
from unittest.mock import patch
import disdex_stable4_flat_peer_cutover as cutover
REF=Path(__file__).resolve().parents[3]/'.tmp/stable4-root-reference-20261115'
OLD='a'*40;NEW='b'*40
class FlatPeerTests(unittest.TestCase):
 def generated(self,role):
  out=cutover.build_stable4_flat_peer_sources((REF/'disdex_hype_scoped_root_cutover.py').read_bytes(),(REF/'disdex_unified_root_gate.py').read_bytes(),old_by_role={r:OLD for r in cutover.ROLES})
  contract=types.ModuleType('disdex_deployment_contract');exec((REF/'disdex_deployment_contract.py').read_text(),contract.__dict__)
  plan=types.ModuleType('disdex_deployment_plan')
  namespace={}
  with patch.dict(sys.modules,{'disdex_deployment_contract':contract,'disdex_deployment_plan':plan}):
   exec((REF/'disdex_deployment_plan.py').read_text(),plan.__dict__)
   exec(compile(out['disdex_stable4_flat_'+cutover.ROLES[role]['slug']+'_scoped_root_cutover.py'],'<generated>','exec'),namespace)
  return namespace
 def test_generated_operations_use_native_paths_and_reject_resume_and_secret_copy(self):
  for role,meta in cutover.ROLES.items():
   ns=self.generated(role);ops=ns['HypeScopedOperations'].__new__(ns['HypeScopedOperations'])
   ops.release=Path('/home/deploy/disdex-trading/releases')/NEW;ops.args=types.SimpleNamespace(sha=NEW)
   ops.env=Path('/safe/runtime.env');ops.operator_env=Path('/safe/operator.env');ops.approval=Path('/safe/approval.json')
   override=ops.unit_override_bytes().decode()
   self.assertIn(meta['state'].rsplit('/',1)[0],override);self.assertIn(meta['state'],override)
   self.assertNotIn('/var/lib/disdex/hype-zec-long',override)
   self.assertIn(meta['entry'],override)
   with self.assertRaisesRegex(Exception,'RESUME_REQUIRES_SEPARATE_REVIEW'):
    ns['classify_hype_plan']({'runners':{}},{},{role:NEW},NEW)
   for key in ['ASTER_API_PRIVATE_KEY','ASTER_API_KEY','ASTER_USER_ADDRESS','NOTIFICATION_TOKEN']:
    with self.subTest(role=role,key=key),self.assertRaisesRegex(Exception,'CREDENTIAL_IN_RUNTIME_OVERRIDE'):
     ns['_runtime_env']((key+'=do-not-copy\n').encode(),OLD,NEW,ops.release)
 def test_actual_installed_plan_schema_and_generated_activation_reject_other_peer_delta(self):
  for role in cutover.ROLES:
   ns=self.generated(role);pins={r:OLD for r in ns['IDS']}
   current=dict(schema='disdex-unified-deployment-plan/v2',repository=ns['REPO'],deploymentTarget=ns['DEPLOYMENT_TARGET'],operatorTarget=ns['OPERATOR_TARGET'],sourceSha=OLD,scope=role,runners=pins,uiSha=OLD,monitorSha=OLD,releaseRoots={'runners':'/home/deploy/disdex-trading/releases','ui':'/home/deploy/ui/releases','monitor':'/home/deploy/monitor/releases'},ordersEnabled=True)
   desired={**current,'sourceSha':NEW,'runners':{**pins,role:NEW}}
   expected=hashlib.sha256(ns['canonical'](desired)).hexdigest()
   self.assertEqual(ns['validate_hype_plan'](desired,current,pins,NEW),expected)
   auth=dict(sourceSha=NEW,scope=role,planSha256=expected,ordersEnabled=True,route='CODEX_SSH',issuedAt=1000,expiresAt=1200,nonce='external-root-nonce')
   activation=ns['build_activation'](desired,auth,'d'*64,1100)
   self.assertEqual(activation['approvedRunners'],[role]);self.assertEqual(activation['approvedShaByRunner'],{role:NEW})
   with self.assertRaises(Exception):ns['build_activation'](desired,{**auth,'planSha256':'e'*64},'d'*64,1100)
   with self.assertRaises(Exception):ns['validate_hype_plan']({**desired,'runners':{**desired['runners'],'V12_V4':NEW}},current,pins,NEW)
 def test_generated_native_switch_preserves_state_before_start_and_parser_failure_blocks_write(self):
  for role,before in self.states().items():
   for fail_parser in (False,True):
    ns=self.generated(role);cls=ns['HypeScopedOperations'];ops=cls.__new__(cls);events=[]
    class State:
     def lstat(self):return 'original-metadata'
    state=State();ns['STATE']=state;store=[json.dumps(before).encode()]
    extra={};ns['_safe_bytes']=lambda path:store[0] if path is state else extra.get(path,b'previous-tick')
    def public(*args):
     events.append('validate-'+args[3])
     if fail_parser and args[3]==NEW:raise ValueError('CANDIDATE_NATIVE_PARSER_REJECTED')
    ns['public_validate_peer_state_bytes']=public
    def atomic(path,raw,metadata):
     if path is state:events.append('write');store[0]=raw
     else:extra[path]=raw
    ns['_atomic']=atomic
    class Systemd:
     def __getattr__(self,name):
      def action(*args):events.append(name);return 0 if name=='main_pid' else False
      return action
    ops.systemd=Systemd();ops.old_unit='exact-old';ops.new_unit='exact-new';ops.health=lambda:events.append('health');ops.signed_flat=lambda:events.append('signed')
    ops.paths=types.SimpleNamespace(pins=Path('/pins'),current_plan=Path('/current-plan'))
    ops.release=Path('/release')/NEW;ops.args=types.SimpleNamespace(sha=NEW);ops.plan_mode='fresh';ops.baselines={p:(b'previous-tick','root-metadata') for p in (ops.paths.pins,ops.paths.current_plan)};ops.replaced=[];ops.next_manifest={};ops.next_current={};ops.desired={'runners':{role:NEW}};ops.state_changed=False
    ops.parent=types.SimpleNamespace(_assert_expected_pins=lambda pins:None)
    if fail_parser:
     with self.assertRaisesRegex(ValueError,'CANDIDATE_NATIVE_PARSER_REJECTED'):ops.switch()
     self.assertNotIn('write',events);self.assertNotIn('start',events)
    else:
     ops.switch();after=json.loads(store[0]);key=cutover.ROLES[role]['runtime']
     self.assertEqual(after[key],NEW);self.assertEqual({k:v for k,v in after.items() if k not in (key,'updatedAt')},{k:v for k,v in before.items() if k not in (key,'updatedAt')})
     self.assertLess(events.index('stop'),events.index('write'));self.assertLess(events.index('write'),events.index('start'))
 def test_real_native_public_parser_imports_accept_flat_sources_without_writing(self):
  root=REF.parents[1]
  for role,state in self.states().items():
   if role=='PENGU_V8':state={k:v for k,v in state.items() if k!='riskOverlay'}
   if role=='IDLE_PRIORITY_SHORT':state={**state,'lastAcceptedBySymbol':{}}
   path=root/'.tmp'/('flat-peer-parser-'+str(uuid.uuid4())+'.json')
   try:
    raw=json.dumps(state).encode();path.write_bytes(raw)
    result=subprocess.run(['node','--import',(root/'node_modules/tsx/dist/loader.mjs').as_uri(),'--input-type=module','-',role,str(path),OLD],input=cutover.PUBLIC_STATE_CHILD,cwd=root,text=True,capture_output=True,timeout=60)
    self.assertEqual(result.returncode,0,result.stderr)
    value=json.loads(result.stdout)['value'];cutover.validate_flat_peer_state(role,value,OLD)
    self.assertEqual(path.read_bytes(),raw)
   finally:path.unlink(missing_ok=True)
 def function(self,name):
  f=getattr(cutover,name,None);self.assertTrue(callable(f),name);return f
 def test_only_four_explicit_peer_roles_can_generate_authenticated_transactions(self):
  build=self.function('build_stable4_flat_peer_sources');h=(REF/'disdex_hype_scoped_root_cutover.py').read_bytes();g=(REF/'disdex_unified_root_gate.py').read_bytes()
  roles=['QUALITY102_CAUSAL_V1','PENGU_V8','FET_BRK48_RESIDUAL','IDLE_PRIORITY_SHORT'];out=build(h,g,old_by_role={r:OLD for r in roles})
  for name,raw in out.items():ast.parse(raw,filename=name)
  generic=out['disdex_unified_root_gate.py'].decode();self.assertIn("args.orders_enabled == 'true'",generic);self.assertIn('disdex_stable4_flat_peer_cutover',generic)
  for role in roles:
   raw=next(v for k,v in out.items() if k!='disdex_unified_root_gate.py' and ('RUNNER = "'+role+'"').encode() in v);text=raw.decode()
   self.assertIn('self.parent._verify_token(self.args, self.token,',text);self.assertIn('nonce_dir=self.paths.nonce_dir',text)
   self.assertIn('== self.args.plan_sha256',text);self.assertIn('valid_hold(json.loads',text);self.assertIn('THREE_TICKS_TIMEOUT',text)
   self.assertIn('self.systemd.stop(self.old_unit)',text);self.assertIn('self.systemd.mask(self.old_unit)',text);self.assertNotIn('self.systemd.start(self.old_unit)',text)
   self.assertIn('public_validate_peer_state_bytes',text);self.assertIn('collect_h48_signed_inventory',text);self.assertNotIn('expected_hash =',text)
  with self.assertRaises(ValueError):build(h,g,old_by_role={'V12_V4':OLD})
  with self.assertRaises(ValueError):build(h+b'\n',g,old_by_role={r:OLD for r in roles})
 def states(self):
  return {'QUALITY102_CAUSAL_V1':{'version':1,'strategyId':'QUALITY102_CAUSAL_V1','mode':'LIVE','runtimeCommitSha':OLD,'updatedAt':1000,'failures':[]},
   'PENGU_V8':{'version':2,'strategyId':'PENGU_DUAL_LS_V2_FINAL','mode':'LIVE','runtimeCommitSha':OLD,'updatedAt':1000,'failures':[],'riskOverlay':{'native':'retain'}},
   'FET_BRK48_RESIDUAL':{'schema':'fet-brk48-residual-state/v1','strategyId':'FET_BRK48_RESIDUAL','runtimeCommitSha':OLD,'updatedAt':1000,'failures':[]},
   'IDLE_PRIORITY_SHORT':{'schema':'disdex-idle-priority-state/v2','runtimeSha':OLD,'updatedAt':1000,'failures':[],'positions':[],'pending':None,'lastAcceptedBySymbol':{'XRPUSDT':999}}}
 def test_migration_retains_native_history_and_cannot_clear_unknown_or_exposure(self):
  migrate=self.function('migrate_flat_peer_state');validate=self.function('validate_flat_peer_state')
  for role,state in self.states().items():
   before=copy.deepcopy(state);new=migrate(role,state,OLD,NEW,2000);self.assertEqual(state,before);validate(role,new,NEW)
   key='runtimeSha' if role=='IDLE_PRIORITY_SHORT' else 'runtimeCommitSha'
   self.assertEqual(new,{**before,key:NEW,'updatedAt':2000})
   for patch in [{'pending':{'phase':'submitted'}},{'manualReview':'UNKNOWN'},{'position':{'quantity':1}},{'positions':[{'quantity':1}]}]:
    with self.subTest(role=role,patch=patch),self.assertRaises(ValueError):migrate(role,{**state,**patch},OLD,NEW,2000)
 def test_ordered_transaction_never_commits_after_unknown_rollback_and_retains_failure(self):
  run=self.function('run_flat_peer_transaction')
  class Ops:
   def __init__(self,fail=None,unknown=False):self.calls=[];self.fail=fail;self.unknown=unknown
   def __getattr__(self,name):
    def action(*args):
     self.calls.append(name)
     if name==self.fail:raise ValueError('SIGNED_STATE_CHANGED')
     if name=='rollback' and self.unknown:raise ValueError('PROTECTED_UNKNOWN_EXECUTION')
     return [100,200,300] if name=='audit' else {'committed':True}
    return action
  good=Ops();self.assertEqual(run(good),{'committed':True});self.assertEqual(good.calls,['prepare','consume','publish','switch','audit','commit'])
  for failure in ['prepare','consume','publish','switch','audit','commit']:
   ops=Ops(failure)
   with self.assertRaisesRegex(ValueError,'SIGNED_STATE_CHANGED'):run(ops)
   self.assertEqual(ops.calls[-1],'rollback')
  bad=Ops('audit',True)
  with self.assertRaisesRegex(RuntimeError,'PROTECTED'):run(bad)
  self.assertNotIn('commit',bad.calls)
if __name__=='__main__':unittest.main()
