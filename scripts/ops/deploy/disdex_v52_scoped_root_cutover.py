"""Route-neutral, independently SHA-bound V52 protected-hold recovery.

An activation authorizes V52 only. Existing FET authority must be verified from
its own pinned release/artifact by the candidate guard. No route may fabricate
Actions provenance or authorize clearing the existing shared protected hold.
"""
import datetime as dt
import hashlib
import json
import re

REPO='dunamishajime-bit/-ai-dex-manager'
TARGET='professional-dismanager.net'
OPERATOR_TARGET='DD1296_FINAL_ALLIN_10BPS'
IDS={'V12_V4','QUALITY102_CAUSAL_V1','V52','PENGU_V8','FET_BRK48_RESIDUAL',
    'HYPE_TREND_LONG','IDLE_PRIORITY_SHORT','SHARED_CRYPTO_RISK','MARGIN_GUARD'}
PLAN_FIELDS={'schema','repository','deploymentTarget','operatorTarget','sourceSha','scope','runners','uiSha',
    'monitorSha','releaseRoots','ordersEnabled'}


def require(value,reason):
    if not value:raise ValueError('V52_SCOPED_'+reason)


def canonical(row):return json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')


def plan_hash(plan):return hashlib.sha256(canonical(plan)).hexdigest()


def validate_scoped_plan(desired,current,pins):
    for row in [desired,current]:
        require(isinstance(row,dict) and set(row)==PLAN_FIELDS,'PLAN_FIELDS')
        require(row['schema']=='disdex-unified-deployment-plan/v2' and row['repository']==REPO
            and row['deploymentTarget']==TARGET and row['operatorTarget']==OPERATOR_TARGET
            and type(row['ordersEnabled']) is bool,'TARGET_OR_PERMISSION')
        require(isinstance(row['runners'],dict) and set(row['runners'])==IDS,'RUNNER_MAP')
        require(all(isinstance(value,str) and re.fullmatch('[a-f0-9]{40}',value)
            for value in [row['sourceSha'],row['uiSha'],row['monitorSha'],*row['runners'].values()]),'SOURCE_SHA')
        roots=row['releaseRoots']
        require(isinstance(roots,dict) and set(roots)=={'runners','ui','monitor'} and all(
            isinstance(v,str) and v.startswith('/') and not any(p in ['','..','.'] for p in v.split('/')[1:])
            for v in roots.values()),'RELEASE_ROOTS')
    require(current['runners']==pins,'STALE_CURRENT_PINS')
    require(desired['scope']=='V52' and desired['ordersEnabled'] is True
        and desired['sourceSha']==desired['runners']['V52'],'EXACT_V52_AUTHORITY')
    require({k for k in IDS if desired['runners'][k]!=current['runners'][k]}=={'V52'}
        and all(desired[k]==current[k] for k in ['uiSha','monitorSha','releaseRoots']),
        'PEER_OR_INFRASTRUCTURE_DELTA')
    return plan_hash(desired)


def build_runtime_activation(plan,authorization,now,*,inventory_digest):
    require(plan.get('scope')=='V52' and plan.get('ordersEnabled') is True,'ACTIVATION_SCOPE')
    for field,expected in [('repository',REPO),('deploymentTarget',TARGET),('operatorTarget',OPERATOR_TARGET),
            ('sourceSha',plan['sourceSha']),('scope','V52'),('planSha256',plan_hash(plan))]:
        require(authorization.get(field)==expected,'APPROVAL_BINDING')
    require(authorization.get('ordersEnabled') is True,'APPROVAL_PERMISSION')
    issued=authorization.get('issuedAt');expires=authorization.get('expiresAt')
    require(type(issued) is int and type(expires) is int and type(now) is int
        and 0<issued<=now<expires and 1<=expires-issued<=300,'APPROVAL_EXPIRED_OR_FUTURE')
    route=authorization.get('route');operator=authorization.get('operator')
    require(route in ['CODEX_SSH','GITHUB_ACTIONS'] and isinstance(operator,str)
        and re.fullmatch('[A-Za-z0-9-]{1,39}',operator),'AUTHORITY_ROUTE')
    if route=='CODEX_SSH':
        require(authorization.get('schema')=='disdex-codex-ssh-root-auth/v1'
            and operator=='codex-ssh' and authorization.get('authorizationMethod')=='ROOT_SSH_SESSION'
            and authorization.get('signatureVerified') is False,'ROOT_AUTHORITY')
    else:
        require(authorization.get('schema')=='disdex-owner-deployment-approval/v2',
                'SIGNED_ROUTE_CANNOT_REUSE_ROOT_SESSION')
    nonce=authorization.get('nonce')
    require(isinstance(nonce,str) and re.fullmatch('[a-f0-9]{32}',nonce)
        and isinstance(inventory_digest,str) and re.fullmatch('[a-f0-9]{64}',inventory_digest),'EVIDENCE_BINDING')
    return dict(schema='disdex-live-operator-activation/v1',target=OPERATOR_TARGET,
        approvedSha=plan['sourceSha'],approvedRunners=['V52'],approvedShaByRunner={'V52':plan['sourceSha']},
        ordersEnabled=True,activationClass='FULL_LIVE',operatorAcknowledgement='I_ACK_REAL_MONEY_LIVE_ACTIVATION',
        approvedAt=dt.datetime.fromtimestamp(issued,dt.timezone.utc).isoformat().replace('+00:00','Z'),
        deploymentApprovalExpiresAt=expires,planSha256=plan_hash(plan),
        authorizationMethod='ROOT_SSH_SESSION' if route=='CODEX_SSH' else 'OWNER_SIGNED_TOKEN',
        authorizedOperator=operator,route=route,signatureVerified=route=='GITHUB_ACTIONS',
        nonceDigest=hashlib.sha256(nonce.encode()).hexdigest(),
        authorizesKillClearance=False,fetCorePreemptionReady=True,
        formalCertification=False,venueLifecycleCertified=False,
        evidence=dict(sourceSha=plan['sourceSha'],inventoryDigest=inventory_digest,
            signedAsterReadOnly=True,startUnderProtectedHold=True,killSwitchActive=True,
            peerAuthorities='UNCHANGED_INDEPENDENT_APPROVALS_REQUIRED',ordersSent=0,cancelsSent=0,positionChangesSent=0),
        notes='V52-only authorization; FULL_LIVE is the existing runtime gate class, not a post-cutover certification. '
            'Existing protected hold is maintained. This artifact does not authorize FET or Kill clearance.')
