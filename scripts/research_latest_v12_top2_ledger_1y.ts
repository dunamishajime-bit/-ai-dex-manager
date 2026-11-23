import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

async function main() {
  const sourcePath = path.join(process.cwd(), "scripts", "research_v12_top2_gross15_one_year.ts");
  const generatedPath = path.join(process.cwd(), "scripts", ".research_latest_v12_top2_generated.ts");
  let source = await fs.readFile(sourcePath, "utf8");

  const replaceOnce = (needle: string, replacement: string) => {
    if (!source.includes(needle)) throw new Error(`TOP2_LEDGER_PATCH_MISSING:${needle.slice(0, 100)}`);
    source = source.replace(needle, replacement);
  };

  replaceOnce("const START = Date.UTC(2025, 7, 21);", "const START = Date.UTC(2025, 7, 10);");
  replaceOnce("const END = Date.UTC(2026, 7, 21);", "const END = Date.UTC(2026, 7, 10);");
  replaceOnce(
    "  rank: number;\n};",
    "  rank: number;\n  entryTs: number;\n  entryNotional: number;\n  requestedGross: number;\n  allocatedGross: number;\n};",
  );
  replaceOnce(
    "  const pnls: number[] = [];",
    "  const pnls: number[] = [];\n  const trades: any[] = [];",
  );
  replaceOnce(
    "    const net = g - q.entryFee - ef - q.funding;\n    cash = Math.max(0, cash + g - ef);\n    pnls.push(net);",
    `    const net = g - q.entryFee - ef - q.funding;
    const netUnitReturn = q.entryNotional > 0 ? net / q.entryNotional : 0;
    trades.push({
      symbol: q.symbol, side: q.side, entryTs: q.entryTs, exitTs: t,
      entryPrice: q.entry, exitPrice: x, requestedGross: q.requestedGross,
      standaloneAllocatedGross: q.allocatedGross, netUnitReturn,
      accountReturn: netUnitReturn * q.allocatedGross, exitReason: _reason, rank: q.rank,
    });
    cash = Math.max(0, cash + g - ef);
    pnls.push(net);`,
  );
  replaceOnce(
    "        symbol: s, side: x.c.side, entry, qty, entryFee, funding: 0, lastFund: t,\n        initialStop, stop: initialStop, tp, atr: x.c.atr, peak: entry, trough: entry, bars: 0, rank: x.rank,",
    "        symbol: s, side: x.c.side, entry, qty, entryFee, funding: 0, lastFund: t,\n        entryTs: t, entryNotional: notional, requestedGross: Math.min(riskNotional / e, v.perPositionGrossCap), allocatedGross: notional / e,\n        initialStop, stop: initialStop, tp, atr: x.c.atr, peak: entry, trough: entry, bars: 0, rank: x.rank,",
  );
  replaceOnce(
    "    tradeCount: pnls.length,\n    averageGross:",
    "    tradeCount: pnls.length,\n    trades,\n    averageGross:",
  );

  await fs.writeFile(generatedPath, source, "utf8");
  try {
    execFileSync(process.execPath, ["--import", "tsx", generatedPath], { stdio: "inherit", env: process.env });
  } finally {
    await fs.rm(generatedPath, { force: true });
  }

  const resultPath = path.join(process.cwd(), ".research-state", "v12-top2-gross15", "result.json");
  const raw = JSON.parse(await fs.readFile(resultPath, "utf8"));
  const normal = raw.results?.top2_residual_cap1p50?.normal;
  const stress = raw.results?.top2_residual_cap1p50?.stress;
  if (!normal?.trades || !stress?.trades) throw new Error("TOP2_LEDGER_TRADES_MISSING");
  const stripTrades = (row: any) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "trades"));
  const payload = {
    schema: "v12-top2-latest-ledger/v1",
    strategyId: "V12_X1.00_ALL_TOP2_RESIDUAL_GROSS15",
    researchOnly: true,
    period: {
      startInclusive: "2025-08-10T00:00:00.000Z",
      endExclusive: "2026-08-10T00:00:00.000Z",
    },
    sourcePeriod: raw.period,
    source: {
      top2ResearchCommit: "fea641f3097c2faa32db59338381b45a99edc6e0",
      productionGrossCommit: "ac254e897b7514d14c3a34c0679388978b5c3d32",
      signalParametersFrozen: true,
    },
    definition: {
      slots: 2,
      perPositionGrossCap: 1.0,
      v12AggregateGrossCap: 1.5,
      riskPct: 3.19,
      entryPolicy: "ALL",
    },
    modes: {
      normal: { metrics: stripTrades(normal), trades: normal.trades },
      stress: { metrics: stripTrades(stress), trades: stress.trades },
    },
    safety: { ordersSent: false, liveChanged: false, vpsChanged: false, productionChanged: false },
  };
  const out = process.env.V12_TOP2_LEDGER_OUT || ".research-state/latest-v8-dca/v12-top2-ledger.json";
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({status:"V12_TOP2_LEDGER_PASS",period:payload.period,sourcePeriod:payload.sourcePeriod,normal:payload.modes.normal.metrics,stress:payload.modes.stress.metrics,normalTrades:normal.trades.length,stressTrades:stress.trades.length}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
