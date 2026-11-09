import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {generateQuality102CausalV4S34Candidates} from './pinned-source/Q102/lib/disdex-quality102-causal-v4-s34.ts';
import {QUALITY102_CAUSAL_V4_S34_MODEL} from './pinned-source/Q102/config/disdexQuality102CausalV4Model.ts';
import {evaluateQuality102CausalV4ImprovementGate} from './pinned-source/Q102/lib/disdex-quality102-causal-selector.ts';
import {q102ExhaustionReason, causalReturn} from './pinned-source/Q102/lib/dd1296-entry-policy.ts';

const ROOT='C:/tmp/disdex-bt-20251001-20261001';
const OUT=ROOT+'/PREPERIOD_TRAIN_20250322_20251001/Q102_SELECTED_BASE';
fs.mkdirSync(OUT,{recursive:true});
const BEGIN=Date.parse('2025-03-22T00:00:00Z'),END=Date.parse('2025-10-01T00:00:00Z'),H=3600000,M5=300000;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const syms=[...new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map(x=>x.symbol))].sort();
const layerRank={S3:1,S4:2},familyRank={BRK:1,PB:2,MR:3,REV:4};
function loadH1(symbol,dir,suffix){
 const p=ROOT+'/'+dir+'/'+symbol+suffix;
 if(!fs.existsSync(p))return [];
 return zlib.gunzipSync(fs.readFileSync(p)).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  .map(x=>({timestampMs:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],quoteVolume:+x[7],baseVolume:+x[5]}));
}
const h1={},rawCandidates=[];
for(const sym of syms){
 const bars=[...loadH1(sym,'aster-public-v3-h1-early','-1h-20250301-20250924.jsonl.gz'),
             ...loadH1(sym,'aster-public-v3-h1','-1h-20250924-20261001.jsonl.gz')];
 h1[sym]=bars;
 if(!bars.length)continue;
 for(let i=1;i<bars.length;i++)if(bars[i].timestampMs!==bars[i-1].timestampMs+H)throw Error('H1_GAP_'+sym+'_'+i);
 const start=Math.max(BEGIN,bars[0].timestampMs+337*H);
 for(let t=start;t<END;t+=H){
  if(new Date(t).getUTCHours()%4!==1)continue;
  const i=(t-bars[0].timestampMs)/H;
  if(!Number.isInteger(i)||i<337||i>=bars.length)continue;
  const row=bars[i],prior=bars.slice(i-450,i);
  let cs=[];
  try{cs=generateQuality102CausalV4S34Candidates({symbol:sym,rows:prior,entryOpen:{timestampMs:t,open:row.open}})}catch{continue}
  for(const c of cs)rawCandidates.push({...c,entryOpen:row.open});
 }
}
console.log('Q102_PRE_RAW_COUNT',rawCandidates.length);
const grouped=new Map();
for(const c of rawCandidates){const a=grouped.get(c.entryTs)||[];a.push(c);grouped.set(c.entryTs,a)}
const selected=[],rejectedFinal=[];
for(const [t,a] of [...grouped.entries()].sort((x,y)=>x[0]-y[0])){
 a.sort((x,y)=>layerRank[x.layer]-layerRank[y.layer]||familyRank[x.family]-familyRank[y.family]||y.margin-x.margin||x.key.localeCompare(y.key));
 const c=a[0];
 if(c.symbol==='FETUSDT'&&c.family==='BRK'&&c.side===-1){
  let ret72;
  try{
   const bars=h1.FETUSDT, i=(c.entryTs-bars[0].timestampMs)/H;
   ret72=causalReturn(bars.slice(0,i),{timestampMs:c.entryTs,open:c.entryOpen},72);
  }catch{}
  const reason=q102ExhaustionReason(c.symbol,c.family,c.side,ret72);
  if(reason){rejectedFinal.push({entryTs:t,key:c.key,reason,ret72});continue}
 }
 const improvement=evaluateQuality102CausalV4ImprovementGate({family:c.family,side:c.side,ret14:c.ret14});
 if(!improvement.accepted){rejectedFinal.push({entryTs:t,key:c.key,reason:improvement.reason,ret14:c.ret14});continue}
 selected.push(c);
}
const selectedBody=selected.map(x=>JSON.stringify(x)).join('\n')+(selected.length?'\n':'');
fs.writeFileSync(OUT+'/q102-pre-selected-candidates.jsonl',selectedBody);
console.log('Q102_PRE_SELECTED_COUNT',selected.length,'REJECTED',rejectedFinal.length);
function loadM5(sym){
 const files=[
  ROOT+'/PREPERIOD_TRAIN_20250322_20251001/q102-aster-m5/'+sym+'-5m-20250322-20251001.jsonl.gz'];
 const arr=[];const hashes=[];
 for(const p of files){
  if(!fs.existsSync(p))continue;
  const b=fs.readFileSync(p);hashes.push({path:p,sha256:sha(b)});
  for(const x of zlib.gunzipSync(b).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse))
   arr.push({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4]});
 }
 arr.sort((a,b)=>a.t-b.t);
 // de-duplicate exact seam if any
 const ded=[]; for(const x of arr){if(ded.length&&ded.at(-1).t===x.t){if(JSON.stringify(ded.at(-1))!==JSON.stringify(x))throw Error('M5_DUP_DIFF_'+sym);continue}ded.push(x)}
 return {arr:ded,map:new Map(ded.map(x=>[x.t,x])),hashes};
}
const m5=Object.fromEntries(syms.map(s=>[s,loadM5(s)]));
const grossMap={MR:{LONG:.75,SHORT:.75},BRK:{LONG:.75,SHORT:.75},PB:{LONG:2,SHORT:2.5},REV:{LONG:1.5,SHORT:1.25}};
const modeled=[],unresolved=[];
for(let i=0;i<selected.length;i++){
 const c=selected[i],side=c.side===1?'LONG':'SHORT',ep=c.entryOpen,stop=ep*(c.side===1?1-c.hardStop:1+c.hardStop),deadline=c.entryTs+c.maxHoldHours*H;
 const d=m5[c.symbol],entrybar=d.map.get(c.entryTs);
 const id='Q102S34_'+String(i+1).padStart(5,'0');
 if(!entrybar||Math.abs(entrybar.o-ep)>Math.max(1e-10,ep*1e-9)){
  unresolved.push({id,key:c.key,symbol:c.symbol,entryTs:c.entryTs,reason:'M5_ENTRY_MISSING_OR_OPEN_MISMATCH'});continue
 }
 let out;
 for(let t=c.entryTs;t<=deadline;t+=M5){
  const b=d.map.get(t);
  if(!b){out={unresolved:'M5_EXIT_PATH_GAP',gapTs:t};break}
  if(t>=deadline){out={exitTs:t,exitPrice:b.o,exitReason:'TIME',exitPriceKind:'CAUSAL_M5_OPEN'};break}
  if(c.side===1&&b.l<=stop){out={exitTs:t+M5,exitPrice:Math.min(b.o,stop),exitReason:'HARD_STOP',exitPriceKind:'RESIDENT_STOP_M5_GAP_AWARE'};break}
  if(c.side===-1&&b.h>=stop){out={exitTs:t+M5,exitPrice:Math.max(b.o,stop),exitReason:'HARD_STOP',exitPriceKind:'RESIDENT_STOP_M5_GAP_AWARE'};break}
 }
 if(!out||out.unresolved){
  unresolved.push({id,key:c.key,symbol:c.symbol,entryTs:c.entryTs,reason:out?.unresolved||'NO_EXIT',...(out?.gapTs?{gapTs:out.gapTs}:{})});continue
 }
 const rawReturn=c.side===1?out.exitPrice/ep-1:ep/out.exitPrice-1;
 modeled.push({id,strategy:'Q102_S34_SELECTED',sourceRuntimeSha:'ef1ab178e26a7bf5bddb6473467765edba242e1d',
   symbol:c.symbol,side,family:c.family,layer:c.layer,route:c.key,entryTs:c.entryTs,entryPrice:ep,
   hardStop:c.hardStop,maxHoldHours:c.maxHoldHours,requestedGross:grossMap[c.family][side],
   ret14:c.ret14,strength:c.strength,margin:c.margin,...out,rawReturn});
}
const body=modeled.map(x=>JSON.stringify(x)).join('\n')+(modeled.length?'\n':'');
fs.writeFileSync(OUT+'/q102-s34-selected-native-exits.jsonl',body);
fs.writeFileSync(OUT+'/q102-s34-selected-unresolved.jsonl',unresolved.map(x=>JSON.stringify(x)).join('\n')+(unresolved.length?'\n':''));
fs.writeFileSync(OUT+'/q102-s34-final-gate-rejected.jsonl',rejectedFinal.map(x=>JSON.stringify(x)).join('\n')+(rejectedFinal.length?'\n':''));
const summary={
 schema:'disdex-q102-s34-selected-preperiod-current-pin-exit-replay/v1',status:'PARTIAL_Q102_S34_ONLY_NOT_FULL_Q102',
 rawCandidates:rawCandidates.length,uniqueEntryTimes:grouped.size,selectedAfterFinalGates:selected.length,
 finalGateRejected:rejectedFinal.length,modeled:modeled.length,unresolved:unresolved.length,
 byFamily:Object.fromEntries([...new Set(modeled.map(x=>x.family))].sort().map(k=>[k,modeled.filter(x=>x.family===k).length])),
 byExitReason:Object.fromEntries(['HARD_STOP','TIME'].map(k=>[k,modeled.filter(x=>x.exitReason===k).length])),
 unresolvedByReason:Object.fromEntries([...new Set(unresolved.map(x=>x.reason))].sort().map(k=>[k,unresolved.filter(x=>x.reason===k).length])),
 overlays:{profitFloorEnabled:false,adoptedExitPoliciesEnabled:false,evidence:'Referenced production EnvironmentFiles contain neither flag; pin defaults false'},
 outputSHA256:sha(Buffer.from(body)),m5Sources:Object.fromEntries(syms.map(s=>[s,m5[s].hashes])),
 limitations:[
  'HIGH_VOL generator/selector is not replayed; this is S34-only final selection when HIGH_VOL is absent',
  'Historical owner occupancy/shared portfolio admission is not applied here',
  'Hard-stop fill is M5 gap-aware resident STOP price model, not signed venue execution',
  'APT/NEAR/UNI lack pre-2026-08-03 M5 and fail closed when selected',
  'Profit-floor/adopted overlays are disabled because production referenced env files did not set the flags and source defaults are false'
 ]
};
fs.writeFileSync(OUT+'/SUMMARY.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
