#!/usr/bin/env python3
"""Synthetic-only tests; signer keys are NOT real operator trust roots."""
from __future__ import annotations
import base64, copy, hashlib, importlib.util, json, pathlib, unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

path = pathlib.Path(__file__).with_name("render4427_signed_composed_patch_research_20261026.py")
spec = importlib.util.spec_from_file_location("composed_research", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class SignedComposedSynthetic(unittest.TestCase):
    def setUp(self):
        self.source = b"A=1\nB=1\n"
        self.key = Ed25519PrivateKey.generate()  # synthetic only
        self.pub = self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        s1 = b"A=2\nB=1\n"
        s2 = b"A=2\nB=2\n"
        self.final = m.sha(s2)
        self.manifest = {
            "schema": "RENDER4427_COMPOSED_PATCH_RESEARCH_V1",
            "subject": "RENDER4427_SYNTHETIC",
            "source_sha256": m.sha(self.source),
            "steps": [
                {"name": "first", "old": "A=1", "new": "A=2", "stage_sha256": m.sha(s1)},
                {"name": "second", "old": "B=1", "new": "B=2", "stage_sha256": m.sha(s2)},
            ],
            "final_sha256": self.final,
        }

    def verify(self, payload=None, **override):
        raw = m.canonical(self.manifest if payload is None else payload)
        opts = dict(manifest_bytes=raw,
                    signature_b64=base64.b64encode(self.key.sign(raw)).decode(),
                    public_key_raw=self.pub,
                    independent_public_key_sha256=m.sha(self.pub),
                    independent_final_sha256=self.final,
                    source_bytes=self.source,
                    expected_subject="RENDER4427_SYNTHETIC")
        opts.update(override)
        return m.verify_signed_composed_plan_research_only(**opts)

    def rejects(self, reason, payload=None, **kwargs):
        with self.assertRaises(m.ComposedPlanRejected) as cm:
            self.verify(payload, **kwargs)
        self.assertEqual(str(cm.exception), reason)

    def test_two_steps_pass_never_authorizes(self):
        r = self.verify()
        self.assertEqual(r["stages_verified"], 2)
        self.assertEqual(r["final_source_sha256"], self.final)
        self.assertFalse(r["order_authorized"])
        self.assertFalse(r["complete_dynamic_import_closure_authenticated"])

    def test_reorder_detected(self):
        p = copy.deepcopy(self.manifest)
        p["steps"].reverse()
        self.rejects("REJECT_STAGE_SHA_MISMATCH:0", p)

    def test_wrong_first_stage(self):
        p = copy.deepcopy(self.manifest)
        p["steps"][0]["stage_sha256"] = "0"*64
        self.rejects("REJECT_STAGE_SHA_MISMATCH:0", p)

    def test_wrong_final_manifest(self):
        p = copy.deepcopy(self.manifest)
        p["final_sha256"] = "0"*64
        self.rejects("REJECT_SIGNED_FINAL_SHA_MISMATCH", p)

    def test_wrong_external_final(self):
        self.rejects("REJECT_INDEPENDENT_FINAL_SHA_MISMATCH",
                     independent_final_sha256="0"*64)

    def test_wrong_external_key(self):
        self.rejects("REJECT_PUBLIC_KEY_PIN_MISMATCH",
                     independent_public_key_sha256="0"*64)

    def test_missing_external_final(self):
        self.rejects("REJECT_NO_INDEPENDENT_OPERATOR_PINS",
                     independent_final_sha256="")

    def test_wrong_signature(self):
        self.rejects("REJECT_SIGNATURE_INVALID",
                     signature_b64=base64.b64encode(b"0"*64).decode())

    def test_source_drift(self):
        self.rejects("REJECT_SOURCE_DRIFT", source_bytes=b"A=9\nB=1\n")

    def test_duplicate_old(self):
        p = copy.deepcopy(self.manifest)
        p["steps"][1]["old"] = "A=1"
        self.rejects("REJECT_STEP_NOT_UNIQUE:1", p)

    def test_duplicate_name(self):
        p = copy.deepcopy(self.manifest)
        p["steps"][1]["name"] = "first"
        self.rejects("REJECT_STEP_NAME", p)

    def test_empty_steps(self):
        p = copy.deepcopy(self.manifest)
        p["steps"] = []
        self.rejects("REJECT_STEPS_MISSING_OR_OVERSIZED", p)

    def test_bad_subject(self):
        self.rejects("REJECT_SUBJECT", expected_subject="NATIVE8_REAL")

    def test_noncanonical_manifest(self):
        raw = json.dumps(self.manifest, indent=2).encode()
        self.rejects("REJECT_MALFORMED_MANIFEST",
                     manifest_bytes=raw,
                     signature_b64=base64.b64encode(self.key.sign(raw)).decode())

if __name__ == "__main__":
    unittest.main(verbosity=1)
