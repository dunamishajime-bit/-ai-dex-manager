"""Scoped root installation of immutable, GET-only pending maintenance.

The short deployment approval is consumed once. Its committed receipt can
authorize only the same service's bounded child grants, never trading. Three
scheduled cycles must be verified separately after the global exclusive
deployment lock is released; installation is not a LIVE certification.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

from disdex_deployment_plan import canonical,digest,validate

SCOPE='PENDING_RECONCILE_ONLY'
SERVICE='disdex-pending-exposure-reconcile.service'
TIMER='disdex-pending-exposure-reconcile.timer'


def require(value,reason):
    if not value:raise ValueError('PENDING_INSTALL_'+reason)


def validate_maintenance_plan(desired,current,pins):
    validate(current);validate(desired)
    require(current['runners']==pins,'STALE_CURRENT_PLAN')
    require(desired['scope']==SCOPE and desired['ordersEnabled'] is False,'SCOPE')
    return digest(desired,current)


def build_receipt(desired,plan_hash,authorization,account_hash,now):
    require(desired['scope']==SCOPE and desired['ordersEnabled'] is False,'SCOPE')
    require(authorization.get('sourceSha')==desired['sourceSha']
        and authorization.get('scope')==SCOPE and authorization.get('ordersEnabled') is False
        and authorization.get('planSha256')==plan_hash,'APPROVAL_BINDING')
    issued=authorization.get('issuedAt');expires=authorization.get('expiresAt')
    require(type(issued) is int and type(expires) is int and type(now) is int
        and issued<=now<expires and 1<=expires-issued<=300,'APPROVAL_EXPIRED')
    route=authorization.get('route')
    method='ROOT_SSH_SESSION' if route=='CODEX_SSH' else 'OWNER_SIGNED_TOKEN'
    require(route in ['CODEX_SSH','GITHUB_ACTIONS'],'ROUTE')
    if route=='CODEX_SSH':require(authorization.get('authorizationMethod')==method,'ROOT_AUTHORITY')
    require(isinstance(authorization.get('nonce'),str) and re.fullmatch('[a-f0-9]{32}',authorization['nonce']),
            'NONCE')
    require(isinstance(account_hash,str) and re.fullmatch('[a-f0-9]{64}',account_hash),'ACCOUNT_HASH')
    return dict(schema='disdex-pending-maintenance-receipt/v1',status='COMMITTED_NO_ORDER_MAINTENANCE',
        repository=desired['repository'],deploymentTarget=desired['deploymentTarget'],operatorTarget=desired['operatorTarget'],
        scope=SCOPE,sourceSha=desired['sourceSha'],serviceUnit=SERVICE,ordersEnabled=False,authorizesTrading=False,
        allowedMutations=['pending-exposure.updatedAt'],preserveEntries=True,accountIdentitySha256=account_hash,
        planSha256=plan_hash,nonceDigest=hashlib.sha256(authorization['nonce'].encode()).hexdigest(),
        route=route,authorizationMethod=method,authorizationIssuedAt=issued,authorizationExpiresAt=expires,committedAt=now)


def _load_sdk(release):
    from disdex_unified_root_gate import assert_regular_secure
    folder=release/'scripts/ops/deploy'
    for name in ['disdex_pending_refresh','disdex_pending_maintenance']:
        path=folder/(name+'.py');info=assert_regular_secure(path,private=False)
        require(not info.st_mode&0o222,'WRITABLE_SDK')
        require(name not in sys.modules,'SDK_MODULE_ALREADY_LOADED')
        spec=importlib.util.spec_from_file_location(name,path)
        module=importlib.util.module_from_spec(spec);sys.modules[name]=module
        try:spec.loader.exec_module(module)
        except Exception:
            sys.modules.pop(name,None);raise
    sdk=sys.modules['disdex_pending_maintenance']
    require(sdk.source_release()==release,'SDK_SOURCE')
    return sdk


def prepare(parent,args,token,*,sdk_loader=_load_sdk,context_reader=None):
    import pwd
    from disdex_unified_root_gate import read_root_json,parse_live_pins,release_marker,assert_private_dir
    require(args.scope==SCOPE and args.orders_enabled=='false','ORDER_PERMISSION')
    paths=parent.paths
    for directory in [paths.root,paths.root/'plans',paths.root/'plans'/SCOPE,paths.nonce_dir]:
        assert_private_dir(directory,root_uid=parent.root_uid)
    desired=read_root_json(paths.root/'plans'/SCOPE/(args.sha+'.json'),root_uid=parent.root_uid)
    current=read_root_json(paths.current_plan,root_uid=parent.root_uid)
    pins=parse_live_pins(read_root_json(paths.pins,root_uid=parent.root_uid,private=False),releases=paths.releases)
    plan_hash,_changes=validate_maintenance_plan(desired,current,pins)
    require(plan_hash==args.plan_sha256 and desired['sourceSha']==args.sha,'PLAN_HASH_OR_SOURCE')
    require(parent._read_current_sha(unchanged_identity_only=True)==current['sourceSha'],'CURRENT_IDENTITY')
    release=release_marker(args.sha,paths.releases,root_uid=parent.root_uid)
    sdk=sdk_loader(release);credentials=sdk.load_server_credentials()
    address=credentials.get('ASTER_USER_ADDRESS','').lower()
    require(re.fullmatch('0x[a-f0-9]{40}',address),'ACCOUNT_IDENTITY')
    account_hash=hashlib.sha256(address.encode()).hexdigest()
    deploy=pwd.getpwnam('deploy')
    require(deploy.pw_uid>0 and deploy.pw_gid>0,'DEPLOY_IDENTITY')
    if context_reader is None:
        from disdex_shared_risk_witness import ProductionSharedRiskReader
        context_reader=ProductionSharedRiskReader().read_context
    context=context_reader()
    parent._verify_token(args,token)
    proof=sdk.run_signed_child(release,deploy,credentials=credentials)
    require(proof.get('status')=='PENDING_READONLY_RECONCILE_VERIFIED'
        and all(type(proof.get(k)) is int and proof[k]==0
            for k in ['ordersSent','cancelsSent','positionChangesSent']),'READONLY_PREFLIGHT')
    # A new deployment or manual reconciliation during GET invalidates install.
    require(context_reader()==context,'PROTECTED_RUNTIME_CHANGED')
    require(read_root_json(paths.current_plan,root_uid=parent.root_uid)==current,'CURRENT_PLAN_CHANGED')
    parent._assert_expected_pins(pins)
    authorization=parent._verify_token(args,token)
    receipt=build_receipt(desired,plan_hash,authorization,account_hash,parent.clock())
    sdk.validate_receipt(receipt,args.sha,parent.clock())
    return dict(sdk=sdk,receipt=receipt,context=context,context_reader=context_reader,proof=proof,desired=desired,pins=pins)


def _directory(path,mode=0o700,gid=0):
    from disdex_unified_root_gate import assert_root_trusted_dir
    if not path.exists():path.mkdir(mode=mode);os.chown(path,0,gid);path.chmod(mode)
    assert_root_trusted_dir(path)
    require(stat.S_IMODE(path.stat().st_mode)==mode and path.stat().st_gid==gid,'DIRECTORY_MODE_OR_GROUP')


def _sync(directory):
    fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def _new_file(path,raw,mode,on_created):
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,mode)
    try:
        on_created()
        os.fchmod(fd,mode);os.fchown(fd,0,0)
        with os.fdopen(fd,'wb',closefd=False) as stream:stream.write(raw);stream.flush();os.fsync(fd)
    finally:os.close(fd)
    _sync(path.parent)


def install(parent,args,token,*,systemd_root=Path('/etc/systemd/system'),prepared=None,runner=subprocess.run):
    import pwd
    data=prepare(parent,args,token) if prepared is None else prepared
    sdk=data['sdk'];paths=parent.paths
    directory=paths.root/'pending-maintenance'
    receipt_path=directory/'committed'/(args.sha+'.json')
    targets=[systemd_root/SERVICE,systemd_root/TIMER]
    # First installation only: replacement of a certified maintenance release
    # requires a separate upgrade transaction, never overwriting its receipt.
    require(not any(p.exists() or p.is_symlink() for p in [receipt_path,*targets]),'EXISTING_INSTALLATION')
    require(not parent.systemd.is_active(SERVICE) and not parent.systemd.is_active(TIMER),'SERVICE_ALREADY_ACTIVE')
    require(not parent.systemd.is_enabled(TIMER),'TIMER_ALREADY_ENABLED')
    require(data['context_reader']()==data['context'],'PROTECTED_RUNTIME_CHANGED')
    for d in [directory,directory/'committed',directory/'results']:_directory(d)
    deploy=pwd.getpwnam('deploy')
    _directory(sdk.RUNTIME,0o750,deploy.pw_gid)
    _directory(sdk.HEALTH,0o755)
    authorization=parent._verify_token(args,token,nonce_dir=paths.nonce_dir)
    receipt=build_receipt(data['desired'],args.plan_sha256,authorization,data['receipt']['accountIdentitySha256'],parent.clock())
    sdk.validate_receipt(receipt,args.sha,parent.clock())
    created=[]
    def command(*argv):
        result=runner(['/usr/bin/systemctl',*argv],capture_output=True,text=True,timeout=20)
        require(result.returncode==0,'SYSTEMD_'+argv[0].upper())
    try:
        # Record attempted paths before writes: fsync can fail after publication.
        for path,raw,mode in [(receipt_path,canonical(receipt)+b'\n',0o400),
                (targets[0],sdk.render_service(args.sha).encode(),0o644),
                (targets[1],sdk.render_timer().encode(),0o644)]:
            _new_file(path,raw,mode,lambda p=path:created.append(p))
        command('daemon-reload')
        require(data['context_reader']()==data['context'],'PROTECTED_RUNTIME_CHANGED')
        parent._assert_expected_pins(data['pins'])
        command('enable','--now',TIMER)
        require(parent.systemd.is_active(TIMER),'TIMER_NOT_ACTIVE')
    except Exception as error:
        # Only this no-order maintenance timer/service are ever stopped.
        failures=[]
        for operation,unit in [('stop',TIMER),('stop',SERVICE),('disable',TIMER)]:
            try:command(operation,unit)
            except Exception:failures.append(operation)
        for path in reversed(created):
            try:
                if path.exists():path.unlink();_sync(path.parent)
            except OSError:failures.append('remove')
        try:command('daemon-reload')
        except Exception:failures.append('reload')
        if failures:raise RuntimeError('PENDING_INSTALL_ROLLBACK_REQUIRES_RECONCILIATION') from error
        raise
    return dict(status='PENDING_MAINTENANCE_INSTALLED_AWAITING_REAL_CYCLES',scope=SCOPE,
        sourceSha=args.sha,ordersEnabled=False,authorizesTrading=False,receipt=str(receipt_path),
        serviceUnit=SERVICE,timerUnit=TIMER,auditRequired='THREE_DISTINCT_SCHEDULED_SIGNED_RECONCILIATIONS',
        **{k:0 for k in ['ordersSent','cancelsSent','positionChangesSent']})
