#!/usr/bin/env python3
"""RENDER #4427 research-only: unmatched lease reservation can release foreign pending exposure.
Execute pinned original TypeScript functions via Node stripTypeScriptTypes + VM.
No production imports, venue calls, or writes outside explicitly authorized owner-PC directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT = Path("C:/Users/dis/render4427-research-only").resolve()
COMMIT = "939b59da49ce7960485a2004b0068dc63417ae82"
PINS = {
    "lib/disdex-account-order-lock.ts": "169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b",
    "lib/disdex-pending-exposure-registry.ts": "09aafb62fe408600452c1fbcbba2158c02b8b99eedaef70c187e4f8677df4100",
    "lib/v12-v4-shared-reservations.ts": "76c26cd72af578f93b2c18fc9b81c3327e10dc018925ee1377a677def93d59c8",
}
NODE = r'''
"use strict";
const fs=require("node:fs"), fsp=require("node:fs/promises"), path=require("node:path"), vm=require("node:vm"), crypto=require("node:crypto");
const {stripTypeScriptTypes}=require("node:module");
const [root,runDir]=process.argv.slice(2);
const pins={
 "lib/disdex-account-order-lock.ts":"169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b",
 "lib/disdex-pending-exposure-registry.ts":"09aafb62fe408600452c1fbcbba2158c02b8b99eedaef70c187e4f8677df4100",
 "lib/v12-v4-shared-reservations.ts":"76c26cd72af578f93b2c18fc9b81c3327e10dc018925ee1377a677def93d59c8"
};
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const bytes=fs.readFileSync(path.join(root,"foreign-release-pins",path.basename(name)));
 const digest=crypto.createHash("sha256").update(bytes).digest("hex");
 if(digest!==pin)throw Error("SOURCE_PIN_MISMATCH:"+name+":"+digest);
 sources[name]=bytes.toString("utf8");
}
if(!sources["lib/v12-v4-shared-reservations.ts"].includes("strategyId:V4_SHARED_OWNER") ||
   !sources["lib/v12-v4-shared-reservations.ts"].includes("reservationId:cid"))throw Error("V4_PEER_SOURCE_CONTRACT_MISSING");
function compile(src,sandbox,out){
 const clean=src.replace(/^import .*;\r?\n/gm,"").replace(/^export\s+/gm,"");
 const js=stripTypeScriptTypes(clean,{mode:"transform"});
 vm.createContext(sandbox);
 vm.runInContext(js+"\nglobalThis.AuditExports={"+out+"};",sandbox,{timeout:5000});
 return sandbox.AuditExports;
}
const fsOps={lstat:fsp.lstat,mkdir:fsp.mkdir,readFile:fsp.readFile,rename:fsp.rename,unlink:fsp.unlink,writeFile:fsp.writeFile,dirname:path.dirname,resolve:path.resolve,process,console,Date,Buffer,Number,Promise,Error,Set,Map};
const pending=compile(sources["lib/disdex-pending-exposure-registry.ts"],{...fsOps},
 "pendingExposurePath,readPendingExposureRegistry,upsertPendingExposure,releasePendingExposure,aggregatePendingExposure");
const lock=compile(sources["lib/disdex-account-order-lock.ts"],{
 ...fsOps,open:fsp.open,createHash:crypto.createHash,randomUUID:crypto.randomUUID,
 pendingExposurePath:pending.pendingExposurePath,
 upsertPendingExposure:pending.upsertPendingExposure,
 releasePendingExposure:pending.releasePendingExposure
},"FileAccountOrderLock");
async function runCase(name,kind){
 const dir=path.join(runDir,name);await fsp.mkdir(dir,{recursive:true});
 const lockPath=path.join(dir,"account.lock"), pendingPath=path.join(dir,"pending.json");
 const handle=await new lock.FileAccountOrderLock(lockPath,120000,pendingPath).acquire("IDLE_PRIORITY_SHORT:test");
 if(!handle)throw Error("LOCK_ACQUIRE_FAILED:"+name);
 const peerId="v4-peer-cid";
 const peer={reservationId:peerId,idempotencyKey:peerId,strategyId:"V12_V4",sleeve:"CRYPTO",symbol:"RENDERUSDT",side:"SHORT",gross:0.25,notionalUsd:2500,createdAt:Date.now(),status:kind==="peer_unknown"?"UNKNOWN":kind==="peer_submitted"?"SUBMITTED":"PENDING"};
 let own=null;
 if(kind==="own")own=await handle.reserve({strategyId:"IDLE_PRIORITY_SHORT",symbol:"DOTUSDT",side:"SHORT",gross:0.25,notionalUsd:2500});
 else if(kind!=="missing")await pending.upsertPendingExposure(peer,pendingPath);
 const before=await pending.readPendingExposureRegistry(pendingPath);
 const beforeGross=pending.aggregatePendingExposure(before).cryptoGross;
 const requested=kind==="own"?own.reservationId:kind==="missing"?"missing":kind==="other"?"not-peer":kind==="empty"?"":peerId;
 let error=null;
 try{await handle.releaseReservation(requested)}catch(e){error=String(e.message||e)}
 const after=await pending.readPendingExposureRegistry(pendingPath);
 const afterGross=pending.aggregatePendingExposure(after).cryptoGross;
 const peerAfter=after.entries.find(x=>x.reservationId===peerId)?.status||"ABSENT";
 const ownAfter=after.entries.find(x=>x.reservationId===own?.reservationId)?.status||"ABSENT";
 const lockDoc=await handle.document();
 const matchingLockRow=lockDoc.reservations.some(x=>x.reservationId===requested);
 let expected=false;
 if(kind==="peer_pending"||kind==="peer_submitted"||kind==="peer_unknown")expected=!matchingLockRow&&peerAfter==="RELEASED"&&beforeGross===0.25&&afterGross===0&&error===null;
 if(kind==="own")expected=matchingLockRow&&ownAfter==="RELEASED"&&beforeGross===0.25&&afterGross===0&&error===null;
 if(kind==="missing")expected=!matchingLockRow&&beforeGross===0&&afterGross===0&&error===null;
 if(kind==="other")expected=!matchingLockRow&&peerAfter==="PENDING"&&beforeGross===0.25&&afterGross===0.25&&error===null;
 if(kind==="empty")expected=!matchingLockRow&&peerAfter==="PENDING"&&beforeGross===0.25&&afterGross===0.25&&error==="PENDING_EXPOSURE_RESERVATION_ID_INVALID";
 if(!expected)throw Error("CASE_FAIL:"+name+":"+JSON.stringify({kind,matchingLockRow,peerAfter,ownAfter,beforeGross,afterGross,error}));
 await handle.release();
 return {name,kind,pass:true,matchingLockRow,peerAfter,ownAfter,beforeGross,afterGross,error};
}
(async()=>{
 const cases=["peer_pending","peer_submitted","peer_unknown","own","missing","other","empty"];
 const results=[];
 for(const kind of cases)results.push(await runCase(kind,kind));
 console.log(JSON.stringify({sourceSha256:pins,caseCount:results.length,results}));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1});
'''
def inside(p):
    try:
        p.resolve().relative_to(ROOT)
        return True
    except ValueError:
        return False

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--tag",required=True)
    args=ap.parse_args()
    if not args.tag.isalnum() or len(args.tag)>32:
        raise RuntimeError("INVALID_TAG")
    if not ROOT.is_dir():
        raise RuntimeError("AUTHORIZED_ROOT_MISSING")
    src_dir=ROOT/"foreign-release-pins"
    if not inside(src_dir):
        raise RuntimeError("SOURCE_PATH_OUTSIDE_ROOT")
    src_dir.mkdir(exist_ok=True)
    for name,pin in PINS.items():
        target=src_dir/Path(name).name
        if not inside(target):
            raise RuntimeError("SOURCE_PATH_OUTSIDE_ROOT")
        if not target.exists():
            url=f"https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/{COMMIT}/{name}"
            data=urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"render4427-research"}),timeout=25).read()
            if hashlib.sha256(data).hexdigest()!=pin:
                raise RuntimeError("REMOTE_SOURCE_PIN_MISMATCH:"+name)
            target.write_bytes(data)
        if hashlib.sha256(target.read_bytes()).hexdigest()!=pin:
            raise RuntimeError("LOCAL_SOURCE_PIN_MISMATCH:"+name)
    run=ROOT/("foreign-release-"+args.tag)
    if not inside(run) or run.exists():
        raise RuntimeError("RUN_DIR_EXISTS_OR_OUTSIDE_ROOT")
    run.mkdir()
    harness=run/"harness.cjs"
    harness.write_text(NODE,encoding="utf-8",newline="\n")
    env=os.environ.copy()
    for key in ("TEMP","TMP","TMPDIR"):
        env[key]=str(run)
    env["PYTHONDONTWRITEBYTECODE"]="1"
    proc=subprocess.run(["node",str(harness),str(ROOT),str(run)],cwd=run,env=env,capture_output=True,text=True,timeout=120)
    if proc.returncode!=0:
        raise RuntimeError("NODE_AUDIT_FAILED:"+proc.stderr[-4000:])
    data=json.loads(proc.stdout.strip().splitlines()[-1])
    if data["sourceSha256"]!=PINS or data["caseCount"]!=7 or not all(x["pass"] for x in data["results"]):
        raise RuntimeError("RESULT_INVALID")
    canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
    print(json.dumps({"pythonOptimize":sys.flags.optimize,"caseCount":data["caseCount"],"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"sourceSha256":PINS,"results":data["results"]},sort_keys=True))
if __name__=="__main__":
    main()
