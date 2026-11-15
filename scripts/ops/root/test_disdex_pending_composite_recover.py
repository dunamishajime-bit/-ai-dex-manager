import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

class RecoverEntrypointTests(unittest.TestCase):
 def load(self):
  spec=importlib.util.spec_from_file_location('pending_recovery_entry',Path(__file__).with_name('disdex_pending_composite_recover.py'))
  module=importlib.util.module_from_spec(spec)
  with patch.dict(sys.modules,{'fcntl':types.SimpleNamespace(LOCK_EX=2,LOCK_NB=4,LOCK_UN=8,flock=lambda *args:None)}):spec.loader.exec_module(module)
  return module
 def test_root_and_authenticated_ssh_are_required_before_any_lock_or_recovery(self):
  module=self.load();calls=[]
  def auth():calls.append('auth');raise ValueError('NOT_AUTHENTICATED')
  gate=types.SimpleNamespace(assert_codex_ssh_session=auth,release_marker=lambda *a,**kw:calls.append('release'))
  with patch.dict(sys.modules,{'disdex_unified_root_gate':gate,'disdex_pending_maintenance_install':types.SimpleNamespace()}),patch.object(module.os,'geteuid',return_value=1000,create=True):
   with self.assertRaisesRegex(ValueError,'ROOT_REQUIRED'):module.main()
  self.assertEqual(calls,[])
  with patch.dict(sys.modules,{'disdex_unified_root_gate':gate,'disdex_pending_maintenance_install':types.SimpleNamespace()}),patch.object(module.os,'geteuid',return_value=0,create=True):
   with self.assertRaisesRegex(ValueError,'NOT_AUTHENTICATED'):module.main()
  self.assertEqual(calls,['auth'])

if __name__=='__main__':unittest.main()
