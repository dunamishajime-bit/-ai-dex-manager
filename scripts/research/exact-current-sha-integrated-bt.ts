import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateExactBtManifest, type ExactBtStrategyId, type ValidatedBtManifest } from "./exact-current-sha-bt-contract.ts";

const HOUR = 60 * 60 * 1000;
const MONTHS = ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

export type ExactBtCandidateEvent = {
  kind: "ENTRY";
  runtimeSha: string;
  timestamp: number;
  priority: number;
  sequence: number;
  strategyId: ExactBtStrategyId;
  candidateId: string;
  symbol: string;
  assetClass: "CRYPTO" | "STOCK";
  side: "LONG" | "SHORT";
  requestedGross: number;
  entryPrice: number;
  exitTimestamp: number;
  exitPrice: number;
  exitReason: string;
  fundingPnlJpy?: number;
  fillRatio?: number;
  entrySlippagePnlJpy?: number;
  exitSlippagePnlJpy?: number;
};

export type ExactBtMarketEvent = {
  kind: "MARK";
  runtimeSha: string;
  timestamp: number;
  priority: number;
  sequence: number;
  markPrices: Record<string, number>;
};

type Position = {
  positionId: string;
  candidate: ExactBtCandidateEvent;
  acceptedGross: number;
  notionalJpy: number;
  quantity: number;
  entryFeeJpy: number;
  entrySlippageJpy: number;
};

export type BtDecision = {
  timestamp: number;
  sequence: number;
  strategyId: ExactBtStrategyId;
  candidateId: string;
  symbol: string;
  requestedGross: number;
  acceptedGross: number;
  decision: "ACCEPTED" | "REJECTED";
  reason: string;
  reservedGross: number;
  activeCryptoGrossBefore: number;
  activeTotalGrossBefore: number;
  activeCryptoGrossAfter: number;
  activeTotalGrossAfter: number;
};

export type BtTrade = {
  positionId: string;
  candidateId: string;
  strategyId: ExactBtStrategyId;
  symbol: string;
  side: "LONG" | "SHORT";
  entryTs: number;
  actualExitTs: number;
  entryPrice: number;
  exitPrice: number;
  acceptedGross: number;
  notionalEntryJpy: number;
  entryFeeJpy: number;
  exitFeeJpy: number;
  fundingPnlJpy: number;
  slippagePnlJpy: number;
  netPnlJpy: number;
  exitReason: string;
  walletAfterExitJpy: number;
};

export type IntegratedBtResult = {
  schema: "disdex/exact-current-sha-integrated-bt/v1";
  runtimeSha: string;
  period: ValidatedBtManifest["period"];
  capital: ValidatedBtManifest["capital"];
  trades: BtTrade[];
  decisions: BtDecision[];
  events: Array<Record<string, unknown>>;
  monthlyEquityJpy: Record<string, number>;
  strategyAttribution: Record<string, { trades: number; netPnlJpy: number }>;
  grossTimeline: Array<{ timestamp: number; cryptoGross: number; totalGross: number }>;
  maxCryptoGross: number;
  maxTotalGross: number;
  reconciliation: {
    status: "PASS" | "FAIL";
    initialJpy: number;
    depositsJpy: number;
    finalWalletJpy: number;
    finalEquityJpy: number;
    netTradePnlJpy: number;
    tradeCount: number;
    decisionCount: number;
    missingMonthlyKeys: string[];
  };
  mutation: { ordersSent: 0; cancelsSent: 0; positionChangesSent: 0 };
  resultHash: string;
};

function fail(code: string, detail?: string): never {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail("EXACT_BT_NUMBER_INVALID", field);
  return value;
}

function readJsonl<T>(filePath: string): T[] {
  return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) as T; } catch (error) { fail("EXACT_BT_JSONL_INVALID", `${filePath}:${index + 1}:${String(error)}`); }
  });
}

