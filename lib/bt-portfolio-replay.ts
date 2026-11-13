/**
 * Read-only portfolio/Gross math for BT replay. No runner, order or venue imports.
 *
 * GrossX = sum(abs(quantity) * markPrice in account currency) / equity.
 * Display total, asset-class and individual contributions separately.
 */
export type BtAssetClass = "crypto" | "stock";
export type BtSide = "LONG" | "SHORT";
export type BtMode = "REAL_BT" | "SYNTHETIC_BT" | "UI_DEMO";

export type BtPosition = {
  id: string;
  logic: string;
  symbol: string;
  assetClass: BtAssetClass;
  side: BtSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  /** Optional ledger-calculated amount, including its own conventions. */
  unrealizedPnl?: number;
  openedAt?: string;
  stopPrice?: number | null;
  takeProfitPrice?: number | null;
};

export type BtOrderReservation = {
  id: string;
  logic: string;
  symbol: string;
  assetClass: BtAssetClass;
  side: BtSide;
  /** The notional held by the canonical BT risk engine, not a fabricated order. */
  reservedNotional: number;
};

export type BtEvent = {
  id: string;
  timestamp: string;
  type: "ENTRY" | "EXIT" | "PARTIAL_EXIT" | "BLOCKED" | "MARK" | "OTHER";
  logic: string;
  symbol: string;
  side?: BtSide;
  reason?: string;
  price?: number;
  quantity?: number;
  realizedPnl?: number;
  positionId?: string;
};

export type BtSnapshot = {
  timestamp: string;
  balance: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  btcPrice?: number | null;
  positions: BtPosition[];
  reservations?: BtOrderReservation[];
  events?: BtEvent[];
};

export type BtGrossLimits = { totalX: number; cryptoX: number; stockX: number };

export type BtPortfolioRun = {
  schemaVersion: "disdex.bt.portfolio.v1";
  runId: string;
  mode: BtMode;
  currency: string;
  engineSha: string;
  logicPins: Record<string, string>;
  seed?: number | null;
  marketDataHash?: string | null;
  limits: BtGrossLimits;
  snapshots: BtSnapshot[];
};

export type GrossLine = {
  id: string;
  logic: string;
  symbol: string;
  side: BtSide;
  assetClass: BtAssetClass;
  kind: "POSITION" | "RESERVATION";
  notional: number;
  grossX: number;
  /** Share of all currently used Gross, 0–100. */
  ofUsedPercent: number;
  /** Share of configured TOTAL Gross capacity, can exceed 100 on overrun. */
  ofTotalLimitPercent: number;
};

export type BtGrossView = {
  equity: number;
  totalX: number;
  cryptoX: number;
  stockX: number;
  limits: BtGrossLimits;
  remainingTotalX: number;
  remainingCryptoX: number;
  remainingStockX: number;
  totalPercent: number;
  cryptoPercent: number;
  stockPercent: number;
  overLimit: boolean;
  lines: GrossLine[];
};

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const nonneg = (x: unknown): x is number => finite(x) && x >= 0;
const positive = (x: unknown): x is number => finite(x) && x > 0;
const percent = (used: number, cap: number) => (100 * used) / cap;

