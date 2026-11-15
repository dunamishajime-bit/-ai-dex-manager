import unittest
from copy import deepcopy
from unittest.mock import patch
from types import SimpleNamespace
import json
import disdex_v4_authorized_timeout_resume as resume
from disdex_v4_authorized_timeout_resume import validate_resume_binding,protect_resume_failure,shared_readonly_audit


class ResumeBindingTests(unittest.TestCase):
    def setUp(self):
        self.sha='a'*40;self.old='b'*40;self.plan='c'*64
        self.args=dict(sha=self.sha,approved_plan_hash=self.plan,approved_plan=dict(sourceSha=self.sha,oldSha=self.old,planSha256=self.plan),
            journal=dict(phase='RECOVERY_REQUIRED_PROTECTED',scope='V12_V4',newSha=self.sha,oldSha=self.old,reason='V4_REAL_DECISION_CYCLE_TIMEOUT',candidateOwnershipRetained=True,oldSourceRestartAuthorized=False,requiresFreshVenueAndDurableCompatibility=True),
            pins=dict(V12_V4=self.sha,HYPE_TREND_LONG='d'*40),desired=dict(sourceSha=self.sha,scope='V12_V4',ordersEnabled=True,runners=dict(V12_V4=self.sha,HYPE_TREND_LONG='d'*40)),
            unit_bytes=('/home/deploy/disdex-trading/releases/'+self.sha+' disdex_v4_canonical_prestart.py --daemon').encode())
    def test_exact_approved_same_source_timeout_resume(self):self.assertEqual(validate_resume_binding(**self.args),self.old)
    def test_readonly_refresh_failure_still_requires_exact_same_protected_approval(self):
        for reason in ['DYNAMIC_EVIDENCE_REFRESH_FAILED','GENUINE_PENDING_MAINTENANCE_FAILED']:
            a=deepcopy(self.args);a['journal']['reason']=reason
            self.assertEqual(validate_resume_binding(**a),self.old)
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

    def test_audit_exception_restores_exclusive_lock_before_cleanup(self):
        actions=[]
        class Flock:
            LOCK_SH=1;LOCK_EX=2
            @staticmethod
            def flock(fd,mode):actions.append(mode)
        with self.assertRaisesRegex(RuntimeError,'audit failed'):
            with shared_readonly_audit(123,Flock):raise RuntimeError('audit failed')
        self.assertEqual(actions,[Flock.LOCK_SH,Flock.LOCK_EX])

    def test_real_shared_audit_admits_readonly_maintenance_and_blocks_other_deployments(self):
        try:import fcntl
        except ImportError:self.skipTest('POSIX deployment mutex integration runs on VPS')
        import tempfile,os
        with tempfile.TemporaryDirectory()as directory:
            path=os.path.join(directory,'execution.lock');a=os.open(path,os.O_CREAT|os.O_RDWR,0o600);b=os.open(path,os.O_RDWR);c=os.open(path,os.O_RDWR)
            try:
                fcntl.flock(a,fcntl.LOCK_EX)
                with self.assertRaises(BlockingIOError):fcntl.flock(b,fcntl.LOCK_SH|fcntl.LOCK_NB)
                with shared_readonly_audit(a):
                    fcntl.flock(b,fcntl.LOCK_SH|fcntl.LOCK_NB)
                    with self.assertRaises(BlockingIOError):fcntl.flock(c,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    fcntl.flock(b,fcntl.LOCK_UN)
                with self.assertRaises(BlockingIOError):fcntl.flock(b,fcntl.LOCK_SH|fcntl.LOCK_NB)
            finally:os.close(c);os.close(b);os.close(a)

    def test_real_service_busy_retries_without_writing_a_timestamp(self):
        event=json.dumps({'_SYSTEMD_INVOCATION_ID':'invocation','MESSAGE':json.dumps({'status':'PENDING_MAINTENANCE_FAIL_CLOSED','reason':'PENDING_MAINTENANCE_CHILD_REJECTED:PENDING_RECONCILE_ACCOUNT_LOCK_BUSY'})})
        with patch.object(resume.subprocess,'run',side_effect=[SimpleNamespace(returncode=1),SimpleNamespace(returncode=0)])as run,patch.object(resume.subprocess,'check_output',side_effect=['invocation',event]),patch.object(resume.time,'sleep')as sleep,patch.object(resume.time,'time',return_value=1000),patch.object(resume.Path,'read_text',return_value='{"updatedAt":999000}'):
            resume.refresh_committed_pending_maintenance()
        self.assertEqual(run.call_count,2);sleep.assert_called_once_with(2)

    def test_unknown_service_failure_does_not_bypass_or_retry_a_failed_proof(self):
        event=json.dumps({'_SYSTEMD_INVOCATION_ID':'invocation','MESSAGE':json.dumps({'status':'PENDING_MAINTENANCE_FAIL_CLOSED','reason':'UNACCOUNTED_POSITION'})})
        with patch.object(resume.subprocess,'run',return_value=SimpleNamespace(returncode=1))as run,patch.object(resume.subprocess,'check_output',side_effect=['invocation',event]),patch.object(resume.time,'sleep')as sleep:
            with self.assertRaisesRegex(ValueError,'MAINTENANCE_FAILED'):resume.refresh_committed_pending_maintenance()
        self.assertEqual(run.call_count,1);sleep.assert_not_called()


if __name__=='__main__':unittest.main()
