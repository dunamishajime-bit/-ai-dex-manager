import unittest

from disdex_stable4_q102_writer_readonly import assess


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

    def test_bad_source_identity_rejected(self):
        with self.assertRaisesRegex(ValueError, "SHA_INVALID"):
            assess(**{**self.base(), "expected_sha": "HEAD"})


if __name__ == "__main__":
    unittest.main()