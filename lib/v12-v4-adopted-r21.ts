/** Owner-selected R21_ONE contract restored from the 2026-11-27 frozen replay.
 * No strategy optimization, venue mutation, or authority. Selection into the
 * candidate pipeline does not make the legacy 41-route certificate valid.
 */
import {createHash} from "node:crypto";
import type {V12V4ShadowCandidate} from "./v12-multilogic-v4-shadow";
import type {V4LiveDecisionSnapshot,V4VenueH1Bar} from "./v12-v4-live-candidate-builder";
import {R21_SYMBOLS} from "./stable4-r21-market-observation";
import type {R21ObservationInput,Route} from "./stable4-research-decision-observation";
const H=3600000,M=300000;
export const R21_GROSS=.30,R21_COOLDOWN_MS=12*H;
export const R21_ROUTE_FAMILY="R21",R21_REPLACED_SHORT="REC_Y06_REV_D0_T72";
export const R21_ROUTES=["R21_OLD24","R21_NEW48"] as const;
export function isAdoptedR21Route(route:string):route is Route{
 return (R21_ROUTES as readonly string[]).includes(route);
}
export function adoptedR21HoldHours(route:Route){return route==="R21_OLD24"?24:48;}
export function adoptedR21CandidateIdentity(c:V12V4ShadowCandidate){
 return isAdoptedR21Route(c.route)&&c.family===R21_ROUTE_FAMILY&&
  c.sourceSide==="SHORT"&&c.effectiveSide==="SHORT"&&c.requestedGross===R21_GROSS&&
  (R21_SYMBOLS as readonly string[]).includes(c.symbol.replace(/USDT$/,""))&&
  c.symbol.endsWith("USDT")&&c.sourceSignalTs===c.eligibleEntryTs&&
  c.entryDelayHours===0&&c.rank===999&&c.orderEnabled===false&&c.shadow===true&&
  Number.isSafeInteger(c.eligibleEntryTs)&&c.eligibleEntryTs>0&&c.eligibleEntryTs%H===0;
}
export function adoptedR21StopPrice(route:Route,average:number):number{
 if(!isAdoptedR21Route(route)||!Number.isFinite(average)||average<=0)throw Error("R21_STOP_INPUT_INVALID");
 return average*1.08;
}
export type R21ClosedM5={openTs:number;open:number;high:number;low:number;close:number;observedAt:number};
export function adoptedR21M5Exit(route:Route,entryTs:number,average:number,bar:R21ClosedM5,expected:number,at:number){
 if(!isAdoptedR21Route(route)||!Number.isSafeInteger(entryTs)||entryTs%H!==0||
    !Number.isSafeInteger(at)||!Number.isSafeInteger(bar.openTs)||bar.openTs!==expected||
    bar.openTs<entryTs||bar.openTs>=entryTs+adoptedR21HoldHours(route)*H||
    bar.openTs+M>at||bar.observedAt<bar.openTs+M||bar.observedAt>at||
    ![average,bar.open,bar.high,bar.low,bar.close].every(x=>Number.isFinite(x)&&x>0)||
    bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close))
  throw Error("R21_M5_CLOCK_OR_BAR_INVALID");
 const stop=adoptedR21StopPrice(route,average),target=average*.92;
 // Frozen archive: STOP first, adverse open for STOP, exact target for TP.
 if(bar.high>=stop)return {exitTs:bar.openTs+M,price:Math.max(bar.open,stop),reason:"R21_HARD_STOP8",priceModelOnly:true as const};
 if(route==="R21_NEW48"&&bar.low<=target)return {exitTs:bar.openTs+M,price:target,reason:"R21_TARGET",priceModelOnly:true as const};
 return null;
}
function entryAtr(rows:readonly V4VenueH1Bar[],t:number){
 const by=new Map(rows.map(x=>[x.openTs,x]));
 const z=Array.from({length:15},(_,i)=>by.get(t-(15-i)*H));
 if(z.some(b=>!b||![b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)))throw Error("R21_ATR_H1_SOURCE_GAP");
 const a=z.slice(1).reduce((sum,b,i)=>sum+Math.max(b!.high-b!.low,Math.abs(b!.high-z[i]!.close),Math.abs(b!.low-z[i]!.close)),0)/14;
 if(!Number.isFinite(a)||a<=0)throw Error("R21_ATR_INVALID");
 return a;
}
export function attachAdoptedR21CandidateBatch(base:V4LiveDecisionSnapshot,input:R21ObservationInput|undefined,
 bars:Record<string,V4VenueH1Bar[]>,asof:number):V4LiveDecisionSnapshot{
 const t=Math.floor(asof/H)*H;
 const mark={policy:"R21_ONE" as const,sourceStatus:"UNAVAILABLE" as "UNAVAILABLE"|"AVAILABLE",legacyCertificateAccepted:false as const};
 // When selected, a missing R21 source never silently restores legacy Y06.
 const others=base.candidates.filter(c=>!(c.route===R21_REPLACED_SHORT&&c.effectiveSide==="SHORT"));
 const fail=(reason:string):V4LiveDecisionSnapshot=>({...base,adoptedR21:mark,
  candidates:[],candidateCount:0,errors:[...base.errors,reason]});
 if(base.errors.length)return fail("R21_BASE_SOURCE_UNAVAILABLE");
 if(!input||!Array.isArray(input.candidates)||!Number.isSafeInteger(asof)||asof-t>15*60000)
  return fail("R21_SELECTED_SOURCE_UNAVAILABLE");
 const atr={...base.entryAtrByCandidate},seen=new Set<string>(),add:V12V4ShadowCandidate[]=[];
 try{
  for(const x of input.candidates){
   if(!isAdoptedR21Route(x.route)||x.ts!==t||x.side!=="SHORT"||x.gross!==R21_GROSS||
      x.id!==[x.route,x.symbol.replace(/USDT$/,""),x.ts].join("|")||seen.has(x.id))
    throw Error("R21_OBSERVED_CANDIDATE_IDENTITY_INVALID");
   seen.add(x.id);
   const c:V12V4ShadowCandidate={strategyId:"V12",architecture:"MULTILOGIC_V4",shadow:true,orderEnabled:false,
    route:x.route,family:R21_ROUTE_FAMILY,symbol:x.symbol,sourceSide:"SHORT",effectiveSide:"SHORT",
    sourceSignalTs:t,eligibleEntryTs:t,entryDelayHours:0,rank:999,requestedGross:R21_GROSS,
    entryRuleTokens:[x.route],features:{symbol:x.symbol,sourceSide:"SHORT",sourceSignalTs:t},
    plannedExitPolicy:x.route==="R21_OLD24"?"R21_H24_STOP8":"R21_H48_STOP8_TP8",
    decision:"CANDIDATE",reason:"ROUTE_ELIGIBLE"};
   if(!adoptedR21CandidateIdentity(c))throw Error("R21_FROZEN_CANDIDATE_CONTRACT");
   const key=[c.symbol,c.route,c.effectiveSide,t].join("|");
   atr[key]=entryAtr(bars[c.symbol.replace(/USDT$/,"")]??[],t);
   add.push(c);
  }
 }catch(error){return fail(error instanceof Error?error.message:"R21_SOURCE_UNAVAILABLE");}
 const candidates=[...others,...add].sort((a,b)=>a.rank-b.rank||a.eligibleEntryTs-b.eligibleEntryTs||a.symbol.localeCompare(b.symbol));
 return {...base,adoptedR21:{...mark,sourceStatus:"AVAILABLE"},candidateCount:candidates.length,candidates,entryAtrByCandidate:atr,
  sourceFingerprint:createHash("sha256").update(JSON.stringify([base.sourceFingerprint,"R21_ONE",t,input.candidates])).digest("hex")};
}
