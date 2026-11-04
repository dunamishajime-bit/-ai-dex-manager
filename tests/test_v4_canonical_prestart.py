import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_v4_canonical_prestart import validate_activation,credential_binding_valid
import disdex_v4_canonical_prestart as m

class CanonicalV4GateTest(unittest.TestCase):
    def test_root_certificate_reader_uses_deploy_primary_group_without_changing_uid(self):
        from unittest.mock import patch
        with patch.object(m.subprocess,'run') as run:
            m.run_certificate_process(['node','fixture'],deploy_gid=1000,capture_output=True)
        self.assertEqual(run.call_args.kwargs['group'],1000)
        self.assertNotIn('user',run.call_args.kwargs)
        with self.assertRaises(ValueError):m.run_certificate_process(['node'],deploy_gid=0)
    def test_live_credentials_must_be_the_same_account_as_the_signed_witness(self):
        env=dict(ASTER_API_PRIVATE_KEY='fixture-only-key',ASTER_USER_ADDRESS='fixture-owner',ASTER_FUTURES_BASE_URL='https://fapi.asterdex.com')
        self.assertTrue(credential_binding_valid(env,env))
        self.assertFalse(credential_binding_valid(env,{**env,'ASTER_USER_ADDRESS':'other-owner'}))
        self.assertFalse(credential_binding_valid(env,{**env,'ASTER_API_PRIVATE_KEY':'different-fixture'}))
    def setUp(self):
        self.sha='a'*40;self.pins={'V12_V4':self.sha,'QUALITY102_CAUSAL_V1':'b'*40}
        self.impl=dict(implementationStatus='READY',target='V12_V4_V2_M150_D05_CORE_NATIVE',blockers=['OPERATOR_LIVE_ACTIVATION_REQUIRED'])
        self.a=dict(schema='disdex-live-operator-activation/v1',approvedSha=self.sha,
            approvedShaByRunner=self.pins,approvedRunners=['V12_V4'],target='DD1296_FINAL_ALLIN_10BPS',
            ordersEnabled=True,activationClass='FULL_LIVE',operatorAcknowledgement='I_ACK_REAL_MONEY_LIVE_ACTIVATION',
            approvedAt='2033-05-18T03:33:19Z',route='CODEX_SSH',authorizationMethod='ROOT_SSH_SESSION')
    def test_operator_target_and_strategy_policy_are_both_checked(self):
        self.assertTrue(validate_activation(self.a,self.sha,self.pins,self.impl,2_000_000_000))
    def test_wrong_scope_sha_map_target_policy_or_phase_fails(self):
        for key,value in [('approvedRunners',['V52']),('ordersEnabled',False),('target','V12_V4_V2_M150_D05_CORE_NATIVE'),
            ('approvedSha','c'*40),('approvedShaByRunner',{'V12_V4':self.sha}),('activationClass','MONITOR_ONLY'),
            ('authorizationMethod','OWNER_SIGNED_TOKEN')]:
            with self.subTest(key=key),self.assertRaises(ValueError):
                validate_activation({**self.a,key:value},self.sha,self.pins,self.impl,2_000_000_000)
        with self.assertRaises(ValueError):validate_activation(self.a,self.sha,self.pins,{**self.impl,'target':'OTHER'},2_000_000_000)

if __name__=='__main__':unittest.main()
