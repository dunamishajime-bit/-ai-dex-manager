/**
 * Explicit SHA rebind for a V4 observation-only ledger.
 * This is a PURE transform: it does not write to or replace a LIVE store.
 *
 * Any prior owned order intent, protective STOP record, leg, or execution
 * journal event is disqualifying, even if the intent was later terminal.
 * In such cases normal signed venue reconciliation is mandatory.
 */
import type {V4ExecutionDocument} from "./v12-v4-execution-store";

const SHA=/^[a-f0-9]{40}$/;

export function rebindV4ObservationLedger(
 observed:V4ExecutionDocument,
 expectedOldSha:string,
 newSha:string,
):V4ExecutionDocument {
 if(!SHA.test(expectedOldSha)||!SHA.test(newSha)||expectedOldSha===newSha)
  throw Error("V4_OBSERVATION_REBIND_SHA_INVALID");
 if(observed.schema!==2||observed.releaseSha!==expectedOldSha)
  throw Error("V4_OBSERVATION_REBIND_RELEASE_MISMATCH");
 if(Object.keys(observed.intents??{}).length||
    Object.keys(observed.protections??{}).length||
    Object.keys(observed.state?.legs??{}).length)
  throw Error("V4_OBSERVATION_REBIND_OWNED_LIFECYCLE_PRESENT");
 const initial=observed.state?.initial;
 if(!initial||initial.holdProtected||initial.foreign.length)
  throw Error("V4_OBSERVATION_REBIND_INITIAL_STATE_NOT_FLAT");
 if(!Array.isArray(observed.state?.journal)||
    observed.state.journal.some(e=>e.type!=="ACCOUNT_MARK"))
  throw Error("V4_OBSERVATION_REBIND_NON_MARK_HISTORY");
 if(!Number.isInteger(observed.revision)||
    observed.revision!==observed.state.journal.length)
  throw Error("V4_OBSERVATION_REBIND_REVISION_MISMATCH");
 const copy=structuredClone(observed);
 copy.releaseSha=newSha;
 return copy;
}
