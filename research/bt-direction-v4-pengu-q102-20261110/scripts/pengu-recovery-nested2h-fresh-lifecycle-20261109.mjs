import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {
  buildPenguDualLsV2EvaluationSeries,
  evaluatePenguDualLsV2PositionBar,
} from './pinned-source/PENGU/lib/pengu-dual-ls-v2.ts';

const ROOT='C:/tmp/disdex-bt-20251001-20261001';
const INPUT=ROOT+'/DIRECTION_RESEARCH_20261109/pengu_recovery_nested2h_reversal_input.jsonl';
const OUT=ROOT+'/PENGU_RECOVERY_NESTED2H_FRESH_LIFECYCLE_20261109';
fs.mkdirSync(OUT,{recursive:true});
const HOUR=3600000, END=Date.parse('2026-10-01T00:00:00Z');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const assert=(c,m)=>{if(!c)throw Error(m)};
function loadH1(sym){
 const p=ROOT+'/aster-public-v3-h1/'+sym+'-1h-20250924-20261001.jsonl.gz';
 const gz=fs.readFileSync(p);
 const raw=zlib.gunzipSync(gz).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const rows=raw.map(v=>({openTime:+v[0],closeTime:+v[6],open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5]}));
 for(let i=1;i<rows.length;i++)assert(rows[i].openTime-rows[i-1].openTime===HOUR,'H1_GAP_'+sym+'_'+i);
 return {rows,path:p,sha256:sha(gz)};
}
const P=loadH1('PENGUUSDT'),B=loadH1('BTCUSDT');
const fundingPath=ROOT+'/aster-public-funding/PENGUUSDT-20251001-20261001.json';
const fundingRaw=fs.readFileSync(fundingPath);
const funding=JSON.parse(fundingRaw.toString('utf8')).map(x=>({fundingTime:+x.fundingTime,fundingRate:+x.fundingRate}));
const evalRows=buildPenguDualLsV2EvaluationSeries({pengu1h:P.rows,btc1h:B.rows,penguFunding:funding},END);
const evalByTs=new Map();
for(let i=0;i<evalRows.length;i++)if(evalRows[i].features)evalByTs.set(evalRows[i].features.referenceTs,{row:evalRows[i],index:i});
const penguByTs=new Map(P.rows.map(x=>[x.openTime,x]));
const candidates=fs.readFileSync(INPUT,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
function nextOpen(ts){const b=penguByTs.get(ts);return b?b.open:undefined;}
function finalModelPrice(reason,exit,observationTs){
 if(exit?.stopPrice!==undefined&&(reason.includes('HARD_STOP')||reason.includes('TRAILING_STOP')))
   return {price:+exit.stopPrice,kind:'RESIDENT_STOP_PRICE_MODEL'};
 const causal=nextOpen(observationTs+HOUR);
 if(!(causal>0))return undefined;
 return {price:causal,kind:'CAUSAL_NEXT_H1_OPEN'};
}
const modeled=[],unresolved=[],reasons={};
for(const x of candidates){
 const loc=evalByTs.get(+x.entryTs);
 if(!loc){unresolved.push({...x,unresolvedReason:'REVERSAL_FEATURE_ROW_MISSING'});continue}
 const eb=penguByTs.get(+x.entryTs);
 if(!eb||Math.abs(eb.open-(+x.entryReferenceOpenPrice))>1e-12){
   unresolved.push({...x,unresolvedReason:'REVERSAL_ENTRY_OPEN_MISMATCH'});continue
 }
 const ep=+x.entryReferenceOpenPrice,gross=+x.requestedGross;
 let pos={
   side:x.side==='LONG'?1:-1,entryTs:+x.entryTs,entryPrice:ep,quantity:1,gross,
   highWaterMark:ep,lowWaterMark:ep,
   entryVersion:x.side==='LONG'?'LONG_V2_FINAL':'LEGACY_V2',
 };
 let final=null,failure=null;
 for(let j=loc.index;j<evalRows.length;j++){
   const er=evalRows[j],f=er.features;
   if(!f)continue;
   if(f.referenceTs<+x.entryTs)continue;
   if(f.referenceTs+HOUR>END){failure='EXIT_AFTER_PERIOD';break}
   const r=evaluatePenguDualLsV2PositionBar(pos,f);
   pos=r.updatedPosition;
   if(r.exit){
     const fm=finalModelPrice(r.exit.reason,r.exit,f.referenceTs);
     if(!fm){failure='FINAL_PRICE_MISSING';break}
     final={reason:r.exit.reason,decisionReferenceTs:f.referenceTs,exitTs:f.referenceTs+HOUR,exitPrice:fm.price,priceKind:fm.kind};
     break;
   }
 }
 if(!final){unresolved.push({...x,unresolvedReason:failure||'NO_EXIT_BEFORE_PERIOD'});continue}
 const sg=x.side==='LONG'?1:-1;
 const raw=sg*(final.exitPrice/ep-1);
 const out={id:x.originalId,originalEntryTs:+x.originalEntryTs,reversalTs:+x.entryTs,entryTs:+x.entryTs,
   exitTs:final.exitTs,symbol:'PENGUUSDT',side:x.side,originalSide:x.originalSide,route:x.originalRoute,
   requestedGross:gross,entryPrice:ep,exitPrice:final.exitPrice,exitReason:final.reason,
   exitPriceKind:final.priceKind,rawReturn:raw,sourceRuntimeSha:x.source_runtime_sha,
   nativeLifecycleEvidence:'CURRENT_PIN_OPPOSITE_BASE_EXIT_REPLAY'};
 modeled.push(out);reasons[final.reason]=(reasons[final.reason]||0)+1;
}
const body=modeled.map(x=>JSON.stringify(x)).join('\n')+(modeled.length?'\n':'');
fs.writeFileSync(OUT+'/pengu-reversal-exits.jsonl',body);
fs.writeFileSync(OUT+'/unresolved.jsonl',unresolved.map(x=>JSON.stringify(x)).join('\n')+(unresolved.length?'\n':''));
const summary={schema:'disdex-pengu-early-direction-reversal-fresh-opposite/v1',sourceCandidates:candidates.length,
 modeled:modeled.length,unresolved:unresolved.length,byExitReason:reasons,outputSHA256:sha(Buffer.from(body)),
 limitations:['Opposite side uses current pinned baseline Long/Short exit management; reversal entry itself is research-only','No signed venue fills']};
fs.writeFileSync(OUT+'/SUMMARY.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
for(const x of modeled)console.log(x.id,x.originalSide,'->',x.side,x.route,x.rawReturn,x.exitReason);
