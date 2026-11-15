import ast
import copy
import hashlib
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch as mock_patch
import disdex_stable4_h48_root_patch as patch
from test_disdex_stable4_h48_policy import SHA,NOW,PLAN,certificate
from test_disdex_v4_nonflat_ownership import fixture,SHA as V4_SHA
ROOT=Path(__file__).resolve().parents[3]
REF=ROOT/'.tmp/stable4-root-reference-20261115'
class H48RootPatchTests(unittest.TestCase):
 def function(self,name):
  value=getattr(patch,name,None);self.assertTrue(callable(value),name);return value
 @unittest.skipUnless((REF/'disdex_hype_scoped_root_cutover.py').is_file() and (REF/'disdex_unified_root_gate.py').is_file(),'actual captured VPS root source required')
 def test_hash_bound_patch_keeps_legacy_branch_and_selects_exact_certificate_branch(self):
  f=self.function('build_h48_root_sources')
  h=(REF/'disdex_hype_scoped_root_cutover.py').read_bytes();g=(REF/'disdex_unified_root_gate.py').read_bytes()
  out=f(h,g,old_hype_sha='b'*40)
  for name,raw in out.items():ast.parse(raw,filename=name)
  text=out['disdex_stable4_h48_scoped_root_cutover.py'].decode()
  self.assertIn('OLD = "'+('b'*40)+'"',text);self.assertIn('collect_h48_signed_inventory',text)
  self.assertIn('"DISDEX_HYPE_ZEC_SIGNAL_MODE": "STABLE4"',text)
  self.assertIn('"DISDEX_STABLE4_GLOBAL_LIVE_ACK": new_sha',text)
  self.assertIn('scripts/disdex-hype-zec-long-live-runner.ts --daemon',text)
  self.assertIn('h48TimeOnly=build_h48_manifest_binding(self.release,self.args.sha)',text)
  self.assertIn('build_h48_v4_priority_authority(certificate_raw=priority_certificate',text)
  self.assertIn('_root_file(self.priority_path, canonical(self.priority_authority)+b"\\n", 0o444, self.created)',text)
  self.assertLess(text.index('nonce_dir=self.paths.nonce_dir'),text.index('build_h48_v4_priority_authority(certificate_raw=priority_certificate'))
  self.assertNotIn('positionCount", "openOrderCount", "ordersSent"',text[text.index('    def signed_flat(self):'):text.index('    def health(',text.index('    def signed_flat(self):'))])
  generic=out['disdex_unified_root_gate.py'].decode();self.assertIn('from disdex_hype_scoped_root_cutover import HypeScopedRootExecutor',generic);self.assertIn('from disdex_stable4_h48_scoped_root_cutover import HypeScopedRootExecutor',generic)
  with self.assertRaises(ValueError):f(h+b'\n',g,old_hype_sha='b'*40)
  with self.assertRaises(ValueError):f(h,g+b'\n',old_hype_sha='b'*40)
 def test_manifest_binds_exact_release_source_and_policy_certificate(self):
  release=Path('/home/deploy/disdex-trading/releases')/SHA
  with mock_patch.object(patch,'_immutable_binding_bytes',side_effect=lambda p:str(p).encode()):
   result=patch.build_h48_manifest_binding(release,SHA)
  self.assertEqual(result['schema'],'disdex-pending-h48-authority-binding/v1')
  self.assertEqual(result['sourceSha'],SHA)
  for key,path in {'authoritySha256':release/'lib/hype-stable4-time-only-authority.ts','contractSha256':release/'lib/hype-stable4-time-only-contract.ts','certificateSha256':Path('/etc/disdex/stable4/h48-time-only')/(SHA+'.json')}.items():
   self.assertEqual(result[key],hashlib.sha256(str(path).encode()).hexdigest())
  with self.assertRaises(ValueError):patch.build_h48_manifest_binding(Path('/tmp')/SHA,SHA)
 def test_priority_authority_binds_exact_certificate_and_consumed_scope(self):
  raw=json.dumps(certificate(),sort_keys=True).encode()
  auth={'sourceSha':SHA,'scope':'HYPE_TREND_LONG','planSha256':PLAN,'ordersEnabled':True,'deploymentTarget':'professional-dismanager.net','route':'CODEX_SSH','nonce':'e'*32,'issuedAt':NOW//1000-2,'expiresAt':NOW//1000+100}
  result=patch.build_h48_v4_priority_authority(certificate_raw=raw,approved_sha=SHA,approved_plan_sha256=PLAN,authorization=auth,now_ms=NOW)
  self.assertEqual(result['schema'],'disdex-stable4-v4-h48-priority-authority/v1')
  self.assertEqual(result['h48CertificateSha256'],hashlib.sha256(raw).hexdigest())
  self.assertEqual(result['expiresAt'],certificate()['expiresAt'])
  self.assertEqual(result['scope'],'V4_PRIORITY_H48_FULL_EXIT')
  self.assertIs(result['authorizesOtherPolicies'],False)
  for change in [{'scope':'V12_V4'},{'ordersEnabled':False},{'planSha256':'f'*64},{'sourceSha':'a'*40},{'expiresAt':NOW//1000},{'nonce':''}]:
   with self.subTest(change=change),self.assertRaises(ValueError):patch.build_h48_v4_priority_authority(certificate_raw=raw,approved_sha=SHA,approved_plan_sha256=PLAN,authorization={**auth,**change},now_ms=NOW)
 def test_policy_is_really_read_as_deploy_uid_and_gid(self):
  seen=[];deploy=types.SimpleNamespace(pw_uid=1001,pw_gid=1002)
  def run(argv,**kwargs):
   seen.append((argv,kwargs));return types.SimpleNamespace(returncode=0,stdout='e'*64+'\n')
  patch.assert_deploy_readable_policy(Path('/etc/disdex/stable4/v4-h48-priority')/(SHA+'.json'),deploy,'e'*64,run=run)
  self.assertEqual((seen[0][1]['user'],seen[0][1]['group'],seen[0][1]['extra_groups']),(1001,1002,[]))
  with self.assertRaisesRegex(ValueError,'READ_DENIED'):patch.assert_deploy_readable_policy(Path('/tmp/cert'),deploy,'e'*64,run=lambda *a,**kw:types.SimpleNamespace(returncode=1,stdout=''))
 @unittest.skipUnless((REF/'disdex_hype_scoped_root_cutover.py').is_file(),'actual captured VPS root source required')
 def test_active_old_hype_stops_only_after_health_and_signed_flat_then_rechecks(self):
  h=(REF/'disdex_hype_scoped_root_cutover.py').read_bytes();g=(REF/'disdex_unified_root_gate.py').read_bytes()
  out=patch.build_h48_root_sources(h,g,old_hype_sha='b'*40)
  tree=ast.parse(out['disdex_stable4_h48_scoped_root_cutover.py'])
  cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='HypeScopedOperations')
  method=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='switch')
  prefix=copy.deepcopy(method);prefix.body=prefix.body[:4]
  # Exercise the real generated switch prefix with fake process and file I/O.
  calls=[]
  def require(test,reason):
   if not test:raise ValueError(reason)
  state=types.SimpleNamespace(lstat=lambda:'stat')
  ns={'require':require,'STATE':state,'OLD':'b'*40,'json':json,'_safe_bytes':lambda p:b'{"runtimeCommitSha":"'+b'b'*40+b'"}', 'validate_flat_hype_state':lambda row,sha:calls.append('validate')}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[prefix],type_ignores=[])),'generated-switch','exec'),ns)
  class Systemd:
   active=True
   def is_active(self,unit):return self.active
   def main_pid(self,unit):return 7 if self.active else 0
   def stop(self,unit):calls.append('stop');self.active=False
   def mask(self,unit):calls.append('mask')
  obj=types.SimpleNamespace(systemd=Systemd(),old_unit='old',health=lambda:calls.append('health'),signed_flat=lambda:calls.append('signed-flat'))
  ns['switch'](obj);self.assertEqual(calls,['health','signed-flat','stop','mask','signed-flat','validate'])
  calls.clear();obj.systemd=Systemd()
  def reject():calls.append('signed-flat');raise ValueError('owner changed')
  obj.signed_flat=reject
  with self.assertRaises(ValueError):ns['switch'](obj)
  self.assertEqual(calls,['health','signed-flat'])
 def test_signed_reader_uses_existing_environment_budget_and_deploy_uid_only(self):
  f=self.function('collect_h48_signed_inventory');doc,pos,orders=fixture();raw=json.dumps(doc,separators=(',',':'))
  payload={'schema':'disdex-stable4-h48-signed-inventory/v1','v4Sha':V4_SHA,'v4Raw':raw,'hypeState':{'schema':'disdex-hype-zec-long/v1','runtimeCommitSha':SHA,'mode':'LIVE','updatedAt':NOW,'positions':[],'failures':[]},'positions':pos,'orders':orders,'signedAt':NOW,'pendingHash':'d'*64,'pendingEmpty':True,'journalReplayVerified':True,'accountLeaseVerified':True,'ordersSent':0,'cancelsSent':0,'positionChangesSent':0}
  env={'DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH':'/var/lib/disdex/shared/aster-rate-budget.json','DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET':'/run/disdex-v4-budget-'+V4_SHA+'/budget.sock'}
  sdk=types.SimpleNamespace(child_environment=lambda *a,**kw:env)
  deploy=types.SimpleNamespace(pw_uid=1000,pw_gid=1000,pw_dir='/home/deploy');calls=[]
  def run(argv,**kw):calls.append((argv,kw));return types.SimpleNamespace(returncode=0,stdout=json.dumps(payload),stderr='')
  result=f(release=Path('/home/deploy/disdex-trading/releases')/V4_SHA,deploy=deploy,sdk=sdk,credentials={},v4_sha=V4_SHA,hype_state_sha=SHA,now=lambda:NOW,run=run)
  self.assertTrue(result['hypeFlat']);self.assertEqual(result['positionCount'],1);self.assertEqual(result['openOrderCount'],1);self.assertEqual(result['afterHash'],'d'*64)
  argv,kw=calls[0];self.assertEqual(kw['user'],1000);self.assertEqual(kw['env'],env);self.assertIn('lease.document()',kw['input']);self.assertIn('new V4ExecutionStore',kw['input']);self.assertIn('PUBLIC_SIGNED_GET_ONLY',kw['input']);self.assertNotIn('placeMarketOrder',kw['input'])
  bad=copy.copy(payload);bad['ordersSent']=1
  with self.assertRaises(ValueError):f(release=Path('/home/deploy/disdex-trading/releases')/V4_SHA,deploy=deploy,sdk=sdk,credentials={},v4_sha=V4_SHA,hype_state_sha=SHA,now=lambda:NOW,run=lambda *a,**kw:types.SimpleNamespace(returncode=0,stdout=json.dumps(bad)))
  sdk.child_environment=lambda *a,**kw:{}
  with self.assertRaises(ValueError):f(release=Path('/home/deploy/disdex-trading/releases')/V4_SHA,deploy=deploy,sdk=sdk,credentials={},v4_sha=V4_SHA,hype_state_sha=SHA,now=lambda:NOW,run=run)
if __name__=='__main__':unittest.main()
