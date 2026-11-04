import os,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_deployment_serialization import deployment_lock

@unittest.skipUnless(os.name!='nt' and hasattr(os,'geteuid') and os.geteuid()==0,'Linux root kernel flock fixture')
class SerializationTest(unittest.TestCase):
 def attempt(self,path,flag):
  import fcntl
  fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW)
  try:fcntl.flock(fd,flag|fcntl.LOCK_NB)
  finally:os.close(fd)
 def test_monitor_allows_read_only_maintenance_but_rejects_every_parallel_deployment(self):
  import fcntl
  with tempfile.TemporaryDirectory()as folder:
   p=Path(folder);p.chmod(0o700)
   with deployment_lock(p,'API_MONITORS',False):
    self.attempt(p/'deployment-execution.lock',fcntl.LOCK_SH)
    with self.assertRaises(BlockingIOError):self.attempt(p/'deployment-execution.lock',fcntl.LOCK_EX)
    with self.assertRaises(ValueError):
     with deployment_lock(p,'API_MONITORS',False):self.fail('parallel monitor entered')
 def test_trading_cutover_still_blocks_shared_maintenance_and_all_monitor_mutation(self):
  import fcntl
  with tempfile.TemporaryDirectory()as folder:
   p=Path(folder);p.chmod(0o700)
   with deployment_lock(p,'V12_V4',True):
    with self.assertRaises(BlockingIOError):self.attempt(p/'deployment-execution.lock',fcntl.LOCK_SH)
    with self.assertRaises(ValueError):
     with deployment_lock(p,'API_MONITORS',False):self.fail('monitor entered active trading cutover')
 def test_permissions_cannot_expand_and_exceptions_release_both_locks(self):
  with tempfile.TemporaryDirectory()as folder:
   p=Path(folder);p.chmod(0o700)
   with self.assertRaises(ValueError):
    with deployment_lock(p,'API_MONITORS',True):self.fail('monitor gained orders')
   with self.assertRaisesRegex(RuntimeError,'fixture'):
    with deployment_lock(p,'API_MONITORS',False):raise RuntimeError('fixture')
   with deployment_lock(p,'V12_V4',True):pass
 def test_symlink_locks_are_rejected_without_touching_their_target(self):
  with tempfile.TemporaryDirectory()as folder:
   p=Path(folder);p.chmod(0o700);target=p/'target';target.write_bytes(b'unchanged');(p/'monitor-execution.lock').symlink_to(target)
   with self.assertRaises((ValueError,OSError)):
    with deployment_lock(p,'API_MONITORS',False):self.fail('symlink accepted')
   self.assertEqual(target.read_bytes(),b'unchanged')

if __name__=='__main__':unittest.main()
