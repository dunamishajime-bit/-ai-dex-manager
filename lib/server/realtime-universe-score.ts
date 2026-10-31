import { DIST_TERMINAL_LIVE_CONFIG } from '@/lib/disterminal-live-config';
import type { Gate, RankRow } from '@/lib/realtime-ranking';

const ASTER_FAPI = 'https://fapi.asterdex.com/fapi/v1';
const HOUR = 3_600_000;
const CANDLE_TTL = 180_000;
const QUOTE_TTL = 25_000;
const MARKET_SCORE_LABEL = 'Aster共通市場Score（参考・発注非連動）';

export type MarketCandle = { openAt:number; closeAt:number; high:number; low:number; close:number; volume:number };
export type MarketScoreParts = {
 trend:number; momentum:number; relativeStrength:number; volume:number;
 structure:number; riskFit:number; bonus:number;
};
type MarketScore = { score:number; parts:MarketScoreParts; features:Record<string,number> };
type PriceQuote = { price:number; at:number };
const candlesCache = new Map<string,{until:number; value:MarketCandle[]|null}>();
let quoteCache:{until:number; value:Map<string,PriceQuote>}|undefined;
let quoteInflight:Promise<Map<string,PriceQuote>>|undefined;
const candleInflight = new Map<string,Promise<MarketCandle[]|null>>();
const clamp=(value:number,min=0,max=1)=>Math.min(max,Math.max(min,value));
const finite=(value:unknown)=>Number.isFinite(Number(value))?Number(value):NaN;
const round=(value:number)=>Number(value.toFixed(2));

/** The inventory is the configured crypto coverage plus actually observed crypto rows.
 * V52 equity tickers and error sentinels must not be presented as cryptocurrencies.
 */
export function marketUniverseSymbols(rows:RankRow[]):string[]{
 const symbols = new Set<string>([...DIST_TERMINAL_LIVE_CONFIG.cryptoSymbols,'FETUSDT','HYPEUSDT','ZECUSDT']);
 for(const row of rows) {
  if(row.logic==='V52'||row.logic==='MARKET')continue;
  const symbol=row.symbol.trim().toUpperCase();
  if(/^[A-Z0-9]{2,20}USDT$/.test(symbol))symbols.add(symbol);
 }
 return [...symbols].sort((a,b)=>a.localeCompare(b));
}
export function parseMarketCandles(payload:unknown,now:number):MarketCandle[]|null{
 if(!Array.isArray(payload))return null;
 const rows:MarketCandle[]=[];
 for(const raw of payload){
  if(!Array.isArray(raw)||raw.length<7)continue;
  const c={openAt:finite(raw[0]),closeAt:finite(raw[6]),high:finite(raw[2]),low:finite(raw[3]),close:finite(raw[4]),volume:finite(raw[5])};
  if(!Object.values(c).every(Number.isFinite)||c.closeAt>=now-1000)continue;
  if(c.openAt%HOUR!==0||c.closeAt!==c.openAt+HOUR-1||c.high<c.close||c.low>c.close||c.low<=0||c.volume<0)continue;
  rows.push(c);
 }
 const tail=rows.slice(-60);
 if(tail.length<50||tail.some((c,i)=>i>0&&c.openAt-tail[i-1].openAt!==HOUR))return null;
 if(now-tail[tail.length-1].closeAt>HOUR+60_000||tail[tail.length-1].closeAt>now)return null;
 return tail;
}

/** Single cross-symbol scale (0-100) from the same Aster market features.
 * Not a trading signal, not any strategy's native score, and not a win probability.
 * Uses only completed H1 candles plus a validated public quote when available.
 */
