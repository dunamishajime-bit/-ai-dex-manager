#!/usr/bin/env python3
"""RENDER #4427 backup destination TOCTOU: original TS and real Windows FS, research only."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys

ROOT=pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINROOT=ROOT/"audit29-backup-target-race-pins"
REF="939b59da49ce7960485a2004b0068dc63417ae82"
PINS={
 "scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts":"70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09",
 "lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
 "config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
 "lib/aster-v3-client.ts":"4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf",
}
CASES=(
 "baseline","race_backup_json","race_backup_binary","race_backup_large",
 "control_backup_preexists","control_backup_directory","control_pending",
 "control_missing_position","control_missing_stop","control_missing_tp",
 "control_wrong_stop_price","control_foreign_active",
)
ACCEPT=set(CASES[:4])
RACES=set(CASES[1:4])
NODE=r'''
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process"),{stripTypeScriptTypes}=require("node:module");
const [caseDir,kind]=process.argv.slice(2);
const root=path.resolve("C:/Users/dis/render4427-research-only");
if(!path.resolve(caseDir).startsWith(root+path.sep))throw Error("OUT_OF_SCOPE");
const pins=JSON.parse(fs.readFileSync(path.join(caseDir,"..","pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const raw=fs.readFileSync(path.join(root,"audit29-backup-target-race-pins",path.basename(name)));
 if(crypto.createHash("sha256").update(raw).digest("hex")!==pin)throw Error("SOURCE_PIN_MISMATCH:"+name);
 sources[name]=raw.toString("utf8");
}
let renameCount=0,copyCalls=0,witnessCreated=false,witnessChildExit0=false;
const backupPath=path.join(caseDir,"backup.json");
const witness=kind==="race_backup_binary"?Buffer.from([0,255,10,0,90,11,254]):
 kind==="race_backup_large"?Buffer.alloc(1024,0x42):
 Buffer.from('{"foreignBackup":"EXISTING_EVIDENCE","owner":"OTHER_PROCESS"}\n',"utf8");
const copyIntercept=async(src,dst)=>{
 copyCalls++;
 if(kind.startsWith("race_")){
  if(path.resolve(dst)!==path.resolve(backupPath))throw Error("UNEXPECTED_BACKUP_PATH");
  if(fs.existsSync(dst))throw Error("PREEXISTING_BACKUP_BEFORE_WITNESS");
  const js="require('node:fs').writeFileSync(process.argv[1],Buffer.from(process.argv[2],'base64'))";
  const child=spawnSync(process.execPath,["-e",js,dst,witness.toString("base64")],{cwd:caseDir,timeout:10000,windowsHide:true});
  witnessChildExit0=child.status===0;
  if(!witnessChildExit0)throw Error("WITNESS_CHILD_FAILED:"+String(child.stderr));
  witnessCreated=fs.readFileSync(dst).equals(witness);
  if(!witnessCreated)throw Error("WITNESS_NOT_CREATED");
 }
 return fsp.copyFile(src,dst);
};
const base={process,Date,Number,Promise,Error,Set,Map,Buffer,console,dirname:path.dirname,resolve:path.resolve,
 chmod:fsp.chmod,chown:fsp.chown,copyFile:copyIntercept,lstat:fsp.lstat,mkdir:fsp.mkdir,open:fsp.open,readFile:fsp.readFile,
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
if(kind==="control_pending")initial.pending={action:"ENTRY",phase:"submitted",symbol:"RENDERUSDT",route:saved.route,clientOrderId:"pending-entry",idempotencyKey:"pending-entry",quantity:1,expectedPrice:100,signalTs:1000,decisionTs:2000,holdHours:saved.holdHours,createdAt:3000,updatedAt:4000,reason:"pending-check",gross:saved.gross};
const initialBytes=Buffer.from(JSON.stringify(initial));
fs.writeFileSync(statePath,initialBytes);
if(kind==="control_backup_preexists")fs.writeFileSync(backupPath,witness);
if(kind==="control_backup_directory")fs.mkdirSync(backupPath);
const position={symbol:"RENDERUSDT",quantity:-1,positionSide:"BOTH"};
const stop={symbol:"RENDERUSDT",clientOrderId:"audit-stop",type:"STOP_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:kind==="control_wrong_stop_price"?111:110};
const tp={symbol:"RENDERUSDT",clientOrderId:"audit-tp",type:"TAKE_PROFIT_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:90};
const foreign={symbol:"RENDERUSDT",clientOrderId:"foreign",type:"LIMIT",side:"SELL",status:"NEW",quantity:1,reduceOnly:false,stopPrice:100};
let positionCalls=0,orderCalls=0;
const venue={
 async getPositions(symbol){positionCalls++;return kind==="control_missing_position"?[]:[position];},
 async getOpenOrders(symbol){orderCalls++;return [...(kind==="control_missing_stop"?[]:[stop]),...(kind==="control_missing_tp"?[]:[tp]),...(kind==="control_foreign_active"?[foreign]:[])];}
};
(async()=>{
 let status="pass",errorCode="";
 try{await recovery.recoverIdleProtectedRateBudgetState({statePath,expectedSha:sha,sourceSha:sha,backupPath,venue,now:()=>1700000000000});}
 catch(e){status="rejected";errorCode=String(e.message);}
 const after=JSON.parse(fs.readFileSync(statePath,"utf8"));
 const backupIsFile=fs.existsSync(backupPath)&&fs.statSync(backupPath).isFile();
 const backupBytes=backupIsFile?fs.readFileSync(backupPath):Buffer.alloc(0);
 const backupExact=backupBytes.equals(initialBytes);
 const witnessPreserved=backupBytes.equals(witness);
 process.stdout.write(JSON.stringify({kind,status,errorCode,renameCount,copyCalls,witnessCreated,witnessChildExit0,
   witnessPreserved,backupExact,manualReviewCleared:after.manualReview===null,positionCalls,orderCalls}));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
'''

def controlled_environment(work):
 env=os.environ.copy()
 for k in ("TMP","TEMP","TMPDIR","XDG_CACHE_HOME"):
  env[k]=str(work)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 return env

def verify_pins():
 for name,expected in PINS.items():
  data=(PINROOT/pathlib.Path(name).name).read_bytes()
  if hashlib.sha256(data).hexdigest()!=expected:raise RuntimeError("SOURCE_PIN_MISMATCH:"+name)
 src=(PINROOT/"disdex-idle-priority-short-protected-rate-budget-recovery.ts").read_text(encoding="utf8")
 for needle in ('await stat(backupPath);','await copyFile(statePath, backupPath);','if (!(await readFile(backupPath)).equals(beforeBytes))'):
  if needle not in src:raise RuntimeError("SOURCE_CONTRACT_CHANGED:"+needle)

def fetch():
 if PINROOT.exists():raise RuntimeError("PIN_DIR_EXISTS")
 PINROOT.mkdir()
 for name,expected in PINS.items():
  endpoint="repos/dunamishajime-bit/-ai-dex-manager/contents/"+name+"?ref="+REF
  r=subprocess.run(["gh","api",endpoint,"-H","Accept: application/vnd.github.raw"],
                   cwd=ROOT,env=controlled_environment(PINROOT),capture_output=True,timeout=50)
  if r.returncode:raise RuntimeError("RAW_FETCH_FAILED:"+name+":"+r.stderr.decode(errors="replace")[-400:])
  if hashlib.sha256(r.stdout).hexdigest()!=expected:raise RuntimeError("RAW_BYTES_SHA_MISMATCH:"+name)
  (PINROOT/pathlib.Path(name).name).write_bytes(r.stdout)
 verify_pins()
 print(json.dumps({"status":"RAW_GITHUB_PINS_PASS","sourceCommit":REF,"sourceRawSha256":PINS},sort_keys=True))

def run(tag):
 if not tag.isalnum() or len(tag)>32:raise RuntimeError("INVALID_TAG")
 verify_pins()
 work=ROOT/("backup-target-race-audit-"+tag)
 if work.exists():raise RuntimeError("RUN_EXISTS")
 work.mkdir()
 (work/"pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 (work/"worker.cjs").write_text(NODE,encoding="utf8",newline="\n")
 rows=[]
 for kind in CASES:
  directory=work/kind
  directory.mkdir()
  r=subprocess.run(["node",str(work/"worker.cjs"),str(directory),kind],
                   capture_output=True,text=True,cwd=directory,env=controlled_environment(work),timeout=35)
  if r.returncode:raise RuntimeError("NODE_CASE_FAILED:"+kind+":"+r.stderr[-2500:])
  row=json.loads(r.stdout.strip())
  if row["status"]!=("pass" if kind in ACCEPT else "rejected"):raise RuntimeError("STATUS_MISMATCH:"+str(row))
  if kind in ACCEPT:
   if row["renameCount"]!=1 or row["copyCalls"]!=1 or not row["backupExact"] or not row["manualReviewCleared"]:
    raise RuntimeError("ACCEPT_INCOMPLETE:"+str(row))
  if kind in RACES:
   if not row["witnessCreated"] or not row["witnessChildExit0"] or row["witnessPreserved"]:
    raise RuntimeError("WITNESS_NOT_OVERWRITTEN:"+str(row))
  if kind=="control_backup_preexists":
   if not row["witnessPreserved"] or row["copyCalls"]!=0 or row["renameCount"]!=0:
    raise RuntimeError("PREEXISTING_BACKUP_CONTROL_FAILED:"+str(row))
  if kind=="control_backup_directory" and (row["copyCalls"]!=0 or row["renameCount"]!=0):
   raise RuntimeError("DIRECTORY_BACKUP_CONTROL_FAILED:"+str(row))
  if kind=="control_pending" and (row["positionCalls"]!=0 or row["orderCalls"]!=0):
   raise RuntimeError("PENDING_CONTROL_FAILED:"+str(row))
  if kind not in ACCEPT and row["manualReviewCleared"]:
   raise RuntimeError("REJECT_BUT_REVIEW_CLEARED:"+str(row))
  rows.append(row)
 data={"sourceSha256":PINS,"caseCount":len(rows),"results":rows}
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(rows),
                   "canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),
                   "results":rows},sort_keys=True))

def six():
 launch=ROOT/"audit29-backup-target-race-launchers"
 if launch.exists():raise RuntimeError("LAUNCHER_DIR_EXISTS")
 launch.mkdir()
 script=ROOT/"audit_render4427_backup_target_race_20261027.py"
 a="""import os,sys,runpy,pathlib
