#!/usr/bin/env python3
"""Root-committed, no-order pending freshness maintenance. No SSH impersonation.

The deployment approval is consumed once by the installer. This process may
issue only a 60-second child grant for its own immutable SDK/source, account,
registry hash and root PID. The child is deploy and uses the normal account
lock/shared budget. Every other registry field must remain unchanged.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shlex
import stat
import subprocess
import sys
import time

from disdex_pending_refresh import build_grant,exclusive_json,secure

SHA=re.compile(r'[a-f0-9]{40}\Z');HASH=re.compile(r'[a-f0-9]{64}\Z')
ROOT=Path('/var/lib/disdex/unified-deploy')
MAINTENANCE=ROOT/'pending-maintenance'
RELEASES=Path('/home/deploy/disdex-trading/releases')
PENDING=Path('/var/lib/disdex/shared/pending-exposure.json')
RUNTIME=Path('/run/disdex-pending-refresh')
HEALTH=Path('/var/lib/disdex/runner-health/pending-maintenance')
SERVICE='disdex-pending-exposure-reconcile.service'
IDS={'V12_V4','QUALITY102_CAUSAL_V1','V52','PENGU_V8','FET_BRK48_RESIDUAL',
     'HYPE_TREND_LONG','IDLE_PRIORITY_SHORT','SHARED_CRYPTO_RISK','MARGIN_GUARD'}
RECEIPT_FIELDS={'schema','status','repository','deploymentTarget','operatorTarget','scope','sourceSha',
    'serviceUnit','ordersEnabled','authorizesTrading','allowedMutations','preserveEntries','accountIdentitySha256',
    'planSha256','nonceDigest','route','authorizationMethod','authorizationIssuedAt','authorizationExpiresAt','committedAt'}


def require(test,code):
    if not test:raise ValueError(code)


def digest(raw):return hashlib.sha256(raw).hexdigest()


def validate_receipt(row,sha,now_s):
    require(isinstance(row,dict) and set(row)==RECEIPT_FIELDS,'PENDING_MAINTENANCE_RECEIPT_FIELDS')
    require(SHA.fullmatch(sha) and row['schema']=='disdex-pending-maintenance-receipt/v1'
        and row['status']=='COMMITTED_NO_ORDER_MAINTENANCE'
        and row['repository']=='dunamishajime-bit/-ai-dex-manager'
        and row['deploymentTarget']=='professional-dismanager.net'
        and row['operatorTarget']=='DD1296_FINAL_ALLIN_10BPS'
        and row['scope']=='PENDING_RECONCILE_ONLY' and row['sourceSha']==sha
        and row['serviceUnit']==SERVICE and row['ordersEnabled'] is False and row['authorizesTrading'] is False
        and row['allowedMutations']==['pending-exposure.updatedAt'] and row['preserveEntries'] is True,
        'PENDING_MAINTENANCE_RECEIPT_SCOPE_OR_SOURCE')
    for key in ['planSha256','nonceDigest','accountIdentitySha256']:
        require(isinstance(row[key],str) and HASH.fullmatch(row[key]),'PENDING_MAINTENANCE_RECEIPT_HASH')
    require((row['route'],row['authorizationMethod']) in [('CODEX_SSH','ROOT_SSH_SESSION'),
            ('GITHUB_ACTIONS','OWNER_SIGNED_TOKEN')],'PENDING_MAINTENANCE_AUTHORITY_ROUTE')
    issued,expires,committed=(row[k] for k in ['authorizationIssuedAt','authorizationExpiresAt','committedAt'])
    require(all(type(v) is int and v>0 for v in [issued,expires,committed,now_s])
        and issued<=committed<expires and 1<=expires-issued<=300 and committed<=now_s,
        'PENDING_MAINTENANCE_ORIGINAL_APPROVAL_WINDOW')
    return row


def build_service_grant(sha,registry_hash,parent_pid,now,nonce,receipt_hash):
    require(isinstance(receipt_hash,str) and HASH.fullmatch(receipt_hash),'PENDING_MAINTENANCE_RECEIPT_HASH')
    grant=build_grant(sha,registry_hash,parent_pid,now,nonce)
    grant.update(schema='disdex-pending-refresh-root-grant/v2',route='ROOT_SERVICE',
        authorizationMethod='ROOT_COMMITTED_NO_ORDER_MAINTENANCE',maintenanceReceiptSha256=receipt_hash)
    return grant


def same_fields(left,right):
    if type(left) in (int,float) and type(right) in (int,float):
        return math.isfinite(left) and math.isfinite(right) and left==right
    if type(left) is not type(right):return False
    if isinstance(left,dict):return left.keys()==right.keys() and all(same_fields(v,right[k]) for k,v in left.items())
    if isinstance(left,list):return len(left)==len(right) and all(same_fields(a,b) for a,b in zip(left,right))
    return left==right


def verify_update(before,after,result):
    require(isinstance(result,dict) and result.get('status')=='PENDING_READONLY_RECONCILE_APPLIED'
        and result.get('beforeHash')==digest(before) and result.get('afterHash')==digest(after),
        'PENDING_MAINTENANCE_READBACK_HASH')
    for key in ['ordersSent','cancelsSent','positionChangesSent']:
        require(type(result.get(key)) is int and result[key]==0,'PENDING_MAINTENANCE_UNEXPECTED_MUTATION')
    for key in ['positionCount','openOrderCount']:
        require(type(result.get(key)) is int and result[key]>=0,'PENDING_MAINTENANCE_VENUE_COUNTER')
    if result['positionCount'] or result['openOrderCount']:
        require(result.get('ownershipMode')=='PINNED_OWNER_PROOF','PENDING_MAINTENANCE_OWNERSHIP_REQUIRED')
    else:require(result.get('ownershipMode')=='FLAT_NO_OPEN_ORDERS','PENDING_MAINTENANCE_FLAT_PROOF_REQUIRED')
    prior=json.loads(before);current=json.loads(after);verified=result.get('verifiedAt')
    require(all(type(result.get(k)) is int for k in ['verifiedAt','currentUpdatedAt','priorUpdatedAt'])
        and type(prior.get('updatedAt')) is int
        and verified>prior['updatedAt'] and result.get('priorUpdatedAt')==prior['updatedAt']
        and result.get('currentUpdatedAt')==verified,'PENDING_MAINTENANCE_TIMESTAMP_INVALID')
    require(same_fields(current,{**prior,'updatedAt':verified}),'PENDING_MAINTENANCE_FIELD_SCOPE_EXCEEDED')


def root_json(path):
    secure(path,allowed_write=0o200)
    def unique(pairs):
        row={}
        for key,value in pairs:
            require(key not in row,'PENDING_MAINTENANCE_DUPLICATE_JSON_FIELD');row[key]=value
        return row
    raw=path.read_bytes();value=json.loads(raw,object_pairs_hook=unique)
    require(isinstance(value,dict),'PENDING_MAINTENANCE_JSON_NOT_OBJECT')
    return raw,value


def source_release():
    release=Path(__file__).resolve().parents[3]
    require(release.parent==RELEASES and SHA.fullmatch(release.name),'PENDING_MAINTENANCE_RELEASE_LOCAL_REQUIRED')
    secure(release,directory=True)
    secure(release/'node_modules',directory=True)
    for p in [release/'.disdex-release-sha',Path(__file__).resolve(),
              release/'scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts',
              release/'node_modules/tsx/dist/loader.mjs']:
        secure(p)
    require((release/'.disdex-release-sha').read_text().strip()==release.name,'PENDING_MAINTENANCE_RELEASE_MARKER')
    return release


def parse_server_credentials(text):
    """Read the approved dotenv subset as data; never evaluate shell syntax."""
    allowed={'ASTER_API_PRIVATE_KEY','ASTER_USER_ADDRESS','ASTER_FUTURES_BASE_URL'}
    result={}
    for line in text.splitlines():
        line=line.strip()
        if not line or line.startswith('#'):continue
        if line.startswith('export '):line=line[7:].lstrip()
        key,separator,value=line.partition('=')
        key=key.strip()
        if key not in allowed:continue
        require(separator and key not in result,'PENDING_MAINTENANCE_CREDENTIAL_FORMAT')
        require(not any(c in value for c in ['$', '`', '\x00', '\r', ';']),
                'PENDING_MAINTENANCE_CREDENTIAL_FORMAT')
        try:parts=shlex.split(value,comments=True,posix=True)
        except ValueError:raise ValueError('PENDING_MAINTENANCE_CREDENTIAL_FORMAT') from None
        require(len(parts)==1 and bool(parts[0]),'PENDING_MAINTENANCE_CREDENTIAL_FORMAT')
        result[key]=parts[0]
    require({'ASTER_API_PRIVATE_KEY','ASTER_USER_ADDRESS'}<=result.keys(),
            'PENDING_MAINTENANCE_CREDENTIALS_MISSING')
    return result


def load_server_credentials():
    path=Path('/etc/disdex/disdex-v12-aster-credentials.env')
    secure(path,allowed_write=0o200)
    require(stat.S_IMODE(path.stat().st_mode)==0o600,'PENDING_MAINTENANCE_CREDENTIAL_MODE')
    return parse_server_credentials(path.read_text())


def child_environment(sha,home,grant_path=None,credentials=None):
    source=os.environ if credentials is None else credentials
    env={k:source[k] for k in ['ASTER_API_PRIVATE_KEY','ASTER_USER_ADDRESS','ASTER_FUTURES_BASE_URL'] if k in source}
    env.update(PATH='/usr/bin:/bin',HOME=home,NODE_ENV='production',DISDEX_RELEASE_SHA=sha,
        DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH='/var/lib/disdex/shared/aster-rate-budget.json')
    if grant_path is not None:env['DISDEX_PENDING_REFRESH_GRANT_PATH']=str(grant_path)
    return env


def run_signed_child(release,deploy,*,grant_path=None,credentials=None):
    result=subprocess.run(['/usr/bin/node','--import',str(release/'node_modules/tsx/dist/loader.mjs'),
        str(release/'scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts'),
        '--apply-refresh' if grant_path is not None else '--verify-only'],cwd=release,
        user=deploy.pw_uid,group=deploy.pw_gid,extra_groups=[],
        env=child_environment(release.name,deploy.pw_dir,grant_path,credentials),capture_output=True,text=True,timeout=55)
    # Deliberately do not print/store raw stderr, response URLs or credentials.
    if result.returncode:
        reason='PENDING_MAINTENANCE_SIGNED_READ_FAILED_OR_DEFERRED'
        for line in result.stderr.splitlines():
            try:code=json.loads(line).get('error')
            except (ValueError,AttributeError):continue
            if isinstance(code,str) and re.fullmatch(r'(?:PENDING_[A-Z0-9_]+|ASTER_GLOBAL_RATE_BUDGET_SATURATED)(?::[0-9]{1,12})?',code):
                reason='PENDING_MAINTENANCE_CHILD_REJECTED:'+code
        raise ValueError(reason)
    rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    require(len(rows)==1,'PENDING_MAINTENANCE_CHILD_RESULT_INVALID')
    return rows[0]


def current_authority(sha):
    secure(ROOT,directory=True,allowed_write=0o200)
    secure(MAINTENANCE,directory=True,allowed_write=0o200)
    secure(MAINTENANCE/'committed',directory=True,allowed_write=0o200)
    require(not (MAINTENANCE/'revoked').exists(),'PENDING_MAINTENANCE_REVOKED')
    raw,row=root_json(MAINTENANCE/'committed'/(sha+'.json'));validate_receipt(row,sha,int(time.time()))
    address=os.environ.get('ASTER_USER_ADDRESS','').lower()
    require(re.fullmatch(r'0x[a-f0-9]{40}',address) and digest(address.encode())==row['accountIdentitySha256'],
            'PENDING_MAINTENANCE_ACCOUNT_IDENTITY_MISMATCH')
    _plan_raw,plan=root_json(ROOT/'plans/PENDING_RECONCILE_ONLY'/(sha+'.json'))
    canonical=json.dumps(plan,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')
    require(digest(canonical)==row['planSha256'] and plan.get('scope')=='PENDING_RECONCILE_ONLY'
        and plan.get('sourceSha')==sha and plan.get('ordersEnabled') is False,'PENDING_MAINTENANCE_PLAN_BINDING')
    _current_raw,current=root_json(ROOT/'current-plan.json');_pins_raw,manifest=root_json(Path('/etc/disdex/runner-pins.json'))
    runners=manifest.get('runners',{})
    require(current.get('schema')=='disdex-unified-deployment-plan/v2'
        and current.get('repository')=='dunamishajime-bit/-ai-dex-manager'
        and current.get('deploymentTarget')=='professional-dismanager.net'
        and current.get('operatorTarget')=='DD1296_FINAL_ALLIN_10BPS'
        and manifest.get('schema')=='disdex-runner-pin-manifest/v1'
        and manifest.get('target')=='professional-dismanager.net'
        and set(runners)==IDS and set(current.get('runners',{}))==IDS
        and all(current['runners'][k]==runners[k].get('sha') for k in IDS),
        'PENDING_MAINTENANCE_CURRENT_PLAN_MISMATCH')
    consumed=[]
    for path in (ROOT/'nonces').iterdir():
        if digest(path.name.encode())==row['nonceDigest']:
            secure(path,allowed_write=0o200);consumed.append(path)
    require(len(consumed)==1,'PENDING_MAINTENANCE_CONSUMED_NONCE_NOT_PROVEN')
    return raw,row


def render_service(sha):
    require(isinstance(sha,str) and SHA.fullmatch(sha),'PENDING_MAINTENANCE_SOURCE_SHA_INVALID')
    return ('[Unit]\nDescription=DisDex certified pending freshness (no orders)\n'
        'After=network-online.target\nWants=network-online.target\n'
        'OnFailure=disdex-runner-health-alert.service\n'
        '[Service]\nType=exec\nUser=root\nGroup=root\n'
        'EnvironmentFile=/etc/disdex/disdex-v12-aster-credentials.env\n'
        'Environment=PYTHONNOUSERSITE=1\nUnsetEnvironment=PYTHONPATH PYTHONHOME PYTHONSTARTUP NODE_OPTIONS\n'
        'ExecStart=/usr/bin/python3 /home/deploy/disdex-trading/releases/'+sha+'/scripts/ops/deploy/disdex_pending_maintenance.py --service-cycle\n'
        'TimeoutStartSec=60s\nTimeoutStopSec=10s\nRuntimeMaxSec=60s\n'
        'NoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=read-only\n'
        'ReadOnlyPaths=/etc/disdex /home/deploy/disdex-trading/releases /var/lib/disdex/unified-deploy\n'
        'ReadWritePaths=/run/disdex-pending-refresh /var/lib/disdex/shared '
        '/var/lib/disdex/unified-deploy/pending-maintenance/results /var/lib/disdex/runner-health/pending-maintenance\n'
        'UMask=0077\n')


def render_timer():
    return ('[Unit]\nDescription=DisDex bounded pending signed reconciliation\n'
        '[Timer]\nOnBootSec=30s\nOnUnitActiveSec=90s\nRandomizedDelaySec=10s\nAccuracySec=1s\n'
        'Unit='+SERVICE+'\n[Install]\nWantedBy=timers.target\n')


def publish_health(sha,outcome):
    secure(HEALTH,directory=True,allowed_write=0o200)
    previous={}
    try:previous=json.loads((HEALTH/'status.json').read_text())
    except (OSError,ValueError):pass
    last=previous.get('lastReconciledAt') if previous.get('sourceSha')==sha else None
    if outcome.get('status')=='PENDING_MAINTENANCE_RECONCILED':last=outcome['result']['verifiedAt']
    body=dict(schema='disdex-pending-maintenance-health/v1',sourceSha=sha,serviceUnit=SERVICE,
        mainPid=os.getpid(),heartbeatAt=time.time_ns()//1000000,lastReconciledAt=last,
        ordersEnabled=False,status=outcome.get('status'),reason=outcome.get('reason'))
    temp=HEALTH/('.status.'+secrets.token_hex(16)+'.tmp')
    try:exclusive_json(temp,body,mode=0o644);os.replace(temp,HEALTH/'status.json')
    finally:temp.unlink(missing_ok=True)


def service_cycle(release,deploy):
    import fcntl
    require(deploy.pw_uid>0 and deploy.pw_gid>0,'PENDING_MAINTENANCE_DEPLOY_USER')
    pid=subprocess.run(['systemctl','show',SERVICE,'-p','MainPID','--value'],capture_output=True,text=True,timeout=12)
    require(pid.returncode==0 and pid.stdout.strip()==str(os.getpid()),'PENDING_MAINTENANCE_REAL_SERVICE_REQUIRED')
    secure(ROOT/'deployment-execution.lock',allowed_write=0o200)
    global_fd=os.open(ROOT/'deployment-execution.lock',os.O_RDONLY|os.O_NOFOLLOW)
    grant_path=None;runtime_fd=None
    try:
        try:fcntl.flock(global_fd,fcntl.LOCK_SH|fcntl.LOCK_NB)
        except BlockingIOError:return dict(status='DEFERRED_DEPLOYMENT_IN_PROGRESS',registryWrites=0,ordersEnabled=False)
        receipt_raw,_receipt=current_authority(release.name)
        secure(RUNTIME,directory=True,allowed_write=0o200)
        require(RUNTIME.stat().st_gid==deploy.pw_gid and stat.S_IMODE(RUNTIME.stat().st_mode)==0o750,
                'PENDING_MAINTENANCE_RUNTIME_GROUP')
        runtime_fd=os.open(RUNTIME/'executor.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        secure(RUNTIME/'executor.lock',allowed_write=0o200)
        try:fcntl.flock(runtime_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return dict(status='DEFERRED_PENDING_EXECUTOR_BUSY',registryWrites=0,ordersEnabled=False)
        before=PENDING.read_bytes();nonce=secrets.token_hex(16)
        grant=build_service_grant(release.name,digest(before),os.getpid(),time.time_ns()//1000000,nonce,digest(receipt_raw))
        grant_path=RUNTIME/(nonce+'.json');exclusive_json(grant_path,grant,deploy.pw_gid,0o640)
        result=run_signed_child(release,deploy,grant_path=grant_path)
        after=PENDING.read_bytes();verify_update(before,after,result)
        report=dict(status='PENDING_MAINTENANCE_RECONCILED',sourceSha=release.name,
            scope='PENDING_RECONCILE_ONLY',authorizationMethod='ROOT_COMMITTED_NO_ORDER_MAINTENANCE',
            ordersEnabled=False,result=result,completedAt=time.time_ns()//1000000)
        exclusive_json(MAINTENANCE/'results'/(nonce+'.json'),report)
        return report
    finally:
        if grant_path is not None:grant_path.unlink(missing_ok=True)
        if runtime_fd is not None:os.close(runtime_fd)
        os.close(global_fd)


def main():
    import pwd
    require(os.geteuid()==0,'PENDING_MAINTENANCE_ROOT_REQUIRED')
    require(sys.argv[1:] in [['--service-cycle'],['--verify-only']],'PENDING_MAINTENANCE_MODE_REQUIRED')
    release=source_release();deploy=pwd.getpwnam('deploy')
    if sys.argv[1]=='--verify-only':
        row=run_signed_child(release,deploy)
        require(row.get('status')=='PENDING_READONLY_RECONCILE_VERIFIED','PENDING_MAINTENANCE_READONLY_PROOF_INVALID')
        print(json.dumps(dict(status='PENDING_MAINTENANCE_READONLY_NOT_ACTIVE',result=row,sourceSha=release.name)),flush=True)
        return
    try:outcome=service_cycle(release,deploy)
    except Exception as error:
        reason=str(error) if isinstance(error,ValueError) and str(error).startswith('PENDING_MAINTENANCE_') else type(error).__name__
        publish_health(release.name,dict(status='PENDING_MAINTENANCE_FAIL_CLOSED',reason=reason))
        raise
    publish_health(release.name,outcome)
    print(json.dumps(outcome,sort_keys=True),flush=True)


if __name__=='__main__':
    try:main()
    except Exception as error:
        reason=str(error) if isinstance(error,ValueError) and str(error).startswith('PENDING_MAINTENANCE_') else type(error).__name__
        print(json.dumps(dict(status='PENDING_MAINTENANCE_FAIL_CLOSED',reason=reason,
            ordersSent=0,cancelsSent=0,positionChangesSent=0)),file=sys.stderr)
        sys.exit(2)
