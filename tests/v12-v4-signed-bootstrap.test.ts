import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {initializeV4SignedFlatState} from "../lib/v12-v4-signed-bootstrap";
test("signed flat init is safe, repeatable and never infers flat from missing state",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-flat-")),now=Date.now(),sha="f".repeat(40);
 try{
  const store=new V4ExecutionStore(join(dir,"orders.json"),sha);
  const kinds=["V12","PENGU","Q102","V52","FET","HYPE_LONG","IDLE","RESIDUAL"] as const;
  const peers=kinds.map(kind=>({kind,programSha:sha,raw:{
   updatedAt:now,...(kind==="V12"?{activePositions:[]}:kind==="V52"?{positions:{}}:
    kind==="HYPE_LONG"||kind==="IDLE"?{positions:[]}:{position:null}),
  }}));
  const client:any={getPositions:async()=>[],getOpenOrders:async()=>[],
   getBalances:async()=>[{asset:"USDT",balance:"72.5",availableBalance:"72.4"}]};
  const args={store,client,peers,pendingPath:join(dir,"pending.json"),now:()=>now};
  const doc=await initializeV4SignedFlatState(args);
  assert.equal(doc.state.equityUsd,72.5);
  assert.deepEqual(await initializeV4SignedFlatState(args),doc);
  const occupied={...client,getPositions:async()=>[{symbol:"ETHUSDT",positionAmt:"0.1"}]};
  await assert.rejects(()=>initializeV4SignedFlatState({...args,client:occupied}),/SIGNED_FLAT_ACCOUNT/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
