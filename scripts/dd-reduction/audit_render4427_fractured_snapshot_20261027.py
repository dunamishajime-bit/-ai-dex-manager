#!/usr/bin/env python3
"""RENDER #4427: protected recovery cross-endpoint fractured venue snapshot audit; research only."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINROOT = ROOT / "audit28-fractured-snapshot-pins"
REF = "939b59da49ce7960485a2004b0068dc63417ae82"
PINS = {
    "scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts": "70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09",
    "lib/idle-priority-short-state.ts": "4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
    "config/idlePriorityShortPolicy.ts": "6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
    "lib/aster-v3-client.ts": "4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf",
}
CASES = (
    "baseline", "fractured_position_first", "fractured_orders_first",
    "fractured_position_first_extra_fields", "fractured_orders_first_extra_fields",
    "control_missing_position", "control_missing_stop", "control_missing_tp",
    "control_wrong_stop_price", "control_wrong_tp_price", "control_foreign_active",
    "control_pending_state", "control_long_position", "control_stop_canceled",
    "control_tp_canceled", "control_wrong_stop_side",
)
ACCEPT = set(CASES[:5])
FRACTURED = set(CASES[1:5])
NODE = r'''
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {stripTypeScriptTypes}=require("node:module");
const [caseDir,kind]=process.argv.slice(2);
const root=path.resolve("C:/Users/dis/render4427-research-only");
if(!path.resolve(caseDir).startsWith(root+path.sep))throw Error("OUT_OF_SCOPE");
const pins=JSON.parse(fs.readFileSync(path.join(caseDir,"..","pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const raw=fs.readFileSync(path.join(root,"audit28-fractured-snapshot-pins",path.basename(name)));
 if(crypto.createHash("sha256").update(raw).digest("hex")!==pin)throw Error("SOURCE_PIN_MISMATCH:"+name);
 sources[name]=raw.toString("utf8");
}
let renameCount=0;
const base={process,Date,Number,Promise,Error,Set,Map,Buffer,console,dirname:path.dirname,resolve:path.resolve,
 chmod:fsp.chmod,chown:fsp.chown,copyFile:fsp.copyFile,lstat:fsp.lstat,mkdir:fsp.mkdir,open:fsp.open,readFile:fsp.readFile,
 rename:async(src,dst)=>{await fsp.rename(src,dst);renameCount++;},stat:fsp.stat};
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
const saved={symbol:"RENDERUSDT",route:rule.route,side:"SHORT",signalTs:1000,entryTs:2000,exitTs:2000+rule.holdHours*3600000,entryPrice:100,quantity:1,holdHours:rule.holdHours,gross:rule.gross,stopPrice:110,takeProfitPrice:90,stopClientOrderId:"audit-stop",takeProfitClientOrderId:"audit-tp",protectionVerified:true};
const initial={schema:"disdex-idle-priority-state/v2",runtimeSha:sha,updatedAt:10000,positions:[saved],pending:null,manualReview:"IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:500",lastAcceptedBySymbol:{},failures:[]};
fs.writeFileSync(statePath,JSON.stringify(initial));
const stop={symbol:"RENDERUSDT",clientOrderId:"audit-stop",type:"STOP_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:110};
const tp={symbol:"RENDERUSDT",clientOrderId:"audit-tp",type:"TAKE_PROFIT_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:90};
let positionCalls=0,orderCalls=0,positionsReturned=0,ordersReturned=0;
const fractured=kind.startsWith("fractured_");
const ordersFirst=kind.startsWith("fractured_orders_first");
const extra=kind.endsWith("_extra_fields");
let physical=ordersFirst?{position:false,stop:true,tp:true}:fractured?{position:true,stop:false,tp:false}:{position:true,stop:true,tp:true};
const timeline=[{tick:0,...physical}];
function transition(position,stopActive,tpActive){
 physical={position,stop:stopActive,tp:tpActive};
 timeline.push({tick:timeline.length,...physical});
}
if(kind==="control_missing_position")transition(false,true,true);
if(kind==="control_missing_stop")transition(true,false,true);
if(kind==="control_missing_tp")transition(true,true,false);
if(kind==="control_pending_state"){
 initial.pending={action:"ENTRY",phase:"submitted",symbol:"RENDERUSDT",route:saved.route,clientOrderId:"pending-entry",idempotencyKey:"pending-entry",quantity:1,expectedPrice:100,signalTs:1000,decisionTs:2000,holdHours:saved.holdHours,createdAt:3000,updatedAt:4000,reason:"pending-check",gross:saved.gross};
 fs.writeFileSync(statePath,JSON.stringify(initial));
}
const position={symbol:"RENDERUSDT",quantity:-1,positionSide:kind==="control_long_position"?"LONG":"BOTH",...(extra?{entryPrice:"100",updateTime:1700000000000,marginType:"cross",leverage:"5"}:{})};
const stopRow={...stop,...(extra?{orderId:9001,updateTime:1700000000001,workingType:"MARK_PRICE",positionSide:"BOTH"}:{})};
const tpRow={...tp,...(extra?{orderId:9002,updateTime:1700000000002,workingType:"MARK_PRICE",positionSide:"BOTH"}:{})};
if(kind==="control_wrong_stop_price")stopRow.stopPrice=111;
if(kind==="control_wrong_tp_price")tpRow.stopPrice=89;
if(kind==="control_stop_canceled")stopRow.status="CANCELED";
if(kind==="control_tp_canceled")tpRow.status="CANCELED";
if(kind==="control_wrong_stop_side")stopRow.side="SELL";
const foreign={symbol:"RENDERUSDT",clientOrderId:"foreign-active",type:"LIMIT",side:"SELL",status:"NEW",quantity:1,reduceOnly:false,stopPrice:100};
const venue={
 async getPositions(symbol){
  positionCalls++;
  if(ordersFirst)await Promise.resolve();
  const rows=physical.position?[position]:[];
  positionsReturned=rows.length;
  if(fractured&&!ordersFirst)transition(false,true,true);
  return rows;
 },
 async getOpenOrders(symbol){
  orderCalls++;
  const rows=[...(physical.stop?[stopRow]:[]),...(physical.tp?[tpRow]:[])];
  if(kind==="control_foreign_active")rows.push(foreign);
  ordersReturned=rows.length;
  if(ordersFirst)transition(true,false,false);
  return rows;
 }
};
(async()=>{
 let status="pass",errorCode="";
 try{await recovery.recoverIdleProtectedRateBudgetState({statePath,expectedSha:sha,sourceSha:sha,backupPath:path.join(caseDir,"backup.json"),venue,now:()=>1700000000000});}
 catch(e){status="rejected";errorCode=String(e.message);}
 const after=JSON.parse(fs.readFileSync(statePath,"utf8"));
 const backupPath=path.join(caseDir,"backup.json");
 const backupExact=fs.existsSync(backupPath)&&fs.readFileSync(backupPath).equals(Buffer.from(JSON.stringify(initial)));
 const noCoexist=timeline.every(x=>!(x.position&&x.stop&&x.tp));
 process.stdout.write(JSON.stringify({kind,status,errorCode,renameCount,manualReviewCleared:after.manualReview===null,
  positionCalls,orderCalls,positionsReturned,ordersReturned,noCoexist,timeline,backupExact}));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
'''

def controlled_environment(work):
    env = os.environ.copy()
    for k in ("TMP", "TEMP", "TMPDIR"):
        env[k] = str(work)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["XDG_CACHE_HOME"] = str(ROOT)
    return env

def verify_pins():
    for name, expected in PINS.items():
        data = (PINROOT / pathlib.Path(name).name).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError("SOURCE_PIN_MISMATCH:" + name)
    rec = (PINROOT / "disdex-idle-priority-short-protected-rate-budget-recovery.ts").read_text(encoding="utf8")
    for needle in ("await rename(temporary, statePath);", "const readback = JSON.parse(await readFile(statePath, \"utf8\"));",
                   "checkedReadback.positions.length !== checked.positions.length",
                   "checkedReadback.manualReview !== null", "checkedReadback.runtimeSha !== expectedSha"):
        if needle not in rec:
            raise RuntimeError("SOURCE_CONTRACT_CHANGED:" + needle)

def fetch():
    if PINROOT.exists():
        raise RuntimeError("PIN_DIR_EXISTS")
    PINROOT.mkdir()
    for name, expected in PINS.items():
        endpoint = "repos/dunamishajime-bit/-ai-dex-manager/contents/" + name + "?ref=" + REF
        result = subprocess.run(["gh", "api", endpoint, "-H", "Accept: application/vnd.github.raw"],
                                capture_output=True, cwd=ROOT, env=controlled_environment(PINROOT), timeout=45)
        if result.returncode:
            raise RuntimeError("RAW_FETCH_FAILED:" + name + ":" + result.stderr.decode(errors="replace")[-400:])
        raw = result.stdout
        if hashlib.sha256(raw).hexdigest() != expected:
            raise RuntimeError("RAW_BYTES_SHA_MISMATCH:" + name)
        (PINROOT / pathlib.Path(name).name).write_bytes(raw)
    verify_pins()
    print(json.dumps({"status":"RAW_GITHUB_PINS_PASS","sourceCommit":REF,"sourceRawSha256":PINS},sort_keys=True))

def run(tag):
    if not tag.isalnum() or len(tag) > 32:
        raise RuntimeError("INVALID_TAG")
    verify_pins()
    work = ROOT / ("fractured-snapshot-audit-" + tag)
    if work.exists():
        raise RuntimeError("RUN_EXISTS")
    work.mkdir()
    (work / "pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
    (work / "worker.cjs").write_text(NODE,encoding="utf8",newline="\n")
    rows = []
    for kind in CASES:
        directory = work / kind
        directory.mkdir()
        result = subprocess.run(["node",str(work / "worker.cjs"),str(directory),kind],
                                capture_output=True,text=True,cwd=directory,env=controlled_environment(work),timeout=35)
        if result.returncode:
            raise RuntimeError("NODE_CASE_FAILED:"+kind+":"+result.stderr[-2500:])
        row=json.loads(result.stdout.strip())
        if row["status"] != ("pass" if kind in ACCEPT else "rejected"):
            raise RuntimeError("EXPECTED_STATUS_MISMATCH:"+str(row))
        if kind=="control_pending_state":
            if row["positionCalls"]!=0 or row["orderCalls"]!=0 or row["renameCount"]!=0:
                raise RuntimeError("PENDING_FAILCLOSED_MISMATCH:"+str(row))
        elif row["positionCalls"]!=1 or row["orderCalls"]!=1:
            raise RuntimeError("VENUE_CALL_MISMATCH:"+str(row))
        if kind in ACCEPT:
            if row["renameCount"]!=1 or not row["backupExact"] or not row["manualReviewCleared"]:
                raise RuntimeError("RECOVERY_ACCEPT_INCOMPLETE:"+str(row))
        if kind in FRACTURED:
            if not row["noCoexist"] or row["positionsReturned"]!=1 or row["ordersReturned"]!=2 or len(row["timeline"])!=2:
                raise RuntimeError("FRACTURED_TIMELINE_NOT_PROVEN:"+str(row))
            if row["timeline"][0]["position"]==row["timeline"][1]["position"]:
                raise RuntimeError("TRANSITION_NOT_PROVEN:"+str(row))
        if kind=="baseline" and row["noCoexist"]:
            raise RuntimeError("BASELINE_NOT_COHERENT:"+str(row))
        rows.append(row)
    data={"sourceSha256":PINS,"caseCount":len(rows),"results":rows}
    canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
    print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(rows),
                      "canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),
                      "results":rows},sort_keys=True))

def six():
    launch=ROOT/"audit28-fractured-snapshot-launchers"
    if launch.exists():
        raise RuntimeError("LAUNCHER_DIR_EXISTS")
    launch.mkdir()
    script=ROOT/"audit_render4427_fractured_snapshot_20261027.py"
    a="""import os,sys,runpy,pathlib
