import {writeFileSync} from "node:fs";
import {buildQuality102CausalV4Signal} from "../lib/disdex-quality102-causal-v4-signal";
import {simulateQuality102HighVolExit,type Quality102Candle} from "../lib/disdex-quality102-causal-pipeline";
import {buildHypeTrendSignal,type HypeTrendCandle} from "../lib/hype-trend-long-signal";
import {HYPE_TREND_LONG_POLICY as HP} from "../config/hypeTrendLongPolicy";
import {calculateWalletRiskStop,moreProtectiveStop} from "../lib/disdex-exit-overlay-contract";
const H=3600000,T=Date.UTC(2025,0,1),DAYS=280,COUNT=DAYS*24;
type Symbol="BTCUSDT"|"PENGUUSDT"|"SOLUSDT"|"HYPEUSDT";
const SYMBOLS:Symbol[]=["BTCUSDT","PENGUUSDT","SOLUSDT","HYPEUSDT"];
const REGIMES=[["BULL",.005,.035],["BEAR",-.006,.06],["RANGE",0,.04],["REVERSAL",.006,.06]] as const;
function prng(seed:number){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=Math.imul(s^s>>>15,s|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
function generate(reg:typeof REGIMES[number],seed:number):Record<Symbol,Quality102Candle[]>{
 const random=prng(seed),norm=()=>Math.sqrt(-2*Math.log(Math.max(1e-12,random())))*Math.cos(2*Math.PI*random());
 const shared=Array.from({length:COUNT},norm),data={} as Record<Symbol,Quality102Candle[]>;
 for(const [idx,sym] of SYMBOLS.entries()){
  let price=100;const rows:Quality102Candle[]=[];
  for(let k=0;k<COUNT;k++){
   const daily=reg[0]==="REVERSAL" && k>=COUNT/2?-.009:reg[1];
   const local=reg[2]*(idx===0?.8:idx===1?1.8:idx===2?1.4:1.5);
   const innovation=.65*shared[k]+Math.sqrt(1-.65**2)*norm();
   const volatility=local/Math.sqrt(24)*innovation;
   const cyc=.0005*Math.sin(k/144);
   const ret=daily/24+volatility+cyc;
   const o=price,c=o*Math.exp(ret),w=Math.abs(norm())*local/Math.sqrt(24)*.48;
   const hi=Math.max(o,c)*Math.exp(w),lo=Math.min(o,c)*Math.exp(-w);
   const quoteVolume=Math.exp(10+.65*norm())*c;
   rows.push({timestampMs:T+k*H,open:o,high:hi,low:lo,close:c,quoteVolume,baseVolume:quoteVolume/c});
   price=c;
  }
  data[sym]=rows;
 }
 return data;
}
type S={source:"Q102"|"HYPE";signals:number;opened:number;exits:Record<string,number>;win:number;closed:number;terminal:number;maxDD:number;blocked:Record<string,number>;warmupFailures:number;runtimeMs:number};
function accountHype(x:Record<Symbol,Quality102Candle[]>,feeBps:number):S {
 let equity=10000,peak=equity,maxDD=0,opened=0,closed=0,win=0,signals=0;
 let active:null|{entry:number;entryK:number;notional:number;stop:number;tp:number;fee:number}=null;
 const exits:Record<string,number>={},blocked:Record<string,number>={};
 const tally=(v:Record<string,number>,k:string)=>v[k]=(v[k]??0)+1;
 const start=Date.now();
 for(let k=HP.regimeEmaPeriod+25;k<COUNT;k++){
  const next=x.HYPEUSDT[k]!,now=T+k*H;
  // Time, stop and take-profit checks apply BEFORE new admission. No same-hour reentry.
  if(active){
   let reason="",price=next.close;
   if(next.low<=active.stop){reason="STOP";price=Math.min(active.stop,next.open);}
   else if(next.high>=active.tp){reason="TAKE_PROFIT";price=Math.max(active.tp,next.open);}
   else if(k-active.entryK>=HP.maximumHoldHours){reason="TIME";price=next.open;}
   if(reason){
    const pnl=active.notional*(price/active.entry-1)-active.notional*(feeBps/2)/10000-active.fee;
    equity+=pnl;closed++;win+=Number(pnl>0);tally(exits,reason);active=null;
   }
  }
  const mark=active?equity+active.notional*(next.close/active.entry-1):equity;
  peak=Math.max(peak,mark);maxDD=Math.max(maxDD,(1-mark/peak)*100);
  if(active||mark<peak*.70)continue;
  const hype=x.HYPEUSDT.slice(Math.max(0,k-350),k).map(z=>({openTime:z.timestampMs,open:z.open,high:z.high,low:z.low,close:z.close,volume:z.baseVolume??0}));
  const btc=x.BTCUSDT.slice(Math.max(0,k-350),k).map(z=>({openTime:z.timestampMs,open:z.open,high:z.high,low:z.low,close:z.close,volume:z.baseVolume??0}));
  const signal=buildHypeTrendSignal({now,btc,hype});
  if(!signal.accepted)continue;
  signals++;
  const price=next.open,stop=price-signal.stopDistance!,tp=price+signal.trailingDistance!;
  if(!(stop>0&&tp>price)){tally(blocked,"INVALID_RERATED_PROTECTION");continue;}
  // Exact HYPE live runner risk size upper bound 5% wallet and gross 1.5;
  // executable quote, venue tick rounding and funding are not modeled.
  const riskGross=Math.min(HP.maximumGross,HP.riskPct/100/(1-stop/price));
  if(riskGross<=0||riskGross>HP.maximumGross+1e-8){tally(blocked,"SIZE");continue;}
  const wallet=calculateWalletRiskStop({side:"LONG",entryPrice:price,equity:mark,acceptedGross:riskGross,walletRiskPct:2,roundTripCostBps:feeBps});
  const finalStop=moreProtectiveStop("LONG",stop,wallet.stopPrice);
  const notional=mark*riskGross,entryFee=notional*(feeBps/2)/10000;
  if(mark-notional*(Math.max(0,(price-finalStop)/price)+.02+feeBps/10000)<peak*.70){
   tally(blocked,"STOP_RESERVE_2PCT");continue;
  }
  equity-=entryFee;active={entry:price,entryK:k,notional,stop:finalStop,tp,fee:entryFee};opened++;
 }
 if(active){const px=x.HYPEUSDT.at(-1)!.close,net=active.notional*(px/active.entry-1)-active.notional*feeBps/20000-active.fee;equity+=net;win+=Number(net>0);closed++;tally(exits,"CENSORED_TERMINAL_MARK");active=null;}
 return {source:"HYPE",signals,opened,exits,win,closed,terminal:equity,maxDD,blocked,warmupFailures:0,runtimeMs:Date.now()-start};
}
function accountQ102(x:Record<Symbol,Quality102Candle[]>,feeBps:number):S{
 const start=Date.now();let equity=10000,peak=10000,maxDD=0,signals=0,opened=0,win=0,closed=0,warmupFailures=0;
 const blocked:Record<string,number>={},exits:Record<string,number>={},tally=(v:Record<string,number>,k:string)=>v[k]=(v[k]??0)+1;
 // Source monthly selection, including 180 day training plus 336H warmup.
 // Two fully causal September evaluation days after 243 calendar days.
 for(const k of [244,249,254,259,264,269,274,279].map(d=>d*24)){
  const decisionTs=T+k*H;
  const history={candlesBySymbol:{BTCUSDT:x.BTCUSDT.slice(0,k),SOLUSDT:x.SOLUSDT.slice(0,k),PENGUUSDT:x.PENGUUSDT.slice(0,k)},
   entryOpenBySymbol:{BTCUSDT:{timestampMs:decisionTs,open:x.BTCUSDT[k]!.open},
     SOLUSDT:{timestampMs:decisionTs,open:x.SOLUSDT[k]!.open},
     PENGUUSDT:{timestampMs:decisionTs,open:x.PENGUUSDT[k]!.open}}};
  let signal;
  try{signal=buildQuality102CausalV4Signal({decisionTs,history,sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false}},{highVolSymbols:["SOLUSDT","PENGUUSDT"]});}
  catch(err){const s=err instanceof Error?err.message:String(err);if(s.includes("HISTORY"))warmupFailures++;tally(blocked,"EXCEPTION:"+s);continue;}
  tally(blocked,signal.reason);
  if(signal.side===0||!signal.symbol||!signal.hardStop)continue;
  signals++;
  const rows=x[signal.symbol as Symbol];if(!rows)throw Error("Q102_UNKNOWN_SYMBOL");
  const horizon=rows.slice(k,k+72);if(horizon.length!==72)throw Error("Q102_EXIT_HORIZON_MISSING");
  const price=horizon[0]!.open;
  let exit:{exitPrice:number;exitReason:string;holdHours:number};
  if(signal.family==="HIGH_VOL"&&signal.exitPolicy==="HIGH_VOL_TRAIL72"){
   exit=simulateQuality102HighVolExit({side:signal.side,entryPrice:price,hardStop:signal.hardStop,bars:horizon});
  } else if(signal.exitPolicy==="FIXED_HOLD_STOP"&&signal.maxHoldHours){
   // Proxy execution at the first observed H1 STOP touch, conservatively
   // applying adverse gap-on-open; real runner works on quote readbacks.
   const stop=signal.side===1?price*(1-signal.hardStop):price*(1+signal.hardStop);
   let value=horizon[0]!.open,why="time",held=0;
   for(let i=0;i<Math.min(horizon.length,signal.maxHoldHours);i++){
    const bar=horizon[i]!,breach=signal.side===1?bar.low<=stop:bar.high>=stop;
    held=i+1;
    if(breach){value=signal.side===1?Math.min(bar.open,stop):Math.max(bar.open,stop);why="stop_proxy";break;}
    value=bar.close;
   }
   exit={exitPrice:value,exitReason:why,holdHours:held};
  }else{tally(blocked,"UNIMPLEMENTED_NATIVE_EXIT_POLICY:"+String(signal.exitPolicy));continue;}
  const gross=Number(signal.requestedGross),pnl=equity*gross*(signal.side===1?exit.exitPrice/price-1:1-exit.exitPrice/price)-equity*gross*feeBps/10000;
  opened++;closed++;win+=Number(pnl>0);equity+=pnl;
  peak=Math.max(peak,equity);maxDD=Math.max(maxDD,100*(1-equity/peak));tally(exits,exit.exitReason);
 }
 return {source:"Q102",signals,opened,exits,win,closed,terminal:equity,maxDD,blocked,warmupFailures,runtimeMs:Date.now()-start};
}
const output=process.argv[2];if(!output)throw Error("OUTPUT_REQUIRED");
const cases:any[]=[];
for(const reg of REGIMES){
 for(const seed of [2026112711,2026112767]){
 const x=generate(reg,seed);
 const a=accountHype(x,30),b=accountQ102(x,30);
 cases.push({regime:reg[0],seed,hype:a,q102:b});
 console.log("CASE",reg[0],seed,JSON.stringify({hype:{signals:a.signals,opened:a.opened,maxDD:a.maxDD,terminal:a.terminal},q102:{signals:b.signals,opened:b.opened,maxDD:b.maxDD,runtimeMs:b.runtimeMs,reason:b.blocked}}));
}
}
writeFileSync(output,JSON.stringify({status:"SOURCE_NATIVE_Q102_V4_HYPE_PARTIAL_RESEARCH_ONLY",startUtc:new Date(T).toISOString(),days:DAYS,cases,limitations:["Q102 current source CAUSAL V4, selected via 180d monthly HIGH_VOL research and S34 source candidates, eight checkpoints per 280-day artificial market after 336h warmup. H1 fixed-stop S34 exits are price proxies, not quote-certified order events","HYPE native H1 signal and runner-like static STOP/TP and max-hold, fixed ATR-based take profit is NOT trailing. Protected venue order-state, tick rounding and real fills unavailable","Separate accounts for Q102 and HYPE; no common wallet nor full seven source native replay. Q102 entry is point-in-time candle open; quote/lot model absent","Synthetic data are mathematical paths not exchange data; source native risk/selection only, no funding or liquidity execution verification","Potential future leak in independent simulated price generation not tested; no current source certificate or live activation"],orderAuthority:false},null,2),{flag:"wx"});
