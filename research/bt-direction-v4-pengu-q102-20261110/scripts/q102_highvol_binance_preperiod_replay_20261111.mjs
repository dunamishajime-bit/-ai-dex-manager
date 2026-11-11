import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const ROOT='C:/tmp/disdex-bt-20251001-20261001';
const DATA=ROOT+'/PREPERIOD_TRAIN_20240101_20251001/Q102_HIGHVOL_BINANCE_PROXY';
const OUT=DATA;
const PIN=ROOT+'/pinned-source/Q102';
const pipe=await import(pathToFileURL(PIN+'/lib/disdex-quality102-causal-pipeline.ts').href);
const sigmod=await import(pathToFileURL(PIN+'/lib/disdex-quality102-causal-v1-signal.ts').href);
const v4mod=await import(pathToFileURL(PIN+'/lib/disdex-quality102-causal-v4-signal.ts').href);

const {computeQuality102HighVolFeatures,matchQuality102HighVolGrid,monthStartUtc,simulateQuality102HighVolExit}=pipe;
const {diagnoseQuality102HighVolSymbol}=sigmod;
const {buildQuality102CausalV4Signal}=v4mod;

const H=3600000;
const BEGIN=Date.parse('2025-01-01T00:00:00Z');
const END=Date.parse('2025-10-01T00:00:00Z');
const symbols=['SUIUSDT','SEIUSDT','APTUSDT','ARBUSDT','OPUSDT','ENAUSDT','ONDOUSDT','FILUSDT','TRXUSDT'];
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function load(sym){
 const p=DATA+'/'+sym+'-1h-20240101-20251001.jsonl.gz';
 const a=zlib.gunzipSync(fs.readFileSync(p)).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  .map(x=>({timestampMs:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],baseVolume:+x[5],quoteVolume:+x[7]}));
 for(let i=1;i<a.length;i++)if(a[i].timestampMs!==a[i-1].timestampMs+H)throw Error('H1_GAP_'+sym+'_'+i);
 return {a,first:a[0].timestampMs,sha256:sha(p)};
}
const data=Object.fromEntries(symbols.map(s=>[s,load(s)]));
const idx=(sym,t)=>(t-data[sym].first)/H;
function through(sym,t){
 const i=idx(sym,t);
 if(!Number.isInteger(i)||i<0||i>=data[sym].a.length)return undefined;
 return data[sym].a.slice(0,i+1);
}
const cache=new Map();
function monthly(sym,cutoff){
 const month=monthStartUtc(cutoff),key=sym+'|'+month;
 if(cache.has(key))return cache.get(key);
 const rows=through(sym,cutoff);
 if(!rows){const o={monthStart:month,selectionAvailable:false,health:false,reason:'NO_HISTORY_AT_CUTOFF'};cache.set(key,o);return o;}
 const d=diagnoseQuality102HighVolSymbol(sym,rows,cutoff);
 const o={monthStart:month,selectionAvailable:d.selectionAvailable,health:d.scannerHealthPass,rule:d.rule,metrics:d.metrics,reason:d.reason};
 cache.set(key,o);return o;
}
function matched(features,rule){
 if(!rule)return undefined;
 return matchQuality102HighVolGrid(features).find(c=>c.hardStop===rule.hardStop && (
  c.side===1 ? c.threshold===rule.longDrop&&c.rsi===rule.longRsi : c.threshold===rule.shortRally&&c.rsi===rule.shortRsi
 ))?.side;
}
const signals=[];
const monthlyAudit={};
for(let t=BEGIN;t<END;t+=H){
 const cutoff=t-H,candidates=[];
 for(const sym of symbols){
  const m=monthly(sym,cutoff);monthlyAudit[sym+'|'+m.monthStart]=m;
  if(!m.selectionAvailable||!m.health)continue;
  const i=idx(sym,cutoff);
  const ei=idx(sym,t);
  if(!Number.isInteger(i)||!Number.isInteger(ei)||i<336||ei<0||ei>=data[sym].a.length)continue;
  const f=computeQuality102HighVolFeatures(data[sym].a,i);
  const side=matched(f,m.rule);if(side===undefined)continue;
  const x=m.metrics;
  const score=30*x.winRate+10*Math.min(x.profitFactor,3)+200*Math.max(-.05,Math.min(.10,x.expectancy))
   +60*Math.min(Math.abs(f.ret24),.25)+30*Math.min(f.atrPct,.08)+2*Math.min(f.volumeRatio,3);
  candidates.push({id:'HIGH_VOL_PROXY:'+sym+':'+f.signalTs,symbol:sym,side,score,features:f,rule:m.rule,metrics:m.metrics,
   entryTs:t,dataCutoffTs:cutoff,hardStop:m.rule.hardStop,maxHoldHours:72,requestedGross:side===1?1:.6,family:'HIGH_VOL',layer:'S1',
   entryPrice:data[sym].a[ei].open});
 }
 candidates.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol)||a.id.localeCompare(b.id));
 if(candidates[0])signals.push({...candidates[0],candidateCount:candidates.length});
}
console.log('HIGHVOL_PROXY_SIGNALS',signals.length);

