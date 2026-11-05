/**
 * Approved HYPE75 entry / exit candidate contract (2026-10-22).
 *
 * IMPORTANT: HYPE TREND live runner is a different H1 EMA strategy. This
 * deterministic, source-only contract is NOT wired to LIVE/Production.
 * It needs an exact native M5 dataset, sidecar model parity and cumulative
 * economics before operator activation. Missing M5 candles fail closed.
 */
export interface CompletedHypeM5 {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
export const HYPE_ADOPTED_M5_INTERVAL_MS=300_000;
export const HYPE_ADOPTED_BTC_MAX_3H_PCT=0.6;
export const HYPE_ADOPTED_RELATIVE_MIN_3H_PP=2.0;
export const HYPE_ADOPTED_ARM_PROFIT_PCT=3.0;
export const HYPE_ADOPTED_PROTECTED_PROFIT_PCT=1.5;
export const HYPE_ADOPTED_INITIAL_HOURS=1;
export const HYPE_ADOPTED_INITIAL_MAX_MFE_PCT=0.3;
export const HYPE_ADOPTED_INITIAL_LOSS_PCT=-1.0;
export const HYPE_ADOPTED_HISTORICAL_MODEL_ID="HYPE75_M5_COMBINED_I1H1_P3F1P5_20261022";

function finitePositive(value:number){return Number.isFinite(value)&&value>0;}
function completedCloseSeries(rows:readonly CompletedHypeM5[],decisionTs:number){
 if(!Number.isFinite(decisionTs)||decisionTs<=0)return null;
 const completed=rows.filter(x=>x.openTime+HYPE_ADOPTED_M5_INTERVAL_MS<=decisionTs);
 if(completed.length<37)return null;
 const window=completed.slice(-37);
 if(window.length!==37)return null;
 for(let i=0;i<window.length;i++){
  const x=window[i];
  if(!finitePositive(x.close)||!finitePositive(x.open)||!finitePositive(x.high)
   ||!finitePositive(x.low)||!Number.isFinite(x.openTime)
   ||x.low>x.high||x.open>x.high||x.open<x.low||x.close>x.high||x.close<x.low)return null;
  if(i>0&&x.openTime!==window[i-1].openTime+HYPE_ADOPTED_M5_INTERVAL_MS)return null;
 }
 if(window.at(-1)!.openTime+HYPE_ADOPTED_M5_INTERVAL_MS!==Math.floor(decisionTs/HYPE_ADOPTED_M5_INTERVAL_MS)*HYPE_ADOPTED_M5_INTERVAL_MS)return null;
 return window;
}
export function evaluateHypeAdoptedM5Entry(input:{
 btc:readonly CompletedHypeM5[];
 hype:readonly CompletedHypeM5[];
 decisionTs:number;
}){
 const btc=completedCloseSeries(input.btc,input.decisionTs);
 const hype=completedCloseSeries(input.hype,input.decisionTs);
 if(!btc||!hype)return {accepted:false,reason:"HYPE_ADOPTED_M5_INSUFFICIENT_OR_GAPPED"} as const;
 if(btc[0].openTime!==hype[0].openTime||btc.at(-1)!.openTime!==hype.at(-1)!.openTime)
  return {accepted:false,reason:"HYPE_ADOPTED_M5_BTC_HYPE_MISALIGNED"} as const;
 const btc3hPct=(btc.at(-1)!.close/btc[0].close-1)*100;
 const hype3hPct=(hype.at(-1)!.close/hype[0].close-1)*100;
 const relative3hPp=hype3hPct-btc3hPct;
 if(btc3hPct>HYPE_ADOPTED_BTC_MAX_3H_PCT)
  return {accepted:false,reason:"HYPE_ADOPTED_BTC3H_TOO_STRONG",btc3hPct,hype3hPct,relative3hPp} as const;
 if(relative3hPp<HYPE_ADOPTED_RELATIVE_MIN_3H_PP)
  return {accepted:false,reason:"HYPE_ADOPTED_RELATIVE_3H_TOO_WEAK",btc3hPct,hype3hPct,relative3hPp} as const;
 return {accepted:true,reason:"HYPE_ADOPTED_M5_ENTRY_ACCEPTED",btc3hPct,hype3hPct,relative3hPp} as const;
}
export interface HypeAdoptedProfitState{
 lastCompletedM5Ts?:number;
 maxFavorablePct:number;
 profitArmReached:boolean;
}
export function advanceHypeAdoptedM5Exit(input:{
 entryTs:number;
 entryPrice:number;
 now:number;
 bar:CompletedHypeM5;
 state:HypeAdoptedProfitState;
}){
 const {entryTs,entryPrice,now,bar,state}=input;
 if(!Number.isFinite(entryTs)||!Number.isFinite(now)||now<=0
  ||!finitePositive(entryPrice)||!finitePositive(bar.open)||!finitePositive(bar.close)||!finitePositive(bar.high)
  ||!finitePositive(bar.low)||!Number.isFinite(bar.openTime)||bar.low>bar.high
  ||bar.open>bar.high||bar.open<bar.low||bar.close>bar.high||bar.close<bar.low
  ||bar.openTime+HYPE_ADOPTED_M5_INTERVAL_MS>now)
  return {accepted:false,exit:false,reason:"HYPE_ADOPTED_M5_EXIT_INVALID_INPUT",state} as const;
 if(bar.openTime<entryTs)
  return {accepted:false,exit:false,reason:"HYPE_ADOPTED_M5_BEFORE_ENTRY",state} as const;
 if(state.lastCompletedM5Ts!==undefined){
  if(bar.openTime<=state.lastCompletedM5Ts)return {accepted:false,exit:false,reason:"HYPE_ADOPTED_M5_REPLAY_OR_DUPLICATE",state} as const;
  if(bar.openTime-state.lastCompletedM5Ts!==HYPE_ADOPTED_M5_INTERVAL_MS)
   return {accepted:false,exit:false,reason:"HYPE_ADOPTED_M5_GAP",state} as const;
 }
 if(!Number.isFinite(state.maxFavorablePct)||state.maxFavorablePct<0)
  return {accepted:false,exit:false,reason:"HYPE_ADOPTED_M5_PEAK_INVALID",state} as const;
 const pnlPct=(bar.close/entryPrice-1)*100;
 const newMfe=Math.max(state.maxFavorablePct,(bar.high/entryPrice-1)*100,0);
 const armed=state.profitArmReached||pnlPct>=HYPE_ADOPTED_ARM_PROFIT_PCT;
 const next:HypeAdoptedProfitState={lastCompletedM5Ts:bar.openTime,maxFavorablePct:newMfe,profitArmReached:armed};
 // 2026-10-22 frozen HYPE75: a PREVIOUS completed M5 close arms the floor;
 // next bar open OR intrabar low triggers, including gap-through at open.
 const profitFloorPrice=entryPrice*(1+HYPE_ADOPTED_PROTECTED_PROFIT_PCT/100);
 if(state.profitArmReached&&(bar.open<=profitFloorPrice||bar.low<=profitFloorPrice))
  return {accepted:true,exit:true,reason:"HYPE_ADOPTED_PROFIT_3P0_TO_1P5",
   exitReferencePrice:Math.min(bar.open,profitFloorPrice),state:next} as const;
 // PRIOR MFE is the adopted early-loss gate: current high cannot erase an
 // earlier -1% hit on this same completed M5 bar. The original checks
 // the open/low, not the bar's close.
 const initialStopPrice=entryPrice*(1+HYPE_ADOPTED_INITIAL_LOSS_PCT/100);
 if(bar.openTime>=entryTs+HYPE_ADOPTED_INITIAL_HOURS*3_600_000
   &&state.maxFavorablePct<HYPE_ADOPTED_INITIAL_MAX_MFE_PCT
   &&(bar.open<=initialStopPrice||bar.low<=initialStopPrice))
  return {accepted:true,exit:true,reason:"HYPE_ADOPTED_INITIAL_1H_MINUS1P0",
   exitReferencePrice:Math.min(bar.open,initialStopPrice),state:next} as const;
 return {accepted:true,exit:false,reason:"HYPE_ADOPTED_M5_HOLD",state:next} as const;
}
