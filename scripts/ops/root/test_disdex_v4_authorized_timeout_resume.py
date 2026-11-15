import unittest
from copy import deepcopy
from disdex_v4_authorized_timeout_resume import validate_resume_binding,protect_resume_failure


class ResumeBindingTests(unittest.TestCase):
    def setUp(self):
        self.sha='a'*40;self.old='b'*40;self.plan='c'*64
        self.args=dict(sha=self.sha,approved_plan_hash=self.plan,approved_plan=dict(sourceSha=self.sha,oldSha=self.old,planSha256=self.plan),
            journal=dict(phase='RECOVERY_REQUIRED_PROTECTED',scope='V12_V4',newSha=self.sha,oldSha=self.old,reason='V4_REAL_DECISION_CYCLE_TIMEOUT',candidateOwnershipRetained=True,oldSourceRestartAuthorized=False,requiresFreshVenueAndDurableCompatibility=True),
            pins=dict(V12_V4=self.sha,HYPE_TREND_LONG='d'*40),desired=dict(sourceSha=self.sha,scope='V12_V4',ordersEnabled=True,runners=dict(V12_V4=self.sha,HYPE_TREND_LONG='d'*40)),
            unit_bytes=('/home/deploy/disdex-trading/releases/'+self.sha+' disdex_v4_canonical_prestart.py --daemon').encode())
    def test_exact_approved_same_source_timeout_resume(self):self.assertEqual(validate_resume_binding(**self.args),self.old)
    def test_different_plan_source_scope_or_peer_pin_reject(self):
        for mutate in [lambda a:a.update(approved_plan_hash='e'*64),lambda a:a['approved_plan'].update(sourceSha='e'*40),lambda a:a['desired'].update(scope='ALL'),lambda a:a['desired']['runners'].update(HYPE_TREND_LONG='e'*40)]:
            a=deepcopy(self.args);mutate(a)
            with self.assertRaises(ValueError):validate_resume_binding(**a)
    def test_other_failures_or_old_restart_permission_reject(self):
        for changes in [dict(reason='EXECUTION_UNKNOWN'),dict(candidateOwnershipRetained=False),dict(oldSourceRestartAuthorized=True),dict(phase='COMMITTED')]:
            a=deepcopy(self.args);a['journal'].update(changes)
            with self.assertRaises(ValueError):validate_resume_binding(**a)
    def test_inexact_executable_or_monitor_unit_reject(self):
        for raw in [b'wrong --daemon',self.args['unit_bytes']+b' --monitor-only']:
            with self.assertRaises(ValueError):validate_resume_binding(**{**self.args,'unit_bytes':raw})

    def test_reload_failure_before_start_remasks_an_inactive_restored_unit(self):
        actions=[];rows=[]
        class Fake:
            masked=False
            def is_active(self,u):return False
            def is_enabled(self,u):return False
            def main_pid(self,u):return 0
            def is_masked(self,u):return self.masked
            def mask(self,u):actions.append('mask');self.masked=True
        protect_resume_failure(Fake(),'unit',{},'daemon-reload failed',rows.append)
        self.assertEqual(actions,['mask']);self.assertEqual(rows[0]['phase'],'RECOVERY_REQUIRED_PROTECTED')

    def test_disable_failure_still_attempts_mask_and_records_isolation(self):
        actions=[];rows=[]
        class Fake:
            masked=False
            def is_active(self,u):return False
            def is_enabled(self,u):return True
            def main_pid(self,u):return 0
            def is_masked(self,u):return self.masked
            def disable(self,u):actions.append('disable');raise RuntimeError('disable failed')
            def mask(self,u):actions.append('mask');self.masked=True
        protect_resume_failure(Fake(),'unit',{},'startup failed',rows.append)
        self.assertEqual(actions,['disable','mask']);self.assertEqual(rows[0]['isolationErrors'],['disable:RuntimeError'])

    def test_running_process_isolation_failure_is_never_reported_protected(self):
        rows=[]
        class Fake:
            def is_active(self,u):return True
            def is_enabled(self,u):return False
            def main_pid(self,u):return 123
            def is_masked(self,u):return False
            def stop(self,u):raise RuntimeError('stop failed')
            def mask(self,u):raise RuntimeError('still running')
        with self.assertRaisesRegex(RuntimeError,'ISOLATION_INCOMPLETE'):protect_resume_failure(Fake(),'unit',{},'failure',rows.append)
        self.assertEqual(rows[0]['phase'],'RECOVERY_ISOLATION_FAILED')


if __name__=='__main__':unittest.main()
