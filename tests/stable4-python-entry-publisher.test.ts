import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {publishStable4PythonNativeEntry} from "../scripts/stable4-publish-native-entry";
import {ACCOUNT_LOCK_SCHEMA} from "../lib/disdex-account-order-lock";

test("Python evidence bridge binds real shared lease and source, publishes only entry features, refuses changed ownership",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"stable4-python-publish-")),oldBook=process.env.DISDEX_STABLE4_ENTRY_OPPORTUNITY_BOOK_PATH,oldSha=process.env.DISDEX_RUNTIME_COMMIT_SHA;
 const now=Date.now(),sha="a".repeat(40),lockPath=join(dir,"account.lock"),bookPath=join(dir,"book.json");
 try{
  process.env.DISDEX_STABLE4_ENTRY_OPPORTUNITY_BOOK_PATH=bookPath;process.env.DISDEX_RUNTIME_COMMIT_SHA=sha;
  await writeFile(bookPath,JSON.stringify({schemaVersion:1,records:[]}));
  const lease={schema:ACCOUNT_LOCK_SCHEMA,accountScope:"ASTER_FUTURES",ownerId:"V52",leaseId:"actual-owner",acquiredAt:now-1000,expiresAt:now+120000,reservations:[]};
  await writeFile(lockPath,JSON.stringify(lease));
  const input={sourceGitSha:sha,nativePositionId:"actual-nvda-cid",strategy:"V52" as const,symbol:"NVDAUSDT",side:"LONG" as const,route:"V50_POST_OPEN_BASIS",logicalEntryTs:1772127000000,gross:2,plannedHoldHours:3,entrySnapshot:{capture_basis_bps:-99.82680573442981,entry_basis_bps:-86.63185257524408,exit_basis_bps:99999},capturedAt:now};
  const record=await publishStable4PythonNativeEntry({input,lockPath,ownerId:"V52",leaseId:"actual-owner"});
  assert.ok(Math.abs(record.score!-.011289810650188917)<1e-12);
  assert.deepEqual(JSON.parse(await readFile(bookPath,"utf8")).records,[record]);
  await assert.rejects(publishStable4PythonNativeEntry({input,lockPath,ownerId:"V52",leaseId:"borrowed"}),/LEASE_CHANGED/);
  await assert.rejects(publishStable4PythonNativeEntry({input:{...input,sourceGitSha:"b".repeat(40)},lockPath,ownerId:"V52",leaseId:"actual-owner"}),/IDENTITY_INVALID/);
 }finally{
  if(oldBook===undefined)delete process.env.DISDEX_STABLE4_ENTRY_OPPORTUNITY_BOOK_PATH;else process.env.DISDEX_STABLE4_ENTRY_OPPORTUNITY_BOOK_PATH=oldBook;
  if(oldSha===undefined)delete process.env.DISDEX_RUNTIME_COMMIT_SHA;else process.env.DISDEX_RUNTIME_COMMIT_SHA=oldSha;
  await rm(dir,{recursive:true,force:true});
 }
});
