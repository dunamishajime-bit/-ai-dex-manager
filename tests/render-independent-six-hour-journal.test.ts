import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyRenderShadow, advanceRenderShadow, loadRenderShadow, saveRenderShadow } from "../lib/render-independent-six-hour-journal";
import { RENDER_H1_MS as H, RENDER_M5_MS as M, RENDER_INDEPENDENT_ROUTE } from "../lib/render-highwr-and-legacy-stop";

const sha = "a".repeat(40);
const at = Date.UTC(2026,9,25,0,0,0);
function samples(){
 const renderM5=[],btcM5=[];
 for(let i=-864;i<0;i++){
  const ts=at+i*M,last=i>=-12,j=i+12,n=i+576;
  const open=last?100.3-j*.06:102-n*.003;
  const close=last?open-.06:open-.003;
  renderM5.push({ts,open,high:open+(last&&i===-12?.6:.015),low:close-.01,close,baseVolume:10,takerBuyBaseVolume:4.4});
  const bo=last?100+j*.026:100,bc=last?bo+.026:100;
  btcM5.push({ts,open:bo,high:bc+.01,low:bo-.01,close:bc});
 }
 return {renderM5,btcM5};
}
test("shadow entry exists only after complete causal H1, even without real account entry",()=>{
 const x=advanceRenderShadow({state:emptyRenderShadow(sha),asOfDecisionTs:at,...samples(),
   incumbentAt:()=>undefined,sameSymbolPositionOrPending:true,cooldownUntil:at+H});
 assert.equal(x.state.lastDecisionTs,at);
 assert.equal(x.decision.rawAccepted,true);
 assert.equal(x.state.pendingSignalTs.length,1);
 assert.equal(x.state.settled.length,0);
 assert.equal(x.decision.priority.accepted,false);
 assert.equal(x.decision.priority.incumbentPreserved,true);
});
test("repeated H1 does not duplicate an independent hypothetical signal",()=>{
 const args={...samples(),incumbentAt:()=>undefined,sameSymbolPositionOrPending:false,cooldownUntil:0};
 const one=advanceRenderShadow({state:emptyRenderShadow(sha),asOfDecisionTs:at,...args});
 const two=advanceRenderShadow({state:one.state,asOfDecisionTs:at,...args});
 assert.deepEqual(two.state.pendingSignalTs,[at]);
 assert.equal(two.state.settled.length,0);
});
test("ledger is SHA bound and survives atomic save/reload; tamper fails closed",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"render-hw-journal-"));
 const file=join(dir,"journal.json");
 try{
  const state=advanceRenderShadow({state:emptyRenderShadow(sha),asOfDecisionTs:at,...samples(),
   incumbentAt:()=>undefined,sameSymbolPositionOrPending:false,cooldownUntil:0}).state;
  await saveRenderShadow(file,state);
  assert.deepEqual(await loadRenderShadow(file,sha),state);
  await assert.rejects(loadRenderShadow(file,"b".repeat(40)),/MISMATCH/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("missing settled M5 source cannot settle an old signal",()=>{
 const s=emptyRenderShadow(sha);
 s.lastDecisionTs=at-H;
 s.pendingSignalTs=[at-100*H];
 assert.throws(()=>advanceRenderShadow({state:s,asOfDecisionTs:at,...samples(),
  incumbentAt:()=>undefined,sameSymbolPositionOrPending:false,cooldownUntil:0}),/RENDER_SHADOW_ENTRY_M5_MISSING|RENDER_SHADOW_M5_GAP/);
});
