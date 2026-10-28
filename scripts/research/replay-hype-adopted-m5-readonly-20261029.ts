/** Pure replay only. No Aster credentials, network, executor or order mutations. */
import { readFileSync } from "node:fs";
import {
  advanceHypeAdoptedM5Exit, evaluateHypeAdoptedM5Entry,
  type CompletedHypeM5,type HypeAdoptedProfitState,
} from "../../lib/hype-trend-adopted-overlay";

type Input={
 decisionTs:number;
 btcM5:CompletedHypeM5[];
 hypeM5:CompletedHypeM5[];
 ownedPosition?:{entryTs:number;entryPrice:number;initialState?:HypeAdoptedProfitState};
};
function main(){
 if(process.argv.length!==3)throw Error("USAGE: tsx scripts/research/replay-hype-adopted-m5-readonly-20261029.ts <snapshot.json>");
 const data:Input=JSON.parse(readFileSync(process.argv[2],"utf8"));
 if(!Array.isArray(data.btcM5)||!Array.isArray(data.hypeM5))throw Error("M5_SOURCE_REQUIRED");
 const admission=evaluateHypeAdoptedM5Entry({btc:data.btcM5,hype:data.hypeM5,decisionTs:data.decisionTs});
 const result:any={
  schema:"disdex-hype-20261022-adopted-m5-causal-replay/v1",
  sourceOnly:true,venueConnected:false,ordersSent:0,cancelsSent:0,
  liveActivationAllowed:false,
  model:"LEGACY_HYPE75_NOT_LIVE_TREND",
  decisionTs:data.decisionTs,admission,
 };
 if(data.ownedPosition){
  let state:HypeAdoptedProfitState=data.ownedPosition.initialState??{maxFavorablePct:0,profitArmReached:false};
  const trace=[];
  let last=Number.NEGATIVE_INFINITY;
  for(const bar of data.hypeM5){
   if(bar.openTime<data.ownedPosition.entryTs||bar.openTime+300000>data.decisionTs)continue;
   const evalResult=advanceHypeAdoptedM5Exit({entryTs:data.ownedPosition.entryTs,
    entryPrice:data.ownedPosition.entryPrice,now:bar.openTime+300000,bar,state});
   if(!evalResult.accepted)throw Error("INCOMPLETE_M5_EXIT_REPLAY:"+evalResult.reason);
   if(bar.openTime<=last)throw Error("OUT_OF_ORDER_M5_REPLAY");
   state=evalResult.state;last=bar.openTime;
   trace.push({completedAt:bar.openTime+300000,exit:evalResult.exit,reason:evalResult.reason});
   if(evalResult.exit)break;
  }
  result.firstExit=trace.find(x=>x.exit)??null;
  result.completedBars=trace.length;
  result.finalState=state;
 }
 console.log(JSON.stringify(result));
}
main();
