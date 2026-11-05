"""Kernel-level serialization; no real systemd or venue calls."""
import os,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
import disdex_watchdog_exec as m

@unittest.skipIf(os.name=='nt','requires Linux Root and flock')
class WatchdogSerializationTest(unittest.TestCase):
 def fixture(self,root):
  deploy=root/'deployment';deploy.mkdir(mode=0o700);lock=deploy/'deployment-execution.lock';lock.write_text('');lock.chmod(0o600)
  releases=root/'releases';releases.mkdir();release=releases/('a'*40);release.mkdir()
  (release/'scripts/ops/root').mkdir(parents=True)
  script=release/m.WATCHDOG_SCRIPT;script.write_text('// fixture');script.chmod(0o444)
  marker=release/'.disdex-release-sha';marker.write_text('a'*40+'\n');marker.chmod(0o444)
  return deploy,releases,release,lock
 def test_exclusive_deployment_defers_without_running_or_writing_marker(self):
  import fcntl
  with tempfile.TemporaryDirectory() as folder:
   deploy,releases,release,lock=self.fixture(Path(folder));calls=[];before=lock.read_bytes()
   with lock.open('r+') as held:
    fcntl.flock(held,fcntl.LOCK_EX)
    result=m.run_watchdog('a'*40,deployment_root=deploy,releases=releases,runner=lambda *a,**k:calls.append(a))
   self.assertEqual(result['status'],'WATCHDOG_DEFERRED_DEPLOYMENT_IN_PROGRESS')
   self.assertEqual(calls,[]);self.assertEqual(lock.read_bytes(),before)
 def test_entire_native_watchdog_child_holds_shared_lock_and_preserves_mode(self):
  import fcntl
  with tempfile.TemporaryDirectory() as folder:
   deploy,releases,release,lock=self.fixture(Path(folder));calls=[]
   def child(command,**kwargs):
    calls.append((command,kwargs))
    with lock.open('r+') as other:
     with self.assertRaises(BlockingIOError):fcntl.flock(other,fcntl.LOCK_EX|fcntl.LOCK_NB)
    return SimpleNamespace(returncode=0)
   result=m.run_watchdog('a'*40,deployment_root=deploy,releases=releases,runner=child,audit_only=True)
   self.assertEqual(result['status'],'WATCHDOG_COMMAND_COMPLETED')
   self.assertEqual(calls[0][0],['/usr/bin/node',str(release/m.WATCHDOG_SCRIPT),'--audit-only'])
   self.assertEqual(calls[0][1]['cwd'],release)
   with lock.open('r+') as other:fcntl.flock(other,fcntl.LOCK_EX|fcntl.LOCK_NB)
 def test_unknown_source_writable_script_and_symlink_lock_reject(self):
  with tempfile.TemporaryDirectory() as folder:
   deploy,releases,release,lock=self.fixture(Path(folder));called=[]
   for sha in ['latest','../'+'a'*40]:
    with self.assertRaises(ValueError):m.run_watchdog(sha,deployment_root=deploy,releases=releases,runner=lambda *a,**k:called.append(a))
   (release/m.WATCHDOG_SCRIPT).chmod(0o644)
   with self.assertRaises(ValueError):m.run_watchdog('a'*40,deployment_root=deploy,releases=releases,runner=lambda *a,**k:called.append(a))
   (release/m.WATCHDOG_SCRIPT).chmod(0o444);lock.rename(deploy/'original');lock.symlink_to(deploy/'original')
   with self.assertRaises((ValueError,OSError)):m.run_watchdog('a'*40,deployment_root=deploy,releases=releases,runner=lambda *a,**k:called.append(a))
   self.assertEqual(called,[])
 def test_native_failure_is_not_reported_as_completed_or_healthy(self):
  with tempfile.TemporaryDirectory() as folder:
   deploy,releases,release,lock=self.fixture(Path(folder))
   result=m.run_watchdog('a'*40,deployment_root=deploy,releases=releases,runner=lambda *a,**k:SimpleNamespace(returncode=2))
   self.assertEqual(result['status'],'WATCHDOG_COMMAND_FAILED');self.assertEqual(result['exitCode'],2)
