"""Source-bound no-order maintenance upgrade. Never authorizes trading.

The caller must already hold the formal deployment lock and supply the exact
externally prepared plan hash and short-lived authorization.  This module does
not mint an approval, derive an expected hash from its own plan, place orders,
or modify trading pins.  It only publishes a new maintenance receipt and unit.
Three scheduled cycles must be checked after the deployment lock is released.
"""
import hashlib
import base64
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

OLD='e6afd90883544bbe9d3a6bf9e13614fa9737c65a'
NEW='bc46704cba6c5d7cc16ffaa3af32a4d222425505'
SCOPE='PENDING_RECONCILE_ONLY'
SERVICE='disdex-pending-exposure-reconcile.service'
TIMER='disdex-pending-exposure-reconcile.timer'
HASHES={
 'scripts/ops/deploy/disdex_pending_maintenance.py':'039212c645c58f31b6909a1f8e529df1da5eda05c8c9640c2244527fa1d073a5',
 'scripts/ops/deploy/disdex_pending_refresh.py':'c5a7fec23b47fa3db71f6a961320b7d5f239488121dc17a9b6d325f6b557849b',
 'scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts':'7b89b24f41d015627bbb6d7b2684793658feeb19244e051c56129d18e329d494',
 'lib/disdex-pending-owner-evidence.ts':'d6155805bcdc846883729d54965bb4caa18998512c8399eac9ecd836a22ad3f6',
 'lib/disdex-pending-h48-composite.ts':'a08be90665e0b2b46888cf4c7b4bf69b14ff67e836e71e3d593831dae4ea50c6',
 'lib/disdex-pending-owned-witness.ts':'ea62683c9adb55e8f4f31756cd42eb7020074c0f6873ea49e2192152bd36f59c',
 'lib/disdex-pending-protected-hold.ts':'90ae3c0a9d6821aa0d73bc8bfe65aa78c8659ef1f1732bb598fc163bc7cbfbaa',
}

def require(value,reason):
    if not value:raise ValueError('PENDING_COMPOSITE_UPGRADE_'+reason)

def expected_old_unit(new_unit):
    require(isinstance(new_unit,bytes) and new_unit.count(NEW.encode())==1,'NEW_UNIT_SOURCE')
    require(new_unit.count(b'TimeoutStartSec=660s\nTimeoutStopSec=10s\nRuntimeMaxSec=660s\n')==1,'NEW_UNIT_TIMEOUT')
    return new_unit.replace(NEW.encode(),OLD.encode()).replace(b'TimeoutStartSec=660s\nTimeoutStopSec=10s\nRuntimeMaxSec=660s\n',b'TimeoutStartSec=60s\nTimeoutStopSec=10s\nRuntimeMaxSec=60s\n')

def build_upgrade_dispatch(source,*,expected_sha256):
    """Patch reviewed generic executor bytes only; does not install them."""
    import ast
    require(isinstance(source,bytes) and isinstance(expected_sha256,str) and re.fullmatch('[a-f0-9]{64}',expected_sha256) and hashlib.sha256(source).hexdigest()==expected_sha256,'DISPATCH_SOURCE_HASH')
    text=source.decode();old="""        if args.scope == 'PENDING_RECONCILE_ONLY':
            from disdex_pending_maintenance_install import install
            return install(self,args,token)
"""
    new="""        if args.scope == 'PENDING_RECONCILE_ONLY':
            if args.sha == 'bc46704cba6c5d7cc16ffaa3af32a4d222425505':
                from disdex_pending_composite_upgrade import upgrade
                return upgrade(self,args,token)
            from disdex_pending_maintenance_install import install
            return install(self,args,token)
"""
    require(text.count(old)==1,'DISPATCH_ANCHOR');result=text.replace(old,new,1)
    old_preflight="""        parent=RootDeploymentExecutor(paths,root_uid=root_uid)
        prepared=prepare(parent,args,token)
        return dict(status='READONLY_PREFLIGHT_PASS_NOT_LIVE',scope=args.scope,route=args.route,
"""
    new_preflight="""        parent=RootDeploymentExecutor(paths,root_uid=root_uid)
        if args.sha == 'bc46704cba6c5d7cc16ffaa3af32a4d222425505':
            from disdex_pending_composite_upgrade import upgrade
            return upgrade(parent,args,token,dry_run=True)
        prepared=prepare(parent,args,token)
        return dict(status='READONLY_PREFLIGHT_PASS_NOT_LIVE',scope=args.scope,route=args.route,
"""
    require(result.count(old_preflight)==1,'PREFLIGHT_ANCHOR');result=result.replace(old_preflight,new_preflight,1)
    ast.parse(result);return result.encode()

