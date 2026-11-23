import test from "node:test";
import assert from "node:assert/strict";
import {buildV4AccountMark} from "../lib/v12-v4-account-inventory";
import {createProductionState,applyProductionEvent,productionGross} from "../lib/v12-v4-production-lifecycle";
import {emptyPendingExposureRegistry} from "../lib/disdex-pending-exposure-registry";
const SHA="b".repeat(40),NOW=Date.now();
function setup(){
 const rows:any[]=[
 ["V12",{schema:"v12-x1-all-runner-state/v2",strategyId:"V12_X1.00_ALL",mode:"LIVE",runtimeCommitSha:SHA,activePositions:[{symbol:"BTCUSDT",side:"LONG",quantity:.001}]}],
 ["PENGU",{version:2,strategyId:"PENGU_DUAL_LS_V2_FINAL",mode:"LIVE",position:{side:-1,quantity:7718}}],
 ["Q102",{version:1,strategyId:"QUALITY102_CAUSAL_V1",mode:"LIVE",runtimeCommitSha:SHA,position:{symbol:"SUIUSDT",side:-1,quantity:100}}],
 ["V52",{schemaVersion:3,strategyId:"DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",positions:{V50:{symbol:"TSLA",asterOpenSide:"BUY",asterQty:.38}}}],
 ["HYPE_LONG",{schema:"disdex-hype-zec-long/v1",mode:"LIVE",runtimeCommitSha:SHA,positions:[{strategy:"HYPE_LONG",symbol:"HYPEUSDT",side:"LONG",quantity:2}]}],
 ["FET",{schema:"fet-brk48-residual-state/v1",strategyId:"FET_BRK48_RESIDUAL",runtimeCommitSha:SHA,position:{symbol:"FETUSDT",side:1,quantity:3}}],
 ["IDLE",{schema:"disdex-idle-priority-state/v2",runtimeSha:SHA,positions:[{symbol:"LINKUSDT",side:"SHORT",quantity:10}]}],
 ["RESIDUAL",{schema:"disdex-idle-residual-long-state/v1",runtimeSha:SHA,position:{symbol:"DOGEUSDT",side:"LONG",quantity:20}}]
 ];
 const sources=rows.map(([kind,raw])=>({kind,programSha:SHA,raw:{...raw,updatedAt:NOW}}));
 const positions=[["BTCUSDT",.001,50000],["PENGUUSDT",-7718,.01],["SUIUSDT",-100,.2],["TSLAUSDT",.38,100],["HYPEUSDT",2,50],["FETUSDT",3,2],["LINKUSDT",-10,1],["DOGEUSDT",20,.1]].map(([symbol,quantity,markPrice])=>({symbol,quantity,markPrice,positionSide:"BOTH"}));
 const state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 return {sources,positions,state,registry:emptyPendingExposureRegistry(NOW)};
}
const run=(x:ReturnType<typeof setup>)=>buildV4AccountMark({sources:x.sources,venue:{capturedAt:NOW,equityUsd:1000,positions:x.positions},registry:x.registry,state:x.state,expectedPeerSha:SHA,now:NOW,eventId:"account"} as any);
test("all eight actual state formats reconcile signed quantities before gross calculation",()=>{
 const x=setup(),out=run(x),state=applyProductionEvent(x.state,out.event);
 assert.equal(out.peerSystems,8);assert.equal(out.orderEnabled,false);
 const g=productionGross(state);
 assert.ok(Math.abs(g.total-.30318)<1e-10);assert.ok(Math.abs(g.crypto-.26518)<1e-10);
});
test("missing source or wrong program lineage cannot silently become a flat sleeve",()=>{
 const x=setup();x.sources.pop();assert.throws(()=>run(x),/ALL_EIGHT_PEER_SOURCES_REQUIRED/);
 const y=setup();y.sources[1].programSha="c".repeat(40);assert.throws(()=>run(y),/PEER_PROGRAM_LINEAGE_MISMATCH/);
});
test("different logic owners of the same net symbol cause an explicit ownership conflict",()=>{
 const x=setup();x.sources[2].raw.position={symbol:"PENGUUSDT",side:-1,quantity:1};
 assert.throws(()=>run(x),/MULTIPLE_POSITION_OWNERS/);
});
test("exchange quantity mismatch never deletes or rescales a peer position",()=>{
 const x=setup();x.positions.find(p=>p.symbol==="TSLAUSDT")!.quantity=.39;
 const before=structuredClone(x.sources);assert.throws(()=>run(x),/VENUE_OWNED_QUANTITY_MISMATCH/);
 assert.deepEqual(x.sources,before);
});
test("unfilled peer reservations count once at current equity without needing a position quote",()=>{
 const x=setup();x.registry.entries.push({reservationId:"q-res",strategyId:"QUALITY102_CAUSAL_V1",sleeve:"CRYPTO",symbol:"XRPUSDT",side:"SHORT",gross:.5,notionalUsd:500,status:"PENDING",createdAt:NOW,updatedAt:NOW});
 const out=run(x),state=applyProductionEvent(x.state,out.event);
 assert.ok(Math.abs(productionGross(state).total-.80318)<1e-10);
 assert.equal(state.foreign.find(p=>p.symbol==="XRPUSDT")!.qty,0);
});
