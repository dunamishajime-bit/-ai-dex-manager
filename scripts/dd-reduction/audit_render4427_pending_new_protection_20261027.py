#!/usr/bin/env python3
"""RENDER #4427: pinned original TS PENDING_NEW protective-order recovery acceptance audit. Research only."""
import argparse, hashlib, json, os, pathlib, subprocess, sys

ROOT = pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINROOT = ROOT / "audit19-pending-new-pins"
REF = "939b59da49ce7960485a2004b0068dc63417ae82"
PINS = {
 "scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts":"70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09",
 "lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
 "config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
 "lib/aster-v3-client.ts":"4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf",
}
CASES = (
 "baseline", "stop_pending_new", "tp_pending_new", "both_pending_new",
 "stop_partially_filled", "tp_partially_filled",
 "stop_pending_cancel_reject", "tp_pending_cancel_reject",
 "stop_canceled_reject", "tp_expired_reject", "stop_filled_reject", "tp_filled_reject",
 "wrong_stop_price", "missing_stop", "pending_reject", "wrong_side", "unmanaged_new_reject",
)
ACCEPT = set(CASES[:6])
NODE = r"""
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const {stripTypeScriptTypes}=require("node:module");
const [caseDir,kind]=process.argv.slice(2);
const root=path.resolve("C:/Users/dis/render4427-research-only");
const pins=JSON.parse(fs.readFileSync(path.join(caseDir,"..","pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const raw=fs.readFileSync(path.join(root,"audit19-pending-new-pins",path.basename(name)));
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
const sha="a".repeat(40),statePath=path.join(caseDir,"state.json"),rule=cfg.IDLE_PRIORITY_SHORT_POLICY.routes.RENDERUSDT;
const position={symbol:"RENDERUSDT",route:rule.route,side:"SHORT",signalTs:1000,entryTs:2000,exitTs:2000+rule.holdHours*3600000,entryPrice:100,quantity:1,holdHours:rule.holdHours,gross:rule.gross,stopPrice:110,takeProfitPrice:90,stopClientOrderId:"audit-stop",takeProfitClientOrderId:"audit-tp",protectionVerified:true};
const initial={schema:"disdex-idle-priority-state/v2",runtimeSha:sha,updatedAt:10000,positions:[position],pending:null,manualReview:"IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:500",lastAcceptedBySymbol:{},failures:[]};
if(kind==="pending_reject")initial.pending={action:"ENTRY",phase:"submitted",symbol:"RENDERUSDT",route:rule.route,clientOrderId:"pending-audit",idempotencyKey:"pending-audit",quantity:1,expectedPrice:100,signalTs:1000,decisionTs:2000,holdHours:rule.holdHours,createdAt:3000,updatedAt:4000,reason:"audit",reservationId:"audit-reservation",gross:rule.gross};
fs.writeFileSync(statePath,JSON.stringify(initial));
const positions=[{symbol:"RENDERUSDT",quantity:1,positionSide:"SHORT"}];
const stop={symbol:"RENDERUSDT",orderId:1001,clientOrderId:"audit-stop",type:"STOP_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:110};
const tp={symbol:"RENDERUSDT",orderId:1002,clientOrderId:"audit-tp",type:"TAKE_PROFIT_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:90};
const orders=[stop,tp];
if(kind==="stop_pending_new"||kind==="both_pending_new")stop.status="PENDING_NEW";
if(kind==="tp_pending_new"||kind==="both_pending_new")tp.status="PENDING_NEW";
if(kind==="stop_partially_filled")stop.status="PARTIALLY_FILLED";
if(kind==="tp_partially_filled")tp.status="PARTIALLY_FILLED";
if(kind==="stop_pending_cancel_reject")stop.status="PENDING_CANCEL";
if(kind==="tp_pending_cancel_reject")tp.status="PENDING_CANCEL";
if(kind==="stop_canceled_reject")stop.status="CANCELED";
if(kind==="tp_expired_reject")tp.status="EXPIRED";
if(kind==="stop_filled_reject")stop.status="FILLED";
if(kind==="tp_filled_reject")tp.status="FILLED";
if(kind==="wrong_stop_price")stop.stopPrice=111;
if(kind==="missing_stop")orders.shift();
if(kind==="wrong_side")positions[0].positionSide="LONG";
if(kind==="unmanaged_new_reject")orders.push({...stop,clientOrderId:"foreign-stop",orderId:9999,status:"NEW"});
const venue={async getPositions(symbol){return positions;},async getOpenOrders(symbol){return orders;}};
(async()=>{
 let status="pass",reason="";
 try{await recovery.recoverIdleProtectedRateBudgetState({statePath,expectedSha:sha,sourceSha:sha,backupPath:path.join(caseDir,"backup.json"),venue,now:()=>1700000000000});}
 catch(e){status="rejected";reason=String(e.message);}
 const after=JSON.parse(fs.readFileSync(statePath,"utf8"));
 process.stdout.write(JSON.stringify({kind,status,reason,stopStatus:stop.status,tpStatus:tp.status,finalReview:after.manualReview,backupExists:fs.existsSync(path.join(caseDir,"backup.json"))}));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
"""
def verify_pins():
 for name,pin in PINS.items():
  raw=(PINROOT/pathlib.Path(name).name).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=pin:raise RuntimeError("SOURCE_PIN_MISMATCH:"+name)
 recovery=(PINROOT/"disdex-idle-priority-short-protected-rate-budget-recovery.ts").read_text(encoding="utf8")
 if 'new Set(["NEW", "PARTIALLY_FILLED", "PENDING_NEW"])' not in recovery:raise RuntimeError("ACTIVE_STATUSES_CHANGED")
 if 'ACTIVE_ORDER_STATUSES.has(String(order.status || "").toUpperCase())' not in recovery:raise RuntimeError("ACTIVE_PREDICATE_CHANGED")
 if 'await assertProtectedVenueReadback(checked, input.venue)' not in recovery:raise RuntimeError("VENUE_READBACK_CHANGED")
