import copy,sys,unittest,os,tempfile,json,subprocess
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_v4_monitor_cutover import build_monitor_activation,validate_monitor_activation,validate_monitor_observation,render_monitor_unit,run_monitor_transaction,V4MonitorOperations,systemd_environment_files
from disdex_deployment_plan import IDS,canonical
import hashlib

SHA='a'*40;NOW=1793718800000

def plan():
 return dict(schema='disdex-unified-deployment-plan/v2',repository='dunamishajime-bit/-ai-dex-manager',deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS',sourceSha=SHA,scope='V12_V4',runners={k:SHA if k=='V12_V4' else '7'*40 for k in IDS},uiSha='7'*40,monitorSha='7'*40,releaseRoots=dict(runners='/home/deploy/disdex-trading/releases',ui='/srv/ui',monitor='/srv/monitor'),ordersEnabled=False)

class V4MonitorContractTest(unittest.TestCase):
 def test_old_instance_mask_uses_scoped_backup_adapter(self):
  from disdex_v4_monitor_cutover import make_old_v4_mask_adapter
  root=Path('/var/lib/disdex/unified-deploy')
  old='disdex-v12-v4@'+'d'*40+'.service'
  expected=root/'v4-monitor-old-unit-test'
  with patch('disdex_v4_priority_live.V4LocalUnitSystemdAdapter') as adapter, \
       patch('tempfile.mkdtemp',return_value=str(expected)) as mkdir:
   mask,backup=make_old_v4_mask_adapter(old,root)
  self.assertIs(mask,adapter.return_value)
  self.assertEqual(backup,expected)
  mkdir.assert_called_once_with(prefix='v4-monitor-old-unit-',dir=root)
  adapter.assert_called_once_with({old},backup)

 def test_durable_flat_gate_accepts_cancelled_history_and_rejects_exposure(self):
  import disdex_v4_monitor_cutover as module
  base=dict(state=dict(legs={'cancelled':dict(qty=0,status='CANCELLED')}),intents={},protections={})
  for document,expected in (
    (base,0),
    ({**base,'state':{'legs':{'leg':{'qty':1,'status':'CANCELLED'}}}},2),
    ({**base,'state':{'legs':{'leg':{'qty':0,'status':'PENDING_ENTRY'}}}},2),
    ({**base,'intents':{'entry':{'stage':'UNKNOWN'}}},2),
    ({**base,'protections':{'stop':{'phase':'LIVE'}}},2),
  ):
   script='const d='+json.dumps(document)+';'+module.V4_MONITOR_REQUIRE_FLAT_LEDGER
   result=subprocess.run(['node','-e',script],capture_output=True,text=True,timeout=10)
   self.assertEqual(result.returncode,expected,result.stderr)

 def test_all_systemd_environment_files_are_read_without_discarding_repeated_properties(self):
  raw='User=deploy\nEnvironmentFiles=/etc/disdex/credentials.env (ignore_errors=no)\nEnvironmentFiles=/etc/disdex/monitor.env (ignore_errors=no)\n'
  self.assertEqual(systemd_environment_files(raw),['/etc/disdex/credentials.env','/etc/disdex/monitor.env'])
  self.assertEqual(systemd_environment_files(raw+'EnvironmentFiles=/unapproved.env (ignore_errors=no)\n')[-1],'/unapproved.env')

 def test_transaction_consumes_fresh_authority_before_scoped_publication_and_rolls_back_partial_start(self):
  class Ops:
   def __init__(self,fail=None):self.calls=[];self.fail=fail
   def step(self,name):
    self.calls.append(name)
    if name==self.fail:raise ValueError('fixture '+name)
   def prepare(self):self.step('prepare')
   def consume(self):self.step('consume')
   def publish(self):self.step('publish')
   def switch(self):self.step('switch')
   def audit(self):self.step('three-real-ticks');return [1000,2000,3000]
   def commit(self,ticks):self.step('commit');return dict(status='V4_MONITOR_ONLY_VERIFIED',ordersEnabled=False,ticks=ticks)
   def rollback(self):self.step('rollback')
  ops=Ops();result=run_monitor_transaction(ops)
  self.assertFalse(result['ordersEnabled']);self.assertEqual(ops.calls,['prepare','consume','publish','switch','three-real-ticks','commit'])
  for failure in ['publish','switch','three-real-ticks','commit']:
   failed=Ops(failure)
   with self.assertRaises(ValueError):run_monitor_transaction(failed)
   self.assertEqual(failed.calls[-1],'rollback')
  expired=Ops('consume')
  with self.assertRaises(ValueError):run_monitor_transaction(expired)
  self.assertEqual(expired.calls,['prepare','consume'])

 def test_no_order_monitor_approval_cannot_authorize_refresh_or_trading(self):
  p=plan();hashed=hashlib.sha256(canonical(p)).hexdigest()
  auth=dict(sourceSha=SHA,scope='V12_V4',ordersEnabled=False,planSha256=hashed,route='CODEX_SSH',authorizationMethod='ROOT_SSH_SESSION',nonce='c'*32,issuedAt=NOW//1000-20,expiresAt=NOW//1000+280)
  activation=build_monitor_activation(p,auth,NOW//1000,durable_state_hash='d'*64)
  validate_monitor_activation(activation,p,NOW//1000)
  self.assertFalse(activation['ordersEnabled']);self.assertFalse(activation['authorizesEvidenceRefresh'])
  for field,value in [('ordersEnabled',True),('authorizesEvidenceRefresh',True),('phase','CERTIFIED'),('approvedSha','b'*40)]:
   with self.assertRaises(ValueError):validate_monitor_activation({**activation,field:value},p,NOW//1000)
  with self.assertRaises(ValueError):validate_monitor_activation(activation,p,auth['expiresAt'])
  with self.assertRaises(ValueError):build_monitor_activation({**p,'ordersEnabled':True},auth,NOW//1000,durable_state_hash='d'*64)
  with self.assertRaises(ValueError):build_monitor_activation(p,auth,NOW//1000,durable_state_hash='')
  receipt=dict(status='V4_MONITOR_ONLY_VERIFIED',ordersEnabled=False,sourceSha=SHA,planSha256=hashed,
   activationSha256=hashlib.sha256(canonical(activation)).hexdigest(),nonceDigest=activation['nonceDigest'],
   deploymentAuthorizedAt=NOW//1000,committedAt=NOW//1000+180,
   auditTickTimes=[NOW+1000,NOW+61000,NOW+121000])
  validate_monitor_activation(activation,p,NOW//1000+86400,receipt)
  for patch in [dict(ordersEnabled=True),dict(auditTickTimes=[NOW+1000]*3),
   dict(auditTickTimes=[NOW-1000,NOW+61000,NOW+121000]),dict(activationSha256='e'*64)]:
   with self.assertRaises(ValueError):validate_monitor_activation(activation,p,NOW//1000+86400,{**receipt,**patch})

 def test_marker_and_health_must_prove_one_real_readonly_cycle_and_actual_process(self):
  identity=dict(runnerId='V12_V4',runtimeSha=SHA,expectedSha=SHA,serviceUnit=f'disdex-v12-v4@{SHA}.service',mainPid=1234,workingDirectory='/home/deploy/disdex-trading/releases/'+SHA)
  health=dict(**identity,schema='disdex-v12-v4-runner-heartbeat/v1',mode='MONITOR_ONLY',operationMode='MONITOR_ONLY',liveEnabled=False,newOrdersAllowed=False,heartbeatAt=NOW,lastTickAt=NOW-1,candidateCount=0,positionCount=0,openOrderCount=0,pendingCount=0)
  tick=dict(**identity,schema='disdex-runner-tick/v1',tickStartedAt=NOW-1000,tickCompletedAt=NOW-1,newOrdersAllowed=False,ordersSent=0,cancelsSent=0,positionChangesSent=0)
  result=validate_monitor_observation(health,tick,sha=SHA,pid=1234,now=NOW,previous_tick=None)
  self.assertEqual(result['tickCompletedAt'],NOW-1)
  for patch in [dict(mainPid=99),dict(runtimeSha='b'*40),dict(liveEnabled=True),dict(lastTickAt=None),dict(mode='LIVE')]:
   with self.assertRaises(ValueError):validate_monitor_observation({**health,**patch},tick,sha=SHA,pid=1234,now=NOW,previous_tick=None)
  for patch in [dict(newOrdersAllowed=True),dict(ordersSent=False),dict(tickCompletedAt=NOW+1),dict(workingDirectory='/wrong')]:
   with self.assertRaises(ValueError):validate_monitor_observation(health,{**tick,**patch},sha=SHA,pid=1234,now=NOW,previous_tick=None)
  with self.assertRaises(ValueError):validate_monitor_observation(health,tick,sha=SHA,pid=1234,now=NOW,previous_tick=NOW-1)

 def test_unit_uses_same_pid_immutable_loader_and_explicit_no_order_prestart(self):
  text=render_monitor_unit(SHA)
  self.assertIn('User=deploy',text)
  self.assertIn('/usr/bin/node --import /home/deploy/disdex-trading/releases/'+SHA+'/node_modules/tsx/dist/loader.mjs',text)
  self.assertIn('scripts/v12-v4-production-runner.ts --monitor-only --daemon',text)
  self.assertIn('disdex_v4_monitor_cutover.py --prestart --sha '+SHA,text)
  self.assertIn('ReadOnlyPaths=/var/lib/disdex/shared',text)
  self.assertIn('ReadOnlyPaths=/var/lib/disdex/v12-v4/orders.json',text)
  self.assertNotIn('ordersEnabled=true',text)
  self.assertNotIn('StateDirectory=disdex/v12-v4\n',text)

@unittest.skipUnless(os.name!='nt' and hasattr(os,'geteuid') and os.geteuid()==0,'Linux root filesystem fixture required')
class V4RollbackFixtureTest(unittest.TestCase):
 def test_partial_metadata_publication_restores_bytes_permissions_and_dormant_baseline(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);calls=[]
   def operation(name):return lambda unit:calls.append((name,unit))
   systemd=SimpleNamespace(**{name:operation(name) for name in ['stop','disable','unmask','start']})
   parent=SimpleNamespace(paths=SimpleNamespace(root=base,activation_dir=base,receipts=base),systemd=systemd)
   ops=V4MonitorOperations(parent,SimpleNamespace(sha=SHA),'')
   pins=base/'pins.json';pins.write_bytes(b'new metadata');pins.chmod(0o644)
   # Both entries are registered as attempted; the second write failed before
   # rename. Neither an old nor a new file may be lost during this rollback.
   current=base/'current-plan.json';current.write_bytes(b'old current');current.chmod(0o600)
   before_meta=current.stat();ops.baselines={pins:(b'old pins',pins.stat()),current:(b'old current',before_meta)}
   ops.replaced=[(pins,b'new metadata'),(current,b'new current')]
   orders=base/'orders.json';orders.write_bytes(b'preserved history')
   ops.orders=orders;ops.health=base/'health.json';ops.tick=base/'tick.json'
   ops.health.write_text(json.dumps(dict(runtimeSha=SHA)));ops.health.chmod(0o600)
   ops.baselines[ops.health]=(json.dumps(dict(runtimeSha='7'*40)).encode(),ops.health.stat())
   ops.tick.write_text(json.dumps(dict(runtimeSha=SHA)))
   own=base/'own-unit';own.write_text('fixture');ops.created=[own]
   ops.new_started=ops.broker_started=ops.old_masked_by_us=ops.stopped_old_monitor=True
   ops.old_unit='disdex-v12-v4@'+'7'*40+'.service'
   ops._command=lambda *args:calls.append(tuple(args))
   ops.rollback()
   self.assertEqual(pins.read_bytes(),b'old pins');self.assertEqual(current.read_bytes(),b'old current')
   self.assertEqual(orders.read_bytes(),b'preserved history');self.assertFalse(own.exists());self.assertFalse(ops.tick.exists())
   self.assertEqual(pins.stat().st_mode&0o777,0o644);self.assertEqual(current.stat().st_mode&0o777,0o600)
   self.assertIn(('start',ops.old_monitor),calls);self.assertNotIn(('start',ops.old_unit),calls)

 def test_audit_does_not_accept_a_new_pid_as_three_cycles_from_one_process(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);counter=iter([100,200])
   systemd=SimpleNamespace(is_active=lambda unit:False,active_state=lambda unit:'active',main_pid=lambda unit:next(counter),_state=lambda unit,key:'0')
   parent=SimpleNamespace(paths=SimpleNamespace(root=base,activation_dir=base,receipts=base),systemd=systemd,sleep_fn=lambda seconds:None,_assert_expected_pins=lambda pins:None)
   ops=V4MonitorOperations(parent,SimpleNamespace(sha=SHA),'');ops.old_unit='old';ops.desired=plan()
   ops.wiring=SimpleNamespace(assert_applied=lambda:None);ops._assert_protected=lambda:None
   ops.health=base/'missing-health';ops.tick=base/'missing-tick'
   with self.assertRaisesRegex(ValueError,'PID_CHANGED'):ops.audit()

if __name__=='__main__':unittest.main()
