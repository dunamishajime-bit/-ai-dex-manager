/** Standalone leg journal price/Exit replay, without integrated admission or venue claims. */
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {computeProductionH1Features,type FeatureBar} from "../lib/v12-v4-production-features";
import {createProductionState,planProductionEntry,applyProductionEvent,productionExitSpec,type Event} from "../lib/v12-v4-production-lifecycle";
async function main(){
const [dataRoot,sourcePath,expectedPath,adapterProof,outputPath]=process.argv.slice(2);
if(!outputPath)throw Error("USAGE DATA SOURCE EXPECTED ADAPTER_PROOF OUTPUT");
const load=(p:string)=>readFileSync(p,"utf8").split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
const expected=load(expectedPath),sources=load(sourcePath),proof=JSON.parse(readFileSync(adapterProof,"utf8"));
if(proof.status!=="PASS_NATIVE_ROUTE_ENTRY_REPLAY")throw Error("ENTRY_REPLAY_NOT_CERTIFIED");
const bars:Record<string,Map<number,FeatureBar>>={};
for(const symbol of new Set(["BTCUSDT",...expected.map(r=>r.symbol)])){
 bars[symbol]=new Map(load(join(dataRoot,symbol+".jsonl")).map(x=>[Number(x.event_time_ms),{
  openTs:Number(x.event_time_ms),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),quoteVolume:Number(x.quote_volume)}]));
}
const key=(x:any)=>x.route+"|"+x.symbol+"|"+(x.eligibleEntryTs??x.entry_ts_ms)+"|"+(x.effectiveSide??x.side);
const candidates=new Map(proof.actual.map((x:any)=>[key(x),x]));
const sourceAtr=new Map(sources.map(x=>[x.symbol+"|"+x.entry_ts_ms,x.atr]));
const normalizer:any={normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p,stepSize:1e-12})};
const canonicalReason=(reason:string)=>{
 if(/^TIME_\d+H$/.test(reason)||reason==="TIME_EXIT")return "TIME";
 if(reason==="TP_SL_STOP")return "STOP";
 if(reason==="TP_SL_TP"||reason==="TAKE_PROFIT")return "TP";
 return reason;
};
const matches:any[]=[],mismatches:any[]=[],errors:any[]=[];const H=3600000;
for(const row of expected){
 try{
  const c:any=candidates.get(key(row)),entryBar=bars[row.symbol].get(row.entry_ts_ms)!;
  const spec=productionExitSpec(row.route),entry=entryBar.open;
  const atr=spec.kind==="NATIVE"?sourceAtr.get(row.symbol+"|"+c.sourceSignalTs):
   spec.kind==="ATR"?computeProductionH1Features(row.symbol,row.side,row.entry_ts_ms,row.entry_ts_ms,
    [...bars[row.symbol].values()],[...bars.BTCUSDT.values()]).atr14:undefined;
  let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
  const reserve=await planProductionEntry(state,{candidate:c,ts:row.entry_ts_ms,eventId:"reserve",referencePrice:entry,
   minimumOrderNotionalUsd:5,quantityNormalizer:normalizer,entryAtr:atr,nativeExitEvidence:"WR60_BASELINE_1978_PARITY"});
  state=applyProductionEvent(state,reserve);const id=reserve.leg.id,q=reserve.leg.requestedQty;
  state=applyProductionEvent(state,{type:"ENTRY_FILL",eventId:"entry-fill",ts:row.entry_ts_ms,id,qty:q,price:entry,feeUsd:0});
  state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",eventId:"entry-done",ts:row.entry_ts_ms,id});
  for(let t=row.entry_ts_ms;t<row.entry_ts_ms+spec.hours*H;t+=H){
   const bar=bars[row.symbol].get(t)!,next=bars[row.symbol].get(t+H);
   state=applyProductionEvent(state,{type:"EXIT_BAR",eventId:"bar-"+t,ts:t+H,id,bar,
    nextOpen:next?{ts:t+H,price:next.open}:undefined});
   if(state.legs[id].plannedExit)break;
  }
  const got=state.legs[id].plannedExit;
  if(!got||got.exitTs!==row.exit_ts_ms||Math.abs(got.price-row.exit_price)>1e-10||Math.abs(entry-row.entry_price)>1e-10||canonicalReason(got.reason)!==canonicalReason(row.exit_reason??row.reason))
   mismatches.push({key:key(row),entry,expectedEntry:row.entry_price,got,expectedExitTs:row.exit_ts_ms,expectedExitPrice:row.exit_price,expectedReason:row.exit_reason});
  else matches.push({key:key(row),...got,sourceReason:row.exit_reason??row.reason});
 }catch(error){errors.push({key:key(row),error:String(error)});}
}
const report={status:mismatches.length||errors.length?"BLOCKED_NATIVE_ROUTE_EXIT_REPLAY":"PASS_NATIVE_ROUTE_EXIT_REPLAY",
 expected:expected.length,matching:matches.length,mismatches,errors,matches,
 inputSha256:Object.fromEntries([sourcePath,expectedPath,adapterProof].map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")])),
 limitations:["Standalone explicit historical H1 price/fill fixture journals; no all8 portfolio admission or venue fills.",
 "Entry/Exit timestamp, price and canonical reason match; source reason vocabulary is retained.",
 "Fractional fixture quantities are not a venue lot-size certification."],orderEnabled:false,tradingMutation:0};
writeFileSync(outputPath,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({status:report.status,expected:expected.length,matching:matches.length,mismatches:mismatches.slice(0,5),errors:errors.slice(0,5)}));
if(report.status!=="PASS_NATIVE_ROUTE_EXIT_REPLAY")process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
