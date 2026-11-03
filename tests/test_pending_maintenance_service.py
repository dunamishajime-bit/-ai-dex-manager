"""Private Linux root fixtures only. No real systemd, credentials or venue."""
import hashlib,json,os,sys,tempfile,time,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/ops/deploy'))
import disdex_pending_maintenance as m

@unittest.skipUnless(os.name!='nt' and hasattr(os,'geteuid') and os.geteuid()==0,'Linux root fixture required')
class ServiceIntegrationTest(unittest.TestCase):
    def setUp(self):
        import pwd
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
        self.root=self.base/'control';self.root.mkdir(mode=0o700)
        self.maintenance=self.root/'pending-maintenance'
        for p in [self.maintenance,self.maintenance/'committed',self.maintenance/'results',self.root/'nonces',self.root/'plans',self.root/'plans/PENDING_RECONCILE_ONLY']:
            p.mkdir(mode=0o700)
        self.runtime=self.base/'runtime';self.runtime.mkdir(mode=0o750);self.runtime.chmod(0o750)
        nobody=pwd.getpwnam('nobody');self.deploy=SimpleNamespace(pw_uid=nobody.pw_uid,pw_gid=nobody.pw_gid,pw_dir=str(self.base))
        os.chown(self.runtime,0,nobody.pw_gid)
        self.pending=self.base/'pending.json';self.before=dict(schema='disdex-pending-exposure/v1',updatedAt=1000,entries=[])
        self.pending.write_text(json.dumps(self.before));self.pending.chmod(0o600)
        self.sha='a'*40;self.release=self.base/self.sha;self.release.mkdir()
        self.nonce='c'*32;(self.root/'nonces'/self.nonce).write_text('fixture');(self.root/'nonces'/self.nonce).chmod(0o600)
        (self.root/'deployment-execution.lock').touch(mode=0o600)
        self.plan=dict(scope='PENDING_RECONCILE_ONLY',sourceSha=self.sha,ordersEnabled=False)
        self.write(self.root/'plans/PENDING_RECONCILE_ONLY'/(self.sha+'.json'),self.plan)
        now=int(time.time())
        self.receipt=dict(schema='disdex-pending-maintenance-receipt/v1',status='COMMITTED_NO_ORDER_MAINTENANCE',repository='dunamishajime-bit/-ai-dex-manager',
            deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS',scope='PENDING_RECONCILE_ONLY',sourceSha=self.sha,
            serviceUnit=m.SERVICE,ordersEnabled=False,authorizesTrading=False,allowedMutations=['pending-exposure.updatedAt'],preserveEntries=True,
            accountIdentitySha256=hashlib.sha256(('0x'+'0'*40).encode()).hexdigest(),planSha256=hashlib.sha256(json.dumps(self.plan,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
            nonceDigest=hashlib.sha256(self.nonce.encode()).hexdigest(),route='CODEX_SSH',authorizationMethod='ROOT_SSH_SESSION',authorizationIssuedAt=now-1200,authorizationExpiresAt=now-900,committedAt=now-1000)
        self.approval=self.maintenance/'committed'/(self.sha+'.json');self.write(self.approval,self.receipt)
        self.patches=[patch.object(m,k,v) for k,v in dict(ROOT=self.root,MAINTENANCE=self.maintenance,RUNTIME=self.runtime,PENDING=self.pending).items()]
        for p in self.patches:p.start();self.addCleanup(p.stop)
        self.pid=patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=str(os.getpid())));self.pid.start();self.addCleanup(self.pid.stop)
        real_root_json=m.root_json
        manifest=dict(schema='disdex-runner-pin-manifest/v1',target='professional-dismanager.net',runners={k:dict(sha='7'*40) for k in m.IDS})
        current=dict(schema='disdex-unified-deployment-plan/v2',repository='dunamishajime-bit/-ai-dex-manager',deploymentTarget='professional-dismanager.net',operatorTarget='DD1296_FINAL_ALLIN_10BPS',runners={k:'7'*40 for k in m.IDS})
        self.write(self.root/'current-plan.json',current)
        def reader(path):
            if path==Path('/etc/disdex/runner-pins.json'):return json.dumps(manifest).encode(),manifest
            return real_root_json(path)
        p=patch.object(m,'root_json',side_effect=reader);p.start();self.addCleanup(p.stop)
        env=patch.dict(os.environ,{'ASTER_USER_ADDRESS':'0x'+'0'*40});env.start();self.addCleanup(env.stop)
        self.addCleanup(self.tmp.cleanup)

    def write(self,path,data):path.write_text(json.dumps(data));path.chmod(0o600)

    def child(self,_release,_deploy,*,grant_path):
        grant=json.load(open(grant_path))
        self.assertEqual(grant['route'],'ROOT_SERVICE');self.assertEqual(grant['parentPid'],os.getpid())
        self.assertEqual(grant['schema'],'disdex-pending-refresh-root-grant/v2')
        before=self.pending.read_bytes();value=json.loads(before);after={**value,'updatedAt':value['updatedAt']+1000};self.pending.write_text(json.dumps(after))
        return dict(status='PENDING_READONLY_RECONCILE_APPLIED',beforeHash=m.digest(before),afterHash=m.digest(self.pending.read_bytes()),
            verifiedAt=after['updatedAt'],currentUpdatedAt=after['updatedAt'],priorUpdatedAt=value['updatedAt'],positionCount=0,openOrderCount=0,
            ordersSent=0,cancelsSent=0,positionChangesSent=0,ownershipMode='FLAT_NO_OPEN_ORDERS')

    def test_committed_timer_cycle_preserves_approval_and_cleans_ephemeral_grants(self):
        original=self.approval.read_bytes()
        with patch.object(m,'run_signed_child',side_effect=self.child):result=m.service_cycle(self.release,self.deploy)
        self.assertEqual(result['status'],'PENDING_MAINTENANCE_RECONCILED')
        self.assertEqual(json.load(open(self.pending)),{**self.before,'updatedAt':2000})
        self.assertEqual(self.approval.read_bytes(),original)
        self.assertEqual(list(self.runtime.glob('*.json')),[])

    def test_exclusive_deployment_blocks_maintenance_without_api_or_registry_mutation(self):
        import fcntl
        fd=os.open(self.root/'deployment-execution.lock',os.O_RDWR);fcntl.flock(fd,fcntl.LOCK_EX)
        try:
            with patch.object(m,'run_signed_child') as child:result=m.service_cycle(self.release,self.deploy)
            self.assertEqual(result['status'],'DEFERRED_DEPLOYMENT_IN_PROGRESS');child.assert_not_called()
            self.assertEqual(json.load(open(self.pending)),self.before)
        finally:os.close(fd)

    def test_child_crash_releases_grant_and_mutex_for_next_real_attempt(self):
        with patch.object(m,'run_signed_child',side_effect=RuntimeError('fixture crash')):
            with self.assertRaises(RuntimeError):m.service_cycle(self.release,self.deploy)
        self.assertEqual(list(self.runtime.glob('*.json')),[])
        self.assertEqual(json.load(open(self.pending)),self.before)
        with patch.object(m,'run_signed_child',side_effect=self.child):
            self.assertEqual(m.service_cycle(self.release,self.deploy)['status'],'PENDING_MAINTENANCE_RECONCILED')

    def test_revocation_or_wrong_service_pid_never_creates_a_child_grant(self):
        (self.maintenance/'revoked').touch()
        with patch.object(m,'run_signed_child') as child:
            with self.assertRaises(ValueError):m.service_cycle(self.release,self.deploy)
            child.assert_not_called()
        (self.maintenance/'revoked').unlink()
        self.pid.stop()
        with patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='0')):
            with self.assertRaises(ValueError):m.service_cycle(self.release,self.deploy)

if __name__=='__main__':unittest.main()