export function calculateMarketScore(candles:MarketCandle[],btcReturn24h:number,price?:number):MarketScore|null{
 if(candles.length<50||!Number.isFinite(btcReturn24h))return null;
 const latest=candles[candles.length-1],last=price!==undefined&&Number.isFinite(price)&&price>0?price:latest.close;
 const previous6=candles[candles.length-7].close,previous24=candles[candles.length-25].close;
 if(last<=0||previous6<=0||previous24<=0)return null;
 const prior24=candles.slice(-25,-1);
 const meanClose=prior24.reduce((sum,c)=>sum+c.close,0)/prior24.length;
 const prevHigh=Math.max(...prior24.map(c=>c.high)),prevLow=Math.min(...prior24.map(c=>c.low));
 const avgVolume=prior24.reduce((sum,c)=>sum+c.volume,0)/prior24.length;
 const volumeRatio=avgVolume>0?latest.volume/avgVolume:NaN;
 if(!Number.isFinite(volumeRatio))return null;
 const ranges=candles.slice(-24).map((c,i,arr)=>Math.max(c.high-c.low,Math.abs(c.high-(i?arr[i-1].close:prior24[prior24.length-1].close)),Math.abs(c.low-(i?arr[i-1].close:prior24[prior24.length-1].close))));
 const atrPct=ranges.reduce((sum,x)=>sum+x,0)/ranges.length/last*100;
 const ret6=(last/previous6-1)*100,ret24=(last/previous24-1)*100;
 const trendPct=(last/meanClose-1)*100,relative=ret24-btcReturn24h;
 const structure=(last-prevLow)/Math.max(1e-12,prevHigh-prevLow);
 const breakout=(last/prevHigh-1)*100;
 const parts:MarketScoreParts={
  trend:25*clamp(.5+trendPct/12),
  momentum:10*clamp(.5+ret6/12)+10*clamp(.5+ret24/24),
  relativeStrength:15*clamp(.5+relative/24),
  volume:10*clamp(volumeRatio/2),
  structure:10*clamp(structure),
  riskFit:5*clamp(1-Math.abs(atrPct-2.5)/7),
  bonus:15*clamp(.5+breakout/16),
 };
 const score=round(Object.values(parts).reduce((sum,n)=>sum+n,0));
 return {score,parts,features:{trendPct:round(trendPct),return6hPct:round(ret6),return24hPct:round(ret24),btcRelative24hPct:round(relative),volumeRatio:round(volumeRatio),structure:round(structure),atrPct:round(atrPct),breakoutPct:round(breakout)}};
}
export function orderMarketRows(rows:RankRow[]):RankRow[]{
 const ordered=[...rows].sort((a,b)=>{
  const aValid=a.fresh&&a.score!==null,bValid=b.fresh&&b.score!==null;
  return Number(bValid)-Number(aValid)||(b.score??-Infinity)-(a.score??-Infinity)||a.symbol.localeCompare(b.symbol);
 });
 let rank=0;
 return ordered.map(row=>{
  const eligible=row.fresh&&row.score!==null&&row.score>0;
  return {...row,sourceRank:eligible?++rank:undefined,rankingEligible:eligible,rankingContractAvailable:true};
 });
}
async function getCandles(symbol:string,now:number):Promise<MarketCandle[]|null>{
 const cached=candlesCache.get(symbol);
 if(cached&&cached.until>now)return cached.value;
 const running=candleInflight.get(symbol);if(running)return running;
 const job=(async()=>{
  let parsed:MarketCandle[]|null=null;
  try{
   const res=await fetch(ASTER_FAPI+'/klines?symbol='+encodeURIComponent(symbol)+'&interval=1h&limit=65',{cache:'no-store',signal:AbortSignal.timeout(6000)});
   if(res.ok)parsed=parseMarketCandles(await res.json(),Date.now());
  }catch{/* Explicit unavailable: no stale snapshot score fallback. */}
  candlesCache.set(symbol,{until:Date.now()+(parsed?CANDLE_TTL:25_000),value:parsed});
  return parsed;
 })().finally(()=>{candleInflight.delete(symbol);});
 candleInflight.set(symbol,job);return job;
}
async function getQuotes():Promise<Map<string,PriceQuote>>{
 const now=Date.now();
 if(quoteCache&&quoteCache.until>now)return quoteCache.value;
 if(quoteInflight)return quoteInflight;
 quoteInflight=(async()=>{
  const out=new Map<string,PriceQuote>();
  try{
   const res=await fetch(ASTER_FAPI+'/ticker/price',{cache:'no-store',signal:AbortSignal.timeout(6000)});
   if(res.ok){
    const data=await res.json();
    if(Array.isArray(data))for(const entry of data){
     const symbol=String(entry?.symbol??'').toUpperCase(),price=finite(entry?.price),at=finite(entry?.time);
     if(/^[A-Z0-9]{2,20}USDT$/.test(symbol)&&price>0&&Number.isFinite(at)&&at<=Date.now()+60_000&&Date.now()-at<=120_000)out.set(symbol,{price,at});
    }
   }
  }catch{/* Quotes are optional; completed bars remain consistent. */}
  quoteCache={until:Date.now()+(out.size?QUOTE_TTL:10_000),value:out};return out;
 })().finally(()=>{quoteInflight=undefined;});
 return quoteInflight;
}
function marketGate(label:string,actual:number,detail:string):Gate{
 return {key:label,label,state:'OK',actual,detail:'参考指標・注文判定に使用しません / '+detail,kind:'signal'};
}
function marketRow(symbol:string,now:number,value:MarketScore|null,reason:string):RankRow{
 const gates=value?Object.entries(value.features).map(([name,actual])=>marketGate(name,actual,MARKET_SCORE_LABEL)):[{key:'public-candles',label:'Aster公開1h確定足',state:'UNKNOWN' as const,detail:reason,kind:'signal' as const}];
 return {id:'MARKET:'+symbol,symbol,logic:'MARKET',side:'WAIT',score:value?.score??null,
  scoreKind:value?'MARKET':'UNAVAILABLE',scoreLabel:MARKET_SCORE_LABEL,gates,
  fresh:!!value,checkedAt:now,freshUntil:now+90_000,
  rankingScope:'MARKET',rankingEligible:false,rankingContractAvailable:!!value,
  sourceStatus:value?'FRESH':'NOT_EVALUATED',reason,
  ...(value?{sourceFeatures:value.features}:{}),
 };
}
/** Read-only, rate-cached public data. No private venue, order or risk APIs. */
export async function loadMarketUniverseRanking(rows:RankRow[],now=Date.now()):Promise<RankRow[]>{
 const symbols=marketUniverseSymbols(rows),data=new Map<string,MarketCandle[]|null>();
 const quotes=await getQuotes();
 // Limit concurrent venue requests; candles have a 3-minute cache.
 let next=0;await Promise.all(Array.from({length:Math.min(7,symbols.length)},async()=>{
  while(next<symbols.length){const symbol=symbols[next++];data.set(symbol,await getCandles(symbol,now));}
 }));
 const btc=data.get('BTCUSDT'),btcQuote=quotes.get('BTCUSDT');
 if(!btc)return orderMarketRows(symbols.map(s=>marketRow(s,now,null,'BTC比較基準の確定1h足が取得できません')));
 const btcReference=btcQuote?.price??btc[btc.length-1].close,btc24=(btcReference/btc[btc.length-25].close-1)*100;
 return orderMarketRows(symbols.map(symbol=>{
  const bars=data.get(symbol),quote=quotes.get(symbol);
  if(!bars)return marketRow(symbol,now,null,'Asterの有効な確定1h足が不足・取得失敗・非上場');
  const metric=calculateMarketScore(bars,btc24,quote?.price);
  return marketRow(symbol,now,metric,metric?('Aster公開価格と確定1h足から共通条件で算出。'+(quote?'価格取得 '+new Date(quote.at).toISOString():'確定足価格使用')+'。注文・発火判定とは無関係'):'公開市場指標不足・算出不可');
 }));
}
