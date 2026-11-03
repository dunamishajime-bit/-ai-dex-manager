#!/usr/bin/env python3
"""Root prestart for one certified no-order Shared Risk Writer instance."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace

from disdex_deployment_contract import SHA
from disdex_deployment_plan import canonical,validate

ROOT=Path('/var/lib/disdex/unified-deploy')
RELEASES=Path('/home/deploy/disdex-trading/releases')
SCOPE='SHARED_CRYPTO_RISK_ONLY'


def validate_prestart(*,sha,plan,activation,pins,active_writers,now,
                      committed_receipt=None,current_plan=None):
    from disdex_unified_root_gate import _validate_scoped_activation,_validate_scoped_activation_binding
    validate(plan)
    if (not isinstance(sha,str) or not SHA.fullmatch(sha)
            or plan['scope']!=SCOPE or plan['sourceSha']!=sha
            or plan['ordersEnabled'] is not False
            or plan['runners']['SHARED_CRYPTO_RISK']!=sha):
        raise ValueError('SHARED_RISK_PRESTART_EXACT_PLAN_MISMATCH')
    unit='disdex-shared-crypto-risk@'+sha+'.service'
    if (not isinstance(active_writers,list) or len(active_writers)>1
            or any(u!=unit for u in active_writers)):
        raise ValueError('SHARED_RISK_PRESTART_OTHER_WRITER_ACTIVE')
    args=SimpleNamespace(scope=SCOPE,sha=sha,owner=activation.get('operator'))
    plan_hash=hashlib.sha256(canonical(plan)).hexdigest()
    if committed_receipt is not None:
        _validate_scoped_activation_binding(activation,args,plan,plan_hash)
        validate(current_plan)
        r=committed_receipt
        if (current_plan['runners']!=pins or pins.get('SHARED_CRYPTO_RISK')!=sha
                or activation['approvedAt']>now or r.get('status')!='SHARED_RISK_CUTOVER_VERIFIED'
                or r.get('scope')!=SCOPE or r.get('targetSha')!=sha or r.get('planSha256')!=plan_hash
                or r.get('ordersEnabled') is not False
                or r.get('route') not in ['CODEX_SSH','GITHUB_ACTIONS']
                or (r['route']=='CODEX_SSH' and activation['operator']!='codex-ssh')
                or any(type(r.get(k)) is not int or r[k]!=0 for k in ['ordersSent','cancelsSent','positionChangesSent'])):
            raise ValueError('SHARED_RISK_COMMITTED_RESTART_BINDING_INVALID')
        rows=r.get('auditCycles')
        if not isinstance(rows,list) or len(rows)<3:raise ValueError('SHARED_RISK_COMMITTED_RESTART_AUDIT_MISSING')
        updates=[]
        for row in rows:
            at=row.get('riskSnapshot',{}).get('updatedAt')
            if (row.get('status')!='SHARED_RISK_REAL_REFRESH_VERIFIED' or row.get('runtimeSha')!=sha
                    or row.get('ordersEnabled') is not False or type(at) is not int or at<=0):
                raise ValueError('SHARED_RISK_COMMITTED_RESTART_AUDIT_INVALID')
            updates.append(at)
        if len(set(updates))<3:raise ValueError('SHARED_RISK_COMMITTED_RESTART_AUDIT_DUPLICATED')
        return dict(status='SHARED_RISK_COMMITTED_NO_ORDER_RESTART_READY',sha=sha,scope=SCOPE,ordersEnabled=False)
    if plan['runners']!=pins:raise ValueError('SHARED_RISK_PRESTART_EXACT_PLAN_MISMATCH')
    _validate_scoped_activation(activation,args,plan,plan_hash,now=now)
    if activation['expiresAt']<=now:raise ValueError('SHARED_RISK_PRESTART_APPROVAL_EXPIRED')
    return dict(status='SHARED_RISK_NO_ORDER_PRESTART_READY',sha=sha,scope=SCOPE,ordersEnabled=False)


def render_dropin(sha):
    if not isinstance(sha,str) or not SHA.fullmatch(sha):raise ValueError('exact Shared Risk SHA required')
    root=(RELEASES/sha).as_posix()
    # Provision ONLY under disdex-shared-crypto-risk@<sha>.service.d, never
    # under the template: existing Writer and other Runner units stay intact.
    return ('[Service]\n'
        'EnvironmentFile=/etc/disdex/current-runtime/'+sha+'-shared-risk-scoped.env\n'
        'ExecStartPre=+/usr/bin/python3 /usr/local/libexec/disdex-unified/disdex_shared_risk_prestart.py --sha '+sha+'\n'
        'ExecStart=\nExecStart=/usr/bin/node --import '+root+'/node_modules/tsx/dist/loader.mjs '
        +root+'/scripts/disdex-shared-crypto-risk-writer.ts --daemon\n')


def render_environment(sha):
    if not isinstance(sha,str) or not SHA.fullmatch(sha):raise ValueError('exact Shared Risk SHA required')
    # EnvironmentFile takes precedence over Environment= in systemd. A new
    # non-secret exact-instance file must be last; loading the old common
    # file then using Environment=new would silently retain the old SHA.
    values=dict(DISDEX_RELEASE_SHA=sha,DISDEX_RUNTIME_COMMIT_SHA=sha,
        DISDEX_RELEASE_ROOT=(RELEASES/sha).as_posix(),
        DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH='/var/lib/disdex/shared/crypto-daily-risk.json',
        DISDEX_PORTFOLIO_DD_GOVERNOR_PATH='/var/lib/disdex/shared/portfolio-dd-governor.json',
        DISDEX_RESIDENT_STOP_OBSERVATION_PATH='/var/lib/disdex/shared/resident-stop-observation.json',
        DISDEX_RUNNER_PIN_MANIFEST_PATH='/etc/disdex/runner-pins.json',
        DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH='/var/lib/disdex/shared/aster-rate-budget.json',
        DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT='7.5',DISDEX_SHARED_RISK_ORDERS_ENABLED='false')
    return ''.join(k+'='+v+'\n' for k,v in values.items())


def main():
    from disdex_unified_root_gate import read_root_json,parse_live_pins,release_marker,assert_regular_secure
    if os.geteuid()!=0 or len(sys.argv)!=3 or sys.argv[1]!='--sha' or not SHA.fullmatch(sys.argv[2]):
        raise ValueError('SHARED_RISK_PRESTART_ROOT_EXACT_SHA_REQUIRED')
    sha=sys.argv[2];release=release_marker(sha)
    if (os.environ.get('DISDEX_SHARED_RISK_ORDERS_ENABLED')!='false'
            or os.environ.get('DISDEX_RUNTIME_COMMIT_SHA')!=sha):
        raise ValueError('SHARED_RISK_PRESTART_ENVIRONMENT_MISMATCH')
    for p in [release/'scripts/disdex-shared-crypto-risk-writer.ts',release/'node_modules/tsx/dist/loader.mjs']:
        s=assert_regular_secure(p,private=False)
        if s.st_mode&0o222:raise ValueError('SHARED_RISK_PRESTART_SOURCE_WRITABLE')
    plan=read_root_json(ROOT/'plans'/SCOPE/(sha+'.json'))
    activation=read_root_json(ROOT/'activations'/SCOPE/(sha+'.json'))
    pins=parse_live_pins(read_root_json(Path('/etc/disdex/runner-pins.json'),private=False))
    result=subprocess.run(['systemctl','list-units','--no-legend','--plain','--no-pager',
        '--type=service','--state=active,activating','disdex-shared-crypto-risk@*.service'],
        capture_output=True,text=True,timeout=12)
    if result.returncode:raise ValueError('SHARED_RISK_PRESTART_SYSTEMD_READ_FAILED')
    active=[line.split()[0] for line in result.stdout.splitlines() if line.strip()]
    committed=[]
    for path in (ROOT/'receipts').glob('shared_crypto_risk_only-'+sha+'-*.json'):
        receipt=read_root_json(path)
        if receipt.get('status')=='SHARED_RISK_CUTOVER_VERIFIED':committed.append(receipt)
    if len(committed)>1:raise ValueError('SHARED_RISK_COMMITTED_RESTART_AMBIGUOUS')
    if committed:
        # A committed receipt is not a fresh approval token. Require evidence
        # that its one-use deployment nonce was actually consumed by root.
        digest=committed[0].get('nonceDigest')
        consumed=[]
        for path in (ROOT/'nonces').iterdir():
            if len(path.name)==32 and all(c in '0123456789abcdef' for c in path.name):
                if hashlib.sha256(path.name.encode('ascii')).hexdigest()==digest:
                    assert_regular_secure(path,private=True);consumed.append(path)
        if len(consumed)!=1:raise ValueError('SHARED_RISK_COMMITTED_NONCE_NOT_PROVEN')
    verified=validate_prestart(sha=sha,plan=plan,activation=activation,pins=pins,
        active_writers=active,now=int(time.time()),committed_receipt=committed[0] if committed else None,
        current_plan=read_root_json(ROOT/'current-plan.json') if committed else None)
    # A no-order Writer must be able to replace an old snapshot after reboot.
    # Historical validation preserves the hash/latch; it does NOT certify a
    # stale snapshot as fresh or grant orders before real API refresh succeeds.
    from disdex_shared_risk_witness import ProductionSharedRiskReader
    risk=ProductionSharedRiskReader().read_risk(allow_historical=True)
    if risk.get('maximumLossPct')!=7.5:raise ValueError('SHARED_RISK_PRESTART_LIMIT_MISMATCH')
    verified['inheritedRiskUpdatedAt']=risk['updatedAt']
    verified['inheritedLatchTripped']=risk['tripped']
    print(json.dumps(verified,sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception:
        print('SHARED_RISK_NO_ORDER_PRESTART_FAIL_CLOSED',file=sys.stderr)
        sys.exit(2)
