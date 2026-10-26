#!/usr/bin/env python3
"""Read-only research: original TS reserve() lease-identity overwrite boundary.

Source is pinned by raw SHA256. All file operations are in-memory mocks.
No local filesystem writes, runtime imports, venue calls, or live changes.
"""
import base64
import hashlib
import json
import subprocess
import urllib.request

SOURCE_COMMIT = "939b59da49ce7960485a2004b0068dc63417ae82"
SOURCE_PATH = "lib/disdex-account-order-lock.ts"
SOURCE_SHA256 = "169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b"
SOURCE_URL = "https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/" + SOURCE_COMMIT + "/" + SOURCE_PATH
NODE_AUDIT = r"""
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const {createHash} = require('node:crypto');
const source = Buffer.from(process.argv[1], 'base64').toString('utf8');
const a = source.indexOf('const assertOwner = async () => {');
const b = source.indexOf('\n                return {', a);
const c = source.indexOf('reserve: (input) => enqueue(async () => {');
const d = source.indexOf('\n                    releaseReservation:', c);
if ([a,b,c,d].some(x=>x<0) || !(a<b && c<d)) throw Error('EXTRACTION_FAILED');
const ownerFn = source.slice(a,b).trim();
const reserveExpr = source.slice(c,d).trim().replace(/,\s*$/, '');
const code = stripTypeScriptTypes('({async run(input){\n' + ownerFn + '\nconst obj=({' + reserveExpr + '});\nreturn await obj.reserve(input);\n}})');
async function exercise(mode) {
  const now = Date.now();
  const initial = {schema:'disdex-account-lock/v1',accountScope:'ASTER_FUTURES',ownerId:'ownerA:100',leaseId:'leaseA',acquiredAt:now,expiresAt:now+60000,reservations:[]};
  const clone = x=>JSON.parse(JSON.stringify(x));
  let state=clone(initial), writes=0, pending=0, error=null;
  if(mode==='pre_owner_mismatch') {state.ownerId='ownerB:200';state.leaseId='leaseB';}
  if(mode==='pre_lease_mismatch') state.leaseId='leaseB';
  if(mode==='pre_expired') state.expiresAt=now-1000;
  const context={
    ownerId:'ownerA:100',leaseId:'leaseA',leaseMs:120000,
    released:false,path:'virtual-account.lock',pendingPath:'virtual-pending.json',
    createHash,process:{env:{}},
    validNumber:(x)=>Number.isFinite(Number(x)),
    enqueue:(fn)=>fn(),
    read:async()=>{
      if(!state) throw Error('ACCOUNT_LOCK_MISSING');
      const snapshot=clone(state);
      if(mode==='swap_owner' || mode==='swap_owner_pending_failure') {
        state={...clone(initial),ownerId:'ownerB:200',leaseId:'leaseB'};
      }
      if(mode==='swap_lease') state={...clone(initial),leaseId:'leaseB'};
      if(mode==='swap_missing') state=null;
      return snapshot;
    },
    atomicWrite:async(_path,document)=>{writes++;state=clone(document);},
    upsertPendingExposure:async(_row,_path)=>{
      if(mode==='normal_pending_failure' || mode==='swap_owner_pending_failure') throw Error('PENDING_WRITE_FAILURE');
      pending++;
    },
  };
  const obj=vm.runInNewContext(code,context);
  try {await obj.run.call(context,{strategyId:'IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH',symbol:'RENDERUSDT',side:'SHORT',gross:0.25,notionalUsd:250});}
  catch(e){error=String(e.message);}
  return {mode,owner:state?state.ownerId:null,lease:state?state.leaseId:null,reservations:state?state.reservations.length:0,writes,pending,error};
}
(async()=>{
  const modes=['normal','pre_owner_mismatch','pre_lease_mismatch','pre_expired','swap_owner','swap_lease','swap_missing','normal_pending_failure','swap_owner_pending_failure'];
  const rows=[];
  for(const mode of modes) rows.push(await exercise(mode));
  console.log(JSON.stringify(rows));
})().catch(e=>{console.error(e.stack);process.exit(1)});
"""
EXPECTED = {
    "normal": ("ownerA:100", "leaseA", 1, 1, 1, None),
    "pre_owner_mismatch": ("ownerB:200", "leaseB", 0, 0, 0, "ACCOUNT_LOCK_NOT_OWNER"),
    "pre_lease_mismatch": ("ownerA:100", "leaseB", 0, 0, 0, "ACCOUNT_LOCK_NOT_OWNER"),
    "pre_expired": ("ownerA:100", "leaseA", 0, 0, 0, "ACCOUNT_LOCK_NOT_OWNER"),
    "swap_owner": ("ownerA:100", "leaseA", 1, 1, 1, None),
    "swap_lease": ("ownerA:100", "leaseA", 1, 1, 1, None),
    "swap_missing": ("ownerA:100", "leaseA", 1, 1, 1, None),
    "normal_pending_failure": ("ownerA:100", "leaseA", 0, 2, 0, "PENDING_WRITE_FAILURE"),
    "swap_owner_pending_failure": ("ownerA:100", "leaseA", 0, 2, 0, "PENDING_WRITE_FAILURE"),
}
def main():
    with urllib.request.urlopen(SOURCE_URL, timeout=20) as response:
        raw=response.read()
    sha=hashlib.sha256(raw).hexdigest()
    if sha!=SOURCE_SHA256:
        raise RuntimeError("SOURCE_SHA256_MISMATCH:"+sha)
    run=subprocess.run(
        ["node","--no-warnings","-e",NODE_AUDIT,base64.b64encode(raw).decode("ascii")],
        capture_output=True,text=True,timeout=30,check=False,
    )
    if run.returncode:
        raise RuntimeError("NODE_FAILED:"+run.stderr[:2000])
    rows=json.loads(run.stdout)
    if len(rows)!=len(EXPECTED):
        raise RuntimeError("CASE_COUNT_MISMATCH")
    for row in rows:
        expected=EXPECTED.get(row["mode"])
        observed=(row["owner"],row["lease"],row["reservations"],row["writes"],row["pending"],row["error"])
        if expected is None or observed!=expected:
            raise RuntimeError("CASE_MISMATCH:"+json.dumps(row,sort_keys=True))
    payload={"source_commit":SOURCE_COMMIT,"source_path":SOURCE_PATH,"source_sha256":sha,"results":rows,"scope":"original TS assertOwner/reserve expression, synthetic in-memory state interleaving","decision":"NEED_NATIVE_ALLOCATOR","order_authorized":False}
    canonical=json.dumps(payload,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf-8")
    print(json.dumps({"canonical_sha256":hashlib.sha256(canonical).hexdigest(),"source_sha256":sha,"case_count":len(rows),"results":rows,"decision":"NEED_NATIVE_ALLOCATOR","order_authorized":False},sort_keys=True))
if __name__=="__main__":
    main()
