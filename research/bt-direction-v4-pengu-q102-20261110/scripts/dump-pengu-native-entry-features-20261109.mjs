import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  buildPenguDualLsV2EvaluationSeries,
  isPenguV8V64DynamicLongSignal,
  selectPenguRecoveryV8Entry,
  penguV8BreakoutAtrScore,
} from './pinned-source/PENGU/lib/pengu-dual-ls-v2.ts';

const ROOT='C:/tmp/disdex-bt-20251001-20261001';
const HOUR=3600000, END=Date.parse('2026-10-01T00:00:00Z');
function loadH1(sym){
 const p=ROOT+'/aster-public-v3-h1/'+sym+'-1h-20250924-20261001.jsonl.gz';
 const raw=zlib.gunzipSync(fs.readFileSync(p)).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 return raw.map(v=>({openTime:+v[0],closeTime:+v[6],open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5]}));
}
const P=loadH1('PENGUUSDT'), B=loadH1('BTCUSDT');
const funding=JSON.parse(fs.readFileSync(ROOT+'/aster-public-funding/PENGUUSDT-20251001-20261001.json','utf8'))
 .map(x=>({fundingTime:+x.fundingTime,fundingRate:+x.fundingRate}));
const evalRows=buildPenguDualLsV2EvaluationSeries({pengu1h:P,btc1h:B,penguFunding:funding},END);
const byTs=new Map();
for(let i=0;i<evalRows.length;i++){
 const r=evalRows[i];
 if(r.features)byTs.set(r.features.referenceTs,{row:r,index:i});
}
const candidates=fs.readFileSync(ROOT+'/native-new-signal-20251001-20261001/native-PENGU-raw-intentions.jsonl','utf8')
 .trim().split('\n').filter(Boolean).map(JSON.parse);
const out=[];
for(let ci=0;ci<candidates.length;ci++){
 const c=candidates[ci],loc=byTs.get(+c.signalTs);
 if(!loc)throw Error('NO_FEATURE_'+ci);
 const r=loc.row, f=r.features;
 const rec=r.recoveryV8;
 const v64=isPenguV8V64DynamicLongSignal(evalRows,loc.index);
 const recDecision=rec?selectPenguRecoveryV8Entry({...rec,ordinaryLongEligible:v64,baseLongSignal:v64},true):undefined;
 out.push({
   id:'PENGU_'+String(ci+1).padStart(5,'0'),
   route:c.route,side:c.side,signalTs:+c.signalTs,entryTs:+c.entryTs,
   longRaw:r.longRaw,longSignal:r.longSignal,shortSignal:r.shortSignal,
   shortSetupActive:r.shortSetupActive,shortSetupArmed:r.shortSetupArmed,
   m05ShadowPass:r.m05ShadowPass,m05ShadowWouldBlock:r.m05ShadowWouldBlock,
   v64Signal:v64,recoveryDecision:recDecision?.kind||'NONE',
   breakoutAtrScore:penguV8BreakoutAtrScore(f),
   ...Object.fromEntries(Object.entries(f).map(([k,v])=>['f_'+k,v])),
   ...(rec?Object.fromEntries(Object.entries(rec).map(([k,v])=>['rec_'+k,v])):{})
 });
}
const p=ROOT+'/DIRECTION_RESEARCH_20261109/pengu_native_entry_features.jsonl';
fs.writeFileSync(p,out.map(x=>JSON.stringify(x)).join('\n')+'\n');
console.log('ROWS',out.length,'SAMPLE',out[0]);
