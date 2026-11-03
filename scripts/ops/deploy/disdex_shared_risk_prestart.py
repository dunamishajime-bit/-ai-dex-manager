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


def validate_prestart(*,sha,plan,activation,pins,active_writers,now):
    from disdex_unified_root_gate import _validate_scoped_activation
    validate(plan)
    if (not isinstance(sha,str) or not SHA.fullmatch(sha)
            or plan['scope']!=SCOPE or plan['sourceSha']!=sha
            or plan['ordersEnabled'] is not False
            or plan['runners']['SHARED_CRYPTO_RISK']!=sha or plan['runners']!=pins):
        raise ValueError('SHARED_RISK_PRESTART_EXACT_PLAN_MISMATCH')
    unit='disdex-shared-crypto-risk@'+sha+'.service'
    if (not isinstance(active_writers,list) or len(active_writers)>1
            or any(u!=unit for u in active_writers)):
        raise ValueError('SHARED_RISK_PRESTART_OTHER_WRITER_ACTIVE')
    args=SimpleNamespace(scope=SCOPE,sha=sha,owner=activation.get('operator'))
    _validate_scoped_activation(activation,args,plan,hashlib.sha256(canonical(plan)).hexdigest(),now=now)
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
    verified=validate_prestart(sha=sha,plan=plan,activation=activation,pins=pins,
                              active_writers=active,now=int(time.time()))
    # Validate the inherited snapshot's actual TS hash and freshness without
    # requiring a new order activation or a fake V4 heartbeat.
    from disdex_shared_risk_witness import ProductionSharedRiskReader
    risk=ProductionSharedRiskReader().read_risk()
    if risk.get('maximumLossPct')!=7.5:raise ValueError('SHARED_RISK_PRESTART_LIMIT_MISMATCH')
    print(json.dumps(verified,sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception:
        print('SHARED_RISK_NO_ORDER_PRESTART_FAIL_CLOSED',file=sys.stderr)
        sys.exit(2)
