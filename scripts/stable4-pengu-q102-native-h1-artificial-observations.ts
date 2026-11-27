/** Native H1 PENGU/Q102 co-observation on the SAME independent artificial
 * market paths. Not a portfolio trade, backtest, venue fill, or certification.
 * No network, credentials, signed requests, orders, positions, funding PnL.
 */
import {writeFileSync} from "node:fs";
import {observeStable4PenguH1,observeStable4Q102H1,bindStable4NativeH1Observation} from "../lib/stable4-native-pengu-q102-source-observer";
import type {DisDexV35Candle} from "../lib/disdex-v35-signal-engine";
import type {Quality102Candle} from "../lib/disdex-quality102-causal-pipeline";

const H=3_600_000,T=Date.UTC(2025,0,1),HOURS=280*24;
const BASE_SHA="a".repeat(40); // research-only provenance placeholder; NOT a signed source release
const regimes=[
 ["BULL",.005,.035],
 ["BEAR",-.006,.06],
 ["RANGE",0,.04],
 ["REVERSAL",.006,.06],
] as const;
const checkpoints=[182,195,208,221,234,247,260,279].map(d=>d*24);
const symbols=["BTCUSDT","PENGUUSDT","SOLUSDT"] as const;
type Sym=typeof symbols[number];
type Tape={pengu:DisDexV35Candle[];btc:DisDexV35Candle[];
 quality:Record<Sym,Quality102Candle[]>};
function rng(seed:number){
 let s=seed>>>0;
 return ()=>{s=(s+0x6D2B79F5)>>>0;
  let t=Math.imul(s^s>>>15,s|1);t^=t+Math.imul(t^t>>>7,t|61);
  return ((t^t>>>14)>>>0)/4294967296;};
}
function tape(reg:typeof regimes[number],seed:number):Tape{
 const rand=rng(seed),normal=()=>Math.sqrt(-2*Math.log(Math.max(1e-12,rand())))*
   Math.cos(2*Math.PI*rand());
 const common=Array.from({length:HOURS},normal);
 const quality={} as Record<Sym,Quality102Candle[]>;
 let btc:DisDexV35Candle[]=[],pengu:DisDexV35Candle[]=[];
 for(const [idx,symbol] of symbols.entries()){
  const rows:Quality102Candle[]=[],h:DisDexV35Candle[]=[];
  let price=100;
  for(let k=0;k<HOURS;k++){
   const d=reg[0]==="REVERSAL"&&k>=HOURS/2?-.009:reg[1];
   const vol=reg[2]*(idx===0?.8:idx===1?1.8:1.4);
   const shock=.65*common[k]+Math.sqrt(1-.65**2)*normal();
   const ret=d/24+vol/Math.sqrt(24)*shock+.0005*Math.sin(k/144);
   const open=price,close=open*Math.exp(ret);
   const spread=Math.abs(normal())*vol/Math.sqrt(24)*.48;
   const high=Math.max(open,close)*Math.exp(spread);
   const low=Math.min(open,close)*Math.exp(-spread);
   const openTime=T+k*H;
   const volume=Math.exp(10+.65*normal());
   const row:Quality102Candle={timestampMs:openTime,open,high,low,close,
     baseVolume:volume,quoteVolume:volume*close};
   rows.push(row);
   h.push({openTime,closeTime:openTime+H-1,open,high,low,close,volume});
   price=close;
  }
  quality[symbol]=rows;
  if(symbol==="BTCUSDT")btc=h;
  if(symbol==="PENGUUSDT")pengu=h;
 }
 return {btc,pengu,quality};
}
function one(reg:typeof regimes[number],seed:number){
 const data=tape(reg,seed);
 const cases=[];
 const counts={penguLong:0,penguShort:0,penguV8Long:0,penguV8Short:0,q102Long:0,q102Short:0,
  noSignal:0,blocked:0,asterM5Confirmed:0,portfolioAdmitted:0};
 for(const h of checkpoints){
  const decisionTs=T+h*H;
  const history={pengu1h:data.pengu.slice(0,h),btc1h:data.btc.slice(0,h),penguFunding:[]};
  const pengu=observeStable4PenguH1({decisionTs,sourcePin:BASE_SHA,
   history,options:{recoveryV8Enabled:false,v64DynamicLongEnabled:false}});
  const penguV8=observeStable4PenguH1({decisionTs,sourcePin:BASE_SHA,
   history,options:{recoveryV8Enabled:true,v64DynamicLongEnabled:true}});
  if(penguV8.status==="NATIVE_ENTRY_OBSERVED"){
   if(penguV8.side===1)counts.penguV8Long++;
   else if(penguV8.side===-1)counts.penguV8Short++;
  }
  if(penguV8.orderAuthority!==false||penguV8.asterM5EntryConfirmed!==false)
   throw Error("PENGU_V8_FALSE_VENUE_CERTIFICATION");
  const quality=observeStable4Q102H1({decisionTs,sourcePin:BASE_SHA,
   history:{candlesBySymbol:Object.fromEntries(symbols.map(s=>[s,data.quality[s].slice(0,h)]))},
   occupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false}});
  const decisions=[pengu,quality];
  for(const s of decisions){
   if(s.status==="NATIVE_ENTRY_OBSERVED"){
    if(s.runner==="PENGU"){if(s.side>0)counts.penguLong++;else counts.penguShort++;}
    else if(s.side>0)counts.q102Long++;else counts.q102Short++;
    if(s.symbol&&s.route){
     const bound=bindStable4NativeH1Observation({
      observation:s,
      candidate:{sleeve:s.runner,symbol:s.symbol,side:s.side>0?"LONG":"SHORT",
       route:s.route,gross:s.gross,entryTs:decisionTs,sourceReleaseSha:BASE_SHA,
       sourceDecisionTs:decisionTs,sourceComplete:true},
     });
     if(bound.status!=="NATIVE_H1_OBSERVED_ONLY"||bound.eligibleForPortfolioEntry!==false)
      throw Error("SOURCE_BOUND_M5_ADMISSION_VIOLATION");
    }
   }else if(s.status==="NO_SOURCE_ENTRY")counts.noSignal++;
   else counts.blocked++;
   if(s.orderAuthority!==false||s.asterM5EntryConfirmed!==false)
    throw Error("RESEARCH_ORDER_AUTHORITY_VIOLATION");
  }
  cases.push({decisionTs,penguV8:{status:penguV8.status,reason:penguV8.reason,
    symbol:penguV8.symbol,side:penguV8.side,gross:penguV8.gross,route:penguV8.route},
    pengu:{status:pengu.status,reason:pengu.reason,
    symbol:pengu.symbol,side:pengu.side,gross:pengu.gross,route:pengu.route},
    q102:{status:quality.status,reason:quality.reason,
    symbol:quality.symbol,side:quality.side,gross:quality.gross,route:quality.route}});
 }
 return {regime:reg[0],seed,cases,counts};
}
const output=process.argv[2];if(!output)throw Error("OUTPUT_REQUIRED");
const rows=regimes.flatMap((reg,idx)=>[one(reg,2026112821+idx)]);
const aggregate={penguSignals:rows.reduce((s,r)=>s+r.counts.penguLong+r.counts.penguShort,0),
 penguV8Signals:rows.reduce((s,r)=>s+r.counts.penguV8Long+r.counts.penguV8Short,0),
 q102Signals:rows.reduce((s,r)=>s+r.counts.q102Long+r.counts.q102Short,0),
 blocked:rows.reduce((s,r)=>s+r.counts.blocked,0)};
