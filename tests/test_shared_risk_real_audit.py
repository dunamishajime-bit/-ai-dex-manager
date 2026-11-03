import sys
from pathlib import Path
import unittest
from datetime import datetime,timezone

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_shared_risk_audit import validate_shared_risk_cycle,SharedRiskAuditReader,validate_signed_flat_result
from disdex_deployment_plan import IDS

NOW=1793687169561
DAY=datetime.fromtimestamp(NOW/1000,timezone.utc).date().isoformat()
SHA='c'*40

def risk(at):
    return dict(updatedAt=at,utcDay=DAY,maximumLossPct=7.5,sourceComplete=True,tripped=False)

def peers():
    return {key:dict(sha='7'*40,pid=0 if key=='V12_V4' else 123,
             activeState='failed' if key=='V12_V4' else 'active')
            for key in IDS if key!='SHARED_CRYPTO_RISK'}

class RealRiskAuditTest(unittest.TestCase):
    def run_cycle(self,**patch):
        values=dict(before=risk(NOW-30000),after=risk(NOW-1000),now_ms=NOW,
            expected_sha=SHA,writer=dict(sha=SHA,markerSha=SHA,pid=456,
                activeState='active',cwd='/home/deploy/disdex-trading/releases/'+SHA,
                unit='disdex-shared-crypto-risk@'+SHA+'.service'),
            baseline_peers=peers(),observed_peers=peers(),
            before_kill_hash='a'*64,after_kill_hash='a'*64,
            before_pending_hash='b'*64,after_pending_hash='b'*64)
        values.update(patch);return validate_shared_risk_cycle(**values)

    def test_real_risk_tick_can_advance_while_the_unchanged_v4_baseline_is_failed(self):
        self.assertEqual(self.run_cycle()['tickCompletedAt'],NOW-1000)

    def test_same_snapshot_cannot_be_counted_twice_and_stale_future_wrong_day_fail(self):
        for after in [risk(NOW-30000),risk(NOW-120001),risk(NOW+1),
                      {**risk(NOW-1000),'utcDay':'2026-11-02'}]:
            with self.assertRaises(ValueError):self.run_cycle(after=after)

    def test_limit_source_and_daily_latch_are_not_relaxed(self):
        for patch in [dict(maximumLossPct=8),dict(maximumLossPct=None),dict(sourceComplete=False),dict(tripped=None)]:
            with self.assertRaises(ValueError):self.run_cycle(after={**risk(NOW-1000),**patch})
        with self.assertRaises(ValueError):self.run_cycle(before={**risk(NOW-30000),'tripped':True})

    def test_kill_pending_or_peer_identity_change_fails_the_scoped_audit(self):
        for patch in [dict(after_kill_hash='f'*64),dict(after_pending_hash='f'*64),
                      dict(observed_peers={}),dict(observed_peers={**peers(),'V12_V4':dict(sha=SHA,pid=22,activeState='active')})]:
            with self.assertRaises(ValueError):self.run_cycle(**patch)

    def test_writer_sha_pid_service_and_marker_must_match(self):
        for patch in [dict(sha='f'*40),dict(markerSha='f'*40),dict(pid=0),dict(activeState='inactive'),
                      dict(cwd='/tmp/fake'),dict(unit='other.service')]:
            writer=dict(sha=SHA,markerSha=SHA,pid=456,activeState='active',
                        cwd='/home/deploy/disdex-trading/releases/'+SHA,
                        unit='disdex-shared-crypto-risk@'+SHA+'.service')
            with self.assertRaises(ValueError):self.run_cycle(writer={**writer,**patch})

    def reader(self,advances=True,context_patch=None):
        state={'tick':NOW-30000,'elapsed':0,'gets':0}
        def sleep(seconds):
            state['elapsed']+=seconds
            if advances:state['tick']+=1000
        def signed():
            state['gets']+=1
            return dict(status='PENDING_READONLY_RECONCILE_VERIFIED',verifiedAt=NOW-1000,
                positionCount=0,openOrderCount=0,ordersSent=0,cancelsSent=0,positionChangesSent=0,
                beforeHash='b'*64,afterHash='b'*64)
        baseline=peers()
        context=dict(writer=dict(sha=SHA,markerSha=SHA,pid=456,activeState='active',
            cwd='/home/deploy/disdex-trading/releases/'+SHA,
            unit='disdex-shared-crypto-risk@'+SHA+'.service'),
            peers=baseline,killHash='a'*64,pendingHash='b'*64)
        context.update(context_patch or {})
        reader=SharedRiskAuditReader(expected_sha=SHA,previous_risk=risk(state['tick']),
            baseline_peers=baseline,kill_hash='a'*64,pending_hash='b'*64,
            read_risk=lambda:risk(state['tick']),read_context=lambda:context,
            signed_flat_get=signed,clock_ms=lambda:NOW,monotonic=lambda:state['elapsed'],
            sleep=sleep,timeout_seconds=2)
        state['context']=context
        return reader,state

    def test_reader_waits_for_three_actual_risk_updates_instead_of_reusing_a_file(self):
        reader,state=self.reader()
        completed=[reader(i)['tickCompletedAt'] for i in range(3)]
        self.assertEqual(len(set(completed)),3)
        self.assertEqual(state['gets'],3)
        with self.assertRaisesRegex(ValueError,'SEQUENCE'):reader(2)

    def test_static_snapshot_times_out_without_spamming_signed_get(self):
        reader,state=self.reader(advances=False)
        with self.assertRaisesRegex(ValueError,'REAL_REFRESH_TIMEOUT'):reader(0)
        self.assertEqual(state['gets'],0)
        self.assertEqual(reader.cycles,[])

    def test_pending_change_after_actual_get_is_not_certified(self):
        reader,_=self.reader(context_patch=dict(pendingHash='e'*64))
        with self.assertRaisesRegex(ValueError,'PENDING_CHANGED_AFTER_SIGNED_GET'):reader(0)
        self.assertEqual(reader.cycles,[])

    def test_baseline_peer_snapshot_is_frozen_even_when_reader_reuses_a_dict(self):
        reader,state=self.reader()
        state['context']['peers']['V12_V4']['pid']=999
        with self.assertRaisesRegex(ValueError,'PEER_CHANGED'):reader(0)

    def test_signed_flat_proof_rejects_mutation_nonflat_and_changed_registry(self):
        proof=dict(status='PENDING_READONLY_RECONCILE_VERIFIED',verifiedAt=NOW-1000,
            positionCount=0,openOrderCount=0,ordersSent=0,cancelsSent=0,positionChangesSent=0,
            beforeHash='b'*64,afterHash='b'*64)
        validate_signed_flat_result(proof)
        for patch in [dict(positionCount=1),dict(openOrderCount=1),dict(ordersSent=1),
                      dict(ordersSent=False),dict(afterHash='c'*64),dict(status='PASS')]:
            with self.assertRaises(ValueError):validate_signed_flat_result({**proof,**patch})

if __name__=='__main__':unittest.main()
