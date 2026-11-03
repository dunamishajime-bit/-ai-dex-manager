import sys
from pathlib import Path
from types import SimpleNamespace
import hashlib
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_deployment_plan import IDS,SCHEMA,canonical
from disdex_unified_root_gate import build_shared_risk_root_activation,build_codex_ssh_authorization
import disdex_shared_risk_prestart as m

SHA='c'*40;OLD='7'*40;NOW=2000000000
def inputs():
    plan=dict(schema=SCHEMA,repository='dunamishajime-bit/-ai-dex-manager',
        deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS',
        sourceSha=SHA,scope='SHARED_CRYPTO_RISK_ONLY',ordersEnabled=False,
        runners={k:(SHA if k=='SHARED_CRYPTO_RISK' else OLD) for k in IDS},
        uiSha=OLD,monitorSha=OLD,releaseRoots=dict(runners='/home/deploy/disdex-trading/releases',
        ui='/home/deploy/disdex-trading/ui-releases/old',monitor='/home/deploy/disdex-trading/releases/'+OLD))
    args=SimpleNamespace(route='CODEX_SSH',owner='codex-ssh',sha=SHA,scope=plan['scope'],
        orders_enabled='false',_codex_ssh_authenticated=True,plan_sha256=hashlib.sha256(canonical(plan)).hexdigest())
    auth=build_shared_risk_root_activation(args,plan,build_codex_ssh_authorization(args,now=NOW),now=NOW)
    return dict(sha=SHA,plan=plan,activation=auth,pins=plan['runners'],active_writers=[],now=NOW)

class PrestartTest(unittest.TestCase):
    def test_no_order_scope_does_not_require_or_issue_trading_authority_to_any_peer(self):
        self.assertEqual(m.validate_prestart(**inputs())['ordersEnabled'],False)
        data=inputs();data['active_writers']=['disdex-shared-crypto-risk@'+SHA+'.service']
        m.validate_prestart(**data)

    def test_old_or_third_writer_mismatched_pin_order_enable_and_expiry_fail(self):
        for patch in [dict(active_writers=['disdex-shared-crypto-risk@'+OLD+'.service']),
                      dict(now=NOW+300),dict(sha=OLD),dict(pins={})]:
            with self.assertRaises(ValueError):m.validate_prestart(**{**inputs(),**patch})
        data=inputs();data['activation']['ordersEnabled']=True
        with self.assertRaises(ValueError):m.validate_prestart(**data)
        data=inputs();data['activation']['approvedRunners'].append('V52')
        with self.assertRaises(ValueError):m.validate_prestart(**data)

    def test_dropin_is_instance_local_same_pid_and_explicit_no_order(self):
        value=m.render_dropin(SHA)
        self.assertIn('ExecStart=\nExecStart=/usr/bin/node --import ',value)
        self.assertIn('DISDEX_RUNTIME_COMMIT_SHA='+SHA,value)
        self.assertIn('DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7.5',value)
        self.assertIn('ExecStartPre=+/usr/bin/python3 /usr/local/libexec/disdex-unified/disdex_shared_risk_prestart.py --sha '+SHA,value)
        self.assertNotIn('ordersEnabled=true',value)
        for bad in ['../bad','C'*40,'a'*39]:
            with self.assertRaises(ValueError):m.render_dropin(bad)

if __name__=='__main__':unittest.main()
