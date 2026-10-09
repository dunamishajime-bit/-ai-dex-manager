/** Offline Core generation + sizing proof; no exchange client or order API. */
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {V12_X1_ALL} from "../config/v12X1AllRuntime";
import {resampleV12H1ToH2,type V12Bar} from "../lib/v12-x1-all";
import {stepNativeFailedBreakCore,selectNativeCoreEvents,type CoreMachineState,type NativeCoreEvent} from "../lib/v12-v4-native-core";
const [dataRoot,eventPath,selectedPath,outputPath]=process.argv.slice(2);
if(!outputPath)throw Error("USAGE DATA EVENTS SELECTED OUTPUT");
const H=3600000,start=Date.parse("2026-08-11T00:00:00Z"),end=Date.parse("2026-10-08T00:00:00Z")-46*H;
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const series:Record<string,V12Bar[]>={},maps:Record<string,Map<number,number>>={},prices=new Map<string,number>(),hashes:Record<string,string>={};
for(const symbol of V12_X1_ALL.universe){
 const body=readFileSync(join(dataRoot,symbol+"USDT.jsonl"),"utf8");hashes[symbol]=hash(body);
 const h1=body.split(/\r?\n/).filter(Boolean).map(line=>{
  const x=JSON.parse(line),ts=Number(x.event_time_ms);prices.set(symbol+"USDT|"+ts,Number(x.open));
  return {ts,open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.base_volume),closed:true};
 });
 series[symbol]=resampleV12H1ToH2(h1);maps[symbol]=new Map(series[symbol].map((b,i)=>[b.endTs,i]));
}
const states:Record<string,CoreMachineState>=Object.fromEntries(V12_X1_ALL.universe.map(s=>[s,{lastDecisionTs:null,setup:null}]));
const events:NativeCoreEvent[]=[],gaps:any[]=[];let decisions=0;
for(let now=start-240*H;now<end;now+=2*H){
 const bi=maps.BTC.get(now);if(bi===undefined||bi<60)continue;
 const btc=series.BTC.slice(Math.max(0,bi-120),bi+1);
 for(const symbol of V12_X1_ALL.universe){
  const i=maps[symbol].get(now);if(i===undefined||i<60){states[symbol]={lastDecisionTs:now,setup:null};gaps.push({symbol,now,error:"MISSING_H2"});continue;}
  try{
   const out=stepNativeFailedBreakCore(states[symbol],symbol+"USDT",series[symbol].slice(Math.max(0,i-120),i+1),btc,now);
   states[symbol]=out.state;if(out.event&&now>=start)events.push(out.event);
  }catch(error){gaps.push({symbol,now,error:String(error)});}
 }
 decisions++;
}
const selected=selectNativeCoreEvents(events,prices),eventBody=readFileSync(eventPath,"utf8"),selectedBody=readFileSync(selectedPath,"utf8");
const load=(s:string)=>s.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
const expectedEvents=load(eventBody),expectedSelected=load(selectedBody),mismatches:any[]=[];
function compare(kind:string,actual:any[],expected:any[],fields:string[]){
 const key=(r:any)=>r.symbol+"|"+r.entry_ts_ms;const wanted=new Map(expected.map(r=>[key(r),r]));
 for(const row of actual){const ref=wanted.get(key(row));
  if(!ref){mismatches.push({kind,key:key(row),reason:"EXTRA_EVENT"});continue;}
  wanted.delete(key(row));
  for(const field of fields){const a=row[field],b=ref[field];
   if(typeof a==="number"&&typeof b==="number"?Math.abs(a-b)>1e-10:a!==b)mismatches.push({kind,key:key(row),field,actual:a,expected:b});
  }
 }
 for(const k of wanted.keys())mismatches.push({kind,key:k,reason:"MISSING_EVENT"});
}
const fields=["symbol","side","sg","route","entry_ts_ms","decision_ts_ms","setup_ts_ms","state_age_h","onset_momentum90","atr","score"];
compare("RAW_CORE",events,expectedEvents,fields);compare("SELECTED_CORE",selected,expectedSelected,[...fields,"rank","requested_gross","entry_price"]);
const report={status:mismatches.length===0&&gaps.length===0?"PASS_NATIVE_CORE_SOURCE_AND_SIZE":"BLOCKED_NATIVE_CORE_SOURCE_AND_SIZE",
 decisions,rawCount:events.length,selectedCount:selected.length,expectedRaw:expectedEvents.length,expectedSelected:expectedSelected.length,mismatches,gaps,
 hashes:{core:hash(readFileSync("lib/v12-v4-native-core.ts","utf8")),expectedEvents:hash(eventBody),expectedSelected:hash(selectedBody),market:hashes},
 limitations:["Observed historical H1 open used for the sizing reference; this is not a venue fill or slippage proof.",
 "Previously viewed external period; no pristine prospective profitability claim.",
 "All8 shared reservations, asynchronous fill events and development inc_keys parity remain separate."],
 orderEnabled:false,tradingMutation:0,events,selected};
writeFileSync(outputPath,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({status:report.status,decisions,rawCount:events.length,selectedCount:selected.length,
 mismatches:mismatches.slice(0,5),gaps:gaps.slice(0,5)}));
if(report.status!=="PASS_NATIVE_CORE_SOURCE_AND_SIZE")process.exitCode=1;
