#!/usr/bin/env python3
"""Pinned original TypeScript benign-recovery state-writer/lock-boundary audit; no venue calls."""
import argparse, hashlib, json, os, pathlib, subprocess, sys
ROOT = pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINS = {
 "scripts/disdex-idle-priority-short-benign-state-recovery.ts":"da57b0a8f4439ca3a0faeef166ffdc1c91fb29f428cd96fffa1f4d43e4a2d865",
 "lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
 "config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
}
CASES = ("operator_flat","pending_eacces_flat","rate_budget_flat","peer_pending","peer_position","peer_manual_review","peer_cooldown","unknown_review_reject","existing_pending_reject","existing_position_reject")
NODE = r"""
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto"),cp=require("node:child_process");
const {stripTypeScriptTypes}=require("node:module");
const [mode,caseDir,kind]=process.argv.slice(2);
const root=path.resolve("C:/Users/dis/render4427-research-only");
const pins=JSON.parse(fs.readFileSync(path.join(caseDir,"..","pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const raw=fs.readFileSync(path.join(root,"audit11-benign-recovery-pins",path.basename(name)));
 if(crypto.createHash("sha256").update(raw).digest("hex")!==pin)throw Error("SOURCE_PIN_MISMATCH:"+name);
 sources[name]=raw.toString("utf8");
}
const base={process,Date,Number,Promise,Error,Set,Map,Buffer,console,dirname:path.dirname,resolve:path.resolve,
 chmod:fsp.chmod,chown:fsp.chown,copyFile:fsp.copyFile,lstat:fsp.lstat,mkdir:fsp.mkdir,open:fsp.open,readFile:fsp.readFile,rename:fsp.rename,stat:fsp.stat,unlink:fsp.unlink,writeFile:fsp.writeFile};
function compile(src,context,exports){
 const clean=src.replace(/^import .*;\r?\n/gm,"").replace(/^export\s+/gm,"");
 const code=stripTypeScriptTypes(clean,{mode:"transform"});
 vm.runInContext(code+"\nglobalThis.__result={"+exports+"};",context,{timeout:5000});
 return context.__result;
}
const cfgCtx=vm.createContext({...base});
const cfg=compile(sources["config/idlePriorityShortPolicy.ts"],cfgCtx,"IDLE_PRIORITY_SHORT_POLICY");
const stateCtx=vm.createContext({...base,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY});
const state=compile(sources["lib/idle-priority-short-state.ts"],stateCtx,"writeIdleState,normalizeIdleState");
const sha="a".repeat(40),statePath=path.join(caseDir,"state.json");
const rule=cfg.IDLE_PRIORITY_SHORT_POLICY.routes.RENDERUSDT;
function pending(){return {action:"ENTRY",phase:"submitted",symbol:"RENDERUSDT",route:rule.route,clientOrderId:"audit-client",idempotencyKey:"audit-client",quantity:1,expectedPrice:100,signalTs:1000,decisionTs:2000,holdHours:rule.holdHours,createdAt:3000,updatedAt:4000,reason:"audit",reservationId:"audit-reservation",gross:rule.gross};}
function position(){return {symbol:"RENDERUSDT",route:rule.route,side:"SHORT",signalTs:1000,entryTs:2000,exitTs:2000+rule.holdHours*3600000,entryPrice:100,quantity:1,holdHours:rule.holdHours,gross:rule.gross,stopPrice:110,takeProfitPrice:90,stopClientOrderId:"audit-stop",takeProfitClientOrderId:"audit-tp",protectionVerified:true};}
function change(s,what){
 if(what==="pending")s.pending=pending();
 if(what==="position")s.positions=[position()];
 if(what==="manual_review")s.manualReview="IDLE_NEW_PEER_MANUAL_REVIEW";
 if(what==="cooldown")s.lastAcceptedBySymbol.RENDERUSDT=3000;
 return s;
}
(async()=>{
 if(mode==="peer"){
  const s=JSON.parse(fs.readFileSync(statePath,"utf8"));
  await state.writeIdleState(statePath,change(s,kind));
  process.stdout.write(JSON.stringify({peerSaved:true}));
  return;
 }
 if(mode!=="case")throw Error("MODE_INVALID");
 const peer=kind.startsWith("peer_")?kind.slice(5):null;
 const wrappedCopy=async(a,b)=>{
  await fsp.copyFile(a,b);
  if(peer){
   const x=cp.spawnSync(process.execPath,[__filename,"peer",caseDir,peer],{cwd:caseDir,encoding:"utf8",timeout:12000,env:process.env});
   if(x.status!==0)throw Error("PEER_FAILED:"+x.stderr.slice(-1000));
  }
 };
 const benignCtx=vm.createContext({...base,copyFile:wrappedCopy,normalizeIdleState:state.normalizeIdleState});
 const benignSrc=sources["scripts/disdex-idle-priority-short-benign-state-recovery.ts"].split("function arg(name")[0];
 const benign=compile(benignSrc,benignCtx,"recoverIdlePriorityShortBenignState,BENIGN_IDLE_OPERATOR_ACTIVATION_EACCES,BENIGN_IDLE_PENDING_EXPOSURE_EACCES");
 const initial={schema:"disdex-idle-priority-state/v2",runtimeSha:sha,updatedAt:10000,positions:[],pending:null,manualReview:benign.BENIGN_IDLE_OPERATOR_ACTIVATION_EACCES,lastAcceptedBySymbol:{},failures:[]};
 if(kind==="pending_eacces_flat")initial.manualReview=benign.BENIGN_IDLE_PENDING_EXPOSURE_EACCES;
 if(kind==="rate_budget_flat")initial.manualReview="IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:500";
 if(kind==="unknown_review_reject")initial.manualReview="IDLE_UNRECOGNIZED_CRITICAL_REVIEW";
 if(kind==="existing_pending_reject")initial.pending=pending();
 if(kind==="existing_position_reject")initial.positions=[position()];
 fs.writeFileSync(statePath,JSON.stringify(initial));
 let status="pass",reason="";
 try{
  const result=await benign.recoverIdlePriorityShortBenignState({statePath,expectedSha:sha,backupPath:path.join(caseDir,"backup.json")});
  reason=result.recoveryReason||"";
 }catch(e){status="rejected";reason=String(e.message);}
 const final=JSON.parse(fs.readFileSync(statePath,"utf8"));
 const result={kind,status,reason,finalPending:!!final.pending,finalPositions:final.positions.length,finalReview:final.manualReview,finalCooldown:!!final.lastAcceptedBySymbol.RENDERUSDT,backupExists:fs.existsSync(path.join(caseDir,"backup.json"))};
 process.stdout.write(JSON.stringify(result));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
"""
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--tag",required=True)
 args=ap.parse_args()
 if not args.tag.isalnum() or len(args.tag)>32:raise RuntimeError("INVALID_TAG")
 pinroot=ROOT/"audit11-benign-recovery-pins"
 for name,pin in PINS.items():
  p=pinroot/pathlib.Path(name).name
  if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=pin:raise RuntimeError("SOURCE_PIN_MISMATCH:"+name)
 run=ROOT/("benign-recovery-audit-"+args.tag)
 if run.exists():raise RuntimeError("RUN_EXISTS")
 run.mkdir()
 (run/"pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 (run/"worker.cjs").write_text(NODE,encoding="utf8",newline="\n")
 env=os.environ.copy()
 for k in ("TMP","TEMP","TMPDIR"):env[k]=str(run)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 results=[]
 for kind in CASES:
  d=run/kind;d.mkdir()
  p=subprocess.run(["node",str(run/"worker.cjs"),"case",str(d),kind],cwd=d,env=env,capture_output=True,text=True,timeout=35)
  if p.returncode:raise RuntimeError("NODE_CASE_FAILED:"+kind+":"+p.stderr[-2500:])
  row=json.loads(p.stdout.strip())
  if kind in ("operator_flat","pending_eacces_flat","rate_budget_flat","peer_pending","peer_position","peer_manual_review","peer_cooldown"):
   if not (row["status"]=="pass" and row["finalReview"] is None and not row["finalPending"] and row["finalPositions"]==0 and not row["finalCooldown"] and row["backupExists"]):raise RuntimeError("CASE_EXPECTED_PASS:"+str(row))
  else:
   if not (row["status"]=="rejected" and not row["backupExists"]):raise RuntimeError("CASE_EXPECTED_REJECT:"+str(row))
  if kind=="unknown_review_reject" and row["finalReview"]!="IDLE_UNRECOGNIZED_CRITICAL_REVIEW":raise RuntimeError("REVIEW_REJECT_FAIL")
  if kind=="existing_pending_reject" and not row["finalPending"]:raise RuntimeError("PENDING_REJECT_FAIL")
  if kind=="existing_position_reject" and row["finalPositions"]!=1:raise RuntimeError("POSITION_REJECT_FAIL")
  results.append(row)
 data={"sourceSha256":PINS,"caseCount":len(results),"results":results}
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(results),"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":results},sort_keys=True))
if __name__=="__main__":main()
