#!/usr/bin/env python3
"""Synthetic signer tests ONLY; synthetic keys never attest real Native8."""
from __future__ import annotations
import base64, hashlib, importlib.util, json, pathlib, tempfile, unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

MODULE = pathlib.Path(__file__).with_name("render4427_preimport_signed_closure_20261026.py")
spec = importlib.util.spec_from_file_location("research_signed_closure", MODULE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class SyntheticSignedClosure(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.src = self.root / "legacy.py"
        self.src.write_bytes(b"OLD=1\n")
        self.out = self.root / "research" / "output"
        self.priv = Ed25519PrivateKey.generate()  # TEST KEY ONLY, NEVER A TRUST ROOT
        self.pub = self.priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.pin = hashlib.sha256(self.pub).hexdigest()
        self.payload = {
            "schema": "RENDER4427_PREIMPORT_RESEARCH_V1", "subject": "RENDER4427_SYNTHETIC",
            "output_path": str(self.out),
            "components": {"legacy": {"path": str(self.src), "sha256": hashlib.sha256(self.src.read_bytes()).hexdigest()}},
            "literal_transforms": [{"name": "patch", "source_role": "legacy", "old": "OLD=1",
                                    "new": "NEW=1", "expected_sha256": hashlib.sha256(b"NEW=1\n").hexdigest()}]
        }
    def verify(self, payload=None, **kwargs):
        b = m._canonical(self.payload if payload is None else payload)
        opts = {"manifest_bytes": b, "signature_b64": base64.b64encode(self.priv.sign(b)).decode(),
                "trust_public_key_raw": self.pub, "independent_key_sha256": self.pin,
                "expected_subject": "RENDER4427_SYNTHETIC", "expected_roles": frozenset({"legacy"}),
                "allowed_output_parent": str(self.root)}
        opts.update(kwargs)
        return m.verify_research_closure(**opts)
    def reject(self, code, payload=None, **kwargs):
        with self.assertRaises(m.ClosureRejected) as e:
            self.verify(payload, **kwargs)
        self.assertEqual(str(e.exception), code)
    def test_good_but_never_authorizes(self):
        v = self.verify()
        self.assertEqual(v["status"], "PARTIAL_SIGNED_SOURCE_PIN_RESEARCH_ONLY")
        self.assertFalse(v["order_authorized"])
        self.assertFalse(v["complete_dynamic_import_closure_authenticated"])
    def test_missing_external_pin(self):
        self.reject("REJECT_NO_INDEPENDENT_KEY_PIN", independent_key_sha256="")
    def test_wrong_external_pin(self):
        self.reject("REJECT_TRUST_KEY_NOT_INDEPENDENTLY_PINNED", independent_key_sha256="0"*64)
    def test_wrong_signature(self):
        self.reject("REJECT_MANIFEST_SIGNATURE_INVALID", signature_b64=base64.b64encode(b"0"*64).decode())
    def test_missing_component(self):
        self.reject("REJECT_INCOMPLETE_OR_EXTRA_COMPONENT_SET", expected_roles=frozenset({"legacy", "brain"}))
    def test_drift(self):
        self.src.write_bytes(b"OLD=2\n")
        self.reject("REJECT_COMPONENT_BYTES_DRIFT:legacy")
    def test_output_escape(self):
        p = dict(self.payload, output_path=str(self.root.parent/"elsewhere"))
        self.reject("REJECT_OUTPUT_OUTSIDE_INDEPENDENT_POLICY", p)
    def test_missing_transform(self):
        p = dict(self.payload, literal_transforms=[])
        self.reject("REJECT_DYNAMIC_TRANSFORM_CLOSURE_UNATTESTED", p)
    def test_duplicate_hook(self):
        self.src.write_bytes(b"OLD=1\nOLD=1\n")
        p = json.loads(json.dumps(self.payload))
        p["components"]["legacy"]["sha256"] = hashlib.sha256(self.src.read_bytes()).hexdigest()
        self.reject("REJECT_TRANSFORM_HOOK_NOT_UNIQUE", p)
    def test_wrong_transformed_hash(self):
        p = json.loads(json.dumps(self.payload))
        p["literal_transforms"][0]["expected_sha256"] = "0"*64
        self.reject("REJECT_TRANSFORMED_BYTES_DRIFT", p)
    def test_wrong_subject(self):
        self.reject("REJECT_MANIFEST_SCOPE", expected_subject="NATIVE8_REAL")
    def test_tampered_signed_manifest(self):
        raw = m._canonical(self.payload)
        tampered = raw.replace(b"RENDER4427_SYNTHETIC", b"RENDER4427_DIFFERENT")
        sig = base64.b64encode(self.priv.sign(raw)).decode()
        self.reject("REJECT_MANIFEST_SIGNATURE_INVALID", manifest_bytes=tampered, signature_b64=sig)

if __name__ == "__main__":
    unittest.main(verbosity=1)
