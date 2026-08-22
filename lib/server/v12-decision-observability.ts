import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { AsterDexClient, loadAsterDexClientConfig } from "@/lib/server/asterdex/client";
import { loadAsterTradeHistory } from "@/lib/server/aster-trade-history";

const V12_BASE_SYMBOLS = new Set([
  "BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR",
]);
const MAX_JSON_BYTES = 256 * 1024;

type JsonObject = Record<string, unknown>;

type PositionRisk = {
  symbol?: string;
  positionAmt?: string | number;
  entryPrice?: string | number;
  markPrice?: string | number;
  unRealizedProfit?: string | number;
  positionSide?: string;
};

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function baseSymbol(symbol: string) {
  return symbol.toUpperCase().endsWith("USDT") ? symbol.toUpperCase().slice(0, -4) : symbol.toUpperCase();
}

async function readJsonFromEnvPath(envName: "V12_X1_ALL_STATE_PATH" | "V12_DECISION_SNAPSHOT_PATH") {
  const configuredPath = String(process.env[envName] || "").trim();
  if (!configuredPath) return { configured: false as const, value: null, error: `${envName} is not configured for the UI service.` };
  if (!isAbsolute(configuredPath)) return { configured: true as const, value: null, error: `${envName} must be an absolute path.` };
  try {
    const text = await readFile(configuredPath, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
      return { configured: true as const, value: null, error: `${envName} exceeds the read-only snapshot size limit.` };
    }
    return { configured: true as const, value: JSON.parse(text) as unknown, error: undefined };
  } catch (error) {
    return {
      configured: true as const,
      value: null,
      error: error instanceof Error ? error.message : `${envName} could not be read.`,
    };
  }
}

function safeCandidate(value: unknown) {
  const row = asObject(value);
  if (!row) return null;
  return {
    symbol: typeof row.symbol === "string" ? row.symbol : undefined,
    side: typeof row.side === "string" ? row.side : undefined,
    rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : undefined,
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : undefined,
    momentum: Number.isFinite(Number(row.momentum)) ? Number(row.momentum) : undefined,
    volumeRatio: Number.isFinite(Number(row.volumeRatio)) ? Number(row.volumeRatio) : undefined,
    volatility: Number.isFinite(Number(row.volatility)) ? Number(row.volatility) : undefined,
    atr: Number.isFinite(Number(row.atr)) ? Number(row.atr) : undefined,
  };
}

function safeDecisionSnapshot(value: unknown) {
  const row = asObject(value);
  if (!row) return null;
  const candidates = Array.isArray(row.candidates)
    ? row.candidates.map(safeCandidate).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)).slice(0, 14)
    : undefined;
  return {
    strategyId: typeof row.strategyId === "string" ? row.strategyId : "V12_X1.00_ALL",
    symbol: typeof row.symbol === "string" ? row.symbol : undefined,
    side: typeof row.side === "string" ? row.side : undefined,
    regime: typeof row.regime === "string" ? row.regime : undefined,
    btcRegime: typeof row.btcRegime === "string" ? row.btcRegime : undefined,
    rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : undefined,
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : undefined,
    momentum: Number.isFinite(Number(row.momentum)) ? Number(row.momentum) : undefined,
    volumeRatio: Number.isFinite(Number(row.volumeRatio)) ? Number(row.volumeRatio) : undefined,
    volatility: Number.isFinite(Number(row.volatility)) ? Number(row.volatility) : undefined,
    atr: Number.isFinite(Number(row.atr)) ? Number(row.atr) : undefined,
    requestedGross: Number.isFinite(Number(row.requestedGross)) ? Number(row.requestedGross) : undefined,
    referenceTs: Number.isFinite(Number(row.referenceTs)) ? Number(row.referenceTs) : undefined,
    entryTs: Number.isFinite(Number(row.entryTs)) ? Number(row.entryTs) : undefined,
    selectedAt: typeof row.selectedAt === "string" || Number.isFinite(Number(row.selectedAt)) ? row.selectedAt : undefined,
    rationale: typeof row.rationale === "string" ? row.rationale : typeof row.reason === "string" ? row.reason : undefined,
    candidates,
  };
}

