import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {executeV4WithContentionAudit,inspectV4LockHolder} from "../lib/v12-v4-lock-contention-observer";

test("short live-peer contention retries, records the real owner, and succeeds without bypassing lease",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-lock-audit-"));
 try{
  const path=join(dir,"account.lock"),auditPath=join(dir,"events.jsonl");
  const start=1_700_000_000_000;
  writeFileSync(path,JSON.stringify({schema:"disdex-account-lock/v1",
   accountScope:"ASTER_FUTURES",ownerId:"PENGU_DUAL_LS_V2",leaseId:"test-lease",
   acquiredAt:start-200,expiresAt:start+10000,reservations:[]}));
  let calls=0,clock=start;
  const result=await executeV4WithContentionAudit({
   operation:async()=>({status:++calls===3?"observing":"locked"}),
   accountLockPath:path,auditPath,releaseSha:"a".repeat(40),operationMode:"CANARY",
   attempts:5,retryMs:250,now:()=>clock,wait:async(ms)=>{clock+=ms;},
   emit:()=>{},
  });
  assert.equal(result.status,"observing");
  assert.equal(calls,3);
  const rows=readFileSync(auditPath,"utf8").trim().split("\n").map(x=>JSON.parse(x));
  assert.equal(rows.length,1);
  assert.equal(rows[0].busyAttempts,2);
  assert.equal(rows[0].resolved,true);
  assert.equal(rows[0].observations[0].ownerId,"PENGU_DUAL_LS_V2");
  assert.equal(rows[0].observations[0].state,"HELD");
  assert.equal(rows[0].elapsedMs,500);
  assert.equal(rows[0].orderMutationByObserver,0);
  assert.ok(!readFileSync(auditPath,"utf8").includes("test-lease"));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("persistent lock remains fail-closed and records the actual peer and retry exhaustion",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-lock-audit-"));
 try{
  const path=join(dir,"account.lock"),out=join(dir,"events.jsonl"),clock=1_700_000_000_000;
  writeFileSync(path,JSON.stringify({schema:"disdex-account-lock/v1",ownerId:"Q102_RUNNER",
   leaseId:"test-lease",acquiredAt:clock-500,expiresAt:clock+10000,reservations:[]}));
  let calls=0;
  const result=await executeV4WithContentionAudit({
   operation:async()=>{calls++;return {status:"locked"};},
   accountLockPath:path,auditPath:out,releaseSha:"a".repeat(40),operationMode:"CANARY",
   attempts:3,retryMs:300,now:()=>clock,wait:async()=>{},emit:()=>{},
  });
  assert.equal(result.status,"locked");assert.equal(calls,3);
  const event=JSON.parse(readFileSync(out,"utf8").trim());
  assert.equal(event.busyAttempts,3);assert.equal(event.resolved,false);
  assert.equal(event.outcome,"locked");
  assert.ok(event.observations.every((x:any)=>x.ownerId==="Q102_RUNNER"));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("missing or malformed lock files never generate invented holder identities",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-lock-audit-"));
 try{
  const path=join(dir,"account.lock");
  assert.deepEqual((await inspectV4LockHolder(path)).state,"RELEASED_BEFORE_READ");
  writeFileSync(path,"broken");
  const result=await inspectV4LockHolder(path);
  assert.equal(result.state,"UNREADABLE");
  assert.equal(result.ownerId,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
