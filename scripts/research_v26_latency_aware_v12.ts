import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";

async function main() {
  const sourcePath = path.join(process.cwd(), "scripts", "research_v26_latency_aware_v9.ts");
  const generatedPath = path.join(process.cwd(), "scripts", ".research_v26_latency_aware_v12.generated.ts");
  let source = await fs.readFile(sourcePath, "utf8");

  const mustReplace = (needle: string, replacement: string) => {
    if (!source.includes(needle)) throw new Error(`V12_SOURCE_PATCH_MISSING:${needle.slice(0, 100)}`);
    source = source.replace(needle, replacement);
  };

  mustReplace("id: \"v26-v9-resident-stop\",", "id: \"v26-v12-at-most-once-entry-resident-stop\",");
  mustReplace("generation: 20,", "generation: 23,");
  mustReplace("parentIds: [\"v26-v8-resident-exit\"],", "parentIds: [\"v26-v11-redundant-entry-resident-stop\"],");
  mustReplace(
    "thesis: \"Freeze V26 alpha and model Aster-compatible venue-resident STOP_MARKET protection. The last accepted stop remains live during control-plane interruption; only stop updates are delayed.\",",
    "thesis: \"Freeze V26 alpha. Model the safe at-most-once entry tradeoff: a standby may own an unclaimed fresh tick, but an owner crash after claim skips that entry. Existing positions retain the last Aster-resident STOP_MARKET.\",",
  );

  mustReplace(
    "type RunMode = { label: string; entryDelayHours: 0 | 1; stopUpdateLagBars: 0 | 1; feeBpsPerSide: number; slippageBpsPerSide: number };",
    "type RunMode = { label: string; entryDelayHours: 0; stopUpdateLagBars: 0 | 1; feeBpsPerSide: number; slippageBpsPerSide: number; entrySkipPermille: number; skipSeed: string };",
  );

  mustReplace(
    "function pfWithoutBest(pnls: number[]) { const x = [...pnls]; if (x.length) x.splice(x.indexOf(Math.max(...x)), 1); return pf(x); }",
    `function pfWithoutBest(pnls: number[]) { const x = [...pnls]; if (x.length) x.splice(x.indexOf(Math.max(...x)), 1); return pf(x); }
function stableBucket(value: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % 1000;
}
function skipClaimedOwnerEntry(candidate: Candidate, mode: RunMode) {
  if (mode.entrySkipPermille <= 0) return false;
  return stableBucket(\`${"${mode.skipSeed}"}|${"${candidate.symbol}"}|${"${candidate.side}"}|${"${candidate.signalTs}"}\`) < mode.entrySkipPermille;
}`,
  );

  mustReplace(
    "let balance = STARTING_EQUITY, position: Position | null = null, pendingEntry: Candidate | null = null, pendingExitReason: string | null = null, cooldownUntilTs = 0, seq = 0, maxLev = 0, liquidations = 0;",
    "let balance = STARTING_EQUITY, position: Position | null = null, pendingEntry: Candidate | null = null, pendingExitReason: string | null = null, cooldownUntilTs = 0, seq = 0, maxLev = 0, liquidations = 0, skippedEntries = 0;",
  );
  mustReplace(
    "    if (pendingEntry && !position && ts >= cooldownUntilTs && balance > 0) {",
    `    if (pendingEntry && !position && ts >= cooldownUntilTs && balance > 0 && skipClaimedOwnerEntry(pendingEntry, mode)) {
      skippedEntries += 1;
      pendingEntry = null;
    }
    if (pendingEntry && !position && ts >= cooldownUntilTs && balance > 0) {`,
  );
  mustReplace(
    "return { label: mode.label, entryDelayHours: mode.entryDelayHours,",
    "return { label: mode.label, entryDelayHours: mode.entryDelayHours, entrySkipPermille: mode.entrySkipPermille, skipSeed: mode.skipSeed, skippedEntries,",
  );

  const oldModes = `const MODES: RunMode[] = [
  { label: "resident-normal", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 5, slippageBpsPerSide: 0 },
  { label: "resident-cost-stress", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 10, slippageBpsPerSide: 5 },
  { label: "resident-entry-delay-1h", entryDelayHours: 1, stopUpdateLagBars: 0, feeBpsPerSide: 10, slippageBpsPerSide: 5 },
  { label: "resident-stop-update-lag-2h", entryDelayHours: 0, stopUpdateLagBars: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 },
  { label: "resident-combined-entry1h-stoplag2h", entryDelayHours: 1, stopUpdateLagBars: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 },
];
function robust(results: ReturnType<typeof runResident>[]) { return results.every((r) => r.returnPct > 0 && r.profitFactor > 1 && r.tradeCount >= 30) && results.at(-1)!.profitFactorWithoutBest >= 0.95 && results.at(-1)!.maxDrawdownPct <= 50; }`;
  const newModes = `const CLAIM_LOSS_SEEDS = ["a", "b", "c", "d", "e"] as const;
const MODES: RunMode[] = [
  { label: "resident-normal", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 5, slippageBpsPerSide: 0, entrySkipPermille: 0, skipSeed: "none" },
  { label: "resident-cost-stress", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 10, slippageBpsPerSide: 5, entrySkipPermille: 0, skipSeed: "none" },
  ...CLAIM_LOSS_SEEDS.flatMap((seed) => ([
    { label: \`resident-claim-loss-1pct-${"${seed}"}-stoplag2h\`, entryDelayHours: 0 as const, stopUpdateLagBars: 1 as const, feeBpsPerSide: 10, slippageBpsPerSide: 5, entrySkipPermille: 10, skipSeed: seed },
    { label: \`resident-claim-loss-5pct-${"${seed}"}-stoplag2h\`, entryDelayHours: 0 as const, stopUpdateLagBars: 1 as const, feeBpsPerSide: 10, slippageBpsPerSide: 5, entrySkipPermille: 50, skipSeed: seed },
  ])),
];
function robust(results: ReturnType<typeof runResident>[]) {
  return results.every((r) => r.returnPct > 0 && r.profitFactor > 1 && r.tradeCount >= 30 && r.profitFactorWithoutBest >= 0.95 && r.maxDrawdownPct <= 50);
}`;
  mustReplace(oldModes, newModes);

  mustReplace(
    `const combinedWorst = combined3Y?.modes["resident-combined-entry1h-stoplag2h"];`,
    `const combinedStress = combined3Y ? Object.values(combined3Y.modes).filter((row) => row.entrySkipPermille > 0) : [];
  const combinedWorst = combinedStress.reduce<(typeof combinedStress)[number] | undefined>((worst, row) => !worst || row.profitFactorWithoutBest < worst.profitFactorWithoutBest ? row : worst, undefined);`,
  );
  mustReplace("V9_RESIDENT_STOP_EXECUTION_FAILS_DV", "V12_AT_MOST_ONCE_ENTRY_LOSS_FAILS_DV");
  mustReplace("V9_ASTER_RESIDENT_STOP_EXECUTION_ACCEPTED", "V12_AT_MOST_ONCE_ENTRY_LOSS_RESEARCH_ACCEPTED");
  mustReplace("V9_DV_SURVIVES_BUT_3Y_GATE_FAILS", "V12_AT_MOST_ONCE_ENTRY_LOSS_DV_SURVIVES_BUT_3Y_GATE_FAILS");
  mustReplace(
    "normal3YCagrAtLeast100: combined3Y.original.cagrPct >= 100, dvRobust, combinedResidentStressPositive:",
    "normal3YCagrAtLeast100: combined3Y.original.cagrPct >= 100, dvRobust, combinedStressRobust: combined3Y.robust, combinedResidentStressPositive:",
  );
  mustReplace(
    `const out = { researchLine: "V26_LATENCY_AWARE_V9_ASTER_RESIDENT_STOP", researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false, penguExcluded: true, leverage: 1, universe: UNIVERSE, liveFeasibilityVerified: true, venue: "Aster Futures API V3", venueModel: { protectiveOrder: "STOP_MARKET", stopOwnership: "venue", signalTimeframeHours: 2, outageStress: "one complete 2H trailing-stop update is missed; prior accepted venue stop remains active", entryDelayStressHours: 1, feeStressBpsPerSide: 10, slippageStressBpsPerSide: 5, nativeTrailingNotUsed: "V26 uses fixed 0.4 ATR distance; Aster TRAILING_STOP_MARKET uses percentage callbackRate, so V9 avoids semantic substitution" }, governance: "No V26 signal/parameter search. Development and Validation must both pass before Evaluation/combined 3Y are read.", development, validation, dvRobust, evaluation, combined3Y, acceptance, diagnosis };`,
    `const out = { researchLine: "V26_LATENCY_AWARE_V12_AT_MOST_ONCE_ENTRY_LOSS", researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false, penguExcluded: true, leverage: 1, universe: UNIVERSE, liveFeasibilityVerified: false, venueProtectionFeasibilityVerified: true, atMostOnceEntryLossStressBacktested: true, venue: "Aster Futures API V3", venueModel: { protectiveOrder: "STOP_MARKET", stopOwnership: "venue", signalTimeframeHours: 2, claimedOwnerCrashPolicy: "FAIL_CLOSED_SKIP_ENTRY", clientOrderIdScope: "OPEN_ORDERS_ONLY_PER_ASTER_DOCUMENTATION", entryLossStress: "deterministic 1% and 5% entry-opportunity loss across five predeclared seeds", conservativeStopStress: "one complete 2H trailing-stop update is missed while prior accepted venue stop remains active", feeStressBpsPerSide: 10, slippageStressBpsPerSide: 5, nativeTrailingNotUsed: "V26 uses fixed 0.4 ATR distance; Aster TRAILING_STOP_MARKET uses percentage callbackRate" }, governance: "V26 Entry and all strategy parameters are frozen. No late fill and no threshold search. Development and Validation must pass every predeclared claim-loss seed before Evaluation/combined 3Y are read.", development, validation, dvRobust, evaluation, combined3Y, worstCombinedMode: combinedWorst?.label || null, acceptance, diagnosis };`,
  );
  mustReplace("v26-latency-aware-v9.json", "v26-latency-aware-v12.json");
  mustReplace("V9_ENGINE_PARITY_FAIL", "V12_ENGINE_PARITY_FAIL");
  mustReplace("V9_BOUNDARY_FAIL", "V12_BOUNDARY_FAIL");

  if (source.includes("entryDelayHours: 1") || source.includes("resident-entry-delay-1h") || source.includes("resident-combined-entry1h-stoplag2h")) {
    throw new Error("V12_STALE_FILL_MODE_REMAINS");
  }
  if (!source.includes("entrySkipPermille: 50") || !source.includes("CLAIM_LOSS_SEEDS")) throw new Error("V12_CLAIM_LOSS_STRESS_MISSING");

  await fs.writeFile(generatedPath, source, "utf8");
  try {
    execFileSync(process.execPath, ["--import", "tsx", generatedPath], { stdio: "inherit", env: process.env });
  } finally {
    await fs.rm(generatedPath, { force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
