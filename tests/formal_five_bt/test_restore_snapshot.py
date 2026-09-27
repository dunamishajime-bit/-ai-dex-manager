from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from research.formal_five_bt.restore_snapshot import restore_snapshot


class RestoreSourceTests(unittest.TestCase):
    def _make_repo(self, parent: Path):
        repo = parent / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test"], check=True)
        file = repo / "lib" / "example.ts"
        file.parent.mkdir()
        raw = b"export const answer = 42;\n"
        file.write_bytes(raw)
        subprocess.run(["git", "-C", str(repo), "add", "lib/example.ts"], check=True)
        subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixture"], check=True)
        commit = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
        return repo, commit, raw

    def _manifest(self, path: Path, commit: str, raw: bytes, override=None):
        payload = {
            "runtime_sha": "a" * 40, "verified_repository_commit": commit,
            "units": [], "files": [{"path": "lib/example.ts", "sha256": hashlib.sha256(raw).hexdigest()}],
            "config_allowlist": {}, "extraction_utc": "2026-09-27T00:00:00Z",
            "secrets_excluded": True,
        }
        if override:
            payload["files"][0].update(override)
        path.write_text(json.dumps(payload))
        return path

    def test_exact_historical_blob_restored_without_manifest_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo, commit, raw = self._make_repo(root)
            manifest = self._manifest(root / "manifest.json", commit, raw)
            original = manifest.read_bytes()
            info = restore_snapshot(repo, manifest, root / "snapshot")
            self.assertEqual(info["verified_source_files"], 1)
            self.assertEqual((root / "snapshot/lib/example.ts").read_bytes(), raw)
            self.assertEqual(manifest.read_bytes(), original)

    def test_hash_mismatch_fails_without_partial_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo, commit, raw = self._make_repo(root)
            manifest = self._manifest(root / "manifest.json", commit, raw, {"sha256": "b" * 64})
            with self.assertRaisesRegex(ValueError, "SHA256_MISMATCH"):
                restore_snapshot(repo, manifest, root / "snapshot")
            self.assertFalse((root / "snapshot").exists())

    def test_path_escape_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo, commit, raw = self._make_repo(root)
            manifest = self._manifest(root / "manifest.json", commit, raw, {"path": "../.env"})
            with self.assertRaisesRegex(ValueError, "INVALID_OR_DUPLICATE"):
                restore_snapshot(repo, manifest, root / "snapshot")

if __name__ == "__main__":
    unittest.main()
