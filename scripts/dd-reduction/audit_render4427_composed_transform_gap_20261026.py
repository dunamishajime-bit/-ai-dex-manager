#!/usr/bin/env python3
"""Synthetic reproduction of missing composed-final SHA in prior signed verifier.

Reads prior research verifier as code, runs only it with synthetic inputs.
No Native8 import, no real trust root, no order authorization.
Scratch files must live under an explicitly provided research-only directory.
"""
from __future__ import annotations
import argparse, base64, hashlib, importlib.util, json, pathlib, tempfile
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def run(scratch: pathlib.Path) -> dict:
    old = pathlib.Path(__file__).with_name("render4427_preimport_signed_closure_20261026.py")
    spec = importlib.util.spec_from_file_location("previous_signed_verifier", old)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    with tempfile.TemporaryDirectory(dir=str(scratch)) as tmp:
        p = pathlib.Path(tmp)
        src = p / "legacy.py"
        original = b"A=1\nB=1\n"
        src.write_bytes(original)
        first = original.replace(b"A=1", b"A=2", 1)
        second_alone = original.replace(b"B=1", b"B=2", 1)
        combined = first.replace(b"B=1", b"B=2", 1)
        manifest = {
            "schema": "RENDER4427_PREIMPORT_RESEARCH_V1",
            "subject": "RENDER4427_SYNTHETIC",
            "output_path": str(p / "output"),
            "components": {"legacy": {"path": str(src), "sha256": sha(original)}},
            "literal_transforms": [
                {"name": "a", "source_role": "legacy", "old": "A=1",
                 "new": "A=2", "expected_sha256": sha(first)},
                {"name": "b", "source_role": "legacy", "old": "B=1",
                 "new": "B=2", "expected_sha256": sha(second_alone)},
            ],
        }
        private = Ed25519PrivateKey.generate()  # synthetic test signer only
        public = private.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        data = mod._canonical(manifest)
        result = mod.verify_research_closure(
            manifest_bytes=data, signature_b64=base64.b64encode(private.sign(data)).decode(),
            trust_public_key_raw=public, independent_key_sha256=sha(public),
            expected_subject="RENDER4427_SYNTHETIC", expected_roles=frozenset({"legacy"}),
            allowed_output_parent=str(p))
        individual = [sha(first), sha(second_alone)]
        evidence = {
            "prior_verifier_accepted": result["literal_transforms_byte_verified"] == 2,
            "prior_verifier_status": result["status"],
            "individually_verified_transform_hashes": individual,
            "actual_sequential_final_sha256": sha(combined),
            "sequential_final_sha_signed_in_prior_manifest": sha(combined) in individual,
            "native_authorized": result["order_authorized"],
            "synthetic_only": True,
        }
        if not evidence["prior_verifier_accepted"] or evidence["sequential_final_sha_signed_in_prior_manifest"]:
            raise RuntimeError("REPRODUCTION_NOT_CONFIRMED")
        return evidence

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--scratch-dir", required=True)
    args = parser.parse_args()
    scratch = pathlib.Path(args.scratch_dir).resolve(strict=True)
    if not scratch.is_dir() or "render4427-research-only" not in scratch.parts:
        raise SystemExit("REJECT_SCRATCH_OUTSIDE_RESEARCH_ONLY")
    print(json.dumps(run(scratch), sort_keys=True, separators=(",", ":")))
