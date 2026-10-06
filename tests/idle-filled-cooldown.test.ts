import assert from 'node:assert/strict';
import test from 'node:test';
import {IdlePriorityShortRunner} from '../lib/idle-priority-short-runner';
import {emptyIdleState} from '../lib/idle-priority-short-state';
const sha='a'.repeat(40),at=1800000000000;
function fixture(){
 const state=emptyIdleState(sha,at);
 const store={async save(s:any){Object.assign(state,structuredClone(s));}};
 const r:any=new IdlePriorityShortRunner({stateStore:store,executor:{async getPositions(){return [{symbol:'RENDERUSDT',quantity:-1}];}},now:()=>at} as any);
 r.installProtection=async()=>({symbol:'RENDERUSDT',route:'IDLE_RENDER_RELATIVE_SHORT',side:'SHORT',quantity:1});
 return {r,state};
}
const candidate={symbol:'RENDERUSDT',accepted:true,side:'SHORT',features:{decisionTs:at}};
test('LONG generic candidate cannot consume SHORT cooldown',()=>{
 const {r,state}=fixture();r.markCandidateLifecycle(state,{...candidate,side:'LONG'});
 assert.deepEqual(state.lastAcceptedBySymbol,{});
});
test('route rejection cannot consume cooldown',()=>{
 const {r,state}=fixture();r.markCandidateLifecycle(state,{...candidate,accepted:false});
 assert.deepEqual(state.lastAcceptedBySymbol,{});
});
for(const status of ['REJECTED','CANCELED','EXPIRED','UNKNOWN']){
 test(status+' without exposure cannot consume cooldown',async()=>{
 const {r,state}=fixture();await r.finalizeEntry(state,{symbol:'RENDERUSDT',decisionTs:at},{status,executedQuantity:0},{});
 assert.deepEqual(state.lastAcceptedBySymbol,{});
 });
}
for(const status of ['FILLED','PARTIALLY_FILLED']){
 test(status+' starts cooldown and preserves other symbols',async()=>{
 const {r,state}=fixture();state.lastAcceptedBySymbol.TAOUSDT=at-3600000;
 await r.finalizeEntry(state,{symbol:'RENDERUSDT',decisionTs:at},{status,executedQuantity:1},{async document(){}});
 assert.equal(state.lastAcceptedBySymbol.RENDERUSDT,at);
 assert.equal(state.lastAcceptedBySymbol.TAOUSDT,at-3600000);
 assert.equal(r.candidateLifecycleAllows(state,{...candidate,features:{decisionTs:at+11*3600000}}),false);
 assert.equal(r.candidateLifecycleAllows(state,{...candidate,features:{decisionTs:at+12*3600000}}),true);
 });
}
