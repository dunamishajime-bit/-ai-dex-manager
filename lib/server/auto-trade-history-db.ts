import fs from "fs";
import path from "path";

import type { LiveHybridRunSummary } from "@/lib/server/live-hybrid-autotrade";

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(KV_URL && KV_TOKEN);
const REDIS_KEY = "disdex:auto-trade-history";
const DB_PATH = path.join(process.cwd(), "data", "auto-trade-history.json");
const MAX_HISTORY = 120;

export interface AutoTradeHistoryEntry extends LiveHybridRunSummary {
  id: string;
  tradedCount: number;
  noopCount: number;
  skippedCount: number;
  errorCount: number;
}

let memoryEntries: AutoTradeHistoryEntry[] | null = null;

async function loadFromRedis(): Promise<AutoTradeHistoryEntry[]> {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({ url: KV_URL!, token: KV_TOKEN! });
  const data = await redis.get<AutoTradeHistoryEntry[]>(REDIS_KEY);
  return Array.isArray(data) ? data : [];
}

async function saveToRedis(entries: AutoTradeHistoryEntry[]): Promise<void> {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({ url: KV_URL!, token: KV_TOKEN! });
  await redis.set(REDIS_KEY, entries);
}

function loadFromFs(): AutoTradeHistoryEntry[] {
  try {
    if (memoryEntries) return memoryEntries;
    if (!fs.existsSync(DB_PATH)) return [];
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    memoryEntries = Array.isArray(parsed) ? parsed : [];
    return memoryEntries;
  } catch (error) {
    console.warn("Failed to load auto trade history from filesystem:", error);
    return memoryEntries || [];
  }
}

function saveToFs(entries: AutoTradeHistoryEntry[]) {
  memoryEntries = entries;
  try {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(entries, null, 2), "utf8");
  } catch (error) {
    console.warn("Failed to save auto trade history to filesystem:", error);
  }
}

export async function loadAutoTradeHistory(): Promise<AutoTradeHistoryEntry[]> {
  if (USE_REDIS) return loadFromRedis();
  return loadFromFs();
}

export async function saveAutoTradeHistory(entries: AutoTradeHistoryEntry[]) {
  const next = entries.slice(0, MAX_HISTORY);
  if (USE_REDIS) return saveToRedis(next);
  saveToFs(next);
}

export async function appendAutoTradeHistory(summary: LiveHybridRunSummary) {
  const history = await loadAutoTradeHistory();
  const counts = summary.walletResults.reduce(
    (acc, result) => {
      if (result.status === "traded") acc.tradedCount += 1;
      if (result.status === "noop") acc.noopCount += 1;
      if (result.status === "skipped") acc.skippedCount += 1;
      if (result.status === "error") acc.errorCount += 1;
      return acc;
    },
    { tradedCount: 0, noopCount: 0, skippedCount: 0, errorCount: 0 },
  );

  const entry: AutoTradeHistoryEntry = {
    ...summary,
    id: `atr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...counts,
  };

  await saveAutoTradeHistory([entry, ...history]);
  return entry;
}
