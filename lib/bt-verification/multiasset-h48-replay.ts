import type {Replay,ReplayFrame,BtcCandle,Position} from "./replay";
import {SyntheticMarket5m,type SyntheticScenario,type MarketCandle5m,type SyntheticFeedVersion} from "./synthetic-market";
import {probeSyntheticFet} from "./pinned-native-fet/probe";
import {probeSyntheticIdleAt} from "./pinned-native-idle/probe";
import {probeSyntheticPenguAt} from "./stable4-pengu-research-gates";
import {evaluateH48ClosedHourly,H48_RESEARCH_LOGIC,
  H48_RESEARCH_THRESHOLDS,type H48Observation,type H48Decision} from "./h48-research-sandbox";

/**
 * 23-symbol OHLCV -> genuine frozen *research H48 candidate* gate, with
 * next-H1-open, 6h grid, 48h max, 6% observed M5 STOP and model funding.
 * No other runner is admitted; no venue execution or LIVE equivalence.
 */
const START=Date.parse("2025-10-01T00:00:00Z"),HOUR=3600000;
const WARMUP_HOURS=96,PLAY_HOURS=240;
const YEN=10000;
const iso=(v:number)=>new Date(v).toISOString().replace(".000Z","Z");
const round=(v:number,d=2)=>Number(v.toFixed(d));
const candle=(x:MarketCandle5m):BtcCandle=>({
  time:x.openTime,closedAt:x.closedAt,open:x.open,high:x.high,low:x.low,close:x.close
});
type H48Open={id:string;entry:number;qty:number;fx:number;openedAt:string;openedAtMs:number};
function decided(obs:readonly H48Observation[],at:string):H48Decision{
 const base=evaluateH48ClosedHourly(obs);
 if(!base.ready)return base;
 const on6h=Date.parse(at)%(6*HOUR)===0;
 return {...base,candidate:base.candidate&&on6h,
   reason:on6h?base.reason:"次の6時間UTC入場枠ではない"};
}
export function createMultiassetH48Replay(
 seed=123456,scenario:SyntheticScenario="trend",costBps:10|30=10,
 feedVersion:SyntheticFeedVersion="v1"
):Replay{
 if(costBps!==10&&costBps!==30)throw Error("MULTIASSET_H48_FEE_INVALID");
 const feed=new SyntheticMarket5m(seed,scenario,{
   start:iso(START-WARMUP_HOURS*HOUR),endExclusive:iso(START+PLAY_HOURS*HOUR),
   version:feedVersion
 });
 const btcCandles:BtcCandle[]=[],observations:H48Observation[]=[];
 const frames:ReplayFrame[]=[];
 let lastHype:number|null=null,lastFx=145,lastDecision:H48Decision={
   ready:false,candidate:false,h12:null,h24:null,btc24:null,rel24:null,
   reason:"ウォームアップ中"
 };
 let position:H48Open|null=null,realized=0,seq=0,entries=0,pending=false,fundingEvents=0;
 const feeRate=costBps/20000;
 while(true){
   const step=feed.step();if(!step)break;
   const now=Date.parse(step.observedAt);
   const hype=step.quotes.find(x=>x.symbol==="HYPEUSDT");
   const btc=step.quotes.find(x=>x.symbol==="BTCUSDT");
   if(!hype||!btc||!hype.tradable||!btc.tradable)throw Error("MULTIASSET_H48_SOURCE_INCOMPLETE");
   const inMain=now>START;
   const events:string[]=[];
   const firstInHour=(now-START)%(HOUR)===300000;
   if(inMain&&firstInHour){
     const hourAt=now-300000,modelOpen=lastHype;
     if(modelOpen===null||modelOpen<=0||lastFx<=0)throw Error("MULTIASSET_H48_NEXT_OPEN_MISSING");
     if(position&&hourAt-position.openedAtMs>=H48_RESEARCH_THRESHOLDS.holdingHours*HOUR){
       const exited=position.qty*(modelOpen-position.entry)*lastFx-
         position.qty*modelOpen*lastFx*feeRate;
       realized+=exited;
       events.push("EXIT "+H48_RESEARCH_LOGIC+" HYPEUSDT LONG reason=H48_TIME48_NEXTOPEN"+
         " modelExitAt="+iso(hourAt)+" pnlMinusExitFeeJpy="+round(exited));
       position=null;
     }
     if(pending){
       if(position)events.push("BLOCK "+H48_RESEARCH_LOGIC+" HYPEUSDT reason=SINGLE_SLOT_HELD");
       else{
         const cash=YEN+realized;
         if(cash>0){
           const qty=cash*H48_RESEARCH_THRESHOLDS.requestedGrossX/(modelOpen*lastFx);
           realized-=qty*modelOpen*lastFx*feeRate;
           position={id:H48_RESEARCH_LOGIC+"-"+(++seq),entry:modelOpen,qty,fx:lastFx,
             openedAt:iso(hourAt),openedAtMs:hourAt};
           entries++;
           events.push("ENTRY "+H48_RESEARCH_LOGIC+" HYPEUSDT LONG modelEntryAt="+iso(hourAt)+
             " quoteAtPriorClose="+round(modelOpen,7)+" gross=1.0x feeBps="+costBps+
             " [RESEARCH_6H_GRID]");
         }else events.push("BLOCK "+H48_RESEARCH_LOGIC+" HYPEUSDT reason=EQUITY_NONPOSITIVE");
       }
       pending=false;
     }
   }
   if(inMain&&position){
     if(hype.price<=position.entry*(1-H48_RESEARCH_THRESHOLDS.researchCandidateHardStopPct)){
       const exited=position.qty*(hype.price-position.entry)*step.usdJpy-
         position.qty*hype.price*step.usdJpy*feeRate;
       realized+=exited;
       events.push("EXIT "+H48_RESEARCH_LOGIC+" HYPEUSDT LONG reason=H48_RESEARCH_STOP_6PCT_5MIN_OBSERVED"+
         " modelExitAt="+step.observedAt+" pnlMinusExitFeeJpy="+round(exited));
       position=null;
     }else{
       // 8h synthetic funding; only observed at a completed funding timestamp.
       for(const funding of step.funding.filter(f=>f.symbol==="HYPEUSDT")){
         const charge=position.qty*hype.price*step.usdJpy*funding.rate;
         realized-=charge;fundingEvents++;
         events.push("FUNDING "+H48_RESEARCH_LOGIC+" HYPEUSDT at="+funding.timestamp+
           " syntheticFundingJpy="+round(-charge,5));
       }
     }
   }
   // Frozen native FET ENTRY signal only. No modeled FET fills or portfolio slots.
   const fetBar=step.completedH1.find(x=>x.symbol==="FETUSDT");
   if(inMain&&fetBar&&new Date(now).getUTCHours()%4===1){
     const fet=probeSyntheticFet(feed,step.observedAt);
     const note="RISK FET_BRK48_RESIDUAL [PINNED_NATIVE_ENTRY_SIGNAL_ONLY] "+
       (fet.status==="NATIVE_SIGNAL_PASSED"?"PASS":"BLOCK")+
       " asOf="+fet.asOf+" sourceRevision="+fet.sourceRevision+
       " reason="+fet.status;
     if(fet.candidate){
       events.push(note+" signalReferenceTs="+iso(fet.candidate.referenceTs)+
         " signalAnchorPrice="+round(fet.candidate.entryPrice,7)+
         " volumeRatio="+round(fet.candidate.volumeRatio,4)+
         " return72h="+round(fet.candidate.return72h*100,4)+"%");
     }else events.push(note);
   }
   // Frozen IDLE native entry and pretarget filters are run as shadow
   // telemetry ONLY; the IDLE runner, 12h lifecycle, shared slots and EXIT
   // are not implemented, so never admit these candidates as trades.
   if(inMain&&step.completedH1.some(x=>x.symbol==="BTCUSDT")){
     const idleProbes=probeSyntheticIdleAt(feed,step.observedAt);
     for(const probe of idleProbes){
       events.push("RISK IDLE_NATIVE_"+probe.symbol+" [PINNED_NATIVE_IDLE_SHADOW] "+
         (probe.researchPreliminaryEligible?"PASS":"BLOCK")+
         " asOf="+probe.asOf+" sourceRevision=9118eeaa6"+
         " nativeCandidate="+probe.nativeEntryCandidate+
         " status="+probe.status+" NO_FILL");
     }
   }
   // PENGU research pretarget gates have no entry candidate input here.
   // Passing these regime filters never creates a SHORT_V20/RECOVERY_V8 order.
   if(inMain&&step.completedH1.some(x=>x.symbol==="BTCUSDT")){
     const g=probeSyntheticPenguAt(feed,step.observedAt);
     for(const [route,x] of [["SHORT_V20",g.shortV20],["RECOVERY_V8",g.recoveryV8]] as const){
       events.push("RISK PENGU_"+route+" [RESEARCH_PRETARGET_ONLY] "+
         (x.conditionPass?"PASS":"BLOCK")+" asOf="+g.asOf+
         " status="+x.status+" btc24="+
         (g.btc24h===null?"NA":round(g.btc24h*100,4)+"%")+
         " pengu72="+(g.pengu72h===null?"NA":round(g.pengu72h*100,4)+"%")+
         " NO_NATIVE_ENTRY_CANDIDATE NO_FILL");
     }
   }
   const b=step.completedH1.find(x=>x.symbol==="BTCUSDT"),
     h=step.completedH1.find(x=>x.symbol==="HYPEUSDT");
   if(Boolean(b)!==Boolean(h))throw Error("MULTIASSET_H48_ASOF_H1_ALIGNMENT");
   if(b&&h){
     if(b.closedAt!==h.closedAt||b.partialSession||h.partialSession)
       throw Error("MULTIASSET_H48_H1_INVALID");
     btcCandles.push(candle(b));
     observations.push({btcClose:b.close,hypeClose:h.close});
     lastDecision=decided(observations,b.closedAt);
     if(inMain){
       events.push("RISK "+H48_RESEARCH_LOGIC+" HYPEUSDT "+
         (lastDecision.candidate?"PASS":"BLOCK")+" asOf="+b.closedAt+
         " H12="+(lastDecision.h12===null?"NA":round(100*lastDecision.h12,4)+"%")+
         " H24="+(lastDecision.h24===null?"NA":round(100*lastDecision.h24,4)+"%")+
         " relative24="+(lastDecision.rel24===null?"NA":round(100*lastDecision.rel24,4)+"%")+
         " reason="+lastDecision.reason);
     }
     pending=lastDecision.candidate;
   }
   if(inMain){
     const unreal=position?position.qty*(hype.price-position.entry)*step.usdJpy:0;
     const equity=YEN+realized+unreal;
     if(!Number.isFinite(equity)||equity<=0)throw Error("MULTIASSET_H48_EQUITY_INVALID");
     const gross=position?position.qty*hype.price*step.usdJpy/equity:0;
     const positions:Position[]=position?[{
       id:position.id,logic:H48_RESEARCH_LOGIC,symbol:"HYPEUSDT",
       side:"LONG",quantity:round(position.qty,10),entry:position.entry,
       mark:hype.price,gross:round(gross,8),grossAtEntry:1,
       category:"crypto",openedAt:position.openedAt
     }]:[];
     const forming=feed.formingH1("BTCUSDT");
     frames.push({
       timestamp:step.observedAt,btc:btc.price,equity:round(equity),
       realized:round(realized),positions,events,syntheticFxJpy:step.usdJpy,
       h48Research:{hypePrice:hype.price,h12:lastDecision.h12,
         h24:lastDecision.h24,btc24:lastDecision.btc24,rel24:lastDecision.rel24,
         ready:lastDecision.ready,candidate:lastDecision.candidate,reason:lastDecision.reason},
       ...(forming?{formingBtcCandle:candle(forming)}:{})
     });
   }
   lastHype=hype.price;lastFx=step.usdJpy;
 }
 if(frames.length!==PLAY_HOURS*12||btcCandles.length!==WARMUP_HOURS+PLAY_HOURS)
   throw Error("MULTIASSET_H48_FRAMES_MISSING");
 return {schema:"disdex-bt-portfolio-v1",mode:"DEMO",seed,
   engineSha:"H48_CANDIDATE_RESEARCH_"+(feedVersion==="v2"?"24SYM_V2":"23SYM_V1")+"_SYNTHETIC_NOT_NATIVE_PRODUCTION",
   frames,btcCandles,limits:{total:3.5,crypto:3,stock:1.5},
   strategyCatalog:[{logic:H48_RESEARCH_LOGIC,trades:entries,
     sourceRuntimeShas:["UNVERIFIED_RESEARCH_RULE_SOURCE"],
     modelClasses:["H48_CANDIDATE_6H_GRID_6PCT_M5_STOP"],
     routes:1,symbols:1,status:"RESEARCH_SOURCE_UNVERIFIED"}],
   source:{kind:"SYNTHETIC_MULTI_ASSET_H48_CANDIDATE",
     grossCapEvidence:"SYNTHETIC_SINGLE_SLEEVE_NO_PORTFOLIO_PARITY",
     note:(feedVersion==="v2"?"24 assets including TIA (v2) ":"23 assets without TIA (v1) ")+"generated independently of LIVE, but ONLY frozen H48 research candidate on BTC and HYPE is admitted. 6h UTC grid, 48h maximum, synthetic observed M5 stop 6%, model FX/funding/costs. Pinned FET and IDLE pure native entry probes are shadow-only and never open positions; IDLE TIA receives synthetic H1 only in v2 and is explicitly blocked in v1, TAO 12h research sensor state is not a portfolio risk model. PENGU ShortV20 and RecoveryV8 research regime-only filters likewise have no native candidate or fills. No native production STOP, no formal V4 priority preemption or complete other runners, no Online Layer2/3 or Shared Risk. This is NOT a STABLE4 integrated backtest or execution evidence."}
 };
}
