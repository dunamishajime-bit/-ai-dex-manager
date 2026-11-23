/**
 * Causal state machine for the four V12 V4 LONG/SHORT protective policies.
 *
 * This module is deliberately independent from venue transport. It consumes
 * only completed M5/H1 bars and signed average entry fills. The runner owns
 * persistence, order authority, venue read-back, and actual-fill cooldown.
 */
import {V12_V4_ROUTE_CATALOG} from "./v12-multilogic-v4-shadow";
import {V12_V4_FIRST_PASS_REPAIRS,V12_V4_SECOND_PASS_REPAIRS} from "./v12-v4-v2-shadow";

const M5=300_000;
const H1=3_600_000;
const H12=12*H1;
const COOLDOWN=12*H1;

export const V4_LONG_TIME_MFE_ARM=0.02;
export const V4_LONG_TIME_STOP_INITIAL=0.08;
export const V4_LONG_TIME_STOP_ARMED=0.05;
export const V4_LONG_PROFIT_MFE_ARM=0.03;
export const V4_LONG_PROFIT_FLOOR=0.01;
export const V4_SHORT_INITIAL_ADVERSE=0.025;
export const V4_SHORT_INITIAL_MFE_LIMIT=0.01;
export const V4_SHORT_PROFIT_MFE_ARM=0.05;
export const V4_SHORT_PROFIT_FLOOR=0.02;

const LONG_PROFIT_ROUTE_PARTS=["X09","X10","X14"] as const;

export type V4FourRuleH1Bar={openTs:number;open:number;high:number;low:number;close:number;observedAt:number};
export type V4FourRuleM5Bar={openTs:number;open:number;high:number;low:number;close:number;observedAt:number};
export type V4FourRuleExitCandidate={
 reason:"V4_LONG_PROFIT_GUARD_FILLED"|"V4_SHORT_INITIAL_ADVERSE_CANDIDATE"|"V4_SHORT_PROFIT_GUARD_FILLED";
 exitTs:number;
 evidenceBarTs:number;
 modelPrice:number;
};
export type V4FourRuleH1Evidence={close:number;bearish:boolean;bullish:boolean;openTs:number};
export type V4FourRuleState={
 longTimeStopStage:"INITIAL"|"ARMED";
 longTimePeakHigh:number;
 longTimeArmedAt?:number;
 longProfitPeakHigh:number;
 shortPeakFavorablePct:number;
 lastM5OpenTs?:number;
 lastH1OpenTs?:number;
 h1History:V4FourRuleH1Evidence[];
 longProfitExitFired:boolean;
 shortInitialExitFired:boolean;
 shortProfitExitFired:boolean;
};

export function createV4FourRuleState(seed:Partial<V4FourRuleState>={}):V4FourRuleState{
 return {
  longTimeStopStage:seed.longTimeStopStage??"INITIAL",
  longTimePeakHigh:Number.isFinite(seed.longTimePeakHigh)?Number(seed.longTimePeakHigh):0,
  ...(seed.longTimeArmedAt===undefined?{}:{longTimeArmedAt:seed.longTimeArmedAt}),
  longProfitPeakHigh:Number.isFinite(seed.longProfitPeakHigh)?Number(seed.longProfitPeakHigh):0,
  shortPeakFavorablePct:Number.isFinite(seed.shortPeakFavorablePct)?Number(seed.shortPeakFavorablePct):0,
  ...(seed.lastM5OpenTs===undefined?{}:{lastM5OpenTs:seed.lastM5OpenTs}),
  ...(seed.lastH1OpenTs===undefined?{}:{lastH1OpenTs:seed.lastH1OpenTs}),
  h1History:Array.isArray(seed.h1History)?seed.h1History.slice(-3).map(x=>({...x})):[],
  longProfitExitFired:seed.longProfitExitFired===true,
  shortInitialExitFired:seed.shortInitialExitFired===true,
  shortProfitExitFired:seed.shortProfitExitFired===true,
 };
}

