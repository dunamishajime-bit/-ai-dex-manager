import sys,json,hashlib,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
import disdex_pending_maintenance as m
SHA='a'*40;NOW=1793713277

def receipt():
    return dict(schema='disdex-pending-maintenance-receipt/v1',status='COMMITTED_NO_ORDER_MAINTENANCE',
        repository='dunamishajime-bit/-ai-dex-manager',deploymentTarget='professional-dismanager.net',
        operatorTarget='DD1296_FINAL_ALLIN_10BPS',scope='PENDING_RECONCILE_ONLY',sourceSha=SHA,
        serviceUnit='disdex-pending-exposure-reconcile.service',ordersEnabled=False,authorizesTrading=False,
        allowedMutations=['pending-exposure.updatedAt'],preserveEntries=True,
        accountIdentitySha256='d'*64,
        planSha256='b'*64,nonceDigest='c'*64,route='CODEX_SSH',authorizationMethod='ROOT_SSH_SESSION',
        authorizationIssuedAt=NOW-120,authorizationExpiresAt=NOW+180,committedAt=NOW-60)

class MaintenanceTest(unittest.TestCase):
    def test_server_credentials_are_parsed_as_data_and_never_executed_or_forwarded_wholesale(self):
        text='export ASTER_USER_ADDRESS="0x'+'0'*40+'"\nASTER_API_PRIVATE_KEY="test-only-key"\nUNRELATED=discard\n'
        value=m.parse_server_credentials(text)
        self.assertEqual(set(value),{'ASTER_USER_ADDRESS','ASTER_API_PRIVATE_KEY'})
        with self.assertRaises(ValueError):m.parse_server_credentials('ASTER_API_PRIVATE_KEY=$(touch /tmp/should-never-execute)\n')

    def test_scheduled_execution_has_a_real_main_pid_and_does_not_import_fake_ssh_context(self):
        unit=m.render_service(SHA);timer=m.render_timer()
        self.assertIn('Type=exec',unit)
        self.assertIn('/'+SHA+'/scripts/ops/deploy/disdex_pending_maintenance.py --service-cycle',unit)
        self.assertIn('EnvironmentFile=/etc/disdex/disdex-v12-aster-credentials.env',unit)
        self.assertNotIn('SSH_CONNECTION',unit)
        self.assertIn('ProtectSystem=strict',unit)
        self.assertIn('OnUnitActiveSec=90s',timer)
        self.assertIn('RandomizedDelaySec=10s',timer)
        self.assertNotIn('Restart=always',unit)

    def test_committed_service_authority_does_not_claim_a_new_ssh_or_owner_session(self):
        r=receipt();m.validate_receipt(r,SHA,NOW+86400)
        self.assertEqual(r['authorizationExpiresAt'],NOW+180)
        grant=m.build_service_grant(SHA,'d'*64,123,NOW*1000,'e'*32,'f'*64)
        self.assertEqual(grant['route'],'ROOT_SERVICE')
        self.assertEqual(grant['authorizationMethod'],'ROOT_COMMITTED_NO_ORDER_MAINTENANCE')
        self.assertEqual(grant['expiresAt']-grant['issuedAt'],60000)
        self.assertFalse(grant['ordersEnabled'])

    def test_scope_hash_source_target_and_original_authorization_window_are_not_expandable(self):
        for patch in [dict(sourceSha='e'*40),dict(scope='V12_V4'),dict(ordersEnabled=True),
                dict(authorizesTrading=True),dict(allowedMutations=['pending-exposure.entries']),
                dict(serviceUnit='other.service'),dict(operatorTarget='other'),dict(nonceDigest=''),
                dict(authorizationMethod='OWNER_SIGNED_TOKEN'),dict(committedAt=NOW+200),
                dict(authorizationExpiresAt=NOW+301),dict(preserveEntries=False)]:
            with self.assertRaises(ValueError):m.validate_receipt({**receipt(),**patch},SHA,NOW+86400)

    def test_postwrite_can_change_only_root_freshness_without_releasing_any_entry(self):
        before=dict(schema='disdex-pending-exposure/v1',updatedAt=1000,entries=[dict(status='RELEASED',gross=0,flag=True)])
        after={**before,'updatedAt':2000}
        raw=json.dumps(before).encode();new=json.dumps(after).encode()
        result=dict(status='PENDING_READONLY_RECONCILE_APPLIED',beforeHash=hashlib.sha256(raw).hexdigest(),afterHash=hashlib.sha256(new).hexdigest(),
            currentUpdatedAt=2000,priorUpdatedAt=1000,verifiedAt=2000,positionCount=0,openOrderCount=0,
            ordersSent=0,cancelsSent=0,positionChangesSent=0,ownershipMode='FLAT_NO_OPEN_ORDERS')
        m.verify_update(raw,new,result)
        for changed in [{**after,'entries':[]},{**after,'entries':[dict(status='RELEASED',gross=0,flag=1)]}]:
            changed_raw=json.dumps(changed).encode()
            with self.assertRaises(ValueError):m.verify_update(raw,changed_raw,{**result,'afterHash':hashlib.sha256(changed_raw).hexdigest()})
        for patch in [dict(ordersSent=False),dict(positionCount=1),dict(currentUpdatedAt=999)]:
            with self.assertRaises(ValueError):m.verify_update(raw,new,{**result,**patch})

if __name__=='__main__':unittest.main()
