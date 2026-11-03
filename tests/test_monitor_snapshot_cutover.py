import copy,json,os,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_monitor_snapshot_cutover import validate_monitor_plan,validate_observation,run_transaction,MonitorSnapshotOperations
from tests.test_disdex_deployment_plan import plan,OLD,NEW

class ContractTest(unittest.TestCase):
 def plans(self):
  current=plan('FULL_PROJECT');current['sourceSha']=OLD
  desired=copy.deepcopy(current);desired.update(scope='API_MONITORS',sourceSha=NEW,monitorSha=NEW)
  desired['releaseRoots']['monitor']='/home/deploy/disdex-trading/releases/'+NEW
  return current,desired
 def test_monitor_root_tracks_its_own_sha_without_changing_runner_ui_or_order_authority(self):
  current,desired=self.plans();self.assertEqual(len(validate_monitor_plan(desired,current,current['runners'])),64)
  for change in [('ordersEnabled',True),('uiSha',NEW)]:
   with self.assertRaises(ValueError):validate_monitor_plan({**desired,change[0]:change[1]},current,current['runners'])
  for key in ['runners','ui','monitor']:
   bad=copy.deepcopy(desired);bad['releaseRoots'][key]='/outside'
   with self.assertRaises(ValueError):validate_monitor_plan(bad,current,current['runners'])
  bad=copy.deepcopy(desired);bad['runners']['V52']=NEW
  with self.assertRaises(ValueError):validate_monitor_plan(bad,current,current['runners'])
 def test_partial_publication_failure_rolls_back_but_expired_authority_never_mutates(self):
  class Ops:
   def __init__(self,fail=None):self.calls=[];self.fail=fail
   def step(self,name):
    self.calls.append(name)
    if name==self.fail:raise ValueError('fixture')
   def prepare(self):self.step('prepare')
   def consume(self):self.step('consume')
   def publish(self):self.step('publish')
   def audit(self):self.step('audit');return [1000,2000,3000]
   def commit(self,times):self.step('commit');return times
   def rollback(self):self.step('rollback')
  self.assertEqual(run_transaction(Ops()),[1000,2000,3000])
  for failure in ['publish','audit','commit']:
   ops=Ops(failure)
   with self.assertRaises(ValueError):run_transaction(ops)
   self.assertEqual(ops.calls[-1],'rollback')
  ops=Ops('consume')
  with self.assertRaises(ValueError):run_transaction(ops)
  self.assertEqual(ops.calls,['prepare','consume'])
 def test_snapshot_cannot_claim_order_enable_or_fake_current_time_as_actual_tick(self):
  pins={k:OLD for k in ['V12_V4','V52','PENGU_V8','QUALITY102_CAUSAL_V1','FET_BRK48_RESIDUAL','HYPE_TREND_LONG','IDLE_PRIORITY_SHORT']}
  rows={key:dict(runtimeSha=sha,expectedSha=sha,mode='LIVE',orderPermission='DENIED_BLOCKED',newOrdersAllowed=False,actualLastTickAt=None,tickVerified=False) for key,sha in pins.items()}
  for key in ['V12_V4','V52']:rows[key].update(actualLastTickAt=9900,lastTickAt=9900,tickVerified=True,processHealthy=True)
  rows['V12_V4'].update(mode='MONITOR_ONLY',liveEnabled=False)
  report=dict(schema='disdex-runner-health-snapshot/v1',generatedAt=10000,targetIdentity=dict(valid=True,deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS'),readOnly=True,newOrdersAllowed=False,sharedKillSwitchActive=True,runners=rows)
  validate_observation(report,pins,10001)
  for delta in [dict(newOrdersAllowed=True),dict(generatedAt=10002),dict(sharedKillSwitchActive=False)]:
   with self.assertRaises(ValueError):validate_observation({**report,**delta},pins,10001)
  for key in ['V12_V4','V52']:
   bad=copy.deepcopy(report);bad['runners'][key]['tickVerified']=False
   with self.assertRaises(ValueError):validate_observation(bad,pins,10001)

@unittest.skipUnless(os.name!='nt' and hasattr(os,'geteuid') and os.geteuid()==0,'Linux root filesystem fixture required')
class RootRollbackTest(unittest.TestCase):
 def test_post_rename_fsync_failure_restores_plan_and_only_removes_new_snapshot_config(self):
  from disdex_shared_risk_monitor_wiring import atomic_text
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);current=base/'current-plan.json';current.write_bytes(b'old plan');current.chmod(0o600)
   calls=[];parent=SimpleNamespace(paths=SimpleNamespace(root=base,current_plan=current,receipts=base),systemd=None)
   ops=MonitorSnapshotOperations(parent,SimpleNamespace(sha=NEW,plan_sha256='f'*64),'')
   ops.current_raw=current.read_bytes();ops.current_meta=current.stat();ops.current={'fixture':'old'}
   ops.next_current={'fixture':'new'};ops.release=base/'release';ops.old_properties='old snapshot command'
   ops.context={'fixture':'frozen'};ops.authorization={'nonce':'c'*32};ops.authorized_at=2000000000
   ops.env=base/'health.env';ops.dropin=base/'snapshot.conf';ops.journal=base/'journal'/'prepared.json'
   ops.protected=lambda:None
   def command(*args):
    calls.append(args)
    return 'WorkingDirectory='+str(ops.release)+'\nExecStart='+str(ops.release/'scripts/ops/root/disdex-runner-health-snapshot-current.mjs')
   ops.command=command
   def fail_after_rename(path,raw,meta):
    atomic_text(path,raw,meta);raise OSError('fixture directory fsync after rename')
   with patch('disdex_shared_risk_monitor_wiring.atomic_text',side_effect=fail_after_rename):
    with self.assertRaises(OSError):ops.publish()
   self.assertNotEqual(current.read_bytes(),b'old plan');self.assertTrue(ops.journal.exists())
   ops.rollback()
   self.assertEqual(current.read_bytes(),b'old plan');self.assertEqual(current.stat().st_mode&0o777,0o600)
   self.assertFalse(ops.env.exists());self.assertFalse(ops.dropin.exists());self.assertTrue(ops.journal.exists())
   self.assertFalse(any(command[0] in ['start','stop','restart','enable','disable'] for command in calls))

if __name__=='__main__':unittest.main()
