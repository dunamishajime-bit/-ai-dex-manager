#!/usr/bin/env python3
"""Research-only original-TypeScript exclusive-open/write failure audit. No PC file writes."""
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

REPO = "dunamishajime-bit/-ai-dex-manager"
SOURCE_COMMIT = "939b59da49ce7960485a2004b0068dc63417ae82"
SOURCE_PATH = "lib/disdex-account-order-lock.ts"
SOURCE_SHA256 = "169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b"
SOURCE_URL = "https://raw.githubusercontent.com/" + REPO + "/" + SOURCE_COMMIT + "/" + SOURCE_PATH
OWNER = "IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH"
ROUTE = "IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT"
NODE = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const {stripTypeScriptTypes} = require('node:module');
const ts = fs.readFileSync(0,'utf8');
const start = ts.indexOf('export const ACCOUNT_LOCK_SCHEMA');
const classStart = ts.indexOf('export class FileAccountOrderLock');
const end = ts.indexOf('export function activeReservedGross');
if (start < 0 || classStart < 0 || end < 0) throw Error('SOURCE_BOUNDARY_NOT_FOUND');
const extracted = (ts.slice(start,classStart) + ts.slice(classStart,end))
 .replace(/\bexport\s+(?=(const|interface|type|function|class)\b)/g,'')
 .replace('private readonly leaseMs = 120_000,','leaseMs = 120_000,')
 .replace('this.path = resolve(path);','this.leaseMs = leaseMs; this.path = resolve(path);');
