#!/usr/bin/env python3
"""RENDER #4427: protected recovery post-rename readback identity audit; research only."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINROOT = ROOT / "audit27-postrename-readback-pins"
REF = "939b59da49ce7960485a2004b0068dc63417ae82"
PINS = {
    "scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts": "70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09",
    "lib/idle-priority-short-state.ts": "4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
    "config/idlePriorityShortPolicy.ts": "6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
    "lib/aster-v3-client.ts": "4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf",
}
CASES = (
    "baseline", "post_pending_entry", "post_pending_exit",
    "post_quantity_change", "post_stop_price_change", "post_tp_price_change",
    "post_stop_id_change", "post_tp_id_change", "post_entry_price_change",
    "post_cooldown_change", "post_lastdecision_change", "post_updatedat_change",
    "post_position_count_zero", "post_runtime_sha_change", "post_manual_review_change",
    "post_invalid_route", "post_invalid_gross", "post_invalid_stop_price",
)
ACCEPT = set(CASES[:12])
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
 const raw=fs.readFileSync(path.join(root,"audit27-postrename-readback-pins",path.basename(name)));
 if(crypto.createHash("sha256").update(raw).digest("hex")!==pin)throw Error("SOURCE_PIN_MISMATCH:"+name);
 sources[name]=raw.toString("utf8");
}
const MUTATE = String.raw`
const fs=require("node:fs");
const [file,kind]=process.argv.slice(1);
const x=JSON.parse(fs.readFileSync(file,"utf8"));
const p=x.positions[0];
switch(kind){
 case "post_pending_entry":case "post_pending_exit":
  x.pending={action:kind==="post_pending_entry"?"ENTRY":"EXIT",phase:"submitted",symbol:"RENDERUSDT",route:p.route,clientOrderId:"postcommit-pending",idempotencyKey:"postcommit-pending",quantity:1,expectedPrice:100,signalTs:1000,decisionTs:2000,holdHours:p.holdHours,createdAt:3000,updatedAt:4000,reason:"postcommit-writer",gross:p.gross};break;
 case "post_quantity_change":p.quantity=2;break;
 case "post_stop_price_change":p.stopPrice=120;break;
 case "post_tp_price_change":p.takeProfitPrice=85;break;
 case "post_stop_id_change":p.stopClientOrderId="new-stop-generation";break;
 case "post_tp_id_change":p.takeProfitClientOrderId="new-tp-generation";break;
 case "post_entry_price_change":p.entryPrice=95;break;
 case "post_cooldown_change":x.lastAcceptedBySymbol={RENDERUSDT:1700000000000};break;
 case "post_lastdecision_change":x.lastDecision={decisionTs:1700000000000,accepted:true,reason:"OTHER_WRITER"};break;
 case "post_updatedat_change":x.updatedAt=1700000000123;break;
 case "post_position_count_zero":x.positions=[];break;
 case "post_runtime_sha_change":x.runtimeSha="b".repeat(40);break;
 case "post_manual_review_change":x.manualReview="OTHER_WRITER_REVIEW";break;
 case "post_invalid_route":p.route="WRONG_ROUTE";break;
 case "post_invalid_gross":p.gross=99;break;
 case "post_invalid_stop_price":p.stopPrice=50;break;
 default:throw Error("UNKNOWN_MUTATION:"+kind);
}
x.auditMutation=kind;
fs.writeFileSync(file,JSON.stringify(x));
`;
let renameCount=0,writerPid=0;
const base={process,Date,Number,Promise,Error,Set,Map,Buffer,console,dirname:path.dirname,resolve:path.resolve,
 chmod:fsp.chmod,chown:fsp.chown,copyFile:fsp.copyFile,lstat:fsp.lstat,mkdir:fsp.mkdir,open:fsp.open,readFile:fsp.readFile,
 rename:async(src,dst)=>{
   await fsp.rename(src,dst);
   renameCount++;
   if(kind!=="baseline"){
     const env={...process.env,TMP:caseDir,TEMP:caseDir,TMPDIR:caseDir,NODE_OPTIONS:""};
     const child=spawnSync(process.execPath,["-e",MUTATE,dst,kind],{cwd:caseDir,env,encoding:"utf8",timeout:10000});
     if(child.error||child.status!==0)throw Error("POST_RENAME_WRITER_FAILED:"+String(child.stderr||child.error));
     writerPid=child.pid||0;
   }
 },stat:fsp.stat};
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
let positionCalls=0,orderCalls=0;
const venue={
 async getPositions(symbol){positionCalls++;return [{symbol:"RENDERUSDT",quantity:-1,positionSide:"BOTH"}];},
 async getOpenOrders(symbol){orderCalls++;return [stop,tp];}
};
(async()=>{
 let status="pass",errorCode="";
 try{await recovery.recoverIdleProtectedRateBudgetState({statePath,expectedSha:sha,sourceSha:sha,backupPath:path.join(caseDir,"backup.json"),venue,now:()=>1700000000000});}
 catch(e){status="rejected";errorCode=String(e.message);}
 const after=JSON.parse(fs.readFileSync(statePath,"utf8"));
 const backup=fs.readFileSync(path.join(caseDir,"backup.json"));
 const initialBytes=Buffer.from(JSON.stringify(initial));
 process.stdout.write(JSON.stringify({kind,status,errorCode,renameCount,writerPidPresent:writerPid>0,mutation:after.auditMutation||null,manualReviewCleared:after.manualReview===null,positionCount:after.positions.length,pendingAction:after.pending?.action||null,positionQty:after.positions[0]?.quantity??null,stopId:after.positions[0]?.stopClientOrderId||null,positionCalls,orderCalls,backupExact:backup.equals(initialBytes)}));
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
    work = ROOT / ("postrename-readback-audit-" + tag)
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
        if row["renameCount"]!=1 or row["positionCalls"]!=1 or row["orderCalls"]!=1 or not row["backupExact"]:
            raise RuntimeError("READBACK_OR_BACKUP_MISMATCH:"+str(row))
        if kind=="baseline":
            if row["mutation"] is not None or row["writerPidPresent"]:
                raise RuntimeError("BASELINE_MUTATED:"+str(row))
        else:
            if row["mutation"]!=kind or not row["writerPidPresent"]:
                raise RuntimeError("POST_RENAME_WRITER_NOT_PROVEN:"+str(row))
        if kind in ACCEPT and not row["manualReviewCleared"]:
            raise RuntimeError("EXPECTED_REVIEW_CLEAR:"+str(row))
        rows.append(row)
    data={"sourceSha256":PINS,"caseCount":len(rows),"results":rows}
    canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
    print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(rows),
                      "canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),
                      "results":rows},sort_keys=True))

def six():
    launch=ROOT/"audit27-postrename-readback-launchers"
    if launch.exists():
        raise RuntimeError("LAUNCHER_DIR_EXISTS")
    launch.mkdir()
    script=ROOT/"audit_render4427_postrename_readback_20261027.py"
    a="""import os,sys,runpy,pathlib
