#!/usr/bin/env python3
"""Isolated, pinned original-TS state-writer cross-process CAS audit. No venue calls."""
import argparse,hashlib,json,os,pathlib,subprocess,sys,time
ROOT=pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINS={
 "lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
 "config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8"
}
SHA="a"*40
KINDS=("pending_entry","pending_release","cooldown_entry","cooldown_release","manual_review","manual_review_release")
NODE=r'''
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto"),vm=require("node:vm");
const {stripTypeScriptTypes}=require("node:module");
const [root,dir,role,kind]=process.argv.slice(2);
const pins=JSON.parse(fs.readFileSync(path.join(dir,"..","pins.json"),"utf8"));
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
const state=compile(sources["lib/idle-priority-short-state.ts"],{...sandboxBase,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY},"FileIdlePriorityShortStateStore");
const store=new state.FileIdlePriorityShortStateStore(path.join(dir,"state.json"),"a".repeat(40));
const now=1793020000000;
const rule=cfg.IDLE_PRIORITY_SHORT_POLICY.routes.RENDERUSDT;
function pending(){return {action:"ENTRY",phase:"planned",symbol:"RENDERUSDT",route:rule.route,clientOrderId:"audit-entry",idempotencyKey:"audit-entry",quantity:1,expectedPrice:100,signalTs:now-3600000,decisionTs:now-60000,holdHours:rule.holdHours,createdAt:now-50000,updatedAt:now-40000,reason:"synthetic",reservationId:"audit-own-id",gross:rule.gross};}
(async()=>{
 const s=await store.load();
 if(role==="A"){
  if(kind==="pending_entry")s.pending=pending();
  else if(kind==="pending_release")s.pending=null;
  else if(kind==="cooldown_entry")s.lastAcceptedBySymbol.RENDERUSDT=now-1000;
  else if(kind==="cooldown_release")delete s.lastAcceptedBySymbol.RENDERUSDT;
  else if(kind==="manual_review")s.manualReview="AUDIT_MANUAL_REVIEW";
  else if(kind==="manual_review_release")s.manualReview=null;
  else throw Error("INVALID_KIND");
 }else if(role==="B"){
  s.lastDecision={decisionTs:now-1000,accepted:false,reason:"AUDIT_B"};
 }else throw Error("INVALID_ROLE");
 fs.writeFileSync(path.join(dir,"ready-"+role),"READY");
 const start=Date.now();
 while(!fs.existsSync(path.join(dir,"go-"+role))){
  if(Date.now()-start>20000)throw Error("WAIT_GO_TIMEOUT");
  await new Promise(r=>setTimeout(r,10));
 }
 await store.save(s);
 fs.writeFileSync(path.join(dir,"done-"+role),"DONE");
 console.log(JSON.stringify({role,kind,success:true}));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
'''
def inside(p):
 try:p.resolve().relative_to(ROOT);return True
 except ValueError:return False
def wait(p,timeout=20):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  if p.exists():return
  time.sleep(.015)
 raise RuntimeError("WAIT_TIMEOUT:"+p.name)
