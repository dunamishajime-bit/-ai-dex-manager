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
        self.assertIn("! is_aster_upstream_shared_reason 'daily loss latch'", source)


if __name__ == "__main__":
    unittest.main()
