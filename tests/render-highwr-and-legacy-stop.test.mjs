import assert from "node:assert/strict";
import test from "node:test";
import {
  RENDER_ENTRY_POLICY,RENDER_INDEPENDENT_ROUTE,RENDER_M5_MS,RENDER_H1_MS,
  evaluateRenderIndependentGate,evaluateIndependentPriority,settleSixHourShadow,
  startLegacyRenderAdverse,advanceLegacyRenderAdverse,independentProtectiveLevels
} from "../lib/render-highwr-and-legacy-stop.ts";
const M=RENDER_M5_MS,H=RENDER_H1_MS;
const at=Date.UTC(2026,9,25,0,0,0);
function series(extra=[]){
  const btc=[],render=[];
  for(let i=-576;i<0;i++){
    const ts=at+i*M;
    const last=i>=-12;
    const n=i+576;
    let rOpen,rClose,bOpen,bClose;
    if(last) {
      const j=i+12;
      rOpen=100.3-j*.06;
      rClose=rOpen-.06;
      bOpen=100+j*.026;
      bClose=bOpen+.026;
    } else {
      rOpen=102-n*.003;
      rClose=rOpen-.003;
      bOpen=100;
      bClose=100;
    }
    render.push({ts,open:rOpen,high:rOpen+(last&&i===-12?.6:.015),
      low:rClose-.01,close:rClose,baseVolume:10,takerBuyBaseVolume:4.4});
    btc.push({ts,open:bOpen,high:bClose+.01,low:bOpen-.01,close:bClose,
      baseVolume:10,takerBuyBaseVolume:4.4});
  }
  return {btcM5:[...btc,...extra],renderM5:render,decisionTs:at};
}
function goodGate(){const z=evaluateRenderIndependentGate(series());assert.equal(z.accepted,true,z.reason);return z;}
function hist(signalTs,net30Pct){
  return {route:RENDER_INDEPENDENT_ROUTE,signalTs,exitTs:signalTs+2*M,settledAt:signalTs+3*M,
    entryPrice:100,exitPrice:100*(1-(net30Pct+.30)/100),net30Pct,result:"TAKE"};
}
function qualityHistory(n=26){
  return Array.from({length:n},(_,i)=>hist(at-(n-i+1)*7*24*H,i%8===0?-2.3:1.2));
}
function rank(input={}){return evaluateIndependentPriority({
  decisionTs:at,gate:goodGate(),fullySettledSixHourShadows:qualityHistory(),
  sameSymbolPositionOrPending:false,cooldownUntil:0,...input});}
function m5(ts,{open=100,high=100.1,low=99.9,close=100,baseVolume=10,takerBuyBaseVolume=4.4}={}){
  return {ts,open,high,low,close,baseVolume,takerBuyBaseVolume};
}

