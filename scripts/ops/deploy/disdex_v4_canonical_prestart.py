#!/usr/bin/env python3
"""Separate the canonical operator target from immutable V4 strategy policy."""
from pathlib import Path
from datetime import datetime,timezone
import json,time,subprocess
import hmac

POLICY='V12_V4_V2_M150_D05_CORE_NATIVE'
TARGET='DD1296_FINAL_ALLIN_10BPS'

def run_certificate_process(command,*,deploy_gid,**kwargs):
    # The immutable certificate reader binds gid to its primary process group.
    # Keep root uid for root-only grants; use the certificate's existing group.
    if type(deploy_gid) is not int or deploy_gid<=0:raise ValueError('V4_CANONICAL_DEPLOY_GROUP_REQUIRED')
    return subprocess.run(command,group=deploy_gid,**kwargs)

def credential_binding_valid(expected,actual):
    for key in ['ASTER_API_PRIVATE_KEY','ASTER_USER_ADDRESS','ASTER_FUTURES_BASE_URL']:
        default='https://fapi.asterdex.com' if key=='ASTER_FUTURES_BASE_URL' else ''
        left=str(expected.get(key,default)).strip().lower().rstrip('/')
        right=str(actual.get(key,default)).strip().lower().rstrip('/')
        if not left or not right or not hmac.compare_digest(left,right):return False
        if key=='ASTER_FUTURES_BASE_URL' and left!='https://fapi.asterdex.com':return False
    return True

def validate_activation(a,sha,pins,implementation,now):
    checks=(implementation.get('implementationStatus')=='READY',implementation.get('target')==POLICY,
        implementation.get('blockers')==['OPERATOR_LIVE_ACTIVATION_REQUIRED'],
        a.get('schema')=='disdex-live-operator-activation/v1',a.get('approvedSha')==sha,
        a.get('approvedShaByRunner')==pins,pins.get('V12_V4')==sha,
        a.get('approvedRunners')==['V12_V4'],a.get('target')==TARGET,
        a.get('ordersEnabled') is True,a.get('activationClass')=='FULL_LIVE',
        a.get('operatorAcknowledgement')=='I_ACK_REAL_MONEY_LIVE_ACTIVATION',
        (a.get('route'),a.get('authorizationMethod')) in [('CODEX_SSH','ROOT_SSH_SESSION'),('GITHUB_ACTIONS','OWNER_SIGNED_TOKEN')])
    if not all(checks):raise ValueError('V4_CANONICAL_OPERATOR_POLICY_BINDING_MISMATCH')
    try:approved=datetime.fromisoformat(a['approvedAt'].replace('Z','+00:00')).timestamp()
    except (KeyError,ValueError,TypeError):raise ValueError('V4_CANONICAL_APPROVAL_TIME_INVALID') from None
    if not 0<approved<=now+300:raise ValueError('V4_CANONICAL_APPROVAL_TIME_INVALID')
    return True

def prestart(sha):
    from disdex_unified_root_gate import (_assert_execution_root,release_marker,read_root_json,parse_live_pins,RELEASES)
    _assert_execution_root(0);release=release_marker(sha,RELEASES,root_uid=0)
    a=read_root_json(Path('/var/lib/disdex/shared/operator-activation/v12-v4-full.json'),private=True)
    pins=parse_live_pins(read_root_json(Path('/etc/disdex/runner-pins.json'),private=False),releases=RELEASES)
    implementation=read_root_json(release/'docs/production/v12-v4-implementation-readiness.json',private=False)
    validate_activation(a,sha,pins,implementation,int(time.time()))
    from disdex_pending_maintenance_install import _load_sdk
    import os
    sdk=_load_sdk(RELEASES/'7b7719c65d2c6116d02463fc4603200f28e20762')
    if not credential_binding_valid(sdk.load_server_credentials(),os.environ):
        raise ValueError('V4_CANONICAL_CREDENTIAL_ACCOUNT_BINDING_MISMATCH')
    script="""
import {readV4ProductionCertificate} from './lib/v12-v4-certified-gates.ts';
import {readV4TimeStopApproval} from './lib/v12-v4-time-stop-approval.ts';
import {assertV4EntrySafety} from './lib/v12-v4-entry-safety.ts';
await readV4ProductionCertificate(process.argv[1]);
await assertV4EntrySafety({env:{DISDEX_SHARED_KILL_SWITCH_FILE:'/var/lib/disdex/shared/kill-switch.json'}});
console.log('V4_CANONICAL_CERTIFICATE_AND_SAFETY_READY');
"""
    import pwd
    deploy=pwd.getpwnam('deploy')
    r=run_certificate_process(['/usr/bin/node','--import',str(release/'node_modules/tsx/dist/loader.mjs'),
        '--input-type=module','--eval',script,sha],deploy_gid=deploy.pw_gid,cwd=release,capture_output=True,text=True,timeout=30)
    if r.returncode or r.stdout.strip()!='V4_CANONICAL_CERTIFICATE_AND_SAFETY_READY':
        raise ValueError('V4_CANONICAL_CERTIFICATE_OR_SAFETY_BLOCKED')
    # Check TIME37 with the actual deploy group permission semantics separately.
    r=subprocess.run(['/usr/bin/node','--import',str(release/'node_modules/tsx/dist/loader.mjs'),
        '--input-type=module','--eval',"import {readV4TimeStopApproval} from './lib/v12-v4-time-stop-approval.ts';await readV4TimeStopApproval(process.argv[1]);",sha],
        cwd=release,user=deploy.pw_uid,group=deploy.pw_gid,extra_groups=[],capture_output=True,text=True,timeout=30)
    if r.returncode:raise ValueError('V4_CANONICAL_TIME37_APPROVAL_BLOCKED')
    return dict(status='V4_CANONICAL_PRESTART_READY',sourceSha=sha,target=TARGET,policy=POLICY)

if __name__=='__main__':
    import argparse,sys
    p=argparse.ArgumentParser();p.add_argument('--sha',required=True);args=p.parse_args()
    try:print(json.dumps(prestart(args.sha),sort_keys=True))
    except Exception as error:
        reason=str(error) if isinstance(error,ValueError) and str(error).startswith('V4_CANONICAL_') else type(error).__name__
        print(json.dumps(dict(status='V4_CANONICAL_PRESTART_BLOCKED',reason=reason)),file=sys.stderr);sys.exit(2)
