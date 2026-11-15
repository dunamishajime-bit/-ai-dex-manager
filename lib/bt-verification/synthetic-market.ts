/**
 * Incremental, isolated, multi-symbol synthetic OHLCV source for BT research.
 *
 * Data supply only. No strategy decisions, source pin equivalence, execution,
 * PnL, STOP orders or LIVE APIs. Every emitted value is as-of the last
 * observed 5-minute tick. Historical tick paths are never loaded from venue.
 */
export const SYNTHETIC_FEED_SYMBOLS = [
  "BTCUSDT","ETHUSDT","SOLUSDT","HYPEUSDT","PENGUUSDT","FETUSDT",
  "AVAXUSDT","UNIUSDT","JUPUSDT","RENDERUSDT","DOTUSDT","TAOUSDT",
  "DOGEUSDT","NEARUSDT","AAVEUSDT",
  "AMZN","AAPL","MSFT","NVDA","META","TSLA","GOOGL","GOOG",
] as const;
/** Opt-in feed extension; v1 remains seed-reproducible and unchanged. */
export const SYNTHETIC_FEED_SYMBOLS_V2=[...SYNTHETIC_FEED_SYMBOLS,"TIAUSDT"] as const;
/** Further versioned extension: complete Q102 S3/S4 configured model universe. */
export const SYNTHETIC_FEED_SYMBOLS_V3=[...SYNTHETIC_FEED_SYMBOLS_V2,"APTUSDT","LDOUSDT"] as const;
/** Opt-in complete pinned V4 v12 X1 ALL native venue symbol universe. */
export const SYNTHETIC_FEED_SYMBOLS_V4=[...SYNTHETIC_FEED_SYMBOLS_V3,
  "BNBUSDT","LINKUSDT","INJUSDT","XRPUSDT","ADAUSDT","LTCUSDT","ATOMUSDT"] as const;
/** Opt-in Q102 legacy S1/S2 6-symbol study; five new tickers, TAO already in v1.
 * The legacy 18-row fixture is NOT an authenticated upstream S1/S2 universe.
 * This version must not assert 30 native raw stage IDs or actual trades. */
