#!/usr/bin/env node
/**
 * Read-only, fail-closed RENDER high-WR + legacy loss monitor interface.
 * This executable NEVER communicates with any exchange and NEVER writes state.
 *
 * Usage:
 *   node --experimental-strip-types scripts/render-highwr-shadow-review.mjs path/to/snapshot.json
 *
 * Atomic persisted, unique, deduplicated shadow journals and live owner/venue
 * order operations are intentionally the responsibility of Codex's VPS wiring.
 * Missing/unverified snapshots result in blocked independent entry and an
 * explicit failure reason, never an implied authorization to trade.
 */
import {readFile} from "node:fs/promises";
import * as renderModule from "../lib/render-highwr-and-legacy-stop.ts";

// With the repository's current tsx/Node interop, a TypeScript module can be
// exposed as a CommonJS namespace whose named exports live under `default`.
// Resolve that shape explicitly so the read-only auditor works in both ESM and
// CJS loader modes without changing the underlying contract.
const renderContract=renderModule.default??renderModule;
const {
  RENDER_ENTRY_POLICY,RENDER_INDEPENDENT_ROUTE,RENDER_SHADOW_VERSION,
  evaluateRenderIndependentGate,evaluateIndependentPriority,settleSixHourShadow,
  startLegacyRenderAdverse,advanceLegacyRenderAdverse,
}=renderContract;

function decide(snapshot) {
  const output={schema:RENDER_SHADOW_VERSION,readOnly:true,canSendOrders:false,
    atDecisionTs:snapshot.decisionTs,route:RENDER_INDEPENDENT_ROUTE,
    status:"REJECTED",shadowOutcomeJournal:[],legacy:null};
  if (!Number.isSafeInteger(snapshot.decisionTs) || snapshot.decisionTs<=0) {
    output.reason="DECISION_TIMESTAMP_INVALID";return output;
  }
  const gate=evaluateRenderIndependentGate({
    decisionTs:snapshot.decisionTs,
    btcM5:snapshot.btcM5??[],
    renderM5:snapshot.renderM5??[],
  });
  output.gate=gate;output.reason=gate.reason;
  const archive=Array.isArray(snapshot.fullySettledSixHourShadows)?snapshot.fullySettledSixHourShadows:[];
  let outstanding=[];
  try{
    // Shadow journal is generated independent of any LIVE admission/positions.
    // Always retain the 6h simulated result independently of any real-route exit.
    if(snapshot.pendingSixHourShadowSignals!==undefined && !Array.isArray(snapshot.pendingSixHourShadowSignals)) throw new Error("SHADOW_PENDING_LIST_INVALID");
    for (const t of snapshot.pendingSixHourShadowSignals??[]) {
      const result=settleSixHourShadow({
        signalTs:t,asOfTs:snapshot.decisionTs,renderM5:snapshot.renderM5??[],
      });
      if(result)outstanding.push(result);
    }
  }catch(err){
    output.reason="SHADOW_MARKET_GAP_OR_MALFORMED:"+String(err?.message??err);
    return output;
  }
  output.shadowOutcomeJournal=outstanding;
  // The caller must deduplicate and atomically persist journal records; this
  // read-only review cannot confer authority or emit real entries.
  const quality=evaluateIndependentPriority({
    decisionTs:snapshot.decisionTs,gate,
    fullySettledSixHourShadows:archive,
    incumbent:snapshot.incumbent??undefined,
    sameSymbolPositionOrPending:snapshot.sameSymbolPositionOrPending!==false,
    cooldownUntil:snapshot.cooldownUntil??Number.MAX_SAFE_INTEGER,
  });
  output.priority=quality;
  if(quality.accepted){
    output.status="MODEL_SIGNAL_PASS_NOT_VENUE_AUTHORIZED";
    output.reason="REQUIRES_NATIVE_OWNER_MARGIN_STOP_VENUE_OPERATOR_ADMISSION";
    // No price is inferred. Venue must provide a signed fill and protection.
    output.entryModel={
      route:RENDER_INDEPENDENT_ROUTE,
      requestedGross:RENDER_ENTRY_POLICY.independentRequestedGross,
      maxHoldMinutes:RENDER_ENTRY_POLICY.independentRealMaxMinutes,
      venueLeverage:RENDER_ENTRY_POLICY.independentVenueLeverage,
      marginType:"CROSS",
      protectiveStopPct:RENDER_ENTRY_POLICY.independentRealStopLossPct,
      takeProfitPct:RENDER_ENTRY_POLICY.independentRealTakeProfitPct,
      cooldownHours:RENDER_ENTRY_POLICY.newIndependentCooldownHours,
    };
  }
  if(snapshot.legacyRenderPosition){
    try {
      const old=snapshot.legacyRenderPosition;
      if(old.originalRoute===RENDER_INDEPENDENT_ROUTE)throw new Error("LEGACY_WRONG_ROUTE");
      let state=old.state??startLegacyRenderAdverse({
        originalRoute:old.originalRoute,
        entryTs:old.entryTs,
        entryPrice:old.entryPrice,
      });
      const details=[];
      for (const bar of old.newlyClosedM5??[]){
        const result=advanceLegacyRenderAdverse(state,bar);
        details.push({closedTs:bar.ts+300_000,reason:result.reason,
          requestProtectedReduceOnlyClose:result.requestProtectedReduceOnlyClose});
        state=result.state;
      }
      output.legacy={state,observations:details,requestProtectedReduceOnlyClose:state.completed===true,
        requiresSignedVenuePositionAndProtectiveOrderReadback:true};
    }catch(err){
      output.legacy={status:"FAIL_CLOSED",reason:String(err?.message??err)};
    }
  }
  return output;
}

export {decide};
if (process.argv[1] && process.argv[1].endsWith("render-highwr-shadow-review.mjs")) {
  const args=process.argv.slice(2);
  let out;
  try {
    if(args.length!==1)throw new Error("USAGE: node scripts/render-highwr-shadow-review.mjs SNAPSHOT.json");
    const raw=JSON.parse(await readFile(args[0],"utf8"));
    out=decide(raw);
  } catch(err) {
    out={schema:RENDER_SHADOW_VERSION,readOnly:true,canSendOrders:false,status:"FAIL_CLOSED",
      reason:String(err?.message??err)};
  }
  process.stdout.write(JSON.stringify(out)+"\n");
  // 0 means "auditor executed", not authorization to send any orders.
}
