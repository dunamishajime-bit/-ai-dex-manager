/** Uses the pinned Production signal function; no exchange execution adapter. */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildHypeTrendSignal,type HypeTrendCandle} from '../../lib/hype-trend-long-signal';
const [root,output]=process.argv.slice(2);
const H=3600000,start=Date.parse('2025-08-10T00:00:00Z'),end=Date.parse('2026-08-11T00:00:00Z');
const load=(symbol:string)=>new Map<number,HypeTrendCandle>(readFileSync(join(root,'normalized/aster/klines',symbol+'.jsonl'),'utf8').trim().split(/\r?\n/).map(line=>{
 const r=JSON.parse(line);return [Number(r.event_time_ms),{openTime:Number(r.event_time_ms),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.base_volume)}];
}));
const btc=load('BTCUSDT'),hype=load('HYPEUSDT');
const lines=[];
for(let ts=start;ts<end;ts+=H){
 const history=(market:Map<number,HypeTrendCandle>)=>Array.from({length:360},(_,i)=>market.get(ts-(360-i)*H)).filter((r):r is HypeTrendCandle=>!!r);
 const b=history(btc),h=history(hype);
 const sourceCurrent=b.at(-1)?.openTime===ts-H&&h.at(-1)?.openTime===ts-H&&[...b,...h].every(r=>r.volume>0);
 const signal=buildHypeTrendSignal({btc:b,hype:h,now:ts});
 lines.push(JSON.stringify({decisionTs:ts,sourceCurrent,signal}));
}
writeFileSync(output,lines.join('\n')+'\n');console.log(JSON.stringify({hours:lines.length,output}));
