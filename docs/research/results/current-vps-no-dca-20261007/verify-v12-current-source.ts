import fs from "node:fs";
import path from "node:path";
import {decideV12ResidualEntry} from "@/lib/v12-top2-residual";
import {V12_X1_ALL} from "@/config/v12X1AllRuntime";
import {buildV12Signals,resampleV12H1ToH2,sizeV12Position,v12EntryGrossCapForSignal,v12EntryGrossMultiplierForSignal} from "@/lib/v12-x1-all";
const root=path.resolve("docs/research/results/current-vps-no-dca-20261007");
const data="C:/tmp/bt-v12-score100-volume080-normalonly-20260928/extracted/bt-v12-score100-volume080-normalonly-20260928/market-Aster-H1-funding-and-manifests/normalized/aster/klines";
const read=(p:string)=>fs.readFileSync(p,"utf8").trim().split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
const universe:any={};const missing:string[]=[];
for(const sym of V12_X1_ALL.universe){
 const p=path.join(data,sym+"USDT.jsonl");
 if(!fs.existsSync(p)){missing.push(sym);continue;}
 const rows=read(p);
 universe[sym]=resampleV12H1ToH2(rows.map((r:any)=>({ts:Number(r.event_time_ms),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.base_volume)})));
}
const indices=new Map(universe.BTC.map((b:any,i:number)=>[b.endTs,i]));
const allCandidates=read("C:/tmp/fet-exit-candidates/FLOOR3/crypto-price-model-candidates.jsonl");
const candidates=allCandidates.filter((r:any)=>r.strategy_id==="V12");
const mismatches:any[]=[];const matched:any[]=[];const absent:any[]=[];
for(const r of candidates){
 const index:any=indices.get(r.entry_ts_ms);
 if(index===undefined){absent.push({entry:r.entry_ts_ms,symbol:r.symbol,reason:"BAR_INDEX_MISSING"});continue;}
 const sig=buildV12Signals(universe,index).find(x=>x.symbol+"USDT"===r.symbol&&x.side===r.side&&x.rank===r.rank);
 if(!sig){absent.push({entry:r.entry_ts_ms,symbol:r.symbol,rank:r.rank,reason:"CURRENT_SIGNAL_NOT_MATCHED"});continue;}
 const rawGross=Math.min(sizeV12Position(1,r.entry_price,sig.atr,sig.side).requestedGross*v12EntryGrossMultiplierForSignal(sig),v12EntryGrossCapForSignal(sig));
 const gross=decideV12ResidualEntry(rawGross,{v12Gross:0,cryptoGross:0,stockGross:0,totalGross:0},0).acceptedGross;
 const item={rawGross,entry:r.entry_ts_ms,symbol:r.symbol,rank:r.rank,oldGross:r.requested_gross,currentGross:gross,entryQuality:sig.entryQualityClass};
 matched.push(item);
 if(Math.abs(gross-r.requested_gross)>1e-9)mismatches.push(item);
}
const report={runtimeSha:"eabfeb1750666fac11f894a34cdcf68501ab923f",candidateCount:candidates.length,matched:matched.length,grossMismatches:mismatches.length,preallocationHCAboveFinalCap:matched.filter(r=>r.rawGross>r.currentGross+1e-9).length,currentSignalNotMatched:absent.length,missingUniverse:missing,mismatches,absent};
fs.writeFileSync(path.join(root,"v12-current-source-candidate-sizing-audit.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify({candidateCount:candidates.length,matched:matched.length,grossMismatches:mismatches.length,preallocationHCAboveFinalCap:matched.filter(r=>r.rawGross>r.currentGross+1e-9).length,currentSignalNotMatched:absent.length,missingUniverse:missing,mismatchExamples:mismatches.slice(0,3),absentExamples:absent.slice(0,3)}));

assertCurrentSource();
function assertCurrentSource(){
 if(missing.length||absent.length||mismatches.length)throw new Error("CURRENT_V12_SOURCE_MATCH_INCOMPLETE");
 const sizes=new Map(matched.map(r=>[r.entry+"|"+r.symbol+"|"+r.rank,r]));
 const adjusted=allCandidates.map((r:any)=>{if(r.strategy_id!=="V12")return r;const item=sizes.get(r.entry_ts_ms+"|"+r.symbol+"|"+r.rank);if(!item)throw new Error("SIZE_NOT_PROVEN");return {...r,requested_gross:item.currentGross,entry_quality_class:item.entryQuality};});
 const out=path.join(root,"candidates");fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,"crypto-price-model-candidates.jsonl"),adjusted.map((r:any)=>JSON.stringify(r)).join("\n")+"\n");
 console.log("CURRENT_V12_SIZING_CANDIDATES_WRITTEN",adjusted.length);
}
