"""Actual no-order Risk refresh audit. This module never authorizes orders."""
from datetime import datetime,timezone
from copy import deepcopy
import re
from disdex_deployment_plan import IDS

SHA=re.compile(r'[a-f0-9]{40}\Z')
HASH=re.compile(r'[a-f0-9]{64}\Z')


def validate_shared_risk_cycle(*,before,after,now_ms,expected_sha,writer,
        baseline_peers,observed_peers,before_kill_hash,after_kill_hash,
        before_pending_hash,after_pending_hash):
    if type(now_ms) is not int or now_ms<=0 or not SHA.fullmatch(expected_sha):
        raise ValueError('SHARED_RISK_AUDIT_CLOCK_OR_SHA_INVALID')
    day=datetime.fromtimestamp(now_ms/1000,timezone.utc).date().isoformat()
    for row in [before,after]:
        if (not isinstance(row,dict) or type(row.get('maximumLossPct')) not in [int,float]
                or row['maximumLossPct']!=7.5 or row.get('sourceComplete') is not True
                or type(row.get('tripped')) is not bool
                or type(row.get('updatedAt')) is not int):
            raise ValueError('SHARED_RISK_AUDIT_SOURCE_OR_LIMIT_INVALID')
    if (after.get('utcDay')!=day or after['updatedAt']<=before['updatedAt']
            or before['updatedAt']>now_ms or now_ms-before['updatedAt']>120000
            or after['updatedAt']>now_ms or now_ms-after['updatedAt']>120000):
        raise ValueError('SHARED_RISK_AUDIT_REAL_REFRESH_NOT_PROVEN')
    if before.get('utcDay')==after['utcDay'] and before['tripped'] and not after['tripped']:
        raise ValueError('SHARED_RISK_AUDIT_LATCH_CLEARED')
    if (writer.get('sha')!=expected_sha or writer.get('markerSha')!=expected_sha
            or type(writer.get('pid')) is not int or writer['pid']<=0
            or writer.get('activeState')!='active'
            or writer.get('cwd')!='/home/deploy/disdex-trading/releases/'+expected_sha
            or writer.get('unit')!='disdex-shared-crypto-risk@'+expected_sha+'.service'):
        raise ValueError('SHARED_RISK_AUDIT_WRITER_IDENTITY_MISMATCH')
    expected_peers=set(IDS)-{'SHARED_CRYPTO_RISK'}
    if (not isinstance(baseline_peers,dict) or not isinstance(observed_peers,dict)
            or set(baseline_peers)!=expected_peers or observed_peers!=baseline_peers):
        raise ValueError('SHARED_RISK_AUDIT_PEER_CHANGED')
    for before_hash,after_hash in [(before_kill_hash,after_kill_hash),(before_pending_hash,after_pending_hash)]:
        if not isinstance(before_hash,str) or not HASH.fullmatch(before_hash) or before_hash!=after_hash:
            raise ValueError('SHARED_RISK_AUDIT_PROTECTED_STATE_CHANGED')
    return dict(status='SHARED_RISK_REAL_REFRESH_VERIFIED',tickCompletedAt=after['updatedAt'],
                runtimeSha=expected_sha,tripped=after['tripped'],ordersEnabled=False)


def validate_signed_flat_result(result):
    if (not isinstance(result,dict) or result.get('status')!='PENDING_READONLY_RECONCILE_VERIFIED'
            or any(type(result.get(k)) is not int or result[k]!=0 for k in
                   ['positionCount','openOrderCount','ordersSent','cancelsSent','positionChangesSent'])
            or not HASH.fullmatch(str(result.get('beforeHash','')))
            or result['beforeHash']!=result.get('afterHash')
            or type(result.get('verifiedAt')) is not int or result['verifiedAt']<=0):
        raise ValueError('SHARED_RISK_SIGNED_FLAT_WITNESS_INVALID')


class SharedRiskAuditReader:
    """Wait for real refreshes; timestamps or repeated GETs cannot create ticks.

    Production must supply the real root context and reviewed signed GET reader.
    The dependencies are explicit so isolated tests never contact the venue.
    """
    def __init__(self,*,expected_sha,previous_risk,baseline_peers,kill_hash,pending_hash,
                 read_risk,read_context,signed_flat_get,clock_ms,monotonic,sleep,
                 timeout_seconds=120):
        self.expected_sha=expected_sha
        self.previous=deepcopy(previous_risk)
        self.baseline_peers=deepcopy(baseline_peers)
        self.kill_hash=kill_hash
        self.pending_hash=pending_hash
        self.read_risk=read_risk
        self.read_context=read_context
        self.signed_flat_get=signed_flat_get
        self.clock_ms=clock_ms
        self.monotonic=monotonic
        self.sleep=sleep
        self.timeout_seconds=timeout_seconds
        self.cycles=[]

    def __call__(self,cycle):
        if type(cycle) is not int or cycle!=len(self.cycles):
            raise ValueError('SHARED_RISK_AUDIT_CYCLE_SEQUENCE_INVALID')
        deadline=self.monotonic()+self.timeout_seconds
        while True:
            row=self.read_risk()
            if type(row.get('updatedAt')) is not int:
                raise ValueError('SHARED_RISK_AUDIT_SOURCE_TIMESTAMP_INVALID')
            if row['updatedAt']>self.previous['updatedAt']:break
            if self.monotonic()>=deadline:raise ValueError('SHARED_RISK_REAL_REFRESH_TIMEOUT')
            self.sleep(1)
        signed=self.signed_flat_get()
        validate_signed_flat_result(signed)
        context=self.read_context()
        # Sample risk again after the bounded GET, so a delayed request cannot
        # wrap an older risk/margin view with a newer capture timestamp.
        after=self.read_risk()
        now=self.clock_ms()
        if not 0<=now-signed['verifiedAt']<=300000:
            raise ValueError('SHARED_RISK_SIGNED_FLAT_WITNESS_STALE')
        if signed['afterHash']!=context['pendingHash']:
            raise ValueError('SHARED_RISK_PENDING_CHANGED_AFTER_SIGNED_GET')
        verified=validate_shared_risk_cycle(before=self.previous,after=after,now_ms=now,
            expected_sha=self.expected_sha,writer=context['writer'],
            baseline_peers=self.baseline_peers,observed_peers=context['peers'],
            before_kill_hash=self.kill_hash,after_kill_hash=context['killHash'],
            before_pending_hash=self.pending_hash,after_pending_hash=context['pendingHash'])
        self.previous=deepcopy(after)
        self.cycles.append(verified)
        return dict(verified,riskSnapshot=after,signedFlatProof=signed,context=context)
