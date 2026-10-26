#!/usr/bin/env python3
"""Pinned original TS protected-rate-budget recovery concurrent state writer audit, synthetic venue, Windows FS, research only."""
import argparse,hashlib,json,os,pathlib,subprocess,sys
ROOT=pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINROOT=ROOT/"audit17-protected-recovery-race-pins"
REF="939b59da49ce7960485a2004b0068dc63417ae82"
PINS={
"scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts":"70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09",
"lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
"config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
"lib/aster-v3-client.ts":"4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf"
}
CASES=("baseline","peer_pending","peer_manual_review","peer_cooldown","peer_position_qty","peer_last_decision","pending_reject","wrong_stop_price","missing_stop","unknown_review_reject")
NODE=r"""
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto"),cp=require("node:child_process");
const {stripTypeScriptTypes}=require("node:module");
const [mode,caseDir,kind]=process.argv.slice(2);
const root=path.resolve("C:/Users/dis/render4427-research-only");
const pins=JSON.parse(fs.readFileSync(path.join(caseDir,"..","pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const raw=fs.readFileSync(path.join(root,"audit17-protected-recovery-race-pins",path.basename(name)));
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
const state=compile(sources["lib/idle-priority-short-state.ts"],vm.createContext({...base,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY}),"normalizeIdleState,writeIdleState");
const sha="a".repeat(40),statePath=path.join(caseDir,"state.json"),rule=cfg.IDLE_PRIORITY_SHORT_POLICY.routes.RENDERUSDT;
function position(){return {symbol:"RENDERUSDT",route:rule.route,side:"SHORT",signalTs:1000,entryTs:2000,exitTs:2000+rule.holdHours*3600000,entryPrice:100,quantity:1,holdHours:rule.holdHours,gross:rule.gross,stopPrice:110,takeProfitPrice:90,stopClientOrderId:"audit-stop",takeProfitClientOrderId:"audit-tp",protectionVerified:true};}
function pending(){return {action:"ENTRY",phase:"submitted",symbol:"RENDERUSDT",route:rule.route,clientOrderId:"new-pending",idempotencyKey:"new-pending",quantity:1,expectedPrice:100,signalTs:1000,decisionTs:2000,holdHours:rule.holdHours,createdAt:3000,updatedAt:4000,reason:"peer",reservationId:"peer-reservation",gross:rule.gross};}
function modify(s,what){
 if(what==="pending")s.pending=pending();
 else if(what==="manual_review")s.manualReview="IDLE_PEER_NEW_CRITICAL_REVIEW";
 else if(what==="cooldown")s.lastAcceptedBySymbol.RENDERUSDT=5000;
 else if(what==="position_qty")s.positions[0].quantity=0.5;
 else if(what==="last_decision")s.lastDecision={decisionTs:5000,accepted:false,reason:"PEER_NEW_DECISION"};
 else throw Error("UNKNOWN_PEER_CHANGE:"+what);
 return s;
}
(async()=>{
 if(mode==="peer"){
  const current=JSON.parse(fs.readFileSync(statePath,"utf8"));
  await state.writeIdleState(statePath,modify(current,kind));
  process.stdout.write(JSON.stringify({peerSaved:true,kind}));
  return;
 }
 if(mode!=="case")throw Error("INVALID_MODE");
 const peer=kind.startsWith("peer_")?kind.slice(5):null;
 const wrappedCopy=async(a,b)=>{
  await fsp.copyFile(a,b);
  if(peer){
   const result=cp.spawnSync(process.execPath,[__filename,"peer",caseDir,peer],{cwd:caseDir,encoding:"utf8",timeout:15000,env:process.env});
   if(result.status!==0)throw Error("PEER_WRITE_FAILED:"+String(result.stderr).slice(-1200));
   const peerReadback=JSON.parse(fs.readFileSync(statePath,"utf8"));
   const proved=(peer==="pending"&&!!peerReadback.pending)||(peer==="manual_review"&&peerReadback.manualReview==="IDLE_PEER_NEW_CRITICAL_REVIEW")||(peer==="cooldown"&&peerReadback.lastAcceptedBySymbol.RENDERUSDT===5000)||(peer==="position_qty"&&peerReadback.positions[0].quantity===0.5)||(peer==="last_decision"&&peerReadback.lastDecision?.reason==="PEER_NEW_DECISION");
   if(!proved)throw Error("PEER_WRITE_NOT_VISIBLE_BEFORE_RECOVERY_RENAME:"+peer);
  }
 };
 const recovery=compile(sources["scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts"].split("function numberEnv(")[0],
   vm.createContext({...base,copyFile:wrappedCopy,normalizeIdleState:state.normalizeIdleState}),"recoverIdleProtectedRateBudgetState");
 const initial={schema:"disdex-idle-priority-state/v2",runtimeSha:sha,updatedAt:10000,positions:[position()],pending:null,manualReview:"IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:500",lastAcceptedBySymbol:{},failures:[]};
 if(kind==="pending_reject")initial.pending=pending();
 if(kind==="unknown_review_reject")initial.manualReview="IDLE_OTHER_CRITICAL_REVIEW";
 fs.writeFileSync(statePath,JSON.stringify(initial));
 const orders=[
 {symbol:"RENDERUSDT",clientOrderId:"audit-stop",type:"STOP_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:kind==="wrong_stop_price"?111:110},
 {symbol:"RENDERUSDT",clientOrderId:"audit-tp",type:"TAKE_PROFIT_MARKET",side:"BUY",status:"NEW",quantity:1,reduceOnly:true,stopPrice:90}
 ];
 if(kind==="missing_stop")orders.shift();
 const venue={async getPositions(){return [{symbol:"RENDERUSDT",quantity:1,positionSide:"SHORT"}];},async getOpenOrders(){return orders;}};
 let status="pass",reason="";
 try{await recovery.recoverIdleProtectedRateBudgetState({statePath,expectedSha:sha,sourceSha:sha,backupPath:path.join(caseDir,"backup.json"),venue,now:()=>1700000000000});}
 catch(e){status="rejected";reason=String(e.message);}
 const final=JSON.parse(fs.readFileSync(statePath,"utf8"));
 const row={kind,status,reason,finalPending:!!final.pending,finalReview:final.manualReview,finalCooldown:!!final.lastAcceptedBySymbol.RENDERUSDT,finalQuantity:final.positions[0].quantity,finalLastDecision:final.lastDecision?.reason||null,backupExists:fs.existsSync(path.join(caseDir,"backup.json"))};
 process.stdout.write(JSON.stringify(row));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
"""
def verify():
 for name,pin in PINS.items():
  path=PINROOT/pathlib.Path(name).name
  if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=pin:raise RuntimeError("SOURCE_PIN_MISMATCH:"+name)
 s=(PINROOT/"disdex-idle-priority-short-protected-rate-budget-recovery.ts").read_text(encoding="utf8")
 if "await exactBackup(statePath, backupPath, beforeBytes, metadata);" not in s or "await rename(temporary, statePath);" not in s:raise RuntimeError("RECOVERY_BOUNDARY_CHANGED")
 t=(PINROOT/"idle-priority-short-state.ts").read_text(encoding="utf8")
 if "export async function writeIdleState" not in t:raise RuntimeError("WRITER_NOT_FOUND")
