"""Root-only composite owner bridge. Source generation never installs it.

The optional root receipt selects an already approved immutable maintenance
worker. All current risk, heartbeat and signed account gates stay in the caller.
Missing receipt retains the existing sole-V4 check; malformed receipts fail.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time
from disdex_composite_owner_witness import (PREFIXES, RELEASES, PIN_KEYS,
    run_composite_owner_probe, validate_composite_owner_witness)

CONFIG=Path('/etc/disdex/stable4/composite-owner-worker.json')
PINS=Path('/etc/disdex/runner-pins.json')
REGISTRY=Path('/var/lib/disdex/shared/pending-exposure.json')
BASE_HASH='99c224070708f4714090e1dfb969ffbec41b12a5933bf37c22373a55cdba6c3c'

def require(test,reason):
    if not test:raise ValueError('STABLE4_COMPOSITE_ROOT_'+reason)

def digest(raw):return hashlib.sha256(raw).hexdigest()

def read_root_receipt(path=CONFIG):
    try:before=path.lstat()
    except FileNotFoundError:return None
    require(stat.S_ISREG(before.st_mode) and not path.is_symlink() and before.st_uid==0 and before.st_gid==0 and before.st_mode&0o222==0,'RECEIPT_METADATA')
    raw=path.read_bytes();after=path.lstat()
    require((before.st_dev,before.st_ino,before.st_mtime_ns,before.st_size)==(after.st_dev,after.st_ino,after.st_mtime_ns,after.st_size) and path.read_bytes()==raw,'RECEIPT_CHANGED')
    def unique(pairs):
        result={}
        for k,v in pairs:
            require(k not in result,'DUPLICATE_KEY');result[k]=v
        return result
    value=json.loads(raw,object_pairs_hook=unique)
    return validate_worker_receipt(value)

def validate_worker_receipt(value):
    import re
    require(isinstance(value,dict) and set(value)=={'schema','workerSha','entrypointSha256','authorizesTrading'} and value['schema']=='disdex-stable4-composite-owner-worker/v1' and value['authorizesTrading'] is False,'RECEIPT_FIELDS')
    require(isinstance(value['workerSha'],str) and re.fullmatch('[a-f0-9]{40}',value['workerSha']) and isinstance(value['entrypointSha256'],str) and re.fullmatch('[a-f0-9]{64}',value['entrypointSha256']),'RECEIPT_SOURCE')
    return value

def attest_runtime(runner,source,*,run=subprocess.run,readlink=os.readlink,now_ms=None):
    require(runner in PREFIXES,'RUNTIME_ROLE')
    unit=PREFIXES[runner]+'@'+source+'.service'
    result=run(['/usr/bin/systemctl','show',unit,'--property=ActiveState,MainPID'],capture_output=True,text=True,check=False,timeout=10)
    require(result.returncode==0,'RUNTIME_QUERY')
    rows=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    require(rows.get('ActiveState')=='active' and rows.get('MainPID','').isdigit() and int(rows['MainPID'])>0,'RUNTIME_INACTIVE')
    pid=int(rows['MainPID']);cwd=readlink('/proc/'+str(pid)+'/cwd')
    require(cwd==str(RELEASES/source),'RUNTIME_CWD')
    return dict(sourceSha=source,unit=unit,pid=pid,cwd=cwd,observedAt=time.time_ns()//1000000 if now_ms is None else now_ms)

def attest_composite_owner(expected_pins,positions,orders,receipt):
    require(os.geteuid()==0,'ROOT_REQUIRED')
    validate_worker_receipt(receipt)
    require(isinstance(expected_pins,dict) and set(expected_pins)==PIN_KEYS,'PIN_MAP')
    manifest=PINS.read_bytes();registry=REGISTRY.read_bytes()
    # The child loads credentials only through its existing secure root reader;
    # no secret is transported in argv, a receipt, stdout or a new file.
    payload,nonce=run_composite_owner_probe(worker_sha=receipt['workerSha'],expected_entrypoint_sha256=receipt['entrypointSha256'],environment={})
    runtimes={}
    for row in payload.get('runtimes',[]):
        require(isinstance(row,dict) and row.get('runner') in PREFIXES,'RUNTIME_PAYLOAD')
        runner=row['runner'];require(runner not in runtimes,'RUNTIME_DUPLICATE')
        runtimes[runner]=attest_runtime(runner,expected_pins[runner])
    require(PINS.read_bytes()==manifest and REGISTRY.read_bytes()==registry,'AUTHORITY_CHANGED')
    now_ms=time.time_ns()//1000000
    proof=validate_composite_owner_witness(payload,worker_sha=receipt['workerSha'],request_nonce=nonce,expected_pins=expected_pins,pin_manifest_sha256=digest(manifest),registry_sha256=digest(registry),positions=positions,orders=orders,root_runtimes=runtimes,now_ms=now_ms)
    # Check the actual bytes after the worker released its lease. Its own CAS
    # claim alone cannot certify that another writer has not changed them.
    for path,expected in payload['cas']['ownerFilesAfter'].items():
        target=Path(path);require(not target.is_symlink() and target.is_file() and digest(target.read_bytes())==expected,'OWNER_FILE_CHANGED')
    for runner,observed in runtimes.items():
        again=attest_runtime(runner,expected_pins[runner])
        require(all(again[k]==observed[k] for k in ['sourceSha','unit','pid','cwd']),'RUNTIME_CHANGED')
    require(PINS.read_bytes()==manifest and REGISTRY.read_bytes()==registry and read_root_receipt()==receipt,'FINAL_AUTHORITY_CHANGED')
    return proof

def build_composite_venue_witness(source):
    require(digest(source)==BASE_HASH,'WITNESS_BASE_CHANGED')
    text=source.decode()
    start=text.index('    # Geometric coverage and a nonempty client ID cannot attribute a STOP.')
    end=text.index('\n    if unknown or partial:',start)
    replacement='''    from disdex_stable4_composite_root_bridge import read_root_receipt, attest_composite_owner
    composite_receipt = read_root_receipt()
    owner_proof = None
    if composite_receipt is not None:
        owner_proof = attest_composite_owner(expected_pins, account_evidence.get("positions"), account_evidence.get("openOrders"), composite_receipt)
        protected_symbols = set(owner_proof["protectiveStopSymbols"])
        protected_positions = [p for p in account_positions if p["symbol"] in protected_symbols]
        unknown, partial = protective_stop_counts(protected_positions, account_orders)
    else:
        if account_positions or account_orders:
            from disdex_v4_durable_owner_probe import attest_current_sole_v4_owner
            owner_proof = attest_current_sole_v4_owner(expected_pins["V12_V4"], sha, account_evidence.get("positions"), account_evidence.get("openOrders"))
            if owner_proof.get("journalReplayVerified") is not True or owner_proof.get("verified") is not True:
                raise ValueError("V4_NONFLAT_DURABLE_OWNER_REPLAY_REQUIRED")
        unknown, partial = protective_stop_counts(account_positions, account_orders)
'''
    text=text[:start]+replacement+text[end:]
    ast.parse(text)
    return text.encode()
