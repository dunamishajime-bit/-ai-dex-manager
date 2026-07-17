import { loadAutoTradeRuntimeControl, isCombinedStrategyActive } from "@/lib/server/auto-trade-runtime-control";
import { refreshCombinedDecisionCache, runCombinedAutotrade } from "@/lib/server/combined/engine";
import { refreshLiveDecisionDisplayCache, runLiveHybridAutotrade, type LiveHybridRunSummary } from "@/lib/server/live-hybrid-autotrade";

type Trigger = "scheduled" | "manual";

export async function refreshActiveLiveDecisionCache() {
  const runtimeControl = loadAutoTradeRuntimeControl();
  if (isCombinedStrategyActive(runtimeControl)) {
    return refreshCombinedDecisionCache();
  }
  return refreshLiveDecisionDisplayCache();
}

export async function runActiveAutoTrade(trigger: Trigger = "scheduled"): Promise<LiveHybridRunSummary> {
  const runtimeControl = loadAutoTradeRuntimeControl();
  if (isCombinedStrategyActive(runtimeControl)) {
    return runCombinedAutotrade({ trigger });
  }
  return trigger === "manual"
    ? runLiveHybridAutotrade(undefined, { trigger: "manual" })
    : runLiveHybridAutotrade();
}
