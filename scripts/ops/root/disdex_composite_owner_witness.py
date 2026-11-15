"""Read-only adapter contract for an immutable composite ownership worker.

The actual SDK worker must collect signed rows under its real account lease,
reuse collectPendingOwnerEvidence/validateOwnedPendingVenue (plus the exact H48
certificate path), and verify the consumed owner files/manifest/registry before
releasing that lease. This module checks its *bound result*, never reimplements
seven strategy proofs or treats counts/health booleans as ownership authority.

Only consume a payload obtained by run_composite_owner_probe's trusted source
invocation. A self-computed digest is integrity evidence, not authentication.
The currently installed counts-only worker intentionally cannot satisfy v1.
No service start, trading call, registry mutation, certificate issuance or
fallback to old sole-owner geometry is provided here.
"""
from decimal import Decimal,InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess

SCHEMA='disdex-composite-owner-witness/v1'
PREFIXES={'V12_V4':'disdex-v12-v4','PENGU_V8':'disdex-pengu-dual-ls-v2','QUALITY102_CAUSAL_V1':'disdex-quality102-causal-v1','V52':'disdex-v52-aster-only','FET_BRK48_RESIDUAL':'disdex-fet-brk48','HYPE_TREND_LONG':'disdex-hype-long','IDLE_PRIORITY_SHORT':'disdex-idle-priority-short'}
OWNER_STATE={'V12_V4':'/var/lib/disdex/v12-v4/orders.json','PENGU_V8':'/var/lib/disdex/pengu-dual-ls-v2/runner-live.json','QUALITY102_CAUSAL_V1':'/var/lib/disdex/quality102-causal-v1/state.json','V52':'/var/lib/disdex/v52-aster-only/runner-live.json','FET_BRK48_RESIDUAL':'/var/lib/disdex/fet-brk48-residual/state.json','HYPE_TREND_LONG':'/var/lib/disdex/hype-zec-long/runner.json','IDLE_PRIORITY_SHORT':'/var/lib/disdex/idle-priority/state.json'}
PIN_KEYS=set(PREFIXES)|{'SHARED_CRYPTO_RISK','MARGIN_GUARD'}
FIELDS={'schema','workerSha','requestNonce','accountScope','signedObservedAt','verifiedAt','expiresAt','inventory','inventorySha256','runnerShaMap','cas','lease','owners','runtimes','effects','proofSha256'}
RELEASES=Path('/home/deploy/disdex-trading/releases')

def require(test,reason):
    if not test:raise ValueError('COMPOSITE_OWNER_'+reason)

