"""No venue or Production calls: scope and committed-authority contracts."""
import copy,sys,unittest,os,tempfile,json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
from disdex_deployment_plan import IDS,digest
from disdex_deployment_contract import validate_order_permission
from disdex_pending_maintenance_install import build_receipt,validate_maintenance_plan,install,SERVICE,TIMER

def plan():
    return dict(schema='disdex-unified-deployment-plan/v2',repository='dunamishajime-bit/-ai-dex-manager',
        deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS',
        sourceSha='7'*40,scope='FULL_PROJECT',runners={k:'7'*40 for k in IDS},uiSha='7'*40,monitorSha='7'*40,
        releaseRoots=dict(runners='/home/deploy/disdex-trading/releases',ui='/srv/ui',monitor='/srv/monitor'),ordersEnabled=False)

class MaintenanceInstallTest(unittest.TestCase):
    def test_maintenance_can_change_source_only_without_relabeling_runners_or_monitor(self):
        current=plan();desired={**copy.deepcopy(current),'sourceSha':'a'*40,'scope':'PENDING_RECONCILE_ONLY'}
        hashed,changes=validate_maintenance_plan(desired,current,current['runners'])
        self.assertEqual(len(hashed),64);self.assertEqual(changes['changedRunners'],[])
        self.assertFalse(changes['monitorChanged']);self.assertEqual(current,plan())
        self.assertEqual(digest(desired,current)[0],hashed)
        for field,value in [('uiSha','a'*40),('monitorSha','a'*40),('ordersEnabled',True),
                ('releaseRoots',{**current['releaseRoots'],'runners':'/other'})]:
            with self.assertRaises(ValueError):validate_maintenance_plan({**desired,field:value},current,current['runners'])
        changed=copy.deepcopy(desired);changed['runners']['V52']='a'*40
        with self.assertRaises(ValueError):validate_maintenance_plan(changed,current,current['runners'])
        with self.assertRaises(ValueError):validate_order_permission('PENDING_RECONCILE_ONLY',True)

    def test_receipt_binds_consumed_short_approval_and_cannot_expand_orders_or_time(self):
        desired={**plan(),'scope':'PENDING_RECONCILE_ONLY','sourceSha':'a'*40}
        authorization=dict(route='CODEX_SSH',authorizationMethod='ROOT_SSH_SESSION',sourceSha='a'*40,
            scope='PENDING_RECONCILE_ONLY',ordersEnabled=False,planSha256='b'*64,nonce='c'*32,
            issuedAt=1000,expiresAt=1300)
        result=build_receipt(desired,'b'*64,authorization,'d'*64,1200)
        self.assertEqual(result['authorizationExpiresAt'],1300)
        self.assertEqual(result['allowedMutations'],['pending-exposure.updatedAt'])
        self.assertFalse(result['authorizesTrading'])
        for patch in [dict(expiresAt=1600),dict(ordersEnabled=True),dict(sourceSha='e'*40),dict(scope='V52'),dict(planSha256='e'*64)]:
            with self.assertRaises(ValueError):build_receipt(desired,'b'*64,{**authorization,**patch},'d'*64,1200)
        with self.assertRaises(ValueError):build_receipt(desired,'b'*64,authorization,'d'*64,1300)

