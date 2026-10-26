#!/usr/bin/env python3
"""Isolated RENDER #4427 state as-of/chronology audit using pinned original TypeScript."""
import argparse,hashlib,json,os,pathlib,subprocess,sys
ROOT=pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINS={
 "lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
 "config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
 "lib/idle-priority-short-runner.ts":"0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33"
}
NODE=r'''
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto"),vm=require("node:vm");
const {stripTypeScriptTypes}=require("node:module");
const root=process.argv[2],runDir=process.argv[3];
const pins=JSON.parse(fs.readFileSync(path.join(runDir,"pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const b=fs.readFileSync(path.join(root,"release-caller-pins",path.basename(name)));
 if(crypto.createHash("sha256").update(b).digest("hex")!==pin)throw Error("SOURCE_PIN_MISMATCH:"+name);
 sources[name]=b.toString("utf8");
}
const sandboxBase={lstat:fsp.lstat,mkdir:fsp.mkdir,readFile:fsp.readFile,rename:fsp.rename,unlink:fsp.unlink,writeFile:fsp.writeFile,chmod:fsp.chmod,dirname:path.dirname,process,console,Date,Buffer,Number,Promise,Error,Set,Map};
function compile(src,sandbox,exports){
 const clean=src.replace(/^import .*;\r?\n/gm,"").replace(/^export\s+/gm,"");
 const js=stripTypeScriptTypes(clean,{mode:"transform"});
 vm.createContext(sandbox);vm.runInContext(js+"\nglobalThis.AuditExports={"+exports+"};",sandbox,{timeout:5000});
 return sandbox.AuditExports;
}
const cfg=compile(sources["config/idlePriorityShortPolicy.ts"],{...sandboxBase},"IDLE_PRIORITY_SHORT_POLICY");
const state=compile(sources["lib/idle-priority-short-state.ts"],{...sandboxBase,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY},"emptyIdleState,FileIdlePriorityShortStateStore");
const runnerSource=sources["lib/idle-priority-short-runner.ts"];
function slice(start,end){
 const a=runnerSource.indexOf(start),b=runnerSource.indexOf(end,a);
 if(a<0||b<=a)throw Error("RUNNER_SOURCE_METHOD_NOT_FOUND");
 return runnerSource.slice(a,b);
}
const lifecycle=slice("    private candidateLifecycleAllows(","    private async protectionReadBack(");
const reconcile=slice("    private async reconcilePending(","    private async exitPosition(");
if(!reconcile.includes("this.dependencies.executor.reconcileOrder(pending.symbol, pending.clientOrderId)")||!lifecycle.includes("candidate.features.decisionTs - last >= cooldownMs"))throw Error("RUNNER_CONTRACT_MISSING");
const runner=compile("class AuditRunner {constructor(dependencies){this.dependencies=dependencies;} async manualReview(state,reason){return {status:'manual-review',message:reason};} async finalizeEntry(){return {status:'held'};}\n"+lifecycle+"\n"+reconcile+"\n}",{...sandboxBase,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY},"AuditRunner");
const SHA="a".repeat(40),NOW=1793020000000;
const cases=["fresh","state_updated_zero","state_updated_negative","state_updated_future","pending_created_old","pending_updated_future","pending_created_after_updated","pending_decision_future","pending_signal_after_decision","future_cooldown","runtime_mismatch","invalid_route","invalid_quantity","no_pending"];
async function runCase(kind){
 const dir=path.join(runDir,kind);await fsp.mkdir(dir,{recursive:true});
 const store=new state.FileIdlePriorityShortStateStore(path.join(dir,"state.json"),SHA);
 const st=state.emptyIdleState(SHA,NOW-1000);
 const rule=cfg.IDLE_PRIORITY_SHORT_POLICY.routes.RENDERUSDT;
 st.pending={action:"ENTRY",phase:"submitted",symbol:"RENDERUSDT",route:rule.route,clientOrderId:"synthetic-client",idempotencyKey:"synthetic-client",quantity:1,expectedPrice:100,signalTs:NOW-3600000,decisionTs:NOW-60000,holdHours:rule.holdHours,createdAt:NOW-50000,updatedAt:NOW-40000,reason:"synthetic",reservationId:"synthetic-own-id",gross:rule.gross};
 if(kind==="state_updated_zero")st.updatedAt=0;
 if(kind==="state_updated_negative")st.updatedAt=-1;
 if(kind==="state_updated_future")st.updatedAt=NOW+86400000;
 if(kind==="pending_created_old")st.pending.createdAt=NOW-365*86400000;
 if(kind==="pending_updated_future")st.pending.updatedAt=NOW+86400000;
 if(kind==="pending_created_after_updated")st.pending.createdAt=NOW+100000;
 if(kind==="pending_decision_future")st.pending.decisionTs=NOW+86400000;
 if(kind==="pending_signal_after_decision")st.pending.signalTs=NOW+86400000;
 if(kind==="future_cooldown")st.lastAcceptedBySymbol.RENDERUSDT=NOW+365*86400000;
 if(kind==="runtime_mismatch")st.runtimeSha="b".repeat(40);
 if(kind==="invalid_route")st.pending.route="WRONG_ROUTE";
 if(kind==="invalid_quantity")st.pending.quantity=0;
 if(kind==="no_pending")st.pending=null;
 await fsp.writeFile(path.join(dir,"state.json"),JSON.stringify(st)+"\n","utf8");
 let loaded=null,error=null,calls=0,outcome="NOT_RUN",cooldown=null;
 try{loaded=await store.load();}catch(e){error=String(e.message||e);}
 if(loaded){
  const inst=new runner.AuditRunner({executor:{reconcileOrder:async()=>{calls++;return {status:"UNKNOWN",executionUnknown:true};}}});
  cooldown=inst.candidateLifecycleAllows(loaded,{symbol:"RENDERUSDT",features:{decisionTs:NOW}});
  const result=await inst.reconcilePending(loaded,{});
  outcome=result?.status||"UNDEFINED";
 }
 const rejected=kind==="runtime_mismatch"||kind==="invalid_route"||kind==="invalid_quantity";
 const expectedError=kind==="runtime_mismatch"?"IDLE_STATE_RUNTIME_SHA_MISMATCH":"IDLE_STATE_PENDING_INVALID";
 const pass=rejected?(error===expectedError&&calls===0):(error===null&&calls===(kind==="no_pending"?0:1)&&outcome===(kind==="no_pending"?"UNDEFINED":"manual-review")&&cooldown===(kind!=="future_cooldown"));
 if(!pass)throw Error("CASE_FAIL:"+JSON.stringify({kind,error,calls,outcome,cooldown}));
 return {kind,pass,error,calls,outcome,cooldown,storedStateUpdatedAt:st.updatedAt,storedPendingUpdatedAt:st.pending?.updatedAt??null};
}
(async()=>{const results=[];for(const kind of cases)results.push(await runCase(kind));console.log(JSON.stringify({sourceSha256:pins,caseCount:results.length,results}));})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
'''
def inside(p):
 try:p.resolve().relative_to(ROOT);return True
 except ValueError:return False
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--tag",required=True);args=ap.parse_args()
 if not args.tag.isalnum() or len(args.tag)>40:raise RuntimeError("INVALID_TAG")
 for name,pin in PINS.items():
  p=ROOT/"release-caller-pins"/pathlib.Path(name).name
  if not inside(p) or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=pin:raise RuntimeError("SOURCE_PIN_MISMATCH:"+name)
 run=ROOT/("state-asof-"+args.tag)
 if not inside(run) or run.exists():raise RuntimeError("RUN_PATH_INVALID")
 run.mkdir()
 (run/"pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 harness=run/"harness.cjs";harness.write_text(NODE,encoding="utf8",newline="\n")
 env=os.environ.copy()
 for k in ("TEMP","TMP","TMPDIR"):env[k]=str(run)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 proc=subprocess.run(["node",str(harness),str(ROOT),str(run)],cwd=run,env=env,capture_output=True,text=True,timeout=120)
 if proc.returncode:raise RuntimeError("NODE_AUDIT_FAILED:"+proc.stderr[-4000:])
 data=json.loads(proc.stdout.strip().splitlines()[-1])
 if data["sourceSha256"]!=PINS or data["caseCount"]!=14 or not all(x["pass"] for x in data["results"]):raise RuntimeError("AUDIT_RESULT_INVALID")
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"count":data["caseCount"],"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":data["results"]},sort_keys=True))
if __name__=="__main__":main()
