#!/usr/bin/env python3
"""RENDER #4427 isolated research: persisted pending ID -> original runner caller -> foreign pending release.
Original pinned TS executed by Node stripTypeScriptTypes + vm, actual Windows FS only inside allowed root.
"""
import argparse, hashlib, json, os, pathlib, subprocess, sys

ROOT = pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINS = {
 "lib/disdex-account-order-lock.ts":"169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b",
 "lib/disdex-pending-exposure-registry.ts":"09aafb62fe408600452c1fbcbba2158c02b8b99eedaef70c187e4f8677df4100",
 "lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
 "lib/idle-priority-short-runner.ts":"0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33",
 "config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
 "lib/v12-v4-shared-reservations.ts":"76c26cd72af578f93b2c18fc9b81c3327e10dc018925ee1377a677def93d59c8",
}
NODE=r'''
"use strict";
const fs=require("node:fs"), fsp=require("node:fs/promises"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const {stripTypeScriptTypes}=require("node:module");
const [root,runDir]=process.argv.slice(2);
const pins=JSON.parse(fs.readFileSync(path.join(root,"runner-caller-pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const bytes=fs.readFileSync(path.join(root,"release-caller-pins",path.basename(name)));
 if(crypto.createHash("sha256").update(bytes).digest("hex")!==pin)throw Error("SOURCE_PIN_MISMATCH:"+name);
 sources[name]=bytes.toString("utf8");
}
const peer=sources["lib/v12-v4-shared-reservations.ts"];
if(!peer.includes("strategyId:V4_SHARED_OWNER")||!peer.includes("reservationId:cid"))throw Error("PEER_IDENTITY_SOURCE_NOT_VERIFIED");
const fsOps={lstat:fsp.lstat,mkdir:fsp.mkdir,readFile:fsp.readFile,rename:fsp.rename,unlink:fsp.unlink,writeFile:fsp.writeFile,chmod:fsp.chmod,open:fsp.open,dirname:path.dirname,resolve:path.resolve,process,console,Date,Buffer,Number,Promise,Error,Set,Map};
function compile(src,sandbox,out){
 const clean=src.replace(/^import .*;\r?\n/gm,"").replace(/^export\s+/gm,"");
 const js=stripTypeScriptTypes(clean,{mode:"transform"});
 vm.createContext(sandbox);vm.runInContext(js+"\nglobalThis.AuditExports={"+out+"};",sandbox,{timeout:5000});
 return sandbox.AuditExports;
}
const cfg=compile(sources["config/idlePriorityShortPolicy.ts"],{...fsOps},"IDLE_PRIORITY_SHORT_POLICY,IDLE_PRIORITY_SHORT_STRATEGY");
const state=compile(sources["lib/idle-priority-short-state.ts"],{...fsOps,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY},"emptyIdleState,normalizeIdleState,FileIdlePriorityShortStateStore");
const pending=compile(sources["lib/disdex-pending-exposure-registry.ts"],{...fsOps},"pendingExposurePath,readPendingExposureRegistry,upsertPendingExposure,releasePendingExposure,aggregatePendingExposure");
const lock=compile(sources["lib/disdex-account-order-lock.ts"],{...fsOps,createHash:crypto.createHash,randomUUID:crypto.randomUUID,pendingExposurePath:pending.pendingExposurePath,upsertPendingExposure:pending.upsertPendingExposure,releasePendingExposure:pending.releasePendingExposure},"FileAccountOrderLock");
const runnerSource=sources["lib/idle-priority-short-runner.ts"];
const start=runnerSource.indexOf("    private async finalizeEntry(");
const end=runnerSource.indexOf("    private async exitPosition(",start);
if(start<0||end<start)throw Error("ORIGINAL_RUNNER_METHODS_MISSING");
const methods=runnerSource.slice(start,end);
if(!methods.includes("this.finalizeEntry(state, pending, result, lock)")||!methods.includes("lock.releaseReservation(pending.reservationId)"))throw Error("ORIGINAL_CALLER_CONTRACT_MISSING");
const runner=compile("class AuditRunner { constructor(dependencies){this.dependencies=dependencies;} manualReview(state,message){return {status:'manual-review',message};}\n"+methods+"\n}",{...fsOps,hasExposure:(r)=>(r.status==="FILLED"||r.status==="PARTIALLY_FILLED")&&r.executedQuantity>1e-9},"AuditRunner");
const SHA="a".repeat(40);
async function runCase(kind){
 const dir=path.join(runDir,kind);await fsp.mkdir(dir,{recursive:true});
 const lockPath=path.join(dir,"account.lock"),pendingPath=path.join(dir,"pending.json"),statePath=path.join(dir,"state.json");
 const handle=await new lock.FileAccountOrderLock(lockPath,120000,pendingPath).acquire("IDLE_PRIORITY_SHORT:research");
 if(!handle)throw Error("ACQUIRE_FAILED:"+kind);
 const store=new state.FileIdlePriorityShortStateStore(statePath,SHA);
 const st=state.emptyIdleState(SHA);
 const now=Date.now();
 const peerId="v4-peer-"+kind;
 const isOwn=kind==="own";
 const noId=kind==="no_id";
 const invalidRoute=kind==="invalid_route";
 const invalidGross=kind==="invalid_gross";
 const noRegistry=kind==="no_registry";
 const unknown=kind==="venue_unknown";
 const peerSymbol=kind==="foreign_symbol"?"DOTUSDT":"RENDERUSDT";
 const peerSide=kind==="foreign_side"?"LONG":"SHORT";
 const peerGross=kind==="foreign_gross"?1.0:0.25;
 let id=peerId;
 if(isOwn){
  const own=await handle.reserve({strategyId:"IDLE_PRIORITY_SHORT",symbol:"RENDERUSDT",side:"SHORT",gross:0.25,notionalUsd:2500});
  id=own.reservationId;
 } else if(!noRegistry) {
  await pending.upsertPendingExposure({reservationId:peerId,idempotencyKey:peerId,strategyId:"V12_V4",sleeve:"CRYPTO",symbol:peerSymbol,side:peerSide,gross:peerGross,notionalUsd:peerGross*10000,createdAt:now,status:kind==="foreign_submitted"?"SUBMITTED":kind==="foreign_unknown"?"UNKNOWN":"PENDING"},pendingPath);
 }
 st.pending={action:"ENTRY",phase:"submitted",symbol:"RENDERUSDT",route:invalidRoute?"IDLE_NOT_RENDER":"IDLE_RENDER_RELATIVE_SHORT",clientOrderId:"idle-entry-"+kind,idempotencyKey:"idle-entry-"+kind,quantity:25,expectedPrice:100,signalTs:now-3600000,decisionTs:now-60000,holdHours:12,createdAt:now-50000,updatedAt:now-40000,reason:"synthetic-entry",gross:invalidGross?1.0:0.25};
 if(!noId)st.pending.reservationId=id;
 let validation="PASS";
 try{await store.save(st)}catch(e){validation=String(e.message||e)}
 const before=await pending.readPendingExposureRegistry(pendingPath);
 const beforeGross=pending.aggregatePendingExposure(before).cryptoGross;
 let outcome="NOT_RUN";
 if(validation==="PASS"){
  const loaded=await store.load();
  const deps={stateStore:store,executor:{reconcileOrder:async()=>({status:unknown?"UNKNOWN":"REJECTED",executionUnknown:false,executedQuantity:0})}};
  const instance=new runner.AuditRunner(deps);
  const result=await instance.reconcilePending(loaded,handle);
  outcome=result?.status||"UNDEFINED";
 }
 const after=await pending.readPendingExposureRegistry(pendingPath);
 const afterGross=pending.aggregatePendingExposure(after).cryptoGross;
 const row=after.entries.find(x=>x.reservationId===id);
 const status=row?.status||"ABSENT";
 const saved=validation==="PASS"?await store.load():null;
 const lockDoc=await handle.document();
 const ownMembership=lockDoc.reservations.some(x=>x.reservationId===id);
 const foreignRelease=kind.startsWith("foreign")&&validation==="PASS"&&outcome==="held"&&!ownMembership&&status==="RELEASED"&&afterGross===0;
 let pass;
 if(kind.startsWith("foreign"))pass=foreignRelease&&beforeGross===peerGross;
 else if(kind==="own")pass=validation==="PASS"&&ownMembership&&status==="RELEASED"&&beforeGross===0.25&&afterGross===0&&outcome==="held";
 else if(kind==="no_id")pass=validation==="PASS"&&status==="PENDING"&&outcome==="manual-review"&&beforeGross===afterGross;
 else if(kind==="venue_unknown")pass=validation==="PASS"&&status==="PENDING"&&outcome==="manual-review"&&beforeGross===afterGross;
 else if(kind==="no_registry")pass=validation==="PASS"&&status==="ABSENT"&&outcome==="held"&&beforeGross===0&&afterGross===0;
 else if(kind==="invalid_route"||kind==="invalid_gross")pass=validation==="IDLE_STATE_PENDING_INVALID"&&status==="PENDING"&&outcome==="NOT_RUN"&&beforeGross===afterGross;
 if(!pass)throw Error("CASE_FAIL:"+JSON.stringify({kind,validation,outcome,beforeGross,afterGross,status,ownMembership}));
 await handle.release();
 return {kind,pass:true,validation,outcome,beforeGross,afterGross,status,ownMembership,pendingCleared:saved?saved.pending===null:null};
}
(async()=>{
 const cases=["foreign_pending","foreign_submitted","foreign_unknown","foreign_symbol","foreign_side","foreign_gross","own","no_id","venue_unknown","no_registry","invalid_route","invalid_gross"];
 const results=[];
 for(const kind of cases)results.push(await runCase(kind));
 console.log(JSON.stringify({sourceSha256:pins,caseCount:results.length,results}));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1});
'''
def within(p):
 try: p.resolve().relative_to(ROOT);return True
 except ValueError:return False

