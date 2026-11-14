import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Stable4EntryOpportunityStore} from "../lib/stable4-entry-opportunity-store";
import {ACCOUNT_LOCK_SCHEMA} from "../lib/disdex-account-order-lock";
const now=1800000000000;
const record={strategy:"Q102" as const,positionId:"native-order-1",sourceSha:"a".repeat(40),symbol:"UNIUSDT",side:"SHORT" as const,entryTs:now-1000,modelVersion:"STABLE4_CAUSAL_ENTRY_FEATURES_V1",score:.04,capturedAt:now};
function lease(overrides:Record<string,unknown>={}){return{document:async()=>({schema:ACCOUNT_LOCK_SCHEMA,accountScope:"ASTER_FUTURES",ownerId:"test-owner",leaseId:"lease-1",acquiredAt:now-5000,expiresAt:now+120000,reservations:[],...overrides})};}
async function fixture(run:(path:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),"stable4-score-store-"));try{await run(join(dir,"entry-scores.json"));}finally{await rm(dir,{recursive:true,force:true});}}
test("score store requires explicit initialized evidence and persists an immutable retry under the owned lease",async()=>fixture(async path=>{
 const store=new Stable4EntryOpportunityStore(path,()=>now);
 await assert.rejects(store.read(),/STORE_MISSING/);
 await writeFile(path,JSON.stringify({schemaVersion:1,records:[]}));
 await store.append(record,lease());
 assert.equal((await store.read()).records.length,1);
 const bytes=await readFile(path,"utf8");await store.append(record,lease());assert.equal(await readFile(path,"utf8"),bytes);
 await assert.rejects(store.append({...record,score:.05},lease()),/CONFLICT/);
 assert.equal(await readFile(path,"utf8"),bytes);
}));
test("expired, changed and foreign account leases cannot modify score evidence",async()=>fixture(async path=>{
 await writeFile(path,JSON.stringify({schemaVersion:1,records:[]}));const before=await readFile(path,"utf8"),store=new Stable4EntryOpportunityStore(path,()=>now);
 for(const bad of [lease({expiresAt:now}),lease({accountScope:"OTHER"}),lease({ownerId:""})])await assert.rejects(store.append(record,bad),/LEASE/);
 let n=0;const changing={document:async()=>({...await lease().document(),leaseId:++n===1?"lease-1":"lease-2"})};
 await assert.rejects(store.append(record,changing),/LEASE/);assert.equal(await readFile(path,"utf8"),before);
}));
test("malformed/future evidence and external edits are preserved rather than overwritten",async()=>fixture(async path=>{
 const store=new Stable4EntryOpportunityStore(path,()=>now);
 await writeFile(path,"not-json");await assert.rejects(store.append(record,lease()),/STORE_INVALID/);assert.equal(await readFile(path,"utf8"),"not-json");
 await writeFile(path,JSON.stringify({schemaVersion:1,records:[]}));await assert.rejects(store.append({...record,capturedAt:now+1},lease()),/CAPTURE/);
 let n=0;const changing={document:async()=>{if(++n===2)await writeFile(path,"external-edit");return lease().document();}};
 await assert.rejects(store.append(record,changing),/CAS/);assert.equal(await readFile(path,"utf8"),"external-edit");
}));