def fetch():
 if PINROOT.exists():raise RuntimeError("PIN_DIR_EXISTS")
 PINROOT.mkdir()
 for name,pin in PINS.items():
  url="repos/dunamishajime-bit/-ai-dex-manager/contents/"+name+"?ref="+REF
  env=os.environ.copy()
  for k in ("TMP","TEMP","TMPDIR"):env[k]=str(PINROOT)
  p=subprocess.run(["gh","api",url,"-H","Accept: application/vnd.github.raw"],capture_output=True,env=env,timeout=45)
  if p.returncode:raise RuntimeError("GH_RAW_FETCH_FAILED:"+name+":"+p.stderr.decode(errors="replace")[-300:])
  if hashlib.sha256(p.stdout).hexdigest()!=pin:raise RuntimeError("RAW_PIN_MISMATCH:"+name)
  (PINROOT/pathlib.Path(name).name).write_bytes(p.stdout)
 verify()
 print(json.dumps({"sourceRawPinned":True,"fileCount":len(PINS)}))
def run(tag):
 if not tag.isalnum() or len(tag)>32:raise RuntimeError("INVALID_TAG")
 verify()
 work=ROOT/("protected-recovery-race-"+tag)
 if work.exists():raise RuntimeError("WORK_ALREADY_EXISTS")
 work.mkdir()
 (work/"pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 (work/"worker.cjs").write_text(NODE,encoding="utf8",newline="\n")
 env=os.environ.copy()
 for k in ("TMP","TEMP","TMPDIR"):env[k]=str(work)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 rows=[]
 for kind in CASES:
  d=work/kind;d.mkdir()
  p=subprocess.run(["node",str(work/"worker.cjs"),"case",str(d),kind],cwd=d,env=env,capture_output=True,text=True,timeout=40)
  if p.returncode:raise RuntimeError("NODE_CASE_FAILED:"+kind+":"+p.stderr[-1500:])
  row=json.loads(p.stdout.strip())
  if kind in CASES[:6]:
   if not (row["status"]=="pass" and row["finalReview"] is None and not row["finalPending"] and not row["finalCooldown"] and row["finalQuantity"]==1 and row["finalLastDecision"]=="IDLE_PROTECTED_RATE_BUDGET_RECOVERY" and row["backupExists"]):raise RuntimeError("EXPECTED_PASS_AND_PEER_LOST:"+str(row))
  else:
   if not (row["status"]=="rejected" and row["finalReview"] is not None and not row["backupExists"]):raise RuntimeError("EXPECTED_REJECT:"+str(row))
  rows.append(row)
 data={"sourceSha256":PINS,"caseCount":len(rows),"results":rows}
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(rows),"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":rows},sort_keys=True))
def main():
 p=argparse.ArgumentParser();p.add_argument("--fetch",action="store_true");p.add_argument("--tag");a=p.parse_args()
 if a.fetch:fetch()
 elif a.tag:run(a.tag)
 else:raise RuntimeError("FETCH_OR_TAG_REQUIRED")
if __name__=="__main__":main()
