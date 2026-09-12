import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "ops" / "root" / "disdex-v12-kill-switch-auto-repair"


class AsterUpstreamAutoRepairContractTests(unittest.TestCase):
    def test_specialized_aster_upstream_branch_is_staged_and_does_not_resume_all_runners(self):
        source = SOURCE.read_text(encoding="utf-8-sig")
        self.assertIn("is_aster_upstream_shared_reason()", source)
        self.assertIn("action=ASTER_UPSTREAM", source)
        self.assertIn("scripts/disdex-aster-upstream-live-recovery.ts --verify-only", source)
        self.assertIn("scripts/disdex-aster-upstream-live-recovery.ts --apply", source)
        self.assertIn("I_ACK_ASTER_UPSTREAM_RECOVERY_AFTER_3X_READONLY_FLAT", source)
        self.assertIn("V12_AUTO_REPAIR_ASTER_UPSTREAM_READY_FOR_STAGED_RESUME", source)
        self.assertIn("liveResumeAllowed\":false", source)

        aster_branch = source.index('if [[ "$action" == ASTER_UPSTREAM ]]')
        quiesce = source.index("quiesce_composition ||")
        self.assertLess(aster_branch, quiesce, "Aster upstream path must exit before global quiesce/resume path")

    def test_selftest_covers_reset_and_429_but_not_daily_loss(self):
        source = SOURCE.read_text(encoding="utf-8-sig")
        self.assertIn("V52 fatal tick error: <urlopen error [Errno 104] Connection reset by peer>", source)
        self.assertIn("V52 upstream state unavailable: Aster HTTP 429", source)
        self.assertIn("V52 upstream state unavailable: Aster HTTP 418 IP banned", source)
        self.assertIn("! is_aster_upstream_shared_reason 'daily loss latch'", source)


    def test_local_reference_stale_quote_uses_only_staged_recovery(self):
        source = SOURCE.read_text(encoding="utf-8-sig")
        self.assertIn("is_reference_stale_shared_reason()", source)
        self.assertIn('is_reference_stale_shared_reason "$KILL_REASON"', source)
        self.assertIn("http://127.0.0.1:8797/quote?symbol=", source)
        self.assertIn("stale_quote", source)
        self.assertIn("! is_reference_stale_shared_reason 'V52 fatal tick error: HTTP 503 https://example.com/quote?symbol=META: stale_quote'", source)


class AutoRepairReleasePinTests(unittest.TestCase):
    def test_pengu_is_resolved_by_exact_current_release_sha(self):
        source = SOURCE.read_text(encoding="utf-8-sig")
        self.assertIn('PENGU_UNIT="disdex-pengu-dual-ls-v2@$RELEASE_SHA.service"', source)
        self.assertNotIn("active_unit_from_list 'disdex-pengu-dual-ls-v2*'", source)

    def test_auto_repair_pins_q102_and_all_current_units_before_recovery(self):
        source = SOURCE.read_text(encoding="utf-8-sig")
        self.assertIn('Q102_UNIT="disdex-quality102-causal-v1@$RELEASE_SHA.service"', source)
        self.assertIn('V52_EXPECTED_UNIT="disdex-v52-aster-only@$RELEASE_SHA.service"', source)
        self.assertIn('[[ "$V52_UNIT" == "$V52_EXPECTED_UNIT" ]]', source)
        self.assertIn('for unit in "$V12_UNIT" "$PENGU_UNIT" "$Q102_UNIT" "$V52_UNIT" "$MARGIN_UNIT" "$RISK_UNIT"', source)

if __name__ == "__main__":
    unittest.main()
