"""V4-first root recovery; isolated facts only, no venue mutation."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
import disdex_v4_priority_live as m

NOW=2_000_000_000_000
SHA='a'*40
OLD='b'*40

def facts():
    return dict(candidateSha=SHA,oldStateSha=OLD,monitorOnly=True,
        positions=0,openOrders=0,activePending=0,signedVerifiedAt=NOW-1000,
        risk=dict(maximumLossPct=7.5,tripped=False,sourceComplete=True,updatedAt=NOW-1000,utcDay='2033-05-18'),
        margin=dict(stage='HEALTHY',ordersAllowed=True,checkedAt=NOW-1000),
        kill=dict(active=True,action='HOLD_PROTECTED',operator='disdex-v52-aster-only',recoverable=True,
            reason='V52 upstream state unavailable: QUALITY102_STATE_MISMATCH:runtimeCommitSha'),
        v52Sha=m.FIXED_V52_SHA,q102Sha=m.Q102_SHA,allPeersAttested=True,
        peerPermissionsUnchanged=True,economicsIdentical=True,time37PriorApprovalVerified=True,
        staticEvidence=dict(candidateSha=SHA,routeCount=41,sourceParity=True,testPasses=37,typecheck=True),
        durableHash='d'*64,killHash='e'*64)

class PriorityFactsTest(unittest.TestCase):
    def test_economic_source_allows_only_line_endings_not_changed_logic(self):
        self.assertTrue(m.economic_source_equal(b'const stop=0.08;\n',b'const stop=0.08;\r\n'))
        self.assertFalse(m.economic_source_equal(b'const stop=0.08;\n',b'const stop=0.09;\r\n'))
    def test_only_the_exact_repaired_obsolete_hold_is_eligible(self):
        self.assertIs(m.validate_priority_evidence(facts(),NOW),True)

    def test_unknown_hold_and_changed_peer_permission_are_rejected(self):
        for key,value in [('reason','OTHER_REASON'),('operator','other'),('recoverable',False),('action','FLATTEN_MANAGED')]:
            f=facts();f['kill'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_priority_evidence(f,NOW)
        for key,value in [('peerPermissionsUnchanged',False),('allPeersAttested',False),
            ('economicsIdentical',False),('time37PriorApprovalVerified',False),('monitorOnly',False),
            ('v52Sha',OLD),('q102Sha',OLD),('positions',1),('openOrders',1),('activePending',1)]:
            f=facts();f[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_priority_evidence(f,NOW)

    def test_stale_future_nonfinite_and_weakened_risk_fail_closed(self):
        for group,key,value in [('risk','maximumLossPct',8),('risk','tripped',True),
            ('risk','sourceComplete',False),('risk','updatedAt',NOW-120001),
            ('risk','updatedAt',NOW+1),('risk','utcDay','2000-01-01'),
            ('margin','checkedAt',NOW-360001),('margin','ordersAllowed',False)]:
            f=facts();f[group][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_priority_evidence(f,NOW)
        for key,value in [('positions',float('nan')),('openOrders',False),('signedVerifiedAt',NOW-30001),
                          ('signedVerifiedAt',NOW+1)]:
            f=facts();f[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.validate_priority_evidence(f,NOW)

class FakeOperations:
    def __init__(self,fail=None):self.calls=[];self.fail=fail
    def stage(self,name):
        self.calls.append(name)
        if self.fail==name:raise RuntimeError(name)
    def preflight(self):self.stage('preflight');return {'planSha256':'a'*64}
    def authorize(self,plan):self.stage('authorize');return {'ordersEnabled':True}
    def prepare(self,grant):self.stage('prepare')
    def activate(self):
        self.stage('activate')
        return dict(status='V4_LIVE_CUTOVER_VERIFIED',auditCycles=[
            {'decisionCycle':{'tickCompletedAt':t}} for t in [1,2,3]])
    def protect_on_failure(self):self.stage('protect')

class PrioritySequenceTest(unittest.TestCase):
    def test_authority_precedes_any_preparation_and_full_executor_owns_audit(self):
        op=FakeOperations();r=m.execute_priority(op)
        self.assertEqual(r['status'],'V4_LIVE_CUTOVER_VERIFIED')
        self.assertEqual(op.calls,['preflight','authorize','prepare','activate'])

    def test_unauthorized_preflight_never_changes_live(self):
        for phase in ['preflight','authorize']:
            op=FakeOperations(phase)
            with self.assertRaises(RuntimeError):m.execute_priority(op)
            self.assertNotIn('prepare',op.calls);self.assertNotIn('protect',op.calls)

    def test_mutation_failure_reinstates_protection_without_old_sha_restart(self):
        for phase in ['prepare','activate']:
            op=FakeOperations(phase)
            with self.assertRaises(RuntimeError):m.execute_priority(op)
            self.assertEqual(op.calls[-1],'protect')

    def test_readonly_or_repeated_tick_receipt_is_never_reported_live(self):
        op=FakeOperations()
        op.activate=lambda:dict(status='V4_MONITOR_ONLY_VERIFIED',auditCycles=[])
        with self.assertRaises(ValueError):m.execute_priority(op)
        self.assertEqual(op.calls[-1],'protect')
        op=FakeOperations()
        op.activate=lambda:dict(status='V4_LIVE_CUTOVER_VERIFIED',auditCycles=[
            {'decisionCycle':{'tickCompletedAt':1}} for _ in range(3)])
        with self.assertRaises(ValueError):m.execute_priority(op)

@unittest.skipIf(sys.platform=='win32','POSIX owner-preserving restoration')
class ProtectionRestoreTest(unittest.TestCase):
    def test_a_killed_child_before_receipt_is_still_recovered_and_new_trip_is_preserved(self):
        import tempfile,json
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(prefix='disdex-v4-priority-test-') as folder:
            root=Path(folder);path=root/'kill-switch.json'
            op=m.ProductionOperations();op.plan_hash='c'*64;op.authorization={'nonce':'b'*32}
            op.original_kill=json.dumps({'active':True,'action':'HOLD_PROTECTED','reason':m.REASON}).encode()
            cleared=dict(active=False,action='HOLD_PROTECTED',reason=m.REASON,clearedBy='codex-ssh',
                recoveryPlanSha256=op.plan_hash,recoveryNonceDigest=m.digest(b'b'*32))
            path.write_text(json.dumps(cleared));path.chmod(0o600)
            with patch.object(m,'SHARED',root):op.protect_on_failure()
            self.assertEqual(path.read_bytes(),op.original_kill)
            new_trip=json.dumps(dict(cleared,active=True,reason='NEW_SAFETY_TRIP')).encode();path.write_bytes(new_trip)
            with patch.object(m,'SHARED',root):op.protect_on_failure()
            self.assertEqual(path.read_bytes(),new_trip)

    def test_restore_is_protective_owner_preserving_and_compare_and_swap_only(self):
        import tempfile,json
        with tempfile.TemporaryDirectory(prefix='disdex-v4-priority-test-') as folder:
            path=Path(folder)/'kill.json';cleared=b'{"active":false}\n';path.write_bytes(cleared);path.chmod(0o600)
            before=path.stat();old=b'{"active":true,"action":"HOLD_PROTECTED","reason":"old"}\n'
            m.restore_owned_hold(path,m.digest(cleared),old)
            self.assertEqual(path.read_bytes(),old)
            self.assertEqual((path.stat().st_uid,path.stat().st_gid,path.stat().st_mode&0o777),
                (before.st_uid,before.st_gid,0o600))
            with self.assertRaises(ValueError):m.restore_owned_hold(path,m.digest(cleared),old)
            self.assertEqual(path.read_bytes(),old)

if __name__=='__main__':unittest.main()