let parityMismatch=0;
for(const z of signals){
 const hist={candlesBySymbol:{},entryOpenBySymbol:{}};
 let ready=true;
 for(const sym of symbols){
  const ci=idx(sym,z.dataCutoffTs),ei=idx(sym,z.entryTs);
  if(!Number.isInteger(ci)||!Number.isInteger(ei)||ci<0||ei<0||ei>=data[sym].a.length){ready=false;break;}
  hist.candlesBySymbol[sym]=data[sym].a.slice(0,ci+1);
  hist.entryOpenBySymbol[sym]={timestampMs:z.entryTs,open:data[sym].a[ei].open};
 }
 if(!ready){z.parity='UNRESOLVED_HISTORY';continue;}
 const full=buildQuality102CausalV4Signal({history:hist,decisionTs:z.entryTs,sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false}},
                                         {highVolSymbols:symbols});
 const ok=full.side===z.side&&full.symbol===z.symbol&&full.family==='HIGH_VOL'&&Math.abs(full.requestedGross-z.requestedGross)<1e-12;
 z.parity=ok?'PASS':'MISMATCH';
 if(!ok){parityMismatch++;z.parityFull=full;}
}

const modeled=[],unresolved=[];
for(const z of signals){
 const a=data[z.symbol].a,ii=idx(z.symbol,z.entryTs);
 if(!Number.isInteger(ii)||ii<0){unresolved.push({...z,unresolved:'ENTRY_MISSING'});continue;}
 const future=a.slice(ii,ii+72);
 if(future.length<72){unresolved.push({...z,unresolved:'FUTURE_LT_72H',futureHours:future.length});continue;}
 const ex=simulateQuality102HighVolExit({side:z.side,entryPrice:z.entryPrice,hardStop:z.hardStop,bars:future});
 if(!ex||!Number.isFinite(ex.exitTs)||!Number.isFinite(ex.exitPrice)){unresolved.push({...z,unresolved:'EXIT_UNRESOLVED'});continue;}
 const rawReturn=z.side===1?ex.exitPrice/z.entryPrice-1:z.entryPrice/ex.exitPrice-1;
 modeled.push({...z,exitTs:ex.exitTs,exitPrice:ex.exitPrice,exitReason:ex.exitReason,holdHours:ex.holdHours,rawReturn});
}

const body=modeled.map(x=>JSON.stringify(x)).join('\n')+(modeled.length?'\n':'');
fs.writeFileSync(OUT+'/q102-highvol-pretarget-proxy-exits.jsonl',body);
fs.writeFileSync(OUT+'/q102-highvol-pretarget-proxy-unresolved.jsonl',unresolved.map(x=>JSON.stringify(x)).join('\n')+(unresolved.length?'\n':''));
fs.writeFileSync(OUT+'/q102-highvol-pretarget-monthly-audit.json',JSON.stringify(monthlyAudit,null,2)+'\n');

function metric(a,bps=30){
 const v=a.map(z=>z.rawReturn-bps/10000);
 const gp=v.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=-v.filter(x=>x<0).reduce((a,b)=>a+b,0);
 return {n:v.length,wr:v.length?v.filter(x=>x>0).length/v.length:null,mean:v.length?v.reduce((a,b)=>a+b,0)/v.length:null,
  sum:v.reduce((a,b)=>a+b,0),pf:gl?gp/gl:(gp?999:null)};
}
const bySymbol=Object.fromEntries(symbols.map(s=>[s,metric(modeled.filter(z=>z.symbol===s),30)]));
const recentCut=END-90*86400000;
const bySymbolRecent90=Object.fromEntries(symbols.map(s=>[s,metric(modeled.filter(z=>z.symbol===s&&z.entryTs>=recentCut&&z.entryTs<END&&z.exitTs<=END),30)]));
const summary={
 status:'Q102_HIGHVOL_BINANCE_PRETARGET_PROXY_CURRENT_PIN',
 period:[new Date(BEGIN).toISOString(),new Date(END).toISOString()],
 signals:signals.length,modeled:modeled.length,unresolved:unresolved.length,parityMismatch,
 parityChecked:signals.filter(z=>z.parity==='PASS'||z.parity==='MISMATCH').length,
 bySymbol,bySymbolRecent90,
 inputHashes:Object.fromEntries(symbols.map(s=>[s,data[s].sha256])),
 outputSha256:crypto.createHash('sha256').update(body).digest('hex'),
 limitations:[
  'Binance UM is a venue proxy, not Aster.',
  'HIGH_VOL volume-based features may be venue-sensitive; proxy-to-Aster validation is required before promotion.',
  'Late-September candidates without 72 hours of pre-2025-10-01 future bars are unresolved and excluded from completed-outcome health.'
 ]
};
fs.writeFileSync(OUT+'/HIGHVOL_PRETARGET_PROXY_SUMMARY.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
