import { DISDEX_STABLE4_OPPORTUNITY } from "../config/disdexStable4Opportunity";
import { classifyAsterSymbol, type AsterAssetClass } from "./disdex-aster-portfolio-classifier";
import { normalizePendingExposureRegistry, type PendingExposureRegistry } from "./disdex-pending-exposure-registry";
import { QUALITY102_CAUSAL_V4_S34_MODEL } from "../config/disdexQuality102CausalV4Model";

// Admission asset classification only: generic strategy eligibility intentionally stays unchanged.
const STABLE4_APPROVED_QHV_SYMBOLS = new Set(["SUIUSDT", "SEIUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "ENAUSDT", "ONDOUSDT", "FILUSDT", "TRXUSDT", ...QUALITY102_CAUSAL_V4_S34_MODEL.map(row=>row.symbol)]);
function classifyStable4AdmissionSymbol(symbol: string): Pick<ReturnType<typeof classifyAsterSymbol>, "assetClass"> {
  const generic = classifyAsterSymbol(symbol);
  return generic.assetClass === "UNKNOWN" && STABLE4_APPROVED_QHV_SYMBOLS.has(symbol.toUpperCase()) ? { assetClass: "CRYPTO" } : generic;
}

export interface Stable4EntryGrossInput {
  now: number;
  maxAgeMs?: number;
  /** Caller supplies a complete, signed venue account/position snapshot. */
  account: { equityUsd: number; observedAt: number };
  positions: readonly { symbol: string; quantity: number; markPrice: number; observedAt: number }[];
  /** Caller must hold the shared admission lock through reservation/order submission. */
  pending: PendingExposureRegistry;
  candidate: { symbol: string; notionalUsd: number; side?: "LONG" | "SHORT"; ownReservationId?: string };
  classifySymbol?: (symbol: string) => Pick<ReturnType<typeof classifyAsterSymbol>, "assetClass">;
}
export type Stable4EntryGrossAdmissionCode =
  | "INVALID_INPUT" | "INVALID_ACCOUNT" | "INVALID_POSITION" | "INVALID_CANDIDATE" | "INVALID_REGISTRY"
  | "STALE_ACCOUNT" | "STALE_POSITION" | "STALE_REGISTRY" | "STALE_PENDING" | "UNKNOWN_SYMBOL"
  | "OWN_RESERVATION_CONFLICT" | "CRYPTO_CAP_EXCEEDED" | "STOCK_CAP_EXCEEDED" | "TOTAL_CAP_EXCEEDED";
export interface Stable4EntryGrossTotals {
  cryptoNotionalUsd: number; stockNotionalUsd: number; totalNotionalUsd: number;
  cryptoGross: number; stockGross: number; totalGross: number;
}
export interface Stable4EntryGrossAdmission {
  equityUsd: number;
  positions: Stable4EntryGrossTotals;
  pending: Stable4EntryGrossTotals;
  before: Stable4EntryGrossTotals;
  after: Stable4EntryGrossTotals;
  excludedOwnReservationId?: string;
}
export class Stable4EntryGrossAdmissionError extends Error {
  readonly name = "Stable4EntryGrossAdmissionError";
  constructor(readonly code: Stable4EntryGrossAdmissionCode, detail?: string, readonly diagnostics?: Stable4EntryGrossAdmission) {
    super(`STABLE4_ENTRY_GROSS_${code}${detail ? `:${detail}` : ""}`);
  }
}
function fail(code: Stable4EntryGrossAdmissionCode, detail?: string): never { throw new Stable4EntryGrossAdmissionError(code, detail); }
function numeric(value: unknown, positive = false): value is number {
  return typeof value === "number" && Number.isFinite(value) && (positive ? value > 0 : value >= 0);
}
function identity(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value === value.trim(); }
function totals(crypto: number, stock: number, equity: number): Stable4EntryGrossTotals {
  const total = crypto + stock;
  if (![crypto, stock, total, crypto / equity, stock / equity, total / equity].every(Number.isFinite)) fail("INVALID_INPUT", "gross arithmetic overflow");
  return { cryptoNotionalUsd: crypto, stockNotionalUsd: stock, totalNotionalUsd: total, cryptoGross: crypto / equity, stockGross: stock / equity, totalGross: total / equity };
}

/** Pure final new-entry admission. Never reduces a position or mutates the snapshot. */
export function assertStable4EntryGrossAdmission(input: Stable4EntryGrossInput): Stable4EntryGrossAdmission {
  if (!input || !numeric(input.now, true) || !numeric(input.maxAgeMs ?? 120_000)) fail("INVALID_INPUT");
  const { now } = input;
  const maxAgeMs = input.maxAgeMs ?? 120_000;
  function fresh(at: unknown, code: Stable4EntryGrossAdmissionCode) {
    if (!numeric(at, true) || at > now || now - at > maxAgeMs) fail(code);
  }
  if (!input.account || !numeric(input.account.equityUsd, true)) fail("INVALID_ACCOUNT");
  fresh(input.account.observedAt, "STALE_ACCOUNT");
  const equity = input.account.equityUsd;
  const candidate = input.candidate;
  if (!candidate || !identity(candidate.symbol) || !numeric(candidate.notionalUsd)
    || (candidate.side !== undefined && candidate.side !== "LONG" && candidate.side !== "SHORT")) fail("INVALID_CANDIDATE");
  const classify = input.classifySymbol ?? classifyStable4AdmissionSymbol;
  function assetClass(symbol: string): Exclude<AsterAssetClass, "UNKNOWN"> {
    if (!identity(symbol)) fail("UNKNOWN_SYMBOL");
    let result: ReturnType<typeof classify>;
    try { result = classify(symbol); } catch { return fail("UNKNOWN_SYMBOL", symbol); }
    if (!result || (result.assetClass !== "CRYPTO" && result.assetClass !== "STOCK")) fail("UNKNOWN_SYMBOL", symbol);
    return result.assetClass;
  }
  const candidateClass = assetClass(candidate.symbol);
  let positionCrypto = 0, positionStock = 0;
  if (!Array.isArray(input.positions)) fail("INVALID_POSITION");
  for (const position of input.positions) {
    if (!position || typeof position.quantity !== "number" || !Number.isFinite(position.quantity) || !numeric(position.markPrice, true)) fail("INVALID_POSITION");
    fresh(position.observedAt, "STALE_POSITION");
    const classification = assetClass(position.symbol);
    const notional = Math.abs(position.quantity) * position.markPrice;
    if (!numeric(notional)) fail("INVALID_POSITION");
    if (classification === "CRYPTO") positionCrypto += notional; else positionStock += notional;
  }
  const raw = input.pending;
  if (!raw || !Array.isArray(raw.entries) || !identity(raw.accountScope)) fail("INVALID_REGISTRY");
  for (const entry of raw.entries) {
    if (!entry || !identity(entry.reservationId) || !identity(entry.strategyId) || !identity(entry.symbol)
      || !numeric(entry.gross) || !numeric(entry.notionalUsd) || !numeric(entry.createdAt, true) || !numeric(entry.updatedAt, true)) fail("INVALID_REGISTRY");
  }
  let registry: PendingExposureRegistry;
  try { registry = normalizePendingExposureRegistry(raw); } catch { return fail("INVALID_REGISTRY"); }
  fresh(raw.updatedAt, "STALE_REGISTRY");
  const ownId = candidate.ownReservationId;
  if (ownId !== undefined && (!identity(ownId) || !candidate.side)) fail("OWN_RESERVATION_CONFLICT");
  let ownFound = false, pendingCrypto = 0, pendingStock = 0;
  for (const entry of registry.entries) {
    const active = entry.status !== "RELEASED";
    const classification = assetClass(entry.symbol);
    if (classification !== entry.sleeve || entry.createdAt > entry.updatedAt || entry.createdAt > now) fail("INVALID_REGISTRY");
    if (active) fresh(entry.updatedAt, "STALE_PENDING");
    if (entry.reservationId === ownId) {
      if (!active || entry.symbol !== candidate.symbol.toUpperCase() || entry.side !== candidate.side) fail("OWN_RESERVATION_CONFLICT");
      ownFound = true;
      continue;
    }
    if (!active) continue;
    if (classification === "CRYPTO") pendingCrypto += entry.notionalUsd; else pendingStock += entry.notionalUsd;
  }
  if (ownId !== undefined && !ownFound) fail("OWN_RESERVATION_CONFLICT");
  const beforeCrypto = positionCrypto + pendingCrypto, beforeStock = positionStock + pendingStock;
  const result: Stable4EntryGrossAdmission = {
    equityUsd: equity,
    positions: totals(positionCrypto, positionStock, equity), pending: totals(pendingCrypto, pendingStock, equity),
    before: totals(beforeCrypto, beforeStock, equity),
    after: totals(beforeCrypto + (candidateClass === "CRYPTO" ? candidate.notionalUsd : 0), beforeStock + (candidateClass === "STOCK" ? candidate.notionalUsd : 0), equity),
    ...(ownId !== undefined ? { excludedOwnReservationId: ownId } : {}),
  };
  const caps = DISDEX_STABLE4_OPPORTUNITY.productionRisk;
  for (const [actual, cap, code] of [
    [result.after.cryptoNotionalUsd, caps.cryptoGrossCap, "CRYPTO_CAP_EXCEEDED"],
    [result.after.stockNotionalUsd, caps.stockGrossCap, "STOCK_CAP_EXCEEDED"],
    [result.after.totalNotionalUsd, caps.totalGrossCap, "TOTAL_CAP_EXCEEDED"],
  ] as const) {
    const limitUsd = cap * equity;
    if (!Number.isFinite(limitUsd)) fail("INVALID_ACCOUNT", "cap arithmetic overflow");
    if (actual - limitUsd > Math.max(1e-8, Math.abs(limitUsd) * 1e-12)) throw new Stable4EntryGrossAdmissionError(code, undefined, result);
  }
  return result;
}