p=pathlib.Path(r'C:\\Users\\dis\\render4427-research-only')
for k in ('TMP','TEMP','TMPDIR'):os.environ[k]=str(p)
os.environ['PYTHONDONTWRITEBYTECODE']='1'
s=p/'audit_render4427_postrename_readback_20261027.py'
sys.argv=[str(s),'--tag',sys.argv[1]]
runpy.run_path(str(s),run_name='__main__')
"""
    b="""import os,sys,subprocess,pathlib
p=pathlib.Path(r'C:\\Users\\dis\\render4427-research-only')
env=os.environ.copy()
for k in ('TMP','TEMP','TMPDIR'):env[k]=str(p)
env['PYTHONDONTWRITEBYTECODE']='1'
flags=['-'+'O'*sys.flags.optimize] if sys.flags.optimize else []
s=p/'audit_render4427_postrename_readback_20261027.py'
r=subprocess.run([sys.executable,*flags,str(s),'--tag',sys.argv[1]],cwd=p,env=env,capture_output=True,text=True,timeout=180)
if r.returncode:raise RuntimeError('INNER_AUDIT_FAILED:'+r.stderr[-2500:])
print(r.stdout.strip())
"""
    (launch/"launcher_a.py").write_text(a,encoding="utf8",newline="\n")
    (launch/"launcher_b.py").write_text(b,encoding="utf8",newline="\n")
    runs=[]
    for flag,mode in (([],"normal"),(["-O"],"O"),(["-OO"],"OO")):
        for launcher in ("a","b"):
            tag="pread1747"+mode+launcher
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
              "venueResponse":"synthetic","writer":"separate real Windows Node OS process after state rename",
              "productionModified":False,
              "limitations":"Controlled post-rename race, not natural Production race; no real Aster receipt, Native8 or 13 GateProof."}
    target=ROOT/"audit27-postrename-readback-evidence.json"
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