test("independent gate is true as-of closed M5 with BTC up/RENDER down, H4, seller, wick, no OI",()=>{
  const got=goodGate(),f=got.features;
  assert.ok(f.btcH1Pct>=.15);
  assert.ok(f.renderH1Pct<=-.5);
  assert.ok(f.renderCompletedH4Pct<=-.15);
  assert.ok(f.sellerShare>=.53);
  assert.ok(f.upperWickPctOfOpen>=.35);
  assert.equal(RENDER_ENTRY_POLICY.upperWickHeightAsPercentOfH1OpenMin,.35);
  assert.equal("openInterest" in f,false);
});
test("future/forming M5 candle is ignored; no look-ahead",()=>{
  const x=series([{ts:at,open:100000,high:100000,low:100000,close:100000,baseVolume:1,takerBuyBaseVolume:0}]);
  assert.equal(evaluateRenderIndependentGate(x).accepted,true);
});
test("missing completed M5 or missing volume fails closed",()=>{
  const x=series();x.renderM5.splice(-3,1);
  assert.equal(evaluateRenderIndependentGate(x).accepted,false);
  const y=series();y.renderM5[y.renderM5.length-1]={...y.renderM5.at(-1),takerBuyBaseVolume:undefined};
  assert.equal(evaluateRenderIndependentGate(y).accepted,false);
});
test("duplicate completed bar fails closed",()=>{
  const x=series();x.renderM5.push({...x.renderM5[20]});
  assert.equal(evaluateRenderIndependentGate(x).accepted,false);
});
test("no entry when quality history too short",()=>{
  const z=rank({fullySettledSixHourShadows:qualityHistory(3)});
  assert.equal(z.accepted,false);
  assert.match(z.reason,/QUALITY_NOT_MET/);
});
test("no-shadow-quality mode admits raw signal without 24 historical samples",()=>{
  const x=rank({requireShadowQuality:false,fullySettledSixHourShadows:[]});
  assert.equal(x.accepted,true,x.reason);
  assert.equal(x.qualityLifetime.n,0);
  assert.equal(x.chosenRoute,RENDER_INDEPENDENT_ROUTE);
  const guarded=rank({requireShadowQuality:true,fullySettledSixHourShadows:[]});
  assert.equal(guarded.accepted,false);
});
test("no-shadow-quality cannot bypass same-symbol owner, incumbent score, cooldown, raw gate",()=>{
  assert.match(rank({requireShadowQuality:false,fullySettledSixHourShadows:[],sameSymbolPositionOrPending:true}).reason,/SYMBOL_OWNED/);
  assert.match(rank({requireShadowQuality:false,fullySettledSixHourShadows:[],cooldownUntil:at+H}).reason,/COOLDOWN/);
  assert.equal(rank({requireShadowQuality:false,fullySettledSixHourShadows:[],incumbent:{route:"LEGACY_RENDER"}}).accepted,false);
  assert.equal(rank({requireShadowQuality:false,fullySettledSixHourShadows:[],gate:{accepted:false,reason:"RAW_REJECT"}}).accepted,false);
});
test("quality history cannot use future shadow outcomes",()=>{
  const before=rank();
  const after=rank({fullySettledSixHourShadows:[...qualityHistory(),
    hist(at+H,100)]});
  assert.equal(before.accepted,after.accepted);
  assert.equal(before.qualityLifetime.n,after.qualityLifetime.n);
});
test("closed shadow with correct strong history admits OI-free signal",()=>{
  const z=rank();
  assert.equal(z.accepted,true,z.reason);
  assert.ok(z.qualityLifetime.n>=24);
  assert.ok(z.qualityLifetime.winRate>=.75);
  assert.equal(z.chosenRoute,RENDER_INDEPENDENT_ROUTE);
});
test("same symbol and cooldown always reject independent",()=>{
  assert.match(rank({sameSymbolPositionOrPending:true}).reason,/SYMBOL_OWNED/);
  assert.match(rank({cooldownUntil:at+H}).reason,/COOLDOWN/);
});
test("incumbent wins if score unavailable or better; only strong independent can preempt",()=>{
  assert.equal(rank({incumbent:{route:"EXISTING_RENDER",score:undefined}}).accepted,false);
  assert.equal(rank({incumbent:{route:"EXISTING_RENDER",score:120}}).chosenRoute,"EXISTING_RENDER");
  assert.equal(rank({incumbent:{route:"EXISTING_RENDER",score:10}}).accepted,true);
});
test("duplicated shadow outcome ledger fails closed",()=>{
  const h=qualityHistory();
  assert.match(rank({fullySettledSixHourShadows:[...h,h[0]]}).reason,/DUPLICATE/);
});
test("6h shadow has resident STOP priority, 30bps and is independent of real 6h",()=>{
  const t=at,bars=Array.from({length:73},(_,i)=>m5(t+i*M));
  bars[6]=m5(t+6*M,{open:100,high:103,low:98.4,close:99.5});
  assert.equal(settleSixHourShadow({signalTs:t,asOfTs:t+6*M,renderM5:bars}),null);
  const r=settleSixHourShadow({signalTs:t,asOfTs:t+7*M,renderM5:bars});
  assert.equal(r.result,"STOP");
  assert.ok(r.net30Pct<=-2.299);
  assert.equal(r.settledAt,t+7*M);
});
test("without target/stop shadow closes at 6h expiry open after expiry M5 complete",()=>{
  const t=at,bars=Array.from({length:73},(_,i)=>m5(t+i*M));
  assert.equal(settleSixHourShadow({signalTs:t,asOfTs:t+72*M,renderM5:bars}),null);
  const r=settleSixHourShadow({signalTs:t,asOfTs:t+73*M,renderM5:bars});
  assert.equal(r.result,"TIME");
  assert.equal(r.exitTs,t+6*H);
  assert.equal(r.settledAt,t+6*H+M);
});
test("new independent REAL hold 6h, TP2.5%, hard STOP2%, nominal .75 gross",()=>{
  const p=independentProtectiveLevels(100,at);
  assert.ok(Math.abs(p.stopLossPrice-102)<1e-8);
  assert.ok(Math.abs(p.takeProfitPrice-97.5)<1e-8);
  assert.equal(p.maxHoldExitTs,at+360*60_000);
  assert.equal(p.requestedGross,.75);
});
test("original RENDER: -1% confirmed close touch, after 2h still <=-1% and MFE<.25 triggers",()=>{
  let state=startLegacyRenderAdverse({originalRoute:"IDLE_RENDER_RELATIVE_SHORT",entryTs:at,entryPrice:100});
  for(let i=0;i<=24;i++){
    const out=advanceLegacyRenderAdverse(state,m5(at+i*M,{open:101.05,high:101.3,low:99.9,close:101.05}));
    state=out.state;
    if(i===24)assert.equal(out.requestProtectedReduceOnlyClose,true,out.reason);
    else assert.equal(out.requestProtectedReduceOnlyClose,false);
  }
  assert.equal(state.completed,true);
});
test("legacy STOP does not cut winners after favorable MFE +.25 and remains original route scoped",()=>{
  let state=startLegacyRenderAdverse({originalRoute:"IDLE_RENDER_RELATIVE_SHORT",entryTs:at,entryPrice:100});
  for(let i=0;i<=24;i++){
    const out=advanceLegacyRenderAdverse(state,m5(at+i*M,{open:101.05,high:101.3,low:i===2?99.5:99.9,close:101.05}));
    state=out.state;
    assert.equal(out.requestProtectedReduceOnlyClose,false);
  }
  assert.ok(state.maxFavorableExcursionPct>=.25);
  assert.throws(()=>startLegacyRenderAdverse({originalRoute:RENDER_INDEPENDENT_ROUTE,entryTs:at,entryPrice:100}));
});
test("at 2h check recovered: reset first -1% touch and restart subsequent 2h clock",()=>{
  let state=startLegacyRenderAdverse({originalRoute:"IDLE_RENDER_RELATIVE_SHORT",entryTs:at,entryPrice:100});
  for(let i=0;i<=24;i++){
    const out=advanceLegacyRenderAdverse(state,m5(at+i*M,{open:101.0,high:101.3,low:99.9,close:i===24?100.1:101.05}));
    state=out.state;
    assert.equal(out.requestProtectedReduceOnlyClose,false);
  }
  assert.equal(state.watchStartedAt,null);
  const again=advanceLegacyRenderAdverse(state,m5(at+25*M,{open:101.1,high:101.3,low:99.9,close:101.05}));
  assert.equal(again.state.watchStartedAt,at+26*M);
});
test("missing/duplicate intermediate M5 cannot request premature legacy early close",()=>{
  const state=startLegacyRenderAdverse({originalRoute:"IDLE_RENDER_RELATIVE_SHORT",entryTs:at,entryPrice:100});
  assert.throws(()=>advanceLegacyRenderAdverse(state,m5(at+M)),/GAP/);
  const first=advanceLegacyRenderAdverse(state,m5(at));
  assert.throws(()=>advanceLegacyRenderAdverse(first.state,m5(at)),/GAP/);
});

