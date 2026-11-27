import {writeFileSync} from "node:fs";
import {observationAt,R21_SYMBOLS,type R21Series} from "../lib/stable4-r21-market-observation";
import {computeIdlePriorityFeatures,evaluateIdlePriorityShort,type IdleH1Candle} from "../lib/idle-priority-short-signal";
import {evaluateIdleLatestFromClosedMarket} from "../lib/stable4-idle-research-policy";
import {buildIdleProtectionPlan,idleRouteRequestedGross} from "../lib/idle-priority-short-live";
import {applyIdleProfitTrailBar,calculateWalletRiskStop,moreProtectiveStop,type IdleTrailState} from "../lib/disdex-exit-overlay-contract";
import {buildHypeTrendSignal,type HypeTrendCandle} from "../lib/hype-trend-long-signal";
import {HYPE_TREND_LONG_POLICY as HP} from "../config/hypeTrendLongPolicy";
import {buildFetBrk48Signal,type FetBrk48Bar} from "../lib/fet-brk48-signal";
import {advanceFetBrk48LongTrailingStop,type FetBrk48TrailingStopState} from "../lib/fet-brk48-trailing-stop";
import {FET_BRK48_RESIDUAL as F} from "../config/fetBrk48Runtime";
import {IDLE_PRIORITY_SHORT_POLICY as I,type IdlePrioritySymbol} from "../config/idlePriorityShortPolicy";
const H=3600000,M=300000,T=Date.UTC(2025,2,1),N=72*288,START=10*288;
const symbols=[...new Set(["BTC",...R21_SYMBOLS,"TAO","TIA","DOT","JUP","RENDER","FET","HYPE"])];
const regimes=[["BULL",.004,.025],["BEAR",-.004,.04],["RANGE",0,.035],["SQUEEZE",.001,.055],["REVERSAL",.005,.045],["PULLBACK",.003,.045]] as const;
function rng(seed:number){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=Math.imul(s^s>>>15,s|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
function market(reg:typeof regimes[number],seed:number){
 const r=rng(seed),normal=()=>Math.sqrt(-2*Math.log(Math.max(1e-12,r())))*Math.cos(2*Math.PI*r());
 const common=Array.from({length:N},normal),data:Record<string,R21Series>={};
 const idle:Record<string,IdleH1Candle[]>={},fet:FetBrk48Bar[]=[];
 for(const sym of symbols){
  let price=100,other=100;const m:number[][]=[],h:number[][]=[],bin:number[][]=[];
  let bm:number[][]=[];
  for(let k=0;k<N;k++){
   const d=k/288,drift=reg[0]==="REVERSAL"&&d>=36?-.007:reg[1];
   const shock=reg[0]==="SQUEEZE"&&k%997===0?(k%2===0?.04:-.04):0;
   const cyc=reg[0]==="PULLBACK"? .006*Math.sin(d*2*Math.PI/9)/288:0;
   const ret=drift/288+cyc+reg[2]/Math.sqrt(288)*(.65*common[k]+.76*normal())+shock;
   const o=price,c=o*Math.exp(ret),w=reg[2]/Math.sqrt(288)*Math.abs(normal())*.45;
   const v=Math.exp(7+.7*normal()+Math.min(2,Math.abs(ret)*70)),frac=.5+.24*Math.tanh(normal()+ret*15);
   m.push([o,Math.max(o,c)*Math.exp(w),Math.min(o,c)*Math.exp(-w),c,v,v*frac]);price=c;
   const bo=other,bc=bo*Math.exp(ret+normal()*.0007),bv=v*Math.exp(normal()*.2);
   bm.push([bo,Math.max(bo,bc)*Math.exp(w),Math.min(bo,bc)*Math.exp(-w),bc,bv,bv*(.5+.24*Math.tanh(normal()+ret*15))]);other=bc;
   if(k%12===11){
    const agg=(a:number[][])=>[a[0][0],Math.max(...a.map(x=>x[1])),Math.min(...a.map(x=>x[2])),a.at(-1)![3],a.reduce((z,x)=>z+x[4],0),a.reduce((z,x)=>z+x[5],0)];
    h.push(agg(m.slice(-12)));bin.push(agg(bm));bm=[];
   }
  }
  data[sym]={startH:T,startM:T,h,m,bin};
  idle[sym]=h.map((b,i)=>({ts:T+i*H,open:b[0],high:b[1],low:b[2],close:b[3],quoteVolume:b[4]*b[3]}));
  if(sym==="FET")h.forEach((b,i)=>fet.push({openTs:T+i*H,closeTs:T+(i+1)*H-1,open:b[0],high:b[1],low:b[2],close:b[3],volume:b[4]}));
 }
 return {data,idle,fet};
}
type C={s:"R21"|"IDLE"|"FET"|"HYPE";sym:string;route:string;gross:number;hold:number;side:1|-1;stopDist?:number;tpDist?:number};
type P=C&{entry:number;k:number;notional:number;stop:number;tp?:number;idleTrail?:IdleTrailState;fetTrail?:FetBrk48TrailingStopState;fee:number};
function simulate(m:ReturnType<typeof market>,bps:number,reserve:boolean){
 let cash=10000,peak=10000,dd=0,dayStart=10000,day=-1,dayHeld=false,ddHeld=false;
 let positions:P[]=[],last:Record<string,number>={},counts:Record<string,number>={},wins=0,trades=0,entryFees=0,exitFees=0;
 const entered:Record<string,number>={R21:0,IDLE:0,FET:0,HYPE:0},raw={R21:0,IDLE:0,FET:0,HYPE:0},exits:Record<string,number>={};
 const tally=(a:Record<string,number>,s:string)=>a[s]=(a[s]??0)+1;
 const eq=(k:number)=>cash+positions.reduce((a,p)=>a+p.notional*p.side*(m.data[p.sym].m[k]![0]/p.entry-1),0);
 function close(p:P,px:number,k:number,reason:string){
  const cost=p.notional*bps/20000,pnl=p.notional*p.side*(px/p.entry-1);cash+=pnl-cost;
  exitFees+=cost;trades++;wins+=Number(pnl-p.fee-cost>0);last[p.s+":"+p.sym]=p.s==="IDLE"?p.k:k;
  tally(exits,p.s+":"+reason);
 }
 for(let k=START;k<N;k++){
  const t=T+k*M;
  // TIME closes at first observed open at expiry, before new entry.
  positions=positions.filter(p=>{if(k<p.k+p.hold*12)return true;close(p,m.data[p.sym].m[k]![0],k,"TIME");return false;});
  let e=eq(k);if(!(e>0)){dd=1;break;}
  if(Math.floor(k/288)!==day){day=Math.floor(k/288);dayStart=e;dayHeld=false;}
  peak=Math.max(peak,e);dd=Math.max(dd,1-e/peak);ddHeld ||= dd>.30;dayHeld ||= e/dayStart<.925;
  if(k%12===0&&k<N-48*12){
   const cs:C[]=observationAt(m.data,t).map(x=>({s:"R21",sym:x.symbol.slice(0,-4),route:x.route,gross:.3,hold:x.route==="R21_OLD24"?24:48,side:-1}));
   raw.R21+=cs.length;
   const fs=buildFetBrk48Signal(m.fet.slice(Math.max(0,k/12-80),k/12),t);
   if(fs){raw.FET++;cs.push({s:"FET",sym:"FET",route:fs.strategyId,gross:1,hold:F.holdHours,side:1});}
   const h=k/12,btc=m.idle.BTC.slice(h-90,h),tao=m.idle.TAO.slice(h-90,h);
   for(const sym of Object.keys(I.routes) as IdlePrioritySymbol[]){
    const s=sym.slice(0,-4),features=computeIdlePriorityFeatures(t,m.idle[s].slice(h-90,h),btc);
    const signal=evaluateIdlePriorityShort(sym,features);if(!signal.accepted)continue;raw.IDLE++;
    if(!evaluateIdleLatestFromClosedMarket({decisionTs:t,btc,tao},signal).retained){tally(counts,"IDLE_R26_FILTER");continue;}
    cs.push({s:"IDLE",sym:s,route:signal.route,gross:idleRouteRequestedGross(sym,signal.route),hold:signal.holdHours,side:-1});
   }
   // HYPE is a native H1 low-priority source. Never invent a forced
   // reduction of an incumbent higher-priority sleeve to admit it.
   if(k<N-HP.maximumHoldHours*12){
    const hist=(sym:string):HypeTrendCandle[]=>{
     const start=Math.max(0,h-360);
     return m.data[sym].h.slice(start,h).map((r,i)=>({
      openTime:T+(start+i)*H,open:r[0],high:r[1],low:r[2],close:r[3],volume:r[4]
     }));
    };
    const signal=buildHypeTrendSignal({now:t,btc:hist("BTC"),hype:hist("HYPE")});
    if(signal.accepted&&signal.stopDistance&&signal.trailingDistance&&signal.entryPrice){
     raw.HYPE++;
     const candidateGross=Math.min(HP.maximumGross,(HP.riskPct/100)/
      (signal.stopDistance/signal.entryPrice+bps/10000));
     cs.push({s:"HYPE",sym:"HYPE",route:"HYPE_TREND_LONG_PINNED",gross:candidateGross,
      hold:HP.maximumHoldHours,side:1,stopDist:signal.stopDistance,tpDist:signal.trailingDistance});
    }
   }
   for(const c of cs.sort((a,b)=>["R21","FET","IDLE","HYPE"].indexOf(a.s)-["R21","FET","IDLE","HYPE"].indexOf(b.s)||a.sym.localeCompare(b.sym)||a.route.localeCompare(b.route))){
    e=eq(k);if(ddHeld||dayHeld){tally(counts,ddHeld?"DD30":"DAILY_7P5");continue;}
    const lp=last[c.s+":"+c.sym];if(lp!==undefined&&k-lp<(c.s==="FET"?24:12)*12){tally(counts,"COOLDOWN");continue;}
    if(positions.some(p=>p.sym===c.sym||p.s===c.s)){tally(counts,"SLOT");continue;}
    // IDLE/FET are residual/priority-limited sleeves; no fabricated other-owner activity.
    if(c.s==="IDLE"&&positions.length||c.s==="FET"&&positions.some(p=>p.s==="R21"||p.s==="HYPE")||c.s==="HYPE"&&positions.length){tally(counts,"BASELINE_OCCUPIED");continue;}
    if(c.s==="R21"&&positions.some(p=>p.s==="IDLE"||p.s==="FET"||p.s==="HYPE")){tally(counts,"PREEMPTION_NOT_MODELED");continue;}
    const gross=positions.reduce((z,p)=>z+p.notional*m.data[p.sym].m[k]![0]/p.entry/e,0);
    if(gross+c.gross>3+1e-12){tally(counts,"GROSS");continue;}
    const entry=m.data[c.sym].m[k]![0],notional=e*c.gross;
    let stop=c.s==="R21"?entry*1.08:entry*(1-F.hardStopPct),tp=c.route==="R21_NEW48"?entry*.92:undefined;
    if(c.s==="IDLE"){const plan=buildIdleProtectionPlan({symbol:(c.sym+"USDT") as IdlePrioritySymbol,signalTs:t,entryPrice:entry,quantity:notional/entry});stop=plan.stopPrice;tp=plan.takeProfitPrice;}
    if(c.s==="HYPE"){
     if(!c.stopDist||!c.tpDist)throw Error("HYPE_NATIVE_ATR_NOT_PROVEN");
     const wallet=calculateWalletRiskStop({side:"LONG",entryPrice:entry,equity:e,acceptedGross:c.gross,
      walletRiskPct:2,roundTripCostBps:bps});
     stop=moreProtectiveStop("LONG",entry-c.stopDist,wallet.stopPrice);
     tp=entry+c.tpDist;
    }
    if(reserve){
     const remaining=positions.reduce((z,p)=>{const mark=m.data[p.sym].m[k]![0];return z+p.notional*(Math.max(0,p.side*(mark-p.stop)/p.entry)+.02*mark/p.entry+bps/20000);},0);
     const loss=notional*(Math.abs(stop/entry-1)+.02+bps/10000);
     if(e-remaining-loss<peak*.7){tally(counts,"STOP_RESERVE");continue;}
    }
    const fee=notional*bps/20000;cash-=fee;entryFees+=fee;positions.push({...c,entry,k,notional,stop,tp,fee});entered[c.s]++;
   }
  }
  // Prior resident stops fire inside this bar. New trailing levels use only its close.
  positions=positions.filter(p=>{
   const [o,h,l,c]=m.data[p.sym].m[k]!,bar={timestampMs:t,open:o,high:h,low:l,close:c};
   if(p.side===1?l<=p.stop:h>=p.stop){close(p,p.side===1?Math.min(o,p.stop):Math.max(o,p.stop),k+1,"STOP");return false;}
   if(p.tp!==undefined&&(p.side===1?h>=p.tp:l<=p.tp)){close(p,p.side===1?Math.max(o,p.tp):Math.min(o,p.tp),k+1,"TP");return false;}
   if(p.s==="IDLE"&&p.sym==="DOT"){const x=applyIdleProfitTrailBar({side:"SHORT",entryPrice:p.entry,state:p.idleTrail,bar});p.idleTrail=x.state;if(x.state.stopPrice!==undefined)p.stop=Math.min(p.stop,x.state.stopPrice);}
   if(p.s==="FET"){const x=advanceFetBrk48LongTrailingStop({entryPrice:p.entry,state:p.fetTrail,bar});p.fetTrail=x.state;if(c>=p.entry*(1+F.profitFloorTriggerPct))p.stop=Math.max(p.stop,p.entry*(1+F.profitFloorStopPct));if(x.state.stopPrice!==undefined)p.stop=Math.max(p.stop,x.state.stopPrice);}
   return true;
  });
  e=cash+positions.reduce((z,p)=>z+p.notional*p.side*(m.data[p.sym].m[k]![3]/p.entry-1),0);
  peak=Math.max(peak,e);dd=Math.max(dd,1-e/peak);ddHeld ||= dd>.30;dayHeld ||= e/dayStart<.925;
 }
 if(positions.length)throw Error("UNEXPECTED_TERMINAL_OPEN");
 return {final:cash,dd:dd*100,trades,wins,raw,entered,exits,counts,entryFees,exitFees};
}
const output=process.argv[2];if(!output)throw Error("OUTPUT_REQUIRED");
const rows:any[]=[];
for(const reg of regimes)for(const seed of [2026112801,2026112802]){
 const m=market(reg,seed),r:any={regime:reg[0],seed,cases:{}};
 for(const fee of [10,30])for(const reserve of [false,true])r.cases[fee+"/"+reserve]=simulate(m,fee,reserve);
 rows.push(r);console.log(reg[0],seed,JSON.stringify(r.cases["30/true"]));
}
writeFileSync(output,JSON.stringify({status:"FOUR_NATIVE_ENTRY_SLEEVES_PARTIAL_RESEARCH_ONLY",limitations:["R21 subset of V4, IDLE R26 legacy routes, FET BRK48, and HYPE TREND; NO PENGU Q102 V52 or other V4 source routes. Independent HYPE M5 model source equivalent STOP/TP levels but artificial bar prints not signed venue fills","Conservative blocked preemption and HYPE lowest priority, no venue depth, funding, tick rounding, signed lifecycle, live API","5m open/close MTM, daily 7.5% entry latch and shared crypto cap; no formal production parity","FET profit floor and resident STOP model, source trail functions; IDLE source protection/trail; simulated fills"],rows},null,2),{flag:"wx"});
