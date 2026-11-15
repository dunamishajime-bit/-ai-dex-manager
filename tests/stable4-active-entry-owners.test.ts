import assert from "node:assert/strict";
import test from "node:test";
import { buildStable4ActiveEntryOwners, type Stable4ActiveEntryOwnersInput } from "../lib/stable4-active-entry-owners";
import type { Stable4EntryOpportunityRecord } from "../lib/stable4-entry-opportunity-book";
import type { V4PeerKind, V4PeerSource } from "../lib/v12-v4-peer-state-owners";
import type { V4ExecutionDocument } from "../lib/v12-v4-execution-store";

const NOW=1_800_000_000_000, ENTRY=NOW-86_400_000, SHA="a".repeat(40), V4SHA="b".repeat(40);
const PREFIX:Record<V4PeerKind,string>={V12:"disdex-v12-x1-all",PENGU:"disdex-pengu-dual-ls-v2",Q102:"disdex-quality102-causal-v1",V52:"disdex-v52-aster-only",FET:"disdex-fet-brk48",HYPE_LONG:"disdex-hype-long",IDLE:"disdex-idle-priority-short",RESIDUAL:"disdex-idle-priority-short"};
function fixture():Stable4ActiveEntryOwnersInput {
 const raw:Record<V4PeerKind,Record<string,any>>={
  V12:{schema:"v12-x1-all-runner-state/v2",strategyId:"V12_X1.00_ALL",mode:"LIVE",activePositions:[]},
  PENGU:{version:2,strategyId:"PENGU_DUAL_LS_V2_FINAL",mode:"LIVE"},
  Q102:{version:1,strategyId:"QUALITY102_CAUSAL_V1",mode:"LIVE"},
  V52:{schemaVersion:3,strategyId:"DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",mode:"live",positions:{}},
  FET:{schema:"fet-brk48-residual-state/v1",strategyId:"FET_BRK48_RESIDUAL"},
  HYPE_LONG:{schema:"disdex-hype-zec-long/v1",mode:"LIVE",positions:[]},
  IDLE:{schema:"disdex-idle-priority-state/v2",positions:[]},
  RESIDUAL:{schema:"disdex-idle-residual-long-state/v1",position:null},
 };
 const peerSources=(Object.keys(raw) as V4PeerKind[]).map(kind=>({kind,programSha:SHA,raw:{...raw[kind],runtimeCommitSha:SHA,updatedAt:NOW},service:{unit:PREFIX[kind]+"@"+SHA+".service",active:true,retiredV12:false,observedAt:NOW,mainPid:123}} satisfies V4PeerSource));
 const document={schema:2,releaseSha:V4SHA,revision:1,state:{initial:{equityUsd:100,foreign:[],holdProtected:false},foreign:[],legs:{},journal:[]},intents:{},protections:{}} as unknown as V4ExecutionDocument;
 return {now:NOW,observedAt:NOW,expectedPeerSha:SHA,peerSources,v4:{releaseSha:V4SHA,document},book:{schemaVersion:1,records:[]}};
}
function record(strategy:Stable4EntryOpportunityRecord["strategy"],positionId:string,symbol:string,side:"LONG"|"SHORT"="LONG"):Stable4EntryOpportunityRecord {
 return {strategy,positionId,sourceSha:strategy==="V4"?V4SHA:SHA,symbol,side,entryTs:ENTRY,modelVersion:"entry-v1",score:0.4,capturedAt:ENTRY+1};
}
function peer(v:Stable4ActiveEntryOwnersInput,kind:V4PeerKind){return v.peerSources.find(s=>s.kind===kind)!.raw;}
function bind(v:Stable4ActiveEntryOwnersInput,kind:V4PeerKind){
 const strategy=kind==="HYPE_LONG"?"HYPE":kind as "PENGU"|"Q102"|"FET"|"IDLE"|"V52";
 const symbols={PENGU:"PENGUUSDT",Q102:"ONDOUSDT",FET:"FETUSDT",IDLE:"TAOUSDT",V52:"METAUSDT",HYPE_LONG:"HYPEUSDT"};
 const symbol=symbols[kind as keyof typeof symbols], side=kind==="IDLE"?"SHORT":"LONG";
 const rec=record(strategy,"native-"+kind,symbol,side);
 const p:any={symbol,side:kind==="PENGU"||kind==="Q102"||kind==="FET"?1:side,entryTs:kind==="PENGU"||kind==="FET"?ENTRY:ENTRY+100,quantity:0.25,entryOpportunity:rec,signalTs:ENTRY};
 if(kind==="HYPE_LONG"){p.strategy="HYPE_LONG";p.positionId=rec.positionId;peer(v,kind).positions=[p];}
 else if(kind==="V52"){Object.assign(p,{positionId:rec.positionId,entryClientOrderId:rec.positionId,symbol:"META",openedAt:ENTRY+100,asterQty:0.25,asterOpenSide:"BUY"});peer(v,kind).positions={V11_EQ:p};}
 else if(kind==="IDLE")peer(v,kind).positions=[p];
 else peer(v,kind).position=p;
 v.book.records=[...v.book.records,rec];
 return p;
}
function v4leg(v:Stable4ActiveEntryOwnersInput,id:string,quantity=0.1){
 const rec=record("V4",id,"BNBUSDT","SHORT");
 const doc=v.v4.document as any;
 doc.state.legs[id]={id,status:"OPEN",qty:quantity,reservationUsd:0,exitRemainingQty:0,entryTs:ENTRY,candidate:{symbol:"BNBUSDT",effectiveSide:"SHORT"},entryOpportunity:rec};
 doc.protections[id]={legId:id,phase:"STOP_CONFIRMED",protectedQty:quantity,stopClientOrderId:"stop-"+id,updatedAt:NOW};
 doc.intents["stop-"+id]={clientOrderId:"stop-"+id,legId:id,action:"STOP",stage:"ACKNOWLEDGED"};
 v.book.records=[...v.book.records,rec];
 return doc.state.legs[id];
}

