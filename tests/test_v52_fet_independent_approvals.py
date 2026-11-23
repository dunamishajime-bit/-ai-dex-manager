import importlib.util
from pathlib import Path
import unittest

path=Path(__file__).resolve().parents[1]/'scripts/ops/root/disdex-fet-preemption-readiness-guard.py'
spec=importlib.util.spec_from_file_location('fet_guard_independent',path)
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
V52='4'*40;FET='7'*40

def artifact(sha,roles):
    return dict(schema='disdex-live-operator-activation/v1',approvedSha=sha,
        target='DD1296_FINAL_ALLIN_10BPS',approvedRunners=roles,ordersEnabled=True,
        operatorAcknowledgement='I_ACK_REAL_MONEY_LIVE_ACTIVATION',fetCorePreemptionReady=True)

def manifest():
    return dict(schema='disdex-runner-pin-manifest/v1',runners={'FET_BRK48_RESIDUAL':dict(
        sha=FET,serviceUnit='disdex-fet-brk48@'+FET+'.service',
        releaseRoot='/home/deploy/disdex-trading/releases/'+FET,stopOwner='FET_BRK48_RESIDUAL')})

class IndependentApprovalTest(unittest.TestCase):
    def test_v52_only_approval_reuses_existing_fet_own_sha_without_granting_fet_new_sha(self):
        v52=artifact(V52,['V52']);fet=artifact(FET,['FET_BRK48_RESIDUAL'])
        self.assertTrue(guard.independent_approvals_ready(v52,fet,manifest(),V52))
        self.assertEqual(v52['approvedRunners'],['V52'])
        self.assertEqual(fet['approvedSha'],FET)

    def test_a_v52_artifact_cannot_stand_in_for_fets_independent_owner_proof(self):
        v52=artifact(V52,['V52','FET_BRK48_RESIDUAL'])
        self.assertFalse(guard.independent_approvals_ready(v52,v52,manifest(),V52))
        for patch in [dict(approvedSha=V52),dict(ordersEnabled=False),dict(target='other'),
                      dict(approvedRunners=['V52']),dict(fetCorePreemptionReady=False),dict(schema='other')]:
            self.assertFalse(guard.independent_approvals_ready(v52,{**artifact(FET,['FET_BRK48_RESIDUAL']),**patch},manifest(),V52))

    def test_wrong_v52_identity_and_malformed_fet_pin_are_rejected(self):
        v52=artifact(V52,['V52']);fet=artifact(FET,['FET_BRK48_RESIDUAL'])
        for patch in [dict(sha=V52),dict(serviceUnit='other.service'),dict(stopOwner='V52'),dict(releaseRoot='/tmp')]:
            pins=manifest();pins['runners']['FET_BRK48_RESIDUAL'].update(patch)
            self.assertFalse(guard.independent_approvals_ready(v52,fet,pins,V52))
        self.assertFalse(guard.independent_approvals_ready(v52,fet,manifest(),'b'*40))

if __name__=='__main__':unittest.main()
