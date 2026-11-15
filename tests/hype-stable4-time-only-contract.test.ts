import assert from "node:assert/strict";
import test from "node:test";
import {createHypeH48TimeOnlyContract,validateHypeH48TimeOnlyContract,evaluateHypeH48TimeOnlyExit,validateHypeH48PolicyEvidence} from "../lib/hype-stable4-time-only-contract";
import {HypeZecLongRunner} from "../lib/hype-zec-long-runner";
import {FileHypeZecLongRunnerStateStore} from "../lib/hype-zec-long-runner-state";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
const H=3600000,T=1800000000000-1800000000000%(6*H),SHA="a".repeat(40);
const identity={positionId:"native-h48",sourceSha:SHA,logicalEntryTs:T};
const contract=()=>createHypeH48TimeOnlyContract(identity);
test("immutable H48 contract binds native logical time and never uses actual fill delay",()=>{
 const c=contract();assert.equal(c.logicalExitTs,T+48*H);assert.ok(Object.isFrozen(c));
 assert.deepEqual(validateHypeH48TimeOnlyContract(JSON.parse(JSON.stringify(c)),identity),c);
 for(const change of [{logicalExitTs:T+47*H},{positionId:"borrowed"},{sourceSha:"b".repeat(40)},{kind:"TREND"},{extra:true}])assert.throws(()=>validateHypeH48TimeOnlyContract({...c,...change},identity));
});
test("H48 exit waits exactly48hours and requires an evidenced boundary open without SL or TP",()=>{
 const c=contract();assert.deepEqual(evaluateHypeH48TimeOnlyExit(c,T+48*H-1),{due:false});
 assert.throws(()=>evaluateHypeH48TimeOnlyExit(c,T+48*H),/BOUNDARY_OPEN/);
 const b={openTs:T+48*H,open:123,observedAt:T+48*H+5};
 assert.deepEqual(evaluateHypeH48TimeOnlyExit(c,b.observedAt,b),{due:true,reason:"HYPE_REDESIGN_TIME48_NEXTOPEN",logicalExitTs:T+48*H,referenceOpen:123});
 for(const bar of [{...b,openTs:b.openTs-H},{...b,open:0},{...b,observedAt:b.observedAt+1}])assert.throws(()=>evaluateHypeH48TimeOnlyExit(c,b.observedAt,bar));
});
test("root time-only policy evidence must bind exactsource position quantity and fresh certificate",()=>{
 const c=contract(),now=T+1000,proof={policy:"H48_TIME_ONLY",runtimeSha:SHA,positionId:c.positionId,logicalEntryTs:T,logicalExitTs:T+48*H,quantity:2,certificateSha256:"b".repeat(64),validatedAt:now,expiresAt:now+60000};
 assert.doesNotThrow(()=>validateHypeH48PolicyEvidence(proof,{contract:c,quantity:2,now}));
 for(const change of [{policy:"TREND"},{runtimeSha:"c".repeat(40)},{quantity:"2"},{positionId:"borrowed"},{expiresAt:now},{validatedAt:now+1},{certificateSha256:""}])assert.throws(()=>validateHypeH48PolicyEvidence({...proof,...change},{contract:c,quantity:2,now}));
});
test("missing exactroot policy blocks only new H48 before any market mutation",async()=>{
 let sent=0;const runner:any=new HypeZecLongRunner({runtime:{mode:"LIVE",signalMode:"STABLE4",runtimeSha:SHA},executor:{executeMarket:async()=>{sent++;}},logger:{info(){},warn(){},error(){}},now:()=>T+1000} as any);
 await assert.rejects(()=>runner.assertH48TimeOnlyPolicy(contract(),2,{document:async()=>({})},"ENTRY"),/ROOT_POLICY/);assert.equal(sent,0);
});
test("H48 contract survives native state restart while an invalid contract cannot become legacy",async()=>{
 const root=await mkdtemp(join(tmpdir(),"h48-time-contract-"));
 try{const store=new FileHypeZecLongRunnerStateStore(join(root,"state.json"),SHA,"LIVE"),state:any={schema:"disdex-hype-zec-long/v1",runtimeCommitSha:SHA,mode:"LIVE",updatedAt:Date.now(),failures:[],positions:[{strategy:"HYPE_LONG",symbol:"HYPEUSDT",side:"LONG",positionId:identity.positionId,signalTs:T,entryTs:T+15000,nativeExitContract:contract()}]};
 await store.save(state);assert.deepEqual((await store.load()).positions?.[0].nativeExitContract,contract());
 state.positions[0].nativeExitContract={...contract(),logicalExitTs:T+24*H};await assert.rejects(()=>store.save(state),/H48/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("legacy TREND position cannot silently become H48 and existing protective orders are never adopted",async()=>{
 const actual={symbol:"HYPEUSDT",quantity:2,positionSide:"LONG"},owned:any={strategy:"HYPE_LONG",symbol:"HYPEUSDT",positionId:identity.positionId,signalTs:T,quantity:2};
 const runner:any=new HypeZecLongRunner({runtime:{mode:"LIVE",signalMode:"STABLE4",runtimeSha:SHA},logger:{info(){},warn(){},error(){}},now:()=>T+1000} as any);
 assert.equal(await runner.reconcileOwnership({positions:[owned]},[actual],[],{document:async()=>({})}),"HYPE_H48_LEGACY_POSITION_REINTERPRETATION_FORBIDDEN");
 runner.dependencies.runtime.signalMode="TREND";
 assert.equal(await runner.reconcileOwnership({positions:[owned]},[actual],[]),"HYPE_ZEC_PROTECTION_NOT_VERIFIED:HYPEUSDT");
 runner.dependencies.runtime.signalMode="STABLE4";owned.nativeExitContract=contract();
 assert.equal(await runner.reconcileOwnership({positions:[owned]},[actual],[{symbol:"HYPEUSDT",type:"STOP_MARKET"}],{document:async()=>({})}),"HYPE_H48_TIME_ONLY_PROTECTION_POLICY_CONFLICT");
});
test("actual policy capability and a revalidated lease are required to own a time-only position",async()=>{
 let checks=0,phase:string|undefined;const lease:any={document:async()=>{checks++;return{};}};
 const runner:any=new HypeZecLongRunner({runtime:{mode:"LIVE",signalMode:"STABLE4",runtimeSha:SHA},now:()=>T+1000,
 h48TimeOnlyPolicy:{authorize:async(input:any)=>{phase=input.phase;assert.equal(input.lease,lease);return{policy:"H48_TIME_ONLY",runtimeSha:SHA,positionId:identity.positionId,logicalEntryTs:T,logicalExitTs:T+48*H,quantity:2,certificateSha256:"b".repeat(64),validatedAt:T+1000,expiresAt:T+61000};}}} as any);
 const result=await runner.reconcileOwnership({positions:[{strategy:"HYPE_LONG",symbol:"HYPEUSDT",positionId:identity.positionId,signalTs:T,quantity:2,nativeExitContract:contract()}]},[{symbol:"HYPEUSDT",quantity:2,positionSide:"LONG"}],[],lease);
 assert.equal(result,undefined);assert.equal(phase,"POSITION");assert.equal(checks,2);
});
test("H48 boundary reader rejects a neighboring candle instead of fabricating the required open",async()=>{
 const c=contract();let params:any;
 const client={getKlines:async(...args:any[])=>{params=args;return[[c.logicalExitTs,123,124,122,123,1,0]];}};
 const runner:any=new HypeZecLongRunner({adapter:{client},now:()=>c.logicalExitTs+1000} as any);
 await assert.rejects(()=>runner.readH48TimeBoundary(c),/BOUNDARY_OPEN/);
 client.getKlines=async()=>[[c.logicalExitTs,"123",124,122,123,1,0] as any];
 assert.equal((await runner.readH48TimeBoundary(c)).open,123);assert.equal(params[3].startTime,c.logicalExitTs);
 client.getKlines=async()=>[[c.logicalExitTs-H,"123",124,122,123,1,0] as any];
 await assert.rejects(()=>runner.readH48TimeBoundary(c),/BOUNDARY_OPEN/);
});
