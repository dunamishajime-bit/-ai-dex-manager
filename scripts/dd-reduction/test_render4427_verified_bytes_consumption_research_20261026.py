#!/usr/bin/env python3
"""Synthetic-only regression tests, including mutable-file TOCTOU demonstration."""
import base64
import dataclasses
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from render4427_signed_composed_patch_research_20261026 import (
    verify_signed_composed_plan_research_only, ComposedPlanRejected,
)
from render4427_verified_bytes_consumption_research_20261026 import (
    bind_verified_bytes_research_only, VerifiedResearchBytes,
)


def h(x): return hashlib.sha256(x).hexdigest()


def fixture():
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes(serialization.Encoding.Raw,
                                         serialization.PublicFormat.Raw)
    src = b'A=1\nB=1\n'
    s1 = src.replace(b'A=1', b'A=2')
    s2 = s1.replace(b'B=1', b'B=2')
    payload = {"schema":"RENDER4427_COMPOSED_PATCH_RESEARCH_V1",
               "subject":"research.synthetic.module",
               "source_sha256":h(src),
               "steps":[{"name":"first","old":"A=1","new":"A=2","stage_sha256":h(s1)},
                        {"name":"second","old":"B=1","new":"B=2","stage_sha256":h(s2)}],
               "final_sha256":h(s2)}
    mb=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
    args={"manifest_bytes":mb,"signature_b64":base64.b64encode(priv.sign(mb)).decode(),
          "public_key_raw":pub,"independent_public_key_sha256":h(pub),
          "independent_final_sha256":h(s2),"source_bytes":src,
          "expected_subject":"research.synthetic.module"}
    return args,s2


class SnapshotTests(unittest.TestCase):
    def setUp(self): self.args,self.final=fixture()

    def test_signed_bytes_are_returned(self):
        v=bind_verified_bytes_research_only(**self.args)
        self.assertIsInstance(v,VerifiedResearchBytes)
        self.assertEqual(v.payload,self.final)
        self.assertEqual(v.final_sha256,h(self.final))

    def test_metadata_only_prior_verifier(self):
        old=verify_signed_composed_plan_research_only(**self.args)
        self.assertNotIn('payload',old)
        self.assertNotIn('final_source_bytes',old)

    def test_file_swap_after_verification_is_not_bound(self):
        # No untrusted code executed; only a synthetic file in authorized scratch.
        scratch=os.environ.get('RENDER4427_TEST_SCRATCH')
        if not scratch or not Path(scratch).is_dir():
            self.skipTest('Authorized scratch root not supplied')
        with tempfile.TemporaryDirectory(dir=scratch) as d:
            p=Path(d)/'mutable_synthetic.py'
            p.write_bytes(self.args['source_bytes'])
            old=verify_signed_composed_plan_research_only(**self.args)
            sealed=bind_verified_bytes_research_only(**self.args)
            p.write_bytes(b'UNSIGNED=1\n')
            self.assertEqual(old['final_source_sha256'],sealed.final_sha256)
            self.assertNotEqual(h(p.read_bytes()),sealed.input_sha256)
            self.assertEqual(sealed.payload,self.final)

    def test_mutated_source_fails_new_verification(self):
        bad={**self.args,'source_bytes':b'UNSIGNED=1\n'}
        with self.assertRaises(ComposedPlanRejected):bind_verified_bytes_research_only(**bad)

    def test_signature_drift_fails(self):
        bad={**self.args,'signature_b64':base64.b64encode(b'0'*64).decode()}
        with self.assertRaises(ComposedPlanRejected):bind_verified_bytes_research_only(**bad)

    def test_wrong_final_pin_fails(self):
        bad={**self.args,'independent_final_sha256':h(b'wrong')}
        with self.assertRaises(ComposedPlanRejected):bind_verified_bytes_research_only(**bad)

    def test_wrong_public_key_pin_fails(self):
        bad={**self.args,'independent_public_key_sha256':h(b'wrong')}
        with self.assertRaises(ComposedPlanRejected):bind_verified_bytes_research_only(**bad)

    def test_signed_stage_drift_fails(self):
        manifest=json.loads(self.args['manifest_bytes'])
        manifest['steps'][0]['stage_sha256']=h(b'wrong')
        mb=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
        bad={**self.args,'manifest_bytes':mb}
        with self.assertRaises(ComposedPlanRejected):bind_verified_bytes_research_only(**bad)

    def test_frozen_dataclass(self):
        v=bind_verified_bytes_research_only(**self.args)
        with self.assertRaises(dataclasses.FrozenInstanceError):v.payload=b'bad'

    def test_never_authorizes_order(self):
        v=bind_verified_bytes_research_only(**self.args)
        self.assertIs(v.order_authorized,False)
        self.assertIs(v.native_allocator_authorized,False)

    def test_multiple_stages_preserved(self):
        self.assertEqual(bind_verified_bytes_research_only(**self.args).stages_verified,2)

    def test_final_hash_matches_consumable_bytes(self):
        v=bind_verified_bytes_research_only(**self.args)
        self.assertEqual(h(v.payload),v.final_sha256)


if __name__=='__main__':unittest.main()
