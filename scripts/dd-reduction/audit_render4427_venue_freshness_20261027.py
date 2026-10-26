#!/usr/bin/env python3
"""RENDER #4427: pinned original TS venue timestamp freshness and causal-order readback audit. Research only."""
import argparse, hashlib, json, os, pathlib, subprocess, sys
ROOT = pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINROOT = ROOT / "audit15-venue-freshness-pins"
PINS = {
 "scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts":"70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09",
 "lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
 "config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
 "lib/aster-v3-client.ts":"4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf",
}
CASES=("baseline","stale_position","stale_stop","stale_tp","future_position","future_stop","future_tp","stop_before_entry","missing_all_times","wrong_stop_price","missing_stop","pending_reject")
NODE=r"""
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const {stripTypeScriptTypes}=require("node:module");
const [caseDir,kind]=process.argv.slice(2);
const root=path.resolve("C:/Users/dis/render4427-research-only");
const pins=JSON.parse(fs.readFileSync(path.join(caseDir,"..","pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const raw=fs.readFileSync(path.join(root,"audit15-venue-freshness-pins",path.basename(name)));
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
stop.positionSide="SHORT";tp.positionSide="SHORT";
stop.workingType="MARK_PRICE";tp.workingType="MARK_PRICE";
const asof=1700000000000, year=365*24*3600*1000;
short.updateTime=asof-1000;stop.updateTime=asof-1000;tp.updateTime=asof-1000;
if(kind==="stale_position")short.updateTime=1;
if(kind==="stale_stop")stop.updateTime=1;
if(kind==="stale_tp")tp.updateTime=1;
if(kind==="future_position")short.updateTime=asof+year;
if(kind==="future_stop")stop.updateTime=asof+year;
if(kind==="future_tp")tp.updateTime=asof+year;
if(kind==="stop_before_entry"){short.updateTime=2000;stop.updateTime=1000;tp.updateTime=3000;}
if(kind==="missing_all_times"){delete short.updateTime;delete stop.updateTime;delete tp.updateTime;}

if(kind==="stop_contract_trigger")stop.workingType="CONTRACT_PRICE";
if(kind==="tp_contract_trigger")tp.workingType="CONTRACT_PRICE";
if(kind==="both_contract_trigger"){stop.workingType="CONTRACT_PRICE";tp.workingType="CONTRACT_PRICE";}
if(kind==="stop_long_side")stop.positionSide="LONG";
if(kind==="tp_long_side")tp.positionSide="LONG";
if(kind==="both_long_side"){stop.positionSide="LONG";tp.positionSide="LONG";}
if(kind==="stop_bad_type")stop.type="LIMIT";
if(kind==="stop_bad_side")stop.side="SELL";
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
 process.stdout.write(JSON.stringify({kind,status,reason,positionUpdateTime:short.updateTime??null,stopUpdateTime:stop.updateTime??null,tpUpdateTime:tp.updateTime??null,stopPrice:stop.stopPrice,stopPresent:orders.includes(stop),finalReview:after.manualReview,backupExists:fs.existsSync(path.join(caseDir,"backup.json"))}));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
"""
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--tag",required=True)
 args=ap.parse_args()
 if not args.tag.isalnum() or len(args.tag)>32:raise RuntimeError("INVALID_TAG")
 adapter=(PINROOT/"disdex-idle-priority-short-protected-rate-budget-recovery.ts").read_text(encoding="utf8")
 mapped=adapter.split("async getOpenOrders(symbol) {")[1].split("return rows.map((row) => ({")[1].split("}));")[0]
 if "updateTime" in mapped:raise RuntimeError("ADAPTER_ALREADY_PRESERVES_ORDER_TIMESTAMP")
 if "executedQuantity" not in mapped or "stopPrice" not in mapped:raise RuntimeError("ADAPTER_MAP_NOT_IDENTIFIED")
 positions_map=adapter.split("async getPositions(symbol) {")[1].split("return rows.map((row) => ({")[1].split("}));")[0]
 if "updateTime" in positions_map:raise RuntimeError("ADAPTER_ALREADY_PRESERVES_POSITION_TIMESTAMP")
 aster=(PINROOT/"aster-v3-client.ts").read_text(encoding="utf8")
 if aster.count("updateTime?: number;")<2:raise RuntimeError("ASTER_UPDATE_TIME_TYPE_MISSING")
 for name,pin in PINS.items():
  raw=(PINROOT/pathlib.Path(name).name).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=pin:raise RuntimeError("SOURCE_PIN_MISMATCH:"+name)
 run=ROOT/("venue-freshness-audit-"+args.tag)
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
  should_pass=kind in ("baseline","stale_position","stale_stop","stale_tp","future_position","future_stop","future_tp","stop_before_entry","missing_all_times")
  if should_pass and not(row["status"]=="pass" and row["finalReview"] is None and row["backupExists"]):raise RuntimeError("PASS_EXPECTED:"+str(row))
  if not should_pass and not(row["status"]=="rejected" and row["finalReview"] is not None):raise RuntimeError("REJECT_EXPECTED:"+str(row))
  results.append(row)
 data={"sourceSha256":PINS,"caseCount":len(results),"results":results}
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(results),"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":results},sort_keys=True))
if __name__=="__main__":main()
