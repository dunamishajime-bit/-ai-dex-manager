import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / 'scripts/ops/root/disdex-fet-preemption-readiness-guard.py'
SHA = 'b' * 40


class FetReadinessGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.artifact = Path(self.tmp.name) / 'activation.json'
        self.approval = dict(approvedSha=SHA, ordersEnabled=True,
            operatorAcknowledgement='I_ACK_REAL_MONEY_LIVE_ACTIVATION',
            approvedRunners=['V52', 'FET_BRK48_RESIDUAL'], fetCorePreemptionReady=True)
        self.artifact.write_text(json.dumps(self.approval))

    def run_guard(self, mode, flag='true', runtime=SHA):
        self.assertTrue(GUARD.exists(), 'FET readiness startup guard is missing')
        env = dict(os.environ, FET_BRK48_CORE_PREEMPTION_READY=flag,
                   DISDEX_RUNTIME_COMMIT_SHA=runtime)
        return subprocess.run(['python3', str(GUARD), mode, '--sha', SHA,
            '--activation-path', str(self.artifact)], env=env, text=True, capture_output=True)

    def test_prestart_accepts_exact_approval_and_loaded_ready(self):
        r = self.run_guard('--prestart')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(json.loads(r.stdout)['status'], 'HEALTHY')

    def test_prestart_rejects_false_before_runner_start(self):
        r = self.run_guard('--prestart', flag='false')
        self.assertEqual(r.returncode, 1)
        self.assertIn('FET_PREEMPTION_FLAG_NOT_READY', r.stdout)

    def test_prestart_rejects_missing_flag(self):
        self.assertEqual(self.run_guard('--prestart', flag='').returncode, 1)

    def test_prestart_rejects_wrong_runtime_sha(self):
        self.assertEqual(self.run_guard('--prestart', runtime='c' * 40).returncode, 1)

    def test_old_approval_cannot_activate_future_release(self):
        self.approval['approvedSha'] = 'c' * 40
        self.artifact.write_text(json.dumps(self.approval))
        r = self.run_guard('--approved-ready')
        self.assertEqual(r.stdout.strip(), 'false')

    def test_readiness_defaults_closed_without_capability(self):
        self.approval.pop('fetCorePreemptionReady')
        self.artifact.write_text(json.dumps(self.approval))
        self.assertEqual(self.run_guard('--approved-ready').stdout.strip(), 'false')

    def test_disabled_orders_remain_closed(self):
        self.approval['ordersEnabled'] = False
        self.artifact.write_text(json.dumps(self.approval))
        self.assertEqual(self.run_guard('--prestart').returncode, 1)

    def test_malformed_artifact_fails_closed(self):
        self.artifact.write_text('{broken')
        self.assertEqual(self.run_guard('--prestart').returncode, 1)

    def test_other_runner_approval_is_not_enough(self):
        self.approval['approvedRunners'] = ['V12_X1_ALL']
        self.artifact.write_text(json.dumps(self.approval))
        self.assertEqual(self.run_guard('--prestart').returncode, 1)


if __name__ == '__main__':
    unittest.main()
