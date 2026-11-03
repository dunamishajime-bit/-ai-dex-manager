import os, sys, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
import disdex_unified_root_gate as gate
from disdex_v52_scoped_root_cutover import V52ScopedOperations

class DispatchTest(unittest.TestCase):
 def test_protected_hold_uses_existing_fifteen_minute_margin_contract_not_two_minute_order_gate(self):
  now=2000000000000
  parent=SimpleNamespace(paths=SimpleNamespace(root=Path('/fixture'),receipts=Path('/fixture')),systemd=None)
  ops=V52ScopedOperations(parent,SimpleNamespace(sha='a'*40),'')
  ops.reader=SimpleNamespace(read_risk=lambda:dict(sourceComplete=True,tripped=False,maximumLossPct=7.5))
  import json
  margin=dict(checkedAt=now-300000,stage='HEALTHY',ordersAllowed=True)
  pending=dict(updatedAt=now-90000,entries=[dict(status='RELEASED')])
  kill=dict(active=True,action='HOLD_PROTECTED',operator='disdex-v52-aster-only',recoverable=True,reason='V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha')
  ops.file=lambda p:json.dumps(margin if p==ops.MARGIN else pending if p==ops.PENDING else kill).encode()
  with patch('disdex_v52_scoped_root_cutover.time.time_ns',return_value=now*1000000):
   ops.health()
   for stamp in [now-900001,now+1]:
    margin['checkedAt']=stamp
    with self.assertRaisesRegex(ValueError,'MARGIN_OR_PENDING_STALE'):ops.health()

 def test_exact_v52_scope_dispatches_to_independent_executor(self):
  parent=gate.RootDeploymentExecutor(SimpleNamespace(),root_uid=os.getuid() if hasattr(os,'getuid') else 0)
  args=SimpleNamespace(scope='V52',orders_enabled='true',deployment_target=gate.DEPLOYMENT_TARGET,operator_target=gate.OPERATOR_TARGET)
  with patch.object(gate,'_assert_execution_root'),patch.object(gate,'certify_live_executor'),patch('disdex_v52_scoped_root_cutover.V52ScopedRootExecutor.execute',return_value={'fixture':True}) as execute:
   self.assertEqual(parent.execute(args,'fixture'),{'fixture':True});execute.assert_called_once_with(args,'fixture')

@unittest.skipUnless(os.name!='nt' and hasattr(os,'geteuid') and os.geteuid()==0,'Linux root filesystem fixture required')
class RollbackTest(unittest.TestCase):
 def test_partial_metadata_and_enable_failure_restore_exact_baseline_without_journal_rewind(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);calls=[]
   systemd=SimpleNamespace(**{name:(lambda unit,n=name:calls.append((n,unit))) for name in ['start','stop','enable','disable']})
   parent=SimpleNamespace(paths=SimpleNamespace(root=base,receipts=base),systemd=systemd)
   ops=V52ScopedOperations(parent,SimpleNamespace(sha='a'*40),'')
   ops.command=lambda *args:calls.append(args);ops.old_enabled=True
   ops.old_stopped=True;ops.new_started=True
   pins=base/'pins';pins.write_bytes(b'new');pins.chmod(0o644)
   current=base/'current';current.write_bytes(b'old current');current.chmod(0o600)
   ops.baselines={pins:(b'old',pins.stat()),current:(b'old current',current.stat())}
   ops.replaced=[(pins,b'new'),(current,b'new current')]
   journal=base/'state';journal.write_bytes(b'closed history retained by runner')
   ops.STATE=journal;ops.TICK=base/'missing-tick'
   own=base/'created';own.write_bytes(b'unit');ops.created=[own]
   ops.rollback()
   self.assertEqual(pins.read_bytes(),b'old');self.assertEqual(current.read_bytes(),b'old current')
   self.assertEqual(pins.stat().st_mode&0o777,0o644);self.assertEqual(current.stat().st_mode&0o777,0o600)
   self.assertEqual(journal.read_bytes(),b'closed history retained by runner');self.assertFalse(own.exists())
   self.assertIn(('enable',ops.old_unit),calls);self.assertIn(('start',ops.old_unit),calls)
   self.assertFalse(any('kill' in str(call).lower() for call in calls))

if __name__=='__main__':unittest.main()
