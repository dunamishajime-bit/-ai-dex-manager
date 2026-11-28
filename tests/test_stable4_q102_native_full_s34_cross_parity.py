"""Fail-closed cross-proof: Q102 full-source ready-clock S34 29/23 native parity."""
from __future__ import annotations
import copy
from hashlib import sha256
import json
from pathlib import Path
import unittest
from scripts.research.stable4_q102_native_full_selector_s34_cross_evidence import analyze,verify,ROOT

EVIDENCE=ROOT/'docs/research/STABLE4_Q102_FULL_SOURCE_S34_CROSS_PARITY_20261128.json'
PIN='bbb086306e9e1293bb0035e607adb73c179566baf3acc60d6c0ad705d6b6f4e9'

class NativeQ102S34SourceParity(unittest.TestCase):
    def read(self):
        b=EVIDENCE.read_bytes()
        self.assertEqual(sha256(b).hexdigest(),PIN)
        return json.loads(b)
    def test_full_source_96_clocks_29_selected_23_vetoed(self):
        document=self.read()
        verify(document)
        self.assertEqual(document,analyze())
        self.assertEqual(document['summary']['nativeS34SignalsExact'],29)
        self.assertEqual(document['summary']['nativeS34ImprovementGateRejectedExact'],23)
        self.assertEqual(document['summary']['readyH1DecisionClocks'],942)
    def test_reject_fake_annual_native_or_order_certificate(self):
        for field in ('orderAuthority','fullQ102AnnualReplay','fullSevenRunnerWalletReplay','productionEligible'):
            doc=copy.deepcopy(self.read());doc[field]=True
            with self.subTest(field=field),self.assertRaises(ValueError):verify(doc)
    def test_reject_changed_source_pin_or_native_classification(self):
        doc=self.read();doc['sourceArtifactPins'][next(iter(doc['sourceArtifactPins']))]='0'*64
        with self.assertRaises(ValueError):verify(doc)
        doc=self.read();doc['checks'][0]['category']='NATIVE_S34_ENTRY_EXACT_RANK'
        with self.assertRaises(ValueError):verify(doc)
        doc=self.read();doc['checks'][1]['modelClaimsActualFill']=True
        with self.assertRaises(ValueError):verify(doc)

if __name__=='__main__':unittest.main()
