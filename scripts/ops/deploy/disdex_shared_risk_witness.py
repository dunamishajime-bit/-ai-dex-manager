#!/usr/bin/env python3
"""Production read-only Shared Risk evidence. Grants no order/service authority.

Signed reads use the reviewed immutable SDK as deploy, inside its account lock
and shared API budget. No retry, registry refresh, activation or Kill mutation.
The special no-order schema deliberately cannot pass the full LIVE venue gate.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import subprocess
import time
from datetime import datetime, timezone

from disdex_deployment_plan import IDS
from disdex_shared_risk_audit import validate_signed_flat_result

SDK_SHA='5304c793bb272f913f80232b6ab6a8e2ea9ee847'
RELEASES=Path('/home/deploy/disdex-trading/releases')
SDK=RELEASES/SDK_SHA
PINS=Path('/etc/disdex/runner-pins.json')
SHARED=Path('/var/lib/disdex/shared')
PENDING=SHARED/'pending-exposure.json'
KILL=SHARED/'kill-switch.json'
RISK=SHARED/'crypto-daily-risk.json'
MARGIN=SHARED/'margin-risk/guard-live.json'


def require(test, code):
    if not test:raise ValueError(code)


def numeric(value):
    return type(value) in (int,float) and math.isfinite(value)


def fresh(row,key,now,age):
    require(type(row.get(key)) is int and 0<=now-row[key]<=age,
            'SHARED_RISK_WITNESS_STALE_OR_FUTURE:'+key)


def build_no_order_witness(signed,health,*,now_ms,pending_hash):
    validate_signed_flat_result(signed)
    fresh(signed,'verifiedAt',now_ms,300000)
    require(signed['afterHash']==pending_hash,'SHARED_RISK_WITNESS_PENDING_RACE')
    risk,margin,pending,kill=(health[k] for k in ['risk','margin','pending','kill'])
    fresh(risk,'updatedAt',now_ms,120000)
    require(risk.get('utcDay')==datetime.fromtimestamp(now_ms/1000,timezone.utc).date().isoformat(),
            'SHARED_RISK_WITNESS_UTC_DAY')
    fields=['lossPct','maximumLossPct','referenceEquity','realizedPnl',
            'unrealizedPnl','fees','funding','netDailyPnl']
    require(all(numeric(risk.get(k)) for k in fields)
            and risk['maximumLossPct']==7.5 and risk['referenceEquity']>0
            and risk.get('sourceComplete') is True and type(risk.get('tripped')) is bool,
            'SHARED_RISK_WITNESS_RISK_SOURCE_OR_LIMIT')
    require(abs(risk['netDailyPnl']-sum(risk[k] for k in ['realizedPnl','unrealizedPnl','fees','funding']))<=1e-6,
            'SHARED_RISK_WITNESS_PNL_INCONSISTENT')
    require(risk['lossPct']<7.5 or risk['tripped'],'SHARED_RISK_WITNESS_LOSS_NOT_LATCHED')
    fresh(margin,'checkedAt',now_ms,900000)
    require(margin.get('stage')=='HEALTHY' and margin.get('ordersAllowed') is True,
            'SHARED_RISK_WITNESS_MARGIN')
    fresh(pending,'updatedAt',now_ms,900000)
    require(isinstance(pending.get('entries'),list),'SHARED_RISK_WITNESS_PENDING_SCHEMA')
    for entry in pending['entries']:
        require(isinstance(entry,dict) and entry.get('status')=='RELEASED'
                and all(numeric(entry.get(k)) and entry[k]>=0 for k in ['gross','notionalUsd']),
                'SHARED_RISK_WITNESS_PENDING_ACTIVE_OR_INVALID')
    require(type(kill.get('active')) is bool and
            (not kill['active'] or kill.get('action')=='HOLD_PROTECTED'),
            'SHARED_RISK_WITNESS_KILL_INVALID')
    empty_digest=hashlib.sha256(b'[]').hexdigest()
    return dict(schema='disdex-shared-risk-no-order-witness/v1',
        scope='SHARED_CRYPTO_RISK_ONLY',ordersEnabled=False,venue='aster',readOnly=True,
        capturedAt=signed['verifiedAt'],riskUpdatedAt=risk['updatedAt'],
        dailyLossLimit=0.075,riskTripped=risk['tripped'],killSwitchActive=kill['active'],
        positionsDigest=empty_digest,protectiveOrdersDigest=empty_digest,
        pendingDigest=pending_hash,signedFlatProof=signed,
        ordersSent=0,cancelsSent=0,positionChangesSent=0)


def signed_get_command():
    return ['/usr/bin/node','--import',str(SDK/'node_modules/tsx/dist/loader.mjs'),
            str(SDK/'scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts'),'--verify-only']


def child_environment(parent,*,home):
    env={k:parent[k] for k in ['ASTER_API_PRIVATE_KEY','ASTER_USER_ADDRESS','ASTER_FUTURES_BASE_URL'] if k in parent}
    env.update(PATH='/usr/bin:/bin',HOME=home,NODE_ENV='production',DISDEX_RELEASE_SHA=SDK_SHA,
               DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=(SHARED/'aster-rate-budget.json').as_posix())
    return env


def json_object(raw):
    def unique(pairs):
        result={}
        for k,v in pairs:
            require(k not in result,'SHARED_RISK_WITNESS_DUPLICATE_FIELD')
            result[k]=v
        return result
    row=json.loads(raw,object_pairs_hook=unique)
    require(isinstance(row,dict),'SHARED_RISK_WITNESS_JSON_NOT_OBJECT')
    return row


def root_immutable(path):
    # All ancestors inside this release are checked, not just the final file.
    require(path.is_relative_to(SDK),'SHARED_RISK_SDK_PATH_ESCAPE')
    for p in [path,*path.parents]:
        s=p.lstat()
        require(not p.is_symlink() and s.st_uid==0 and not s.st_mode&0o222,
                'SHARED_RISK_SDK_NOT_IMMUTABLE')
        if p==SDK:break


def validate_sdk():
    for p in [SDK/'.disdex-release-sha',SDK/'node_modules/tsx/dist/loader.mjs',
              SDK/'scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts',
              SDK/'lib/disdex-shared-crypto-daily-risk.ts']:
        root_immutable(p)
    require((SDK/'.disdex-release-sha').read_text().strip()==SDK_SHA,'SHARED_RISK_SDK_MARKER')


def file_bytes(path):
    s=path.lstat()
    require(stat.S_ISREG(s.st_mode) and not path.is_symlink(),'SHARED_RISK_STATE_NOT_REGULAR')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        actual=os.fstat(fd)
        require((actual.st_dev,actual.st_ino)==(s.st_dev,s.st_ino),'SHARED_RISK_STATE_REPLACED')
        with os.fdopen(fd,'rb',closefd=False) as f:return f.read()
    finally:os.close(fd)


def digest_file(path):return hashlib.sha256(file_bytes(path)).hexdigest()


def validate_writer_inventory(units,expected_unit):
    require(isinstance(units,list) and units==[expected_unit],
            'SHARED_RISK_NOT_EXACTLY_ONE_PINNED_WRITER')


def validate_inherited_risk(row,*,now_ms):
    require(type(row.get('updatedAt')) is int and 0<row['updatedAt']<=now_ms,
            'SHARED_RISK_INHERITED_TIMESTAMP_INVALID')
    day=datetime.fromtimestamp(row['updatedAt']/1000,timezone.utc).date().isoformat()
    require(row.get('utcDay')==day and row.get('maximumLossPct')==7.5
            and type(row.get('tripped')) is bool and row.get('sourceComplete') is True
            and isinstance(row.get('stateHash'),str) and len(row['stateHash'])==64
            and all(c in '0123456789abcdef' for c in row['stateHash']),
            'SHARED_RISK_INHERITED_IDENTITY_OR_LATCH_INVALID')
    fields=['lossPct','referenceEquity','realizedPnl','unrealizedPnl','fees','funding','netDailyPnl']
    require(all(numeric(row.get(k)) for k in fields) and row['referenceEquity']>0
            and row['lossPct']>=0 and (row['lossPct']<7.5 or row['tripped'])
            and abs(row['netDailyPnl']-sum(row[k] for k in ['realizedPnl','unrealizedPnl','fees','funding']))<=1e-6,
            'SHARED_RISK_INHERITED_FINANCIAL_SOURCE_INVALID')


class ProductionSharedRiskReader:
    def __init__(self):
        require(os.geteuid()==0,'SHARED_RISK_READER_ROOT_REQUIRED')
        validate_sdk()

    def signed_flat_get(self):
        import pwd
        deploy=pwd.getpwnam('deploy')
        require(deploy.pw_uid>0 and deploy.pw_gid>0,'SHARED_RISK_DEPLOY_ID_INVALID')
        result=subprocess.run(signed_get_command(),cwd=SDK,
            env=child_environment(os.environ,home=deploy.pw_dir),
            user=deploy.pw_uid,group=deploy.pw_gid,extra_groups=[],
            capture_output=True,text=True,timeout=55)
        # Raw SDK stderr/exception messages must never expose credentials.
        require(result.returncode==0,'SHARED_RISK_SIGNED_READ_FAILED_OR_DEFERRED')
        rows=[json_object(line) for line in result.stdout.splitlines() if line.startswith('{')]
        require(len(rows)==1,'SHARED_RISK_SIGNED_READ_OUTPUT')
        validate_signed_flat_result(rows[0])
        require(rows[0]['afterHash']==digest_file(PENDING),'SHARED_RISK_PENDING_CHANGED_AFTER_GET')
        return rows[0]

    def read_risk(self,*,allow_historical=False):
        # Use the real TS hash validator: Python JSON float formatting must not
        # invent a different canonical hash for an existing Risk snapshot.
        script=("import {readSharedCryptoDailyRisk,validateSharedCryptoDailyRisk} from './lib/disdex-shared-crypto-daily-risk.ts';"
                + ("import {readFile} from 'node:fs/promises';"
                   "const raw=JSON.parse(await readFile('/var/lib/disdex/shared/crypto-daily-risk.json','utf8'));"
                   "if(!Number.isSafeInteger(raw.updatedAt)||raw.updatedAt>Date.now()||typeof raw.stateHash!=='string'||!/^[a-f0-9]{64}$/.test(raw.stateHash))process.exit(2);"
                   "const r=validateSharedCryptoDailyRisk(raw,raw.updatedAt,0);" if allow_historical else
                "const r=await readSharedCryptoDailyRisk('/var/lib/disdex/shared/crypto-daily-risk.json');"
                )+
                "if(!r.state||(!r.ok&&r.reason!=='DAILY_LOSS_TRIPPED'))process.exit(2);"
                "console.log(JSON.stringify(r.state));")
        result=subprocess.run(['/usr/bin/node','--import',str(SDK/'node_modules/tsx/dist/loader.mjs'),
                '--input-type=module','-e',script],cwd=SDK,env={'PATH':'/usr/bin:/bin'},
                capture_output=True,text=True,timeout=12)
        require(result.returncode==0,'SHARED_RISK_HASH_OR_STATE_INVALID')
        row=json_object(result.stdout)
        if allow_historical:validate_inherited_risk(row,now_ms=time.time_ns()//1000000)
        return row

    def read_context(self):
        from disdex_unified_root_gate import PREFIXES,STOP_OWNERS
        manifest=json_object(file_bytes(PINS))
        require(manifest.get('schema')=='disdex-runner-pin-manifest/v1'
                and set(manifest.get('runners',{}))==set(IDS),'SHARED_RISK_PIN_SCHEMA')
        peers={}
        for key,entry in manifest['runners'].items():
            sha=entry.get('sha');unit=entry.get('serviceUnit');root=RELEASES/str(sha)
            require(isinstance(sha,str) and len(sha)==40 and all(c in '0123456789abcdef' for c in sha)
                    and entry.get('releaseRoot')==str(root)
                    and unit==PREFIXES[key]+'@'+sha+'.service'
                    and entry.get('stopOwner')==STOP_OWNERS[key],'SHARED_RISK_PIN_IDENTITY')
            marker=root/'.disdex-release-sha'
            require(file_bytes(marker).decode().strip()==sha,'SHARED_RISK_PEER_MARKER')
            require(not root.is_symlink(),'SHARED_RISK_PEER_ROOT_LINK')
            proc=subprocess.run(['systemctl','show',unit,'-p','MainPID','-p','ActiveState',
                '-p','NRestarts','-p','ExecStart','-p','ExecStartPre'],capture_output=True,text=True,timeout=12)
            require(proc.returncode==0,'SHARED_RISK_SYSTEMD_READ_FAILED')
            properties=dict(line.split('=',1) for line in proc.stdout.splitlines() if '=' in line)
            pid=int(properties['MainPID']);state=properties['ActiveState']
            require((state=='active' and pid>0) or (state in ['failed','inactive'] and pid==0),
                    'SHARED_RISK_PEER_TRANSITIONING')
            cwd=str(Path('/proc',str(pid),'cwd').resolve(strict=True)) if pid else None
            require(not pid or cwd==str(root),'SHARED_RISK_PEER_CWD')
            s=root.stat();ms=marker.stat()
            peers[key]=dict(sha=sha,markerSha=sha,unit=unit,pid=pid,activeState=state,cwd=cwd,
                nRestarts=int(properties['NRestarts']),releaseMetadata=[s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode)],
                markerMetadata=[ms.st_uid,ms.st_gid,stat.S_IMODE(ms.st_mode)],
                systemdExecutionDigest=hashlib.sha256((properties.get('ExecStart','')+'\n'+properties.get('ExecStartPre','')).encode()).hexdigest())
        writer=peers.pop('SHARED_CRYPTO_RISK')
        active=subprocess.run(['systemctl','list-units','--no-legend','--plain','--no-pager',
            '--type=service','--state=active,activating,deactivating','disdex-shared-crypto-risk@*.service'],
            capture_output=True,text=True,timeout=12)
        require(active.returncode==0,'SHARED_RISK_WRITER_INVENTORY_READ_FAILED')
        validate_writer_inventory([line.split()[0] for line in active.stdout.splitlines() if line.strip()],writer['unit'])
        return dict(writer=writer,peers=peers,killHash=digest_file(KILL),pendingHash=digest_file(PENDING))

    def capture(self):
        before=self.read_context()
        signed=self.signed_flat_get()
        risk=self.read_risk()
        health=dict(risk=risk,margin=json_object(file_bytes(MARGIN)),
                    pending=json_object(file_bytes(PENDING)),kill=json_object(file_bytes(KILL)))
        after=self.read_context()
        require(before==after,'SHARED_RISK_CONTEXT_CHANGED_DURING_GET')
        witness=build_no_order_witness(signed,health,now_ms=time.time_ns()//1000000,pending_hash=after['pendingHash'])
        return dict(witness=witness,context=after,riskSnapshot=risk)


if __name__=='__main__':
    import sys
    try:
        require(sys.argv[1:]==['--verify-only'],'SHARED_RISK_VERIFY_ONLY_REQUIRED')
        from disdex_unified_root_gate import assert_codex_ssh_session
        assert_codex_ssh_session()
        print(json.dumps(dict(status='SHARED_RISK_READONLY_PREFLIGHT_NOT_LIVE',
                              **ProductionSharedRiskReader().capture()),sort_keys=True))
    except Exception as error:
        print(json.dumps(dict(status='SHARED_RISK_READER_FAIL_CLOSED',reason=type(error).__name__,
                              ordersSent=0,cancelsSent=0,positionChangesSent=0)),file=sys.stderr)
        sys.exit(2)
