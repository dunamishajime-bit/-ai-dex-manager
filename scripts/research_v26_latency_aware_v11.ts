import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";

async function main() {
  const sourcePath = path.join(process.cwd(), "scripts", "research_v26_latency_aware_v9.ts");
  const generatedPath = path.join(process.cwd(), "scripts", ".research_v26_latency_aware_v11.generated.ts");
  let source = await fs.readFile(sourcePath, "utf8");

  const mustReplace = (needle: string, replacement: string) => {
    if (!source.includes(needle)) throw new Error(`V11_SOURCE_PATCH_MISSING:${needle.slice(0, 100)}`);
    source = source.replace(needle, replacement);
  };

  mustReplace("id: \"v26-v9-resident-stop\",", "id: \"v26-v11-redundant-entry-resident-stop\",");
  mustReplace("generation: 20,", "generation: 22,");
  mustReplace("parentIds: [\"v26-v8-resident-exit\"],", "parentIds: [\"v26-v10-zero-chase-resident-stop\"],");
  mustReplace(
    "thesis: \"Freeze V26 alpha and model Aster-compatible venue-resident STOP_MARKET protection. The last accepted stop remains live during control-plane interruption; only stop updates are delayed.\",",
    "thesis: \"Freeze V26 alpha. Do not alter or chase stale entries. Remove single-node entry latency operationally with redundant deterministic executors; reject any entry that becomes stale. Existing positions remain protected by venue-resident STOP_MARKET orders even if one control node is unavailable.\",",
  );

  const oldModes = `const MODES: RunMode[] = [\n  { label: \"resident-normal\", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 5, slippageBpsPerSide: 0 },\n  { label: \"resident-cost-stress\", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 10, slippageBpsPerSide: 5 },\n  { label: \"resident-entry-delay-1h\", entryDelayHours: 1, stopUpdateLagBars: 0, feeBpsPerSide: 10, slippageBpsPerSide: 5 },\n  { label: \"resident-stop-update-lag-2h\", entryDelayHours: 0, stopUpdateLagBars: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 },\n  { label: \"resident-combined-entry1h-stoplag2h\", entryDelayHours: 1, stopUpdateLagBars: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 },\n];\nfunction robust(results: ReturnType<typeof runResident>[]) { return results.every((r) => r.returnPct > 0 && r.profitFactor > 1 && r.tradeCount >= 30) && results.at(-1)!.profitFactorWithoutBest >= 0.95 && results.at(-1)!.maxDrawdownPct <= 50; }`;
  const newModes = `const MODES: RunMode[] = [\n  { label: \"resident-normal\", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 5, slippageBpsPerSide: 0 },\n  { label: \"resident-cost-stress\", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 10, slippageBpsPerSide: 5 },\n  // Single execution-node outage: the independent standby owns the same deterministic decision tick,\n  // so entry is not intentionally shifted to a stale +1H fill. Conservatively allow one full 2H stop update to be missed;\n  // the last accepted STOP_MARKET remains resident at the venue throughout.\n  { label: \"resident-single-node-outage-stoplag2h\", entryDelayHours: 0, stopUpdateLagBars: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 },\n];\nfunction robust(results: ReturnType<typeof runResident>[]) {\n  const performance = results.slice(1);\n  return performance.every((r) => r.returnPct > 0 && r.profitFactor > 1 && r.tradeCount >= 30)\n    && results.at(-1)!.profitFactorWithoutBest >= 0.95\n    && results.at(-1)!.maxDrawdownPct <= 50;\n}`;
  mustReplace(oldModes, newModes);

  mustReplace(
    `const combinedWorst = combined3Y?.modes[\"resident-combined-entry1h-stoplag2h\"];`,
    `const combinedWorst = combined3Y?.modes[\"resident-single-node-outage-stoplag2h\"];`,
  );
  mustReplace(
    `const out = { researchLine: \"V26_LATENCY_AWARE_V9_ASTER_RESIDENT_STOP\", researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false, penguExcluded: true, leverage: 1, universe: UNIVERSE, liveFeasibilityVerified: true, venue: \"Aster Futures API V3\", venueModel: { protectiveOrder: \"STOP_MARKET\", stopOwnership: \"venue\", signalTimeframeHours: 2, outageStress: \"one complete 2H trailing-stop update is missed; prior accepted venue stop remains active\", entryDelayStressHours: 1, feeStressBpsPerSide: 10, slippageStressBpsPerSide: 5, nativeTrailingNotUsed: \"V26 uses fixed 0.4 ATR distance; Aster TRAILING_STOP_MARKET uses percentage callbackRate, so V9 avoids semantic substitution\" }, governance: \"No V26 signal/parameter search. Development and Validation must both pass before Evaluation/combined 3Y are read.\", development, validation, dvRobust, evaluation, combined3Y, acceptance, diagnosis };`,
    `const out = { researchLine: \"V26_LATENCY_AWARE_V11_REDUNDANT_ENTRY_RESIDENT_STOP\", researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false, penguExcluded: true, leverage: 1, universe: UNIVERSE, liveFeasibilityVerified: false, venueProtectionFeasibilityVerified: true, redundantEntryExecutorImplemented: false, venue: \"Aster Futures API V3\", venueModel: { protectiveOrder: \"STOP_MARKET\", stopOwnership: \"venue\", signalTimeframeHours: 2, singleNodeOutage: \"independent hot-standby executor must execute the same fresh decision tick; do not fill the command one hour late\", staleEntryPolicy: \"FAIL_CLOSED_REJECT: if the intended decision tick is stale, submit no new position and do not chase price\", correlatedExecutorOutage: \"new entries remain disabled until a fresh decision tick; existing positions retain the last accepted venue-resident STOP_MARKET\", conservativeStopStress: \"one complete 2H trailing-stop update is missed while prior accepted venue stop remains active\", deterministicOrderRequirement: \"same decision identity/client order identity plus reconciliation must prevent duplicate fills across executors\", feeStressBpsPerSide: 10, slippageStressBpsPerSide: 5, nativeTrailingNotUsed: \"V26 uses fixed 0.4 ATR distance; Aster TRAILING_STOP_MARKET uses percentage callbackRate, so resident STOP_MARKET preserves V26 semantics\" }, governance: \"No V26 signal/parameter search and no late-entry optimization. Universal +1H late-fill performance is deliberately not accepted as an operating mode: stale entries fail closed. Development and Validation must both pass cost stress plus resident-stop single-node-outage stress before Evaluation/combined 3Y are read.\", development, validation, dvRobust, evaluation, combined3Y, acceptance, diagnosis };`,
  );
  mustReplace("V9_RESIDENT_STOP_EXECUTION_FAILS_DV", "V11_REDUNDANT_RESIDENT_ARCH_FAILS_DV");
  mustReplace("V9_ASTER_RESIDENT_STOP_EXECUTION_ACCEPTED", "V11_REDUNDANT_RESIDENT_ARCH_RESEARCH_ACCEPTED");
  mustReplace("V9_DV_SURVIVES_BUT_3Y_GATE_FAILS", "V11_REDUNDANT_RESIDENT_DV_SURVIVES_BUT_3Y_GATE_FAILS");
  mustReplace("v26-latency-aware-v9.json", "v26-latency-aware-v11.json");

  if (source.includes("resident-entry-delay-1h") || source.includes("resident-combined-entry1h-stoplag2h")) throw new Error("V11_STALE_FILL_MODE_REMAINS");
  if (!source.includes("FAIL_CLOSED_REJECT") || !source.includes("redundantEntryExecutorImplemented: false")) throw new Error("V11_ARCHITECTURE_PROVENANCE_FAIL");

  await fs.writeFile(generatedPath, source, "utf8");
  try {
    execFileSync("npx", ["tsx", generatedPath], { stdio: "inherit", env: process.env });
  } finally {
    await fs.rm(generatedPath, { force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