def main():
 ap=argparse.ArgumentParser();ap.add_argument("--tag",required=True);args=ap.parse_args()
 if not args.tag.isalnum() or len(args.tag)>40:raise RuntimeError("INVALID_TAG")
 if not ROOT.is_dir():raise RuntimeError("ROOT_MISSING")
 pinpath=ROOT/"runner-caller-pins.json"
 if not within(pinpath):raise RuntimeError("PIN_PATH_INVALID")
 if pinpath.exists():
  if json.loads(pinpath.read_text(encoding="utf8"))!=PINS:raise RuntimeError("PIN_FILE_MISMATCH")
 else:pinpath.write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 for name,pin in PINS.items():
  p=ROOT/"release-caller-pins"/pathlib.Path(name).name
  if not within(p) or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=pin:raise RuntimeError("SOURCE_PIN_INVALID:"+name)
 run=ROOT/("runner-caller-"+args.tag)
 if not within(run) or run.exists():raise RuntimeError("RUN_PATH_INVALID_OR_EXISTS")
 run.mkdir()
 harness=run/"harness.cjs";harness.write_text(NODE,encoding="utf8",newline="\n")
 env=os.environ.copy()
 for k in ("TEMP","TMP","TMPDIR"):env[k]=str(run)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 proc=subprocess.run(["node",str(harness),str(ROOT),str(run)],cwd=run,env=env,capture_output=True,text=True,timeout=120)
 if proc.returncode!=0:raise RuntimeError("NODE_AUDIT_FAILED:"+proc.stderr[-5000:])
 data=json.loads(proc.stdout.strip().splitlines()[-1])
 if data["sourceSha256"]!=PINS or data["caseCount"]!=12 or not all(x["pass"] for x in data["results"]):raise RuntimeError("AUDIT_RESULT_INVALID")
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"count":data["caseCount"],"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":data["results"]},sort_keys=True))
if __name__=="__main__":main()