p=pathlib.Path(r'C:\\Users\\dis\\render4427-research-only')
for k in ('TMP','TEMP','TMPDIR'):os.environ[k]=str(p)
os.environ['PYTHONDONTWRITEBYTECODE']='1'
s=p/'audit_render4427_fractured_snapshot_20261027.py'
sys.argv=[str(s),'--tag',sys.argv[1]]
runpy.run_path(str(s),run_name='__main__')
"""
    b="""import os,sys,subprocess,pathlib
p=pathlib.Path(r'C:\\Users\\dis\\render4427-research-only')
env=os.environ.copy()
for k in ('TMP','TEMP','TMPDIR'):env[k]=str(p)
env['PYTHONDONTWRITEBYTECODE']='1'
flags=['-'+'O'*sys.flags.optimize] if sys.flags.optimize else []
s=p/'audit_render4427_fractured_snapshot_20261027.py'
r=subprocess.run([sys.executable,*flags,str(s),'--tag',sys.argv[1]],cwd=p,env=env,capture_output=True,text=True,timeout=180)
if r.returncode:raise RuntimeError('INNER_AUDIT_FAILED:'+r.stderr[-2500:])
print(r.stdout.strip())
"""
    (launch/"launcher_a.py").write_text(a,encoding="utf8",newline="\n")
    (launch/"launcher_b.py").write_text(b,encoding="utf8",newline="\n")
    runs=[]
    for flag,mode in (([],"normal"),(["-O"],"O"),(["-OO"],"OO")):
        for launcher in ("a","b"):
            tag="fract1801"+mode+launcher
            result=subprocess.run([sys.executable,*flag,str(launch/("launcher_"+launcher+".py")),tag],
                                  capture_output=True,text=True,cwd=ROOT,env=controlled_environment(ROOT),timeout=240)
            if result.returncode:
                raise RuntimeError("CHILD_FAILED:"+tag+":"+result.stderr[-3000:])
            data=json.loads(result.stdout.strip())
            if data["optimize"]!={"normal":0,"O":1,"OO":2}[mode] or data["caseCount"]!=len(CASES):
                raise RuntimeError("OPTIMIZATION_OR_COUNT_MISMATCH:"+tag)
            item={"launcher":launcher,"mode":mode,"exitCode":result.returncode,
                  "caseCount":data["caseCount"],"canonicalSha256":data["canonicalSha256"]}
            runs.append(item)
            print(json.dumps(item,sort_keys=True),flush=True)
    if len({x["canonicalSha256"] for x in runs})!=1:
        raise RuntimeError("SIX_PROCESS_CANONICAL_MISMATCH")
    evidence={"status":"PASS","sourceCommit":REF,"sourceRawSha256":PINS,
              "sourceScriptSha256":hashlib.sha256(script.read_bytes()).hexdigest(),
              "owner":"IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH",
              "route":"IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT","gross":0.25,
              "nativeAllocator":"NEED_NATIVE_ALLOCATOR","orderAuthorized":False,
              "caseCount":len(CASES),"totalCases":len(CASES)*6,"sixProcesses":runs,
              "canonicalSha256":runs[0]["canonicalSha256"],
              "venueResponse":"synthetic","writer":"controlled synthetic venue transition during concurrent getPositions/getOpenOrders",
              "productionModified":False,
              "limitations":"Synthetic non-overlapping venue snapshots within Promise.all; not a real Aster event or true signed receipt; no operator caller, Native8 or 13 GateProof."}
    target=ROOT/"audit28-fractured-snapshot-evidence.json"
    if target.exists():
        raise RuntimeError("EVIDENCE_EXISTS")
    target.write_text(json.dumps(evidence,indent=2,sort_keys=True,ensure_ascii=False)+"\n",encoding="utf8",newline="\n")
    print(json.dumps({"status":"PASS","totalCases":evidence["totalCases"],
                      "canonicalSha256":evidence["canonicalSha256"],"evidenceFile":target.name},sort_keys=True))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--fetch",action="store_true")
    parser.add_argument("--tag")
    parser.add_argument("--six",action="store_true")
    args=parser.parse_args()
    if args.fetch:fetch()
    elif args.tag:run(args.tag)
    elif args.six:six()
    else:raise RuntimeError("FETCH_OR_TAG_OR_SIX_REQUIRED")

if __name__=="__main__":
    main()
