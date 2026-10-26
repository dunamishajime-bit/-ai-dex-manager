#!/usr/bin/env python3
"""Research-only real Windows filesystem lease-identity race audit.
Strict source pin, original TypeScript class executed via Node transform+VM,
actual Windows filesystem path operations, replacement from separate Node process.
All writable paths must be within explicitly authorized research root.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

PIN = "169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b"
AUTHORIZED_ROOT = Path("C:/Users/dis/render4427-research-only").resolve()
NODE = "\n\"use strict\";\nconst fs = require(\"node:fs\");\nconst fsp = require(\"node:fs/promises\");\nconst path = require(\"node:path\");\nconst vm = require(\"node:vm\");\nconst crypto = require(\"node:crypto\");\nconst {spawnSync} = require(\"node:child_process\");\nconst {stripTypeScriptTypes} = require(\"node:module\");\nconst [sourcePath, runDir] = process.argv.slice(2);\nconst source = fs.readFileSync(sourcePath);\nconst expected = \"169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b\";\nconst actual = crypto.createHash(\"sha256\").update(source).digest(\"hex\");\nif (actual !== expected) throw new Error(\"PRIMARY_BYTES_PIN_MISMATCH:\" + actual);\nconst raw = source.toString(\"utf8\").replace(/^import .*;\\r?\\n/gm, \"\").replace(/^export\\s+/gm, \"\");\nconst transformed = stripTypeScriptTypes(raw, {mode:\"transform\"});\nlet race = null;\nconst replaceScript = \"const fs=require('node:fs');const p=process.argv[1];const doc=JSON.parse(process.argv[2]);const tmp=p+'.other-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(doc));fs.renameSync(tmp,p);\";\nfunction replaceInSeparateProcess(target, replacement) {\n  const cp = spawnSync(process.execPath, [\"-e\", replaceScript, target, JSON.stringify(replacement)], {cwd:runDir,encoding:\"utf8\",timeout:15000});\n  if (cp.status !== 0) throw new Error(\"SECOND_OWNER_PROCESS_FAILED:\" + cp.status + \":\" + cp.stderr);\n}\nasync function hookedReadFile(p, ...args) {\n  const data = await fsp.readFile(p,...args);\n  if (race && path.resolve(p) === race.target) {\n    const r = race;\n    race = null;\n    replaceInSeparateProcess(r.target,r.replacement);\n  }\n  return data;\n}\nconst sandbox = {\n  createHash:crypto.createHash, randomUUID:crypto.randomUUID,\n  mkdir:fsp.mkdir, open:fsp.open, readFile:hookedReadFile,\n  rename:fsp.rename, unlink:fsp.unlink, writeFile:fsp.writeFile,\n  dirname:path.dirname, resolve:path.resolve,\n  pendingExposurePath:(p)=>p, upsertPendingExposure:async()=>{}, releasePendingExposure:async()=>{},\n  process, console, Date, Buffer, Number, Promise, Error, Set\n};\nvm.createContext(sandbox);\nvm.runInContext(transformed + \"\\nglobalThis.AuditLock=FileAccountOrderLock;\",sandbox,{timeout:2000});\nconst Lock=sandbox.AuditLock;\nif(typeof Lock!==\"function\")throw new Error(\"NATIVE_CLASS_NOT_EXTRACTED\");\nconst entry={strategyId:\"IDLE_PRIORITY_SHORT\",symbol:\"RENDERUSDT\",side:\"SHORT\",gross:0.25,notionalUsd:2500};\nasync function runOne(action,phase,variant) {\n  const label=[action,phase,variant].join(\"_\");\n  const dir=path.join(runDir,label);\n  await fsp.mkdir(dir,{recursive:true});\n  const target=path.join(dir,\"account.lock\");\n  const handle=await new Lock(target,120000,path.join(dir,\"pending.json\")).acquire(\"OWNER_A:111\");\n  if(!handle)throw new Error(\"ACQUIRE_FAILED:\"+label);\n  let reservation=null;\n  if(action===\"releaseReservation\")reservation=await handle.reserve(entry);\n  const old=JSON.parse(await fsp.readFile(target,\"utf8\"));\n  const replacement={...old,ownerId:variant===\"sameOwner\"?\"OWNER_A:111\":\"OWNER_B:222\",leaseId:\"LEASE_B\",reservations:[]};\n  if(phase===\"before\")replaceInSeparateProcess(target,replacement);\n  if(phase===\"after\")race={target:path.resolve(target),replacement};\n  let error=null;\n  try {\n    if(action===\"release\")await handle.release();\n    else if(action===\"reserve\")await handle.reserve(entry);\n    else if(action===\"releaseReservation\")await handle.releaseReservation(reservation.reservationId);\n  }catch(e){error=String(e.message||e);}\n  if(race)throw new Error(\"READ_BARRIER_NOT_REACHED:\"+label);\n  let current=null;\n  try{current=JSON.parse(await fsp.readFile(target,\"utf8\"))}catch(e){if(e.code!==\"ENOENT\")throw e;}\n  const owner=current?.ownerId||null;\n  const lease=current?.leaseId||null;\n  const count=current?.reservations?.length||0;\n  const status=current?.reservations?.[0]?.status||null;\n  let ok=false;\n  if(action===\"release\"){\n    ok=phase===\"none\" ? current===null && error===null\n       :phase===\"before\" ? owner===replacement.ownerId && lease===\"LEASE_B\" && error===null\n       :current===null && error===null;\n  }else if(action===\"reserve\"){\n    ok=phase===\"none\" ? owner===\"OWNER_A:111\" && count===1 && status===\"RESERVED\" && error===null\n       :phase===\"before\" ? owner===replacement.ownerId && lease===\"LEASE_B\" && error===\"ACCOUNT_LOCK_NOT_OWNER\"\n       :owner===\"OWNER_A:111\" && lease===old.leaseId && count===1 && status===\"RESERVED\" && error===null;\n  }else{\n    ok=phase===\"none\" ? owner===\"OWNER_A:111\" && count===1 && status===\"RELEASED\" && error===null\n       :phase===\"before\" ? owner===replacement.ownerId && lease===\"LEASE_B\" && error===\"ACCOUNT_LOCK_NOT_OWNER\"\n       :owner===\"OWNER_A:111\" && lease===old.leaseId && count===1 && status===\"RELEASED\" && error===null;\n  }\n  if(!ok)throw new Error(\"CASE_FAILED:\"+label+\":\"+JSON.stringify({owner,lease,count,status,error}));\n  return {case:label,pass:true,realOsPath:true,secondOwnerProcess:phase!==\"none\",leaseIdentityPreserved:phase===\"before\",mutation:phase===\"after\"};\n}\n(async()=>{\n  const plan=[\n    [\"release\",\"none\",\"newOwner\"],[\"release\",\"before\",\"newOwner\"],[\"release\",\"after\",\"newOwner\"],[\"release\",\"after\",\"sameOwner\"],\n    [\"reserve\",\"none\",\"newOwner\"],[\"reserve\",\"before\",\"newOwner\"],[\"reserve\",\"after\",\"newOwner\"],[\"reserve\",\"after\",\"sameOwner\"],\n    [\"releaseReservation\",\"none\",\"newOwner\"],[\"releaseReservation\",\"before\",\"newOwner\"],[\"releaseReservation\",\"after\",\"newOwner\"],[\"releaseReservation\",\"after\",\"sameOwner\"]\n  ];\n  const results=[];\n  for(const [action,phase,variant] of plan)results.push(await runOne(action,phase,variant));\n  console.log(JSON.stringify({sourceSha256:actual,caseCount:results.length,cases:results}));\n})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});\n"

def inside(p, root):
    try:
        p.relative_to(root)
        return True
    except ValueError:
        return False

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--tag", required=True)
    args=ap.parse_args()
    root=AUTHORIZED_ROOT
    source=Path(args.source).resolve()
    if not inside(source,root):
        raise RuntimeError("SOURCE_OUTSIDE_AUTHORIZED_ROOT")
    if hashlib.sha256(source.read_bytes()).hexdigest()!=PIN:
        raise RuntimeError("PRIMARY_SOURCE_RAW_SHA256_MISMATCH")
    if not args.tag.isalnum() or len(args.tag)>40:
        raise RuntimeError("INVALID_TAG")
    run=root/("ntfs-lease-audit-"+args.tag)
    if not inside(run,root) or run.exists():
        raise RuntimeError("RUN_DIR_COLLISION_OR_ESCAPE")
    run.mkdir()
    harness=run/"harness.cjs"
    harness.write_text(NODE,encoding="utf-8",newline="\n")
    env=os.environ.copy()
    env["TEMP"]=str(run)
    env["TMP"]=str(run)
    env["TMPDIR"]=str(run)
    env["PYTHONDONTWRITEBYTECODE"]="1"
    p=subprocess.run(["node",str(harness),str(source),str(run)],cwd=run,env=env,capture_output=True,text=True,timeout=120)
    if p.returncode!=0:
        raise RuntimeError("NODE_AUDIT_FAILED:"+p.stderr[-4000:])
    data=json.loads(p.stdout.strip().splitlines()[-1])
    if data["sourceSha256"]!=PIN or data["caseCount"]!=12 or not all(x["pass"] for x in data["cases"]):
        raise RuntimeError("NODE_AUDIT_RESULT_INVALID")
    canonical=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False)
    print(json.dumps({"pythonOptimize":sys.flags.optimize,"caseCount":data["caseCount"],
      "canonicalSha256":hashlib.sha256(canonical.encode()).hexdigest(),
      "sourceSha256":PIN,"results":data["cases"]},sort_keys=True))

if __name__=="__main__":
    main()
