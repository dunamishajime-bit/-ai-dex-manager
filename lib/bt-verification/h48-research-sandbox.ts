import type {Replay,ReplayFrame,Position} from "./replay";
import {createPreviewReplay,DEMO_WARMUP_HOURS,DEMO_TICKS_PER_HOUR,DEMO_BASE_JPY,DEMO_SYNTHETIC_USDJPY,type DemoScenario} from "./demo";

/** Frozen historical H48R4 research *entry* thresholds.
 * This is a synthetic-market single-sleeve diagnostic, not full STABLE4.
 * In particular, no V4 preemption, Q102, Layer2/3, Funding or venue execution is modeled.
 */
export const H48_RESEARCH_THRESHOLDS=Object.freeze({
  h12Max:.0042978523,h24Min:.020474266,rel24Max:.0262025534,
  holdingHours:48,requestedGrossX:1.0
});
export const H48_RESEARCH_LOGIC="HYPE_H48_RESEARCH";
export type H48Observation={btcClose:number;hypeClose:number};
export type H48Decision={
  ready:boolean;candidate:boolean;h12:number|null;h24:number|null;
  btc24:number|null;rel24:number|null;reason:string;
};
export function evaluateH48ClosedHourly(observations:readonly H48Observation[]):H48Decision{
  if(observations.length<25) return {ready:false,candidate:false,h12:null,h24:null,btc24:null,rel24:null,reason:"確定した25本以上の足が必要"};
  const a=observations[observations.length-1];
  const p12=observations[observations.length-13],p24=observations[observations.length-25];
  if([a.btcClose,a.hypeClose,p12.hypeClose,p24.hypeClose,p24.btcClose].some(n=>!Number.isFinite(n)||n<=0))
    return {ready:false,candidate:false,h12:null,h24:null,btc24:null,rel24:null,reason:"価格入力が不正"};
  const h12=a.hypeClose/p12.hypeClose-1,h24=a.hypeClose/p24.hypeClose-1;
  const btc24=a.btcClose/p24.btcClose-1,rel24=h24-btc24;
  const candidate=h12<=H48_RESEARCH_THRESHOLDS.h12Max&&
    h24>=H48_RESEARCH_THRESHOLDS.h24Min&&rel24<=H48_RESEARCH_THRESHOLDS.rel24Max;
  const reasons=[];
  if(h12>H48_RESEARCH_THRESHOLDS.h12Max)reasons.push("H12上昇過多");
  if(h24<H48_RESEARCH_THRESHOLDS.h24Min)reasons.push("H24上昇不足");
  if(rel24>H48_RESEARCH_THRESHOLDS.rel24Max)reasons.push("BTC相対上昇過多");
  return {ready:true,candidate,h12,h24,btc24,rel24,reason:candidate?"H48入口3条件PASS":reasons.join("/")};
}
function seeded(seed:number){
  let state=(seed>>>0)||123456;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
}
const round=(v:number,d=2)=>Number(v.toFixed(d));
const START=Date.parse("2025-10-01T00:00:00Z");
const atHour=(hour:number)=>new Date(START+hour*3600_000).toISOString().replace(".000Z","Z");
/** Deterministic synthetic HYPE, driven only by concurrently observed BTC ticks.
 * The source BTC candles are the existing visual simulation, never future input into H48.
 */
