import {v4PeerOwners,type V4PeerSource} from "./v12-v4-peer-state-owners";
import {addV4PeerPending} from "./v12-v4-peer-pending";
import type {Event,State} from "./v12-v4-production-lifecycle";
import type {PendingExposureRegistry} from "./disdex-pending-exposure-registry";
export type V4SignedMark={capturedAt:number;equityUsd:number;positions:Array<{symbol:string;quantity:number;markPrice:number}>};
export function buildV4AccountMark(x:{sources:V4PeerSource[];venue:V4SignedMark;registry:PendingExposureRegistry;state:State;expectedPeerSha:string;now:number;eventId:string}){
 if(x.venue.capturedAt>x.now||x.now-x.venue.capturedAt>30000||!(x.venue.equityUsd>0))throw Error("SIGNED_ACCOUNT_MARK_STALE");
 const owned=v4PeerOwners(x.sources,x.expectedPeerSha,x.now);
 const v4BySymbol=new Map<string,{side:string;qty:number}>();
 for(const leg of Object.values(x.state.legs).filter(l=>l.qty>0&&l.status!=="CLOSED"&&l.status!=="CANCELLED")){
  const symbol=leg.candidate.symbol,side=leg.candidate.effectiveSide;
  const current=v4BySymbol.get(symbol);
  if(current&&current.side!==side)throw Error("V4_OPPOSING_VIRTUAL_LEGS");
  if(owned.some(r=>r.symbol===symbol))throw Error("V4_AND_PEER_SAME_SYMBOL_OWNER");
  v4BySymbol.set(symbol,{side,qty:(current?.qty??0)+leg.qty});
 }
 const live=x.venue.positions.filter(p=>Math.abs(p.quantity)>1e-12);
 if(live.length!==owned.length+v4BySymbol.size)throw Error("VENUE_POSITION_OWNER_COUNT_MISMATCH");
 const prices:Record<string,number>={};
 for(const p of live){
  const owner=owned.find(r=>r.symbol===p.symbol)??v4BySymbol.get(p.symbol);
  if(!owner||owner.side!==(p.quantity>0?"LONG":"SHORT")||
    Math.abs(owner.qty-Math.abs(p.quantity))>Math.max(1e-8,owner.qty*1e-7))
    throw Error("VENUE_OWNED_QUANTITY_MISMATCH");
  if(!(p.markPrice>0))throw Error("INVALID_MARK_PRICE");
  prices[p.symbol]=p.markPrice;
 }
 const foreign=addV4PeerPending(owned,x.registry,x.venue.equityUsd);
 const event:Event={type:"ACCOUNT_MARK",ts:x.now,eventId:x.eventId,equityUsd:x.venue.equityUsd,prices,foreign};
 return {event,peerSystems:8,orderEnabled:false as const};
}