p=pathlib.Path(r'C:\\Users\\dis\\render4427-research-only')
for k in ('TMP','TEMP','TMPDIR','XDG_CACHE_HOME'):os.environ[k]=str(p)
os.environ['PYTHONDONTWRITEBYTECODE']='1'
s=p/'audit_render4427_backup_target_race_20261027.py'
sys.argv=[str(s),'--tag',sys.argv[1]]
runpy.run_path(str(s),run_name='__main__')
"""
 b="""import os,sys,subprocess,pathlib
p=pathlib.Path(r'C:\\Users\\dis\\render4427-research-only')
env=os.environ.copy()
for k in ('TMP','TEMP','TMPDIR','XDG_CACHE_HOME'):env[k]=str(p)
env['PYTHONDONTWRITEBYTECODE']='1'
flags=['-'+'O'*sys.flags.optimize] if sys.flags.optimize else []
s=p/'audit_render4427_backup_target_race_20261027.py'
r=subprocess.run([sys.executable,*flags,str(s),'--tag',sys.argv[1]],cwd=p,env=env,capture_output=True,text=True,timeout=180)
if r.returncode:raise RuntimeError('INNER_AUDIT_FAILED:'+r.stderr[-2500:])
print(r.stdout.strip())
"""
 (launch/"launcher_a.py").write_text(a,encoding="utf8",newline="\n")
 (launch/"launcher_b.py").write_text(b,encoding="utf8",newline="\n")
 runs=[]
 for flag,mode in (([],"normal"),(["-O"],"O"),(["-OO"],"OO")):
  for launcher in ("a","b"):
   tag="backup29"+mode+launcher
   r=subprocess.run([sys.executable,*flag,str(launch/("launcher_"+launcher+".py")),tag],
                    capture_output=True,text=True,cwd=ROOT,env=controlled_environment(ROOT),timeout=240)
   if r.returncode:raise RuntimeError("CHILD_FAILED:"+tag+":"+r.stderr[-3000:])
   data=json.loads(r.stdout.strip())
   if data["optimize"]!={"normal":0,"O":1,"OO":2}[mode] or data["caseCount"]!=len(CASES):
    raise RuntimeError("OPTIMIZATION_MISMATCH:"+tag)
   item={"launcher":launcher,"mode":mode,"exitCode":r.returncode,
         "caseCount":data["caseCount"],"canonicalSha256":data["canonicalSha256"]}
   runs.append(item)
   print(json.dumps(item,sort_keys=True),flush=True)
 if len({x["canonicalSha256"] for x in runs})!=1:raise RuntimeError("SIX_PROCESS_CANONICAL_MISMATCH")
 evidence={"status":"PASS","sourceCommit":REF,"sourceRawSha256":PINS,
           "sourceScriptSha256":hashlib.sha256(script.read_bytes()).hexdigest(),
           "owner":"IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH",
           "route":"IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT","gross":0.25,
           "nativeAllocator":"NEED_NATIVE_ALLOCATOR","orderAuthorized":False,
           "caseCount":len(CASES),"totalCases":len(CASES)*6,"sixProcesses":runs,
           "canonicalSha256":runs[0]["canonicalSha256"],
           "venueResponse":"synthetic","writer":"independent Node OS child creates backup target after stat before copyFile on real Windows FS",
           "productionModified":False,
           "limitations":"Controlled IO interposition; not natural Production collision, Aster receipt, Native8 or 13 GateProof."}
 target=ROOT/"audit29-backup-target-race-evidence.json"
 if target.exists():raise RuntimeError("EVIDENCE_EXISTS")
 target.write_text(json.dumps(evidence,indent=2,sort_keys=True,ensure_ascii=False)+"\n",encoding="utf8",newline="\n")
 print(json.dumps({"status":"PASS","totalCases":evidence["totalCases"],
                   "canonicalSha256":evidence["canonicalSha256"],"evidenceFile":target.name},sort_keys=True))

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--fetch",action="store_true")
 p.add_argument("--tag")
 p.add_argument("--six",action="store_true")
 a=p.parse_args()
 if a.fetch:fetch()
 elif a.tag:run(a.tag)
 elif a.six:six()
 else:raise RuntimeError("FETCH_OR_TAG_OR_SIX_REQUIRED")
if __name__=="__main__":main()
