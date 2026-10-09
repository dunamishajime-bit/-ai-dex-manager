import {v4PeerOwners,type V4PeerSource} from "./v12-v4-peer-state-owners";
import type {Event,State} from "./v12-v4-production-lifecycle";
import type {PendingExposureRegistry} from "./disdex-pending-exposure-registry";
export type V4SignedMark={capturedAt:number;equityUsd:number;positions:Array<{symbol:string;quantity:number;markPrice:number}>};
export function buildV4AccountMark(x:{sources:V4PeerSource[];venue:V4SignedMark;registry:PendingExposureRegistry;state:State;expectedPeerSha:string;now:number;eventId:string}){
 if(x.venue.capturedAt>x.now||x.now-x.venue.capturedAt>30000||!(x.venue.equityUsd>0))throw Error("SIGNED_ACCOUNT_MARK_STALE");
 const foreign=v4PeerOwners(x.sources,x.expectedPeerSha,x.now);
 const live=x.venue.positions.filter(p=>Math.abs(p.quantity)>1e-12);
 if(live.length!==foreign.length)throw Error("VENUE_POSITION_OWNER_COUNT_MISMATCH");
 const prices:Record<string,number>={};
 for(const p of live){
  const owner=foreign.find(r=>r.symbol===p.symbol);
  if(!owner||owner.side!==(p.quantity>0?"LONG":"SHORT")||
    Math.abs(owner.qty-Math.abs(p.quantity))>Math.max(1e-8,owner.qty*1e-7))
    throw Error("VENUE_OWNED_QUANTITY_MISMATCH");
  if(!(p.markPrice>0))throw Error("INVALID_MARK_PRICE");
  prices[p.symbol]=p.markPrice;
 }
 const event:Event={type:"ACCOUNT_MARK",ts:x.now,eventId:x.eventId,equityUsd:x.venue.equityUsd,prices,foreign};
 return {event,peerSystems:8,orderEnabled:false as const};
}