def validate_source_files(release):
    require(release.name==NEW and release.resolve()==release,'RELEASE_PATH')
    validate_immutable_tree(release)
    for relative,expected in HASHES.items():
        path=release/relative;before=path.lstat()
        require(stat.S_ISREG(before.st_mode) and not path.is_symlink() and before.st_uid==0 and not before.st_mode&0o222,'SOURCE_METADATA')
        raw=path.read_bytes();after=path.lstat()
        require((before.st_dev,before.st_ino,before.st_mtime_ns,before.st_size)==(after.st_dev,after.st_ino,after.st_mtime_ns,after.st_size) and hashlib.sha256(raw).hexdigest()==expected,'SOURCE_HASH')

def validate_immutable_tree(release):
    """Check every traversable staged source/dependency, not a selected list.

    A link may only resolve inside the same immutable tree; no writable file or
    directory in that tree may be controlled by the deploy account. Root must
    stage a release meeting this contract before requesting preflight.
    """
    root=release.resolve();require(root==release and root.is_dir(),'RELEASE_TREE_ROOT')
    def no_partial_walk(error):raise ValueError('PENDING_COMPOSITE_UPGRADE_RELEASE_TREE_UNREADABLE') from error
    for directory,dirs,files in os.walk(root,followlinks=False,onerror=no_partial_walk):
        base=Path(directory)
        for path in [base,*[base/n for n in dirs],*[base/n for n in files]]:
            meta=path.lstat();require(meta.st_uid==0,'RELEASE_TREE_OWNER')
            if stat.S_ISLNK(meta.st_mode):
                target=path.resolve(strict=True)
                require(target==root or root in target.parents,'RELEASE_TREE_LINK_ESCAPE')
            else:
                require((stat.S_ISDIR(meta.st_mode) or stat.S_ISREG(meta.st_mode)) and not meta.st_mode&0o222,'RELEASE_TREE_MUTABLE_OR_SPECIAL')

def validate_cycle_audit(rows,*,source_sha=NEW):
    require(source_sha==NEW and isinstance(rows,list) and len(rows)>=3,'AUDIT_ROWS')
    selected=rows[-3:];ticks=[]
    for row in selected:
        require(isinstance(row,dict) and row.get('status')=='PENDING_MAINTENANCE_RECONCILED' and row.get('sourceSha')==source_sha and row.get('scope')==SCOPE and row.get('ordersEnabled')is False,'AUDIT_RECEIPT')
        result=row.get('result');require(isinstance(result,dict) and result.get('status')=='PENDING_READONLY_RECONCILE_APPLIED' and result.get('ownershipMode') in ('PINNED_OWNER_PROOF','FLAT_NO_OPEN_ORDERS') and all(type(result.get(k)) is int and result[k]==0 for k in ('ordersSent','cancelsSent','positionChangesSent')),'AUDIT_CYCLE')
        tick=result.get('verifiedAt');require(type(tick)is int and tick>0 and type(row.get('completedAt'))is int and row['completedAt']>=tick,'AUDIT_CLOCK');ticks.append(tick)
    require(ticks[0]<ticks[1]<ticks[2],'AUDIT_NOT_ADVANCING')
    # Record timestamps alone do not prove that systemd's timer launched them.
    # The caller must separately bind each root-owned report to a distinct timer
    # invocation in the journal before claiming scheduled-cycle verification.
    return {'status':'NO_ORDER_COMPOSITE_THREE_ADVANCING_RECORDS','sourceSha':source_sha,'verifiedAt':ticks[-1],'scheduledInvocationsVerified':False,'ordersSent':0,'cancelsSent':0,'positionChangesSent':0}

def _journal_replace(path,row,maintenance):
    temp=path.with_name(path.name+'.next')
    require(not temp.exists() and not temp.is_symlink(),'JOURNAL_TEMP_EXISTS')
    maintenance._new_file(temp,maintenance.canonical(row)+b'\n',0o600,lambda:None)
    os.replace(temp,path);maintenance._sync(path.parent)

