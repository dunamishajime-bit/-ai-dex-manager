import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  evaluateLiveHybridDecisionState,
  runLiveHybridAutotrade,
} from "../lib/server/live-hybrid-autotrade";
import type { HybridVariantOptions } from "../lib/backtest/hybrid-engine";

async function main() {
  const options = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  const state = await evaluateLiveHybridDecisionState(options);
  const decision = state.details.decision;
  const isInjSpringSignal =
    decision.desiredSymbol.toUpperCase() === "INJ" &&
    decision.reason.includes("inj-spring-cash");

  if (!isInjSpringSignal) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: "no_inj_spring_cash_signal",
      decisionTime: decision.isoTime,
      desiredSymbol: decision.desiredSymbol,
      desiredSide: decision.desiredSide,
    }, null, 2));
    return;
  }

  const summary = await runLiveHybridAutotrade(options, { trigger: "inj_spring" });
  console.log(JSON.stringify({
    ok: true,
    skipped: false,
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