def fetch():
 if PINROOT.exists():raise RuntimeError("PIN_DIR_EXISTS")
 PINROOT.mkdir()
 for name,pin in PINS.items():
  url="repos/dunamishajime-bit/-ai-dex-manager/contents/"+name+"?ref="+REF
  p=subprocess.run(["gh","api",url,"-H","Accept: application/vnd.github.raw"],capture_output=True,timeout=45)
  if p.returncode:raise RuntimeError("GITHUB_RAW_FETCH_FAILED:"+name+":"+p.stderr.decode(errors="replace")[-400:])
  raw=p.stdout
  if hashlib.sha256(raw).hexdigest()!=pin:raise RuntimeError("GITHUB_RAW_SHA_MISMATCH:"+name)
  (PINROOT/pathlib.Path(name).name).write_bytes(raw)
 verify_pins()
 print(json.dumps({"fetched":len(PINS),"pinned":PINS},sort_keys=True))
def run(tag):
 if not tag.isalnum() or len(tag)>32:raise RuntimeError("INVALID_TAG")
 verify_pins()
 work=ROOT/("pending-new-audit-"+tag)
 if work.exists():raise RuntimeError("RUN_EXISTS")
 work.mkdir()
 (work/"pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 (work/"worker.cjs").write_text(NODE,encoding="utf8",newline="\n")
 env=os.environ.copy()
 for key in ("TMP","TEMP","TMPDIR"):env[key]=str(work)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 rows=[]
 for kind in CASES:
  d=work/kind;d.mkdir()
  p=subprocess.run(["node",str(work/"worker.cjs"),str(d),kind],cwd=d,env=env,capture_output=True,text=True,timeout=30)
  if p.returncode:raise RuntimeError("NODE_CASE_FAILED:"+kind+":"+p.stderr[-2000:])
  row=json.loads(p.stdout.strip())
  should_pass=kind in ACCEPT
  if should_pass and not(row["status"]=="pass" and row["finalReview"] is None and row["backupExists"]):raise RuntimeError("PASS_EXPECTED:"+str(row))
  if not should_pass and not(row["status"]=="rejected" and row["finalReview"] is not None):raise RuntimeError("REJECT_EXPECTED:"+str(row))
  rows.append(row)
 data={"sourceSha256":PINS,"caseCount":len(rows),"results":rows}
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(rows),"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":rows},sort_keys=True))
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--fetch",action="store_true")
 ap.add_argument("--tag")
 args=ap.parse_args()
 if args.fetch:fetch()
 elif args.tag:run(args.tag)
 else:raise RuntimeError("FETCH_OR_TAG_REQUIRED")
if __name__=="__main__":main()