def initial(kind):
 s={"schema":"disdex-idle-priority-state/v2","runtimeSha":SHA,"updatedAt":1793010000000,"positions":[],"manualReview":None,"pending":None,"lastAcceptedBySymbol":{},"failures":[]}
 if kind=="pending_release":
  # Read the original policy's RENDER route/hold/gross from a pinned source-derived local fixture.
  s["pending"]={"action":"ENTRY","phase":"planned","symbol":"RENDERUSDT","route":"__ROUTE__","clientOrderId":"audit-entry","idempotencyKey":"audit-entry","quantity":1,"expectedPrice":100,"signalTs":1793016400000,"decisionTs":1793019940000,"holdHours":0,"createdAt":1793019950000,"updatedAt":1793019960000,"reason":"synthetic","reservationId":"audit-own-id","gross":0}
 if kind=="cooldown_release":s["lastAcceptedBySymbol"]={"RENDERUSDT":1793019999000}
 if kind=="manual_review_release":s["manualReview"]="AUDIT_PREEXISTING"
 return s
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--tag",required=True);args=ap.parse_args()
 if not args.tag.isalnum() or len(args.tag)>40:raise RuntimeError("INVALID_TAG")
 for name,pin in PINS.items():
  p=ROOT/"release-caller-pins"/pathlib.Path(name).name
  if not inside(p) or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=pin:raise RuntimeError("SOURCE_PIN_MISMATCH:"+name)
 run=ROOT/("state-writer-cas-"+args.tag)
 if not inside(run) or run.exists():raise RuntimeError("RUN_PATH_INVALID")
 run.mkdir()
 (run/"pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 (run/"worker.cjs").write_text(NODE,encoding="utf8",newline="\n")
 env=os.environ.copy()
 for k in ("TEMP","TMP","TMPDIR"):env[k]=str(run)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 # Obtain route, hold and gross from the pinned policy using a read-only Node extraction.
 node_extract='const fs=require("fs"),vm=require("vm"),m=require("module");const src=fs.readFileSync(process.argv[1],"utf8").replace(/^export\\s+/gm,"");const c={};vm.createContext(c);vm.runInContext(m.stripTypeScriptTypes(src,{mode:"transform"})+";globalThis.rule=IDLE_PRIORITY_SHORT_POLICY.routes.RENDERUSDT",c);console.log(JSON.stringify(c.rule))'
 p=ROOT/"release-caller-pins"/"idlePriorityShortPolicy.ts"
 result=subprocess.run(["node","-e",node_extract,str(p)],cwd=run,env=env,capture_output=True,text=True,timeout=20)
 if result.returncode:raise RuntimeError("POLICY_EXTRACT:"+result.stderr[-2000:])
 rule=json.loads(result.stdout.strip())
 results=[]
 for kind in KINDS:
  for order in ("AB","BA"):
   name=kind+"_"+order
   d=run/name;d.mkdir()
   s=initial(kind)
   if s["pending"]:
    s["pending"]["route"]=rule["route"];s["pending"]["holdHours"]=rule["holdHours"];s["pending"]["gross"]=rule["gross"]
   (d/"state.json").write_text(json.dumps(s,sort_keys=True),encoding="utf8")
   procs={}
   try:
    for role in ("A","B"):
     procs[role]=subprocess.Popen(["node",str(run/"worker.cjs"),str(ROOT),str(d),role,kind],cwd=d,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    wait(d/"ready-A");wait(d/"ready-B")
    snapshots=[]
    for role in order:
     (d/("go-"+role)).write_text("GO",encoding="ascii")
     wait(d/("done-"+role))
     snap=json.loads((d/"state.json").read_text(encoding="utf8"))
     snapshots.append({"pending":snap["pending"] is not None,"cooldown":bool(snap["lastAcceptedBySymbol"]),"manualReview":snap["manualReview"] is not None,"decision":snap.get("lastDecision",{}).get("reason")=="AUDIT_B"})
    for role in ("A","B"):
     out,err=procs[role].communicate(timeout=15)
     if procs[role].returncode:raise RuntimeError("WORKER_FAIL:"+name+":"+role+":"+err[-1500:])
    final=snapshots[-1]
    if order=="AB":
     expected={"pending_entry":(False,False,False,True),"pending_release":(True,False,False,True),"cooldown_entry":(False,False,False,True),"cooldown_release":(False,True,False,True),"manual_review":(False,False,False,True),"manual_review_release":(False,False,True,True)}[kind]
    else:
     expected={"pending_entry":(True,False,False,False),"pending_release":(False,False,False,False),"cooldown_entry":(False,True,False,False),"cooldown_release":(False,False,False,False),"manual_review":(False,False,True,False),"manual_review_release":(False,False,False,False)}[kind]
    actual=tuple(final[k] for k in ("pending","cooldown","manualReview","decision"))
    if actual!=expected:raise RuntimeError("CASE_MISMATCH:"+name+":"+str(actual)+":"+str(expected))
    results.append({"kind":kind,"order":order,"pass":True,"afterFirst":snapshots[0],"afterSecond":final})
   finally:
    for proc in procs.values():
     if proc.poll() is None:proc.kill();proc.communicate()
 data={"sourceSha256":PINS,"caseCount":len(results),"results":results}
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(results),"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":results},sort_keys=True))
if __name__=="__main__":main()
