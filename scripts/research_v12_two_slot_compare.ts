import fs from "fs/promises";
import path from "path";
import type { Candle1h } from "../lib/backtest/types";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { PerpBar, PerpMarketData, PerpSide } from "../lib/research-lab/perp/types";

const HOUR = 3_600_000;
const STARTING_EQUITY = 10_000;
const START = Date.UTC(2023, 6, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 180 * 24 * HOUR;
const UNIVERSE = ["BTC","ETH","BNB","SOL","LINK","AVAX","DOGE","INJ","XRP","ADA","LTC","ATOM","AAVE","NEAR"];
const P = {
  timeframeHours:2, leverage:1, riskPerTradePct:3.19, maxMarginUsagePct:100,
  btcRegimeSmaBars:53, btcRegimeMomentumBars:52, regimeThresholdPct:0.0377,
  momentumBars:45, breakoutBars:18, breakoutBufferPct:0.0233, minimumMomentumPct:0.0227,
  minimumVolumeRatio:0.9845, minimumEdgeToCostRatio:6.0879, volatilityLookbackBars:15,
  volatilityPenalty:2.3953, atrBars:31, stopAtr:2.477, takeProfitAtr:3.1995, trailingAtr:0.4,
  maxHoldBars:23, rebalanceBars:20, cooldownBars:1, allowNeutralRegime:true, neutralScoreThreshold:1.4649,
};
const NORMAL = { feeBpsPerSide:5, slippageBpsPerSide:0, maintenanceMarginRate:0.005 };
type Prepared={bySymbol:Record<string,PerpBar[]>;indexes:Record<string,Map<number,number>>;timeline:number[]};
type Candidate={symbol:string;side:PerpSide;score:number;atr:number;signalTs:number};
type Position={tradeId:string;symbol:string;side:PerpSide;entryPrice:number;quantity:number;notional:number;entryFee:number;fundingCost:number;lastFundingTs:number;initialStopPrice:number;residentStopPrice:number;takeProfitPrice:number;liquidationPrice:number;peakPrice:number;troughPrice:number;atrAtEntry:number;holdingBars:number;rankAtEntry:number};
type Trade={symbol:string;side:PerpSide;netPnl:number;exitReason:string;rankAtEntry:number};
type Mode={label:string;feeBpsPerSide:number;slippageBpsPerSide:number};

function mean(x:number[]){return x.length?x.reduce((a,b)=>a+b,0)/x.length:0}
function std(x:number[]){if(x.length<2)return 0;const m=mean(x);return Math.sqrt(Math.max(0,x.reduce((s,v)=>s+(v-m)**2,0)/(x.length-1)))}
function resample(c:Candle1h[]):PerpBar[]{const m=new Map<number,PerpBar>();for(const x of c){const ts=Math.floor(x.ts/(2*HOUR))*2*HOUR,e=m.get(ts);if(!e)m.set(ts,{...x,ts});else{e.high=Math.max(e.high,x.high);e.low=Math.min(e.low,x.low);e.close=x.close;e.volume+=x.volume}}return[...m.values()].sort((a,b)=>a.ts-b.ts)}
function prepare(data:PerpMarketData):Prepared{const bySymbol:Record<string,PerpBar[]>={},indexes:Record<string,Map<number,number>>={};for(const [s,c] of Object.entries(data.bySymbol)){const b=resample(c);bySymbol[s]=b;indexes[s]=new Map(b.map((x,i)=>[x.ts,i]))}return{bySymbol,indexes,timeline:(bySymbol.BTC??[]).map(x=>x.ts)}}
function sma(b:PerpBar[],i:number,n:number){if(i-n+1<0)return null;return mean(b.slice(i-n+1,i+1).map(x=>x.close))}
function mom(b:PerpBar[],i:number,n:number){const p=b[i-n],c=b[i];return!p||!c||p.close<=0?null:c.close/p.close-1}
function atr(b:PerpBar[],i:number,n:number){if(i-n<0)return null;const r:number[]=[];for(let j=i-n+1;j<=i;j++){const x=b[j],p=b[j-1];if(!x||!p)return null;r.push(Math.max(x.high-x.low,Math.abs(x.high-p.close),Math.abs(x.low-p.close)))}return mean(r)}
function vol(b:PerpBar[],i:number,n:number){if(i-n<0)return null;const r:number[]=[];for(let j=i-n+1;j<=i;j++){const x=b[j],p=b[j-1];if(!x||!p||x.close<=0||p.close<=0)return null;r.push(Math.log(x.close/p.close))}return std(r)}
function vr(b:PerpBar[],i:number,n=20){if(i-n<0)return null;const base=mean(b.slice(i-n,i).map(x=>x.volume));return base>0?b[i]!.volume/base:null}
function candidates(prep:Prepared,ts:number):Candidate[]{const btc=prep.bySymbol.BTC,bi=prep.indexes.BTC?.get(ts);if(!btc||bi==null)return[];const bs=sma(btc,bi,P.btcRegimeSmaBars),bm=mom(btc,bi,P.btcRegimeMomentumBars),bb=btc[bi];if(!bb||bs==null||bm==null||bs<=0)return[];const dist=bb.close/bs-1,longReg=dist>=P.regimeThresholdPct&&bm>0,shortReg=dist<=-P.regimeThresholdPct&&bm<0,neutral=!longReg&&!shortReg;const minMove=(NORMAL.feeBpsPerSide*2/10000)*P.minimumEdgeToCostRatio,out:Candidate[]=[];for(const s of UNIVERSE){const b=prep.bySymbol[s],i=prep.indexes[s]?.get(ts);if(!b||i==null)continue;const x=b[i],m=mom(b,i,P.momentumBars),v=vol(b,i,P.volatilityLookbackBars),a=atr(b,i,P.atrBars),ratio=vr(b,i);if(!x||m==null||v==null||a==null||ratio==null||x.close<=0||ratio<P.minimumVolumeRatio||Math.abs(m)<minMove)continue;const scale=Math.max(.0001,v*Math.sqrt(P.momentumBars)),raw=m/scale,score=raw/(1+P.volatilityPenalty*v*100);if(m>=P.minimumMomentumPct&&(longReg||(neutral&&P.allowNeutralRegime&&score>=P.neutralScoreThreshold)))out.push({symbol:s,side:"long",score,atr:a,signalTs:ts});if(m<=-P.minimumMomentumPct&&(shortReg||(neutral&&P.allowNeutralRegime&&-score>=P.neutralScoreThreshold)))out.push({symbol:s,side:"short",score:-score,atr:a,signalTs:ts})}return out.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))}
function firstFundingAfter(p:{ts:number;rate:number}[],ts:number){let lo=0,hi=p.length;while(lo<hi){const m=Math.floor((lo+hi)/2);if((p[m]?.ts??Infinity)<=ts)lo=m+1;else hi=m}return lo}
function fundingBetween(p:{ts:number;rate:number}[],from:number,to:number){let i=firstFundingAfter(p,from),t=0;while(i<p.length){const x=p[i];if(!x||x.ts>to)break;t+=x.rate;i++}return t}
function pf(p:number[]){const gp=p.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=Math.abs(p.filter(x=>x<0).reduce((a,b)=>a+b,0));return gl>0?gp/gl:gp>0?99:0}
function pfwb(p:number[]){const x=[...p];if(x.length)x.splice(x.indexOf(Math.max(...x)),1);return pf(x)}

