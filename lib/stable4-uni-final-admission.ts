import {compareStable4UniEntryScore,type Stable4EntryOpportunityBook,type Stable4EntryOpportunityRecord,type Stable4EntryScoreComparisonInput} from "./stable4-entry-opportunity-book";
import {STABLE4_OPPORTUNITY_MODEL_VERSION} from "./stable4-opportunity-corpus";

export interface Stable4UniFinalAdmissionCapability{
 candidate:Stable4EntryOpportunityRecord;
 readOwners():Promise<{book:Stable4EntryOpportunityBook;owners:Stable4EntryScoreComparisonInput["owners"]}>;
}
/** Called by the SDK after its complete signed read and immediately before HTTP.
 * The capability supplies evidence only; the SDK owns the decision and signed rows.
 */
export async function assertStable4UniFinalAdmission(capability:Stable4UniFinalAdmissionCapability,context:{sourceSha:string;symbol:string;side:"BUY"|"SELL";now:()=>number;positionsObservedAt:number;positions:readonly {symbol:string;quantity:number}[]}):Promise<void>{
 const c=capability?.candidate;
 if(!c||context.symbol!=="UNIUSDT"||context.side!=="SELL"||c.sourceSha!==context.sourceSha||c.modelVersion!==STABLE4_OPPORTUNITY_MODEL_VERSION||typeof capability.readOwners!=="function")throw Error("STABLE4_UNI_FINAL_IDENTITY_INVALID");
 // Capture before the first await: callers cannot replace a score while owner reads run.
 const candidate={...c};
 const positions=context.positions.map(p=>({symbol:p.symbol,side:p.quantity>0?"LONG" as const:"SHORT" as const,quantity:Math.abs(p.quantity)}));
 const evidence=await capability.readOwners();
 const result=compareStable4UniEntryScore({now:context.now(),candidate,book:evidence.book,owners:evidence.owners,signed:{complete:true,observedAt:context.positionsObservedAt,positions}});
 if(!result.allowed)throw Error("STABLE4_UNI_FINAL_"+result.reason);
}
