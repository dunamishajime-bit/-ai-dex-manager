import assert from "node:assert/strict";
import test from "node:test";
import {emptyIdleState,normalizeIdleState,IDLE_STATE_SCHEMA} from "../lib/idle-priority-short-state";
const sha="a".repeat(40);
const pos={
 symbol:"TAOUSDT",route:"IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2",side:"SHORT",
 signalTs:3_600_000,entryTs:7_200_000,exitTs:50_400_000,entryPrice:100,quantity:1,
 holdHours:12,gross:1,stopPrice:110,takeProfitPrice:75,
 stopClientOrderId:"idle-stop-x",takeProfitClientOrderId:"idle-tp-x",protectionVerified:true,
} as const;
test("empty v2 state is SHA-bound and safe",()=>{
 const s=emptyIdleState(sha,1);
 assert.equal(s.schema,IDLE_STATE_SCHEMA);assert.equal(s.runtimeSha,sha);assert.equal(s.manualReview,null);assert.deepEqual(s.positions,[]);
});
test("different runtime SHA fails closed",()=>assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),runtimeSha:"b".repeat(40)},sha),/RUNTIME_SHA_MISMATCH/));
test("legacy v1 state fails closed",()=>assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),schema:"disdex-idle-priority-state/v1"} as any,sha),/SCHEMA_MISMATCH/));
test("unknown symbol ownership is rejected",()=>assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),positions:[{...pos,symbol:"BTCUSDT"}]} as any,sha),/POSITION_INVALID/));
test("unverified protection is rejected",()=>assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),positions:[{...pos,protectionVerified:false}]} as any,sha),/POSITION_INVALID/));
test("wrong route or hold contract is rejected",()=>assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),positions:[{...pos,holdHours:24,exitTs:93_600_000}]} as any,sha),/POSITION_INVALID/));
test("valid protected position survives normalization",()=>assert.equal(normalizeIdleState({...emptyIdleState(sha),positions:[pos]},sha).positions[0].symbol,"TAOUSDT"));
test("DOT trailing protection may move below entry only after the trail is armed",()=>{
 const trailing={...pos,symbol:"DOTUSDT",route:"IDLE_DOT_MOMENTUM_SHORT_BTCREL",holdHours:24,exitTs:93_600_000,gross:0.25,stopPrice:98,trailingStopPrice:98,trailArmed:true,bestConfirmed5mGainPct:0.04,lastConfirmed5mTs:10_800_000};
 assert.equal(normalizeIdleState({...emptyIdleState(sha),positions:[trailing]},sha).positions[0].trailingStopPrice,98);
 assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),positions:[{...trailing,trailArmed:false}]} as any,sha),/POSITION_INVALID/);
});
test("pending entry is explicit and validated",()=>{
 const pending={action:"ENTRY",phase:"planned",symbol:"DOTUSDT",route:"IDLE_DOT_MOMENTUM_SHORT_BTCREL",clientOrderId:"idle-entry",idempotencyKey:"k",quantity:2,expectedPrice:10,signalTs:3_600_000,decisionTs:7_200_000,holdHours:24,createdAt:1,updatedAt:1,reason:"ENTRY"} as const;
 assert.equal(normalizeIdleState({...emptyIdleState(sha),pending},sha).pending?.symbol,"DOTUSDT");
});

test("legacy RENDER keeps SHA-bound adverse watch across state normalization",()=>{
 const adverse={originalRoute:"IDLE_RENDER_RELATIVE_SHORT",entryTs:7_200_000,entryPrice:100,
  lastClosedM5Ts:7_500_000,watchStartedAt:7_500_000,maxFavorableExcursionPct:0.1,completed:false};
 const legacy={...pos,symbol:"RENDERUSDT",route:"IDLE_RENDER_RELATIVE_SHORT",gross:.25,
  legacyRenderAdverse:adverse};
 const restored=normalizeIdleState({...emptyIdleState(sha),positions:[legacy]},sha);
 assert.deepEqual(restored.positions[0].legacyRenderAdverse,adverse);
 assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),positions:[{
   ...legacy,legacyRenderAdverse:{...adverse,originalRoute:"INDEPENDENT_BAD_ROUTE"}
 }]},sha),/IDLE_RENDER_ADVERSE_STATE_INVALID/);
});
test("independent bracket/6h state cannot inherit legacy emergency STOP or adverse watch",()=>{
 const route="IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT";
 const base={...pos,symbol:"RENDERUSDT",route,holdHours:6,
  exitTs:7_200_000+6*3_600_000,gross:.75,stopPrice:102,takeProfitPrice:97.5};
 assert.equal(normalizeIdleState({...emptyIdleState(sha),positions:[base]},sha).positions[0].route,route);
 assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),positions:[{...base,stopPrice:110}]},sha),
  /IDLE_RENDER_INDEPENDENT_BRACKET_INVALID/);
 assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),positions:[{...base,
   legacyRenderAdverse:{originalRoute:route,entryTs:7_200_000,entryPrice:100,lastClosedM5Ts:null,
    watchStartedAt:null,maxFavorableExcursionPct:0,completed:false}}]},sha),
  /IDLE_RENDER_ADVERSE_STATE_INVALID/);
});
