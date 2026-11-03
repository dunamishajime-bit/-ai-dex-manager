import importlib.util
from pathlib import Path
import unittest

PATH=Path(__file__).resolve().parents[1]/'scripts/ops/deploy/disdex_pending_refresh.py'

def module():
    spec=importlib.util.spec_from_file_location('pending_refresh',PATH)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

class PendingRefreshExecutorTest(unittest.TestCase):
    def test_grant_binds_root_parent_and_exact_registry_without_order_authority(self):
        m=module();g=m.build_grant('a'*40,'b'*64,1234,1000000,'c'*32)
        self.assertEqual(g['scope'],'PENDING_RECONCILE_ONLY')
        self.assertIs(g['ordersEnabled'],False)
        self.assertEqual(g['parentPid'],1234)
        self.assertEqual(g['expiresAt']-g['issuedAt'],60000)
        self.assertEqual(g['registryHash'],'b'*64)
        for values in [('x','b'*64,1234,1000000,'c'*32),('a'*40,'x',1234,1000000,'c'*32),
                       ('a'*40,'b'*64,0,1000000,'c'*32),('a'*40,'b'*64,1234,0,'c'*32)]:
            with self.assertRaises(ValueError):m.build_grant(*values)

    def test_result_rejects_nonflat_mutations_replay_and_wrong_before_hash(self):
        m=module();row=dict(status='PENDING_READONLY_RECONCILE_APPLIED',beforeHash='b'*64,
            afterHash='d'*64,verifiedAt=2000,priorUpdatedAt=1000,currentUpdatedAt=2000,
            registryEntries=34,positionCount=0,openOrderCount=0,ordersSent=0,
            cancelsSent=0,positionChangesSent=0)
        m.validate_result(row,'b'*64)
        for patch in [dict(ordersSent=1),dict(cancelsSent=1),dict(positionChangesSent=1),
                      dict(positionCount=1),dict(openOrderCount=1),dict(beforeHash='e'*64),
                      dict(currentUpdatedAt=1000),dict(priorUpdatedAt=2000),
                      dict(status='PENDING_READONLY_RECONCILE_VERIFIED')]:
            with self.assertRaises(ValueError):m.validate_result({**row,**patch},'b'*64)

    def test_executor_uses_drop_privileges_and_same_pid_loader_without_shell(self):
        source=PATH.read_text()
        self.assertIn('user=deploy.pw_uid',source)
        self.assertIn('group=deploy.pw_gid',source)
        self.assertIn('extra_groups=[]',source)
        self.assertIn("'--import'",source)
        self.assertNotIn('shell=True',source)
        self.assertIn('assert_codex_ssh_session()',source)
        self.assertIn('os.O_EXCL',source)

if __name__=='__main__':unittest.main()
