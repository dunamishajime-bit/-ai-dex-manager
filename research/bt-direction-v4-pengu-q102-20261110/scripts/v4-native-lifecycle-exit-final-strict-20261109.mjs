import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {
 productionExitSpec,evaluateProductionExit,evaluateNativeProductionExit,HOUR
} from './pinned-source/V4/lib/v12-v4-production-lifecycle.ts';
import {
 createV4FourRuleState,observeV4FourRuleM5,observeV4FourRuleH1
} from './pinned-source/V4/lib/v12-v4-four-rule-policy.ts';

const ROOT='C:/tmp/disdex-bt-20251001-20261001';
const P=ROOT+'/native-new-signal-20251001-20261001/native-V4-raw-intentions-with-atr-20261109.jsonl';
const O=ROOT+'/V4_NATIVE_LIFECYCLE_EXIT_FINAL_STRICT_20261109';
fs.mkdirSync(O,{recursive:true});
const END=Date.parse('2026-10-01T00:00:00Z'), M5=300000;
const rows=fs.readFileSync(P,'utf8').trim().split('\n').map(JSON.parse);
const syms=[...new Set(rows.map(x=>x.symbol))];
function sha(b){return crypto.createHash('sha256').update(b).digest('hex')}
function loadH1(sym){
 const p=ROOT+'/aster-public-v3-h1/'+sym+'-1h-20250924-20261001.jsonl.gz';
 const a=zlib.gunzipSync(fs.readFileSync(p)).toString('utf8').trim().split('\n').map(JSON.parse)
  .map(z=>({openTs:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4]}));
 return {first:a[0].openTs,a,path:p,sha256:sha(fs.readFileSync(p))};
}
function loadM5(sym){
 const out=[]; const files=[
  ROOT+'/aster-public-v3-5m-prefix/'+sym+'-5m-20250924-20260803.jsonl.gz',
  ROOT+'/aster-public-v3-5m-suffix/'+sym+'-5m-20260803-20261001.jsonl.gz'];
 const used=[];
 for(const p of files){
  if(!fs.existsSync(p))continue;
  used.push(p);
  const z=zlib.gunzipSync(fs.readFileSync(p)).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  for(const r of z)out.push({openTs:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4]});
 }
 if(!out.length)return null;
 for(let i=1;i<out.length;i++)if(out[i].openTs-out[i-1].openTs!==M5)throw Error('M5_GAP_'+sym+'_'+i);
 return {first:out[0].openTs,a:out,files:used};
}
const H=Object.fromEntries(syms.map(s=>[s,loadH1(s)]));
const F=Object.fromEntries(syms.map(s=>[s,loadM5(s)]));
function barAt(store,t,unit){
 const i=(t-store.first)/unit; if(!Number.isInteger(i)||i<0||i>=store.a.length)return null; return store.a[i];
}
const overrides=JSON.parse(fs.readFileSync(ROOT+'/DIRECTION_RESEARCH_20261109/v4_final_strict_overrides.json','utf8'));
const overrideMap=new Map(overrides.map(x=>[x.id,x.overrideSide]));
const modeled=[], unresolved=[], collision=[];
for(let ix=0;ix<rows.length;ix++){
 const x=rows[ix], id='V4_'+String(ix+1).padStart(5,'0'), effectiveSide=overrideMap.get(id)||x.side, spec=productionExitSpec(x.route), h=H[x.symbol], f=F[x.symbol];
 const entryBar=barAt(h,x.entryTs,HOUR);
 if(!entryBar){unresolved.push({...x,unresolvedReason:'ENTRY_H1_MISSING'});continue}
 const fill=entryBar.open, entryAtr=+x.entryAtr;
 if(!f){unresolved.push({...x,entryPrice:fill,exitSpec:spec,unresolvedReason:'M5_SOURCE_MISSING'});continue}
 let leg={id,candidate:{route:x.route,effectiveSide},
  qty:1,entryNotional:fill,requestedQty:1,reservationUsd:fill,entryTs:x.entryTs,entryAtr,
  status:'OPEN',exitRemainingQty:0,realizedUsd:0,feesUsd:0,fundingUsd:0,
  nativeExitEvidence:x.nativeExitEvidence};
 let four=createV4FourRuleState();
 const deadline=x.entryTs+spec.hours*HOUR;
 if(deadline>END){unresolved.push({...x,entryPrice:fill,exitSpec:spec,unresolvedReason:'EXIT_DEADLINE_AFTER_PERIOD'});continue}
 let exit=null, nativeState={stop:undefined,peak:undefined,prev:undefined};
 // Process in completed-time order. M5 policy event first at a shared H1 close, then H1 lifecycle.
 for(let closeTs=x.entryTs+M5;closeTs<=deadline && !exit;closeTs+=M5){
   const mopen=closeTs-M5, mb=barAt(f,mopen,M5);
   if(!mb){unresolved.push({...x,entryPrice:fill,exitSpec:spec,unresolvedReason:'M5_GAP',gapTs:mopen});exit={unresolved:true};break}
   const mr=observeV4FourRuleM5({route:x.route,side:effectiveSide,entryTs:x.entryTs,fill,state:four,
      bar:{...mb,observedAt:closeTs}});
   four=mr.state;
   let m5Decision=mr.exitCandidate;
   if(closeTs%HOUR===0){
     const hb=barAt(h,closeTs-HOUR,HOUR);
     if(!hb){unresolved.push({...x,entryPrice:fill,exitSpec:spec,unresolvedReason:'H1_GAP',gapTs:closeTs-HOUR});exit={unresolved:true};break}
     const next=barAt(h,closeTs,HOUR);
     const nextOpen=next?{ts:closeTs,price:next.open}:undefined;
     let standard=null;
     if(spec.kind==='NATIVE'){
       leg.nativeStop=nativeState.stop;leg.nativePeak=nativeState.peak;leg.previousExitBar=nativeState.prev;
       const nr=evaluateNativeProductionExit(leg,hb,closeTs,nextOpen);
       standard=nr.decision;nativeState={stop:nr.stop,peak:nr.peak,prev:hb};
     }else{
       standard=evaluateProductionExit(leg,hb,closeTs,nextOpen);
     }
     const hr=observeV4FourRuleH1({route:x.route,side:effectiveSide,entryTs:x.entryTs,fill,state:four,
       bar:{...hb,observedAt:closeTs}});
     four=hr.state;
     if(standard && m5Decision)collision.push({id:leg.id,ts:closeTs,standard:standard.reason,m5:m5Decision.reason});
     if(standard) exit={...standard,source:'PRODUCTION_EXIT'};
     else if(m5Decision) exit={...m5Decision,price:m5Decision.modelPrice,source:'FOUR_RULE_M5'};
     else if(hr.exitCandidate) exit={...hr.exitCandidate,price:hr.exitCandidate.modelPrice,source:'FOUR_RULE_H1'};
   }else if(m5Decision){
     exit={...m5Decision,price:m5Decision.modelPrice,source:'FOUR_RULE_M5'};
   }
 }
 if(exit?.unresolved)continue;
 if(!exit){unresolved.push({...x,entryPrice:fill,exitSpec:spec,unresolvedReason:'NO_EXIT_DECISION'});continue}
 const sg=effectiveSide==='LONG'?1:-1;
 modeled.push({id:leg.id,entryTs:x.entryTs,exitTs:exit.exitTs,symbol:x.symbol,side:effectiveSide,route:x.route,
   requestedGross:x.requestedGross,entryAtr,entryPrice:fill,exitPrice:exit.price,exitReason:exit.reason,
   exitSource:exit.source,exitSpec:spec,rawReturn:sg*(exit.price/fill-1),sourceRuntimeSha:x.source_runtime_sha,
   nativeExitEvidence:x.nativeExitEvidence,directionOverride:overrideMap.has(id)});
}
const counts=o=>Object.fromEntries([...o.entries()].sort());
const byReason=new Map(),bySpec=new Map(),bySource=new Map();
for(const x of modeled){byReason.set(x.exitReason,(byReason.get(x.exitReason)||0)+1);bySpec.set(x.exitSpec.kind,(bySpec.get(x.exitSpec.kind)||0)+1);bySource.set(x.exitSource,(bySource.get(x.exitSource)||0)+1)}
const content=modeled.map(x=>JSON.stringify(x)).join('\n')+'\n';
fs.writeFileSync(O+'/v4-native-lifecycle-modeled-exits.jsonl',content);
fs.writeFileSync(O+'/v4-native-lifecycle-unresolved.jsonl',unresolved.map(x=>JSON.stringify(x)).join('\n')+(unresolved.length?'\n':''));
const summary={schema:'disdex-v4-native-production-lifecycle-exit-replay/v1',status:'RESEARCH_PRICE_MODEL_NOT_VENUE_FILL',
 sourceCandidates:rows.length,modeled:modeled.length,unresolved:unresolved.length,collisions:collision.length,
 byExitReason:counts(byReason),byExitSpec:counts(bySpec),byExitSource:counts(bySource),
 outputSHA256:sha(content),inputTapeSHA256:sha(fs.readFileSync(P)),
 limitations:['M5 policy before H1 when timestamps coincide; collision audit retained','desiredV4FourRuleStop resident venue stop wiring not modeled here','cross-runner/V4 preemption not modeled here','Aster public OHLC price model, not signed fill']};
fs.writeFileSync(O+'/SUMMARY.json',JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(O+'/COLLISIONS.json',JSON.stringify(collision,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
