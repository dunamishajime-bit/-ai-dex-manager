/**
 * V12 V4 SHORT two-axis exits: isolated, read-only policy functions.
 * RESEARCH candidate: no signed venue orders or runner wiring.
 * Results: ef256afc74b4a7b1eaeeceecf69cba285570a2d7.
 */
import {PRODUCTION_EXIT_CATALOG,productionExitSpec} from "./v12-v4-production-lifecycle";
const M5=300000, HOUR=3600000;
export const V4_SHORT_INITIAL_ADVERSE_PCT=.025;
export const V4_SHORT_INITIAL_AFTER_HOURS=12;
export const V4_SHORT_INITIAL_MFE_LESS_THAN=.01;
export const V4_SHORT_INITIAL_COOLDOWN_HOURS=12;
export const V4_SHORT_PROFIT_ARM=.05;
export const V4_SHORT_PROFIT_FLOOR=.02;
export const V4_SHORT_PROFIT_CONFIRMED_BULL_H1_BARS=2;
export const V4_SHORT_TIME_ROUTE_COUNT=37;
export type V4ShortM5Stage={peakFavorablePct:number;lastM5OpenTs?:number};
export type V4ClosedShortM5={openTs:number;open:number;high:number;low:number;close:number;observedAt:number};
export type V4ShortH1ProfitCheck={
 checkedAt:number;lastH1Close:number;previousH1Close:number;thirdH1Close:number;
};
if(PRODUCTION_EXIT_CATALOG.filter(x=>x.spec.kind==="TIME").length!==V4_SHORT_TIME_ROUTE_COUNT)
 throw Error("V4_SHORT_TIME37_CATALOG_DRIFT");
export function v4ShortEligible(route:string,side:"LONG"|"SHORT"):boolean{
 return side==="SHORT"&&PRODUCTION_EXIT_CATALOG.some(x=>x.route===route);
}
export function v4ShortProfitEligible(route:string,side:"LONG"|"SHORT"):boolean{
 return side==="SHORT"&&productionExitSpec(route).kind==="TIME";
}
export function v4ShortInitialState():V4ShortM5Stage{
 return {peakFavorablePct:0};
}
export function v4ObserveClosedShortM5(input:{
 route:string;side:"LONG"|"SHORT";entryTs:number;signedAverageEntryFill:number;
 stage:V4ShortM5Stage;bar:V4ClosedShortM5;
}):{stage:V4ShortM5Stage;initialAdverseExitCandidate:boolean}{
 const {route,side,entryTs,signedAverageEntryFill:e,stage,bar}=input;
 if(!v4ShortEligible(route,side)||!Number.isFinite(e)||!(e>0))
  throw Error("V4_SHORT_SCOPE_OR_SIGNED_FILL");
 if(!Number.isFinite(entryTs)||entryTs%M5!==0||bar.openTs%M5!==0||
   bar.openTs<entryTs||bar.openTs+M5>bar.observedAt)
  throw Error("V4_SHORT_M5_CAUSALITY");
 if(![bar.open,bar.high,bar.low,bar.close].every(x=>Number.isFinite(x)&&x>0)||
    bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||
    bar.low>bar.high)
  throw Error("V4_SHORT_M5_OHLC");
 if(!Number.isFinite(stage.peakFavorablePct)||stage.peakFavorablePct<0||
    bar.openTs!==(stage.lastM5OpenTs===undefined?entryTs:stage.lastM5OpenTs+M5))
  throw Error("V4_SHORT_M5_STATE_OR_GAP");
 // The armed initial STOP uses ONLY the prior bar's favorable MFE.
 const initialAdverseExitCandidate=
  bar.openTs>=entryTs+V4_SHORT_INITIAL_AFTER_HOURS*HOUR &&
  stage.peakFavorablePct<V4_SHORT_INITIAL_MFE_LESS_THAN &&
  bar.high>=e*(1+V4_SHORT_INITIAL_ADVERSE_PCT);
 const newMfe=Math.max(stage.peakFavorablePct,1-bar.low/e);
 return {stage:{peakFavorablePct:newMfe,lastM5OpenTs:bar.openTs},
   initialAdverseExitCandidate};
}
export function v4ShortProfitGivebackCandidate(input:{
 route:string;side:"LONG"|"SHORT";entryTs:number;signedAverageEntryFill:number;
 stage:V4ShortM5Stage;h1:V4ShortH1ProfitCheck;
}):boolean{
 const {route,side,entryTs,signedAverageEntryFill:e,stage,h1}=input;
 if(!v4ShortProfitEligible(route,side))return false;
 if(!(e>0)||!Number.isFinite(e)||!Number.isFinite(stage.peakFavorablePct)||
    ![h1.checkedAt,h1.lastH1Close,h1.previousH1Close,h1.thirdH1Close]
     .every(Number.isFinite))
  throw Error("V4_SHORT_PROFIT_EVIDENCE_INVALID");
 if(h1.checkedAt%HOUR!==0||h1.checkedAt<entryTs+3*HOUR)
  throw Error("V4_SHORT_PROFIT_UNCLOSED_H1");
 return stage.peakFavorablePct>=V4_SHORT_PROFIT_ARM &&
  h1.lastH1Close>=e*(1-V4_SHORT_PROFIT_FLOOR) &&
  h1.lastH1Close>h1.previousH1Close &&
  h1.previousH1Close>h1.thirdH1Close;
}
export function v4ShortInitialStopCooldownUntil(input:{
 side:"LONG"|"SHORT";actualFilledExitReason:string;actualFillTs:number;
}):number|undefined{
 const {side,actualFilledExitReason:reason,actualFillTs}=input;
 if(side!=="SHORT"||reason!=="V4_SHORT_INITIAL_ADVERSE_FILLED")return;
 if(!Number.isFinite(actualFillTs)||actualFillTs<0)
  throw Error("V4_SHORT_STOP_FILL_PROOF_INVALID");
 return actualFillTs+V4_SHORT_INITIAL_COOLDOWN_HOURS*HOUR;
}
