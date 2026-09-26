import json
import tempfile
import unittest
from pathlib import Path
from importlib.util import find_spec


class RuntimeManifestTests(unittest.TestCase):
    def _manifest_path(self, payload):
        handle = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
        with handle:
            json.dump(payload, handle)
        self.addCleanup(Path(handle.name).unlink, missing_ok=True)
        return Path(handle.name)

    def test_valid_source_manifest_is_loaded_and_has_sha256_entries(self):
        self.assertIsNotNone(find_spec("research.formal_five_bt.manifest"), "manifest loader must exist")
        from research.formal_five_bt.manifest import load_manifest

        payload = {
            "runtime_sha": "e1b58060d6263a3af7ced51bec854d3e211d2f35",
            "units": ["disdex-v12-x1-all.service"],
            "files": [{"path": "lib/v12-x1-all.ts", "sha256": "a" * 64}],
            "config_allowlist": {"crypto_gross_cap": 3.0},
            "extraction_utc": "2026-09-27T00:00:00Z",
            "secrets_excluded": True,
        }
        actual = load_manifest(self._manifest_path(payload))
        self.assertEqual(actual["runtime_sha"], payload["runtime_sha"])
        self.assertEqual(len(actual["files"][0]["sha256"]), 64)

    def test_secret_like_keys_are_rejected(self):
        from research.formal_five_bt.manifest import load_manifest

        payload = {
            "runtime_sha": "e1b58060d6263a3af7ced51bec854d3e211d2f35",
            "units": [],
            "files": [],
            "config_allowlist": {"api_key": "must-not-be-here"},
            "extraction_utc": "2026-09-27T00:00:00Z",
            "secrets_excluded": True,
        }
        with self.assertRaisesRegex(ValueError, "secret"):
            load_manifest(self._manifest_path(payload))

    def test_malformed_file_digest_is_rejected(self):
        from research.formal_five_bt.manifest import load_manifest

        payload = {
            "runtime_sha": "e1b58060d6263a3af7ced51bec854d3e211d2f35",
            "units": [],
            "files": [{"path": "lib/strategy.ts", "sha256": "not-a-digest"}],
            "config_allowlist": {},
            "extraction_utc": "2026-09-27T00:00:00Z",
            "secrets_excluded": True,
        }
        with self.assertRaisesRegex(ValueError, "SHA256"):
            load_manifest(self._manifest_path(payload))

    def test_source_file_hashes_are_reproducibly_computed(self):
        from research.formal_five_bt.manifest import hash_source_files

        with tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".ts") as handle:
            handle.write(b"source parity fixture\n")
            source = Path(handle.name)
        self.addCleanup(source.unlink, missing_ok=True)
        records = hash_source_files(source.parent, [source.name])
        self.assertEqual(records, [{"path": source.name, "sha256": "d0e979af6919809b2a4562faa29fe811e531995af0453050a0782675af693794"}])

    def test_source_file_paths_cannot_escape_snapshot_root(self):
        from research.formal_five_bt.manifest import hash_source_files

        with self.assertRaisesRegex(ValueError, "escapes"):
            hash_source_files(Path.cwd(), ["../outside.ts"])


if __name__ == "__main__":
    unittest.main()
