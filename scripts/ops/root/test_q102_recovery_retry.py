import unittest
from importlib.util import spec_from_file_location,module_from_spec
from pathlib import Path
spec=spec_from_file_location('retry',Path(__file__).with_name('disdex-q102-pending-recovery-retry.py'));m=module_from_spec(spec);spec.loader.exec_module(m)
def msg(s):return '{"status":"Q102_PENDING_RECOVERY_FAIL_CLOSED","message":"'+s+'"}'
class Retry(unittest.TestCase):
 def test_lock(self):self.assertTrue(m.retryable(msg('Q102_PENDING_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE')))
 def test_rate(self):self.assertTrue(m.retryable(msg('ASTER_GLOBAL_RATE_BUDGET_SATURATED:1000')))
 def test_permissions_fail(self):self.assertFalse(m.retryable(msg('EACCES')))
 def test_exposure_fail(self):self.assertFalse(m.retryable(msg('Q102_RECOVERY_EXPOSURE_EXISTS')))
 def test_unknown_fail(self):self.assertFalse(m.retryable('non-json error'))
 def test_success_not_retry(self):self.assertFalse(m.retryable('{"status":"NO_EXPOSURE_PENDING_RECOVERED"}'))
if __name__=='__main__':unittest.main()