function validateCandidate(raw: unknown, manifest: ValidatedBtManifest): ExactBtCandidateEvent {
  if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== "ENTRY") fail("EXACT_BT_ENTRY_KIND_INVALID");
  const event = raw as Partial<ExactBtCandidateEvent>;
  if (event.runtimeSha !== manifest.runtimeSha) fail("EXACT_BT_EVENT_RUNTIME_SHA_MISMATCH", String(event.runtimeSha));
  if (!manifest.strategyIds.includes(event.strategyId as ExactBtStrategyId)) fail("EXACT_BT_EVENT_STRATEGY_INVALID", String(event.strategyId));
  const timestamp = finiteNumber(event.timestamp, "timestamp");
  const exitTimestamp = finiteNumber(event.exitTimestamp, "exitTimestamp");
  if (!Number.isInteger(timestamp) || !Number.isInteger(exitTimestamp) || exitTimestamp <= timestamp) fail("EXACT_BT_EXIT_ORDER_INVALID", String(event.candidateId));
  const start = Date.parse(manifest.period.startInclusive);
  const end = Date.parse(manifest.period.endExclusive);
  if (timestamp < start || timestamp >= end || exitTimestamp >= end) fail("EXACT_BT_EVENT_OUTSIDE_PERIOD", String(event.candidateId));
  if (!event.candidateId || !event.symbol || !event.exitReason) fail("EXACT_BT_EVENT_IDENTITY_MISSING");
  if (event.assetClass !== "CRYPTO" && event.assetClass !== "STOCK") fail("EXACT_BT_ASSET_CLASS_INVALID", String(event.candidateId));
  if (event.side !== "LONG" && event.side !== "SHORT") fail("EXACT_BT_SIDE_INVALID", String(event.candidateId));
  const requestedGross = finiteNumber(event.requestedGross, "requestedGross");
  const entryPrice = finiteNumber(event.entryPrice, "entryPrice");
  const exitPrice = finiteNumber(event.exitPrice, "exitPrice");
  if (requestedGross <= 0 || entryPrice <= 0 || exitPrice <= 0) fail("EXACT_BT_ENTRY_VALUE_INVALID", String(event.candidateId));
  const fillRatio = event.fillRatio === undefined ? 1 : finiteNumber(event.fillRatio, "fillRatio");
  if (fillRatio <= 0 || fillRatio > 1) fail("EXACT_BT_FILL_RATIO_INVALID", String(event.candidateId));
  return {
    kind: "ENTRY", runtimeSha: manifest.runtimeSha, timestamp, priority: finiteNumber(event.priority, "priority"), sequence: finiteNumber(event.sequence, "sequence"),
    strategyId: event.strategyId as ExactBtStrategyId, candidateId: String(event.candidateId), symbol: String(event.symbol).toUpperCase(),
    assetClass: event.assetClass, side: event.side, requestedGross, entryPrice, exitTimestamp, exitPrice, exitReason: String(event.exitReason),
    fundingPnlJpy: event.fundingPnlJpy === undefined ? 0 : finiteNumber(event.fundingPnlJpy, "fundingPnlJpy"), fillRatio,
    entrySlippagePnlJpy: event.entrySlippagePnlJpy === undefined ? 0 : finiteNumber(event.entrySlippagePnlJpy, "entrySlippagePnlJpy"),
    exitSlippagePnlJpy: event.exitSlippagePnlJpy === undefined ? 0 : finiteNumber(event.exitSlippagePnlJpy, "exitSlippagePnlJpy"),
  };
}

function validateMarket(raw: unknown, manifest: ValidatedBtManifest): ExactBtMarketEvent {
  if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== "MARK") fail("EXACT_BT_MARK_KIND_INVALID");
  const event = raw as Partial<ExactBtMarketEvent>;
  if (event.runtimeSha !== manifest.runtimeSha) fail("EXACT_BT_MARK_RUNTIME_SHA_MISMATCH", String(event.runtimeSha));
  const timestamp = finiteNumber(event.timestamp, "timestamp");
  if (!Number.isInteger(timestamp)) fail("EXACT_BT_MARK_TIMESTAMP_INVALID");
  const start = Date.parse(manifest.period.startInclusive);
  const end = Date.parse(manifest.period.endExclusive);
  if (timestamp < start || timestamp >= end) fail("EXACT_BT_MARK_OUTSIDE_PERIOD", String(timestamp));
  if (!event.markPrices || typeof event.markPrices !== "object") fail("EXACT_BT_MARK_PRICES_MISSING");
  const markPrices: Record<string, number> = {};
  for (const [symbol, value] of Object.entries(event.markPrices)) markPrices[symbol.toUpperCase()] = finiteNumber(value, `markPrices.${symbol}`);
  return { kind: "MARK", runtimeSha: manifest.runtimeSha, timestamp, priority: finiteNumber(event.priority, "priority"), sequence: finiteNumber(event.sequence, "sequence"), markPrices };
}

function monthKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 7);
}

