import copy,hashlib,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_v52_scoped_root_cutover import validate_scoped_plan,build_runtime_activation

IDS=['V12_V4','QUALITY102_CAUSAL_V1','V52','PENGU_V8','FET_BRK48_RESIDUAL','HYPE_TREND_LONG','IDLE_PRIORITY_SHORT','SHARED_CRYPTO_RISK','MARGIN_GUARD']

def plans():
 current=dict(schema='disdex-unified-deployment-plan/v2',repository='dunamishajime-bit/-ai-dex-manager',deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS',sourceSha='7'*40,scope='SHARED_CRYPTO_RISK_ONLY',runners={k:'7'*40 for k in IDS},uiSha='7'*40,monitorSha='7'*40,releaseRoots=dict(runners='/home/deploy/disdex-trading/releases',ui='/srv/ui',monitor='/srv/monitor'),ordersEnabled=False)
 desired={**copy.deepcopy(current),'sourceSha':'a'*40,'scope':'V52','ordersEnabled':True};desired['runners']['V52']='a'*40
 return current,desired

class ScopedRootContractTest(unittest.TestCase):
 def test_v52_approval_cannot_relabel_a_peer_or_expand_into_kill_clearance(self):
  current,desired=plans();hashed=validate_scoped_plan(desired,current,current['runners'])
  self.assertEqual(len(hashed),64)
  for field,value in [('ordersEnabled',False),('scope','FULL_PROJECT'),('uiSha','b'*40)]:
   with self.assertRaises(ValueError):validate_scoped_plan({**desired,field:value},current,current['runners'])
  changed=copy.deepcopy(desired);changed['runners']['FET_BRK48_RESIDUAL']='a'*40
  with self.assertRaises(ValueError):validate_scoped_plan(changed,current,current['runners'])

 def test_root_route_never_fabricates_github_actor_run_or_owner_signature(self):
  current,desired=plans();hashed=validate_scoped_plan(desired,current,current['runners'])
  auth=dict(schema='disdex-codex-ssh-root-auth/v1',repository=desired['repository'],deploymentTarget=desired['deploymentTarget'],operatorTarget=desired['operatorTarget'],operator='codex-ssh',sourceSha='a'*40,scope='V52',planSha256=hashed,ordersEnabled=True,route='CODEX_SSH',authorizationMethod='ROOT_SSH_SESSION',signatureVerified=False,nonce='c'*32,issuedAt=2000000000,expiresAt=2000000300)
  result=build_runtime_activation(desired,auth,2000000001,inventory_digest='d'*64)
  self.assertEqual(result['approvedRunners'],['V52']);self.assertEqual(result['approvedShaByRunner'],{'V52':'a'*40})
  self.assertTrue(result['ordersEnabled']);self.assertFalse(result['authorizesKillClearance'])
  self.assertEqual(result['authorizationMethod'],'ROOT_SSH_SESSION')
  self.assertNotIn('githubRunId',result);self.assertNotIn('githubActor',result);self.assertFalse(result['signatureVerified'])
  self.assertEqual(result['deploymentApprovalExpiresAt'],2000000300)
  for patch in [dict(scope='FULL_PROJECT'),dict(sourceSha='b'*40),dict(ordersEnabled=False),dict(planSha256='e'*64),dict(expiresAt=2000000900),dict(route='GITHUB_ACTIONS')]:
   with self.assertRaises(ValueError):build_runtime_activation(desired,{**auth,**patch},2000000001,inventory_digest='d'*64)
  with self.assertRaises(ValueError):build_runtime_activation(desired,auth,2000000300,inventory_digest='d'*64)

if __name__=='__main__':unittest.main()
