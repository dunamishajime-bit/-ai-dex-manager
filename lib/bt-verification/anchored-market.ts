/**
 * Seeded synthetic OHLC generator. Never used for production fills or live orders.
 * Actual previous-day close must be supplied by a separately verified source.
 */
export type AnchoredCandle={time:string;open:number;high:number;low:number;close:number};
export type AnchoredSymbol={symbol:string;anchorClose:number};
export type AnchoredMarketConfig={
  startDate:string;endDate:string;seed:number;symbols:AnchoredSymbol[];
  maxBars?:number;
};
function rngFromSeed(seed:number){
  let state=(seed>>>0)||1;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
function gaussian(random:()=>number){
  const a=Math.max(1e-12,random()),b=random();
  return Math.sqrt(-2*Math.log(a))*Math.cos(2*Math.PI*b);
}
function parseDay(day:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error("INVALID_DATE");
  const ms=Date.parse(day+"T00:00:00.000Z");
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==day)throw new Error("INVALID_DATE");
  return ms;
}
function round(value:number){return Number(value.toPrecision(12));}
export function createAnchoredMarket(config:AnchoredMarketConfig):Record<string,AnchoredCandle[]>{
  const start=parseDay(config.startDate),end=parseDay(config.endDate);
  if(end<start)throw new Error("REVERSED_PERIOD");
  const bars=Math.floor((end-start)/86400000)+1;
  if(bars>(config.maxBars??3660))throw new Error("TOO_MANY_BARS");
  if(!config.symbols.length)throw new Error("NO_SYMBOLS");
  if(!Number.isInteger(config.seed))throw new Error("INVALID_SEED");
  const random=rngFromSeed(config.seed);
  const seen=new Set<string>();
  const output:Record<string,AnchoredCandle[]>={};
  // Shared shocks induce cross-symbol co-movement; independent shocks allow dispersion.
  const shared=Array.from({length:bars-1},()=>gaussian(random));
  for(const item of config.symbols){
    if(!/^[A-Z0-9_-]{2,32}$/.test(item.symbol)||seen.has(item.symbol))throw new Error("INVALID_SYMBOL");
    seen.add(item.symbol);
    if(!Number.isFinite(item.anchorClose)||item.anchorClose<=0)throw new Error("INVALID_ANCHOR_CLOSE");
    const closes=Array<number>(bars);
    closes[bars-1]=item.anchorClose;
    const idiosyncratic=Array.from({length:bars-1},()=>gaussian(random));
    // Reverse construction ensures the exact requested end-date close is preserved.
    for(let i=bars-2;i>=0;i--){
      const shock=Math.max(-0.18,Math.min(0.18,0.025*(0.7*shared[i]+0.714*idiosyncratic[i])));
      closes[i]=round(closes[i+1]*Math.exp(-shock));
    }
    const candles:AnchoredCandle[]=[];
    for(let i=0;i<bars;i++){
      const open=i===0?round(closes[0]*Math.exp(-0.005*gaussian(random))):closes[i-1];
      const close=closes[i];
      const wick=Math.abs(gaussian(random))*0.007;
      const high=round(Math.max(open,close)*(1+wick));
      const low=round(Math.min(open,close)*Math.max(0.0001,1-wick));
      candles.push({time:new Date(start+i*86400000).toISOString().slice(0,10),open,high,low,close});
    }
    output[item.symbol]=candles;
  }
  return output;
}
/** A replay engine must only receive this prefix at simulation time; never the full generated market. */
export function observedCandlesAt(candles:AnchoredCandle[],dateInclusive:string):AnchoredCandle[]{
  return candles.filter(c=>c.time<=dateInclusive);
}