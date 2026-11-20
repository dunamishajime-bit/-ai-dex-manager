import type {ReplayFrame} from "./replay";

/** Cash-flow adjusted investment metrics; deposits are not trading profits. */
export function portfolioMetrics(frames:ReplayFrame[],cursor:number){
 if(!frames.length||!Number.isInteger(cursor)||cursor<0||cursor>=frames.length)throw new Error("INVALID_FRAME_CURSOR");
 const first=frames[0].equity,current=frames[cursor].equity;
 let previousNetDeposits=frames[0].netDepositsJpy??0;
 if(previousNetDeposits<0)throw new Error("INVALID_DEPOSITS");
 let units=first>0?first:1;
 let nav=first>0?1:0,peak=nav,maxDD=0;
 for(let i=0;i<=cursor;i++){
  const f=frames[i];
  const deposits=f.netDepositsJpy??0;
  if(!Number.isFinite(deposits)||deposits<previousNetDeposits)throw new Error("NONMONOTONIC_DEPOSITS");
  if(i>0){
    const added=deposits-previousNetDeposits;
    if(added>0){
      if(nav<=0)throw new Error("UNSUPPORTED_CAPITAL_RESTART");
      units+=added/nav;
    }
    nav=f.equity/units;
    peak=Math.max(peak,nav);
    if(peak>0)maxDD=Math.min(maxDD,100*(nav/peak-1));
  }
  previousNetDeposits=deposits;
 }
 const netDeposits=frames[cursor].netDepositsJpy??0;
 const priorDeposits=frames[0].netDepositsJpy??0;
 const tradingProfit=current-first-(netDeposits-priorDeposits);
 return {first,current,net:tradingProfit,tradingProfit,netDeposits,peakUnitNav:peak,unitNav:nav,maxDD};
}