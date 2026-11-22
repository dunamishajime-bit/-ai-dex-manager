/**
 * P88 NEW-SEED HOLDOUT — pre-frozen P87 M5 scoring on fully different artificial seeds; no tuning.
 * NO actual order and NO downloaded Binance future prices in dummy experiments.
 * Frozen eight P8 market regimes x three synthetic liquidity profiles x two
 * venue coupling strengths x four predeclared seeds = 192 market paths.
 *
 * 840H past-only warmup (5w) + 168H decision (7d) + 84H future settlement
 * horizon. Entire 1092H simulated 5m PENGU candles for ASTER, and 1h for
 * AST/BIN PENGU, AST/BIN BTC, BIN ETH. NEVER use tail for entry decisions.
 * Entry signal per venue uses pinned buildPenguDualLsV2EvaluationSeries.
 * Counterfactual execution always ASTER M5 print with re-priced native STOP.
 * No actual historical Aster/Binance OHLC, no historical print masks.
 * Results are a MARKET STRESS TEST, not evidence of market prediction alpha.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {buildPenguDualLsV2EvaluationSeries} from './lib/pengu-dual-ls-v2.ts';
import {replayPinnedShortExit} from './prism7_p8_native_lifecycle_core.mjs';
import {replayP80M5DelaySourceNativeShort} from './prism7_p80_m5_delayed_aster_native_exit_core_20261122.mjs';

const PIN='1657e173d250ad58f53e62f7bb0a3428fb405496';
const H=3600000,M5=300000,WARM_H=840,EVAL_H=168,TAIL_H=84,ALL_H=WARM_H+EVAL_H+TAIL_H;
const T0=Date.parse('2027-03-01T00:00:00Z');  // Synthetic clock; Monday UTC
const ENTRY_START=T0+WARM_H*H,ENTRY_END=T0+(WARM_H+EVAL_H)*H;
const END=T0+ALL_H*H;
const WORK='C:\\Users\\dis\\Documents\\DisDex_Research\\WINRATE_DEEP_20261122';
const DIR=path.join(WORK,'p88_frozen_gate_new_seeds_dual_venue_native');
const OUT=path.join(WORK,'results','PRISM7_P88_NEW_SEED_HOLDOUT_ASTER_BINANCE_NATIVE_SOURCE_INDEX_20261122.json');
const REGIMES=['PERSISTENT_DOWN','PERSISTENT_UP','SIDEWAYS','DOWN_THEN_SQUEEZE',
 'UP_THEN_DUMP','HIGH_VOL_CHOP','ILLIQUID_ZERO_PRINT','BTC_PENGU_DIVERGENCE'];
const LIQUIDITY=['HIGH_PRINT','THIN_PRINT','STRESSED_PRINT'];
const COUPLINGS=['HIGH_CORR','BASIS_DISLOCATION'];
const SEEDS=[2026112388,2026112389,2026112390,2026112391];
const DELAYS=[0,5,15];
const GROSS=[.5,.75];
const PARAMETERS={
 warmupHours:WARM_H,evaluationHours:EVAL_H,postEvaluationExitHours:TAIL_H,
 venueMarketReturnCorrelationMode:{HIGH_CORR:.96,BASIS_DISLOCATION:.58},
 printMarkovTarget:{HIGH_PRINT:.985,THIN_PRINT:.82,STRESSED_PRINT:.45},
 returnModel:{sharedBTCFactor:.44,sharedPENGUFactor:.56,
    binancePriceBasisMeanReversionStrength:.018,
    regimeSpecificShocks:true}
};
const sha=buf=>crypto.createHash('sha256').update(buf).digest('hex');
function seed32(...parts){return crypto.createHash('sha256').update(parts.join('|')).digest().readUInt32BE(0);}
function rng(seed){
 let s=seed>>>0;let cached=null;
 function uniform(){s=(s+0x6d2b79f5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;}
 function normal(){if(cached!==null){const z=cached;cached=null;return z;}let u=Math.max(1e-12,uniform()),v=uniform();const z=Math.sqrt(-2*Math.log(u));cached=z*Math.sin(2*Math.PI*v);return z*Math.cos(2*Math.PI*v);}
 return {uniform,normal};
}
function assert(condition,message){if(!condition)throw Error('P84_'+message);}
function drift(regime,hi,warmup){
 if(warmup)return {p:-.000003,b:.000002,ps:.0023,bs:.00135,es:.0017};
 switch(regime){
 case 'PERSISTENT_DOWN':return {p:-.00027,b:-.00007,ps:.0028,bs:.0014,es:.0017};
 case 'PERSISTENT_UP':return {p:.00027,b:.000085,ps:.0028,bs:.0014,es:.0017};
 case 'SIDEWAYS':return {p:0,b:0,ps:.0038,bs:.0016,es:.002};
 case 'DOWN_THEN_SQUEEZE':return {p:hi<65?-.0003:.00042,b:hi<65?-.000085:.00015,ps:.0035,bs:.0017,es:.0021};
 case 'UP_THEN_DUMP':return {p:hi<73?.00027:-.00048,b:hi<73?.0001:-.00018,ps:.0034,bs:.0018,es:.0022};
 case 'HIGH_VOL_CHOP':return {p:Math.floor(hi/16)%2?.00035:-.00035,b:0,ps:.008,bs:.0032,es:.0035};
 case 'ILLIQUID_ZERO_PRINT':return {p:-.00005,b:-.00002,ps:.0045,bs:.0022,es:.0025};
 case 'BTC_PENGU_DIVERGENCE':return {p:-.00017,b:.00021,ps:.0032,bs:.0019,es:.0023};
 default:throw Error('P84_REGIME_UNKNOWN');
 }
}
function renderMarket(regime,liquidity,coupling,seed){
 const random=rng(seed32('P84_MARKET',regime,liquidity,coupling,seed));
 const rngPrint=rng(seed32('P84_PRINT',regime,liquidity,coupling,seed));
 const corr=PARAMETERS.venueMarketReturnCorrelationMode[coupling];
 const delta=Math.sqrt(Math.max(0,1-corr*corr));
 const target=PARAMETERS.printMarkovTarget[liquidity]*(regime==='ILLIQUID_ZERO_PRINT'?.68:1);
 const persist=liquidity==='STRESSED_PRINT'?.86:.72;
 let markA=1,markBin=1,btcA=100000,btcBin=100000,ethBin=2800;
 let previousPrinted=1,printState=true;
 const aP=[],bP=[],aBTC=[],bBTC=[],bETH=[],m5=new Map();
 let zeroM5=0,maxZeroStreak=0,zeroStreak=0,maxSpreadPct=0,missingHours=0;
 const MAX_BASIS=0.055;
 for(let h=0;h<ALL_H;h++){
   const ts=T0+h*H;const hi=h-WARM_H;
   const warm=h<WARM_H;const params=drift(regime,hi,warm);
   const buckets=[null,null,null,null,null].map(()=>({open:null,high:-Infinity,low:Infinity,close:null,volume:0,last:null}));
   for(let j=0;j<12;j++){
     const i=h*12+j,t=ts+j*M5;
     const u=random.normal(),v=random.normal(),z=random.normal(),y=random.normal(),k=random.normal();
     const pOld=markA,pBinOld=markBin,bOld=btcA,bBinOld=btcBin,eOld=ethBin;
     const common=.44*u+.898*v;
     let pRet=params.p+params.ps*(.55*u+.84*common);
     const bRet=params.b+params.bs*u;
     // Let basis mean revert, without requiring future knowledge. All source data
     // is generated from time<=t, not a post-hoc venue-price alignment.
     const basis=Math.log(markBin/markA);
     let binRet=params.p+params.ps*(corr*(.55*u+.84*common)+delta*z)
           -.018*basis;
     let bBinRet=params.b+params.bs*(.98*u+.199*y);
     let eBinRet=params.b*.9+params.es*(.72*u+.693*k);
     if(!warm){
       if(regime==='DOWN_THEN_SQUEEZE'&&hi===65&&j===0){pRet+=.027;binRet+=.027;}
       if(regime==='UP_THEN_DUMP'&&hi===73&&j===0){pRet-=.035;binRet-=.035;}
       if(regime==='HIGH_VOL_CHOP'&&(i-WARM_H*12)%135===55){
         pRet+=(Math.floor((i-WARM_H*12)/135)%2?-.025:.025);
         binRet+=pRet>0?.022:-.022;
       }
       if(coupling==='BASIS_DISLOCATION'&&(i-WARM_H*12)%247===60){
         binRet+=(Math.floor((i-WARM_H*12)/247)%2===0?.016:-.016);
       }
     }
     markA=Math.max(.05,markA*Math.exp(pRet));
     markBin=Math.max(.05,markBin*Math.exp(binRet));
     btcA=Math.max(100,bOld*Math.exp(bRet));
     btcBin=Math.max(100,bBinOld*Math.exp(bBinRet));
     ethBin=Math.max(1,eOld*Math.exp(eBinRet));
     // Avoid price-market basis drift beyond extreme model bounds: place an
     // instantaneous counter-shock only on Binance in the current step.
     const basisAfter=Math.log(markBin/markA);
     if(Math.abs(basisAfter)>MAX_BASIS){
       markBin=markA*Math.exp(Math.sign(basisAfter)*MAX_BASIS);
     }
     const spreadPct=100*Math.abs(markBin/markA-1);maxSpreadPct=Math.max(maxSpreadPct,spreadPct);
     // Markov hidden print likelihood is independent of current/future price
     // outcomes, based only on prior mark and random coin at current bar.
     const flip=rngPrint.uniform();
     printState=(flip<(printState?(persist+(1-persist)*target):((1-persist)*target)));
     const printed=printState;
     const m5range=params.ps*(.07+Math.abs(random.normal())*.20);
     if(printed){
       const high=Math.max(pOld,markA)*(1+m5range);
       const low=Math.min(pOld,markA)*(1-m5range);
       const volume=Math.max(1,Math.floor(1000*Math.exp(.55*random.normal())));
       const record=[t,pOld,high,low,markA,volume];
       m5.set(t,record);previousPrinted=markA;zeroStreak=0;
       const a=buckets[0];
       if(a.open===null)a.open=pOld;
       a.high=Math.max(a.high,high);a.low=Math.min(a.low,low);
       a.close=markA;a.last=markA;a.volume+=volume;
     }else{
       m5.set(t,[t,previousPrinted,previousPrinted,previousPrinted,previousPrinted,0]);
       zeroM5++;zeroStreak++;maxZeroStreak=Math.max(maxZeroStreak,zeroStreak);
     }
     const raw=[
       [1,pBinOld,markBin,params.ps],
       [2,bOld,btcA,params.bs],
       [3,bBinOld,btcBin,params.bs],
       [4,eOld,ethBin,params.es],
     ];
     for(const [idx,o,c,sig] of raw){
       const bk=buckets[idx],wiggle=sig*(.07+Math.abs(random.normal())*.13);
       const high=Math.max(o,c)*(1+wiggle),low=Math.min(o,c)*(1-wiggle);
       if(bk.open===null)bk.open=o;
       bk.high=Math.max(high,bk.high);bk.low=Math.min(low,bk.low);
       bk.close=c;bk.last=c;bk.volume+=Math.max(1,Math.floor(900*Math.exp(.3*random.normal())));
     }
   }
   const out=[];
   for(let n=0;n<5;n++){
     const z=buckets[n];
     if(z.open===null){
       assert(n===0,'ONLY_ASTER_PENGU_CAN_HAVE_ZERO_PRINT_H1');
       missingHours++;
       z.open=z.high=z.low=z.close=previousPrinted;
     }
     const lo=z.low,hi=z.high,o=z.open,c=z.close;
     assert(lo>0&&lo<=Math.min(o,c)+1e-8&&hi+1e-8>=Math.max(o,c),'H1_CANDLE_INVALID');
     out.push({openTime:ts,closeTime:ts+H-1,open:o,high:hi,low:lo,close:c,volume:z.volume});
   }
   aP.push(out[0]);bP.push(out[1]);aBTC.push(out[2]);bBTC.push(out[3]);bETH.push(out[4]);
 }
 assert(m5.size===ALL_H*12&&aP.length===ALL_H,'SYNTH_DATA_CLOCK_LENGTH');
 return {aP,bP,aBTC,bBTC,bETH,m5,stats:{zeroM5,maxZeroStreak,missingHours,maxSpreadPct}};
}
function appendSignalsAndTrades(market,regime,liquidity,coupling,seed){
 const {aP,bP,aBTC,bBTC,bETH,m5,stats}=market;
 const eva=buildPenguDualLsV2EvaluationSeries({pengu1h:aP,btc1h:aBTC,penguFunding:[]},END);
 const evb=buildPenguDualLsV2EvaluationSeries({pengu1h:bP,btc1h:bBTC,penguFunding:[]},END);
 assert(eva.length===ALL_H&&evb.length===ALL_H,'NATIVE_EVAL_H1_LENGTH');
 const mapA=new Map(aP.map((z,i)=>[z.openTime,i]));
 let prefixA=true,prefixB=true;
 // Single-shot no-lookahead prefixes: compare both signal AND all crucial
 // feature inputs at a calendar index. Leave no future bars in the truncated
 // source when evaluating the same time's closed H1.
 if(seed===SEEDS[0]){
   const until=WARM_H+Math.min(50,Math.floor(EVAL_H/2));
   const compare=(p,b,full)=>{
     const cut=buildPenguDualLsV2EvaluationSeries({
       pengu1h:p.slice(0,until),btc1h:b.slice(0,until),penguFunding:[]},
       T0+until*H);
     const a=cut[until-1],q=full[until-1];
     assert(a.shortSignal===q.shortSignal,'PREFIX_FUTURE_SIGNAL_CHANGE');
     for(const key of ['referenceTs','atr24Ratio','penguReturn24h','btcReturn24h'])
       assert(Math.abs(a.features[key]-q.features[key])<1e-10,
         'PREFIX_FUTURE_FEATURE_CHANGE_'+key);
     return true;
   };
   prefixA=compare(aP,aBTC,eva);
   prefixB=compare(bP,bBTC,evb);
 }
 const as=new Set(),bs=new Set();
 for(let i=WARM_H;i<WARM_H+EVAL_H;i++){
   if(eva[i-1]?.shortSignal)as.add(i);
   if(evb[i-1]?.shortSignal)bs.add(i);
 }
 const union=[...new Set([...as,...bs])].sort((a,b)=>a-b);
 const knownBoth=union.filter(i=>as.has(i)&&bs.has(i)).length;
 const syntheticPathKey=[regime,liquidity,coupling,seed].join('_');
 const trades=[];
 let srcCount={A:as.size,B:bs.size,BOTH:knownBoth,UNION:union.length};
 let noPrintCount=0,stopUncertainCount=0,sourceCensored=0,m5ExitStatus={};
 for(const idx of union){
   const ts=aP[idx].openTime;
   assert(ts>=ENTRY_START&&ts<ENTRY_END,'NATIVE_SIGNAL_OUTSIDE_FROZEN_EVAL');
   const aSig=as.has(idx),bSig=bs.has(idx);
   // ASTER H1 origin is always used as counterfactual execution venue.
   const entryPrice=aP[idx].open;
   const pureA=replayPinnedShortExit({
     evals:eva,penguH1:aP,entryIndex:idx,entryTs:ts,
     entryPrice,requestedGross:1,exitHorizonTs:END});
   // independently run pinned source-native actual source on Binance:
   let pureBin=null;
   if(bSig){
     pureBin=replayPinnedShortExit({evals:evb,penguH1:bP,entryIndex:idx,entryTs:ts,
       entryPrice:bP[idx].open,requestedGross:1,exitHorizonTs:END});
   }
   if(pureA.status!=='NATIVE_EXIT_MODELED')sourceCensored++;
   const model={};
   for(const gross of GROSS){
     model[String(gross)]={};
     for(const delay of DELAYS){
       const z=replayP80M5DelaySourceNativeShort({
        evals:eva,penguH1:aP,m5,entryIndex:idx,sourceEntryTs:ts,
        sourceEntryPrice:entryPrice,requestedGross:gross,
        sourceNativeExitTs:pureA.exitTs??null,maxExitHorizonTs:END,delayMinutes:delay});
       const closed=z.status==='PRICE_PROXY_CLOSED';
       if(z.flags?.stopInsideFirstPositiveM5)stopUncertainCount++;
       if(!closed)m5ExitStatus[z.status]=(m5ExitStatus[z.status]??0)+1;
       if(z.status==='NO_ENTRY_POSITIVE_PRINT_IN_H1')noPrintCount++;
       model[String(gross)][String(delay)]={
        status:z.status,
        entryTs:z.observedEntryTs??null,entryPrice:z.observedEntryPrice??null,
        exitTs:z.observedExitBarStartTs??null,
        exitPrice:z.observedExitPrice??null,
        reason:z.observedExitReason??null,
        stopIntrabarUncertain:!!z.flags?.stopInsideFirstPositiveM5,
        sourceH1OriginallyCensored:pureA.status!=='NATIVE_EXIT_MODELED',
        originalGrossUnitProfit30Pct:closed?
          100*(1-z.observedExitPrice/z.observedEntryPrice)-.3:null,
        actualSignedFill:false};
     }
   }
   trades.push({sourceIdx:idx,signalTs:ts,triggerAster:aSig,triggerBinance:bSig,
      asterOriginalNativeH1Status:pureA.status,
      asterOriginalNativeH1ExitTs:pureA.exitTs??null,
      asterOriginalNativeH1ExitPrice:pureA.exitPrice??null,
      binanceOriginalNativeH1Status:pureBin?.status??null,
      binanceOriginalNativeH1ExitTs:pureBin?.exitTs??null,
      binanceOriginalNativeH1ExitPrice:pureBin?.exitPrice??null,
      m5RepricedNativeStopGrossAndDelay:model});
 }
 assert(trades.length===union.length,'UNION_LEDGER_LOST_SIGNAL');
 const store=path.join(DIR,'paths',syntheticPathKey+'.json.gz');
 fs.mkdirSync(path.dirname(store),{recursive:true});
 const compact={
  schema:'prism7-p84-paired-synthetic-aster-binance-candle-native-m5-replay/v1',
  tag:syntheticPathKey,regime,liquidity,coupling,seed,
  sourcePinnedNativeSHA:PIN,
  startTs:T0,decisionStartTs:ENTRY_START,decisionEndExclusiveTs:ENTRY_END,
  observationEndExclusiveTs:END,
  sourcesH1:{
    aP:aP.map(z=>[z.openTime,z.open,z.high,z.low,z.close,z.volume]),
    bP:bP.map(z=>[z.openTime,z.open,z.high,z.low,z.close,z.volume]),
    aBTC:aBTC.map(z=>[z.openTime,z.open,z.high,z.low,z.close,z.volume]),
    bBTC:bBTC.map(z=>[z.openTime,z.open,z.high,z.low,z.close,z.volume]),
    bETH:bETH.map(z=>[z.openTime,z.open,z.high,z.low,z.close,z.volume])},
  asterSourceM5:[...m5.values()],
  allNaturalSourceSignalAndCounterfactualM5NativeExits:trades,
  sourceNaturalCounts:srcCount,sourceNativeCensorCount:sourceCensored,
  noPositiveM5EventModelCount:noPrintCount,
  stopSameFirstM5BarUncertainEvents:stopUncertainCount,
  sourceRepricingStatusCount:m5ExitStatus,
  sourceIndependentPrefixInvariantA:prefixA,sourceIndependentPrefixInvariantB:prefixB,
  marketStats:stats,sourceSyntheticNotActual:true,venueSignedFill:false,
 };
 const gz=zlib.gzipSync(Buffer.from(JSON.stringify(compact)+'\n'),{level:6,mtime:0});
 fs.writeFileSync(store,gz);
 return {tag:syntheticPathKey,regime,liquidity,coupling,seed,
  path:store,sha256:sha(gz),compressedBytes:gz.length,
  originalAsterNatural:srcCount.A,originalBinanceNatural:srcCount.B,
  originalBoth:srcCount.BOTH,originalORUnique:srcCount.UNION,
  sourceM5NoPrint:stats.zeroM5,sourceM5EmptyH1:stats.missingHours,
  maxObservedVenueBasisPct:stats.maxSpreadPct,
  sourceOriginallyCensored:sourceCensored,
  noPositivePrintedM5ExitEvents:noPrintCount,
  firstBarStopIntrabarAmbiguous:stopUncertainCount,
  prefixAandBPass:prefixA&&prefixB};
}
function main(){
 fs.mkdirSync(DIR,{recursive:true});
 const paths=[];const progress={};
 let n=0;
 for(const regime of REGIMES){
  for(const liquidity of LIQUIDITY){
   for(const coupling of COUPLINGS){
    for(const seed of SEEDS){
      const m=renderMarket(regime,liquidity,coupling,seed);
      const out=appendSignalsAndTrades(m,regime,liquidity,coupling,seed);
      paths.push(out);n++;
    }
   }
  }
  const s=paths.filter(x=>x.regime===regime);
  progress[regime]={paths:s.length,A:s.reduce((a,z)=>a+z.originalAsterNatural,0),
    B:s.reduce((a,z)=>a+z.originalBinanceNatural,0),
    AND:s.reduce((a,z)=>a+z.originalBoth,0),
    OR:s.reduce((a,z)=>a+z.originalORUnique,0)};
  console.log('P88_HOLDOUT_REGIME_DONE',regime,JSON.stringify(progress[regime]),'paths',n);
 }
 assert(n===8*3*2*4,'SYNTHETIC_GRID_NOT_COMPLETE');
 let index={
  schema:'prism7-p88-fresh-seed-holdout-frozen-pengu-native-V20-8regime-3liq-2venueCorr-4seed/v1',
  status:'RESEARCH_ONLY_DUMMY_MARKET_NO_LIVE',
  pinnedOriginalNativeSHA:PIN,
  frozenRegimes:REGIMES,syntheticLiquidity:LIQUIDITY,
  correlatedVenues:COUPLINGS,fixedSeeds:SEEDS,
  sourceT0UTC:new Date(T0).toISOString(),
  sourceNativeEntriesStart:new Date(ENTRY_START).toISOString(),
  sourceNativeEntriesEndExclusive:new Date(ENTRY_END).toISOString(),
  sourceObservationEndExclusive:new Date(END).toISOString(),
  params:PARAMETERS,paths,
  regimesSourceNativeCandidateCount:progress,
  aggregateAllPaths:{paths:n,
   A:paths.reduce((a,z)=>a+z.originalAsterNatural,0),
   B:paths.reduce((a,z)=>a+z.originalBinanceNatural,0),
   AND:paths.reduce((a,z)=>a+z.originalBoth,0),
   OR:paths.reduce((a,z)=>a+z.originalORUnique,0),
   noSignalPaths:paths.filter(z=>z.originalORUnique===0).length,
   firstBarStopIntrabarAmbiguous:paths.reduce((a,z)=>a+z.firstBarStopIntrabarAmbiguous,0)},
  timestampPrefixInvariantAllPaths:paths.every(z=>z.prefixAandBPass),
  dataSource:'FULLY_SYNTHETIC OHLCV prices and liquidity with deterministic SHA256 seeds; NO user or public historical data as input',
  marketReturnAndLiquidityGenerationNoFuturePricePeek:true,
  nativeEntrySourceCodePinnedAndNativeM5STOPSourceCodePinned:true,
  allEntrySigsOnlyBeforeEvaluationEnd:true,
  noSignedRealOrderFill:true,
  sourceActualHistoricalBTNotChanged:true,
  productionMasterGrossSTOPOrdersRunnerUnchanged:true,
  limitations:[
   'Synthetic Monte Carlo cannot establish real historical cross-exchange lead lag, actual signed fills or profit forecast.',
   'V20 source native SHORT signal called for each venue from its own generated PENGU+BTC H1. PENGU ASTER native STOP/exits re-priced for all OR source triggers with ASTER M5 synthetic OHLC.',
   'No real exchange price ladder, fees, spread, funding, microsecond latency, signed stop orders or other runner gross.',
   'M5 first open print after 0/5/15m is a potential fill proxy only; same M5 bar entry/stop cannot be ordered and must be excluded in final P85.',
   'Right-censored original H1 sources explicitly tracked, M5 unfinished exits separately excluded from realized stats; never count as zero profit.',
   'Eight ex ante stylized regime paths and 4 seeds per regime/liq/coupling. Unseen real source market evidence required.',
   'No live runner, master, position, order or STOP changes.'
  ]
 };
 fs.writeFileSync(OUT,JSON.stringify(index,null,2)+'\n');
 console.log('P88_HOLDOUT_SAME_NATIVE_SOURCE_COMPLETE',JSON.stringify(index.aggregateAllPaths));
 console.log('RESULT_INDEX',OUT);
}
main();
