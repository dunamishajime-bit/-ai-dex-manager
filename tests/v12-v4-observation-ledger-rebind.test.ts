import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {rebindV4ObservationLedger} from "../lib/v12-v4-observation-ledger-rebind";

const oldSha="a".repeat(40), newSha="b".repeat(40);

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"v4-ledger-bridge-"));
 const file=join(dir,"old.json");
 const doc=new V4ExecutionStore(file,oldSha).initialize({equityUsd:100,foreign:[],holdProtected:false});
 return {dir,file,doc,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test("observation-only ledger can be rebound to new SHA without clearing existing journal or authorizing an order",()=>{
 const f=fixture();
 try{
  const doc=rebindV4ObservationLedger(f.doc,oldSha,newSha);
  assert.equal(doc.releaseSha,newSha);
  assert.equal(doc.revision,f.doc.revision);
  assert.deepEqual(doc.state,f.doc.state);
  assert.notEqual(doc,f.doc);
  const file=join(f.dir,"candidate.json");
  writeFileSync(file,JSON.stringify(doc)+"\n",{mode:0o600});
  assert.deepEqual(new V4ExecutionStore(file,newSha).read(),doc);
  assert.throws(()=>new V4ExecutionStore(file,oldSha).read(),/EXECUTION_RELEASE_MISMATCH/);
 }finally{f.cleanup();}
});

test("refuses any owned execution lifecycle, even a terminal or zero-quantity intent",()=>{
 const f=fixture();
 try{
  const withIntent=structuredClone(f.doc);
  (withIntent.intents as any).prior={stage:"TERMINAL"};
  assert.throws(()=>rebindV4ObservationLedger(withIntent,oldSha,newSha),/OWNED_LIFECYCLE_PRESENT/);
  const withLeg=structuredClone(f.doc);
  (withLeg.state.legs as any).prior={qty:0,status:"CLOSED"};
  assert.throws(()=>rebindV4ObservationLedger(withLeg,oldSha,newSha),/OWNED_LIFECYCLE_PRESENT/);
  const withStop=structuredClone(f.doc);
  (withStop.protections as any).prior={phase:"CLOSED"};
  assert.throws(()=>rebindV4ObservationLedger(withStop,oldSha,newSha),/OWNED_LIFECYCLE_PRESENT/);
 }finally{f.cleanup();}
});

test("refuses non-account-mark journals and ambiguous historical control state",()=>{
 const f=fixture();
 try{
  const withExecution=structuredClone(f.doc);
  (withExecution.state.journal as any).push({type:"ENTRY_FILLED"});
  withExecution.revision++;
  assert.throws(()=>rebindV4ObservationLedger(withExecution,oldSha,newSha),/NON_MARK_HISTORY/);
  const withHold=structuredClone(f.doc);withHold.state.initial.holdProtected=true;
  assert.throws(()=>rebindV4ObservationLedger(withHold,oldSha,newSha),/INITIAL_STATE_NOT_FLAT/);
  assert.throws(()=>rebindV4ObservationLedger(f.doc,oldSha,oldSha),/SHA_INVALID/);
  assert.throws(()=>rebindV4ObservationLedger(f.doc,"c".repeat(40),newSha),/RELEASE_MISMATCH/);
 }finally{f.cleanup();}
});