def exact(value,keys):return isinstance(value,dict) and set(value)==set(keys)
def sha(value,size=64):return isinstance(value,str) and re.fullmatch('[a-f0-9]{'+str(size)+'}',value) is not None
def integer(value):return type(value)is int and 0<value<=9007199254740991
def canonical_digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def decimal(value):
    require(type(value) in (str,int,float),'INVALID_NUMERIC_TYPE')
    if isinstance(value,str):require(bool(re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?',value.strip())),'INVALID_NUMERIC_TEXT')
    try:out=Decimal(str(value))
    except (ValueError,InvalidOperation):raise ValueError('COMPOSITE_OWNER_INVALID_NUMERIC') from None
    require(out.is_finite(),'NONFINITE_NUMERIC')
    return out

def number_text(value):
    n=value if isinstance(value,Decimal) else decimal(value)
    return '0' if n==0 else format(n.normalize(),'f')

def inventory_snapshot(positions,orders):
    require(isinstance(positions,list) and isinstance(orders,list),'SIGNED_ARRAY_REQUIRED')
    result_positions=[];seen=set()
    for p in positions:
        require(isinstance(p,dict),'POSITION_ROW')
        qty=decimal(p.get('positionAmt'))
        if qty==0:continue
        symbol=p.get('symbol');side=p.get('positionSide')
        require(isinstance(symbol,str) and re.fullmatch('[A-Z0-9]+USDT',symbol) and symbol not in seen and side in ('BOTH','LONG','SHORT'),'POSITION_IDENTITY_OR_HEDGE')
        require(decimal(p.get('entryPrice'))>0,'POSITION_ENTRY_PRICE')
        require(side=='BOTH' or (side=='LONG' and qty>0) or (side=='SHORT' and qty<0),'POSITION_SIDE')
        seen.add(symbol);result_positions.append(dict(symbol=symbol,positionSide=side,positionAmt=number_text(qty),entryPrice=number_text(p['entryPrice'])))
    result_orders=[];ids=set()
    for o in orders:
        require(isinstance(o,dict),'ORDER_ROW')
        cid=o.get('clientOrderId');symbol=o.get('symbol');oid=o.get('orderId')
        require(isinstance(cid,str) and bool(cid) and cid==cid.strip() and cid not in ids and isinstance(symbol,str) and re.fullmatch('[A-Z0-9]+USDT',symbol),'ORDER_IDENTITY')
        require(type(oid) in (str,int) and re.fullmatch('[1-9][0-9]*',str(oid)) is not None,'ORDER_ID')
        require(o.get('side') in ('BUY','SELL') and o.get('type') in ('STOP_MARKET','TAKE_PROFIT_MARKET') and o.get('reduceOnly')is True and o.get('status')=='NEW','ORDER_NOT_PROTECTIVE')
        require(decimal(o.get('origQty'))>0 and decimal(o.get('executedQty'))==0 and decimal(o.get('stopPrice'))>0,'ORDER_PARTIAL_OR_PRICE')
        ids.add(cid);result_orders.append(dict(symbol=symbol,clientOrderId=cid,orderId=str(oid),side=o['side'],type=o['type'],origQty=number_text(o['origQty']),executedQty='0',reduceOnly=True,status='NEW',stopPrice=number_text(o['stopPrice'])))
    return {'positions':sorted(result_positions,key=lambda p:(p['symbol'],p['positionSide'])),'orders':sorted(result_orders,key=lambda o:(o['symbol'],o['clientOrderId'],o['orderId'],o['type'],o['side']))}

def composite_probe_command(worker_sha,nonce):
    require(sha(worker_sha,40) and sha(nonce,32),'WORKER_SOURCE_OR_NONCE')
    return ['/usr/bin/python3',(RELEASES/worker_sha/'scripts/ops/deploy/disdex_pending_maintenance.py').as_posix(),'--owned-venue-witness',nonce]

def validate_composite_owner_witness(value,*,worker_sha,request_nonce,expected_pins,pin_manifest_sha256,registry_sha256,positions,orders,root_runtimes,now_ms):
    require(sha(worker_sha,40) and sha(request_nonce,32) and sha(pin_manifest_sha256) and sha(registry_sha256) and integer(now_ms),'CALLER_BINDING')
    require(isinstance(expected_pins,dict) and set(expected_pins)==PIN_KEYS and all(sha(s,40) for s in expected_pins.values()),'CALLER_PIN_MAP')
    # Produced independently by the root witness's systemd + /proc attestor,
    # never copied from the child payload or replaced with a health boolean.
    require(isinstance(root_runtimes,dict),'ROOT_PROCESS_ATTESTATION_REQUIRED')
    p=value
    require(exact(p,FIELDS) and p['schema']==SCHEMA and p['workerSha']==worker_sha and p['requestNonce']==request_nonce and p['accountScope']=='ASTER_FUTURES','PROOF_IDENTITY')
    require(sha(p['proofSha256']) and p['proofSha256']==canonical_digest({k:v for k,v in p.items() if k!='proofSha256'}),'PROOF_DIGEST')
    require(exact(p['signedObservedAt'],['positions','orders','balances']) and all(integer(t) and 0<=now_ms-t<=120000 for t in p['signedObservedAt'].values()),'SIGNED_READ_STALE_OR_FUTURE')
    require(integer(p['verifiedAt']) and max(p['signedObservedAt'].values())<=p['verifiedAt']<=now_ms and integer(p['expiresAt']) and now_ms<p['expiresAt']<=min(p['signedObservedAt'].values())+120000,'PROOF_WINDOW')
    require(p['runnerShaMap']==expected_pins,'PIN_MAP_CHANGED')
    inventory=inventory_snapshot(positions,orders)
    require(exact(p['inventory'],['positions','orders']) and p['inventory']==inventory and sha(p['inventorySha256']) and p['inventorySha256']==canonical_digest(inventory),'SIGNED_INVENTORY_DIVERGED')
    c=p['cas']
    require(exact(c,['pinManifestSha256','registryBeforeSha256','registryAfterSha256','ownerFilesBefore','ownerFilesAfter']) and c['pinManifestSha256']==pin_manifest_sha256 and c['registryBeforeSha256']==registry_sha256 and c['registryAfterSha256']==registry_sha256,'AUTHORITY_CAS_CHANGED')
    files=c['ownerFilesBefore']
    require(isinstance(files,dict) and files==c['ownerFilesAfter'] and all(isinstance(path,str) and path.startswith(('/var/lib/disdex/','/home/deploy/disdex-trading/releases/','/etc/disdex/stable4/h48-time-only/','/etc/disdex/stable4/holds/')) and '..'not in Path(path).parts and sha(h) for path,h in files.items()),'OWNER_FILE_CAS_CHANGED')
    lease=p['lease']
    require(exact(lease,['ownerId','leaseId','acquiredAt','checkedAt','expiresAt']) and lease['ownerId']=='PENDING_READONLY_WITNESS' and isinstance(lease['leaseId'],str) and bool(lease['leaseId']) and all(integer(lease[k]) for k in ['acquiredAt','checkedAt','expiresAt']) and lease['acquiredAt']<=min(p['signedObservedAt'].values())<=p['verifiedAt']<=lease['checkedAt']<=now_ms<lease['expiresAt'],'ACCOUNT_LEASE_UNVERIFIED')
    require(exact(p['effects'],['ordersSent','cancelsSent','positionChangesSent','registryWrites']) and all(type(v)is int and v==0 for v in p['effects'].values()),'MUTATION_NOT_ZERO')
    require(isinstance(p['owners'],list) and isinstance(p['runtimes'],list),'OWNER_ARRAYS')
    by_symbol={row['symbol']:row for row in inventory['positions']};by_order={row['clientOrderId']:row for row in inventory['orders']};covered=set();used=set();runners=set();time_only=[];native_state=[]
    for owner in p['owners']:
        require(exact(owner,['symbol','runner','sourceSha','policy','orderIds','certificateSha256']),'OWNER_FIELDS')
        symbol=owner['symbol'];runner=owner['runner']
        require(symbol in by_symbol and symbol not in covered and runner in PREFIXES and owner['sourceSha']==expected_pins[runner] and isinstance(owner['orderIds'],list) and all(isinstance(cid,str) for cid in owner['orderIds']) and len(set(owner['orderIds']))==len(owner['orderIds']),'OWNER_BINDING')
        covered.add(symbol);runners.add(runner)
        require(OWNER_STATE[runner] in files,'OWNER_FILES_MISSING')
        if owner['policy']=='H48_TIME_ONLY':
            require(runner=='HYPE_TREND_LONG' and symbol=='HYPEUSDT' and decimal(by_symbol[symbol]['positionAmt'])>0 and owner['orderIds']==[] and sha(owner['certificateSha256']) and not any(o['symbol']==symbol for o in inventory['orders']),'H48_POLICY_NOT_EXACT')
            require(files.get('/etc/disdex/stable4/h48-time-only/'+owner['sourceSha']+'.json')==owner['certificateSha256'],'H48_CERTIFICATE_NOT_CONSUMED')
            time_only.append(symbol)
        elif owner['policy']=='V52_NATIVE_STATE':
            require(runner=='V52' and symbol in {'AMZNUSDT','METAUSDT','MSFTUSDT','NVDAUSDT','TSLAUSDT'} and owner['orderIds']==[] and owner['certificateSha256']is None and not any(o['symbol']==symbol for o in inventory['orders']),'V52_POLICY_NOT_EXACT')
            require('/var/lib/disdex/shared/margin-risk/guard-live.json' in files,'V52_MARGIN_EVIDENCE_MISSING')
            native_state.append(symbol)
        else:
            require(owner['policy']=='RESIDENT_STOP' and owner['certificateSha256']is None and bool(owner['orderIds']),'STOP_PROOF_MISSING')
            expected_side='SELL' if decimal(by_symbol[symbol]['positionAmt'])>0 else 'BUY'
            stops=[]
            for cid in owner['orderIds']:
                require(cid in by_order and cid not in used and by_order[cid]['symbol']==symbol and by_order[cid]['side']==expected_side,'STOP_OWNER_IDENTITY')
                used.add(cid)
                if by_order[cid]['type']=='STOP_MARKET':stops.append(by_order[cid])
            require(sum((decimal(o['origQty']) for o in stops),Decimal(0))>=abs(decimal(by_symbol[symbol]['positionAmt'])),'RESIDENT_STOP_LOST_OR_PARTIAL')
    require(covered==set(by_symbol) and used==set(by_order),'OWNER_SET_INCOMPLETE_OR_FOREIGN_ORDER')
    observed=set()
    for runtime in p['runtimes']:
        require(exact(runtime,['runner','sourceSha','unit','pid','cwd']),'RUNTIME_FIELDS')
        runner=runtime['runner'];source=runtime['sourceSha']
        require(runner in runners and runner not in observed and source==expected_pins[runner] and runtime['unit']==PREFIXES[runner]+'@'+source+'.service' and integer(runtime['pid']) and runtime['cwd']==(RELEASES/source).as_posix(),'RUNTIME_SOURCE_PID_CWD')
        attested=root_runtimes.get(runner)
        require(exact(attested,['sourceSha','unit','pid','cwd','observedAt']) and {k:attested[k] for k in ['sourceSha','unit','pid','cwd']}=={k:runtime[k] for k in ['sourceSha','unit','pid','cwd']} and integer(attested['observedAt']) and 0<=now_ms-attested['observedAt']<=120000,'ROOT_PROCESS_ATTESTATION_MISMATCH')
        observed.add(runner)
    require(observed==runners,'OWNER_RUNTIME_MISSING')
    return {'schema':SCHEMA,'proofSha256':p['proofSha256'],'inventorySha256':p['inventorySha256'],'workerSha':worker_sha,'verifiedAt':p['verifiedAt'],'ownerRunners':sorted(runners),'timeOnlySymbols':sorted(time_only),'nativeStateSymbols':sorted(native_state),'protectiveStopSymbols':sorted(set(by_symbol)-set(time_only)-set(native_state)),'authorizesTrading':False,'ordersSent':0,'cancelsSent':0,'positionChangesSent':0,'registryWrites':0}

def _immutable_root_file(path):
    before=path.lstat()
    require(stat.S_ISREG(before.st_mode) and not path.is_symlink() and before.st_uid==0 and before.st_mode&0o222==0,'WORKER_SOURCE_NOT_IMMUTABLE_ROOT_FILE')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        actual=os.fstat(f.fileno());raw=f.read(4*1024*1024+1)
    after=path.lstat()
    require(len(raw)<=4*1024*1024 and (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_mode,before.st_uid)==(actual.st_dev,actual.st_ino,actual.st_size,actual.st_mtime_ns,actual.st_mode,actual.st_uid)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_mode,after.st_uid),'WORKER_SOURCE_CHANGED')
    return raw

def run_composite_owner_probe(*,worker_sha,expected_entrypoint_sha256,environment):
    """Root caller supplies its already validated no-order worker source/secret environment.

    Fixed command only; actual immutable root file and source marker are re-read
    before and after execution. No stdout/stderr/secret environment is logged.
    Returns payload+challenge for validate_composite_owner_witness; it does not
    itself validate the current account inventory, pins or registry snapshot.
    """
    require(hasattr(os,'geteuid') and os.geteuid()==0,'ROOT_REQUIRED')
    require(sha(expected_entrypoint_sha256),'WORKER_ENTRYPOINT_HASH')
    allowed={'ASTER_API_PRIVATE_KEY','ASTER_USER_ADDRESS','ASTER_FUTURES_BASE_URL'}
    require(isinstance(environment,dict) and set(environment)<=allowed and all(isinstance(k,str) and isinstance(v,str) for k,v in environment.items()),'WORKER_ENVIRONMENT_SCOPE')
    child_env={**environment,'PATH':'/usr/bin:/bin','PYTHONNOUSERSITE':'1','PYTHONDONTWRITEBYTECODE':'1','NODE_ENV':'production','DISDEX_RELEASE_SHA':worker_sha,'DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH':'/var/lib/disdex/shared/aster-rate-budget.json'}
    nonce=secrets.token_hex(16);command=composite_probe_command(worker_sha,nonce);entry=Path(command[1]);marker=RELEASES/worker_sha/'.disdex-release-sha'
    raw=_immutable_root_file(entry);mark=_immutable_root_file(marker)
    require(hashlib.sha256(raw).hexdigest()==expected_entrypoint_sha256 and mark.decode().strip()==worker_sha,'WORKER_SOURCE_BINDING')
    # A cold native journal replay may take several minutes. Killing the
    # lease-owning worker at the old 55-second limit can leave an orphan lease;
    # freshness and lease expiry still independently reject stale evidence.
    result=subprocess.run(command,cwd=RELEASES/worker_sha,env=child_env,capture_output=True,text=True,timeout=600,check=False)
    require(result.returncode==0,'WORKER_FAILED_OR_DEFERRED')
    require(_immutable_root_file(entry)==raw and _immutable_root_file(marker)==mark,'WORKER_SOURCE_CHANGED')
    def unique(pairs):
        row={}
        for key,value in pairs:require(key not in row,'DUPLICATE_JSON_FIELD');row[key]=value
        return row
    try:
        require(len(result.stdout.encode())<=4*1024*1024,'WORKER_PROOF_TOO_LARGE')
        payload=json.loads(result.stdout,object_pairs_hook=unique)
    except (ValueError,UnicodeError):raise ValueError('COMPOSITE_OWNER_WORKER_JSON_INVALID') from None
    require(isinstance(payload,dict),'WORKER_PROOF_NOT_OBJECT')
    return payload,nonce
