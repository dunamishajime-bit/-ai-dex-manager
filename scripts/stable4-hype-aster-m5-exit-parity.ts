import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {replayHypeModeledM5Exit} from "../lib/stable4-hype-offline-m5-exit";
const M=300000,H=3600000;
const [prefix,suffix,tapeFile,out]=process.argv.slice(2);
if(!prefix||!suffix||!tapeFile||!out)throw Error("USAGE prefix.gz suffix.gz tape.json output.json");
const sha=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
type Bar={ts:number;open:number;high:number;low:number;close:number;volume:number};
function load(p:string):Bar[]{
 return gunzipSync(readFileSync(p)).toString("utf8").split(/\r?\n/).filter(Boolean).map(line=>{
  const r=JSON.parse(line);
  return {ts:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])};
 });
}
const rows=[...load(prefix),...load(suffix)].sort((a,b)=>a.ts-b.ts),m=new Map<number,Bar>();
for(const b of rows){
 if(!(b.ts>0&&b.ts%M===0&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)))throw Error("INVALID_M5_SOURCE");
 const old=m.get(b.ts);if(old){
  if(Object.keys(b).some(k=>Math.abs((b as any)[k]-(old as any)[k])>1e-10))throw Error("DUPLICATE_M5_CONFLICT");
 }else m.set(b.ts,b);
}
const times=[...m.keys()].sort((a,b)=>a-b);
for(let i=1;i<times.length;i++)if(times[i]!==times[i-1]+M)throw Error("M5_GAP:"+times[i-1]);
type Event={entry_ts_ms:number;entry_price:number;exit_ts_ms:number;exit_price:number;exit_reason:string;pinned_exit_inputs:{effectiveStopPrice:number;effectiveTakeProfitPrice:number;exitModel:string}};
const tape=JSON.parse(readFileSync(tapeFile,"utf8")) as Event[];
const errorCounts:Record<string,number>={},examples:any[]=[];let matched=0,stopHits=0,tpHits=0,ambiguous=0;
for(const e of tape){
 const stop=e.pinned_exit_inputs.effectiveStopPrice,tp=e.pinned_exit_inputs.effectiveTakeProfitPrice;
 const exit=replayHypeModeledM5Exit({
  entryTs:e.entry_ts_ms,entryPrice:e.entry_price,stopPrice:stop,takeProfitPrice:tp,
  maxHoldHours:168,barAt:t=>m.get(t)});
 if(exit.stopAndTargetBothTouched)ambiguous++;
 const reason=!exit?"EXIT_NOT_FOUND":exit.ts!==e.exit_ts_ms?"EXIT_TS_MISMATCH":
  exit.reason!==e.exit_reason?"EXIT_REASON_MISMATCH":
  Math.abs(exit.price-e.exit_price)>1e-8?"EXIT_PRICE_MISMATCH":"MATCH";
 if(reason==="MATCH")matched++;else{
  errorCounts[reason]=(errorCounts[reason]??0)+1;
  if(examples.length<12)examples.push({entryTs:e.entry_ts_ms,expected:{ts:e.exit_ts_ms,reason:e.exit_reason,price:e.exit_price},actual:exit,reason});
 }
 if(exit?.reason==="PINNED_HYPE_HARD_STOP")stopHits++;
 if(exit?.reason==="PINNED_HYPE_TAKE_PROFIT")tpHits++;
}
const report={schema:"hype-aster-5m-native-model-exit-parity/v1",status:"RESEARCH_ONLY_NO_VENUE_FILLS",candidateCount:tape.length,matched,errors:errorCounts,exitStopCount:stopHits,exitProfitCount:tpHits,stopFirstSameM5Ambiguities:ambiguous,sourceCandles:m.size,sourceHashes:{prefix:sha(prefix),suffix:sha(suffix),tape:sha(tapeFile)},examples,
 limitations:["Source M5 close timestamp (bar start+300000) for first confirmed STOP/TP touch; simulated stop and TP touch only: no signed venue order placement, execution book, queue position or funding","Uses archived model protective stop/TP targets whose derivation was separately checked against current HYPE entry source; no independent root certificate","No account-wide portfolio allocation; 78 independent candidate outcome models may overlap in real time"],orderAuthority:false};
writeFileSync(out,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({...report,examples:examples.slice(0,4)}));
