#!/usr/bin/env python3
"""Research-only, in-memory execution audit of the pinned TypeScript account lock.
No source edits, filesystem writes, orders, venue calls, or Native8 authorization.
"""
import hashlib
import json
import subprocess
import sys
import urllib.request

REPO = "dunamishajime-bit/-ai-dex-manager"
SOURCE_REF = "939b59da49ce7960485a2004b0068dc63417ae82"
PINS = {
    "lib/disdex-account-order-lock.ts": "169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b",
    "lib/disdex-pending-exposure-registry.ts": None,
    "lib/idle-priority-short-runner.ts": "0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33",
}
JS = r"""
'use strict';
const vm=require('node:vm'), mod=require('node:module'), crypto=require('node:crypto'), path=require('node:path');
let chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',async()=>{
 const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 const source=input.lock;
 const ts=mod.stripTypeScriptTypes(source,{mode:'transform'});
 const transformed=ts.replace(/^import .*;\\s*$/gm,'').replace(/^export /gm,'');
 if (/^import /m.test(transformed)) throw Error('UNREMOVED_IMPORT');
 const results={};
 const check=(x,label)=>{if(!x)throw Error('CASE_FAILED:'+label)};
 const run=async(name,kind)=>{
   const files=new Map(),pending=new Map(),observed=[];
   let failRelease=false,failUpsert=false;
   const err=(code)=>Object.assign(new Error(code),{code});
   const mkdir=async()=>{};
   const open=async(p,flag)=>{
     check(flag==='wx','exclusive_open');
     if(files.has(p))throw err('EEXIST');
     files.set(p,'');
     return {writeFile:async(x)=>files.set(p,String(x)),close:async()=>{}};
   };
   const readFile=async(p)=>{if(!files.has(p))throw err('ENOENT');return files.get(p)};
   const writeFile=async(p,v)=>{files.set(p,String(v))};
   const rename=async(a,b)=>{if(!files.has(a))throw err('ENOENT');files.set(b,files.get(a));files.delete(a)};
   const unlink=async(p)=>{if(!files.has(p))throw err('ENOENT');files.delete(p)};
   const lockPath='/virtual/account.lock';
   const upsertPendingExposure=async(row)=>{
      const doc=JSON.parse(files.get(lockPath));
      observed.push({point:'before_pending_upsert',lock_statuses:doc.reservations.map(x=>x.status),pending_count:pending.size});
      if(failUpsert)throw Error('INJECT_UPSERT_FAILURE');
      pending.set(row.reservationId,{...row,status:'PENDING'});
   };
   const releasePendingExposure=async(id)=>{
      const doc=JSON.parse(files.get(lockPath));
      observed.push({point:'before_pending_release',lock_statuses:doc.reservations.map(x=>x.status),pending_status:pending.get(id)?.status||null});
      if(failRelease)throw Error('INJECT_RELEASE_FAILURE');
      if(pending.has(id))pending.get(id).status='RELEASED';
   };
   const sandbox={
      createHash:crypto.createHash,randomUUID:crypto.randomUUID,mkdir,open,readFile,rename,unlink,writeFile,
      dirname:path.posix.dirname,resolve:path.posix.resolve,pendingExposurePath:(p)=>p,
      upsertPendingExposure,releasePendingExposure,
      process:{pid:4427,env:{}},Date,Number,String,Math,JSON,Promise,Error,Set,
   };
   vm.runInNewContext(transformed+'\\nglobalThis.__lockClass=FileAccountOrderLock;',sandbox,{timeout:1000});
   const instance=new sandbox.__lockClass(lockPath,120000,'/virtual/pending.json');
   const handle=await instance.acquire('RESEARCH_ONLY');
   check(Boolean(handle),'acquired');
   const inputRow={strategyId:'IDLE_PRIORITY_SHORT',symbol:'RENDERUSDT',side:'SHORT',gross:0.25,notionalUsd:250};
   let reservation=null;
   if(kind==='upsert_failure'){
     failUpsert=true;let threw=false;
     try{await handle.reserve(inputRow)}catch(e){threw=String(e.message)==='INJECT_UPSERT_FAILURE'}
     check(threw,'upsert_failure_propagated');
     check(JSON.parse(files.get(lockPath)).reservations.length===0,'upsert_rollback');
     check(observed.length===1&&observed[0].lock_statuses[0]==='RESERVED','upsert_intermediate_reserved');
     check(pending.size===0,'no_pending_after_upsert_failure');
     await handle.release();
   } else {
     reservation=await handle.reserve(inputRow);
     check(pending.get(reservation.reservationId)?.status==='PENDING','reserve_pending_created');
     if(kind==='normal'){
       await handle.releaseReservation(reservation.reservationId);
       check(pending.get(reservation.reservationId)?.status==='RELEASED','normal_pending_released');
       await handle.release();
     } else if(kind==='release_without_reservation_cleanup'){
       await handle.release();
       check(pending.get(reservation.reservationId)?.status==='PENDING','orphan_pending');
     } else if(kind==='pending_release_failure'){
       failRelease=true;let threw=false;
       try{await handle.releaseReservation(reservation.reservationId)}catch(e){threw=String(e.message)==='INJECT_RELEASE_FAILURE'}
       check(threw,'release_failure_propagated');
       check(JSON.parse(files.get(lockPath)).reservations[0].status==='RELEASED','lock_released_first');
       check(pending.get(reservation.reservationId)?.status==='PENDING','pending_still_active');
       await handle.release();
     } else if(kind==='new_lease_with_orphan'){
       await handle.release();
       const second=await instance.acquire('RESEARCH_SECOND');
       check(Boolean(second),'new_owner_acquires_despite_pending');
       check(pending.get(reservation.reservationId)?.status==='PENDING','pending_still_active_second_owner');
       await second.release();
     } else throw Error('UNKNOWN_CASE');
   }
   check(!files.has(lockPath),'lock_path_removed');
   results[name]={pass:true,pending_status:reservation?pending.get(reservation.reservationId)?.status||null:null,observed};
 };
 await run('normal_release','normal');
 await run('release_without_cleanup','release_without_reservation_cleanup');
 await run('pending_release_failure','pending_release_failure');
 await run('upsert_failure_intermediate','upsert_failure');
 await run('new_lease_with_orphan','new_lease_with_orphan');
 const runner=input.runner;
 check(/finally\\s*\\{\\s*await lock\\.release\\(\\)/.test(runner),'runner_finally_release');
 results.runner_finally_release={pass:true};
 check(/await atomicWrite\\(this\\.path,[\\s\\S]*?await upsertPendingExposure\\(/.test(source),'lock_before_pending');
 check(/await atomicWrite\\(this\\.path,[\\s\\S]*?await releasePendingExposure\\(/.test(source),'release_lock_before_pending');
 results.nonatomic_cross_file_order={pass:true};
 process.stdout.write(JSON.stringify(results));
}).catch(e=>{process.stderr.write(String(e.stack||e));process.exitCode=1});
"""

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def fetch(path):
    url = f"https://raw.githubusercontent.com/{REPO}/{SOURCE_REF}/{path}"
    raw = urllib.request.urlopen(url, timeout=25).read()
    digest = hashlib.sha256(raw).hexdigest()
    if PINS[path] is not None:
        require(digest == PINS[path], f"RAW_SOURCE_PIN_MISMATCH:{path}:{digest}")
    return raw.decode("utf-8"), digest

