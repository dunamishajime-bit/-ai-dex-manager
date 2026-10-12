import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RankRow } from '../lib/realtime-ranking';
import { marketUniverseSymbols, parseMarketCandles, calculateMarketScore, orderMarketRows } from '../lib/server/realtime-universe-score';

const hour=3_600_000,now=Date.UTC(2026,9,12,12,30);
function createRaw(rate:number,missingAt=-1,old=false):unknown[][]{
 const earliest=now-now%hour-65*hour-(old?4*hour:0);
 return Array.from({length:65},(_,i)=>{
  const p=100*Math.pow(1+rate,i),timestamp=earliest+i*hour+(i>missingAt&&missingAt>=0?hour:0);
  return [timestamp,p*0.995,p*1.01,p*.99,p,100+i*2,timestamp+hour-1];
 });
}
function row(symbol:string,score:number|null):RankRow{
 return {id:'MARKET:'+symbol,symbol,logic:'MARKET',side:'WAIT',score,
  scoreKind:score===null?'UNAVAILABLE':'MARKET',scoreLabel:'Aster共通市場Score',
  gates:[],reason:'test',fresh:score!==null,checkedAt:now,rankingScope:'MARKET',
  rankingEligible:score!==null,rankingContractAvailable:true,sourceStatus:score!==null?'FRESH':'NOT_EVALUATED'};
}
test('universe contains every configured crypto and extra live crypto, never stocks or duplicate symbols',()=>{
 const input:RankRow[]=[row('ETHUSDT',52),{...row('XTRAUSDT',29),logic:'Idle Long'},
   {...row('AMZNUSDT',50),logic:'V52'}, {...row('—',null),logic:'V12_V4'}];
 const symbols=marketUniverseSymbols(input);
 for(const symbol of ['BTCUSDT','SOLUSDT','PENGUUSDT','FETUSDT','HYPEUSDT','ZECUSDT','XTRAUSDT']){
  assert.ok(symbols.includes(symbol),symbol);
 }
 assert.equal(symbols.includes('AMZNUSDT'),false);
 assert.equal(symbols.length,new Set(symbols).size);
});
test('market score uses a single continuous bounded 0-100 formula with market-sensitive values',()=>{
 const strong=parseMarketCandles(createRaw(.006),now);
 const weak=parseMarketCandles(createRaw(-.004),now);
 assert.ok(strong&&weak);
 const good=calculateMarketScore(strong,2);
 const poor=calculateMarketScore(weak,2);
 assert.ok(good&&poor);
 assert.ok(good.score>poor.score,JSON.stringify({good:good.score,poor:poor.score}));
 assert.ok(good.score>=0&&good.score<=100);
 assert.ok(poor.score>=0&&poor.score<=100);
 assert.equal(Object.values(good.parts).reduce((s,x)=>s+x,0).toFixed(2),good.score.toFixed(2));
 assert.ok(Object.keys(good.features).includes('volumeRatio'));
 assert.equal(calculateMarketScore(strong.slice(-20),2),null);
});
test('zero remains numeric, null unranked at bottom, score rank is descending',()=>{
 const rows=orderMarketRows([row('BTCUSDT',80.12),row('ETHUSDT',84.5),row('SOLUSDT',74.8),row('XRPUSDT',null),row('ZECUSDT',0)]);
 assert.deepEqual(rows.map(r=>r.symbol),['ETHUSDT','BTCUSDT','SOLUSDT','ZECUSDT','XRPUSDT']);
 assert.deepEqual(rows.map(r=>r.sourceRank),[1,2,3,undefined,undefined]);
 assert.equal(rows[3].score,0);
 assert.equal(rows[4].score,null);
});
test('no stale, gapped, malformed or future candle series is scored',()=>{
 assert.ok(parseMarketCandles(createRaw(.001),now));
 assert.equal(parseMarketCandles(createRaw(.001,12),now),null);
 assert.equal(parseMarketCandles(createRaw(.001,-1,true),now),null);
 const bad=createRaw(.001);bad[40][2]=0;
 assert.equal(parseMarketCandles(bad,now),null);
 const future=createRaw(.001);
 future[64][6]=now+hour*2;
 assert.equal(parseMarketCandles(future,now),null);
});
