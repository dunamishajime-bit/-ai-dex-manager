import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

async function main() {
  const sourceRoot = process.env.V12_SOURCE_ROOT || ".v12-research";
  const sourcePath = path.join(process.cwd(), sourceRoot, "scripts", "research_v26_latency_aware_v9.ts");
  const generatedPath = path.join(process.cwd(), sourceRoot, "scripts", ".research_v12_combined_bt_ledger.generated.ts");
  let source = await fs.readFile(sourcePath, "utf8");

  const replaceOnce = (needle: string, replacement: string) => {
    if (!source.includes(needle)) throw new Error(`V12_LEDGER_PATCH_MISSING:${needle.slice(0, 120)}`);
    source = source.replace(needle, replacement);
  };

  replaceOnce("const END = Date.UTC(2026, 6, 1);", "const END = Date.UTC(2026, 7, 10);");
  replaceOnce("id: \"v26-v9-resident-stop\",", "id: \"v26-v12-at-most-once-entry-resident-stop\",");
  replaceOnce("generation: 20,", "generation: 23,");
  replaceOnce("parentIds: [\"v26-v8-resident-exit\"],", "parentIds: [\"v26-v11-redundant-entry-resident-stop\"],");
  replaceOnce(
    "type Trade = { symbol: string; side: PerpSide; netPnl: number; exitReason: string; liquidated: boolean; effectiveLeverage: number };",
    "type Trade = { symbol: string; side: PerpSide; decisionEntryTs: number; entryTs: number; exitTs: number; entryPrice: number; exitPrice: number; requestedGross: number; netUnitReturn: number; accountReturn: number; netPnl: number; exitReason: string; liquidated: boolean; effectiveLeverage: number };",
  );
  replaceOnce(
    "type RunMode = { label: string; entryDelayHours: 0 | 1; stopUpdateLagBars: 0 | 1; feeBpsPerSide: number; slippageBpsPerSide: number };",
    "type RunMode = { label: string; entryDelayHours: 0; stopUpdateLagBars: 0 | 1; feeBpsPerSide: number; slippageBpsPerSide: number; entrySkipPermille: number; skipSeed: string; entryPolicy: EntryPolicy };",
  );
  replaceOnce(
    "function pfWithoutBest(pnls: number[]) { const x = [...pnls]; if (x.length) x.splice(x.indexOf(Math.max(...x)), 1); return pf(x); }",
    `function pfWithoutBest(pnls: number[]) { const x = [...pnls]; if (x.length) x.splice(x.indexOf(Math.max(...x)), 1); return pf(x); }
type EntryPolicy = "ALL" | "US_RTH_OFF" | "JST_00_08" | "JST_08_16" | "JST_16_24";
function stableBucket(value: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % 1000;
}
function skipClaimedOwnerEntry(candidate: Candidate, mode: RunMode) {
  return mode.entrySkipPermille > 0 && stableBucket(\`${"${mode.skipSeed}"}|${"${candidate.symbol}"}|${"${candidate.side}"}|${"${candidate.signalTs}"}\`) < mode.entrySkipPermille;
}
function entryAllowed(ts: number, policy: EntryPolicy) {
  if (policy === "ALL") return true;
  const utcHour = new Date(ts).getUTCHours();
  const jstHour = (utcHour + 9) % 24;
  if (policy === "JST_00_08") return jstHour < 8;
  if (policy === "JST_08_16") return jstHour >= 8 && jstHour < 16;
  if (policy === "JST_16_24") return jstHour >= 16;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ts));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = String(value.weekday || "");
  const minutes = Number(value.hour) * 60 + Number(value.minute);
  const regularWeekday = !["Sat", "Sun"].includes(weekday);
  return !(regularWeekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60);
}`,
  );
  replaceOnce(
    "let balance = STARTING_EQUITY, position: Position | null = null, pendingEntry: Candidate | null = null, pendingExitReason: string | null = null, cooldownUntilTs = 0, seq = 0, maxLev = 0, liquidations = 0;",
    "let balance = STARTING_EQUITY, position: Position | null = null, pendingEntry: Candidate | null = null, pendingExitReason: string | null = null, cooldownUntilTs = 0, seq = 0, maxLev = 0, liquidations = 0, skippedEntries = 0, timeBlockedEntries = 0, currentTs = startTs;",
  );
  replaceOnce(
    "trades.push({ symbol: x.symbol, side: x.side, netPnl: net, exitReason: reason, liquidated, effectiveLeverage: x.effectiveLeverage }); pnls.push(net);",
    "const netUnitReturn = x.notional > 0 ? net / x.notional : 0; trades.push({ symbol: x.symbol, side: x.side, decisionEntryTs: x.decisionEntryTs, entryTs: x.actualEntryTs, exitTs: currentTs, entryPrice: x.entryPrice, exitPrice, requestedGross: x.effectiveLeverage, netUnitReturn, accountReturn: netUnitReturn * x.effectiveLeverage, netPnl: net, exitReason: reason, liquidated, effectiveLeverage: x.effectiveLeverage }); pnls.push(net);",
  );
  replaceOnce("for (const ts of timeline) {", "for (const ts of timeline) { currentTs = ts;");
  replaceOnce(
    "    if (pendingEntry && !position && ts >= cooldownUntilTs && balance > 0) {",
    `    if (pendingEntry && !position && ts >= cooldownUntilTs && balance > 0 && !entryAllowed(ts, mode.entryPolicy)) {
      timeBlockedEntries += 1;
      pendingEntry = null;
    }
    if (pendingEntry && !position && ts >= cooldownUntilTs && balance > 0 && skipClaimedOwnerEntry(pendingEntry, mode)) {
      skippedEntries += 1;
      pendingEntry = null;
    }
    if (pendingEntry && !position && ts >= cooldownUntilTs && balance > 0) {`,
  );
  replaceOnce(
    "if (position) { const rows = data.bySymbol[position.symbol] ?? [], last = [...rows].reverse().find((b) => b.ts < endTs); if (last) close(last.close, \"window-end\", false); }",
    "if (position) { const rows = data.bySymbol[position.symbol] ?? [], last = [...rows].reverse().find((b) => b.ts < endTs); if (last) { currentTs = last.ts; close(last.close, \"window-end\", false); } }",
  );
  replaceOnce(
    "return { label: mode.label, entryDelayHours: mode.entryDelayHours, stopUpdateLagBars: mode.stopUpdateLagBars,",
    "return { label: mode.label, entryDelayHours: mode.entryDelayHours, entryPolicy: mode.entryPolicy, entrySkipPermille: mode.entrySkipPermille, skipSeed: mode.skipSeed, skippedEntries, timeBlockedEntries, stopUpdateLagBars: mode.stopUpdateLagBars,",
  );
  replaceOnce(
    "liquidationCount: liquidations, exitReasons: Object.fromEntries([...new Set(trades.map((t) => t.exitReason))].map((r) => [r, trades.filter((t) => t.exitReason === r).length])) };",
    "liquidationCount: liquidations, exitReasons: Object.fromEntries([...new Set(trades.map((t) => t.exitReason))].map((r) => [r, trades.filter((t) => t.exitReason === r).length])), trades };",
  );

  const legacyModesStart = source.indexOf("const MODES: RunMode[] = [");
  const closeEnoughStart = source.indexOf("function closeEnough", legacyModesStart);
  if (legacyModesStart < 0 || closeEnoughStart < 0) throw new Error("V12_LEDGER_LEGACY_MODES_PATCH_MISSING");
  source = source.slice(0, legacyModesStart)
    + "const MODES: RunMode[] = [];\nfunction robust(results: ReturnType<typeof runResident>[]) { return results.every((row) => row.returnPct > 0 && row.profitFactor > 1); }\n"
    + source.slice(closeEnoughStart);

  const mainStart = source.indexOf("async function main() {");
  if (mainStart < 0) throw new Error("V12_LEDGER_MAIN_PATCH_MISSING");
  source = source.slice(0, mainStart) + `async function main() {
  const LATEST_START = Date.UTC(2025, 7, 10);
  const LATEST_END = Date.UTC(2026, 7, 10);
  const LINEAGE_START = Date.UTC(2025, 6, 1);
  const LINEAGE_END = Date.UTC(2026, 6, 1);
  const policies: EntryPolicy[] = ["ALL", "US_RTH_OFF", "JST_00_08", "JST_08_16", "JST_16_24"];
  const normalMode = (entryPolicy: EntryPolicy): RunMode => ({ label: \`${"${entryPolicy}"}:normal\`, entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 5, slippageBpsPerSide: 0, entrySkipPermille: 0, skipSeed: "none", entryPolicy });
  const stressMode = (entryPolicy: EntryPolicy): RunMode => ({ label: \`${"${entryPolicy}"}:stress\`, entryDelayHours: 0, stopUpdateLagBars: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5, entrySkipPermille: 50, skipSeed: "d", entryPolicy });
  const data = await loadPerpMarketData({ symbols: UNIVERSE, startTs: WARMUP_START, endTs: LATEST_END + 4 * HOUR });
  const prepared = prepare(data);
  const lineageNormal = runResident(data, prepared, LINEAGE_START, LINEAGE_END, normalMode("ALL"));
  const lineageStress = runResident(data, prepared, LINEAGE_START, LINEAGE_END, stressMode("ALL"));
  if (lineageNormal.tradeCount !== 223 || Math.abs(lineageNormal.returnPct - 110.517) > 0.20 || Math.abs(lineageNormal.profitFactor - 3.510) > 0.02) throw new Error(\`V12_LINEAGE_NORMAL_MISMATCH:${"${JSON.stringify(lineageNormal)}"}\`);
  if (Math.abs(lineageStress.returnPct - 58.230) > 0.30 || Math.abs(lineageStress.profitFactor - 1.952) > 0.03) throw new Error(\`V12_LINEAGE_STRESS_MISMATCH:${"${JSON.stringify(lineageStress)}"}\`);
  const modes: Record<string, { normal: ReturnType<typeof runResident>; stress: ReturnType<typeof runResident> }> = {};
  for (const policy of policies) modes[policy] = {
    normal: runResident(data, prepared, LATEST_START, LATEST_END, normalMode(policy)),
    stress: runResident(data, prepared, LATEST_START, LATEST_END, stressMode(policy)),
  };
  const output = {
    schema: "v12-combined-bt-ledger/v1",
    strategyId: V26.id,
    researchOnly: true,
    period: { startInclusive: new Date(LATEST_START).toISOString(), endExclusive: new Date(LATEST_END).toISOString() },
    lineage: { period: { startInclusive: new Date(LINEAGE_START).toISOString(), endExclusive: new Date(LINEAGE_END).toISOString() }, normal: lineageNormal, stress: lineageStress },
    source: { v12SourceSha: process.env.V12_SOURCE_SHA || null, frozenParameters: true, venueModel: "Aster Futures API V3 resident STOP_MARKET" },
    entryPolicies: {
      ALL: "new entries 24 hours",
      US_RTH_OFF: "new entries blocked Mon-Fri 09:30-16:00 America/New_York; exits and resident stops remain active",
      JST_00_08: "new entries only 00:00-07:59 JST; exits and resident stops remain active",
      JST_08_16: "new entries only 08:00-15:59 JST; exits and resident stops remain active",
      JST_16_24: "new entries only 16:00-23:59 JST; exits and resident stops remain active",
    },
    modes,
    safety: { ordersSent: false, liveChanged: false, vpsChanged: false, productionChanged: false },
  };
  const outputPath = process.env.V12_LEDGER_OUT || ".research-state/v12-v52-pengu-v2-combined/v12-ledgers.json";
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\\n", "utf8");
  console.log(JSON.stringify({ status: "V12_COMBINED_LEDGER_PASS", lineage: { normal: lineageNormal, stress: lineageStress }, latest: Object.fromEntries(Object.entries(modes).map(([key, value]) => [key, { normal: { returnPct: value.normal.returnPct, profitFactor: value.normal.profitFactor, maxDrawdownPct: value.normal.maxDrawdownPct, trades: value.normal.tradeCount, timeBlockedEntries: value.normal.timeBlockedEntries }, stress: { returnPct: value.stress.returnPct, profitFactor: value.stress.profitFactor, maxDrawdownPct: value.stress.maxDrawdownPct, trades: value.stress.tradeCount, skippedEntries: value.stress.skippedEntries, timeBlockedEntries: value.stress.timeBlockedEntries } }])), safety: output.safety }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
`;

  if (source.includes("entryDelayHours: 1")) throw new Error("V12_LEDGER_STALE_FILL_MODE_REMAINS");
  await fs.writeFile(generatedPath, source, "utf8");
  if (process.env.V12_LEDGER_PATCH_ONLY === "true") {
    console.log(`V12_LEDGER_PATCH_ONLY:${generatedPath}`);
    return;
  }
  try {
    execFileSync(process.execPath, ["--import", "tsx", generatedPath], { stdio: "inherit", env: process.env });
  } finally {
    await fs.rm(generatedPath, { force: true });
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
