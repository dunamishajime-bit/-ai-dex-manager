import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const ROOT='C:/tmp/disdex-bt-20251001-20261001';
const {computeQuality102HighVolFeatures,matchQuality102HighVolGrid,monthStartUtc}=await import(pathToFileURL(ROOT+'/pinned-source/Q102/lib/disdex-quality102-causal-pipeline.ts').href);
const {diagnoseQuality102HighVolSymbol}=await import(pathToFileURL(ROOT+'/pinned-source/Q102/lib/disdex-quality102-causal-v1-signal.ts').href);
const {buildQuality102CausalV4Signal}=await import(pathToFileURL(ROOT+'/pinned-source/Q102/lib/disdex-quality102-causal-v4-signal.ts').href);
const OUT=ROOT+'/Q102_CURRENT_PRODUCTION_REPLAY_AUDIT_20261110'; fs.mkdirSync(OUT,{recursive:true});
const H=3600000,BEGIN=Date.parse('2025-10-01T00:00:00Z'),READY=Date.parse('2026-06-20T15:00:00Z'),END=Date.parse('2026-10-01T00:00:00Z');
const symbols=['SUIUSDT','SEIUSDT','APTUSDT','ARBUSDT','OPUSDT','ENAUSDT','ONDOUSDT','FILUSDT','TRXUSDT'];
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function load(sym){
 const p=ROOT+'/aster-public-v3-h1-q102-warmup/'+sym+'-1h-20250301-20261001.jsonl.gz';
 const b=fs.readFileSync(p);
 const a=zlib.gunzipSync(b).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse).map(x=>({
  timestampMs:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],baseVolume:+x[5],quoteVolume:+x[7]
 }));
 for(let i=1;i<a.length;i++)if(a[i].timestampMs!==a[i-1].timestampMs+H)throw Error('H1_GAP_'+sym+'_'+i);
 return {a,first:a[0].timestampMs,sha256:sha(p)};
}
const data=Object.fromEntries(symbols.map(s=>[s,load(s)]));
const idx=(sym,t)=>(t-data[sym].first)/H;
const sliceThrough=(sym,t)=>{const i=idx(sym,t); if(!Number.isInteger(i)||i<0||i>=data[sym].a.length)throw Error('MISSING_'+sym+'_'+t); return data[sym].a.slice(0,i+1)};
const cache=new Map();
function monthly(sym,cutoff){
 const month=monthStartUtc(cutoff),key=sym+'|'+month;
 if(cache.has(key))return cache.get(key);
 const d=diagnoseQuality102HighVolSymbol(sym,sliceThrough(sym,cutoff),cutoff);
 const o={monthStart:month,selectionAvailable:d.selectionAvailable,health:d.scannerHealthPass,rule:d.rule,metrics:d.metrics,reason:d.reason};
 cache.set(key,o);return o;
}
function matched(features,rule){
 if(!rule)return undefined;
 return matchQuality102HighVolGrid(features).find(c=>c.hardStop===rule.hardStop && (
  c.side===1 ? c.threshold===rule.longDrop&&c.rsi===rule.longRsi : c.threshold===rule.shortRally&&c.rsi===rule.shortRsi
 ))?.side;
}
const rows=[],monthlyAudit={};
for(let t=READY;t<END;t+=H){
 const cutoff=t-H,candidates=[];
 for(const sym of symbols){
  const m=monthly(sym,cutoff); monthlyAudit[sym+'|'+m.monthStart]=m;
  if(!m.selectionAvailable||!m.health)continue;
  const i=idx(sym,cutoff); if(!Number.isInteger(i)||i<336)throw Error('FEATURE_INDEX_'+sym+'_'+cutoff);
  const f=computeQuality102HighVolFeatures(data[sym].a,i);
  const side=matched(f,m.rule); if(side===undefined)continue;
  const x=m.metrics;
  const score=30*x.winRate+10*Math.min(x.profitFactor,3)+200*Math.max(-.05,Math.min(.10,x.expectancy))
   +60*Math.min(Math.abs(f.ret24),.25)+30*Math.min(f.atrPct,.08)+2*Math.min(f.volumeRatio,3);
  candidates.push({id:'HIGH_VOL:'+sym+':'+f.signalTs,symbol:sym,side,score,features:f,rule:m.rule,metrics:m.metrics,
   entryTs:t,dataCutoffTs:cutoff,hardStop:m.rule.hardStop,maxHoldHours:72,requestedGross:side===1?1:.6,family:'HIGH_VOL',layer:'S1'});
 }
 candidates.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol)||a.id.localeCompare(b.id));
 if(candidates[0])rows.push({...candidates[0],candidateCount:candidates.length});
}
let parityChecked=0,parityMismatch=0;
for(const z of rows.slice(0,Math.min(40,rows.length))){
 const hist={candlesBySymbol:{},entryOpenBySymbol:{}};
 for(const sym of symbols){
  const ci=idx(sym,z.dataCutoffTs),ei=idx(sym,z.entryTs);
  if(!Number.isInteger(ci)||!Number.isInteger(ei))throw Error('PARITY_INDEX');
  hist.candlesBySymbol[sym]=data[sym].a.slice(Math.max(0,ci-5399),ci+1);
  hist.entryOpenBySymbol[sym]={timestampMs:z.entryTs,open:data[sym].a[ei].open};
 }
 const full=buildQuality102CausalV4Signal({history:hist,decisionTs:z.entryTs,sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false}});
 parityChecked++;
 if(full.side!==z.side||full.symbol!==z.symbol||full.family!=='HIGH_VOL'||Math.abs(full.requestedGross-z.requestedGross)>1e-12||full.exitPolicy!=='HIGH_VOL_TRAIL72'){
  parityMismatch++; console.log('PARITY_MISMATCH',JSON.stringify({z,full}));
 }
}
const body=rows.map(x=>JSON.stringify(x)).join('\n')+(rows.length?'\n':'');
fs.writeFileSync(OUT+'/q102-high-vol-production-signals.jsonl',body);
fs.writeFileSync(OUT+'/q102-high-vol-monthly-audit.json',JSON.stringify(monthlyAudit,null,2)+'\n');
const summary={status:'CURRENT_PRODUCTION_Q102_HIGH_VOL_V4_PARITY_REPLAY',period:[new Date(BEGIN).toISOString(),new Date(END).toISOString()],
 failClosedUntil:new Date(READY).toISOString(),reason:'FILUSDT first H1 2025-11-07T15:00Z + 5400h Production history requirement',
 configuredSymbols:symbols,signals:rows.length,bySide:{LONG:rows.filter(x=>x.side===1).length,SHORT:rows.filter(x=>x.side===-1).length},
 bySymbol:Object.fromEntries(symbols.map(s=>[s,rows.filter(x=>x.symbol===s).length])),parityChecked,parityMismatch,
 inputHashes:Object.fromEntries(symbols.map(s=>[s,data[s].sha256])),outputSha256:crypto.createHash('sha256').update(body).digest('hex')};
fs.writeFileSync(OUT+'/HIGH_VOL_SUMMARY.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));