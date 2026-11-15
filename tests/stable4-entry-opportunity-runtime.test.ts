import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {ACCOUNT_LOCK_SCHEMA} from "../lib/disdex-account-order-lock";
import {createStable4EntryOpportunityRuntime} from "../lib/stable4-entry-opportunity-runtime";

test("native runtime publishes immutable causal evidence before returning and never initializes missing stores",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"stable4-native-runtime-"));
 try{
  const path=join(dir,"book.json"),now=Date.now();
  const runtime=createStable4EntryOpportunityRuntime({DISDEX_STABLE4_ENTRY_OPPORTUNITY_BOOK_PATH:path});
  const input={sourceGitSha:"a".repeat(40),nativePositionId:"native-1",strategy:"Q102" as const,symbol:"UNIUSDT",side:"SHORT" as const,route:"UNI|MR72_Z1.5_H24",logicalEntryTs:1772485200000,gross:.75,plannedHoldHours:24,entrySnapshot:{ret14:.10960067969413756,strength:1.6296431198044614,margin:1.0864287465363076},capturedAt:now};
  const lease={document:async()=>({schema:ACCOUNT_LOCK_SCHEMA,accountScope:"ASTER_FUTURES",ownerId:"Q102",leaseId:"native",acquiredAt:now-1000,expiresAt:now+120000,reservations:[]})};
  await assert.rejects(runtime.prepareAndPublish(input,lease),/STORE_MISSING/);
  await writeFile(path,JSON.stringify({schemaVersion:1,records:[]}));
  const published=await runtime.prepareAndPublish(input,lease);
  assert.ok(Math.abs(published.score!-.03762281565352898)<1e-12);
  assert.deepEqual(JSON.parse(await readFile(path,"utf8")).records,[published]);
  await assert.rejects(runtime.prepareAndPublish({...input,capturedAt:now+1},lease),/CONFLICT/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