def _read_journal(path,root_uid):
    meta=path.lstat();require(stat.S_ISREG(meta.st_mode) and not path.is_symlink() and meta.st_uid==root_uid and stat.S_IMODE(meta.st_mode)==0o600,'JOURNAL_METADATA')
    raw=path.read_bytes();require(len(raw)<=100000,'JOURNAL_OVERSIZED')
    row=json.loads(raw)
    keys={'schema','oldSha','newSha','planSha256','currentPlanHash','pinsHash','oldUnit','newUnit','receiptHash'}
    require(isinstance(row,dict) and set(row)==keys and row['schema']=='disdex-pending-composite-upgrade-journal/v1' and row['oldSha']==OLD and row['newSha']==NEW,'JOURNAL_IDENTITY')
    require(all(isinstance(row[k],str) and re.fullmatch('[a-f0-9]{64}',row[k]) for k in ['planSha256','currentPlanHash','pinsHash']) and (row['receiptHash'] is None or isinstance(row['receiptHash'],str) and re.fullmatch('[a-f0-9]{64}',row['receiptHash'])),'JOURNAL_HASHES')
    try:old=base64.b64decode(row['oldUnit'],validate=True);new=base64.b64decode(row['newUnit'],validate=True)
    except Exception:raise ValueError('PENDING_COMPOSITE_UPGRADE_JOURNAL_UNIT_ENCODING') from None
    require(expected_old_unit(new)==old,'JOURNAL_UNITS')
    return row,old,new

def recover_incomplete_upgrade(parent,*,systemd_root,runner,maintenance,expected_new_unit,account_lock=Path('/var/lib/disdex/shared/account-order.lock')):
    """Restore a journaled no-order transaction; never stop an active worker."""
    path=parent.paths.root/'pending-maintenance/transactions'/(NEW+'.json')
    if not path.exists() and not path.is_symlink():return False
    row,old_unit,new_unit=_read_journal(path,parent.root_uid);paths=parent.paths
    require(isinstance(expected_new_unit,bytes) and new_unit==expected_new_unit and old_unit==expected_old_unit(expected_new_unit),'RECOVERY_APPROVED_UNIT_CHANGED')
    digest=lambda b:hashlib.sha256(b).hexdigest()
    require(digest(paths.current_plan.read_bytes())==row['currentPlanHash'] and digest(paths.pins.read_bytes())==row['pinsHash'],'RECOVERY_AUTHORITY_CHANGED')
    def command(*args):
        result=runner(['/usr/bin/systemctl',*args],capture_output=True,text=True,timeout=20)
        require(result.returncode==0,'RECOVERY_SYSTEMD_'+args[0].upper());return result.stdout.strip()
    command('stop',TIMER)
    require(command('show',TIMER,'-p','ActiveState','--value')=='inactive','RECOVERY_TIMER_ACTIVE')
    require(command('show',SERVICE,'-p','MainPID','--value')=='0','RECOVERY_WORKER_BUSY')
    try:account_lock.lstat()
    except FileNotFoundError:pass
    else:raise ValueError('PENDING_COMPOSITE_UPGRADE_RECOVERY_ACCOUNT_LOCK_PRESENT')
    unit=systemd_root/SERVICE;current=unit.read_bytes();require(current in (old_unit,new_unit),'RECOVERY_UNIT_CHANGED')
    if current==new_unit:
        temp=unit.with_name(unit.name+'.composite-recovery-tmp')
        maintenance._new_file(temp,old_unit,0o644,lambda:None);os.replace(temp,unit);maintenance._sync(unit.parent);command('daemon-reload')
    receipt=paths.root/'pending-maintenance/committed'/(NEW+'.json')
    if receipt.exists() or receipt.is_symlink():
        require(not receipt.is_symlink() and row['receiptHash'] is not None and digest(receipt.read_bytes())==row['receiptHash'],'RECOVERY_RECEIPT_CHANGED')
        receipt.unlink();maintenance._sync(receipt.parent)
    for leftover in [unit.with_name(unit.name+'.composite-upgrade-tmp'),unit.with_name(unit.name+'.composite-rollback-tmp'),unit.with_name(unit.name+'.composite-recovery-tmp'),path.with_name(path.name+'.next')]:
        if leftover.exists() or leftover.is_symlink():
            info=leftover.lstat();require(stat.S_ISREG(info.st_mode) and not leftover.is_symlink() and info.st_uid==parent.root_uid,'RECOVERY_TEMP_UNTRUSTED')
            leftover.unlink();maintenance._sync(leftover.parent)
    command('start',TIMER);require(command('is-active',TIMER)=='active','RECOVERY_TIMER_RESTART')
    path.unlink();maintenance._sync(path.parent)
    return True

