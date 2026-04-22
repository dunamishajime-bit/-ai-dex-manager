import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  type HybridDecisionWindowPoint,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-latest-window-scores");
const WINDOW_START = Date.UTC(2025, 11, 31, 0, 0, 0);
const WINDOW_END = Date.UTC(2026, 3, 17, 23, 59, 59, 999);

const BASE_OPTIONS: HybridVariantOptions = {
  ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
  backtestStartTs: WINDOW_START,
  backtestEndTs: WINDOW_END,
  strictExtraTrendTrailActivationPct: undefined,
  strictExtraTrendTrailRetracePct: undefined,
};

const ONCE_OPTIONS: HybridVariantOptions = {
  ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
  backtestStartTs: WINDOW_START,
  backtestEndTs: WINDOW_END,
  strictExtraTrendRotationWhileHolding: true,
  strictExtraTrendRotationScoreGap: 10,
  strictExtraTrendRotationCurrentMomAccelMax: 0,
  strictExtraTrendRotationCurrentMom20Max: 0.14,
  strictExtraTrendRotationRequireConsecutiveBars: 1,
  strictExtraTrendRotationMinHoldBars: 2,
};

function scoreOf(point: HybridDecisionWindowPoint, symbol: string) {
  return point.trendEvaluations.find((item) => item.symbol === symbol)?.score ?? null;
}

function eligibleOf(point: HybridDecisionWindowPoint, symbol: string) {
  return point.trendEvaluations.find((item) => item.symbol === symbol)?.eligible ?? false;
}

function keyRows(base: HybridDecisionWindowPoint[], once: HybridDecisionWindowPoint[]) {
  const rows = [];
  for (let i = 0; i < Math.min(base.length, once.length); i += 1) {
    const left = base[i];
    const right = once[i];
    const penguScore = scoreOf(right, "PENGU");
    const ethScore = scoreOf(right, "ETH");
    const solScore = scoreOf(right, "SOL");
    const avaxScore = scoreOf(right, "AVAX");
    const bestNormal = [ethScore, solScore, avaxScore].filter((value): value is number => value != null).reduce((best, value) => Math.max(best, value), Number.NEGATIVE_INFINITY);
    const gapVsBestNormal = penguScore != null && Number.isFinite(bestNormal) ? penguScore - bestNormal : null;

    if (
      right.decision.desiredSymbol === "PENGU"
      || (penguScore != null && gapVsBestNormal != null && gapVsBestNormal >= 10)
      || left.decision.desiredSymbol !== right.decision.desiredSymbol
    ) {
      rows.push({
        iso_time: right.isoTime,
        base_desired: left.decision.desiredSymbol,
        once_desired: right.decision.desiredSymbol,
        eth_score: ethScore != null ? Number(ethScore.toFixed(2)) : null,
        sol_score: solScore != null ? Number(solScore.toFixed(2)) : null,
        avax_score: avaxScore != null ? Number(avaxScore.toFixed(2)) : null,
        pengu_score: penguScore != null ? Number(penguScore.toFixed(2)) : null,
        pengu_gap_vs_best_normal: gapVsBestNormal != null && Number.isFinite(gapVsBestNormal) ? Number(gapVsBestNormal.toFixed(2)) : null,
        pengu_eligible: eligibleOf(right, "PENGU"),
        reason: right.decision.reason,
      });
    }
  }
  return rows;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const [base, once] = await Promise.all([
    analyzeHybridDecisionWindow("RETQ22", BASE_OPTIONS),
    analyzeHybridDecisionWindow("RETQ22", ONCE_OPTIONS),
  ]);

  const importantRows = keyRows(base, once);

  await fs.writeFile(path.join(REPORT_DIR, "base.json"), JSON.stringify(base, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "gap10-once.json"), JSON.stringify(once, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "important-rows.json"), JSON.stringify(importantRows, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "important-rows.md"),
    [
      "# Latest-window 12H score checkpoints",
      "",
      "| time | base desired | gap10 once desired | ETH | SOL | AVAX | PENGU | PENGU gap vs best normal | PENGU eligible | reason |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
      ...importantRows.map((row) => `| ${row.iso_time} | ${row.base_desired} | ${row.once_desired} | ${row.eth_score ?? ""} | ${row.sol_score ?? ""} | ${row.avax_score ?? ""} | ${row.pengu_score ?? ""} | ${row.pengu_gap_vs_best_normal ?? ""} | ${row.pengu_eligible} | ${row.reason} |`),
    ].join("\n"),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