function routeRow(route:string){
 const row=V12_V4_ROUTE_CATALOG.find(x=>x.route===route);
 if(!row)throw Error("V4_FOUR_RULE_UNKNOWN_ROUTE:"+route);
 return row;
}
export function v4FourRuleIsTimeRoute(route:string):boolean{
 const row=routeRow(route);
 const repair=V12_V4_FIRST_PASS_REPAIRS[route]?.hours??V12_V4_SECOND_PASS_REPAIRS[route]?.hours;
 return repair!==undefined||/(?:TIME_|(?:REV|ORIG)_D\d+_T\d+)/.test(String(row.exit_policy));
}
export function v4FourRuleLongProfitScope(route:string):boolean{
 return v4FourRuleIsTimeRoute(route)&&LONG_PROFIT_ROUTE_PARTS.some(part=>route.includes(part));
}
export function v4FourRuleShortProfitScope(route:string):boolean{return v4FourRuleIsTimeRoute(route);}

function validBar(bar:V4FourRuleM5Bar|V4FourRuleH1Bar,unit:number,kind:"M5"|"H1"){
 if(!Number.isFinite(bar.openTs)||bar.openTs%unit!==0||bar.openTs+unit>bar.observedAt)
  throw Error(`V4_FOUR_RULE_${kind}_UNCLOSED`);
 if(![bar.open,bar.high,bar.low,bar.close].every(x=>Number.isFinite(x)&&x>0)||
    bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.low>bar.high)
  throw Error(`V4_FOUR_RULE_${kind}_OHLC_INVALID`);
}
function validInput(entryTs:number,fill:number){
 if(!Number.isFinite(entryTs)||entryTs<0||entryTs%M5!==0||!Number.isFinite(fill)||fill<=0)
  throw Error("V4_FOUR_RULE_ENTRY_INVALID");
}
function expectedCursor(last:number|undefined,entryTs:number,unit:number,kind:"M5"|"H1"){
 const expected=last===undefined?entryTs:last+unit;
 return expected;
}

export function observeV4FourRuleM5(input:{route:string;side:"LONG"|"SHORT";entryTs:number;fill:number;state:V4FourRuleState;bar:V4FourRuleM5Bar}):{state:V4FourRuleState;exitCandidate?:V4FourRuleExitCandidate}{
 const {route,side,entryTs,fill,bar}=input;
 validInput(entryTs,fill);routeRow(route);validBar(bar,M5,"M5");
 if(bar.openTs<entryTs||bar.openTs!==expectedCursor(input.state.lastM5OpenTs,entryTs,M5,"M5"))throw Error("V4_FOUR_RULE_M5_GAP");
 const state=createV4FourRuleState(input.state);
 const candidate:V4FourRuleExitCandidate|undefined=undefined;
 const priorShortMfe=state.shortPeakFavorablePct;
 const nextPeakHigh=Math.max(state.longTimePeakHigh,bar.high);
 state.longTimePeakHigh=nextPeakHigh;
 state.longProfitPeakHigh=Math.max(state.longProfitPeakHigh,bar.high);
 if(side==="LONG"&&v4FourRuleIsTimeRoute(route)&&nextPeakHigh>=fill*(1+V4_LONG_TIME_MFE_ARM)){
  state.longTimeStopStage="ARMED";
  state.longTimeArmedAt??=bar.openTs+M5;
 }
 let nextCandidate:V4FourRuleExitCandidate|undefined=candidate;
 if(side==="SHORT"){
  if(!Number.isFinite(priorShortMfe)||priorShortMfe<0)throw Error("V4_FOUR_RULE_SHORT_MFE_INVALID");
  if(!state.shortInitialExitFired&&bar.openTs>=entryTs+H12&&priorShortMfe<V4_SHORT_INITIAL_MFE_LIMIT&&bar.high>=fill*(1+V4_SHORT_INITIAL_ADVERSE)){
   state.shortInitialExitFired=true;
   nextCandidate={reason:"V4_SHORT_INITIAL_ADVERSE_CANDIDATE",exitTs:bar.openTs+M5,evidenceBarTs:bar.openTs,modelPrice:bar.close};
  }
  state.shortPeakFavorablePct=Math.max(priorShortMfe,1-bar.low/fill);
 }
 state.lastM5OpenTs=bar.openTs;
 return {state,exitCandidate:nextCandidate};
}