def main():
    sources = {}
    digests = {}
    for path in PINS:
        sources[path], digests[path] = fetch(path)
    require("upsertPendingExposure" in sources["lib/disdex-pending-exposure-registry.ts"], "REGISTRY_SOURCE_MISSING")
    payload = json.dumps({"lock": sources["lib/disdex-account-order-lock.ts"],
                          "runner": sources["lib/idle-priority-short-runner.ts"]})
    p = subprocess.run(["node", "-e", JS], input=payload, text=True, capture_output=True, timeout=45)
    require(p.returncode == 0, "NODE_REPLAY_FAILED:" + p.stderr[-2500:])
    cases = json.loads(p.stdout)
    require(len(cases) == 7 and all(x["pass"] for x in cases.values()), "CASE_MATRIX_INCOMPLETE")
    summary = {
        "scope": "research-only synthetic virtual filesystem; original pinned TS class executed; no real orders",
        "source_ref": SOURCE_REF, "source_sha256": digests,
        "case_count": len(cases), "cases": cases,
        "native8_verified": False, "operator_trust_root_verified": False,
        "gateproof_verified": 0, "order_authorized": False
    }
    canonical = json.dumps(summary, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    print(json.dumps({"canonical_sha256": hashlib.sha256(canonical).hexdigest(), "summary": summary},
                     sort_keys=True, separators=(",", ":"), ensure_ascii=False))

if __name__ == "__main__":
    main()
