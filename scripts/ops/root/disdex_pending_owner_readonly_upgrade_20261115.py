"""Root SSH upgrade of the existing no-order owner-evidence worker only.
Trading pins, runtime approvals, strategy code, venue orders and registry entries stay frozen.
The current signed V4 inventory is independently replay-attested before source replacement.
"""

def main():
    import os,fcntl,sys
    from pathlib import Path
    sys.path.insert(0,'/usr/local/libexec/disdex-unified')
    from disdex_unified_root_gate import assert_codex_ssh_session
    assert_codex_ssh_session()
    lock=os.open('/var/lib/disdex/unified-deploy/deployment-execution.lock',os.O_RDWR)
    fcntl.flock(lock,fcntl.LOCK_EX)
    try:
        import sys,os,subprocess,time,json,shlex,pwd
        from pathlib import Path
        old='e788abc82e80f9fc7ab0e1ba83fdb8be267eb513'
        root=Path('/home/deploy/disdex-trading/releases')/old
        unit='disdex-v12-v4@'+old+'.service'
        def service_env(unit):
         raw=Path('/var/lib/disdex/ops-audit/v4-margin-recovery-20261115/direct-cutover-unit-backups/'+unit+'.original').read_text()
         env=dict(os.environ);unset=[]
         for line in raw.splitlines():
          line=line.strip()
          if line.startswith('EnvironmentFile='):
           for name in shlex.split(line.split('=',1)[1]):
            path=Path(name.lstrip('-'))
            if not path.exists() and name.startswith('-'):continue
            for setting in path.read_text().splitlines():
             setting=setting.strip()
             if not setting or setting.startswith('#') or '=' not in setting:continue
             k,v=setting.removeprefix('export ').split('=',1)
             vals=shlex.split(v);env[k]=vals[0] if len(vals)==1 else v
          if line.startswith('Environment='):
           for setting in shlex.split(line.split('=',1)[1]):
            if '=' in setting:
             k,v=setting.split('=',1);env[k]=v
          if line.startswith('UnsetEnvironment='):unset+=shlex.split(line.split('=',1)[1])
         for k in unset:env.pop(k,None)
         return env
        env=service_env(unit)
        deploy=pwd.getpwnam('deploy')
        
        
        
        sys.path.insert(0,'/usr/local/libexec/disdex-unified')
        from disdex_v4_durable_owner_probe import attest_current_sole_v4_owner
        from disdex_unified_root_gate import read_root_json,parse_live_pins,validate_bootstrap_plan
        sha='e788abc82e80f9fc7ab0e1ba83fdb8be267eb513'
        code="import {buildV4ProductionRuntime} from './scripts/v12-v4-production-runner.ts';const {engine}=await buildV4ProductionRuntime();const d=engine.deps;const positions=await d.client.getPositions();const orders=await d.client.getOpenOrders();console.log(JSON.stringify({positions,orders,signedAt:Date.now()}));"
        r=subprocess.run(['/usr/bin/node','--import',str(root/'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-'],input=code,env=env,cwd=root,user=deploy.pw_uid,group=deploy.pw_gid,extra_groups=[],text=True,capture_output=True,timeout=180)
        if r.returncode:raise RuntimeError('SIGNED_INVENTORY_READ_FAILED')
        venue=json.loads(next(l for l in r.stdout.splitlines() if l.startswith('{')))
        assert 0<=int(time.time()*1000)-venue['signedAt']<=30000
        proof=attest_current_sole_v4_owner(old,sha,venue['positions'],venue['orders'])
        
        import hashlib,fcntl
        from types import SimpleNamespace
        import disdex_pending_maintenance_install as maintenance
        from disdex_unified_root_gate import assert_codex_ssh_session,build_codex_ssh_authorization,_consume_codex_ssh_nonce,_atomic_json,release_marker
        assert_codex_ssh_session()
        new_sha='e6afd90883544bbe9d3a6bf9e13614fa9737c65a'
        old_sha='22ceb5fe44a6ac10a8880b1c8dcb7d5a20d479e5'
        control=Path('/var/lib/disdex/unified-deploy');audit=Path('/var/lib/disdex/ops-audit/v4-margin-recovery-20261115')
        new_release=release_marker(new_sha);old_release=release_marker(old_sha)
        assert (new_release/'scripts/ops/deploy/disdex_pending_maintenance.py').read_bytes()==(old_release/'scripts/ops/deploy/disdex_pending_maintenance.py').read_bytes(),'MAINTENANCE_AUTHORITY_PROTOCOL_CHANGED'
        # The loader intentionally admits one immutable SDK per process.
        # Its unchanged, explicitly SHA-parameterized receipt/unit validators
        # validate both generations without replacing the loaded authority SDK.
        new_sdk=maintenance._load_sdk(new_release);old_sdk=new_sdk
        pending_service=Path('/etc/systemd/system/disdex-pending-exposure-reconcile.service')
        digest=lambda raw:hashlib.sha256(raw).hexdigest()
        manifest=read_root_json(Path('/etc/disdex/runner-pins.json'),private=False);pins=parse_live_pins(manifest)
        assert pins['V12_V4']=='e788abc82e80f9fc7ab0e1ba83fdb8be267eb513'
        current=read_root_json(control/'current-plan.json')
        current_bytes=(control/'current-plan.json').read_bytes();pin_bytes=Path('/etc/disdex/runner-pins.json').read_bytes()
        prior_receipt=read_root_json(control/'pending-maintenance/committed'/(old_sha+'.json'))
        old_sdk.validate_receipt(prior_receipt,old_sha,int(time.time()))
        old_unit=pending_service.read_bytes();new_unit=new_sdk.render_service(new_sha).encode()
        assert old_unit==old_sdk.render_service(old_sha).encode(),'PRIOR_NO_ORDER_UNIT_DIFFERS'
        assert new_unit==old_unit.replace(old_sha.encode(),new_sha.encode()),'NO_ORDER_UPGRADE_SCOPE_EXCEEDED'
        assert (new_release/'scripts/ops/deploy/disdex_pending_maintenance.py').read_bytes()==(old_release/'scripts/ops/deploy/disdex_pending_maintenance.py').read_bytes(),'MAINTENANCE_AUTHORITY_PROTOCOL_CHANGED'
        desired=json.loads(json.dumps(current));desired.update(sourceSha=new_sha,scope=maintenance.SCOPE,ordersEnabled=False)
        plan_hash,_=maintenance.validate_maintenance_plan(desired,current,pins)
        credentials=new_sdk.load_server_credentials();address=credentials.get('ASTER_USER_ADDRESS','').lower()
        assert prior_receipt['accountIdentitySha256']==digest(address.encode()),'NO_ORDER_ACCOUNT_CHANGED'
        for _ in range(30):
         pid=subprocess.check_output(['systemctl','show','disdex-pending-exposure-reconcile.service','-p','MainPID','--value'],text=True).strip()
         if pid=='0':break
         time.sleep(.5)
        assert pid=='0','PRIOR_NO_ORDER_WORKER_BUSY'
        assert (control/'current-plan.json').read_bytes()==current_bytes and Path('/etc/disdex/runner-pins.json').read_bytes()==pin_bytes,'TRADE_AUTHORITY_CHANGED'
        args=SimpleNamespace(route='CODEX_SSH',owner='codex-ssh',_codex_ssh_authenticated=True,sha=new_sha,scope=maintenance.SCOPE,orders_enabled='false',plan_sha256=plan_hash)
        authorization=build_codex_ssh_authorization(args)
        _consume_codex_ssh_nonce(control/'nonces',authorization['nonce'],root_uid=0)
        receipt=maintenance.build_receipt(desired,plan_hash,authorization,prior_receipt['accountIdentitySha256'],int(time.time()))
        new_sdk.validate_receipt(receipt,new_sha,int(time.time()))
        receipt_path=control/'pending-maintenance/committed'/(new_sha+'.json')
        assert not receipt_path.exists(),'NO_ORDER_UPGRADE_ALREADY_COMMITTED'
        backup=audit/'pending-owner-upgrade-old-unit.service';backup.write_bytes(old_unit);backup.chmod(0o600)
        _atomic_json(control/'plans'/maintenance.SCOPE/(new_sha+'.json'),desired,root_uid=0)
        _atomic_json(receipt_path,receipt,root_uid=0)
        receipt_path.chmod(0o400)
        try:
         temp=pending_service.with_suffix('.owner-upgrade-tmp');temp.write_bytes(new_unit);temp.chmod(0o644)
         assert pending_service.read_bytes()==old_unit,'NO_ORDER_UNIT_CAS'
         os.replace(temp,pending_service)
         subprocess.run(['systemctl','daemon-reload'],check=True,capture_output=True)
         assert (control/'current-plan.json').read_bytes()==current_bytes and Path('/etc/disdex/runner-pins.json').read_bytes()==pin_bytes,'TRADE_AUTHORITY_CHANGED'
         result=dict(status='NO_ORDER_OWNER_UPGRADE_INSTALLED_AWAITING_RUNNING_V4_PROOF',sourceSha=new_sha,priorSourceSha=old_sha,scope=maintenance.SCOPE,ordersEnabled=False,authorizesTrading=False,allowedMutations=['pending-exposure.updatedAt'],peerPermissionsChanged=False,registryEntriesPreserved=True,journalReplayVerified=proof['journalReplayVerified'],verifiedCurrentV4Legs=proof['verifiedLegs'],testsPassed=10,planSha256=plan_hash,ordersSent=0,cancelsSent=0,positionChangesSent=0)
         _atomic_json(audit/'pending-owner-upgrade-installation.json',result,root_uid=0)
         print(json.dumps(result),flush=True)
        except Exception:
         if pending_service.read_bytes()==new_unit:
          temp=pending_service.with_suffix('.owner-rollback-tmp');temp.write_bytes(old_unit);temp.chmod(0o644);os.replace(temp,pending_service)
          subprocess.run(['systemctl','daemon-reload'],check=True,capture_output=True)
         raise
        
    finally:
        fcntl.flock(lock,fcntl.LOCK_UN);os.close(lock)

if __name__=='__main__':main()

