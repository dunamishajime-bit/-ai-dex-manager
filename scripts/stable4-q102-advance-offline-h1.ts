/** Offline-only Q102 causal H1 catch-up. Private copied state; no client or venue access. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync,existsSync} from 'node:fs';
import {isAbsolute,basename,resolve} from 'node:path';
import {Stable4Q102OnlineEngine} from '../lib/disdex-quality102-stable4-online';
import {historicalQ102History} from '../lib/stable4-q102-bootstrap-history';
import type {Quality102Candle} from '../lib/disdex-quality102-causal-pipeline';
const H=3600000;
const arg=(key:string)=>{const i=process.argv.indexOf(key),v=i>=0?process.argv[i+1]:undefined;
  if(!v||v.startsWith('--'))throw Error('OFFLINE_H1_ARGUMENT_REQUIRED:'+key);return v;};
const statePath=arg('--state-path'),sourcePath=arg('--rolling-h1'),summaryPath=arg('--summary-path');
const expectedState=arg('--expected-old-state-sha'),expectedSource=arg('--expected-source-sha');
const firstMs=Number(arg('--expected-first-new-ts')),lastMs=Number(arg('--expected-last-new-ts'));
if(![statePath,sourcePath,summaryPath].every(isAbsolute)
  ||new Set([resolve(statePath),resolve(sourcePath),resolve(summaryPath)]).size!==3
  ||!basename(statePath).startsWith('offline-')
  ||!/^[a-f0-9]{64}$/.test(expectedState)||!/^[a-f0-9]{64}$/.test(expectedSource)
  ||![firstMs,lastMs].every(Number.isSafeInteger)||firstMs%H!==0||lastMs%H!==0
  ||lastMs<firstMs||lastMs-firstMs>48*H||lastMs+H>Date.now()
  ||existsSync(summaryPath))throw Error('OFFLINE_H1_SOURCE_SCOPE_INVALID');
for(const path of [statePath,sourcePath]){const s=lstatSync(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size<=0||s.size>50_000_000)
    throw Error('OFFLINE_H1_SOURCE_METADATA_INVALID');}
const rawState=readFileSync(statePath),rawSource=readFileSync(sourcePath);
const digest=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
if(digest(rawState)!==expectedState||digest(rawSource)!==expectedSource)
  throw Error('OFFLINE_H1_SOURCE_SHA_MISMATCH');
const source=JSON.parse(rawSource.toString('utf8')),state=JSON.parse(rawState.toString('utf8'));
if(source.version!==1||source.symbols?.length!==20||new Set(source.symbols).size!==20
  ||state.schemaVersion!==1||!Array.isArray(state.recoveryUnresolved)
  ||!source.candlesBySymbol||source.symbols.some((s:string)=>!Array.isArray(source.candlesBySymbol[s])))
  throw Error('OFFLINE_H1_SCHEMA_INVALID');
const obs=state.observedThrough;
if(!Number.isSafeInteger(obs)||obs+H!==firstMs)throw Error('OFFLINE_H1_FRONTIER_MISMATCH');
const candles:Record<string,Quality102Candle[]>={};
for(const symbol of source.symbols as string[]){
  const rows=source.candlesBySymbol[symbol] as Quality102Candle[];
  if(rows.length!==source.historyHours||rows.at(-1)?.timestampMs!==lastMs
    ||rows.some((r,i)=>i>0&&r.timestampMs-rows[i-1].timestampMs!==H))
    throw Error('OFFLINE_H1_COVERAGE_MISMATCH:'+symbol);
  candles[symbol]=rows;
}
const highVolSymbols=['SUIUSDT','SEIUSDT','APTUSDT','ARBUSDT','OPUSDT','ENAUSDT','ONDOUSDT','FILUSDT','TRXUSDT'];
const engine=new Stable4Q102OnlineEngine({
 mode:'LIVE',statePath,
 recoverySeedPath:'config/stable4/q102-online-recovery-seed-20261114.json',
 avaxSeedPath:'config/stable4/q102-avax-knn-seed-20261114.json',
 highVolSymbols,requireHourlyCoverage:true,
});
if(engine.learningStatus().observedThrough!==obs)
  throw Error('OFFLINE_H1_LOADED_STATE_FRONTIER_MISMATCH');
let ticks=0;
for(let t=firstMs;t<=lastMs;t+=H){
  engine.observe(historicalQ102History(candles,t),t);
  ticks++;
}
const after=JSON.parse(readFileSync(statePath,'utf8'));
if(after.observedThrough!==lastMs)throw Error('OFFLINE_H1_OBSERVATION_NOT_ADVANCED');
const requests=engine.pendingEvidenceRequests(lastMs+H);
const summary={
 schema:'disdex-stable4-q102-offline-h1-catchup/v1',
 status:'OFFLINE_H1_CAUSAL_OBSERVATIONS_ADVANCED_UNCERTIFIED',
 observedFrom:obs,observedThrough:lastMs,ticksObserved:ticks,
 sourceSha256:expectedSource,beforeStateSha256:expectedState,
 afterStateSha256:digest(readFileSync(statePath)),
 recoveryCompleted:after.recoveryRows?.length,
 recoveryPending:after.recoveryPending?.length,
 recoveryUnresolved:after.recoveryUnresolved?.length,
 avaxCompleted:after.avaxRows?.length,
 avaxPending:after.avaxPending?.length,
 evidenceRequestCount:requests.length,
 requestsBySymbol:requests.reduce((m:Record<string,number>,r)=>{m[r.symbol]=(m[r.symbol]||0)+1;return m;},{}),
 sourceIsPrivateCopiedState:true,ordersSent:0,productionChanged:false,
};
writeFileSync(summaryPath,JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(summary));