export const SYNTHETIC_FEED_SYMBOLS_V5=[
 ...SYNTHETIC_FEED_SYMBOLS_V4,
 "ONDOUSDT","SUIUSDT","OPUSDT","SEIUSDT","ARBUSDT"
] as const;
export type SyntheticSymbol = typeof SYNTHETIC_FEED_SYMBOLS_V5[number];
export type SyntheticFeedVersion="v1"|"v2"|"v3"|"v4"|"v5";
export type SyntheticKind = "crypto"|"stock";
export type SyntheticScenario = "trend"|"range"|"down"|"volatile"|"rotation";
export type MarketCandle5m = {
  symbol:SyntheticSymbol;category:SyntheticKind;
  openTime:string;closedAt:string;
  open:number;high:number;low:number;close:number;volume:number;
  ticks:number;partialSession:boolean;
};
export type SyntheticQuote = {
  symbol:SyntheticSymbol;category:SyntheticKind;price:number;
  bid:number;ask:number;volume5m:number;tradable:boolean;
};
export type SyntheticFunding = {symbol:SyntheticSymbol;timestamp:string;rate:number};
export type SyntheticStep={
  observedAt:string;tick:number;usdJpy:number;
  quotes:readonly SyntheticQuote[];
  completedH1:readonly MarketCandle5m[];
  completedM5:readonly MarketCandle5m[];
  funding:readonly SyntheticFunding[];
};
export type SyntheticFeedDescription = {
  schema:"disdex-bt-synthetic-feed-v1"|"disdex-bt-synthetic-feed-v2"|"disdex-bt-synthetic-feed-v3"|"disdex-bt-synthetic-feed-v4"|"disdex-bt-synthetic-feed-v5";seed:number;scenario:SyntheticScenario;
  start:string;endExclusive:string;intervalMinutes:5;
  symbols:readonly SyntheticSymbol[];fundingIntervalHours:8;warmupHoursRequired:96;
  equityCalendar:"NY_WEEKDAY_RTH_ONLY_NO_HOLIDAYS";
  researchParity:false;venueExecution:false;
  note:string;
};
const M5=300000,H1=3600000,H8=8*H1;
const startPeriod=Date.parse("2025-10-01T00:00:00Z");
const endPeriod=Date.parse("2026-04-01T00:00:00Z");
const profiles:Record<SyntheticSymbol,{kind:SyntheticKind;start:number;beta:number;sigma:number;volume:number}>={
 BTCUSDT:{kind:"crypto",start:108300,beta:1,sigma:.0012,volume:8e7},
 ETHUSDT:{kind:"crypto",start:4000,beta:.88,sigma:.0018,volume:4e7},
 SOLUSDT:{kind:"crypto",start:210,beta:1.2,sigma:.0026,volume:1.5e7},
 HYPEUSDT:{kind:"crypto",start:45,beta:.65,sigma:.003,volume:3e6},
 PENGUUSDT:{kind:"crypto",start:.014,beta:1.5,sigma:.005,volume:2e6},
 FETUSDT:{kind:"crypto",start:.6,beta:1.08,sigma:.0031,volume:3e6},
 AVAXUSDT:{kind:"crypto",start:30,beta:1.03,sigma:.0028,volume:3e6},
 UNIUSDT:{kind:"crypto",start:9,beta:1.0,sigma:.0028,volume:2e6},
 JUPUSDT:{kind:"crypto",start:.5,beta:1.2,sigma:.004,volume:3e6},
 RENDERUSDT:{kind:"crypto",start:3,beta:1.15,sigma:.0038,volume:2e6},
 DOTUSDT:{kind:"crypto",start:5,beta:.85,sigma:.0022,volume:2e6},
 TAOUSDT:{kind:"crypto",start:350,beta:1.25,sigma:.0038,volume:2e6},
 DOGEUSDT:{kind:"crypto",start:.19,beta:1.1,sigma:.003,volume:4e6},
 NEARUSDT:{kind:"crypto",start:3,beta:1.0,sigma:.0028,volume:2e6},
 AAVEUSDT:{kind:"crypto",start:260,beta:.9,sigma:.0027,volume:2e6},
 AMZN:{kind:"stock",start:220,beta:.8,sigma:.0013,volume:3e7},
 AAPL:{kind:"stock",start:235,beta:.7,sigma:.001,volume:3e7},
 MSFT:{kind:"stock",start:520,beta:.65,sigma:.00095,volume:3e7},
 NVDA:{kind:"stock",start:190,beta:1.25,sigma:.0021,volume:5e7},
 META:{kind:"stock",start:760,beta:1.0,sigma:.0015,volume:2e7},
 TSLA:{kind:"stock",start:450,beta:1.4,sigma:.0027,volume:5e7},
 GOOGL:{kind:"stock",start:250,beta:.78,sigma:.0012,volume:2e7},
 GOOG:{kind:"stock",start:250,beta:.78,sigma:.0012,volume:2e7},
 TIAUSDT:{kind:"crypto",start:5,beta:1.18,sigma:.004,volume:2e6},
 APTUSDT:{kind:"crypto",start:8,beta:1.13,sigma:.0033,volume:2.4e6},
 LDOUSDT:{kind:"crypto",start:1.3,beta:1.09,sigma:.0035,volume:1.8e6},
 BNBUSDT:{kind:"crypto",start:980,beta:.83,sigma:.0018,volume:1.2e7},
 LINKUSDT:{kind:"crypto",start:23,beta:1.1,sigma:.0025,volume:5e6},
 INJUSDT:{kind:"crypto",start:15,beta:1.28,sigma:.0037,volume:2.7e6},
 XRPUSDT:{kind:"crypto",start:2.2,beta:.94,sigma:.0027,volume:1.2e7},
 ADAUSDT:{kind:"crypto",start:.8,beta:.9,sigma:.0024,volume:9e6},
 LTCUSDT:{kind:"crypto",start:130,beta:.72,sigma:.002,volume:4.5e6},
 ATOMUSDT:{kind:"crypto",start:5.5,beta:.96,sigma:.0026,volume:2.1e6},
 ONDOUSDT:{kind:"crypto",start:.93,beta:1.14,sigma:.0041,volume:2.8e6},
 SUIUSDT:{kind:"crypto",start:3.15,beta:1.22,sigma:.0045,volume:6.4e6},
 OPUSDT:{kind:"crypto",start:1.35,beta:1.14,sigma:.0042,volume:3.6e6},
 SEIUSDT:{kind:"crypto",start:.23,beta:1.30,sigma:.0048,volume:2.3e6},
 ARBUSDT:{kind:"crypto",start:.58,beta:1.21,sigma:.0041,volume:4.3e6},
};
const check=(v:number)=>Number.isFinite(v)&&v>0;
const iso=(n:number)=>new Date(n).toISOString().replace(".000Z","Z");
const digits=(v:number)=>Number(v.toPrecision(12));
function rng(seed:number){
 let s=seed>>>0;
 return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return (s+.5)/4294967296};
}
function normal(next:()=>number):number{
 return Math.sqrt(-2*Math.log(next()))*Math.cos(2*Math.PI*next());
}
function nyRegularSession(timestamp:number,formatter:Intl.DateTimeFormat):boolean{
 const p=formatter.formatToParts(timestamp);
 const weekday=p.find(x=>x.type==="weekday")?.value;
 if(weekday==="Sat"||weekday==="Sun")return false;
 const h=Number(p.find(x=>x.type==="hour")?.value),m=Number(p.find(x=>x.type==="minute")?.value);
 // Interval ending at 09:35 NY reflects 09:30-09:35;
 // interval ending 16:00 reflects 15:55-16:00.
 const endMinutes=h*60+m;
 return endMinutes>=575&&endMinutes<=960;
}
type MutableBar={
  symbol:SyntheticSymbol;category:SyntheticKind;hour:number;
  open:number;high:number;low:number;close:number;volume:number;ticks:number;
};
export class SyntheticMarket5m {
 readonly description:SyntheticFeedDescription;
 readonly totalTicks:number;
 private next:()=>number;
 private stockFormatter=new Intl.DateTimeFormat("en-US",{
   timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
 private marketTick=0;
 private usdJpy=145;
 private prices=new Map<SyntheticSymbol,number>();
 private bars=new Map<SyntheticSymbol,MutableBar>();
 private completed=new Map<SyntheticSymbol,MarketCandle5m[]>();
 private mostRecentH1=new Map<SyntheticSymbol,MarketCandle5m>();
 private lastObservedAt:number;
 private startMs:number;
 private endMs:number;
 private symbols:readonly SyntheticSymbol[];
 constructor(seed:number,scenario:SyntheticScenario,
   options?:{start?:string;endExclusive?:string;version?:SyntheticFeedVersion}){
   if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error("SYNTHETIC_SEED_INVALID");
   if(!(["trend","range","down","volatile","rotation"] as const).includes(scenario))
     throw Error("SYNTHETIC_SCENARIO_INVALID");
   const start=options?.start??iso(startPeriod),end=options?.endExclusive??iso(endPeriod);
   const from=Date.parse(start),to=Date.parse(end);
   if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to||
     from%H1!==0||to%H1!==0||(to-from)/M5>53000||
     from<Date.parse("2025-01-01T00:00:00Z")||to>Date.parse("2027-01-01T00:00:00Z"))
     throw Error("SYNTHETIC_WINDOW_INVALID");
   if(options?.version!==undefined&&options.version!=="v1"&&options.version!=="v2"&&options.version!=="v3"&&options.version!=="v4"&&options.version!=="v5")
     throw Error("SYNTHETIC_VERSION_INVALID");
   const version=options?.version??"v1";
   this.symbols=version==="v5"?SYNTHETIC_FEED_SYMBOLS_V5:
    version==="v4"?SYNTHETIC_FEED_SYMBOLS_V4:
     version==="v3"?SYNTHETIC_FEED_SYMBOLS_V3:
     version==="v2"?SYNTHETIC_FEED_SYMBOLS_V2:SYNTHETIC_FEED_SYMBOLS;
   this.startMs=from;this.endMs=to;this.lastObservedAt=from;
   this.totalTicks=(to-from)/M5;this.next=rng(seed);
   for(const symbol of this.symbols){
      this.prices.set(symbol,profiles[symbol].start);
      this.completed.set(symbol,[]);
   }
   this.description=Object.freeze({
      schema:version==="v5"?"disdex-bt-synthetic-feed-v5":
          version==="v4"?"disdex-bt-synthetic-feed-v4":
         version==="v3"?"disdex-bt-synthetic-feed-v3":
         version==="v2"?"disdex-bt-synthetic-feed-v2":"disdex-bt-synthetic-feed-v1",
       seed,scenario,start:iso(from),
      endExclusive:iso(to),intervalMinutes:5,symbols:this.symbols,
      fundingIntervalHours:8,warmupHoursRequired:96,
      equityCalendar:"NY_WEEKDAY_RTH_ONLY_NO_HOLIDAYS" as const,
      researchParity:false as const,venueExecution:false as const,
      note:"Causal synthetic OHLCV 5-minute tick path. Stocks only use NY weekday regular trading hours, WITHOUT exchange holiday calendars, corporate actions or splits. No real market volume, FX or funding. Needs native per-runner adapters and independent risk engine before a multi-runner BT may be claimed."
   });
 }
 get tick(){return this.marketTick}
 get now(){return iso(this.lastObservedAt)}
 private drift(timestamp:number,scenario:SyntheticScenario,kind:SyntheticKind,ordinal:number):number{
  const t=(timestamp-this.startMs)/M5;
  const season=Math.sin(t/180)*.00008+Math.sin(t/1400)*.00005;
  if(scenario==="trend")return .000075+season;
  if(scenario==="down")return -.00008+season;
  if(scenario==="volatile")return .000015+season;
  if(scenario==="rotation")return (Math.floor(t/864)%2===ordinal%2?.00011:-.00011)+season;
  return season*.25;
 }
 private lastCandle(symbol:SyntheticSymbol):MarketCandle5m|null {
  return this.mostRecentH1.get(symbol)??null;
 }
 historyH1(symbol:SyntheticSymbol,limit=240):readonly MarketCandle5m[]{
   if(!this.prices.has(symbol)||!Number.isSafeInteger(limit)||limit<0||limit>6000)
     throw Error("SYNTHETIC_HISTORY_REQUEST_INVALID");
   return this.completed.get(symbol)!.slice(-limit).map(c=>({...c}));
 }
 latestH1(symbol:SyntheticSymbol):MarketCandle5m|null{
    const c=this.lastCandle(symbol);return c?{...c}:null;
 }
 /** In-progress H1 contains only price/volume ticks already emitted by step(). */
 formingH1(symbol:SyntheticSymbol):MarketCandle5m|null{
   if(!this.prices.has(symbol))throw Error("SYNTHETIC_SYMBOL_INVALID");
   const a=this.bars.get(symbol);
   if(!a)return null;
   return {symbol,category:a.category,openTime:iso(a.hour),closedAt:iso(a.hour+H1),
      open:a.open,high:a.high,low:a.low,close:a.close,volume:digits(a.volume),
      ticks:a.ticks,partialSession:a.ticks!==12};
 }
 step():SyntheticStep|null{
   if(this.marketTick>=this.totalTicks)return null;
   this.marketTick++;
   const observed=this.startMs+this.marketTick*M5;
   const hourStart=Math.floor((observed-1)/H1)*H1;
   const sessionOpen=nyRegularSession(observed,this.stockFormatter);
   const marketCommon=normal(this.next);
   const riskVol=this.description.scenario==="volatile"?2.1:1;
   let btcMove=0;
   const quotes:SyntheticQuote[]=[],newH1:MarketCandle5m[]=[],newM5:MarketCandle5m[]=[],funding:SyntheticFunding[]=[];
   this.usdJpy=digits(Math.max(80,Math.min(200,this.usdJpy*Math.exp(.00011*normal(this.next)))));
   let ordinal=0;
   for(const symbol of this.symbols){
     const profile=profiles[symbol],tradable=profile.kind==="crypto"||sessionOpen;
     const prev=this.prices.get(symbol)!;
     let move=0;
     let volume=0;
     if(tradable){
       const idio=normal(this.next);
       const drift=this.drift(observed,this.description.scenario,profile.kind,ordinal);
       if(symbol==="BTCUSDT") move=drift+profile.sigma*riskVol*marketCommon;
       else if(profile.kind==="crypto") move=drift*.7+profile.beta*btcMove*.58+profile.sigma*riskVol*idio*.8;
       else move=drift*.5+.0006*marketCommon*profile.beta+profile.sigma*riskVol*idio;
       if(this.description.scenario==="range")move-=Math.log(prev/profile.start)*.001;
       if(this.next()<.0007)move+=(this.next()<.5?-1:1)*(.006+this.next()*.006);
       move=Math.max(-.045,Math.min(.045,move));
       volume=digits(profile.volume/288*(.4+this.next()*1.2+Math.abs(move)*80));
     }
     const price=digits(Math.max(profile.start*.005,Math.min(profile.start*100,prev*Math.exp(move))));
     if(symbol==="BTCUSDT")btcMove=move;
     if(tradable)this.prices.set(symbol,price);
     const spread=price*(profile.kind==="crypto"?.00012:.00008);
     quotes.push({symbol,category:profile.kind,price,bid:digits(Math.max(.000000001,price-spread)),
        ask:digits(price+spread),volume5m:volume,tradable});
     const priorBar=this.bars.get(symbol);
     if(priorBar&&priorBar.hour!==hourStart){
       // Do not fabricate a complete hour from a stock session's missing ticks.
       const result:MarketCandle5m={symbol,category:profile.kind,openTime:iso(priorBar.hour),
         closedAt:iso(priorBar.hour+H1),open:priorBar.open,high:priorBar.high,
         low:priorBar.low,close:priorBar.close,volume:digits(priorBar.volume),
         ticks:priorBar.ticks,partialSession:priorBar.ticks!==12};
       this.completed.get(symbol)!.push(result);
       this.mostRecentH1.set(symbol,result);
       newH1.push({...result});
       this.bars.delete(symbol);
     }
     if(tradable){
       const m5:MarketCandle5m={symbol,category:profile.kind,openTime:iso(observed-M5),
         closedAt:iso(observed),open:prev,high:Math.max(prev,price),low:Math.min(prev,price),
         close:price,volume,ticks:1,partialSession:false};
       newM5.push(m5);
       const a=this.bars.get(symbol)??{symbol,category:profile.kind,hour:hourStart,
         open:prev,high:prev,low:prev,close:prev,volume:0,ticks:0};
       a.high=Math.max(a.high,price);a.low=Math.min(a.low,price);
       a.close=price;a.volume+=volume;a.ticks++;
       this.bars.set(symbol,a);
       if(observed%H8===0&&profile.kind==="crypto"){
         funding.push({symbol,timestamp:iso(observed),rate:digits(Math.max(-.0005,
           Math.min(.0005,.00003+move*.015)))});
       }
     }
     ordinal++;
   }
   // The current H1 bar becomes complete *after* its final tick.
   // Thus the 01:00 bar is available at 01:00, never at 00:55.
   if(observed%H1===0){
      for(const symbol of this.symbols){
         const a=this.bars.get(symbol);
         if(!a)continue;
         const result:MarketCandle5m={symbol,category:profiles[symbol].kind,
           openTime:iso(a.hour),closedAt:iso(observed),
           open:a.open,high:a.high,low:a.low,close:a.close,
           volume:digits(a.volume),ticks:a.ticks,partialSession:a.ticks!==12};
         this.completed.get(symbol)!.push(result);
         this.mostRecentH1.set(symbol,result);
         newH1.push({...result});
         this.bars.delete(symbol);
      }
   }
   this.lastObservedAt=observed;
   return {observedAt:iso(observed),tick:this.marketTick,usdJpy:this.usdJpy,
     quotes,completedH1:newH1,completedM5:newM5,funding};
 }
 /**
  * Consumes only events that the caller has already observed. For a six-month
  * market, 52,416 *ticks* are streamed without retaining the M5 tape.
  */
 runToEnd(onStep?:(step:SyntheticStep)=>void):number{
   while(true){const item=this.step();if(!item)break;onStep?.(item)}
   return this.marketTick;
 }
}
export const SYNTHETIC_DATA_REQUIREMENTS=Object.freeze({
 nativeEnginesConnected:[] as readonly string[],
 runnerFamilies:["V4","Q102","PENGU","FET","IDLE","V52","HYPE"] as const,
 note:"Market inputs are available but NO integrated native strategy decision adapters are wired. The standalone H48 research sampler is a separate, incomplete implementation."
});
