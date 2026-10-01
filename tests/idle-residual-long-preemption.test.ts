import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileIdleResidualLongStateStore, emptyIdleResidualLongState } from "../lib/idle-residual-long-state";
import { releaseIdleResidualLongForFormalEntry } from "../lib/idle-residual-long-preemption";
import type { DirectTradeExecutor, DirectPosition } from "../lib/direct-trade-executor";
import type { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";

const SHA="a".repeat(40);

function pos(): DirectPosition {
  return {
    symbol:"DOGEUSDT",
    positionSide:"BOTH",
    quantity:10,
    entryPrice:100,
    markPrice:101,
    notionalUsd:1010,
    unrealizedPnl:10,
    leverage:5,
    pnlPct:0,
    updatedAt:1_800_000_000_000,
  } as DirectPosition;
}

test("formal preemption closes residual LONG reduce-only before clearing durable state", async()=>{
  const root=await mkdtemp(join(tmpdir(),"idle-res-preempt-"));
  try{
    const statePath=join(root,"state.json");
    const store=new FileIdleResidualLongStateStore(statePath,SHA);
    const state=emptyIdleResidualLongState(SHA,1_800_000_000_000);
    state.position={
      symbol:"DOGEUSDT",route:"DOGE_REL_VOL",side:"LONG",
      signalTs:1_799_996_400_000,entryTs:1_800_000_000_000,exitTs:1_800_043_200_000,
      entryPrice:100,quantity:10,gross:1,stopPrice:90,takeProfitPrice:125,
      stopClientOrderId:"res-stop-doge",takeProfitClientOrderId:"res-tp-doge",protectionVerified:true,
    };
    await store.save(state);

    let positions:DirectPosition[]=[pos()];
    let marketCalls=0;
    const executor={
      getMarketQuote: async()=>({symbol:"DOGEUSDT",bidPrice:100,askPrice:100.1,bidQuantity:100,askQuantity:100,midPrice:100.05,spreadBps:10,updatedAt:1_800_000_000_000}),
      executeMarket: async(input:any)=>{
        marketCalls+=1;
        assert.equal(input.reduceOnly,true);
        assert.equal(input.side,"SELL");
        assert.equal(input.symbol,"DOGEUSDT");
        positions=[];
        return {status:"FILLED",executedQuantity:10,averagePrice:100,clientOrderId:input.clientOrderId,orderId:"1",symbol:"DOGEUSDT",side:"SELL",positionSide:"BOTH",reduceOnly:true,executionUnknown:false};
      },
      getPositions: async()=>positions,
    } as unknown as DirectTradeExecutor;
    const cancelled:string[]=[];
    const adapter={cancel:async(id:string)=>{cancelled.push(id);}} as unknown as V12AsterLiveAdapter;
    let documented=0;

    const result=await releaseIdleResidualLongForFormalEntry({
      executor,adapter,lock:{document:async()=>{documented+=1;return {} as any;}},
      positions:[pos()],causeIdempotencyKey:"V12|ENTRY",expectedRuntimeSha:SHA,
      statePath,enabled:true,maxSlippageBps:20,now:()=>1_800_003_600_000,
    });
    assert.equal(result.status,"reduced");
    assert.equal(marketCalls,1);
    assert.deepEqual(cancelled.sort(),["res-stop-doge","res-tp-doge"].sort());
    assert.equal(documented,1);
    const after=await store.load();
    assert.equal(after.position,null);
    assert.match(after.lastDecision?.reason||"",/^EXIT:FORMAL_PREEMPT:/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("disabled residual preemption never sends an order", async()=>{
  let marketCalls=0;
  const executor={executeMarket:async()=>{marketCalls+=1;throw new Error("should not send");}} as unknown as DirectTradeExecutor;
  const adapter={} as V12AsterLiveAdapter;
  const result=await releaseIdleResidualLongForFormalEntry({
    executor,adapter,lock:{document:async()=>({} as any)},positions:[],causeIdempotencyKey:"X",
    expectedRuntimeSha:SHA,enabled:false,
  });
  assert.equal(result.status,"not-needed");
  assert.equal(marketCalls,0);
});