function safeRunnerState(value: unknown) {
  const row = asObject(value);
  if (!row) return null;
  const active = asObject(row.active);
  const pending = asObject(row.pending);
  const killSwitch = asObject(row.killSwitch);
  return {
    strategyId: typeof row.strategyId === "string" ? row.strategyId : undefined,
    mode: typeof row.mode === "string" ? row.mode : undefined,
    updatedAt: Number.isFinite(Number(row.updatedAt)) ? Number(row.updatedAt) : undefined,
    lastReferenceTs: Number.isFinite(Number(row.lastReferenceTs)) ? Number(row.lastReferenceTs) : undefined,
    manualReview: typeof row.manualReview === "string" ? row.manualReview : undefined,
    killSwitch: killSwitch ? {
      active: killSwitch.active === true,
      reason: typeof killSwitch.reason === "string" ? killSwitch.reason : undefined,
      trippedAt: Number.isFinite(Number(killSwitch.trippedAt)) ? Number(killSwitch.trippedAt) : undefined,
    } : undefined,
    active: active ? {
      symbol: typeof active.symbol === "string" ? active.symbol : undefined,
      side: typeof active.side === "string" ? active.side : undefined,
      quantity: Number.isFinite(Number(active.quantity)) ? Number(active.quantity) : undefined,
      gross: Number.isFinite(Number(active.gross)) ? Number(active.gross) : undefined,
      entryPrice: Number.isFinite(Number(active.entryPrice)) ? Number(active.entryPrice) : undefined,
      atrAtEntry: Number.isFinite(Number(active.atrAtEntry)) ? Number(active.atrAtEntry) : undefined,
      entrySignalTs: Number.isFinite(Number(active.entrySignalTs)) ? Number(active.entrySignalTs) : undefined,
      holdingBars: Number.isFinite(Number(active.holdingBars)) ? Number(active.holdingBars) : undefined,
      peakPrice: Number.isFinite(Number(active.peakPrice)) ? Number(active.peakPrice) : undefined,
      troughPrice: Number.isFinite(Number(active.troughPrice)) ? Number(active.troughPrice) : undefined,
    } : undefined,
    pending: pending ? {
      action: typeof pending.action === "string" ? pending.action : undefined,
      symbol: typeof pending.symbol === "string" ? pending.symbol : undefined,
      side: typeof pending.side === "string" ? pending.side : undefined,
      signalTs: Number.isFinite(Number(pending.signalTs)) ? Number(pending.signalTs) : undefined,
      expectedPrice: Number.isFinite(Number(pending.expectedPrice)) ? Number(pending.expectedPrice) : undefined,
      requestedGross: Number.isFinite(Number(pending.requestedGross)) ? Number(pending.requestedGross) : undefined,
      atrAtEntry: Number.isFinite(Number(pending.atrAtEntry)) ? Number(pending.atrAtEntry) : undefined,
      reason: typeof pending.reason === "string" ? pending.reason : undefined,
    } : undefined,
  };
}

export async function loadV12DecisionObservability() {
  const errors: string[] = [];
  const [runnerFile, decisionFile, history] = await Promise.all([
    readJsonFromEnvPath("V12_X1_ALL_STATE_PATH"),
    readJsonFromEnvPath("V12_DECISION_SNAPSHOT_PATH"),
    loadAsterTradeHistory(),
  ]);

  if (runnerFile.error) errors.push(`runner-state: ${runnerFile.error}`);
  if (decisionFile.error) errors.push(`decision-snapshot: ${decisionFile.error}`);
  if (history.error) errors.push(`trade-history: ${history.error}`);

  const recentFills = history.entries
    .filter((entry) => V12_BASE_SYMBOLS.has(entry.action === "BUY" ? entry.destSymbol : entry.sourceSymbol))
    .slice(0, 30)
    .map((entry) => ({
      id: entry.id,
      executedAt: entry.executedAt,
      symbol: entry.action === "BUY" ? entry.destSymbol : entry.sourceSymbol,
      action: entry.action,
      side: entry.positionSide,
      tradeStatus: entry.tradeStatus,
      positionVerified: entry.positionVerified,
      entryPriceUsd: entry.entryPriceUsd,
      exitPriceUsd: entry.exitPriceUsd,
      realizedPnlUsd: entry.realizedPnlUsd,
      commission: entry.commission,
      commissionAsset: entry.commissionAsset,
      netPnlUsd: entry.netPnlUsd,
      orderId: entry.orderId,
      tradeId: entry.tradeId,
    }));

  let positions: Array<{
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnlUsd: number;
  }> = [];

  const config = loadAsterDexClientConfig();
  if (!config) {
    errors.push("position-risk: Aster read-only configuration is unavailable.");
  } else {
    try {
      const client = new AsterDexClient(config);
      const positionRisk = await client.getPositionRisk() as PositionRisk[];
      positions = (Array.isArray(positionRisk) ? positionRisk : [])
        .map((position) => {
          const symbol = String(position.symbol || "").toUpperCase();
          const base = baseSymbol(symbol);
          const amount = finite(position.positionAmt);
          if (!V12_BASE_SYMBOLS.has(base) || Math.abs(amount) <= 0.0000001) return null;
          return {
            symbol,
            side: (String(position.positionSide || "").toUpperCase() === "SHORT" || amount < 0 ? "SHORT" : "LONG") as "LONG" | "SHORT",
            quantity: Math.abs(amount),
            entryPrice: finite(position.entryPrice),
            markPrice: finite(position.markPrice),
            unrealizedPnlUsd: finite(position.unRealizedProfit),
          };
        })
        .filter((position): position is NonNullable<typeof position> => Boolean(position));
    } catch (error) {
      errors.push(`position-risk: ${error instanceof Error ? error.message : "Aster position snapshot failed."}`);
    }
  }

  const decision = safeDecisionSnapshot(decisionFile.value);
  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    capturedAt: new Date().toISOString(),
    decisionDetailsAvailable: Boolean(decision),
    decision,
    runnerState: safeRunnerState(runnerFile.value),
    v12Positions: positions,
    recentFills,
    wiring: {
      runnerStateConfigured: runnerFile.configured,
      decisionSnapshotConfigured: decisionFile.configured,
    },
    errors,
  };
}
