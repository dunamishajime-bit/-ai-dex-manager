import copy,hashlib,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_v52_scoped_root_cutover import validate_scoped_plan,build_runtime_activation,validate_real_tick,run_scoped_transaction,scoped_configuration_bytes,layered_monitor_pin_changes,validate_unchanged_caps,classify_candidate_failure,validate_flat_ownership_state

IDS=['V12_V4','QUALITY102_CAUSAL_V1','V52','PENGU_V8','FET_BRK48_RESIDUAL','HYPE_TREND_LONG','IDLE_PRIORITY_SHORT','SHARED_CRYPTO_RISK','MARGIN_GUARD']

def plans():
 current=dict(schema='disdex-unified-deployment-plan/v2',repository='dunamishajime-bit/-ai-dex-manager',deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS',sourceSha='7'*40,scope='SHARED_CRYPTO_RISK_ONLY',runners={k:'7'*40 for k in IDS},uiSha='7'*40,monitorSha='7'*40,releaseRoots=dict(runners='/home/deploy/disdex-trading/releases',ui='/srv/ui',monitor='/srv/monitor'),ordersEnabled=False)
 desired={**copy.deepcopy(current),'sourceSha':'a'*40,'scope':'V52','ordersEnabled':True};desired['runners']['V52']='a'*40
 return current,desired

class ScopedRootContractTest(unittest.TestCase):
 def test_v52_rollback_rejects_new_exposure_pending_or_ledger_drift(self):
  old='7'*40;new='a'*40
  ledger={'netPnlUsd':0}
  flat=dict(schemaVersion=3,strategyId='DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96',
   runtimeCommitSha=new,positions={},pendingOrder=None,v52Ledger=ledger)
  validate_flat_ownership_state(flat,{old,new},ledger)
  for patch in [dict(runtimeCommitSha='b'*40),dict(positions={'AMZN':{}}),
                dict(pendingOrder={}),dict(v52Ledger={'netPnlUsd':1}),dict(schemaVersion=True)]:
   with self.assertRaises(ValueError):validate_flat_ownership_state({**flat,**patch},{old,new},ledger)
  for field in ('pendingOrder','v52Ledger'):
   incomplete={k:v for k,v in flat.items() if k!=field}
   with self.assertRaises(ValueError):validate_flat_ownership_state(incomplete,{old,new},ledger)

 def test_candidate_failure_reports_only_allowlisted_category_never_raw_http_or_signature(self):
  self.assertEqual(classify_candidate_failure('Reference quote stale for TSLA user=secret signature=secret'),'STOCK_REFERENCE_STALE')
  self.assertEqual(classify_candidate_failure('ASTER_GLOBAL_RATE_BUDGET_SATURATED:123?signature=secret'),'SHARED_RATE_BUDGET_DEFERRED')
  self.assertEqual(classify_candidate_failure('unknown https://host/?signature=secret'),'UNCLASSIFIED')

 def test_gross_contract_comes_from_existing_source_and_cannot_change_or_accept_nan(self):
  source='class StrictPortfolioCaps:\n crypto_gross: float = 3.0\n stock_gross: float = 4.0\n total_gross: float = 4.25\n stock_slot_gross: float = 2.0\n'
  report=dict(caps=dict(crypto=3.,stock=4.,portfolio=4.25,v11=2.,v50=2.))
  validate_unchanged_caps(source,source,report)
  for candidate,proof in [(source.replace('4.25','5.0'),report),(source,dict(caps={**report['caps'],'stock':1.5})),(source,dict(caps={**report['caps'],'crypto':float('nan')}))]:
   with self.assertRaises(ValueError):validate_unchanged_caps(source,candidate,proof)

 def test_historical_monitor_layers_are_reconciled_only_after_effective_old_pin_matches(self):
  prefix='DISDEX_WATCHDOG_V52_';root='/home/deploy/disdex-trading/releases'
  def layer(sha):return prefix+'EXPECTED_SHA='+sha+'\n'+prefix+'RELEASE_ROOT='+root+'/'+sha+'\n'+prefix+'SERVICE_UNIT=disdex-v52-aster-only@'+sha+'.service\nPENGU_SHA=keep\n'
  rows=[(Path('/older.env'),layer('6'*40)),(Path('/current.env'),layer('7'*40))]
  changes=layered_monitor_pin_changes(rows,prefix,'7'*40,'a'*40,root)
  self.assertEqual(len(changes),2)
  self.assertEqual(changes[0][1][prefix+'EXPECTED_SHA'],'6'*40)
  self.assertEqual(changes[1][1][prefix+'EXPECTED_SHA'],'7'*40)
  for _path,old,new in changes:
   self.assertEqual(new[prefix+'EXPECTED_SHA'],'a'*40);self.assertNotIn('PENGU_SHA',new)
  with self.assertRaises(ValueError):layered_monitor_pin_changes(rows,prefix,'8'*40,'a'*40,root)
  with self.assertRaises(ValueError):layered_monitor_pin_changes([(Path('/bad.env'),layer('7'*40).replace(root,'/outside'))],prefix,'7'*40,'a'*40,root)

 def test_only_private_runtime_configuration_is_rebound_never_credentials_or_approvals(self):
  old='7'*40;new='a'*40
  raw=('DISDEX_RUNTIME_COMMIT_SHA='+old+'\nFET_OWNER_SHA='+'8'*40+'\n').encode()
  self.assertEqual(scoped_configuration_bytes(raw,old,new,environment=True),raw.replace(old.encode(),new.encode()))
  with self.assertRaises(ValueError):scoped_configuration_bytes(('ASTER_API_PRIVATE_KEY='+old+'\n').encode(),old,new,environment=True)
  with self.assertRaises(ValueError):scoped_configuration_bytes(b'{"schema":"disdex-live-operator-activation/v1"}',old,new,environment=False)

 def test_post_start_requires_real_tick_identity_and_preserved_protected_hold(self):
  sha='a'*40;now=2000000000000
  row=dict(schema='disdex-runner-tick/v1',runnerId='V52',runtimeSha=sha,expectedSha=sha,
   serviceUnit='disdex-v52-aster-only@'+sha+'.service',mainPid=1234,workingDirectory='/home/deploy/disdex-trading/releases/'+sha,
   tickStartedAt=now-1000,tickCompletedAt=now-1,newOrdersAllowed=False,status='held',reason='KILL_SWITCH_HOLD_PROTECTED')
  self.assertEqual(validate_real_tick(row,sha=sha,pid=1234,now=now,previous=None),now-1)
  for change in [dict(mainPid=99),dict(tickCompletedAt=now+1),dict(newOrdersAllowed=True),dict(runtimeSha='b'*40),dict(workingDirectory='/old')]:
   with self.assertRaises(ValueError):validate_real_tick({**row,**change},sha=sha,pid=1234,now=now,previous=None)
  with self.assertRaises(ValueError):validate_real_tick(row,sha=sha,pid=1234,now=now,previous=now-1)

 def test_partial_cutover_or_audit_failure_rolls_back_only_after_authorization_was_consumed(self):
  class Ops:
   def __init__(self,fail=None):self.fail=fail;self.calls=[]
   def call(self,name):
    self.calls.append(name)
    if self.fail==name:raise ValueError('fixture '+name)
   def prepare(self):self.call('prepare')
   def consume(self):self.call('consume')
   def publish(self):self.call('publish')
   def switch(self):self.call('switch')
   def audit(self):self.call('audit');return [1000,2000,3000]
   def commit(self,ticks):self.call('commit');return dict(status='V52_PROTECTED_HOLD_VERIFIED',ordersEnabled=True,effectiveNewOrdersAllowed=False)
   def rollback(self):self.call('rollback')
  success=Ops();self.assertFalse(run_scoped_transaction(success)['effectiveNewOrdersAllowed'])
  for phase in ['publish','switch','audit','commit']:
   failed=Ops(phase)
   with self.assertRaises(ValueError):run_scoped_transaction(failed)
   self.assertEqual(failed.calls[-1],'rollback')
  failed=Ops('consume')
  with self.assertRaises(ValueError):run_scoped_transaction(failed)
  self.assertEqual(failed.calls,['prepare','consume'])

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