import {decide} from "../scripts/render-highwr-shadow-review.mjs";
test("review CLI is always read-only even when candidate high-WR passes",()=>{
  const model=decide({...series(),
    fullySettledSixHourShadows:qualityHistory(),pendingSixHourShadowSignals:[],
    sameSymbolPositionOrPending:false,cooldownUntil:0});
  assert.equal(model.canSendOrders,false);
  assert.equal(model.priority.accepted,true);
  assert.equal(model.status,"MODEL_SIGNAL_PASS_NOT_VENUE_AUTHORIZED");
  assert.equal(model.entryModel.maxHoldMinutes,55);
});
test("review CLI fails closed if owner/pending state is absent",()=>{
  const model=decide({...series(),fullySettledSixHourShadows:qualityHistory()});
  assert.equal(model.canSendOrders,false);
  assert.equal(model.priority.accepted,false);
});
test("review CLI reports fail-closed on shadow-source gap",()=>{
  const model=decide({...series(),fullySettledSixHourShadows:qualityHistory(),
    pendingSixHourShadowSignals:[at-60*H],
    sameSymbolPositionOrPending:false,cooldownUntil:0});
  assert.equal(model.status,"REJECTED");
  assert.match(model.reason,/SHADOW_MARKET_GAP/);
});

test("BTC order flow is optional but RENDER taker-sell volume remains mandatory",()=>{
  const x=series();
  x.btcM5=x.btcM5.map(({baseVolume,takerBuyBaseVolume,...rest})=>rest);
  assert.equal(evaluateRenderIndependentGate(x).accepted,true);
  x.renderM5=x.renderM5.map(({baseVolume,takerBuyBaseVolume,...rest})=>rest);
  assert.equal(evaluateRenderIndependentGate(x).accepted,false);
});
