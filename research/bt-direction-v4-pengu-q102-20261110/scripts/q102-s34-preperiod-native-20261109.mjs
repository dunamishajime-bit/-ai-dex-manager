import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import {generateQuality102CausalV4S34Candidates} from './pinned-source/Q102/lib/disdex-quality102-causal-v4-s34.ts';
import {QUALITY102_CAUSAL_V4_S34_MODEL} from './pinned-source/Q102/config/disdexQuality102CausalV4Model.ts';
const ROOT='C:/tmp/disdex-bt-20251001-20261001';
const OUT=ROOT+'/PREPERIOD_TRAIN_20250322_20251001/Q102_FORWARD_COMPLETE/';
const BEGIN=Date.parse('2025-03-22T00:00:00Z'),END=Date.parse('2025-10-01T00:00:00Z'),HOUR=3600000;
const file=OUT+'native-Q102-S34-raw-intentions.jsonl',summaryfile=OUT+'native-Q102-S34-entry-summary.json';
fs.mkdirSync(OUT,{recursive:true});
if(fs.existsSync(file)||fs.existsSync(summaryfile))throw Error('DO_NOT_OVERWRITE_PRE_Q102_OUTPUT');
const syms=[...new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>x.symbol))].sort();
const sig=[],coverage={},routeCount={},excluded=[];
function load(symbol,dir,suffix){
 const name=ROOT+'/'+dir+'/'+symbol+suffix;
 if(!fs.existsSync(name))return [];
 const raw=zlib.gunzipSync(fs.readFileSync(name)).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 return raw.map(x=>({timestampMs:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),quoteVolume:Number(x[7]),baseVolume:Number(x[5])}));
}
for(const sym of syms){
 const early=load(sym,'aster-public-v3-h1-early','-1h-20250301-20250924.jsonl.gz'),
  main=load(sym,'aster-public-v3-h1','-1h-20250924-20261001.jsonl.gz'),
  forward=load(sym,'FORWARD_HOLDOUT_20261001_20261108/aster-h1','-1h-20261001-20261108T20.jsonl.gz');
 const bars=[...early,...main,...forward];
 if(!bars.length){
  excluded.push({symbol:sym,reason:'NO_ASTER_HISTORY'});
  console.log('Q102_MISSING_HISTORY',sym);
  continue;
 }
 if(!bars.every((r,i)=>i===0||r.timestampMs===bars[i-1].timestampMs+HOUR)){
  excluded.push({symbol:sym,reason:'H1_INTERNAL_GAP',first:bars[0].timestampMs});
  continue;
 }
 const start=Math.max(BEGIN,bars[0].timestampMs+337*HOUR);
 const checks={symbol:sym,bars:bars.length,first:bars[0].timestampMs,checked:0,insufficient:0,sourceRejected:0,nativeCandidates:0};
 for(let t=start;t<END;t+=HOUR){
  if(new Date(t).getUTCHours()%4!==1)continue;
  const i=(t-bars[0].timestampMs)/HOUR;
  if(!Number.isInteger(i)||i<337||i>=bars.length){checks.insufficient++;continue}
  const row=bars[i],prior=bars.slice(i-450,i);
  try{
   const candidates=generateQuality102CausalV4S34Candidates({symbol:sym,rows:prior,entryOpen:{timestampMs:t,open:row.open}});
   checks.checked++;
   for(const c of candidates){
    checks.nativeCandidates++;
    const key=c.family+'_'+c.layer;
    routeCount[key]=(routeCount[key]||0)+1;
    sig.push({strategy_id:'Q102_S34_RAW',source_runtime_sha:'ef1ab178e26a7bf5bddb6473467765edba242e1d',
      symbol:sym,signalTs:c.dataCutoffTs,entryTs:t,entryOpen:row.open,side:c.side===1?'LONG':'SHORT',
      layer:c.layer,family:c.family,route:c.key,maxHoldHours:c.maxHoldHours,hardStop:c.hardStop,
      strength:c.strength,margin:c.margin,requestedGross:null,
      source:'PINNED_Q102_S34_NATIVE_ENTRY_ONLY_NO_HIGH_VOL_OR_ONE_SLOT',
      caveat:'EXCLUDED_FROM_FINAL_PORTFOLIO_ADMISSION_WITHOUT_FULL_HIGH_VOL_AND_EXIT'});
   }
  }catch(e){checks.sourceRejected++;}
 }
 coverage[sym]=checks;
 console.log('Q102_S34_NATIVE_SOURCE',sym,JSON.stringify(checks));
}
sig.sort((a,b)=>a.entryTs-b.entryTs||a.symbol.localeCompare(b.symbol));
const body=sig.map(x=>JSON.stringify(x)).join('\n')+'\n';
fs.writeFileSync(file,body);
const summary={schema:'q102-s34-native-preperiod-20250322-20251001/v1',
 source:'ASTER_PUBLIC_H1_NATIVE_Q102_PIN',status:'PARTIAL_Q102_S34_ONLY_NOT_FULL_Q102',
 pin:'ef1ab178e26a7bf5bddb6473467765edba242e1d',count:sig.length,
 output:file,sha256:crypto.createHash('sha256').update(body).digest('hex'),
 byLayerFamily:routeCount,coverage,excluded,
 warning:'Q102 HIGH_VOL monthly selector not replayed; live owner occupancy, same-symbol exclusion, shared gross and signed venue STOP not replayed. No economic BT result.'};
fs.writeFileSync(summaryfile,JSON.stringify(summary,null,2)+'\n');
console.log('Q102_NATIVE_S34_RESULT',JSON.stringify({rawCandidates:sig.length,byLayerFamily:routeCount,excluded,sha256:summary.sha256}));
