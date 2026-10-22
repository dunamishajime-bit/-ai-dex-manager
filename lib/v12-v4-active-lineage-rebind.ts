/**
 * Lossless active-state lineage rebind for a V4 release cutover.
 *
 * Existing venue-owned ENTRY/STOP client ids are derived from the previous
 * release SHA. They must remain valid for reconciliation after a cutover;
 * deleting, renaming, or recreating them would risk duplicate orders or an
 * unprotected position. New intents are still derived from the new SHA.
 */
import {replayProductionJournal} from "./v12-v4-production-lifecycle";
import type {V4ExecutionDocument as DurableDocument} from "./v12-v4-execution-store";

const SHA=/^[a-f0-9]{40}$/;

export function rebindV4ActiveLineage(
 observed:DurableDocument,
 expectedOldSha:string,
 newSha:string,
):DurableDocument{
 if(!SHA.test(expectedOldSha)||!SHA.test(newSha)||expectedOldSha===newSha)
  throw Error("V4_ACTIVE_REBIND_SHA_INVALID");
 if(observed.schema!==2||observed.releaseSha!==expectedOldSha)
  throw Error("V4_ACTIVE_REBIND_RELEASE_MISMATCH");
 const state=replayProductionJournal(observed.state.initial,observed.state.journal);
 const prior=observed.legacyReleaseShas??[];
 if(!Array.isArray(prior)||prior.some(x=>!SHA.test(x))||prior.includes(newSha))
  throw Error("V4_ACTIVE_REBIND_LEGACY_LINEAGE_INVALID");
 return {
  ...structuredClone(observed),
  releaseSha:newSha,
  legacyReleaseShas:[...new Set([...prior,expectedOldSha])],
  state,
 };
}
