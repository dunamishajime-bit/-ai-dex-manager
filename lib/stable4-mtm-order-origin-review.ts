/** Offline historical ownership review. Order origin is not position ownership.
 * No venue client, state writes, signed observation or trading authority.
 */
import { createHash } from "node:crypto";

export type Origin = "V4"|"LEGACY_V12"|"IDLE"|"PENGU_RECOVERY"|"MARGIN_GUARD"|"WEB_OR_OPERATOR"|"UNKNOWN";
export function reviewOrderOrigin(clientOrderId: unknown): Origin {
  if (typeof clientOrderId !== "string" || clientOrderId.trim() !== clientOrderId) return "UNKNOWN";
  if (/^v12-v4-[a-f0-9]{28}$/.test(clientOrderId)) return "V4";
  if (clientOrderId.startsWith("v12-v4-")) return "UNKNOWN";
  if (/^v12-(?:entry|exit|stop|tp|trail|failsafe_close|dynamic_trim)-[a-f0-9]+$/.test(clientOrderId)) return "LEGACY_V12";
  if (/^idle-(?:entry|exit|stop|tp)-[a-f0-9]{22}$/.test(clientOrderId)) return "IDLE";
  if (/^recv8-[a-f0-9]{30}$/.test(clientOrderId)) return "PENGU_RECOVERY";
  if (/^mg-[0-9]+-[0-9]+-[a-z0-9]+-[0-9]+$/.test(clientOrderId)) return "MARGIN_GUARD";
  if (/^(?:web_(?:am|ad)_|operator-)/.test(clientOrderId)) return "WEB_OR_OPERATOR";
  return "UNKNOWN";
}

type Order = { symbol:string; orderId:string; clientOrderId:string; side:"BUY"|"SELL"; reduceOnly:boolean };
type Proof =
  | { runner:"IDLE"; symbol:string; proofId:string; signalTs:number; action:"ENTRY"|"EXIT"|"STOP"|"TP" }
  | { runner:"PENGU"; symbol:string; proofId:string; entryTs:number; role:"full-hard"|"partial-24h"|"remaining-hard"; closeSide:"BUY"|"SELL" };

const validTs = (x:unknown):x is number => Number.isSafeInteger(x) && Number(x)>0;
const digest = (s:string) => createHash("sha256").update(s).digest("hex");

export function reviewDeterministicOrderOwner(order:Order, proofs:readonly Proof[]) {
  const origin=reviewOrderOrigin(order?.clientOrderId);
  const blocked=(reason:string)=>({status:"BLOCKED" as const,origin,reason,ownerAttestationIssued:false as const,orderAuthority:false as const});
  if (!order || typeof order.symbol!=="string" || !/^[A-Z0-9]+USDT$/.test(order.symbol) ||
      typeof order.orderId!=="string" || !/^[0-9]+$/.test(order.orderId) ||
      !["BUY","SELL"].includes(order.side) || typeof order.reduceOnly!=="boolean" || !Array.isArray(proofs)) return blocked("INVALID_ORDER_OR_PROOF");
  if (origin!=="IDLE" && origin!=="PENGU_RECOVERY") return blocked("ORIGIN_NOT_OWNER_PROOF");
  const matches:Proof[]=[];
  for (const p of proofs) {
    if (!p || p.symbol!==order.symbol || typeof p.proofId!=="string" || !p.proofId.trim()) continue;
    if (p.runner==="IDLE" && origin==="IDLE" && validTs(p.signalTs) && ["ENTRY","EXIT","STOP","TP"].includes(p.action)) {
      const id="idle-"+p.action.toLowerCase()+"-"+digest(["IDLE_PRIORITY_SHORT",p.action,p.symbol,p.signalTs].join("|")).slice(0,22);
      const entry=p.action==="ENTRY";
      if (id===order.clientOrderId && order.side===(entry?"SELL":"BUY") && order.reduceOnly===!entry) matches.push(p);
    }
    if (p.runner==="PENGU" && origin==="PENGU_RECOVERY" && order.symbol==="PENGUUSDT" && validTs(p.entryTs) &&
        ["full-hard","partial-24h","remaining-hard"].includes(p.role)) {
      const id=("recv8-"+digest(["PENGU_RECOVERY_V8",p.symbol,p.entryTs,p.role].join("|"))).slice(0,36);
      if (id===order.clientOrderId && order.reduceOnly===true && order.side===p.closeSide) matches.push(p);
    }
  }
  if (matches.length!==1) return blocked(matches.length?"AMBIGUOUS_PROOF":"NO_MATCHING_DETERMINISTIC_PROOF");
  return {status:"OWNER_CANDIDATE_ONLY" as const,origin,runner:matches[0].runner,proofId:matches[0].proofId,
    ownerAttestationIssued:false as const,orderAuthority:false as const};
}
