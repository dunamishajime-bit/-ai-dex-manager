import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from disdex_stable4_q102_writer_readonly import assess, observe, inspect_legacy_state


class OldQ102ReadOnlyAuditTests(unittest.TestCase):
    def base(self):
        sha = "a" * 40
        return dict(expected_sha=sha, pinned_sha=sha, active_state="active",
                    pid=123, cwd="/home/deploy/disdex-trading/releases/" + sha,
                    mode_flags=[], new_state_exists=False)

    def test_active_old_q_without_off_is_blocked(self):
        result = assess(**self.base())
        self.assertEqual(result["status"], "BLOCKED_OLD_Q102_WRITER_EXCLUSION_UNPROVEN")
        self.assertFalse(result["writerExclusionCertified"])
        self.assertFalse(result["bootstrapInstallationAuthorized"])

    def test_even_explicit_off_does_not_prove_exclusion(self):
        result = assess(**{**self.base(), "mode_flags": ["OFF"]})
        self.assertEqual(result["status"], "OLD_OFF_FLAG_OBSERVED_WRITER_PROOF_UNVERIFIED")
        self.assertFalse(result["writerExclusionCertified"])

    def test_bad_pin_and_occupied_state_block(self):
        result = assess(**{**self.base(), "pinned_sha": "b" * 40})
        self.assertEqual(result["status"], "BLOCKED_Q102_PIN_DRIFT")
        result = assess(**{**self.base(), "new_state_exists": True})
        self.assertEqual(result["status"], "BLOCKED_Q102_BOOTSTRAP_DESTINATION_OCCUPIED")

    def test_conflicting_flags_or_wrong_source_cwd_block(self):
        for overrides in ({"mode_flags": ["OFF", "OFF"]},
                          {"mode_flags": ["LIVE"]},
                          {"cwd": "/home/deploy/disdex-trading/releases/" + "b" * 40}):
            result = assess(**{**self.base(), **overrides})
            self.assertTrue(result["status"].startswith("BLOCKED_"))
            self.assertFalse(result["bootstrapInstallationAuthorized"])

    def test_inactive_unit_not_evidence_of_global_writer_exclusion(self):
        result = assess(**{**self.base(), "active_state": "inactive",
                           "pid": 0, "cwd": None, "mode_flags": []})
        self.assertEqual(result["status"], "OLD_UNIT_INACTIVE_OTHER_WRITERS_UNVERIFIED")
        self.assertFalse(result["bootstrapInstallationAuthorized"])

    def test_dangling_bootstrap_symlink_is_treated_as_occupied(self):
        old = "a" * 40
        class FakePins:
            def read_text(self, **_):
                return '{"runners":{"QUALITY102_CAUSAL_V1":{"sha":"' + old + '"}}}'
        class DanglingTarget:
            def exists(self):
                return False
            def is_symlink(self):
                return True
        def run(*_, **__):
            class Reply:
                returncode = 0
                stdout = "ActiveState=inactive\nMainPID=0\n"
            return Reply()
        result = observe(expected_sha=old, pins=FakePins(),
                         target=DanglingTarget(), run=run)
        self.assertEqual(result["status"],
                         "BLOCKED_Q102_BOOTSTRAP_DESTINATION_OCCUPIED")
        self.assertFalse(result["bootstrapInstallationAuthorized"])

    def test_bad_source_identity_rejected(self):
        with self.assertRaisesRegex(ValueError, "SHA_INVALID"):
            assess(**{**self.base(), "expected_sha": "HEAD"})


    def test_legacy_local_state_flat_can_never_certify_exchange_or_writer(self):
        sha = "a" * 40
        now = 1800000000000
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            payload = {"runtimeCommitSha": sha, "mode": "LIVE",
                       "position": None, "pending": None, "updatedAt": now}
            raw = json.dumps(payload).encode("utf8")
            path.write_bytes(raw)
            before = hashlib.sha256(raw).hexdigest()
            proof = inspect_legacy_state(expected_sha=sha,
                                         state_path=path, now_ms=now+10)
            self.assertEqual(proof["status"],
                             "LEGACY_LOCAL_FLAT_OBSERVED_NOT_VENUE_CERTIFIED")
            self.assertTrue(proof["localFlatnessObserved"])
            self.assertTrue(proof["localStateFresh"])
            self.assertFalse(proof["signedVenueFlatnessCertified"])
            self.assertFalse(proof["writerExclusionCertified"])
            self.assertFalse(proof["bootstrapInstallationAuthorized"])
            self.assertEqual(proof["stateSha256"], before)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)

    def test_legacy_state_open_position_pending_or_stale_blocks(self):
        sha = "a" * 40
        now = 1800000000000
        baseline = {"runtimeCommitSha": sha, "mode": "LIVE",
                    "position": None, "pending": None, "updatedAt": now}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            for modified in (
                {"position": {"symbol": "TESTUSDT"}},
                {"pending": {"clientOrderId": "pending"}},
                {"updatedAt": now-300001},
                {"runtimeCommitSha": "b" * 40},
                {"mode": "OFF"},
            ):
                with self.subTest(modified=modified):
                    path.write_text(json.dumps({**baseline, **modified}))
                    proof = inspect_legacy_state(expected_sha=sha,
                                                 state_path=path, now_ms=now)
                    self.assertTrue(proof["status"].startswith("BLOCKED_"))
                    self.assertFalse(proof["bootstrapInstallationAuthorized"])
                    self.assertFalse(proof["signedVenueFlatnessCertified"])

    def test_legacy_local_state_rejects_json_duplicates_nan_and_missing_pending(self):
        sha = "a" * 40
        now = 1800000000000
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            records = [
                '{"position":null,"position":null,"pending":null}',
                '{"position":null,"pending":null,"runtimeCommitSha":NaN}',
                '{"position":null,"runtimeCommitSha":"' + sha + '"}',
            ]
            for raw in records:
                with self.subTest(raw=raw):
                    path.write_text(raw)
                    with self.assertRaisesRegex(ValueError,
                                                "DUPLICATE|NONFINITE|SCHEMA"):
                        inspect_legacy_state(expected_sha=sha,
                                             state_path=path, now_ms=now)

    def test_legacy_state_missing_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                inspect_legacy_state(expected_sha="a"*40,
                                     state_path=Path(directory)/"missing")


if __name__ == "__main__":
    unittest.main()