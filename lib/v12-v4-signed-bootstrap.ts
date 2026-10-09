/** Offline-state creation requires fresh signed *flat* venue and peer proof. */
import type {AsterV3Client} from "./aster-v3-client";
import {V4ExecutionStore} from "./v12-v4-execution-store";
import {v4PeerOwners,type V4PeerSource} from "./v12-v4-peer-state-owners";
import {readPendingExposureRegistry} from "./disdex-pending-exposure-registry";
export async function initializeV4SignedFlatState(args:{
 store:V4ExecutionStore;client:Pick<AsterV3Client,"getPositions"|"getOpenOrders"|"getBalances">;
 peers:V4PeerSource[];pendingPath:string;now?:()=>number;
}){
 const now=args.now??Date.now,start=now();
 const [positions,orders,balances,registry]=await Promise.all([
  args.client.getPositions(),args.client.getOpenOrders(),
  args.client.getBalances(),readPendingExposureRegistry(args.pendingPath),
 ]);
 const elapsed=now()-start;
 if(elapsed<0||elapsed>30000)throw Error("V4_BOOTSTRAP_SIGNED_READBACK_STALE");
 if(positions.some(p=>!Number.isFinite(Number(p.positionAmt))||
    Math.abs(Number(p.positionAmt))>1e-10)||orders.length)
  throw Error("V4_BOOTSTRAP_REQUIRES_SIGNED_FLAT_ACCOUNT");
 const owned=v4PeerOwners(args.peers,args.store.releaseSha,now());
 if(owned.length||registry.entries.some(x=>x.status!=="RELEASED"))
  throw Error("V4_BOOTSTRAP_PEER_OR_PENDING_EXPOSURE_NOT_FLAT");
 const usdt=balances.find(b=>b.asset==="USDT"),equityUsd=Number(usdt?.balance);
 if(!(equityUsd>0)||!Number.isFinite(Number(usdt?.availableBalance))||
  Number(usdt?.availableBalance)<0)throw Error("V4_BOOTSTRAP_EQUITY_NOT_VERIFIED");
 return args.store.initialize({equityUsd,foreign:[],holdProtected:false});
}
