import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {V4ExecutionStore,v4OrderIdentity,advanceV4Intent} from "../lib/v12-v4-execution-store";
import {rebindV4ActiveLineage} from "../lib/v12-v4-active-lineage-rebind";
const SHA="a".repeat(40);
const initial={equityUsd:1000,foreign:[],holdProtected:false};
test("durable intent survives restart and SUBMITTING cannot return to PREPARED",()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-wal-"));
 try{
 const store=new V4ExecutionStore(join(dir,"state.json"),SHA);
 let doc=store.initialize(initial);
 const identity=v4OrderIdentity(SHA,"XRPUSDT:route:SHORT:123","ENTRY",0);
 doc=store.commit(doc.revision,{...doc,intents:{[identity]:{clientOrderId:identity,legId:"XRPUSDT:route:SHORT:123",action:"ENTRY",sequence:0,stage:"PREPARED",createdAt:123,updatedAt:123}}});
 doc=store.commit(doc.revision,advanceV4Intent(doc,identity,"SUBMITTING",124));
 const restored=new V4ExecutionStore(join(dir,"state.json"),SHA).read();
 assert.equal(restored.intents[identity].stage,"SUBMITTING");
 assert.throws(()=>advanceV4Intent(restored,identity,"PREPARED",125),/INVALID_INTENT_TRANSITION/);
 assert.equal(identity,v4OrderIdentity(SHA,"XRPUSDT:route:SHORT:123","ENTRY",0));
 assert.notEqual(identity,v4OrderIdentity(SHA,"XRPUSDT:other:SHORT:123","ENTRY",0));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("stale writer, wrong release and journal snapshot corruption fail closed",()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-wal-"));
 try{
 const path=join(dir,"state.json"),store=new V4ExecutionStore(path,SHA);
 const doc=store.initialize(initial);store.commit(doc.revision,doc);
 assert.throws(()=>store.commit(doc.revision,doc),/STALE_EXECUTION_REVISION/);
 assert.throws(()=>new V4ExecutionStore(path,"b".repeat(40)).read(),/RELEASE_MISMATCH/);
 const raw=JSON.parse(readFileSync(path,"utf8"));raw.state.equityUsd=999;
 writeFileSync(path,JSON.stringify(raw));
 assert.throws(()=>store.read(),/SNAPSHOT_JOURNAL_MISMATCH/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("active lineage rebind preserves old venue client ids and permits only new ids for new intents",()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-lineage-"));
 try{
  const oldSha="a".repeat(40),newSha="b".repeat(40),path=join(dir,"state.json");
  const oldStore=new V4ExecutionStore(path,oldSha);
  let doc=oldStore.initialize(initial);
  const oldId=v4OrderIdentity(oldSha,"ETHUSDT:route:SHORT:123","STOP",0);
  doc=oldStore.commit(doc.revision,{...doc,intents:{[oldId]:{clientOrderId:oldId,legId:"ETHUSDT:route:SHORT:123",action:"STOP",sequence:0,stage:"PREPARED",createdAt:123,updatedAt:123}}});
  doc=oldStore.commit(doc.revision,advanceV4Intent(doc,oldId,"SUBMITTING",124));
  doc=oldStore.commit(doc.revision,advanceV4Intent(doc,oldId,"ACKNOWLEDGED",125));
  const rebound=rebindV4ActiveLineage(doc,oldSha,newSha);
  assert.deepEqual(rebound.legacyReleaseShas,[oldSha]);
  assert.equal(rebound.intents[oldId].clientOrderId,oldId);
  const reboundPath=join(dir,"rebound.json");writeFileSync(reboundPath,JSON.stringify(rebound));
  const newStore=new V4ExecutionStore(reboundPath,newSha);
  assert.deepEqual(newStore.read(),rebound);
  const newId=v4OrderIdentity(newSha,"ETHUSDT:route:SHORT:123","EXIT",0);
  assert.notEqual(oldId,newId);
  const bad={...rebound,intents:{...rebound.intents,["c".repeat(40)]:{clientOrderId:"c".repeat(40),legId:"ETHUSDT:route:SHORT:123",action:"EXIT",sequence:0,stage:"PREPARED",createdAt:124,updatedAt:124}}};
  writeFileSync(reboundPath,JSON.stringify(bad));
  assert.throws(()=>newStore.read(),/INVALID_PERSISTED_INTENT/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