def upgrade(parent,args,token,*,systemd_root=Path('/etc/systemd/system'),runner=subprocess.run,dry_run=False):
    """Formal no-order upgrade; caller independently installs prepared plan."""
    import pwd
    import disdex_pending_maintenance_install as maintenance
    from disdex_unified_root_gate import read_root_json,parse_live_pins,release_marker
    require(args.scope==SCOPE and args.orders_enabled=='false' and args.sha==NEW and isinstance(args.plan_sha256,str) and re.fullmatch('[a-f0-9]{64}',args.plan_sha256),'EXACT_AUTHORIZED_SCOPE')
    paths=parent.paths;journal=paths.root/'pending-maintenance/transactions'/(NEW+'.json');sdk=None
    if journal.exists() or journal.is_symlink():
        require(not dry_run,'RECOVERY_REQUIRED_BEFORE_PREFLIGHT')
        parent._verify_token(args,token)
        recovery_release=release_marker(NEW,paths.releases,root_uid=parent.root_uid)
        validate_source_files(recovery_release);sdk=maintenance._load_sdk(recovery_release)
        recover_incomplete_upgrade(parent,systemd_root=systemd_root,runner=runner,maintenance=maintenance,expected_new_unit=sdk.render_service(NEW).encode())
    old_release=release_marker(OLD,paths.releases,root_uid=parent.root_uid);release=release_marker(NEW,paths.releases,root_uid=parent.root_uid)
    validate_source_files(release)
    old_protocol=old_release/'scripts/ops/deploy/disdex_pending_maintenance.py'
    require(hashlib.sha256(old_protocol.read_bytes()).hexdigest()=='8bcc07c78338d10bf969f8833447512505e236507b165c7c3c5209ba86fbe2ca','OLD_PROTOCOL_CHANGED')
    desired_path=paths.root/'plans'/SCOPE/(NEW+'.json');desired=read_root_json(desired_path,root_uid=parent.root_uid)
    current_raw=paths.current_plan.read_bytes();pins_raw=paths.pins.read_bytes()
    current=read_root_json(paths.current_plan,root_uid=parent.root_uid);pins=parse_live_pins(read_root_json(paths.pins,root_uid=parent.root_uid,private=False),releases=paths.releases)
    actual_hash,_=maintenance.validate_maintenance_plan(desired,current,pins)
    require(actual_hash==args.plan_sha256 and desired.get('sourceSha')==NEW,'EXTERNALLY_BOUND_PLAN')
    require(parent._read_current_sha(unchanged_identity_only=True)==current.get('sourceSha'),'CURRENT_IDENTITY')
    parent._verify_token(args,token)
    if sdk is None:sdk=maintenance._load_sdk(release)
    old_receipt_path=paths.root/'pending-maintenance/committed'/(OLD+'.json')
    prior=read_root_json(old_receipt_path,root_uid=parent.root_uid);sdk.validate_receipt(prior,OLD,parent.clock())
    account=sdk.load_server_credentials();address=account.get('ASTER_USER_ADDRESS','').lower()
    require(re.fullmatch('0x[a-f0-9]{40}',address) and prior.get('accountIdentitySha256')==hashlib.sha256(address.encode()).hexdigest(),'ACCOUNT_IDENTITY')
    deploy=pwd.getpwnam('deploy')
    proof=sdk.run_signed_child(release,deploy,credentials=account,verify_owned=True)
    require(proof.get('status')=='PENDING_READONLY_RECONCILE_VERIFIED' and all(type(proof.get(k))is int and proof[k]==0 for k in ('ordersSent','cancelsSent','positionChangesSent')),'SIGNED_OWNER_PREFLIGHT')
    require(paths.current_plan.read_bytes()==current_raw and paths.pins.read_bytes()==pins_raw,'PROTECTED_AUTHORITY_CHANGED')
    parent._assert_expected_pins(pins)
    unit=systemd_root/SERVICE;meta=unit.lstat()
    require(stat.S_ISREG(meta.st_mode) and not unit.is_symlink() and meta.st_uid==parent.root_uid and not meta.st_mode&0o022,'UNIT_METADATA')
    old_unit=unit.read_bytes();new_unit=sdk.render_service(NEW).encode()
    require(old_unit==expected_old_unit(new_unit),'OLD_UNIT_CHANGED')
    new_receipt=paths.root/'pending-maintenance/committed'/(NEW+'.json')
    require(not new_receipt.exists() and not new_receipt.is_symlink(),'RECEIPT_EXISTS')
    if dry_run:
        parent._verify_token(args,token)
        return {'status':'PENDING_COMPOSITE_READONLY_PREFLIGHT_PASS','sourceSha':NEW,'priorSourceSha':OLD,'scope':SCOPE,'planSha256':args.plan_sha256,'ordersEnabled':False,'authorizesTrading':False,'ordersSent':0,'cancelsSent':0,'positionChangesSent':0,'unproven':['UNIT_CUTOVER','THREE_SCHEDULED_CYCLES']}
    def command(*argv):
        result=runner(['/usr/bin/systemctl',*argv],capture_output=True,text=True,timeout=20)
        require(result.returncode==0,'SYSTEMD_'+argv[0].upper());return result.stdout.strip()
    require(command('is-active',TIMER)=='active','TIMER_NOT_ACTIVE')
    maintenance._directory(journal.parent)
    journal_row={'schema':'disdex-pending-composite-upgrade-journal/v1','oldSha':OLD,'newSha':NEW,'planSha256':args.plan_sha256,'currentPlanHash':hashlib.sha256(current_raw).hexdigest(),'pinsHash':hashlib.sha256(pins_raw).hexdigest(),'oldUnit':base64.b64encode(old_unit).decode(),'newUnit':base64.b64encode(new_unit).decode(),'receiptHash':None}
    maintenance._new_file(journal,maintenance.canonical(journal_row)+b'\n',0o600,lambda:None)
    stopped=False;changed=False;created=[];temp=None
    try:
        command('stop',TIMER);stopped=True
        # Do not interrupt a lease-owning worker; retry later if already active.
        require(command('show',SERVICE,'-p','MainPID','--value')=='0','OLD_WORKER_BUSY')
        require(paths.current_plan.read_bytes()==current_raw and paths.pins.read_bytes()==pins_raw and unit.read_bytes()==old_unit,'PRECOMMIT_CHANGED')
        authorization=parent._verify_token(args,token,nonce_dir=paths.nonce_dir)
        receipt=maintenance.build_receipt(desired,args.plan_sha256,authorization,prior['accountIdentitySha256'],parent.clock())
        sdk.validate_receipt(receipt,NEW,parent.clock())
        receipt_raw=maintenance.canonical(receipt)+b'\n';journal_row['receiptHash']=hashlib.sha256(receipt_raw).hexdigest()
        _journal_replace(journal,journal_row,maintenance)
        maintenance._new_file(new_receipt,receipt_raw,0o400,lambda:created.append(new_receipt))
        temp=unit.with_name(unit.name+'.composite-upgrade-tmp')
        maintenance._new_file(temp,new_unit,0o644,lambda:created.append(temp))
        require(unit.read_bytes()==old_unit,'UNIT_CAS');os.replace(temp,unit);changed=True;maintenance._sync(unit.parent)
        command('daemon-reload')
        require(paths.current_plan.read_bytes()==current_raw and paths.pins.read_bytes()==pins_raw,'PROTECTED_AUTHORITY_CHANGED')
        command('start',TIMER);stopped=False
        require(command('is-active',TIMER)=='active','TIMER_RESTART_FAILED')
        journal.unlink();maintenance._sync(journal.parent)
    except Exception as error:
        # Never terminate a worker that might hold the real account lease.
        try:
            if changed:
                # A failed post-start check does not prove the timer stopped.
                # Stop and independently verify the timer before the worker PID
                # check, preventing a new launch during unit/receipt rollback.
                command('stop',TIMER);stopped=True
                require(command('show',TIMER,'-p','ActiveState','--value')=='inactive','ROLLBACK_TIMER_ACTIVE')
                require(command('show',SERVICE,'-p','MainPID','--value')=='0','ROLLBACK_WORKER_BUSY')
                require(unit.read_bytes()==new_unit,'ROLLBACK_UNIT_CHANGED')
                temp=unit.with_name(unit.name+'.composite-rollback-tmp')
                maintenance._new_file(temp,old_unit,0o644,lambda:None);os.replace(temp,unit);maintenance._sync(unit.parent);command('daemon-reload')
            for path in reversed(created):
                if path.exists():path.unlink();maintenance._sync(path.parent)
            if stopped:command('start',TIMER)
            if journal.exists():journal.unlink();maintenance._sync(journal.parent)
        except Exception as rollback:raise RuntimeError('PENDING_COMPOSITE_UPGRADE_RECOVERY_REQUIRED') from rollback
        raise error
    return {'status':'PENDING_COMPOSITE_UPGRADED_AWAITING_THREE_REAL_CYCLES','sourceSha':NEW,'priorSourceSha':OLD,'scope':SCOPE,'ordersEnabled':False,'authorizesTrading':False,'ordersSent':0,'cancelsSent':0,'positionChangesSent':0}
