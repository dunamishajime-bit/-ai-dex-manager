import fs from "fs/promises";
import path from "path";

import { COMBINED_ENTRY_CONFIG, COMBINED_RISK_CONFIG } from "@/lib/server/combined/config";
import type { CombinedSignalSide, CombinedSignalSnapshot } from "@/lib/server/combined/types";

const DATA_DIR_CANDIDATES = [
  process.env.GOLDCAT_UPDOWN_DIR?.trim() || "",
  "/home/deploy/goldcat-system/data/updown",
  "C:\\Users\\dis\\Documents\\New trade\\data\\updown",
].filter(Boolean);
const MAX_FILES = 8;
const MAX_ROWS = 800;

type UpdownRow = {
  ts: number;
  iso?: string;
  coin: string;
  elapsedSec: number;
  moveBps: number;
  horizonSec: number;
  up?: {
    bestAsk?: number;
    askDepthUsd?: number;
    bidDepthUsd?: number;
    spreadBps?: number;
  };
  down?: {
    bestAsk?: number;
    askDepthUsd?: number;
    bidDepthUsd?: number;
    spreadBps?: number;
  };
};

function toSide(moveBps: number): CombinedSignalSide {
  if (moveBps > 0) return "long";
  if (moveBps < 0) return "short";
  return "flat";
}

function buildRejectedSnapshot(reason: string, nowIso: string): CombinedSignalSnapshot {
  return {
    checkedAt: nowIso,
    signalTs: null,
    source: "goldcat_btc_15m",
    side: "flat",
    moveBps: 0,
    elapsedSec: null,
    bidSupportRatio: null,
    spreadBps: null,
    accepted: false,
    reason,
  };
}

async function resolveDataDir() {
  for (const candidate of DATA_DIR_CANDIDATES) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(`GoldCat updown directory not found. Checked: ${DATA_DIR_CANDIDATES.join(", ")}`);
}

async function listRecentFiles() {
  const dataDir = await resolveDataDir();
  const names = await fs.readdir(dataDir);
  return names
    .filter((name) => /^updown_lag_.*\.ndjson$/.test(name))
    .sort()
    .slice(-MAX_FILES)
    .map((name) => path.join(dataDir, name));
}

async function loadRecentBtc15mRows() {
  const files = await listRecentFiles();
  const rows: UpdownRow[] = [];
  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as UpdownRow;
      if (row.coin !== "BTC") continue;
      if (Number(row.horizonSec) !== 900) continue;
      if (!Number.isFinite(row.ts) || !Number.isFinite(row.moveBps) || !Number.isFinite(row.elapsedSec)) continue;
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.ts - b.ts).slice(-MAX_ROWS);
}

function evaluateRow(row: UpdownRow) {
  const side = toSide(row.moveBps);
  if (side === "flat") return { accepted: false, reason: "moveBpsが0です。", side, bidSupportRatio: null, spreadBps: null };

  if (row.elapsedSec < COMBINED_ENTRY_CONFIG.minElapsedSec || row.elapsedSec > COMBINED_ENTRY_CONFIG.maxElapsedSec) {
    return {
      accepted: false,
      reason: `entry timing外です (${row.elapsedSec}s)。`,
      side,
      bidSupportRatio: null,
      spreadBps: null,
    };
  }

  if (Math.abs(row.moveBps) < COMBINED_ENTRY_CONFIG.minMoveBps) {
    return {
      accepted: false,
      reason: `moveBps不足です (${row.moveBps.toFixed(2)}bps)。`,
      side,
      bidSupportRatio: null,
      spreadBps: null,
    };
  }

  const book = side === "long" ? row.up : row.down;
  if (!book || !Number.isFinite(book.bestAsk)) {
    return { accepted: false, reason: "板情報が不足しています。", side, bidSupportRatio: null, spreadBps: null };
  }

  const spreadBps = Number(book.spreadBps || 0);
  const bidSupportRatio = Number(book.bidDepthUsd || 0) / Math.max(1, Number(book.askDepthUsd || 0));
  if (Number(book.bestAsk) > COMBINED_ENTRY_CONFIG.maxEntryPrice) {
    return {
      accepted: false,
      reason: `entry price上限超過です (${Number(book.bestAsk).toFixed(3)})。`,
      side,
      bidSupportRatio,
      spreadBps,
    };
  }

  if (spreadBps > COMBINED_ENTRY_CONFIG.maxEntrySpreadBps) {
    return {
      accepted: false,
      reason: `spread超過です (${spreadBps.toFixed(1)}bps)。`,
      side,
      bidSupportRatio,
      spreadBps,
    };
  }

  if (bidSupportRatio < COMBINED_ENTRY_CONFIG.minBidSupportRatio) {
    return {
      accepted: false,
      reason: `bid support不足です (${bidSupportRatio.toFixed(2)})。`,
      side,
      bidSupportRatio,
      spreadBps,
    };
  }

  return {
    accepted: true,
    reason: `BTC 15m GoldCat条件を通過 (${side}, move=${row.moveBps.toFixed(2)}bps)。`,
    side,
    bidSupportRatio,
    spreadBps,
  };
}

export async function loadLatestCombinedSignal(now = Date.now()): Promise<CombinedSignalSnapshot> {
  const nowIso = new Date(now).toISOString();

  try {
    const rows = await loadRecentBtc15mRows();
    if (!rows.length) return buildRejectedSnapshot("GoldCat BTC 15mデータが見つかりません。", nowIso);

    const latestAccepted = [...rows].reverse().find((row) => evaluateRow(row).accepted);
    if (!latestAccepted) {
      const fallback = rows.at(-1)!;
      const evaluated = evaluateRow(fallback);
      return {
        checkedAt: nowIso,
        signalTs: fallback.iso || new Date(fallback.ts).toISOString(),
        source: "goldcat_btc_15m",
        side: evaluated.side,
        moveBps: fallback.moveBps,
        elapsedSec: fallback.elapsedSec,
        bidSupportRatio: evaluated.bidSupportRatio,
        spreadBps: evaluated.spreadBps,
        accepted: false,
        reason: evaluated.reason,
      };
    }

    const evaluated = evaluateRow(latestAccepted);
    const signalAgeMinutes = (now - latestAccepted.ts) / 60_000;
    const stale = signalAgeMinutes > COMBINED_RISK_CONFIG.staleSignalMinutes;

    return {
      checkedAt: nowIso,
      signalTs: latestAccepted.iso || new Date(latestAccepted.ts).toISOString(),
      source: "goldcat_btc_15m",
      side: stale ? "flat" : evaluated.side,
      moveBps: latestAccepted.moveBps,
      elapsedSec: latestAccepted.elapsedSec,
      bidSupportRatio: evaluated.bidSupportRatio,
      spreadBps: evaluated.spreadBps,
      accepted: evaluated.accepted && !stale,
      reason: stale
        ? `直近シグナルが古いため見送りです (${signalAgeMinutes.toFixed(1)}分経過)。`
        : evaluated.reason,
    };
  } catch (error) {
    return buildRejectedSnapshot(
      error instanceof Error ? error.message : "GoldCat BTC 15mシグナルの読取に失敗しました。",
      nowIso,
    );
  }
}
