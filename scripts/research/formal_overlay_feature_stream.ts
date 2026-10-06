/** Closed-H1 features from the ACTUAL retained Production signal functions.
 * No canonical 63 timestamp list, accepted-trade schedule or future PnL input.
 */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {computeIdlePriorityFeatures, evaluateIdleGenericCandidate, evaluateIdlePriorityShort, type IdleH1Candle} from '../../lib/idle-priority-short-signal';
import {evaluateIdleResidualLongFeatures} from '../../lib/idle-residual-long-signal';

const [dataRoot, output] = process.argv.slice(2);
if (!dataRoot || !output) throw new Error('USAGE: DATA_ROOT OUTPUT_JSONL');
const H=3600000, start=Date.parse('2025-08-10T00:00:00Z'), end=Date.parse('2026-08-11T00:00:00Z');
const idleSymbols=['TAOUSDT','TIAUSDT','DOTUSDT','JUPUSDT','RENDERUSDT'] as const;
const symbols=['BTCUSDT',...idleSymbols,'DOGEUSDT','AVAXUSDT'];
const market=new Map<string,Map<number,IdleH1Candle>>();
for(const symbol of symbols){
 const parsed=readFileSync(join(dataRoot,'normalized/aster/klines',symbol+'.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const candles=parsed.map(r=>({ts:Number(r.event_time_ms),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),quoteVolume:Number(r.quote_volume ?? r.quoteVolume ?? r.quote_asset_volume ?? r.quoteAssetVolume ?? r.quote_volume_usd)}));
 const map=new Map(candles.map(r=>[r.ts,r]));
 if(map.size!==candles.length)throw new Error('DUPLICATED_H1:'+symbol);
 market.set(symbol,map);
}
const lines:string[]=[];
for(let ts=start;ts<end;ts+=H){
 const closed=(symbol:string)=>Array.from({length:74},(_,i)=>market.get(symbol)!.get(ts-(74-i)*H)).filter((r):r is IdleH1Candle=>!!r);
 const btc=closed('BTCUSDT');
 const row:{decisionTs:number;idle:unknown[];long:unknown[];errors:unknown[]}={decisionTs:ts,idle:[],long:[],errors:[]};
 for(const symbol of [...idleSymbols,'DOGEUSDT','AVAXUSDT'] as const){
  try{
   const f=computeIdlePriorityFeatures(ts,closed(symbol),btc);
   if(symbol==='DOGEUSDT'||symbol==='AVAXUSDT')row.long.push(evaluateIdleResidualLongFeatures(symbol,f));
   else {const generic=evaluateIdleGenericCandidate(f);row.idle.push({symbol,generic,signal:evaluateIdlePriorityShort(symbol,f,generic)});}
  }catch(error){row.errors.push({symbol,reason:error instanceof Error?error.message:String(error)});}
 }
 lines.push(JSON.stringify(row));
}
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,lines.join('\n')+'\n');
console.log(JSON.stringify({status:'PRODUCTION_OVERLAY_FEATURE_SCAN_COMPLETE',hours:lines.length,output}));
