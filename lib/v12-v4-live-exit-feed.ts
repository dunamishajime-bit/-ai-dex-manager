/** Causal, journalled H1 exit evaluation for all 41 frozen exit contracts. */
import {applyProductionEvent,productionExitSpec,HOUR,type H1Bar,type State} from "./v12-v4-production-lifecycle";
import type {V4FourRuleM5Bar} from "./v12-v4-four-rule-policy";
export type V4ExitFeed={closed:H1Bar[];closedM5?:V4FourRuleM5Bar[];nextOpen?:{ts:number;price:number};nextOpens?:{ts:number;price:number}[]};
export function appendV4ClosedExitBars(state:State,id:string,feed:V4ExitFeed,at:number):State{
 let next=state;
 const original=state.legs[id];
 if(!original)throw Error("V4_EXIT_FEED_UNKNOWN_LEG");
 if(original.status!=="OPEN"||original.plannedExit)return next;
 if(!Number.isFinite(at)||at<original.entryTs)throw Error("V4_EXIT_FEED_CLOCK_INVALID");
 const spec=productionExitSpec(original.candidate.route);
 // The four-rule policy is deliberately opt-in at the feed boundary. Legacy
 // callers that only provide the H1 stream retain their old contract; the
 // production runner always supplies closedM5, so missing M5 data there is a
 // fail-closed gap rather than a silently synthesized observation.
 if(feed.closedM5!==undefined){
  const m5Seen=new Set<number>(),m5Indexed=new Map<number,V4FourRuleM5Bar>();
  for(const bar of feed.closedM5){
   if(m5Seen.has(bar.openTs))throw Error("V4_EXIT_FEED_DUPLICATE_M5");
   m5Seen.add(bar.openTs);m5Indexed.set(bar.openTs,bar);
  }
  const m5End=Math.min(at,original.entryTs+spec.hours*HOUR);
  let m5Ts=original.fourRuleState?.lastM5OpenTs===undefined?original.entryTs:original.fourRuleState.lastM5OpenTs+300_000;
  while(m5Ts+300_000<=at&&m5Ts<m5End){
   const bar=m5Indexed.get(m5Ts);
   if(!bar)throw Error("V4_EXIT_FEED_M5_GAP:"+m5Ts);
   next=applyProductionEvent(next,{type:"M5_POLICY_BAR",id,eventId:"live-policy-m5:"+id+":"+m5Ts,
    ts:at,bar});
   if(next.legs[id].plannedExit)break;
   m5Ts+=300_000;
  }
  if(next.legs[id].plannedExit)return next;
 }
 const seen=new Set<number>(),indexed=new Map<number,H1Bar>();
 for(const bar of feed.closed){
  if(seen.has(bar.openTs))throw Error("V4_EXIT_FEED_DUPLICATE_H1");seen.add(bar.openTs);
  if(bar.openTs%HOUR!==0||bar.openTs+HOUR>at||!(bar.close>0))
   throw Error("V4_EXIT_FEED_UNCLOSED_H1");
  indexed.set(bar.openTs,bar);
 }
 const end=original.entryTs+spec.hours*HOUR;
 let barTs=original.lastExitBarTs===undefined?original.entryTs:original.lastExitBarTs+HOUR;
 while(barTs+HOUR<=at&&barTs<end){
  const bar=indexed.get(barTs);
  if(!bar)throw Error("V4_EXIT_FEED_GAP:"+barTs);
  const boundary=barTs+HOUR;
  // Native trailing updates at every completed H2 boundary, not just expiry.
  // The exit evaluator rejects missing/future opens; do not substitute a close.
  const needsOpen=boundary===end||(spec.kind==="NATIVE"&&boundary%(2*HOUR)===0);
  const nextOpen=needsOpen?(feed.nextOpens?.find(x=>x.ts===boundary)??
   (feed.nextOpen?.ts===boundary?feed.nextOpen:undefined)):undefined;
  next=applyProductionEvent(next,{type:"EXIT_BAR",id,eventId:"live-exit-bar:"+id+":"+barTs,
   ts:at,bar,nextOpen});
  if(next.legs[id].plannedExit)break;
  barTs+=HOUR;
 }
 return next;
}
