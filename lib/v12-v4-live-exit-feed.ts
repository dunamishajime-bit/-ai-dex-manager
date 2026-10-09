/** Causal, journalled H1 exit evaluation for all 41 frozen exit contracts. */
import {applyProductionEvent,productionExitSpec,HOUR,type H1Bar,type State} from "./v12-v4-production-lifecycle";
export type V4ExitFeed={closed:H1Bar[];nextOpen?:{ts:number;price:number};nextOpens?:{ts:number;price:number}[]};
export function appendV4ClosedExitBars(state:State,id:string,feed:V4ExitFeed,at:number):State{
 let next=state;
 const original=state.legs[id];
 if(!original)throw Error("V4_EXIT_FEED_UNKNOWN_LEG");
 if(original.status!=="OPEN"||original.plannedExit)return next;
 if(!Number.isFinite(at)||at<original.entryTs)throw Error("V4_EXIT_FEED_CLOCK_INVALID");
 const seen=new Set<number>(),indexed=new Map<number,H1Bar>();
 for(const bar of feed.closed){
  if(seen.has(bar.openTs))throw Error("V4_EXIT_FEED_DUPLICATE_H1");seen.add(bar.openTs);
  if(bar.openTs%HOUR!==0||bar.openTs+HOUR>at||!(bar.close>0))
   throw Error("V4_EXIT_FEED_UNCLOSED_H1");
  indexed.set(bar.openTs,bar);
 }
 const end=original.entryTs+productionExitSpec(original.candidate.route).hours*HOUR;
 let barTs=original.lastExitBarTs===undefined?original.entryTs:original.lastExitBarTs+HOUR;
 while(barTs+HOUR<=at&&barTs<end){
  const bar=indexed.get(barTs);
  if(!bar)throw Error("V4_EXIT_FEED_GAP:"+barTs);
  const nextOpen=barTs+HOUR===end?(feed.nextOpens?.find(x=>x.ts===end)??feed.nextOpen):undefined;
  next=applyProductionEvent(next,{type:"EXIT_BAR",id,eventId:"live-exit-bar:"+id+":"+barTs,
   ts:at,bar,nextOpen});
  if(next.legs[id].plannedExit)break;
  barTs+=HOUR;
 }
 return next;
}