export function runExactIntegratedBt(manifest: ValidatedBtManifest): IntegratedBtResult {
  const sourceFiles = [...manifest.sourceFiles].sort();
  const marketFiles = [...manifest.marketFiles].sort();
  const rawCandidates = sourceFiles.flatMap((file) => readJsonl<unknown>(file));
  const rawMarkets = marketFiles.flatMap((file) => readJsonl<unknown>(file));
  const candidates = rawCandidates.map((row) => validateCandidate(row, manifest));
  const markets = rawMarkets.map((row) => validateMarket(row, manifest));
  const seenCandidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (seenCandidateIds.has(candidate.candidateId)) fail("EXACT_BT_DUPLICATE_CANDIDATE_ID", candidate.candidateId);
    seenCandidateIds.add(candidate.candidateId);
  }
  const allEvents = [...candidates, ...markets].sort((a, b) => a.timestamp - b.timestamp || a.priority - b.priority || a.sequence - b.sequence || (a.kind === "MARK" ? -1 : 1));
  const active: Position[] = [];
  const cooldownUntilBySymbol = new Map<string, number>();
  const lastMarks = new Map<string, number>();
  const trades: BtTrade[] = [];
  const decisions: BtDecision[] = [];
  const events: Array<Record<string, unknown>> = [];
  const grossTimeline: Array<{ timestamp: number; cryptoGross: number; totalGross: number }> = [];
  const monthlyEquityJpy: Record<string, number> = {};
  const strategyAttribution: Record<string, { trades: number; netPnlJpy: number }> = Object.fromEntries(manifest.strategyIds.map((id) => [id, { trades: 0, netPnlJpy: 0 }]));
  let walletJpy = manifest.capital.initialJpy;
  let maxCryptoGross = 0;
  let maxTotalGross = 0;
  let positionSerial = 0;

  const currentGross = () => ({
    crypto: active.filter((p) => p.candidate.assetClass === "CRYPTO").reduce((sum, p) => sum + p.acceptedGross, 0),
    total: active.reduce((sum, p) => sum + p.acceptedGross, 0),
  });
  const markEquity = () => {
    let equity = walletJpy;
    for (const position of active) {
      const mark = lastMarks.get(position.candidate.symbol) ?? position.candidate.entryPrice;
      const sign = position.candidate.side === "LONG" ? 1 : -1;
      equity += (mark - position.candidate.entryPrice) * position.quantity * sign;
    }
    return equity;
  };
  const recordGross = (timestamp: number) => {
    const gross = currentGross();
    grossTimeline.push({ timestamp, cryptoGross: gross.crypto, totalGross: gross.total });
    maxCryptoGross = Math.max(maxCryptoGross, gross.crypto);
    maxTotalGross = Math.max(maxTotalGross, gross.total);
  };
  const closeDue = (timestamp: number) => {
    const due = active.filter((position) => position.candidate.exitTimestamp <= timestamp).sort((a, b) => a.candidate.exitTimestamp - b.candidate.exitTimestamp || a.positionId.localeCompare(b.positionId));
    for (const position of due) {
      const candidate = position.candidate;
      const exitNotional = position.quantity * candidate.exitPrice;
      const exitFeeJpy = exitNotional * manifest.execution.feeBpsPerSide / 10_000;
      const funding = candidate.fundingPnlJpy ?? 0;
      const slippage = (position.entrySlippageJpy + (candidate.exitSlippagePnlJpy ?? 0));
      const sign = candidate.side === "LONG" ? 1 : -1;
      const pricePnl = (candidate.exitPrice - candidate.entryPrice) * position.quantity * sign;
      const netPnl = pricePnl + funding - position.entryFeeJpy - exitFeeJpy - slippage;
      walletJpy += pricePnl + funding - exitFeeJpy - (candidate.exitSlippagePnlJpy ?? 0);
      const index = active.indexOf(position);
      if (index >= 0) active.splice(index, 1);
      cooldownUntilBySymbol.set(candidate.symbol, candidate.exitTimestamp + manifest.risk.sameSymbolCooldownHours * HOUR);
      const trade: BtTrade = {
        positionId: position.positionId, candidateId: candidate.candidateId, strategyId: candidate.strategyId, symbol: candidate.symbol, side: candidate.side,
        entryTs: candidate.timestamp, actualExitTs: candidate.exitTimestamp, entryPrice: candidate.entryPrice, exitPrice: candidate.exitPrice,
        acceptedGross: position.acceptedGross, notionalEntryJpy: position.notionalJpy, entryFeeJpy: position.entryFeeJpy, exitFeeJpy,
        fundingPnlJpy: funding, slippagePnlJpy: slippage, netPnlJpy: netPnl, exitReason: candidate.exitReason, walletAfterExitJpy: walletJpy,
      };
      trades.push(trade);
      strategyAttribution[candidate.strategyId].trades += 1;
      strategyAttribution[candidate.strategyId].netPnlJpy += netPnl;
      events.push({ kind: "EXIT", timestamp: candidate.exitTimestamp, positionId: position.positionId, candidateId: candidate.candidateId, symbol: candidate.symbol, strategyId: candidate.strategyId, exitReason: candidate.exitReason, actualExitTs: candidate.exitTimestamp, netPnlJpy: netPnl });
    }
  };

  for (const event of allEvents) {
    closeDue(event.timestamp);
    if (event.kind === "MARK") {
      for (const [symbol, price] of Object.entries(event.markPrices)) lastMarks.set(symbol, price);
      const equity = markEquity();
      monthlyEquityJpy[monthKey(event.timestamp)] = equity;
      events.push({ kind: "MARK", timestamp: event.timestamp, equityJpy: equity });
      recordGross(event.timestamp);
      continue;
    }
    const current = currentGross();
    const cooldownUntil = cooldownUntilBySymbol.get(event.symbol) ?? 0;
    let reason = "ACCEPTED";
    if (active.some((position) => position.candidate.symbol === event.symbol)) reason = "SAME_SYMBOL_ACTIVE";
    else if (event.timestamp < cooldownUntil) reason = "SYMBOL_COOLDOWN";
    else if ((event.assetClass === "CRYPTO" && current.crypto + event.requestedGross > manifest.risk.cryptoGrossCap + 1e-12) || current.total + event.requestedGross > manifest.risk.totalGrossCap + 1e-12) {
      reason = event.assetClass === "CRYPTO" && current.crypto + event.requestedGross > manifest.risk.cryptoGrossCap + 1e-12 ? "CRYPTO_GROSS_CAP" : "TOTAL_GROSS_CAP";
    }
    if (reason !== "ACCEPTED") {
      decisions.push({ timestamp: event.timestamp, sequence: event.sequence, strategyId: event.strategyId, candidateId: event.candidateId, symbol: event.symbol, requestedGross: event.requestedGross, acceptedGross: 0, decision: "REJECTED", reason, reservedGross: 0, activeCryptoGrossBefore: current.crypto, activeTotalGrossBefore: current.total, activeCryptoGrossAfter: current.crypto, activeTotalGrossAfter: current.total });
      events.push({ kind: "DECISION", timestamp: event.timestamp, candidateId: event.candidateId, decision: "REJECTED", reason });
      recordGross(event.timestamp);
      continue;
    }
    const equity = markEquity();
    const acceptedGross = event.requestedGross * (event.fillRatio ?? 1);
    const notionalJpy = equity * acceptedGross;
    const entryFeeJpy = notionalJpy * manifest.execution.feeBpsPerSide / 10_000;
    const entrySlippageJpy = event.entrySlippagePnlJpy ?? 0;
    walletJpy -= entryFeeJpy + entrySlippageJpy;
    const position: Position = { positionId: `P${++positionSerial}`, candidate: event, acceptedGross, notionalJpy, quantity: notionalJpy / event.entryPrice, entryFeeJpy, entrySlippageJpy };
    active.push(position);
    const after = currentGross();
    decisions.push({ timestamp: event.timestamp, sequence: event.sequence, strategyId: event.strategyId, candidateId: event.candidateId, symbol: event.symbol, requestedGross: event.requestedGross, acceptedGross, decision: "ACCEPTED", reason: "ACCEPTED", reservedGross: event.requestedGross, activeCryptoGrossBefore: current.crypto, activeTotalGrossBefore: current.total, activeCryptoGrossAfter: after.crypto, activeTotalGrossAfter: after.total });
    events.push({ kind: "ENTRY", timestamp: event.timestamp, candidateId: event.candidateId, positionId: position.positionId, strategyId: event.strategyId, symbol: event.symbol, acceptedGross });
    recordGross(event.timestamp);
  }
  closeDue(Date.parse(manifest.period.endExclusive));
  if (active.length > 0) fail("EXACT_BT_OPEN_POSITION_AT_END", active.map((position) => position.positionId).join(","));
  if (monthlyEquityJpy[monthKey(Date.parse(manifest.period.endExclusive) - 1)] === undefined) monthlyEquityJpy[monthKey(Date.parse(manifest.period.endExclusive) - 1)] = walletJpy;
  const missingMonthlyKeys = MONTHS.filter((month) => monthlyEquityJpy[month] === undefined);
  const finalEquityJpy = walletJpy;
  const netTradePnlJpy = trades.reduce((sum, trade) => sum + trade.netPnlJpy, 0);
  const reconciliation = { status: missingMonthlyKeys.length === 0 ? "PASS" as const : "FAIL" as const, initialJpy: manifest.capital.initialJpy, depositsJpy: 0, finalWalletJpy: walletJpy, finalEquityJpy, netTradePnlJpy, tradeCount: trades.length, decisionCount: decisions.length, missingMonthlyKeys };
  const resultWithoutHash = { schema: "disdex/exact-current-sha-integrated-bt/v1" as const, runtimeSha: manifest.runtimeSha, period: manifest.period, capital: manifest.capital, trades, decisions, events, monthlyEquityJpy, strategyAttribution, grossTimeline, maxCryptoGross, maxTotalGross, reconciliation, mutation: { ordersSent: 0 as const, cancelsSent: 0 as const, positionChangesSent: 0 as const } };
  return { ...resultWithoutHash, resultHash: stableHash(resultWithoutHash) };
}

export { validateExactBtManifest };
