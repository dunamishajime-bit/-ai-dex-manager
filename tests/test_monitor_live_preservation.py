import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_monitor_snapshot_cutover import validate_live_observation,protected_monitor_context,choose_monitor_dropin,render_snapshot_unit,validate_snapshot_prestart

class LivePreservationTest(unittest.TestCase):
 def test_prestart_migration_rejects_unknown_guards_instead_of_removing_them(self):
  sha='a'*40;marker='/home/deploy/disdex-trading/releases/'+sha+'/.disdex-release-sha'
  row='ExecStartPre={ path=/usr/bin/grep ; argv[]=/usr/bin/grep -Fxq '+sha+' '+marker+' ; ignore_errors=no ; }'
  validate_snapshot_prestart(row)
  validate_snapshot_prestart('ExecStartPre=')
  validate_snapshot_prestart(row.replace('/releases/','/runner-health-snapshot/scoped-v52/'))
  for bad in ['ExecStartPre={ argv[]=/usr/bin/python3 /root/authorization-guard.py ; ignore_errors=no ; }',row.replace(' -Fxq '+sha,' -Fxq '+'b'*40)]:
   with self.assertRaises(ValueError):validate_snapshot_prestart(bad)
 def test_snapshot_prestart_binds_to_its_own_release_not_the_old_v4_release(self):
  sha='b'*40;root='/home/deploy/disdex-trading/releases/'+sha;unit=render_snapshot_unit(root,'/etc/disdex/current-runtime/'+sha+'-observed-health.env',sha)
  self.assertIn('ExecStartPre=\n',unit);self.assertIn('ExecStartPre=/usr/bin/grep -Fxq '+sha+' '+root+'/.disdex-release-sha\n',unit)
  self.assertIn('WorkingDirectory='+root,unit);self.assertIn('ExecStart=/usr/bin/node '+root+'/scripts/ops/root/disdex-runner-health-snapshot-current.mjs',unit)
 def fixture(self):
  keys=['V12_V4','V52','PENGU_V8','QUALITY102_CAUSAL_V1','FET_BRK48_RESIDUAL','HYPE_TREND_LONG','IDLE_PRIORITY_SHORT']
  pins={key:'a'*40 for key in keys}
  runners={key:dict(runtimeSha=pins[key],expectedSha=pins[key],newOrdersAllowed=True,orderPermission='ALLOWED',mode='LIVE',liveEnabled=True,processHealthy=True,tickVerified=False,actualLastTickAt=None) for key in keys}
  for key in ['V12_V4','V52']:runners[key].update(tickVerified=True,actualLastTickAt=9900,lastTickAt=9900)
  row=dict(schema='disdex-runner-health-snapshot/v1',readOnly=True,generatedAt=10000,targetIdentity=dict(valid=True,deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS'),runners=runners,sharedKillSwitchActive=False,newOrdersAllowed=True,sharedRisk=dict(safetyState='HEALTHY',maximumLossPct=7.5,sourceComplete=True,fresh=True,tripped=False))
  return pins,row
 def test_monitor_preserves_existing_live_authority_and_requires_real_ticks(self):
  pins,row=self.fixture();self.assertEqual(validate_live_observation(row,pins,10001,row),10000)
  for key,value in [('runtimeSha','b'*40),('newOrdersAllowed',False),('tickVerified',False),('actualLastTickAt',None),('mode','MONITOR_ONLY')]:
   bad=copy.deepcopy(row);bad['runners']['V12_V4'][key]=value
   with self.assertRaises(ValueError):validate_live_observation(bad,pins,10001,row)
  bad=copy.deepcopy(row);bad['runners']['PENGU_V8'].update(tickVerified=True,actualLastTickAt=10000)
  with self.assertRaises(ValueError):validate_live_observation(bad,pins,10001,row)
 def test_monitor_cannot_grant_a_previously_denied_peer_or_clear_kill(self):
  pins,row=self.fixture();baseline=copy.deepcopy(row);baseline['runners']['PENGU_V8'].update(newOrdersAllowed=False,orderPermission='DENIED_OPERATOR')
  with self.assertRaises(ValueError):validate_live_observation(row,pins,10001,baseline)
  for changes in [dict(sharedKillSwitchActive=True),dict(generatedAt=10002),dict(sharedRisk=dict(safetyState='HEALTHY',maximumLossPct=8))]:
   with self.assertRaises(ValueError):validate_live_observation({**row,**changes},pins,10001,row)
 def test_only_pending_digest_may_advance_under_a_live_read_only_monitor_transaction(self):
  context=dict(writer=dict(pid=42),peers=dict(V12_V4=dict(pid=50)),killHash='abc',pendingHash='old')
  self.assertEqual(protected_monitor_context(context),protected_monitor_context({**context,'pendingHash':'new'}))
  self.assertNotEqual(protected_monitor_context(context),protected_monitor_context({**context,'killHash':'changed'}))
 def test_dropin_selection_is_limited_to_the_two_monitor_services(self):
  for service in ['disdex-runner-health-snapshot.service','disdex-runner-watchdog.service']:
   parent=Path('/etc/systemd/system')/(service+'.d')
   result=choose_monitor_dropin([(parent/('z'*80+'.conf')).as_posix()],'b'*40,service)
   self.assertEqual(result.parent,parent);self.assertGreater(result.name,'z'*80+'.conf')
  with self.assertRaises(ValueError):choose_monitor_dropin([],'b'*40,'disdex-v12-v4.service')

if __name__=='__main__':unittest.main()
