import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";

async function main() {
  const sourcePath = path.join(process.cwd(), "scripts", "research_v26_latency_aware_v9.ts");
  const generatedPath = path.join(process.cwd(), "scripts", ".research_v26_latency_aware_v10.generated.ts");
  let source = await fs.readFile(sourcePath, "utf8");

  const mustReplace = (needle: string, replacement: string) => {
    if (!source.includes(needle)) throw new Error(`V10_SOURCE_PATCH_MISSING:${needle.slice(0, 80)}`);
    source = source.split(needle).join(replacement);
  };

  mustReplace("id: \"v26-v9-resident-stop\",", "id: \"v26-v10-zero-chase-resident-stop\",");
  mustReplace("generation: 20,", "generation: 21,");
  mustReplace("parentIds: [\"v26-v8-resident-exit\"],", "parentIds: [\"v26-v9-resident-stop\"],");
  mustReplace(
    "thesis: \"Freeze V26 alpha and model Aster-compatible venue-resident STOP_MARKET protection. The last accepted stop remains live during control-plane interruption; only stop updates are delayed.\",",
    "thesis: \"Freeze V26 alpha and Aster resident STOP_MARKET exits. If an entry command is stale by 1H, never chase price in the signal direction: long executes only at or below the intended next-2H-bar open, short only at or above it. No threshold is searched.\",",
  );
  mustReplace(
    "let balance = STARTING_EQUITY, position: Position | null = null, pendingEntry: Candidate | null = null, pendingExitReason: string | null = null, cooldownUntilTs = 0, seq = 0, maxLev = 0, liquidations = 0;",
    "let zeroChaseSkippedEntries = 0; let balance = STARTING_EQUITY, position: Position | null = null, pendingEntry: Candidate | null = null, pendingExitReason: string | null = null, cooldownUntilTs = 0, seq = 0, maxLev = 0, liquidations = 0;",
  );
  mustReplace(
    "const rawEntry = mode.entryDelayHours === 0 ? two?.open : one?.open;",
    "const intendedOpen = two?.open; const delayedOpen = one?.open; const zeroChasePass = mode.entryDelayHours === 0 || Boolean(intendedOpen && delayedOpen && (pendingEntry.side === \"long\" ? delayedOpen <= intendedOpen : delayedOpen >= intendedOpen)); if (mode.entryDelayHours === 1 && !zeroChasePass) zeroChaseSkippedEntries += 1; const rawEntry = mode.entryDelayHours === 0 ? intendedOpen : (zeroChasePass ? delayedOpen : undefined);",
  );
  mustReplace(
    "return { label: mode.label, entryDelayHours: mode.entryDelayHours,",
    "return { label: mode.label, zeroChaseSkippedEntries, entryDelayHours: mode.entryDelayHours,",
  );
  mustReplace("resident-entry-delay-1h", "resident-entry-delay-1h-zero-chase");
  mustReplace("resident-combined-entry1h-stoplag2h", "resident-combined-entry1h-zero-chase-stoplag2h");
  mustReplace(
    "entryDelayStressHours: 1, feeStressBpsPerSide: 10,",
    "entryDelayStressHours: 1, lateEntryPolicy: \"ZERO_CHASE_NO_THRESHOLD: delayed LONG only if price <= intended open; delayed SHORT only if price >= intended open; otherwise skip\", feeStressBpsPerSide: 10,",
  );
  mustReplace(
    "governance: \"No V26 signal/parameter search. Development and Validation must both pass before Evaluation/combined 3Y are read.\",",
    "governance: \"No V26 signal/parameter search and no chase threshold. Zero-Chase activates only when entry age is 1H. Development and Validation must both pass before Evaluation/combined 3Y are read.\",",
  );
  mustReplace("V26_LATENCY_AWARE_V9_ASTER_RESIDENT_STOP", "V26_LATENCY_AWARE_V10_ZERO_CHASE_RESIDENT_STOP");
  mustReplace("v26-latency-aware-v9.json", "v26-latency-aware-v10.json");
  mustReplace("V9_RESIDENT_STOP_EXECUTION_FAILS_DV", "V10_ZERO_CHASE_FAILS_DV");
  mustReplace("V9_ASTER_RESIDENT_STOP_EXECUTION_ACCEPTED", "V10_ZERO_CHASE_RESIDENT_STOP_ACCEPTED");
  mustReplace("V9_DV_SURVIVES_BUT_3Y_GATE_FAILS", "V10_ZERO_CHASE_DV_SURVIVES_BUT_3Y_GATE_FAILS");

  if (source.includes("resident-entry-delay-1h\"") || source.includes("resident-combined-entry1h-stoplag2h")) {
    throw new Error("V10_OLD_DELAY_LABEL_REMAINS");
  }
  if (!source.includes("zeroChasePass") || !source.includes("ZERO_CHASE_NO_THRESHOLD")) {
    throw new Error("V10_ZERO_CHASE_PATCH_NOT_APPLIED");
  }

  await fs.writeFile(generatedPath, source, "utf8");
  try {
    execFileSync("npx", ["tsx", generatedPath], { stdio: "inherit", env: process.env });
  } finally {
    await fs.rm(generatedPath, { force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
