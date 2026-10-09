/** Replay executable candidate adapter against frozen external causal route ledger. No orders. */
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {adaptProductionCandidates,type FeatureBar,type SourceEvidence} from "../lib/v12-v4-production-features";
const [dataRoot,sourcePath,expectedPath,corePath,outputPath]=process.argv.slice(2);
if(!outputPath)throw Error("USAGE DATA SOURCE EXPECTED CORE_PROOF OUTPUT");
const rows=(path:string)=>readFileSync(path,"utf8").split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
const H=3600000;
const sourceRows=rows(sourcePath),expected=rows(expectedPath),symbols=new Set(["BTCUSDT",...sourceRows.map(x=>x.symbol)]);
const bars:Record<string,FeatureBar[]>={};
for(const symbol of symbols)bars[symbol]=rows(join(dataRoot,symbol+".jsonl")).map(x=>({
 openTs:Number(x.event_time_ms),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),quoteVolume:Number(x.quote_volume)}));
const expectedKey=(c:any)=>c.route+"|"+c.symbol+"|"+(c.eligibleEntryTs??c.entry_ts_ms)+"|"+(c.effectiveSide??c.side);
const wanted=new Map(expected.map(c=>[expectedKey(c),c])),actual:any[]=[],errors:any[]=[];
const inputs:SourceEvidence[]=sourceRows.map(x=>({symbol:x.symbol,side:x.side,eligibleSourceEntryTs:x.entry_ts_ms,
 decisionTs:x.entry_ts_ms,momentumConditionAgeHours:x.age,nativeDiagnosticRet6:x.diag_ret6,
 nativeDiagnosticEma12Atr:x.diag_ema,sourceEngine:"buildV12Signals",sourceParityVerified:false}));
const core=JSON.parse(readFileSync(corePath,"utf8")),entryEnd=Date.parse("2026-10-08T00:00:00Z")-74*H;
for(const row of core.selected){
 if(row.entry_ts_ms>=entryEnd)continue;
 inputs.push({symbol:row.symbol,side:"LONG",eligibleSourceEntryTs:row.entry_ts_ms,decisionTs:row.entry_ts_ms,
  momentumConditionAgeHours:0,coreRequestedGross:row.requested_gross,sourceEngine:"FAILED_BREAK_NATIVE",sourceParityVerified:false,
  failedBreak:{freshUpward90hOnset:true,structuralUpBreak:true,failedBelowWithin6h:true,oppositeClvBodyConfirm:true}});
 if(!bars[row.symbol])bars[row.symbol]=rows(join(dataRoot,row.symbol+".jsonl")).map(x=>({
  openTs:Number(x.event_time_ms),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),quoteVolume:Number(x.quote_volume)}));
}
for(const source of inputs){
 try{
  const out=adaptProductionCandidates({source,decisionTs:source.eligibleSourceEntryTs+2*H,symbolBars:bars[source.symbol],btcBars:bars.BTCUSDT});
  actual.push(...out.candidates);
 }catch(error){errors.push({symbol:source.symbol,entryTs:source.eligibleSourceEntryTs,error:String(error)});}
}
const extras:any[]=[],differences:any[]=[];
for(const c of actual){
 const key=expectedKey(c),ref=wanted.get(key);
 if(!ref){extras.push({key,sourceSide:c.sourceSide,sourceTs:c.sourceSignalTs});continue;}
 wanted.delete(key);
 if(c.rank!==ref.rank||Math.abs(c.requestedGross-ref.requested_gross)>1e-10)
  differences.push({key,rank:c.rank,expectedRank:ref.rank,gross:c.requestedGross,expectedGross:ref.requested_gross});
}
const missing=[...wanted.keys()];
const report={status:!extras.length&&!missing.length&&!differences.length&&!errors.length?"PASS_NATIVE_ROUTE_ENTRY_REPLAY":"BLOCKED_NATIVE_ROUTE_ENTRY_REPLAY",
 sourceCount:inputs.length,expectedCount:expected.length,actualCount:actual.length,extras,missing,differences,errors,
 orderEnabled:false,tradingMutation:0,scope:"Route candidate identity/rank/requestedGross only; no portfolio/venue proof",actual};
writeFileSync(outputPath,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({status:report.status,expected:expected.length,actual:actual.length,
 extras:extras.length,missing:missing.length,differences:differences.length,errors:errors.slice(0,3),sampleExtras:extras.slice(0,3),sampleMissing:missing.slice(0,3)}));
if(report.status!=="PASS_NATIVE_ROUTE_ENTRY_REPLAY")process.exitCode=1;
