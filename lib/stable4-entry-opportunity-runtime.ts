import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import type {AccountLockDocument} from "./disdex-account-order-lock";
import type {Stable4OpportunityLabel} from "./stable4-opportunity-model";
import {Stable4EntryOpportunityStore} from "./stable4-entry-opportunity-store";
import {captureStable4EntryOpportunityCandidate,prepareStable4EntryOpportunityRecord,publishPreparedStable4EntryOpportunityRecord,type Stable4EntryOpportunityCaptureInput} from "./stable4-entry-opportunity-publisher";

/** Source-pinned corpus, initialized evidence book, real caller-owned account lease.
 * This evidence service never initializes state or grants trading permission.
 */
export function createStable4EntryOpportunityRuntime(env:Partial<NodeJS.ProcessEnv>=process.env,options:{continuationLabels?:()=>readonly Stable4OpportunityLabel[]}={}){
 const store=new Stable4EntryOpportunityStore(resolve(env.DISDEX_STABLE4_ENTRY_OPPORTUNITY_BOOK_PATH||"/var/lib/disdex/shared/stable4-entry-opportunity-book.json"));
 const corpus=readFileSync(resolve(__dirname,"../config/stable4/opportunity-corpus-seed-20261115.json"));
 return{
  store,
  prepare(input:Stable4EntryOpportunityCaptureInput){
   return prepareStable4EntryOpportunityRecord(captureStable4EntryOpportunityCandidate(input),corpus,options.continuationLabels?.()??[]);
  },
  prepareAndPublish(input:Stable4EntryOpportunityCaptureInput,lease:{document():Promise<AccountLockDocument>}){
   const prepared=this.prepare(input);
   return publishPreparedStable4EntryOpportunityRecord(prepared,{store,lease});
  },
 };
}
