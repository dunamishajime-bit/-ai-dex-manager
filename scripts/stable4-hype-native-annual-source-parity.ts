import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {buildHypeTrendSignal,type HypeTrendCandle} from "../lib/hype-trend-long-signal";
const H=3600000;
const [btcFile,hypeFile,archivedFile,outFile]=process.argv.slice(2);
if(!btcFile||!hypeFile||!archivedFile||!outFile)throw Error("USAGE: BTC_H1.gz HYPE_H1.gz ARCHIVED.json OUT.json");
const sha=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
function load(path:string){
 const src=gunzipSync(readFileSync(path)).toString("utf8").trim().split(/\r?\n/);
 const rows:HypeTrendCandle[]=src.map(line=>{
  const r=JSON.parse(line);return {openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])};
 });
 for(let k=1;k<rows.length;k++){
  if(rows[k].openTime!==rows[k-1].openTime+H)throw Error("H1_GAP");
 }
 return rows;
}
const btc=load(btcFile),hype=load(hypeFile);
if(btc.length!==hype.length||btc.some((b,i)=>b.openTime!==hype[i].openTime))throw Error("H1_SOURCE_ALIGNMENT");
type Tape={entry_ts_ms:number;signal_ts_ms:number;entry_price:number;requested_gross:number;route:string;source_runtime_sha:string;pinned_exit_inputs:{signalAtr:number;stopDistance:number;takeProfitDistance:number}};
const tape=JSON.parse(readFileSync(archivedFile,"utf8")) as Tape[];
const lookup=new Map(hype.map((x,i)=>[x.openTime,i]));
const errors:Record<string,number>={},samples:any[]=[];let positive=0,matchedAtr=0,matchedEntry=0,matchedSignalTs=0,matchedDist=0;
for(const row of tape){
 const i=lookup.get(row.entry_ts_ms);
 if(i===undefined){errors.MISSING_CANDLE=(errors.MISSING_CANDLE??0)+1;continue;}
 const history=btc.slice(0,i),target=hype.slice(0,i);
 const sig=buildHypeTrendSignal({btc:history,hype:target,now:row.entry_ts_ms});
 const reason= !sig.accepted?"SOURCE_REJECT:"+sig.reason:
  sig.signalTsMs!==row.signal_ts_ms?"SIGNAL_TS_MISMATCH":
  Math.abs(hype[i].open-row.entry_price)>1e-8?"ENTRY_OPEN_MISMATCH":
  Math.abs((sig.atr??0)-row.pinned_exit_inputs.signalAtr)>1e-8?"ATR_MISMATCH":
  Math.abs((sig.stopDistance??0)-row.pinned_exit_inputs.stopDistance)>1e-8?"STOP_DISTANCE_MISMATCH":
  Math.abs((sig.trailingDistance??0)-row.pinned_exit_inputs.takeProfitDistance)>1e-8?"TAKEPROFIT_DISTANCE_MISMATCH":"MATCH";
 if(reason==="MATCH")positive++;else{errors[reason]=(errors[reason]??0)+1;if(samples.length<12)samples.push({entryTs:row.entry_ts_ms,reason,source:sig,pin:row.pinned_exit_inputs,open:hype[i].open});}
 if(sig.signalTsMs===row.signal_ts_ms)matchedSignalTs++;
 if(Math.abs(hype[i].open-row.entry_price)<1e-8)matchedEntry++;
 if(sig.atr!==null&&Math.abs(sig.atr-row.pinned_exit_inputs.signalAtr)<1e-8)matchedAtr++;
 if(sig.stopDistance!==null&&Math.abs(sig.stopDistance-row.pinned_exit_inputs.stopDistance)<1e-8)matchedDist++;
}
const report={status:"ARCHIVED_HYPE_ENTRY_SOURCE_PARITY_ONLY_NO_LIVE",tapeCount:tape.length,matched:positive,errors,matchedSignalTs,matchedEntry,matchedAtr,matchedStopDistance:matchedDist,examples:samples,
inputSha:{btc:sha(btcFile),hype:sha(hypeFile),tape:sha(archivedFile)},
limitations:["ASTER 1H source entry signal only; not re-executing historical M5 STOP/TP or fills","Current HEAD source vs pinned 2026-10 source may differ in EMA initiation; report all mismatches, no fuzzy matching","Not complete current-runner production bot order authority; entry open is model proxy"],orderAuthority:false};
writeFileSync(outFile,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({...report,examples:samples.slice(0,3)}));
