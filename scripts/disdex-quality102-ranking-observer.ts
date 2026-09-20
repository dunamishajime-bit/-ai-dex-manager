import "dotenv/config";

import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AsterV3Client } from "../lib/aster-v3-client";
import {
  augmentQuality102DecisionSnapshotWithRanking,
  type Quality102CausalV4DecisionSnapshot,
} from "../lib/disdex-quality102-causal-v4-observability";
import type { Quality102CausalV1History } from "../lib/disdex-quality102-causal-v1-signal";
import type { Quality102Candle } from "../lib/disdex-quality102-causal-pipeline";
import { persistQuality102RankingHistory } from "../lib/disdex-quality102-ranking-history";

const DEFAULT_STATE_ROOT = "/var/lib/disdex/quality102-causal-v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

type PersistedHistory = {
  version?: number;
  savedAt?: number;
  historyHours?: number;
  symbols?: string[];
  candlesBySymbol?: Record<string, Quality102Candle[]>;
};

function requiredHighVolSymbols(value: string | undefined): string[] {
  const values = String(value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(values)].sort();
  if (!unique.length) throw new Error("Q102_RANKING_OBSERVER_HIGH_VOL_SYMBOLS_REQUIRED");
  return unique;
}

function finitePositive(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Q102_RANKING_OBSERVER_${field}_INVALID`);
  return number;
}

async function loadBaseSnapshot(path: string): Promise<Quality102CausalV4DecisionSnapshot> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as Quality102CausalV4DecisionSnapshot;
  if (parsed.strategyId !== "QUALITY102_CAUSAL_V1") throw new Error("Q102_RANKING_OBSERVER_STRATEGY_MISMATCH");
  if (parsed.selectorMode !== "CAUSAL_V4") throw new Error("Q102_RANKING_OBSERVER_SELECTOR_MISMATCH");
  if (!SHA_PATTERN.test(String(parsed.runtimeCommitSha || ""))) throw new Error("Q102_RANKING_OBSERVER_RUNTIME_SHA_INVALID");
  if (!Number.isFinite(Number(parsed.referenceTs)) || Number(parsed.referenceTs) <= 0) throw new Error("Q102_RANKING_OBSERVER_REFERENCE_TS_INVALID");
  if (!Array.isArray(parsed.items) || !parsed.items.length) throw new Error("Q102_RANKING_OBSERVER_ITEMS_MISSING");
  return parsed;
}

async function loadClosedHistory(path: string): Promise<Quality102CausalV1History> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as PersistedHistory;
  if (!parsed.candlesBySymbol || typeof parsed.candlesBySymbol !== "object") {
    throw new Error("Q102_RANKING_OBSERVER_HISTORY_MISSING");
  }
  return { candlesBySymbol: parsed.candlesBySymbol };
}

async function loadEntryOpen(client: AsterV3Client, symbol: string, referenceTs: number): Promise<{ timestampMs: number; open: number }> {
  const endTime = Math.max(referenceTs + 1, Date.now());
  const rows = await client.getKlines(symbol, "1h", 2, { startTime: referenceTs, endTime });
  const row = rows.find((candidate) => Number(candidate[0]) === referenceTs);
  if (!row) throw new Error(`Q102_RANKING_OBSERVER_ENTRY_OPEN_MISSING:${symbol}`);
  return { timestampMs: referenceTs, open: finitePositive(row[1], `ENTRY_OPEN_${symbol}`) };
}

async function main() {
  const stateRoot = resolve(process.env.QUALITY102_CAUSAL_V1_STATE_DIR || DEFAULT_STATE_ROOT);
  const baseSnapshotPath = resolve(process.env.QUALITY102_DECISION_SNAPSHOT_PATH || resolve(stateRoot, "decision-snapshot.json"));
  const historyPath = resolve(process.env.QUALITY102_CAUSAL_V1_HISTORY_CACHE_PATH || resolve(stateRoot, "market-history.json"));
  const outputPath = resolve(process.env.QUALITY102_RANKING_SNAPSHOT_PATH || resolve(stateRoot, "decision-ranking-snapshot.json"));
  const observerCommitSha = String(process.env.DISDEX_OBSERVER_COMMIT_SHA || process.env.DISDEX_RELEASE_SHA || "").trim();
  if (!SHA_PATTERN.test(observerCommitSha)) throw new Error("Q102_RANKING_OBSERVER_COMMIT_SHA_REQUIRED");

  const highVolSymbols = requiredHighVolSymbols(process.env.QUALITY102_CAUSAL_V1_SYMBOLS);
  const baseSnapshot = await loadBaseSnapshot(baseSnapshotPath);
  const history = await loadClosedHistory(historyPath);
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_BASE_URL,
    requestTimeoutMs: Number(process.env.ASTER_REQUEST_TIMEOUT_MS || 10_000),
    readOnlyRateLimitMaxRetries: Number(process.env.ASTER_READONLY_RATE_LIMIT_MAX_RETRIES || 3),
  });

  const symbols = [...new Set(baseSnapshot.items.map((item) => item.symbol.toUpperCase()))].sort();
  const entryOpenBySymbol: Record<string, { timestampMs: number; open: number }> = {};
  for (const symbol of symbols) {
    entryOpenBySymbol[symbol] = await loadEntryOpen(client, symbol, Number(baseSnapshot.referenceTs));
  }

  const ranked = augmentQuality102DecisionSnapshotWithRanking({
    snapshot: baseSnapshot,
    history: {
      candlesBySymbol: history.candlesBySymbol,
      entryOpenBySymbol,
    },
    highVolSymbols,
    observerCommitSha,
    rankingCapturedAt: new Date().toISOString(),
  });

  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(ranked, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(temporary, outputPath);
  await persistQuality102RankingHistory({ stateRoot, snapshot: ranked });

  console.log(JSON.stringify({
    status: "Q102_RANKING_OBSERVER_OK",
    readOnly: true,
    tradingMutation: 0,
    runtimeCommitSha: ranked.runtimeCommitSha,
    observerCommitSha: ranked.observerCommitSha,
    referenceTs: ranked.referenceTs,
    rankingCapturedAt: ranked.rankingCapturedAt,
    outputPath,
    items: ranked.items.length,
    top: [...ranked.items]
      .sort((left, right) => (left.rankingRank ?? 999) - (right.rankingRank ?? 999))
      .slice(0, 5)
      .map((item) => ({
        rank: item.rankingRank,
        symbol: item.symbol,
        score: item.rankingScore,
        family: item.rankingFamily,
        variant: item.rankingVariant,
        stage: item.rankingStage,
      })),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "Q102_RANKING_OBSERVER_FAILED",
    readOnly: true,
    tradingMutation: 0,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
