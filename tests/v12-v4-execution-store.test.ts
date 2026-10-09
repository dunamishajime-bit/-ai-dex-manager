import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {V4ExecutionStore,v4OrderIdentity,advanceV4Intent} from "../lib/v12-v4-execution-store";
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
