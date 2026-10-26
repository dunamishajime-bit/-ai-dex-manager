#!/usr/bin/env python3
"""RENDER #4427: pinned original TS partial-fill protection readback audit. Research only."""
import argparse, hashlib, json, os, pathlib, subprocess, sys
ROOT = pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINROOT = ROOT / "audit13-partial-fill-pins"
PINS = {
 "scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts":"70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09",
 "lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
 "config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
}
CASES=("baseline","partial_stop_90","partial_stop_999","partial_tp_90","partial_both_90","partial_stop_zero","partial_tp_zero","filled_stop","missing_stop","wrong_orig_stop","wrong_stop_price","unmanaged_order")
NODE=r"""
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const {stripTypeScriptTypes}=require("node:module");
const [caseDir,kind]=process.argv.slice(2);
const root=path.resolve("C:/Users/dis/render4427-research-only");
const pins=JSON.parse(fs.readFileSync(path.join(caseDir,"..","pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const raw=fs.readFileSync(path.join(root,"audit13-partial-fill-pins",path.basename(name)));
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
const cfg=compile(sources["config/idlePriorityShortPolicy.ts"],vm.createContext({...base}),"IDLE_PRIORITY_SHORT_POLICY");
const state=compile(sources["lib/idle-priority-short-state.ts"],vm.createContext({...base,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY}),"normalizeIdleState");
const src=sources["scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts"].split("function numberEnv(")[0];
const recovery=compile(src,vm.createContext({...base,normalizeIdleState:state.normalizeIdleState}),"recoverIdleProtectedRateBudgetState");
const sha="a".repeat(40),statePath=path.join(caseDir,"state.json");
const rule=cfg.IDLE_PRIORITY_SHORT_POLICY.routes.RENDERUSDT;
const position={symbol:"RENDERUSDT",route:rule.route,side:"SHORT",signalTs:1000,entryTs:2000,exitTs:2000+rule.holdHours*3600000,entryPrice:100,quantity:1,holdHours:rule.holdHours,gross:rule.gross,stopPrice:110,takeProfitPrice:90,stopClientOrderId:"audit-stop",takeProfitClientOrderId:"audit-tp",protectionVerified:true};
const initial={schema:"disdex-idle-priority-state/v2",runtimeSha:sha,updatedAt:10000,positions:[position],pending:null,manualReview:"IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:500",lastAcceptedBySymbol:{},failures:[]};
if(kind==="pending_reject")initial.pending={action:"ENTRY",phase:"submitted",symbol:"RENDERUSDT",route:rule.route,clientOrderId:"pending-audit",idempotencyKey:"pending-audit",quantity:1,expectedPrice:100,signalTs:1000,decisionTs:2000,holdHours:rule.holdHours,createdAt:3000,updatedAt:4000,reason:"audit",reservationId:"audit-reservation",gross:rule.gross};
if(kind==="unknown_review")initial.manualReview="UNRECOGNIZED_MANUAL_REVIEW";
fs.writeFileSync(statePath,JSON.stringify(initial));
const short={symbol:"RENDERUSDT",quantity:1,positionSide:"SHORT"};
const positions=[short];
if(kind==="extra_long")positions.push({symbol:"RENDERUSDT",quantity:2,positionSide:"LONG"});
if(kind==="extra_short")positions.push({symbol:"RENDERUSDT",quantity:0.5,positionSide:"SHORT"});
if(kind==="extra_other_symbol")positions.push({symbol:"BTCUSDT",quantity:2,positionSide:"LONG"});
if(kind==="wrong_first")positions.unshift({symbol:"RENDERUSDT",quantity:0.5,positionSide:"SHORT"});
if(kind==="missing_position")positions.splice(0,positions.length);
if(kind==="wrong_quantity")positions[0]={symbol:"RENDERUSDT",quantity:0.5,positionSide:"SHORT"};
const stop={symbol:"RENDERUSDT",clientOrderId:"audit-stop",type:"STOP_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:110};
const tp={symbol:"RENDERUSDT",clientOrderId:"audit-tp",type:"TAKE_PROFIT_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:90};
const orders=[stop,tp];
if(kind==="missing_stop")orders.shift();
if(kind==="unmanaged_order")orders.push({...stop,clientOrderId:"foreign-stop"});
if(kind==="wrong_stop_price")stop.stopPrice=111;
if(kind==="partial_stop_90"){stop.status="PARTIALLY_FILLED";stop.executedQuantity=0.9;}
if(kind==="partial_stop_999"){stop.status="PARTIALLY_FILLED";stop.executedQuantity=0.999;}
if(kind==="partial_tp_90"){tp.status="PARTIALLY_FILLED";tp.executedQuantity=0.9;}
if(kind==="partial_both_90"){stop.status="PARTIALLY_FILLED";stop.executedQuantity=0.9;tp.status="PARTIALLY_FILLED";tp.executedQuantity=0.9;}
if(kind==="partial_stop_zero"){stop.status="PARTIALLY_FILLED";stop.executedQuantity=0;}
if(kind==="partial_tp_zero"){tp.status="PARTIALLY_FILLED";tp.executedQuantity=0;}
if(kind==="filled_stop")stop.status="FILLED";
if(kind==="wrong_orig_stop")stop.quantity=0.8;
const venue={async getPositions(symbol){return positions;},async getOpenOrders(symbol){return orders;}};
(async()=>{
 let status="pass",reason="";
 try{await recovery.recoverIdleProtectedRateBudgetState({statePath,expectedSha:sha,sourceSha:sha,backupPath:path.join(caseDir,"backup.json"),venue,now:()=>1700000000000});}
 catch(e){status="rejected";reason=String(e.message);}
 const after=JSON.parse(fs.readFileSync(statePath,"utf8"));
 process.stdout.write(JSON.stringify({kind,status,reason,positionCount:positions.length,stopStatus:stop.status,tpStatus:tp.status,remainingStop:stop.quantity-(stop.executedQuantity||0),remainingTp:tp.quantity-(tp.executedQuantity||0),finalReview:after.manualReview,backupExists:fs.existsSync(path.join(caseDir,"backup.json"))}));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
"""
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--tag",required=True)
 args=ap.parse_args()
 if not args.tag.isalnum() or len(args.tag)>32:raise RuntimeError("INVALID_TAG")
 for name,pin in PINS.items():
  raw=(PINROOT/pathlib.Path(name).name).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=pin:raise RuntimeError("SOURCE_PIN_MISMATCH:"+name)
 run=ROOT/("partial-fill-audit-"+args.tag)
 if run.exists():raise RuntimeError("RUN_EXISTS")
 run.mkdir()
 (run/"pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 (run/"worker.cjs").write_text(NODE,encoding="utf8",newline="\n")
 env=os.environ.copy()
 for key in ("TMP","TEMP","TMPDIR"):env[key]=str(run)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 results=[]
 for kind in CASES:
  d=run/kind;d.mkdir()
  p=subprocess.run(["node",str(run/"worker.cjs"),str(d),kind],cwd=d,env=env,capture_output=True,text=True,timeout=30)
  if p.returncode:raise RuntimeError("NODE_CASE_FAILED:"+kind+":"+p.stderr[-2000:])
  row=json.loads(p.stdout.strip())
  should_pass=kind in ("baseline","partial_stop_90","partial_stop_999","partial_tp_90","partial_both_90","partial_stop_zero","partial_tp_zero")
  if should_pass and not(row["status"]=="pass" and row["finalReview"] is None and row["backupExists"]):raise RuntimeError("PASS_EXPECTED:"+str(row))
  if not should_pass and not(row["status"]=="rejected" and row["finalReview"] is not None):raise RuntimeError("REJECT_EXPECTED:"+str(row))
  results.append(row)
 data={"sourceSha256":PINS,"caseCount":len(results),"results":results}
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(results),"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":results},sort_keys=True))
if __name__=="__main__":main()