const js = stripTypeScriptTypes(extracted);
const lockPath = path.resolve('C:/Users/dis/render4427-research-only/virtual-account.lock');
const pendingPath = path.resolve('C:/Users/dis/render4427-research-only/virtual-pending.json');
function err(code){const e = new Error(code);e.code=code;return e;}
function world(mode='success'){
  const files=new Map(); let uuid=0;let disappearOnRead=false;
  const api={
    createHash:crypto.createHash,randomUUID:()=>('lease-'+(++uuid)),
    mkdir:async()=>{},dirname:path.dirname,resolve:path.resolve,
    pendingExposurePath:(p)=>p,
    open:async(p,flags)=>{
      if(mode==='permission') throw err('EACCES');
      if(flags!=='wx') throw Error('EXCLUSIVE_OPEN_REQUIRED');
      if(files.has(p)) throw err('EEXIST');
      files.set(p,'');
      return {writeFile:async(text)=>{
        if(mode==='empty_eio') throw err('EIO');
        if(mode==='partial_eio'){files.set(p,'{"schema":');throw err('EIO');}
        files.set(p,text);
      },close:async()=>{}};
    },
    readFile:async(p)=>{
      if(disappearOnRead){disappearOnRead=false;files.delete(p);throw err('ENOENT');}
      if(!files.has(p))throw err('ENOENT');
      return files.get(p);
    },
    writeFile:async(p,text)=>{files.set(p,text);},
    rename:async(a,b)=>{if(!files.has(a))throw err('ENOENT');files.set(b,files.get(a));files.delete(a);},
    unlink:async(p)=>{if(!files.has(p))throw err('ENOENT');files.delete(p);},
    upsertPendingExposure:async()=>{},releasePendingExposure:async()=>{},
    process:{pid:1234,env:{}},
  };
  const ctx=vm.createContext(api);
  vm.runInContext(js+'\n;globalThis.LockClass=FileAccountOrderLock;',ctx,{timeout:2000});
  return {files,lockPath,pendingPath,LockClass:ctx.LockClass,setDisappear:()=>{disappearOnRead=true;},setMode:(m)=>{mode=m;}};
}
async function outcome(p){try{return {value:await p,error:null};}catch(e){return {value:null,error:e.code||e.message};}}
function check(ok,name){if(!ok)throw Error('FAILED_CASE:'+name);}
async function main(){
 const results=[];
 {
  const w=world();const h=await w.LockClass.prototype.acquire.call(new w.LockClass(w.lockPath,120000,w.pendingPath),'OWNER:1');
  const row=JSON.parse(w.files.get(w.lockPath));
  check(Boolean(h)&&row.ownerId==='OWNER:1'&&row.reservations.length===0,'normal');
  results.push(['normal_exclusive_open',true]);
 }
 for(const [mode,label,content] of [['empty_eio','write_failure_empty',''],['partial_eio','write_failure_partial','{"schema":']]){
  const w=world(mode);const lock=new w.LockClass(w.lockPath,120000,w.pendingPath);
  const a=await outcome(lock.acquire('OWNER:1'));
  const b=await outcome(lock.acquire('OWNER:2'));
  check(a.error==='EIO'&&b.error===null&&b.value===null&&w.files.get(w.lockPath)===content,label);
  results.push([label,'STRANDED_LOCK']);
 }
 {
  const w=world('permission');const a=await outcome(new w.LockClass(w.lockPath).acquire('OWNER:1'));
  check(a.error==='EACCES'&&!w.files.has(w.lockPath),'permission');
  results.push(['permission_failure_no_lock','EACCES']);
 }
 {
  const w=world();const lock=new w.LockClass(w.lockPath);const a=await lock.acquire('OWNER:1');
  const before=w.files.get(w.lockPath);const b=await lock.acquire('OWNER:2');
  check(Boolean(a)&&b===null&&w.files.get(w.lockPath)===before,'valid_conflict');
  results.push(['valid_lock_conflict','REFUSED']);
 }
 {
  const w=world();w.files.set(w.lockPath,'{');const b=await new w.LockClass(w.lockPath).acquire('OWNER:2');
  check(b===null&&w.files.get(w.lockPath)==='{','malformed_conflict');
  results.push(['malformed_lock_conflict','REFUSED']);
 }
 {
  const w=world();w.files.set(w.lockPath,'{');w.setDisappear();
  const b=await new w.LockClass(w.lockPath).acquire('OWNER:2');
  check(Boolean(b)&&JSON.parse(w.files.get(w.lockPath)).ownerId==='OWNER:2','disappeared_retry');
  results.push(['disappeared_path_retry','ACQUIRED']);
 }
 {
  const w=world('empty_eio');const lock=new w.LockClass(w.lockPath);
  const a=await outcome(lock.acquire('OWNER:1'));w.files.delete(w.lockPath);w.setMode('success');
  const b=await lock.acquire('OWNER:2');
  check(a.error==='EIO'&&Boolean(b),'explicit_reconciliation_control');
  results.push(['explicit_reconciliation_control','ACQUIRED']);
 }
 process.stdout.write(JSON.stringify({source_sha256:process.env.RENDER4427_SOURCE_SHA,owner:process.env.RENDER4427_OWNER,route:process.env.RENDER4427_ROUTE,cases:results}));
}
main().catch(e=>{process.stderr.write(String(e.stack||e));process.exitCode=1;});
"""

def one_worker():
    data = urllib.request.urlopen(SOURCE_URL, timeout=20).read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SOURCE_SHA256:
        raise RuntimeError("PRIMARY_SOURCE_BYTES_SHA_MISMATCH")
    env = dict(os.environ)
    env.update({"NODE_NO_WARNINGS":"1", "PYTHONDONTWRITEBYTECODE":"1",
                "RENDER4427_SOURCE_SHA":digest, "RENDER4427_OWNER":OWNER,
                "RENDER4427_ROUTE":ROUTE})
    result = subprocess.run(["node","-e",NODE], input=data, capture_output=True, env=env, timeout=30)
    if result.returncode:
        raise RuntimeError("NODE_EXEC_FAILURE: " + result.stderr.decode("utf-8","replace")[:1600])
    value = json.loads(result.stdout)
    if len(value["cases"]) != 8:
        raise RuntimeError("CASE_COUNT_MISMATCH")
    return value

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",",":")).encode("utf-8")

def launch():
    # Two independent Python processes for each optimization mode, no local file writes.
    bootstrap = ("import sys,urllib.request;u=" + repr(
        "https://raw.githubusercontent.com/" + REPO + "/"
        + os.environ["RENDER4427_AUDIT_REF"] + "/scripts/dd-reduction/audit_render4427_acquire_open_write_failure_20261026.py")
        + ";b=urllib.request.urlopen(u,timeout=20).read();"
        + "sys.argv=['audit','--worker'];exec(compile(b,'<verified-research-script>','exec'))")
    rows=[]
    for opt in ("","-O","-OO"):
        for independent in (1,2):
            args=[sys.executable,"-B"]+([opt] if opt else [])+["-c",bootstrap]
            child=subprocess.run(args,capture_output=True,env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"},timeout=65)
            if child.returncode:
                raise RuntimeError("WORKER_FAILURE "+str((opt,independent))+" "+child.stderr.decode("utf-8","replace")[:1200])
            rows.append(json.loads(child.stdout))
    first=canonical(rows[0])
    if any(canonical(row)!=first for row in rows):
        raise RuntimeError("INDEPENDENT_PROCESS_RESULT_MISMATCH")
    payload={"status":"RESEARCH_ONLY_NO_ORDERS","source_sha256":SOURCE_SHA256,
             "cases_per_worker":len(rows[0]["cases"]),"independent_processes":len(rows),
             "checks":len(rows)*len(rows[0]["cases"]),
             "canonical_sha256":hashlib.sha256(first).hexdigest(),"results":rows[0]["cases"],
             "decision":"NEED_NATIVE_ALLOCATOR","order_authorized":False}
    print(json.dumps(payload,ensure_ascii=False,sort_keys=True))

if __name__=="__main__":
    if "--worker" in sys.argv:
        print(json.dumps(one_worker(),ensure_ascii=False,sort_keys=True))
    else:
        launch()
