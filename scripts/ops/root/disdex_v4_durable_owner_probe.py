"""Read-only bridge from fresh signed venue evidence to independent V4 ownership.

Called by the existing authenticated root venue witness after all its current
freshness, service, pending, risk and source gates. No activation or order API.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
from disdex_v4_nonflat_ownership import attest_sole_v4_inventory

STATE=Path('/var/lib/disdex/v12-v4/orders.json')
RELEASES=Path('/home/deploy/disdex-trading/releases')

def attest_current_sole_v4_owner(expected_sha, candidate_sha, positions, orders):
    if os.geteuid()!=0 or not all(isinstance(s,str) and re.fullmatch('[a-f0-9]{40}',s) for s in [expected_sha,candidate_sha]):
        raise ValueError('V4_OWNER_PROBE_ROOT_AND_SHA_REQUIRED')
    release=RELEASES/candidate_sha
    marker=release/'.disdex-release-sha'
    if release.resolve()!=release or release.stat().st_uid!=0 or release.stat().st_mode&0o222 or marker.is_symlink() or marker.read_text().strip()!=candidate_sha:
        raise ValueError('V4_OWNER_PROBE_IMMUTABLE_RELEASE_REQUIRED')
    for path in [marker,release/'lib/v12-v4-execution-store.ts',release/'node_modules/tsx/dist/loader.mjs']:
        meta=path.lstat()
        if not stat.S_ISREG(meta.st_mode) or path.resolve()!=path or meta.st_uid!=0 or meta.st_mode&0o222:
            raise ValueError('V4_OWNER_PROBE_SOURCE_METADATA')
    meta=STATE.lstat()
    if not stat.S_ISREG(meta.st_mode) or STATE.resolve()!=STATE or meta.st_uid!=pwd.getpwnam('deploy').pw_uid or meta.st_mode&0o022:
        raise ValueError('V4_OWNER_PROBE_STATE_METADATA')
    raw=STATE.read_bytes()
    document=json.loads(raw)
    raw_hash=hashlib.sha256(raw).hexdigest()
    # argv values are fixed validated absolute paths or SHA hex, never shell text.
    code="""import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {V4ExecutionStore} from './lib/v12-v4-execution-store.ts';
import {FileAccountOrderLock} from './lib/disdex-account-order-lock.ts';
import {readPendingExposureRegistry} from './lib/disdex-pending-exposure-registry.ts';
const path='/var/lib/disdex/v12-v4/orders.json',sha=process.argv[2];
const pendingPath='/var/lib/disdex/shared/pending-exposure.json';
const lock=new FileAccountOrderLock('/var/lib/disdex/shared/account-order.lock',120000,pendingPath);
let lease;for(let i=0;i<12&&!lease;i++){lease=await lock.acquire('ROOT_V4_DURABLE_OWNER_PROBE');if(!lease)await new Promise(r=>setTimeout(r,500));}
if(!lease)throw Error('V4_OWNER_PROBE_ACCOUNT_LOCK_BUSY');
try{
const before=readFileSync(path);new V4ExecutionStore(path,sha).read();
if((await readPendingExposureRegistry(pendingPath)).entries.some(r=>r.status!=='RELEASED'))throw Error('V4_OWNER_PROBE_ACTIVE_PENDING');
await lease.document();if(!before.equals(readFileSync(path)))throw Error('V4_OWNER_REPLAY_STATE_CHANGED');
console.log(JSON.stringify({status:'V4_DURABLE_OWNER_REPLAY_VERIFIED',sha,rawSha256:createHash('sha256').update(before).digest('hex'),accountLeaseVerified:true,pendingEmpty:true}));
}finally{await lease.release();}
"""
    deploy=pwd.getpwnam('deploy')
    result=subprocess.run(['/usr/bin/node','--import',str(release/'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-',expected_sha],input=code,cwd=release,capture_output=True,text=True,timeout=45,user=deploy.pw_uid,group=deploy.pw_gid,extra_groups=[],env={'PATH':'/usr/bin:/bin','HOME':deploy.pw_dir})
    if result.returncode:
        raise ValueError('V4_OWNER_PROBE_DURABLE_REPLAY_FAILED')
    try:
        replay=json.loads(result.stdout)
    except (ValueError,TypeError):
        raise ValueError('V4_OWNER_PROBE_REPLAY_RESPONSE_INVALID') from None
    if replay!={'status':'V4_DURABLE_OWNER_REPLAY_VERIFIED','sha':expected_sha,'rawSha256':raw_hash,'accountLeaseVerified':True,'pendingEmpty':True}:
        raise ValueError('V4_OWNER_PROBE_REPLAY_BINDING_MISMATCH')
    proof=attest_sole_v4_inventory(document,expected_sha,positions,orders)
    after=STATE.lstat()
    if (meta.st_dev,meta.st_ino)!=(after.st_dev,after.st_ino) or STATE.read_bytes()!=raw:
        raise ValueError('V4_OWNER_PROBE_DOCUMENT_CHANGED')
    return dict(proof,journalReplayVerified=True,rawDocumentSha256=raw_hash,
                probeSourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                ownershipSourceSha256=hashlib.sha256(Path(__file__).with_name('disdex_v4_nonflat_ownership.py').read_bytes()).hexdigest())
