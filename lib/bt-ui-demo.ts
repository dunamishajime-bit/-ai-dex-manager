import type { BtPortfolioRun, BtPosition, BtEvent, BtGrossLimits, BtSnapshot } from "./bt-portfolio-replay";

type DemoOptions = { seed: number; logics: string[]; symbols: string[]; initialEquity: number; limits: BtGrossLimits };
const universe = ["BTC", "AVAX", "DOGE", "PENGU", "ETH", "HYPE", "FET", "SOL", "NEAR"];
const assetPrice: Record<string, number> = {
  BTC: 94000, AVAX: 28, DOGE: 0.16, PENGU: 0.011, ETH: 3300,
  HYPE: 35, FET: 1.45, SOL: 180, NEAR: 5.1, AMZN: 190, TSLA: 290,
};

function seeded(seed: number) {
  let v = seed >>> 0;
  return () => {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    return v / 4294967296;
  };
}

/** Synthetic playback ONLY. Never the canonical trading logic, and never submitted as real BT. */
export function createBtUiDemo(opts: DemoOptions): BtPortfolioRun {
  if (!Number.isFinite(opts.initialEquity) || opts.initialEquity <= 0) throw new Error("Initial equity must be positive");
  const random = seeded(opts.seed);
  const symbols = opts.symbols.filter((s) => assetPrice[s] != null);
  if (!symbols.length || !opts.logics.length) throw new Error("At least one logic and supported symbol required");
  const markets: Record<string, number> = {};
  for (const s of new Set(["BTC", ...symbols])) markets[s] = assetPrice[s];
  const positions = new Map<string, BtPosition>();
  let balance = opts.initialEquity, realized = 0;
  const snapshots: BtSnapshot[] = [];
  const begin = Date.UTC(2025, 9, 1);
  for (let i = 0; i < 180; i++) {
    const timestamp = new Date(begin + i * 3600000).toISOString();
    const events: BtEvent[] = [];
    for (const s of Object.keys(markets)) {
      const trend = Math.sin(i / 17 + symbols.indexOf(s)) * 0.0015;
      const shock = (random() - 0.5) * (s === "BTC" ? 0.023 : 0.037);
      markets[s] *= 1 + trend + shock;
    }
    // Deterministic scripted entries/exits demonstrate playback mechanics only.
    // This generator DOES NOT evaluate real strategy gates or claim backtest performance.
    const enter = [12, 30, 52, 76, 99, 124, 149].includes(i);
    const exit = [26, 47, 69, 90, 117, 139, 169].includes(i);
    if (exit) {
      for (const p of Array.from(positions.values())) {
        const price = markets[p.symbol];
        const sign = p.side === "LONG" ? 1 : -1;
        const pnl = sign * p.quantity * (price - p.entryPrice);
        balance += pnl;
        realized += pnl;
        events.push({
          id: "exit-" + i + "-" + p.id, timestamp, type: "EXIT", logic: p.logic,
          symbol: p.symbol, side: p.side, quantity: p.quantity, price,
          positionId: p.id, realizedPnl: pnl, reason: "UI DEMO: scripted exit, not a strategy decision",
        });
        positions.delete(p.id);
      }
    }
    if (enter && positions.size < 2) {
      const slot = [12, 30, 52, 76, 99, 124, 149].indexOf(i);
      const symbol = symbols[slot % symbols.length];
      const logic = opts.logics[slot % opts.logics.length];
      const side = slot % 3 === 1 ? "SHORT" : "LONG";
      const price = markets[symbol];
      const equityAtDecision = balance + Array.from(positions.values()).reduce((sum, p) => {
        const sign = p.side === "LONG" ? 1 : -1;
        return sum + sign * p.quantity * (markets[p.symbol] - p.entryPrice);
      }, 0);
      const existing = Array.from(positions.values()).reduce((sum, p) => sum + p.quantity * markets[p.symbol], 0);
      const cap = Math.max(0, Math.min(opts.limits.totalX, symbol === "AMZN" || symbol === "TSLA" ? opts.limits.stockX : opts.limits.cryptoX) * equityAtDecision - existing);
      const targetNotional = Math.max(0, Math.min(equityAtDecision * (slot % 2 ? 0.4 : 0.65), cap));
      if (targetNotional > 0 && equityAtDecision > 0) {
        const p: BtPosition = {
          id: "demo-" + slot, symbol, logic, side,
          assetClass: symbol === "AMZN" || symbol === "TSLA" ? "stock" : "crypto",
          quantity: targetNotional / price, entryPrice: price, markPrice: price,
          openedAt: timestamp, stopPrice: side === "LONG" ? price * 0.96 : price * 1.04,
          takeProfitPrice: side === "LONG" ? price * 1.06 : price * 0.94,
        };
        positions.set(p.id, p);
        events.push({
          id: "entry-" + i, timestamp, type: "ENTRY", positionId: p.id,
          logic, symbol, side, price, quantity: p.quantity, reason: "UI DEMO: scripted entry, not a strategy decision",
        });
      }
    }
    const marked = Array.from(positions.values()).map((p) => {
      const sign = p.side === "LONG" ? 1 : -1;
      const markPrice = markets[p.symbol];
      return { ...p, markPrice, unrealizedPnl: sign * p.quantity * (markPrice - p.entryPrice) };
    });
    const unrealizedPnl = marked.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
    snapshots.push({
      timestamp, balance, equity: balance + unrealizedPnl,
      realizedPnl: realized, unrealizedPnl, btcPrice: markets.BTC,
      positions: marked, events,
    });
  }
  return {
    schemaVersion: "disdex.bt.portfolio.v1",
    runId: "ui-demo-" + opts.seed,
    mode: "UI_DEMO",
    currency: "USD", engineSha: "UI_DEMO_NO_CANONICAL_ENGINE",
    logicPins: Object.fromEntries(opts.logics.map((k) => [k, "UI_DEMO_ONLY"])),
    seed: opts.seed, marketDataHash: null, limits: opts.limits, snapshots,
  };
}
