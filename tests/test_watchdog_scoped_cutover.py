import copy,os,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_watchdog_scoped_cutover import validate_audit,render_watchdog_unit,run_transaction,Operations

class WatchdogScopeTest(unittest.TestCase):
 def test_systemd_boundary_rejects_all_trading_service_mutations(self):
  ops=Operations(None)
  for args in [('restart','disdex-v12-v4@fixture.service'),('start','disdex-v52-aster-only@fixture.service'),('stop','disdex-runner-watchdog.service'),('unmask','disdex-runner-watchdog.service')]:
   with self.assertRaisesRegex(ValueError,'WATCHDOG_MUTATION_SCOPE'):ops.command(*args)
 def test_real_rollback_preserves_unrelated_config_and_refuses_foreign_changes(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder);ops=Operations(None);ops.dropin=p/'new.conf';ops.env_path=p/'new.env';peer=p/'existing-peer.conf'
   if os.name=='nt':ops.file=lambda path:Path(path).read_bytes()
   peer.write_bytes(b'unchanged');ops.audit_unit=b'audit';ops.live_unit=b'live';ops.env_raw=b'env'
   ops.dropin.write_bytes(ops.audit_unit);ops.env_path.write_bytes(ops.env_raw);ops.created=[ops.env_path,ops.dropin]
   calls=[];ops.command=lambda *args:calls.append(args)
   ops.dropin.write_bytes(b'foreign')
   with self.assertRaises(ValueError):ops.rollback()
   self.assertEqual(ops.dropin.read_bytes(),b'foreign');self.assertTrue(ops.env_path.exists())
   ops.dropin.write_bytes(ops.live_unit);ops.rollback()
   self.assertFalse(ops.dropin.exists());self.assertFalse(ops.env_path.exists());self.assertEqual(peer.read_bytes(),b'unchanged')
   self.assertEqual(calls,[('daemon-reload',)])
 def row(self):
  return dict(auditOnly=True,releaseSha='a'*40,exitCode=0,observedAt=9900,restartCalls=[],errors=[],
   decisions={k:dict(action='NOOP') for k in ['V12_V4','PENGU_V8','V52','QUALITY102_CAUSAL_V1','FET_BRK48_RESIDUAL','HYPE_TREND_LONG','IDLE_PRIORITY_SHORT']},
   dependencies={k:dict(action='NOOP') for k in ['SHARED_CRYPTO_RISK','MARGIN_GUARD']},
   tradingEffects=dict(ordersSent=0,cancelSent=0,positionChangesSent=0))
 def test_preview_must_be_fresh_all_noop_no_restart_and_no_trading(self):
  row=self.row();validate_audit(row,'a'*40,10000,audit_only=True)
  for delta in [dict(auditOnly=False),dict(restartCalls=['peer']),dict(errors=['error']),dict(observedAt=10001),dict(releaseSha='b'*40),dict(decisions={}),dict(tradingEffects=dict(ordersSent=1,cancelSent=0,positionChangesSent=0))]:
   with self.assertRaises(ValueError):validate_audit({**row,**delta},'a'*40,10000,audit_only=True)
  for action in ['RESTART','RESTART_REQUIRED_NOT_EXECUTED','HOLD_FAIL_CLOSED']:
   bad=copy.deepcopy(row);bad['decisions']['V12_V4']['action']=action
   with self.assertRaises(ValueError):validate_audit(bad,'a'*40,10000,audit_only=True)
 def test_unit_changes_only_watchdog_local_source_and_keeps_root_pin_prechecks(self):
  root='/home/deploy/disdex-trading/releases/'+'a'*40;env='/etc/disdex/current-runtime/'+'a'*40+'-watchdog.env'
  unit=render_watchdog_unit(root,env,'a'*40,audit_only=True)
  self.assertIn('ExecStartPre=\n',unit);self.assertIn('/usr/bin/grep -Fxq '+'a'*40,unit)
  self.assertIn(' --audit-only\n',unit);self.assertNotIn(' --audit-only\n',render_watchdog_unit(root,env,'a'*40,audit_only=False))
  for bad in ['/tmp/foreign',root+'/../other',root+';bad']:
   with self.assertRaises(ValueError):render_watchdog_unit(bad,env,'a'*40,audit_only=True)
 def test_denied_or_expired_auth_never_publishes_and_failure_rolls_back_only_own_changes(self):
  class Ops:
   def __init__(self,fail=None):self.calls=[];self.fail=fail
   def step(self,name):
    self.calls.append(name)
    if name==self.fail:raise ValueError(name)
   def prepare(self):self.step('prepare')
   def authorize(self):self.step('authorize')
   def publish(self):self.step('publish')
   def audit(self):self.step('audit');return [1,2,3]
   def enable_recovery(self):self.step('enable_recovery')
   def commit(self,times):self.step('commit');return times
   def rollback(self):self.step('rollback')
  self.assertEqual(run_transaction(Ops()),[1,2,3])
  for failure in ['publish','audit','enable_recovery','commit']:
   ops=Ops(failure)
   with self.assertRaises(ValueError):run_transaction(ops)
   self.assertEqual(ops.calls[-1],'rollback')
  ops=Ops('authorize')
  with self.assertRaises(ValueError):run_transaction(ops)
  self.assertEqual(ops.calls,['prepare','authorize'])

if __name__=='__main__':unittest.main()