export function computeBtGross(snapshot: BtSnapshot, limits: BtGrossLimits): BtGrossView {
  if (!positive(snapshot.equity)) throw new Error("Equity must be positive: Gross cannot be calculated");
  if (!positive(limits.totalX) || !positive(limits.cryptoX) || !positive(limits.stockX)) {
    throw new Error("Gross caps must be positive and supplied by the BT run");
  }
  const raw: Omit<GrossLine, "ofUsedPercent" | "ofTotalLimitPercent">[] = [];
  const seen = new Set<string>();
  for (const p of snapshot.positions) {
    if (!p.id || seen.has("p:" + p.id)) throw new Error("Missing or duplicate position id");
    seen.add("p:" + p.id);
    if (!nonneg(p.quantity) || !positive(p.markPrice) || !positive(p.entryPrice)) {
      throw new Error("Invalid position quantity or price");
    }
    if (p.assetClass !== "crypto" && p.assetClass !== "stock") throw new Error("Unknown asset class");
    if (p.side !== "LONG" && p.side !== "SHORT") throw new Error("Unknown position side");
    const notional = p.quantity * p.markPrice;
    raw.push({
      id: p.id, logic: p.logic, symbol: p.symbol, side: p.side,
      assetClass: p.assetClass, kind: "POSITION", notional,
      grossX: notional / snapshot.equity,
    });
  }
  for (const p of snapshot.reservations ?? []) {
    if (!p.id || seen.has("r:" + p.id)) throw new Error("Missing or duplicate reservation id");
    seen.add("r:" + p.id);
    if (!nonneg(p.reservedNotional) || !["crypto", "stock"].includes(p.assetClass)) {
      throw new Error("Invalid order reservation");
    }
    if (p.side !== "LONG" && p.side !== "SHORT") throw new Error("Unknown order side");
    raw.push({
      id: p.id, logic: p.logic, symbol: p.symbol, side: p.side,
      assetClass: p.assetClass, kind: "RESERVATION", notional: p.reservedNotional,
      grossX: p.reservedNotional / snapshot.equity,
    });
  }
  const sum = (a: BtAssetClass) => raw.reduce((s, p) => s + (p.assetClass === a ? p.grossX : 0), 0);
  const cryptoX = sum("crypto");
  const stockX = sum("stock");
  const totalX = cryptoX + stockX;
  return {
    equity: snapshot.equity, totalX, cryptoX, stockX, limits,
    remainingTotalX: Math.max(0, limits.totalX - totalX),
    remainingCryptoX: Math.max(0, limits.cryptoX - cryptoX),
    remainingStockX: Math.max(0, limits.stockX - stockX),
    totalPercent: percent(totalX, limits.totalX),
    cryptoPercent: percent(cryptoX, limits.cryptoX),
    stockPercent: percent(stockX, limits.stockX),
    overLimit: totalX > limits.totalX + 1e-9 || cryptoX > limits.cryptoX + 1e-9 || stockX > limits.stockX + 1e-9,
    lines: raw.map((p) => ({
      ...p,
      ofUsedPercent: totalX ? percent(p.grossX, totalX) : 0,
      ofTotalLimitPercent: percent(p.grossX, limits.totalX),
    })),
  };
}

export function parseBtPortfolioRun(input: unknown): BtPortfolioRun {
  if (!input || typeof input !== "object") throw new Error("BT run must be an object");
  const r = input as Partial<BtPortfolioRun>;
  if (r.schemaVersion !== "disdex.bt.portfolio.v1") throw new Error("Unsupported BT schema");
  if (!r.runId || typeof r.runId !== "string" || !Array.isArray(r.snapshots) || r.snapshots.length === 0) {
    throw new Error("BT run ID and snapshots are required");
  }
  if (!["REAL_BT", "SYNTHETIC_BT", "UI_DEMO"].includes(String(r.mode))) throw new Error("Unknown BT mode");
  if (typeof r.currency !== "string" || !r.currency.trim()) throw new Error("Missing account currency");
  if (typeof r.engineSha !== "string" || !r.engineSha.trim()) throw new Error("Missing engine SHA");
  if (!r.logicPins || typeof r.logicPins !== "object" || Array.isArray(r.logicPins)) throw new Error("Missing logic pins");
  if (!r.limits) throw new Error("Missing per-run Gross limits");
  let prev = "";
  for (const s of r.snapshots) {
    if (!s || typeof s.timestamp !== "string" || Number.isNaN(Date.parse(s.timestamp)) || s.timestamp <= prev) {
      throw new Error("Snapshots must have strictly increasing ISO timestamps");
    }
    prev = s.timestamp;
    if (![s.balance, s.equity, s.realizedPnl, s.unrealizedPnl].every(finite)) throw new Error("Invalid account values");
    if (!Array.isArray(s.positions)) throw new Error("Positions are required at each snapshot");
    if (s.reservations !== undefined && !Array.isArray(s.reservations)) throw new Error("Invalid reservations");
    if (s.events !== undefined && !Array.isArray(s.events)) throw new Error("Invalid events");
    if (s.btcPrice != null && !positive(s.btcPrice)) throw new Error("Invalid BTC price");
    computeBtGross(s, r.limits);
  }
  return r as BtPortfolioRun;
}
