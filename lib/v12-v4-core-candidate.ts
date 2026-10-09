import {selectNativeCoreEvents} from "./v12-v4-native-core";
import {adaptProductionCandidates,type SourceEvidence,computeProductionH1Features} from "./v12-v4-production-features";
import type {V4LiveDecisionSnapshot,V4VenueH1Bar} from "./v12-v4-live-candidate-builder";
/** Converts an independently computed Core event using the first venue H1 open.
 * No fabricated fill, no order authority, no parity certificate.
 */
export function attachV4NativeCoreCandidates(snapshot:V4LiveDecisionSnapshot,
 h1:Record<string,V4VenueH1Bar[]>,entryOpenPrices:ReadonlyMap<string,number>){
 if(!snapshot.nativeCoreEvents.length)return snapshot;
 const selected=selectNativeCoreEvents(snapshot.nativeCoreEvents,entryOpenPrices);
 const next={...snapshot,candidates:[...snapshot.candidates],filtered:[...snapshot.filtered],
  entryAtrByCandidate:{...snapshot.entryAtrByCandidate}};
 for(const e of selected){
  const symbol=e.symbol.endsWith("USDT")?e.symbol:e.symbol+"USDT",bars=h1[symbol.slice(0,-4)];
  if(!bars||!Number.isFinite(e.entry_price)||!(e.entry_price>0))
   throw Error("V4_NATIVE_CORE_OPEN_PRICE_MISSING:"+symbol);
  const source:SourceEvidence={symbol,side:"LONG",eligibleSourceEntryTs:e.entry_ts_ms,
   decisionTs:e.decision_ts_ms,momentumConditionAgeHours:e.state_age_h,
   coreRequestedGross:e.requested_gross,sourceEngine:"FAILED_BREAK_NATIVE",
   sourceParityVerified:false,failedBreak:{
    freshUpward90hOnset:true,structuralUpBreak:true,
    failedBelowWithin6h:true,oppositeClvBodyConfirm:true,
   }};
  const out=adaptProductionCandidates({source,decisionTs:snapshot.decisionTs,
   symbolBars:bars,btcBars:h1.BTC});
  const core=out.candidates.filter(c=>c.route==="FAILED_BREAK_REV_SHORT_6H"&&
   c.eligibleEntryTs===e.entry_ts_ms);
  if(core.length!==1)throw Error("V4_NATIVE_CORE_V2_REPAIR_OR_ENTRY_NOT_RECONCILED:"+symbol);
  next.candidates.push(...core);
  next.filtered.push(...out.filtered);
  const k=[symbol,core[0].route,core[0].effectiveSide,core[0].eligibleEntryTs].join("|");
  next.entryAtrByCandidate[k]=e.atr;
 }
 next.candidates.sort((a,b)=>a.rank-b.rank||a.eligibleEntryTs-b.eligibleEntryTs||a.symbol.localeCompare(b.symbol));
 return {...next,sourceCount:next.sourceCount+selected.length,
  candidateCount:next.candidates.length,filteredCount:next.filtered.length,
  orderEnabled:false as const,realOrderEnabledV4:0 as const,tradingMutation:0 as const};
}
