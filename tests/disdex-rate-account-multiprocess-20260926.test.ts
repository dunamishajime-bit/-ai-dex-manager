import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, open, unlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { reserveAsterGlobalRateSlot } from "../lib/disdex-aster-global-rate-budget";
import { FileAccountOrderLock, activeReservedGross } from "../lib/disdex-account-order-lock";

const sleep=(n:number)=>new Promise<void>(done=>setTimeout(done,n));
const WORKER=resolve("tests/disdex-rate-account-multiprocess-20260926.test.ts");
async function childRun() {
  const role=process.argv[3], path=process.argv[4], count=Number(process.argv[5]), id=process.argv[6];
  if(role==="rate"){
    const permits:number[]=[];
    for(let i=0;i<count;i++){
      const x=await reserveAsterGlobalRateSlot({path,minIntervalMs:4,maxQueueMs:15_000,weight:1});
      permits.push(x.permitAt);
      if(i%7===0)await sleep(i%2);
    }
    console.log(JSON.stringify({role,id,count:permits.length,permits}));
  }else if(role==="account"){
    const lock=new FileAccountOrderLock(path,30_000);
    let attempts=0,done=0;
    while(done<count){
      if(attempts++>10_000)throw Error("ACCOUNT_LOCK_STARVATION");
      const handle=await lock.acquire(id+"-"+done);
      if(!handle){await sleep((done+Number(id))%4+1);continue;}
      const semaphore=path+".in-use";
      let sentinel;
      try{
        sentinel=await open(semaphore,"wx",0o600);
        await sentinel.writeFile(id+"/"+done);
        const reservation=await handle.reserve({strategyId:"READ_ONLY_FIXTURE",symbol:"ETHUSDT",side:"LONG",gross:0.5,notionalUsd:50});
        assert.equal(reservation.status,"RESERVED");
        assert.equal(activeReservedGross(await handle.document()),0.5);
        await handle.releaseReservation(reservation.reservationId);
        assert.equal(activeReservedGross(await handle.document()),0);
        if(done%3===0)await sleep(3);
        done++;
      }finally{
        if(sentinel){await sentinel.close();await unlink(semaphore).catch(()=>{});}
        await handle.release();
      }
    }
    console.log(JSON.stringify({role,id,count:done,attempts}));
  }else throw Error("UNEXPECTED_WORKER_ROLE");
}
type ProcResult={rc:number,stdout:string,stderr:string};
function spawnWorker(args:string[],env:NodeJS.ProcessEnv=process.env):Promise<ProcResult>{
 return new Promise((done,fail)=>{
   const p=spawn(process.execPath,["--import","tsx",WORKER,"--child",...args],{cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"]});
   let stdout="",stderr="";
   p.stdout.on("data",b=>stdout+=b.toString());p.stderr.on("data",b=>stderr+=b.toString());
   p.on("error",fail);p.on("exit",(code,signal)=>done({rc:code??-1,stdout,stderr:stderr.slice(-900)}));
 });
}
if(process.argv[2]==="--child"){
 childRun().catch(e=>{console.error(e);process.exitCode=1});
}else{
 test("Node+Python share rate slots across 6 independent processes without lock races or malformed state", {timeout:120_000},async()=>{
   const tmp=await mkdtemp(join(tmpdir(),"disdex-rate-multiprocess-"));
   const path=join(tmp,"aster-rate-budget.json");
   try{
     const n=25;
     const js=Array.from({length:4},(_,i)=>spawnWorker(["rate",path,String(n),String(i)]));
     const pythonCode='import sys,os,json;sys.path.insert(0,os.path.abspath("scripts"));import disdex_v13d_v11eq_stock_live_engine as b;[b.wait_for_aster_global_rate_budget(1) for _ in range(25)];print(json.dumps({"role":"python","count":25}))';
     const py=Array.from({length:2},()=>new Promise<ProcResult>((done,fail)=>{
       const p=spawn("python3",["-c",pythonCode],{cwd:process.cwd(),env:{...process.env,DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH:path,DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS:"4",DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS:"15000"},stdio:["ignore","pipe","pipe"]});
       let stdout="",stderr="";p.stdout.on("data",b=>stdout+=b.toString());p.stderr.on("data",b=>stderr+=b.toString());p.on("error",fail);p.on("exit",code=>done({rc:code??-1,stdout,stderr:stderr.slice(-900)}));
     }));
     const results=await Promise.all([...js,...py]);
     for(const [i,v]of results.entries())assert.equal(v.rc,0,"worker "+i+" failed: "+v.stderr);
     const nodes=results.slice(0,4).map(x=>JSON.parse(x.stdout.trim().split("\n").at(-1)!));
     const permits=nodes.flatMap(x=>x.permits as number[]);
     assert.equal(permits.length,n*4);
     assert.equal(new Set(permits).size,permits.length,"duplicate JS permit under Node+Python competition");
     const state=JSON.parse(await readFile(path,"utf8"));
     assert.equal(state.schema,"disdex-aster-rate-budget/v1");
     assert.ok(Number.isFinite(state.nextAllowedAt));
     assert.ok(state.nextAllowedAt>Math.max(...permits));
     await assert.rejects(stat(path+".lock"),{code:"ENOENT"});
     await assert.rejects(stat(path+".lock.recovery"),{code:"ENOENT"});
     for(const x of results.slice(4))assert.equal(JSON.parse(x.stdout.trim().split("\n").at(-1)!).count,n);
     console.log("CROSS_LANGUAGE_RATE_STRESS_PASS="+JSON.stringify({workers:6,nodeSlots:100,pythonSlots:50,uniqueNodePermits:true,finalBudgetValid:true,orphanedLocks:0,realVenueCalls:0}));
   }finally{await rm(tmp,{recursive:true,force:true})}
 });
 test("five independent order-lock processes serialize 125 hold+reserve+release cycles", {timeout:120_000},async()=>{
  const tmp=await mkdtemp(join(tmpdir(),"disdex-account-multiprocess-"));
  try{
   const path=join(tmp,"account-order.lock");
   const runs=await Promise.all(Array.from({length:5},(_,i)=>spawnWorker(["account",path,"25",String(i)])));
   for(const [i,v]of runs.entries())assert.equal(v.rc,0,"account worker "+i+" failed: "+v.stderr);
   assert.equal(runs.map(v=>JSON.parse(v.stdout.trim().split("\n").at(-1)!).count).reduce((a,b)=>a+b,0),125);
   await assert.rejects(stat(path),{code:"ENOENT"});
   await assert.rejects(stat(path+".in-use"),{code:"ENOENT"});
   console.log("MULTIPROCESS_ACCOUNT_LOCK_STRESS_PASS="+JSON.stringify({workers:5,reservationCycles:125,simultaneousOwnersDetected:0,orphanedLocks:0,realOrders:0}));
  }finally{await rm(tmp,{recursive:true,force:true})}
 });
}
