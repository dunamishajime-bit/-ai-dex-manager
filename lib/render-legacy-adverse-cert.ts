/**
 * Existing RENDER adverse-stop operator proof. Pure object validation,
 * never an order-permitting flag by itself.
 */
import {RENDER_LEGACY_INITIAL_STOP_POLICY} from "./render-highwr-and-legacy-stop";

export const RENDER_LEGACY_ADVERSE_CERT_SCHEMA="disdex-render-legacy-adverse-certificate/v1" as const;
export function assertRenderLegacyAdverseCert(raw:unknown,sha:string):void {
 if(!raw || typeof raw!=="object")throw new Error("RENDER_LEGACY_CERT_MALFORMED");
 const c=raw as Record<string,unknown>;
 if(!/^[0-9a-f]{40}$/.test(sha) || c.schema!==RENDER_LEGACY_ADVERSE_CERT_SCHEMA ||
   c.approvedSha!==sha || c.route!=="IDLE_RENDER_RELATIVE_SHORT" ||
   c.adverseTouchPct!==RENDER_LEGACY_INITIAL_STOP_POLICY.adverseTouchAtOrBelowPct ||
   c.watchMinutes!==RENDER_LEGACY_INITIAL_STOP_POLICY.watchMinutes ||
   c.maxFavorableExcursionPct!==RENDER_LEGACY_INITIAL_STOP_POLICY.maxFavorableExcursionMustBeStrictlyBelowPct ||
   c.entryFillTimestampVerified!==true || c.firstClosedM5CompletenessVerified!==true ||
   c.preEntryAndPartialFillMfeCoverageVerified!==true ||
   c.protectedReduceOnlyCloseVerified!==true || c.stopAndTakeProfitUnchangedVerified!==true ||
   c.restartPersistenceVerified!==true ||
   c.operatorApproval!=="APPROVE_RENDER_LEGACY_ADVERSE_AT_BOUND_SHA")
  throw new Error("RENDER_LEGACY_ADVERSE_CERT_UNPROVEN");
}
