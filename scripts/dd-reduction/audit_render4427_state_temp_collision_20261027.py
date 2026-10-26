#!/usr/bin/env python3
"""RENDER #4427 research-only real Windows FS same-PID same-millisecond temp-name collision audit."""
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
const SHA="a".repeat(40),results=[];
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function runCase(name,kind,firstLabel="A"){
 const dir=path.join(run,name),file=path.join(dir,"state.json");
 fs.mkdirSync(dir,{recursive:true});
 const frozen=1793030000000;let clock=frozen;
 class TestDate extends Date{static now(){return kind==="unique"?++clock:frozen;}}
 const firstWritten=deferred(),secondWritten=deferred(),firstRenamed=deferred(),firstStarted=deferred();
 let writes=0,renames=0,uniqueRenameTail=Promise.resolve();
 const wrap={
  lstat:fsp.lstat,mkdir:fsp.mkdir,readFile:fsp.readFile,unlink:fsp.unlink,dirname:path.dirname,
  writeFile:async(...args)=>{
   if(kind!=="collision")return fsp.writeFile(...args);
   const n=++writes;
   if(n===1){firstStarted.resolve();await fsp.writeFile(...args);firstWritten.resolve();await secondWritten.promise;}
   else if(n===2){await firstWritten.promise;await fsp.writeFile(...args);secondWritten.resolve();await firstRenamed.promise;}
   else throw Error("UNEXPECTED_WRITE_COUNT");
  },
  rename:async(...args)=>{
   if(kind==="unique"){const prior=uniqueRenameTail;let done;uniqueRenameTail=new Promise(r=>done=r);await prior;try{return await fsp.rename(...args);}finally{done();}}
   if(kind!=="collision")return fsp.rename(...args);
   const n=++renames;
   if(n===1){await fsp.rename(...args);firstRenamed.resolve();}
   else return fsp.rename(...args);
  },
  chmod:fsp.chmod,Date:TestDate,Buffer,Number,Promise,Error,Set,Map,process,console
 };
 const mod=compile(sources["lib/idle-priority-short-state.ts"],{...wrap,IDLE_PRIORITY_SHORT_POLICY:cfg.IDLE_PRIORITY_SHORT_POLICY},"FileIdlePriorityShortStateStore,emptyIdleState");
 const store=new mod.FileIdlePriorityShortStateStore(file,SHA);
 const make=label=>{const s=mod.emptyIdleState(SHA,frozen);s.manualReview="WRITER_"+label;s.lastAcceptedBySymbol.RENDERUSDT=label==="A"?1111111111:2222222222;return s;};
 fs.writeFileSync(file,JSON.stringify(make("BASE"))+"\n");
 let settled;
 if(kind==="serial"||kind==="unique"){
  const one=await store.save(make("A")).then(()=>({status:"fulfilled"}),e=>({status:"rejected",code:e.code}));
  const two=await store.save(make("B")).then(()=>({status:"fulfilled"}),e=>({status:"rejected",code:e.code}));
  settled=[one,two];
 }else{
  const labels=firstLabel==="A"?["A","B"]:["B","A"];
  if(kind==="collision"){const firstPromise=store.save(make(labels[0]));await firstStarted.promise;const secondPromise=store.save(make(labels[1]));settled=await Promise.allSettled([firstPromise,secondPromise]);}else settled=await Promise.allSettled(labels.map(label=>store.save(make(label))));
 }
 const status=settled.map(s=>s.status);
 const errors=settled.map(s=>s.status==="rejected"?String(s.reason?.code||s.reason?.message||"ERROR"):"");
 const after=JSON.parse(fs.readFileSync(file,"utf8"));
 const actual=after.manualReview.replace("WRITER_","");
 const tmp=fs.readdirSync(dir).filter(x=>x.endsWith(".tmp"));
 if(kind==="collision"){
  const second=firstLabel==="A"?"B":"A";
  if(status.join(",")!=="fulfilled,rejected"||errors[1]!=="ENOENT"||actual!==second||after.lastAcceptedBySymbol.RENDERUSDT!==(second==="A"?1111111111:2222222222)||tmp.length)throw Error("COLLISION_MISMATCH:"+JSON.stringify({name,status,errors,actual,tmp}));
 }else if(kind==="serial"||kind==="unique"){
  if(status.join(",")!=="fulfilled,fulfilled"||actual!=="B"||tmp.length)throw Error("SERIAL_MISMATCH:"+name);
 }else{
  if(status.join(",")!=="fulfilled,fulfilled"||!["A","B"].includes(actual)||tmp.length)throw Error("UNIQUE_MISMATCH:"+name+":"+JSON.stringify({status,errors,actual,tmp}));
 }
 results.push({name,kind,first:firstLabel,status,errors,finalWriter:actual,cleanTmp:tmp.length===0});
}
async function main(){
 for(const [name,kind,first] of [
  ["collision_A_first_1","collision","A"],["collision_B_first_1","collision","B"],
  ["collision_A_first_2","collision","A"],["collision_B_first_2","collision","B"],
  ["serial_same_millisecond","serial","A"],["serial_unique_milliseconds","unique","A"]
 ])await runCase(name,kind,first);
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
 run=ROOT/("state-temp-collision-"+args.tag)
 if run.exists():raise RuntimeError("RUN_EXISTS")
 run.mkdir()
 (run/"pins.json").write_text(json.dumps(PINS,sort_keys=True),encoding="utf8")
 (run/"worker.cjs").write_text(NODE,encoding="utf8",newline="\n")
 env=os.environ.copy()
 for k in ("TEMP","TMP","TMPDIR"):env[k]=str(run)
 env["PYTHONDONTWRITEBYTECODE"]="1"
 p=subprocess.run(["node",str(run/"worker.cjs"),str(ROOT),str(run)],cwd=run,env=env,capture_output=True,text=True,timeout=60)
 if p.returncode:raise RuntimeError("NODE_FAILED:"+p.stderr[-5000:])
 data=json.loads(p.stdout)
 if len(data["results"])!=6:raise RuntimeError("WRONG_CASE_COUNT")
 canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
 print(json.dumps({"optimize":sys.flags.optimize,"caseCount":len(data["results"]),"canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),"results":data["results"]},sort_keys=True))
if __name__=="__main__":main()