test("all eight validated flat peer schemas and flat V4 form complete empty inventory",()=>{
 const v=fixture();assert.deepEqual(buildStable4ActiveEntryOwners(v),{complete:true,observedAt:NOW,positions:[],reason:"COMPLETE"});
});
test("all modeled frameworks retain actual partial remaining quantity",()=>{
 const v=fixture();for(const kind of ["PENGU","Q102","FET","HYPE_LONG","IDLE","V52"] as V4PeerKind[])bind(v,kind);
 const result=buildStable4ActiveEntryOwners(v);assert.equal(result.complete,true);assert.equal(result.positions.length,6);
 assert.ok(result.positions.every(p=>p.quantity===0.25&&p.entryTs===ENTRY));
});
test("legacy active position without entry score makes snapshot explicitly incomplete",()=>{
 const v=fixture();const p=bind(v,"Q102");delete p.entryOpportunity;
 const result=buildStable4ActiveEntryOwners(v);assert.equal(result.complete,false);assert.equal(result.reason,"ACTIVE_SCORE_UNBOUND");
});
test("planned or research exit deadline never removes a still-owned position",()=>{
 const v=fixture();const p=bind(v,"FET");p.exitTs=NOW-1000;
 const result=buildStable4ActiveEntryOwners(v);assert.equal(result.complete,true);assert.equal(result.positions.length,1);
});
test("same-symbol V4 legs remain distinct owners with their actual quantities",()=>{
 const v=fixture();v4leg(v,"leg-one",0.1);v4leg(v,"leg-two",0.2);
 const result=buildStable4ActiveEntryOwners(v);assert.equal(result.complete,true);assert.deepEqual(result.positions.map(p=>[p.positionId,p.quantity]),[["leg-one",0.1],["leg-two",0.2]]);
});
test("peer schema, lineage, freshness, service and pending-review failures reject",()=>{
 for(const change of [
  (v:Stable4ActiveEntryOwnersInput)=>{peer(v,"Q102").version=99;},
  (v:Stable4ActiveEntryOwnersInput)=>{peer(v,"Q102").runtimeCommitSha="c".repeat(40);},
  (v:Stable4ActiveEntryOwnersInput)=>{peer(v,"Q102").pending={phase:"submitted"};},
  (v:Stable4ActiveEntryOwnersInput)=>{peer(v,"FET").manualReview="needs review";},
  (v:Stable4ActiveEntryOwnersInput)=>{v.peerSources[1].service!.observedAt=NOW-15001;},
  (v:Stable4ActiveEntryOwnersInput)=>{v.peerSources[1].service=undefined;},
  (v:Stable4ActiveEntryOwnersInput)=>{v.peerSources.pop();},
  (v:Stable4ActiveEntryOwnersInput)=>{v.observedAt=NOW-120001;},
 ]){const v=fixture();change(v);assert.throws(()=>buildStable4ActiveEntryOwners(v));}
});
test("V4 pin, review, unresolved entry, unsafe lifecycle and missing protection reject",()=>{
 for(const change of [
  (v:Stable4ActiveEntryOwnersInput)=>{v.v4.releaseSha=SHA;},
  (v:Stable4ActiveEntryOwnersInput)=>{v.v4.document.state.executionReview="review";},
  (v:Stable4ActiveEntryOwnersInput)=>{(v.v4.document.intents as any).entry={action:"ENTRY",stage:"UNKNOWN"};},
  (v:Stable4ActiveEntryOwnersInput)=>{v4leg(v,"leg").status="PENDING_ENTRY";},
  (v:Stable4ActiveEntryOwnersInput)=>{v4leg(v,"leg");delete v.v4.document.protections.leg;},
 ]){const v=fixture();change(v);assert.throws(()=>buildStable4ActiveEntryOwners(v));}
});
test("unknown legacy V12, ZEC and residual actual exposure is incomplete instead of empty",()=>{
 for(const kind of ["V12","HYPE_LONG","RESIDUAL"] as V4PeerKind[]){
  const v=fixture(),p={symbol:kind==="V12"?"BTCUSDT":kind==="HYPE_LONG"?"ZECUSDT":"DOGEUSDT",side:"LONG",quantity:1,entryTs:ENTRY};
  if(kind==="V12")peer(v,kind).activePositions=[p];else if(kind==="HYPE_LONG")peer(v,kind).positions=[{...p,strategy:"ZEC_LONG"}];else peer(v,kind).position=p;
  const result=buildStable4ActiveEntryOwners(v);assert.equal(result.complete,false);assert.equal(result.reason,"UNMODELED_ACTIVE_OWNER");
 }
});
test("strict active numeric values cannot be strings, boolean or nonfinite",()=>{
 for(const bad of ["0.25",true,null,NaN,Infinity,0,-1]){const v=fixture();bind(v,"Q102").quantity=bad;assert.throws(()=>buildStable4ActiveEntryOwners(v));}
});
test("nested and central immutable records must match all fields and native identity",()=>{
 for(const field of ["score","sourceSha","capturedAt","modelVersion","symbol","side","positionId","entryTs"]){
  const v=fixture(),p=bind(v,"HYPE_LONG");p.entryOpportunity={...p.entryOpportunity,[field]:field==="score"?0.9:field==="capturedAt"?ENTRY+2:field==="entryTs"?ENTRY+1:field==="side"?"SHORT":field==="symbol"?"ZECUSDT":field==="sourceSha"?"c".repeat(40):"changed"};
  assert.throws(()=>buildStable4ActiveEntryOwners(v));
 }
 const v=fixture();bind(v,"FET");v.book.records=[];assert.throws(()=>buildStable4ActiveEntryOwners(v));
});
test("logical entry times bind exactly where native semantics are logical and never exceed fill-observation time",()=>{
 for(const kind of ["PENGU","FET","HYPE_LONG","IDLE","Q102","V52"] as V4PeerKind[]){
  const v=fixture(),p=bind(v,kind);
  if(kind==="V52")p.openedAt=ENTRY-1;else p.entryTs=ENTRY-1;
  assert.throws(()=>buildStable4ActiveEntryOwners(v));
 }
});
test("input snapshots remain untouched and output cannot mutate nested owner state",()=>{
 const v=fixture();bind(v,"FET");const before=structuredClone(v),result=buildStable4ActiveEntryOwners(v);
 assert.deepEqual(v,before);result.positions[0].quantity=999;assert.equal(peer(v,"FET").position.quantity,0.25);
});