@unittest.skipUnless(os.name!='nt' and hasattr(os,'geteuid') and os.geteuid()==0,'Linux root fixture required')
class InstallTransactionTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.root=self.base/'control';self.root.mkdir(mode=0o700)
        self.units=self.base/'units';self.units.mkdir()
        self.desired={**plan(),'scope':'PENDING_RECONCILE_ONLY','sourceSha':'a'*40}
        self.authorization=dict(route='CODEX_SSH',authorizationMethod='ROOT_SSH_SESSION',sourceSha='a'*40,
            scope='PENDING_RECONCILE_ONLY',ordersEnabled=False,planSha256='b'*64,nonce='c'*32,
            issuedAt=1000,expiresAt=1300)
        self.calls=[];self.consumed=[];self.now=1200;self.enabled=False
        def verify(args,token,nonce_dir=None):
            if nonce_dir is not None:self.consumed.append('nonce')
            return self.authorization
        self.parent=SimpleNamespace(paths=SimpleNamespace(root=self.root,nonce_dir=self.root/'nonces'),
            systemd=SimpleNamespace(is_active=lambda unit:self.enabled if unit==TIMER else False,is_enabled=lambda unit:False),
            _verify_token=verify,_assert_expected_pins=lambda pins:None,clock=lambda:self.now)
        self.sdk=SimpleNamespace(RUNTIME=self.base/'runtime',HEALTH=self.base/'health',
            validate_receipt=lambda *args:None,render_service=lambda sha:'[Service]\nType=exec\n',render_timer=lambda:'[Timer]\n')
        self.data=dict(sdk=self.sdk,receipt=build_receipt(self.desired,'b'*64,self.authorization,'d'*64,1200),
            context=dict(killHash='unchanged',peers='unchanged'),context_reader=lambda:dict(killHash='unchanged',peers='unchanged'),
            desired=self.desired,pins=plan()['runners'])
        self.args=SimpleNamespace(sha='a'*40,plan_sha256='b'*64)
        self.pwd=patch('pwd.getpwnam',return_value=SimpleNamespace(pw_gid=65534));self.pwd.start();self.addCleanup(self.pwd.stop)

    def command(self,argv,**kwargs):
        self.calls.append(argv[1:])
        if argv[1:]==['enable','--now',TIMER]:self.enabled=True
        return SimpleNamespace(returncode=0)

    def test_install_keeps_runner_plan_and_pins_untouched_and_does_not_claim_three_cycles(self):
        before=copy.deepcopy(self.desired)
        result=install(self.parent,self.args,'',systemd_root=self.units,prepared=self.data,runner=self.command)
        self.assertEqual(result['status'],'PENDING_MAINTENANCE_INSTALLED_AWAITING_REAL_CYCLES')
        self.assertEqual(self.consumed,['nonce']);self.assertEqual(self.desired,before)
        authority=json.loads(Path(result['receipt']).read_text());self.assertFalse(authority['ordersEnabled'])
        self.assertEqual(authority['authorizationExpiresAt'],1300)
        self.assertEqual(self.calls,[['daemon-reload'],['enable','--now',TIMER]])
        with self.assertRaises(ValueError):install(self.parent,self.args,'',systemd_root=self.units,prepared=self.data,runner=self.command)
        self.assertEqual(self.consumed,['nonce'])

    def test_failed_systemd_enable_removes_only_created_maintenance_authority_and_units(self):
        def failing(argv,**kwargs):
            self.calls.append(argv[1:]);return SimpleNamespace(returncode=1 if argv[1]=='enable' else 0)
        with self.assertRaises(ValueError):install(self.parent,self.args,'',systemd_root=self.units,prepared=self.data,runner=failing)
        self.assertEqual(list(self.units.iterdir()),[])
        self.assertEqual(list((self.root/'pending-maintenance/committed').iterdir()),[])
        self.assertIn(['stop',SERVICE],self.calls);self.assertIn(['disable',TIMER],self.calls)
        self.assertFalse(any('disdex-v12-v4' in str(c) or 'current' in str(c) for c in self.calls))

    def test_expired_approval_or_changed_protected_context_cannot_publish(self):
        self.now=1300
        with self.assertRaises(ValueError):install(self.parent,self.args,'',systemd_root=self.units,prepared=self.data,runner=self.command)
        self.assertEqual(list(self.units.iterdir()),[]);self.assertEqual(self.calls,[])
        self.now=1200;self.data['context_reader']=lambda:dict(killHash='changed',peers='unchanged')
        with self.assertRaises(ValueError):install(self.parent,self.args,'',systemd_root=self.units,prepared=self.data,runner=self.command)

if __name__=='__main__':unittest.main()