writeFileSync(output,JSON.stringify({
 schema:"stable4-native-pengu-q102-artificial-h1-observation/v1",
 status:"NATIVE_H1_OBSERVATION_ONLY_NO_VENUE_CERTIFICATION",
 sourceNote:"Actual PENGU dual LS V2 source in separate base-mode false/false AND recoveryV8+dynamicLong true/true observation arms; Q102 causal V1 HIGH_VOL; no fills or certified live mode selection",
 artificialData:{regimes:regimes.map(r=>r[0]),seeds:rows.map(r=>r.seed),
  days:280,checkpointsDays:checkpoints.map(h=>h/24),marketSources:["BTCUSDT","PENGUUSDT","SOLUSDT"]},
 rows,aggregate,
 limitations:["Synthetic OHLC only; no independent Binance/ASTER prices, signed funding, live depth, slippage, lot and partial fills",
  "Observes 8 H1 decision checkpoints per 280d path; does NOT reconstruct every H1 entry",
  "PENGU recovery V8/Dynamic Long options are observed in a second arm; live config attestation, M5 entry and source-accurate exits remain unverified",
  "Q102 causal V1 HIGH_VOL only; no S34/PB/MR/BRK/REV native coverage",
  "No shared-wallet order admissions, resident STOP, aggregate fees/funding or equity/DD result",
  "Source pin string is an offline placeholder, NOT Root attested release; no 5m ASTER confirmation"],
 rootCertificateIssued:false,orderAuthority:false,asterM5Confirmed:false,
 fullSevenNativeReplay:false,liveEligible:false,
},null,2)+"\n",{flag:"wx"});