function runTwo(data:PerpMarketData,prep:Prepared,startTs:number,endTs:number,mode:Mode){
 const fee=mode.feeBpsPerSide/10000,slip=mode.slippageBpsPerSide/10000,timeline=prep.timeline.filter(ts=>ts>=startTs&&ts<endTs);
 let balance=STARTING_EQUITY,seq=0,peak=STARTING_EQUITY,maxDD=0,maxGross=0,grossSum=0,grossObs=0,bars2=0,secondEntries=0,existingSecondEntries=0,capacityBlocks=0;
 const positions=new Map<string,Position>(),pending=new Map<string,{c:Candidate;rank:number}>(),pendingExit=new Map<string,string>(),cooldown=new Map<string,number>(),trades:Trade[]=[],pnls:number[]=[];
 const mark=(s:string,ts:number,field:"open"|"close"="close")=>{const i=prep.indexes[s]?.get(ts),b=i==null?null:prep.bySymbol[s]?.[i];return b?b[field]:null};
 const equityAt=(ts:number,field:"open"|"close"="close")=>{let eq=balance;for(const p of positions.values()){const px=mark(p.symbol,ts,field)??p.entryPrice,dir=p.side==="long"?1:-1;eq+=dir*p.quantity*(px-p.entryPrice)-p.quantity*px*fee}return Math.max(0,eq)};
 const portfolioGross=(ts:number,field:"open"|"close"="close")=>{const eq=Math.max(1,equityAt(ts,field));let n=0;for(const p of positions.values()){const px=mark(p.symbol,ts,field)??p.entryPrice;n+=Math.abs(p.quantity*px)}return n/eq};
 const close=(p:Position,raw:number,reason:string,ts:number)=>{const exit=p.side==="long"?raw*(1-slip):raw*(1+slip),dir=p.side==="long"?1:-1,g=dir*p.quantity*(exit-p.entryPrice),exitFee=p.quantity*exit*fee,net=g-p.entryFee-exitFee-p.fundingCost;balance=Math.max(0,balance+g-exitFee);trades.push({symbol:p.symbol,side:p.side,netPnl:net,exitReason:reason,rankAtEntry:p.rankAtEntry});pnls.push(net);positions.delete(p.symbol);pendingExit.delete(p.symbol);cooldown.set(p.symbol,ts+P.cooldownBars*P.timeframeHours*HOUR)};
 for(const ts of timeline){
   for(const [s,reason] of [...pendingExit]){const p=positions.get(s),o=mark(s,ts,"open");if(p&&o)close(p,o,reason,ts);pendingExit.delete(s)}
   for(const [s,item] of [...pending]){
     if(positions.size>=2||positions.has(s)||(cooldown.get(s)??0)>ts){pending.delete(s);continue}
     const raw=mark(s,ts,"open");if(!raw){pending.delete(s);continue}
     const eq=equityAt(ts,"open");if(eq<=0){pending.delete(s);continue}
     const entry=item.c.side==="long"?raw*(1+slip):raw*(1-slip),stopDistance=Math.max(item.c.atr*P.stopAtr,entry*.005),riskCapital=eq*P.riskPerTradePct/100,riskNotional=riskCapital/Math.max(.001,stopDistance/entry);
     let activeNotional=0;for(const p of positions.values()){const px=mark(p.symbol,ts,"open")??p.entryPrice;activeNotional+=Math.abs(p.quantity*px)}
     const remaining=Math.max(0,eq-activeNotional),notional=Math.min(riskNotional,eq,remaining),gross=notional/eq;
     if(!(notional>0&&gross>=.1)){capacityBlocks++;pending.delete(s);continue}
     const qty=notional/entry,entryFee=notional*fee;if(entryFee>=balance*.1){pending.delete(s);continue}
     const hadExisting=positions.size>0;balance-=entryFee;const liqDist=Math.max(.005,1/Math.max(.1,gross)-NORMAL.maintenanceMarginRate),rawStop=item.c.side==="long"?entry-stopDistance:entry+stopDistance,liq=item.c.side==="long"?entry*(1-liqDist):entry*(1+liqDist),initial=item.c.side==="long"?Math.max(rawStop,liq*1.01):Math.min(rawStop,liq*.99),tp=item.c.side==="long"?entry+item.c.atr*P.takeProfitAtr:entry-item.c.atr*P.takeProfitAtr;
     positions.set(s,{tradeId:`two-${++seq}`,symbol:s,side:item.c.side,entryPrice:entry,quantity:qty,notional,entryFee,fundingCost:0,lastFundingTs:ts,initialStopPrice:initial,residentStopPrice:initial,takeProfitPrice:tp,liquidationPrice:liq,peakPrice:entry,troughPrice:entry,atrAtEntry:item.c.atr,holdingBars:0,rankAtEntry:item.rank});
     if(item.rank===2)secondEntries++;if(hadExisting)existingSecondEntries++;pending.delete(s)
   }
   for(const p of [...positions.values()]){
     const i=prep.indexes[p.symbol]?.get(ts),b=i==null?null:prep.bySymbol[p.symbol]?.[i];if(!b)continue;p.holdingBars++;
     const points=data.fundingBySymbol[p.symbol]??[],rate=fundingBetween(points,p.lastFundingTs,ts),charge=p.notional*rate*(p.side==="long"?1:-1);p.fundingCost+=charge;p.lastFundingTs=ts;balance=Math.max(0,balance-charge);
     const stop=p.residentStopPrice;
     if(p.side==="long"){if(b.low<=p.liquidationPrice){close(p,p.liquidationPrice,"liquidation",ts);continue}else if(b.low<=stop){close(p,stop,stop>p.initialStopPrice?"trailing-stop":"stop-loss",ts);continue}else if(b.high>=p.takeProfitPrice){close(p,p.takeProfitPrice,"take-profit",ts);continue}}
     else{if(b.high>=p.liquidationPrice){close(p,p.liquidationPrice,"liquidation",ts);continue}else if(b.high>=stop){close(p,stop,stop<p.initialStopPrice?"trailing-stop":"stop-loss",ts);continue}else if(b.low<=p.takeProfitPrice){close(p,p.takeProfitPrice,"take-profit",ts);continue}}
     p.peakPrice=Math.max(p.peakPrice,b.high);p.troughPrice=Math.min(p.troughPrice,b.low);const next=p.side==="long"?Math.max(p.initialStopPrice,p.peakPrice-p.atrAtEntry*P.trailingAtr):Math.min(p.initialStopPrice,p.troughPrice+p.atrAtEntry*P.trailingAtr);p.residentStopPrice=next;
   }
   const eq=equityAt(ts),g=portfolioGross(ts);peak=Math.max(peak,eq);maxDD=Math.max(maxDD,peak>0?(peak-eq)/peak*100:100);maxGross=Math.max(maxGross,g);grossSum+=g;grossObs++;if(positions.size===2)bars2++;
   const cs=candidates(prep,ts).slice(0,2),topKeys=new Set(cs.map(c=>`${c.symbol}:${c.side}`));
   for(const p of positions.values()){if(p.holdingBars>=P.maxHoldBars)pendingExit.set(p.symbol,"max-hold");else if(p.holdingBars>=P.rebalanceBars&&!topKeys.has(`${p.symbol}:${p.side}`))pendingExit.set(p.symbol,"signal-rotation")}
   const futureHeld=[...positions.keys()].filter(s=>!pendingExit.has(s)),slots=Math.max(0,2-futureHeld.length-pending.size);if(slots>0){let n=0;for(let r=0;r<cs.length&&n<slots;r++){const c=cs[r]!;if(positions.has(c.symbol)&&!pendingExit.has(c.symbol))continue;if(pending.has(c.symbol)||(cooldown.get(c.symbol)??0)>ts)continue;pending.set(c.symbol,{c,rank:r+1});n++}}
 }
 for(const p of [...positions.values()]){const rows=data.bySymbol[p.symbol]??[],last=[...rows].reverse().find(x=>x.ts<endTs);if(last)close(p,last.close,"window-end",endTs)}
 const years=(endTs-startTs)/(365.25*24*HOUR),ending=balance,cagr=ending>0?(Math.pow(ending/STARTING_EQUITY,1/years)-1)*100:-100;
 return{label:mode.label,returnPct:(ending/STARTING_EQUITY-1)*100,cagrPct:cagr,maxDrawdownPct:maxDD,profitFactor:pf(pnls),profitFactorWithoutBest:pfwb(pnls),winRatePct:trades.length?trades.filter(t=>t.netPnl>0).length/trades.length*100:0,tradeCount:trades.length,maximumPortfolioGross:maxGross,averagePortfolioGross:grossObs?grossSum/grossObs:0,barsWithTwoPositions:bars2,twoPositionBarPct:grossObs?bars2/grossObs*100:0,secondRankEntries:secondEntries,entriesWhileAnotherV12Held:existingSecondEntries,capacityBlocks,exitReasons:Object.fromEntries([...new Set(trades.map(t=>t.exitReason))].map(r=>[r,trades.filter(t=>t.exitReason===r).length]))}
}
async function main(){
 const data=await loadPerpMarketData({symbols:UNIVERSE,startTs:WARMUP_START,endTs:END+4*HOUR}),prep=prepare(data),modes:Mode[]=[{label:"resident-normal",feeBpsPerSide:5,slippageBpsPerSide:0},{label:"cost-stress",feeBpsPerSide:10,slippageBpsPerSide:5}];
 const periods=[["development",START,DEV_END],["validation",DEV_END,VAL_END],["evaluation",VAL_END,END],["combined3y",START,END]] as const;
 const results=Object.fromEntries(periods.map(([k,a,b])=>[k,Object.fromEntries(modes.map(m=>[m.label,runTwo(data,prep,a,b,m)]))]));
 const out={researchOnly:true,productionChanged:false,vpsChanged:false,ordersSent:false,definition:{maxV12Positions:2,aggregateV12GrossCap:1.0,minExecutableGross:0.1,ranking:"top two independently valid V12 candidates",sameSymbolDuplicate:false,cooldown:"1 H2 bar per exited symbol",rotation:"after 20 H2 bars if held symbol/side leaves top2; max hold 23",period:"2023-07-01..2026-07-01",dataSource:data.source},results};
 const dir=process.env.RESEARCH_STATE_DIR||".research-state";await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,"v12-two-slot-gross-compare.json"),JSON.stringify(out,null,2)+"\n");console.log("V12_TWO_SLOT_RESULT="+JSON.stringify(out))
}
main().catch(e=>{console.error(e);process.exitCode=1});