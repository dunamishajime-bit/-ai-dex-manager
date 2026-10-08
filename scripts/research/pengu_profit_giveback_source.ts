/**
 * Research only. Frozen production pure evaluators; no venue/API/order imports.
 * Eligible entries are exported before portfolio admission so earlier exits may admit later signals.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import assert from "node:assert/strict";
import {buildPenguDualLsV2EvaluationSeries,isPenguV8V64DynamicLongSignal,evaluatePenguDualLsV2PositionBar,buildPenguDualLsV2Signal} from "../../lib/pengu-dual-ls-v2";
import {createPenguShortV20State} from "../../lib/pengu-short-v20";
import {evaluateRecoveryV8Entry,evaluateRecoveryV8PositionBar} from "../../lib/pengu-recovery-v8";
const H=3600000, START=Date.parse("2025-08-10T00:00:00Z"),END=Date.parse("2026-08-10T00:00:00Z");
const DATA=process.env.PENGU_BT_DATA!;
const OUT=process.env.PENGU_BT_OUT!;
function read(rel:string):any[]{return fs.readFileSync(path.join(DATA,rel),"utf8").trim().split(/\r?\n/).map(JSON.parse);}
function candles(symbol:string){return read("normalized/aster/klines/"+symbol+".jsonl").filter(x=>x.event_time_ms<END+H).map(x=>({openTime:x.event_time_ms,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.base_volume,closeTime:x.close_time_ms}));}
const pengu=candles("PENGUUSDT"),pm=new Map(pengu.map(x=>[x.openTime,x])),btc=candles("BTCUSDT").filter(x=>pm.has(x.openTime));
assert.equal(btc.length,pengu.length);
for(let t=START;t<END;t+=H)assert(pm.has(t),"Market gap "+t);
const history={pengu1h:pengu,btc1h:btc,penguFunding:[]};
const rows=buildPenguDualLsV2EvaluationSeries(history,END+2*H);
const policies=["BASELINE","SHORT_PRICE_TRAIL4_FROM_PROFIT","SHORT_PEAK_PROFIT_MINUS4PP","SHORT_PEAK_PROFIT_GIVEBACK4PCT","ALL_PEAK_PROFIT_MINUS4PP"];
const fills=["H1_TRIGGER_PRICE","H1_NEXT_OPEN"];
const output:any={schema:"pengu-profit-giveback/v1",start:START,end:END,policies,fills,candidates:{},entryChecks:0,marketRows:pengu.length};
function entry(i:number){
 const r=rows[i];if(!r.features)return undefined;
 const long=isPenguV8V64DynamicLongSignal(rows,i);
 const recovery=r.recoveryV8?{...r.recoveryV8,ordinaryLongEligible:long,baseLongSignal:long}:undefined;
 if(r.shortSignal)return {side:-1,version:"SHORT_V20"};
 if(long)return {side:1,version:"LONG_V2_FINAL"};
 if(recovery&&evaluateRecoveryV8Entry(recovery).kind==="RECOVERY_V8")return {side:1,version:"RECOVERY_V8"};
}
function lifecycle(i:number,policy:string,fill:string):any{
 const e=entry(i)!,bar=rows[i+1].candle,ep=bar.open,et=bar.openTime;
 let p:any={side:e.side,entryTs:et,entryPrice:ep,quantity:1,gross:1,highWaterMark:ep,lowWaterMark:ep,entryVersion:e.version};
 if(e.side<0)p.shortV20=createPenguShortV20State({entryPrice:ep,requestedGross:1,entryAtr24Ratio:rows[i].features!.atr24Ratio,btcEma168Distance:rows[i].features!.btcEma168Distance,btcReturn24h:rows[i].features!.btcReturn24h});
 if(e.version==="RECOVERY_V8")p.recoveryV8={side:1,entryTs:et,entryPrice:ep,quantity:1,originalGross:1,remainingGross:1,partialDefenseTriggered:false,highWaterMark:ep,version:"RECOVERY_V8",originalQuantity:1,protectionLifecycle:"FULL_HARD_STOP"};
 let partial:any=null,ambiguous=null,mfe=0,mae=0,best=ep;
 const affected=policy!=="BASELINE"&&(e.side<0||policy.startsWith("ALL_"));
 for(let j=i+1;j<rows.length;j++){
  const r=rows[j],f=r.features!;if(!f)throw Error("FEATURE_GAP");
  if(r.candle.openTime>=END)break;
  const priorBest=best;
  let reason:string|undefined,price:number|undefined,updated:any;
  if(e.version==="RECOVERY_V8"){
   const rr={...r.recoveryV8!,ordinaryLongEligible:isPenguV8V64DynamicLongSignal(rows,j),baseLongSignal:isPenguV8V64DynamicLongSignal(rows,j)};
   const ev=evaluateRecoveryV8PositionBar(p.recoveryV8,rr);
   updated={...p,quantity:ev.updatedPosition.quantity,recoveryV8:{...p.recoveryV8,...ev.updatedPosition}};
   if(ev.partialQuantity&&!partial)partial={ts:f.referenceTs+H,price:Math.min(r.candle.open,ev.triggerPrice!),quantityFraction:ev.partialQuantity};
   if(!["NONE","PARTIAL_DEFENSE"].includes(ev.kind)){reason="RECOVERY_V8_"+ev.kind;price=ev.stopPrice;}
  } else{
   const ev=evaluatePenguDualLsV2PositionBar(p,f);updated=ev.updatedPosition;reason=ev.exit?.reason;price=ev.exit?.stopPrice;
  }
  const hard=reason?.includes("HARD_STOP");
  if(affected&&!hard){
   // Replace only baseline trailing; all time, thesis-failure, partial-defense exits remain.
   if(reason?.includes("TRAILING_STOP")){reason=undefined;price=undefined;}
   const maxProfit=e.side<0?(ep-priorBest)/ep:(priorBest-ep)/ep;
   if(maxProfit>0){
    const threshold=policy.includes("PRICE_TRAIL")?priorBest*1.04:
      policy.includes("GIVEBACK4PCT")?priorBest+e.side*(-1)*maxProfit*ep*.04:
      priorBest+e.side*(-1)*ep*.04;
    const hit=e.side<0?f.high>=threshold:f.low<=threshold;
    if(hit){reason="PEAK_PROFIT_EXIT";price=threshold;}
   }
  }
  best=e.side<0?Math.min(best,f.low):Math.max(best,f.high);
  mfe=Math.max(mfe,e.side<0?(ep-f.low)/ep:(f.high-ep)/ep);
  mae=Math.min(mae,e.side<0?(ep-f.high)/ep:(f.low-ep)/ep);
  if(reason){
   let xt=f.referenceTs+H;
   let xp=price??f.close;
   // Historical trigger-price diagnostic keeps explicit V20 open-reference timestamps.
   if(fill==="H1_TRIGGER_PRICE"&&reason.startsWith("SHORT_V20_")){xt=f.referenceTs;xp=price??f.open;}
   if(hard){xp=e.side<0?Math.max(xp,r.candle.open):Math.min(xp,r.candle.open);}
   else if(fill==="H1_NEXT_OPEN"){xp=rows[j+1]?.candle.open??f.close;}
   else if(price!==undefined){xp=e.side<0?Math.max(price,r.candle.open):Math.min(price,r.candle.open);}
   if(xt>END){xt=END;xp=pm.get(END)?.open??r.candle.close;reason="PERIOD_END";}
   return {strategy_id:"PENGU",symbol:"PENGUUSDT",side:e.side<0?"SHORT":"LONG",route:e.version,entry_version:e.version,entry_ts_ms:et,entry_price:ep,signal_ts_ms:rows[i].candle.openTime,exit_ts_ms:xt,exit_price:xp,exit_reason:reason,requested_gross:1,status:"MODELED_CLOSED_TRADE",partial,hard_stop_exit:!!hard,unit_price_return:e.side*(xp/ep-1),mfe,mae,ambiguous_bar:ambiguous,source_runtime_sha:"ce1edeead8d0f9e5d88e829d415057117502a335"};
  }
  p={...updated,highWaterMark:e.side>0?Math.max(p.highWaterMark,f.high):p.highWaterMark,lowWaterMark:e.side<0?Math.min(p.lowWaterMark,f.low):p.lowWaterMark};
  if(p.recoveryV8)p.recoveryV8.highWaterMark=Math.max(p.recoveryV8.highWaterMark,f.high);
 }
 return {strategy_id:"PENGU",symbol:"PENGUUSDT",side:e.side<0?"SHORT":"LONG",route:e.version,entry_version:e.version,entry_ts_ms:et,entry_price:ep,signal_ts_ms:rows[i].candle.openTime,exit_ts_ms:END,exit_price:pm.get(END)?.open??rows.at(-1)!.candle.close,exit_reason:"PERIOD_END",requested_gross:1,status:"MODELED_CLOSED_TRADE",partial,hard_stop_exit:false,mfe,mae,source_runtime_sha:"ce1edeead8d0f9e5d88e829d415057117502a335"};
}
const eligible:number[]=[];
for(let i=0;i<rows.length-1;i++){
 const t=rows[i+1].candle.openTime;if(t<START||t>=END)continue;
 const e=entry(i);if(e)eligible.push(i);
}
for(const i of eligible.filter((_,k)=>k%20===0)){
 const s=buildPenguDualLsV2Signal(history,undefined,rows[i].candle.openTime+H,0,{recoveryV8Enabled:true,v64DynamicLongEnabled:true});
 assert.equal(s.side,entry(i)!.side);assert.equal(s.entryVersion,entry(i)!.version);output.entryChecks++;
}
fs.mkdirSync(OUT,{recursive:true});
for(const fill of fills)for(const policy of policies){
 const cs=eligible.map(i=>lifecycle(i,policy,fill));
 for(const c of cs){assert(c.exit_ts_ms>c.entry_ts_ms);assert(c.exit_price>0);assert(c.entry_price>0);assert(c.exit_ts_ms<=END);}
 const name=fill+"__"+policy;
 fs.writeFileSync(path.join(OUT,name+".jsonl.gz"),zlib.gzipSync(cs.map(c=>JSON.stringify(c)).join("\n")+"\n"));
 output.candidates[name]=cs.length;console.log(name,cs.length);
}
fs.writeFileSync(path.join(OUT,"source-generation.json"),JSON.stringify(output,null,2));
console.log("SOURCE_GENERATION_PASS",output.entryChecks);