export function observeV4FourRuleH1(input:{route:string;side:"LONG"|"SHORT";entryTs:number;fill:number;state:V4FourRuleState;bar:V4FourRuleH1Bar}):{state:V4FourRuleState;exitCandidate?:V4FourRuleExitCandidate}{
 const {route,side,entryTs,fill,bar}=input;
 validInput(entryTs,fill);routeRow(route);validBar(bar,H1,"H1");
 if(bar.openTs<entryTs||bar.openTs!==expectedCursor(input.state.lastH1OpenTs,entryTs,H1,"H1"))throw Error("V4_FOUR_RULE_H1_GAP");
 const state=createV4FourRuleState(input.state);
 state.longProfitPeakHigh=Math.max(state.longProfitPeakHigh,bar.high);
 const evidence={openTs:bar.openTs,close:bar.close,bearish:bar.close<bar.open,bullish:bar.close>bar.open};
 state.h1History=[...state.h1History,evidence].slice(-3);
 state.lastH1OpenTs=bar.openTs;
 const last=state.h1History.at(-1),previous=state.h1History.at(-2);
 if(side==="LONG"&&v4FourRuleLongProfitScope(route)&&!state.longProfitExitFired&&
   state.longProfitPeakHigh>=fill*(1+V4_LONG_PROFIT_MFE_ARM)&&last&&previous&&
   last.close<=fill*(1+V4_LONG_PROFIT_FLOOR)&&last.bearish&&previous.bearish&&
   last.close<previous.close){
  state.longProfitExitFired=true;
  return {state,exitCandidate:{reason:"V4_LONG_PROFIT_GUARD_FILLED",exitTs:bar.openTs+H1,evidenceBarTs:bar.openTs,modelPrice:bar.close}};
 }
 if(side==="SHORT"&&v4FourRuleShortProfitScope(route)&&!state.shortProfitExitFired&&
   state.shortPeakFavorablePct>=V4_SHORT_PROFIT_MFE_ARM&&last&&previous&&
   last.close>=fill*(1-V4_SHORT_PROFIT_FLOOR)&&last.bullish&&previous.bullish&&
   last.close>previous.close){
  state.shortProfitExitFired=true;
  return {state,exitCandidate:{reason:"V4_SHORT_PROFIT_GUARD_FILLED",exitTs:bar.openTs+H1,evidenceBarTs:bar.openTs,modelPrice:bar.close}};
 }
 return {state};
}

export function desiredV4FourRuleStop(input:{route:string;side:"LONG"|"SHORT";fill:number;state:V4FourRuleState}):number|undefined{
 if(input.side!=="LONG"||!v4FourRuleIsTimeRoute(input.route))return;
 if(!Number.isFinite(input.fill)||input.fill<=0)throw Error("V4_FOUR_RULE_FILL_INVALID");
 if(input.state.longTimeStopStage==="ARMED"&&
   (!(input.state.longTimeArmedAt!==undefined)||input.state.longTimePeakHigh<input.fill*(1+V4_LONG_TIME_MFE_ARM)))
  throw Error("V4_FOUR_RULE_ARMED_STATE_UNPROVEN");
 return input.fill*(1-(input.state.longTimeStopStage==="ARMED"?V4_LONG_TIME_STOP_ARMED:V4_LONG_TIME_STOP_INITIAL));
}

export function cooldownAfterV4ShortInitialFill(input:{side:"LONG"|"SHORT";reason:string;actualFillTs:number|undefined}):number|undefined{
 if(input.side!=="SHORT"||input.reason!=="V4_SHORT_INITIAL_ADVERSE_FILLED")return;
 if(input.actualFillTs===undefined)return;
 if(!Number.isFinite(input.actualFillTs)||input.actualFillTs<0)throw Error("V4_FOUR_RULE_ACTUAL_FILL_INVALID");
 return input.actualFillTs+COOLDOWN;
}
