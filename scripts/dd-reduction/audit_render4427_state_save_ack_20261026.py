#!/usr/bin/env python3
"""Research-only pinned original-TS state save post-commit error audit. No venue calls."""
import argparse,hashlib,json,os,pathlib,subprocess,sys
ROOT=pathlib.Path(r"C:\Users\dis\render4427-research-only").resolve()
PINS={
 "lib/idle-priority-short-state.ts":"4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07",
 "config/idlePriorityShortPolicy.ts":"6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8"
}
NODE=r'''
"use strict";
const fs=require("node:fs"),fsp=require("node:fs/promises"),path=require("node:path"),crypto=require("node:crypto"),vm=require("node:vm");
const {stripTypeScriptTypes}=require("node:module");
const [root,run]=process.argv.slice(2);
const pins=JSON.parse(fs.readFileSync(path.join(run,"pins.json"),"utf8"));
const sources={};
for(const [name,pin] of Object.entries(pins)){
 const raw=fs.readFileSync(path.join(root,"release-caller-pins",path.basename(name)));
 if(crypto.createHash("sha256").update(raw).digest("hex")!==pin)throw Error("SOURCE_PIN_MISMATCH:"+name);
 sources[name]=raw.toString("utf8");
}
function compile(source,context,exports){
 const clean=source.replace(/^import .*;\r?\n/gm,"").replace(/^export\s+/gm,"");
 vm.createContext(context);
 vm.runInContext(stripTypeScriptTypes(clean,{mode:"transform"})+"\nglobalThis.__auditExports={"+exports+"};",context,{timeout:5000});
 return context.__auditExports;
}
const cfg=compile(sources["config/idlePriorityShortPolicy.ts"],{},"IDLE_PRIORITY_SHORT_POLICY");
const phases=["write_fail","rename_fail","chmod_fail","success"];
const variants=["manual_review","cooldown"];
const results=[];
const SHA="a".repeat(40);
async function main(){
 for(const variant of variants)for(const phase of phases){
  const name=variant+"__"+phase,dir=path.join(run,name),file=path.join(dir,"state.json");
  fs.mkdirSync(dir,{recursive:true});
  let eventLog=[];
  const wrap={
   lstat:fsp.lstat,mkdir:fsp.mkdir,readFile:fsp.readFile,unlink:fsp.unlink,dirname:path.dirname,
   writeFile:async (...args)=>{eventLog.push("write");if(phase==="write_fail")throw Object.assign(Error("INJECT_WRITE_EIO"),{code:"EIO"});return fsp.writeFile(...args);},
   rename:async (...args)=>{eventLog.push("rename");if(phase==="rename_fail")throw Object.assign(Error("INJECT_RENAME_EACCES"),{code:"EACCES"});return fsp.rename(...args);},
   chmod:async (...args)=>{eventLog.push("chmod");if(phase==="chmod_fail")throw Object.assign(Error("INJECT_CHMOD_EACCES"),{code:"EACCES"});return fsp.chmod(...args);},
   Date,Buffer,Number,Promise,Error,Set,Map,process,console
  };
  const state=compile(sources["lib/idle-priority-short-state.ts"],{...wrap,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY},"FileIdlePriorityShortStateStore,emptyIdleState");
  const store=new state.FileIdlePriorityShortStateStore(file,SHA);
  const initial=state.emptyIdleState(SHA,1793010000000);
  initial.manualReview="ORIGINAL";
  fs.writeFileSync(file,JSON.stringify(initial)+"\n","utf8");
  const target=state.emptyIdleState(SHA,1793010000000);
  target.manualReview=variant==="manual_review"?"NEW":"ORIGINAL";
  if(variant==="cooldown")target.lastAcceptedBySymbol.RENDERUSDT=1793010000001;
  let error=null;
  try{await store.save(target);}catch(e){error=String(e.message||e);}
  const after=JSON.parse(fs.readFileSync(file,"utf8"));
  const committed=variant==="manual_review"?after.manualReview==="NEW":Boolean(after.lastAcceptedBySymbol.RENDERUSDT);
  const expectedCommitted=phase==="chmod_fail"||phase==="success";
  const expectedError=phase!=="success";
  const expectedEvents=phase==="write_fail"?"write":phase==="rename_fail"?"write,rename":"write,rename,chmod";
  const tmp=fs.readdirSync(dir).filter(x=>x.endsWith(".tmp"));
  if(committed!==expectedCommitted||Boolean(error)!==expectedError||eventLog.join(",")!==expectedEvents||tmp.length!==0)throw Error("CASE_MISMATCH:"+name+":"+JSON.stringify({committed,error,eventLog,tmp}));
  results.push({name,committed,reportedError:!!error,events:eventLog.join(","),tmpClean:tmp.length===0});
 }
 console.log(JSON.stringify({sourceSha256:pins,results}));
}
main().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
'''
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--tag",required=True);args=ap.parse_args()
 if not args.tag.isalnum() or len(args.tag)>32:raise RuntimeError("INVALID_TAG")
 for name,pin in PINS.items():
  p=ROOT/"release-caller-pins"/pathlib.Path(name).name
  if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=pin:raise RuntimeError("SOURCE_PIN_MISMATCH:"+name)
 run=ROOT/("state-save-ack-"+args.tag)
 if run.exists():raise RuntimeError("RUN_EXISTS")
 run.mkdir()
 (run/"pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 (run/"worker.cjs").write_text(NODE,encoding="utf8",newline="\n")
 env=os.environ.copy()
 for k in ("TEMP","TMP","TMPDIR"):env[k]=str(run)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 p=subprocess.run(["node",str(run/"worker.cjs"),str(ROOT),str(run)],cwd=run,env=env,capture_output=True,text=True,timeout=45)
 if p.returncode:raise RuntimeError("NODE_FAILED:"+p.stderr[-4000:])
 data=json.loads(p.stdout)
 if len(data["results"])!=8:raise RuntimeError("WRONG_CASE_COUNT")
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(data["results"]),"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":data["results"]},sort_keys=True))
if __name__=="__main__":main()
