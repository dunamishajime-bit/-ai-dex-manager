import unittest
from pathlib import Path
import prepare_stable4_root_sources as prepare

REF=Path(__file__).resolve().parents[3]/'.tmp/stable4-root-reference-20261115'
@unittest.skipUnless(REF.is_dir(),'captured installed public source unavailable')
class PrepareTests(unittest.TestCase):
 def test_produces_separate_review_source_only_from_exact_preimages(self):
  names=['disdex_hype_scoped_root_cutover.py','disdex_unified_root_gate.py','disdex_v4_venue_witness.py']
  captured={name:(REF/name).read_bytes() for name in names};olds={key:'a'*40 for key in prepare.ROLES}
  result=prepare.prepare(captured,olds,'b'*40)
  self.assertIn('disdex_stable4_h48_scoped_root_cutover.py',result)
  self.assertIn('h48TimeOnly=build_h48_manifest_binding',result['disdex_stable4_h48_scoped_root_cutover.py'].decode())
  self.assertIn('attest_composite_owner',result['disdex_v4_venue_witness.py'].decode())
  self.assertIn('disdex_pending_composite_upgrade.py',result)
  self.assertIn('disdex_pending_composite_recover.py',result)
  self.assertEqual(result['disdex_stable4_q102_bootstrap_seal.py'],Path(prepare.__file__).with_name('disdex_stable4_q102_bootstrap_seal.py').read_bytes())
  gate=result['disdex_unified_root_gate.py'].decode()
  for module in ('disdex_stable4_flat_peer_cutover','disdex_stable4_h48_scoped_root_cutover','disdex_pending_composite_upgrade'):
   self.assertEqual(gate.count(module),2)
  with self.assertRaises(ValueError):prepare.prepare({**captured,names[0]:captured[names[0]]+b'\n'},olds,'b'*40)
  with self.assertRaises(ValueError):prepare.prepare(captured,{'V12_V4':'a'*40},'b'*40)
if __name__=='__main__':unittest.main()