export function createH48ResearchReplay(seed=123456,scenario:DemoScenario="trend",costBps:10|30=10):Replay{
  if(!Number.isSafeInteger(seed)||seed<0||seed>4294967295)throw Error("Invalid synthetic seed");
  if(costBps!==10&&costBps!==30)throw Error("Invalid model round-trip fee");
  const base=createPreviewReplay(seed,scenario);
  const btcBars=base.btcCandles!;
  const rng=seeded(seed^0x48a1);
  const priceByTick:number[]=[];
  const warmupHypeCloses:number[]=[];
  let hype=45,btcPrior=btcBars[0].open;
  function observedTick(btc:number,globalTick:number){
    const cycle=Math.floor(globalTick/DEMO_TICKS_PER_HOUR)%72;
    const hourlyDrift=cycle<12?.003:cycle<24?.00005:cycle<50?-.00035:.0001;
    const relative=Math.log(btc/btcPrior),noise=(rng()-.5)*.00016;
    hype=Math.max(.1,Math.min(1000,hype*Math.exp(hourlyDrift/DEMO_TICKS_PER_HOUR+relative*.35+noise)));
    btcPrior=btc;
    return hype;
  }
  for(let hour=0;hour<DEMO_WARMUP_HOURS;hour++){
    const c=btcBars[hour];
    for(let step=1;step<=DEMO_TICKS_PER_HOUR;step++){
      const observed=c.open*Math.exp(Math.log(c.close/c.open)*step/DEMO_TICKS_PER_HOUR);
      observedTick(observed,hour*DEMO_TICKS_PER_HOUR+step-1);
    }
    warmupHypeCloses.push(hype);
  }
  for(let i=0;i<base.frames.length;i++){
    priceByTick.push(observedTick(base.frames[i].btc!,DEMO_WARMUP_HOURS*DEMO_TICKS_PER_HOUR+i));
  }
  const observations:H48Observation[]=warmupHypeCloses.map((hypeClose,i)=>({btcClose:btcBars[i].close,hypeClose}));
  let realized=0,sequence=0,position:null|{id:string;entry:number;qty:number;at:string;hour:number}=null;
  let pending=false,admitted=0;
  const feeRate=costBps/20000;
  const frames:ReplayFrame[]=[];
  for(let hour=0;hour<base.frames.length/DEMO_TICKS_PER_HOUR;hour++){
    const open=hour===0?warmupHypeCloses.at(-1)!:priceByTick[hour*DEMO_TICKS_PER_HOUR-1];
    const tickEvents:string[]=[];
    // H48R4 research uses NEXT hourly open, never the future hour's close.
    if(position&&hour-position.hour>=H48_RESEARCH_THRESHOLDS.holdingHours){
      const net=position.qty*(open-position.entry)*DEMO_SYNTHETIC_USDJPY-
        position.qty*open*DEMO_SYNTHETIC_USDJPY*feeRate;
      realized+=net;
      tickEvents.push("EXIT "+H48_RESEARCH_LOGIC+" HYPEUSDT LONG reason=HYPE_REDESIGN_TIME48_NEXTOPEN netJPY="+round(net));
      position=null;
    }
    if(pending){
      if(position){tickEvents.push("BLOCK "+H48_RESEARCH_LOGIC+" HYPEUSDT reason=H48_SLOT_OCCUPIED");}
      else{
        const before=DEMO_BASE_JPY+realized;
        if(before<=0){tickEvents.push("BLOCK "+H48_RESEARCH_LOGIC+" HYPEUSDT reason=EQUITY_NONPOSITIVE");}
        else{
          const qty=before*H48_RESEARCH_THRESHOLDS.requestedGrossX/(open*DEMO_SYNTHETIC_USDJPY);
          realized-=qty*open*DEMO_SYNTHETIC_USDJPY*feeRate;
          position={id:H48_RESEARCH_LOGIC+"-"+(++sequence),entry:open,qty,at:atHour(hour),hour};
          admitted++;
          tickEvents.push("ENTRY "+H48_RESEARCH_LOGIC+" HYPEUSDT LONG price="+round(open)+" modelGross=1.0x feeBps="+costBps+" [H48_RESEARCH_ONLY]");
        }
      }
      pending=false;
    }
    for(let step=0;step<DEMO_TICKS_PER_HOUR;step++){
      const index=hour*DEMO_TICKS_PER_HOUR+step,mark=priceByTick[index];
      const original=base.frames[index];
      const events=step===0?tickEvents.slice():[];
      if(step===DEMO_TICKS_PER_HOUR-1){
        const i=DEMO_WARMUP_HOURS+hour;
        observations.push({btcClose:btcBars[i].close,hypeClose:mark});
        const d=evaluateH48ClosedHourly(observations);
        events.push("RISK "+H48_RESEARCH_LOGIC+" HYPEUSDT "+(d.candidate?"PASS":"BLOCK")+
          " H12="+(d.h12===null?"NA":round(d.h12*100,3)+"%")+
          " H24="+(d.h24===null?"NA":round(d.h24*100,3)+"%")+
          " REL24="+(d.rel24===null?"NA":round(d.rel24*100,3)+"%")+
          " reason="+d.reason);
        if(d.candidate)pending=true;
      }
      const unrealized=position?position.qty*(mark-position.entry)*DEMO_SYNTHETIC_USDJPY:0;
      const equity=DEMO_BASE_JPY+realized+unrealized;
      const exposure=position?position.qty*mark*DEMO_SYNTHETIC_USDJPY/Math.max(.001,equity):0;
      const positions:Position[]=position?[{
        id:position.id,logic:H48_RESEARCH_LOGIC,symbol:"HYPEUSDT",side:"LONG",
        quantity:round(position.qty,9),entry:round(position.entry,8),mark:round(mark,8),
        gross:round(exposure,9),grossAtEntry:1,category:"crypto",openedAt:position.at
      }]:[];
      frames.push({
        timestamp:original.timestamp,btc:original.btc,equity:round(equity),realized:round(realized),
        positions,events,...(original.formingBtcCandle?{formingBtcCandle:original.formingBtcCandle}:{})
      });
    }
  }
  return {
    schema:"disdex-bt-portfolio-v1",mode:"DEMO",seed,
    engineSha:"H48R4_RESEARCH_ENTRY_SYNTHETIC_SINGLE_SLEEVE_NOT_STABLE4",
    limits:{total:3.5,crypto:3,stock:1.5},frames,btcCandles:btcBars,
    strategyCatalog:[{logic:H48_RESEARCH_LOGIC,trades:admitted,sourceRuntimeShas:["FROZEN_H48R4_RESEARCH"],modelClasses:["H48R4_SIGNAL_AND_TIME48_ONLY"],routes:1,symbols:1,status:"RESEARCH_SOURCE_UNVERIFIED"}],
    source:{kind:"SYNTHETIC_H48_RESEARCH_RULE_ONLY",grossCapEvidence:"SYNTHETIC_SINGLE_SLEEVE_NOT_RISK_PARITY",
      note:"HYPE H48R4 closed-H1 entry thresholds and next-open 48h time exit only, using artificial HYPE and BTC data. Other runners, V4 preemption, Online Layer2/3, portfolio opportunity, native STOP/TP, funding and actual venue fills are NOT modeled. Results never prove STABLE4 production parity."}
  };
}
