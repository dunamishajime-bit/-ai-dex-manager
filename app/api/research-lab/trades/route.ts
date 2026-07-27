import { NextResponse } from "next/server";

import { AsterV3Client, type AsterUserTrade } from "@/lib/aster-v3-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRYPTO_SYMBOLS = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "PENGUUSDT",
]);
const SYMBOLS = [
  ...CRYPTO_SYMBOLS,
  "AMZNUSDT",
  "METAUSDT",
  "MSFTUSDT",
  "NVDAUSDT",
  "TSLAUSDT",
] as const;

type Strategy = "V96" | "V11" | "V50" | "UNKNOWN";
type Direction = "LONG" | "SHORT" | "UNKNOWN";
type Lifecycle = "ENTRY" | "EXIT" | "UNKNOWN";

type NormalizedTrade = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  strategy: Strategy;
  direction: Direction;
  lifecycle: Lifecycle;
  positionSide: string;
  reduceOnly: boolean;
  clientOrderId?: string;
  orderId?: string | number;
  executedAt: string;
  quantity: number;
  price: number;
  notionalUsd: number;
  realizedPnlUsd: number;
  commissionUsd: number;
  settled: boolean;
};

type OpenLot = {
  tradeId: string;
  quantity: number;
  price: number;
  executedAt: string;
  commissionUsd: number;
  clientOrderId?: string;
};

type SettledPair = {
  id: string;
  strategy: Strategy;
  symbol: string;
  direction: Exclude<Direction, "UNKNOWN">;
  entryTradeId: string;
  exitTradeId: string;
  entryClientOrderId?: string;
  exitClientOrderId?: string;
  quantity: number;
  entryAt: string;
  exitAt: string;
  holdingMs: number;
  entryPrice: number;
  exitPrice: number;
  grossPnlUsd: number;
  commissionUsd: number;
  netPnlUsd: number;
  settled: true;
};

const n = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

function sideOf(row: AsterUserTrade): "BUY" | "SELL" {
  return row.side === "SELL" || row.buyer === false ? "SELL" : "BUY";
}

function strategyOf(symbol: string, clientOrderId: string): Strategy {
  const value = clientOrderId.toLowerCase();
  if (value.includes("v50")) return "V50";
  if (value.includes("v11")) return "V11";
  if (CRYPTO_SYMBOLS.has(symbol)) return "V96";
  return "UNKNOWN";
}

function lifecycleOf(
  row: AsterUserTrade,
  clientOrderId: string,
): Lifecycle {
  const value = clientOrderId.toLowerCase();
  if (
    Boolean(row.reduceOnly) ||
    value.includes("close") ||
    value.includes("flat") ||
    value.includes("taker") ||
    value.includes("reduce")
  ) {
    return "EXIT";
  }
  if (value.includes("open") || value.includes("entry")) {
    return "ENTRY";
  }
  return "UNKNOWN";
}

function directionOf(
  side: "BUY" | "SELL",
  lifecycle: Lifecycle,
  positionSide: string,
): Direction {
  if (lifecycle === "ENTRY") return side === "BUY" ? "LONG" : "SHORT";
  if (lifecycle === "EXIT") return side === "SELL" ? "LONG" : "SHORT";
  const normalized = positionSide.toUpperCase();
  if (normalized === "LONG" || normalized === "SHORT") return normalized;
  return "UNKNOWN";
}

function normalize(row: AsterUserTrade): NormalizedTrade {
  const symbol = String(row.symbol || "").toUpperCase();
  const quantity = n(row.qty);
  const price = n(row.price);
  const side = sideOf(row);
  const clientOrderId = String(
    row.clientOrderId || row.origClientOrderId || "",
  );
  const lifecycle = lifecycleOf(row, clientOrderId);
  const positionSide = String(row.positionSide || "BOTH").toUpperCase();
  const direction = directionOf(side, lifecycle, positionSide);
  const strategy = strategyOf(symbol, clientOrderId);
  return {
    id: `aster-${symbol}-${row.id ?? row.orderId ?? `${row.time}-${side}-${quantity}`}`,
    symbol,
    side,
    strategy,
    direction,
    lifecycle,
    positionSide,
    reduceOnly: lifecycle === "EXIT",
    clientOrderId: clientOrderId || undefined,
    orderId: row.orderId,
    executedAt: new Date(n(row.time) || Date.now()).toISOString(),
    quantity,
    price,
    notionalUsd: n(row.quoteQty) || quantity * price,
    realizedPnlUsd: n(row.realizedPnl),
    commissionUsd: n(row.commission),
    settled: false,
  };
}

function pairTrades(trades: NormalizedTrade[]) {
  const queues = new Map<string, OpenLot[]>();
  const pairs: SettledPair[] = [];
  const settledTradeIds = new Set<string>();

  for (const trade of [...trades].sort(
    (a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt),
  )) {
    if (
      trade.strategy === "UNKNOWN" ||
      trade.direction === "UNKNOWN" ||
      trade.lifecycle === "UNKNOWN"
    ) {
      continue;
    }

    const key = `${trade.symbol}:${trade.strategy}:${trade.direction}`;
    const queue = queues.get(key) || [];

    if (trade.lifecycle === "ENTRY") {
      queue.push({
        tradeId: trade.id,
        quantity: trade.quantity,
        price: trade.price,
        executedAt: trade.executedAt,
        commissionUsd: trade.commissionUsd,
        clientOrderId: trade.clientOrderId,
      });
      queues.set(key, queue);
      continue;
    }

    let remaining = trade.quantity;
    let pairIndex = 0;

    while (remaining > 1e-10 && queue.length > 0) {
      const lot = queue[0];
      const quantity = Math.min(remaining, lot.quantity);
      const entryCommission =
        lot.quantity > 0
          ? lot.commissionUsd * (quantity / lot.quantity)
          : 0;
      const exitCommission =
        trade.quantity > 0
          ? trade.commissionUsd * (quantity / trade.quantity)
          : 0;
      const grossPnlUsd =
        trade.direction === "LONG"
          ? (trade.price - lot.price) * quantity
          : (lot.price - trade.price) * quantity;
      const commissionUsd = entryCommission + exitCommission;
      pairs.push({
        id: `${trade.id}:${pairIndex}`,
        strategy: trade.strategy,
        symbol: trade.symbol,
        direction: trade.direction,
        entryTradeId: lot.tradeId,
        exitTradeId: trade.id,
        entryClientOrderId: lot.clientOrderId,
        exitClientOrderId: trade.clientOrderId,
        quantity,
        entryAt: lot.executedAt,
        exitAt: trade.executedAt,
        holdingMs:
          Date.parse(trade.executedAt) - Date.parse(lot.executedAt),
        entryPrice: lot.price,
        exitPrice: trade.price,
        grossPnlUsd,
        commissionUsd,
        netPnlUsd: grossPnlUsd - commissionUsd,
        settled: true,
      });
      pairIndex += 1;
      settledTradeIds.add(lot.tradeId);
      settledTradeIds.add(trade.id);

      lot.quantity -= quantity;
      lot.commissionUsd = Math.max(
        0,
        lot.commissionUsd - entryCommission,
      );
      remaining -= quantity;
      if (lot.quantity <= 1e-10) queue.shift();
    }

    if (queue.length > 0) queues.set(key, queue);
    else queues.delete(key);
  }

  return {
    pairs,
    settledTradeIds,
    openLots: [...queues.entries()].flatMap(([key, lots]) =>
      lots.map((lot) => ({ key, ...lot })),
    ),
  };
}

function review(
  trade: NormalizedTrade,
  settled: boolean,
  pair?: SettledPair,
) {
  if (!settled) {
    return {
      kind: "neutral",
      title: "建玉照合待ち",
      conclusion:
        "この約定は反対約定またはrunner監査ログとの照合が完了していません。",
      nextAction:
        "実建玉、reduce-only注文、clientOrderIdを照合してからレビューを確定します。",
    };
  }
  const netPnl =
    pair?.netPnlUsd ?? trade.realizedPnlUsd - trade.commissionUsd;
  if (netPnl > 0) {
    return {
      kind: "positive",
      title: "利益確定後レビュー",
      conclusion:
        "決済済みで手数料控除後の利益が発生しました。",
      nextAction:
        "Entry品質、maker成功率、保有継続条件を再現性の観点で比較します。",
    };
  }
  if (netPnl < 0) {
    return {
      kind: "negative",
      title: "損失決済後レビュー",
      conclusion:
        "決済済みで手数料控除後の損失が発生しました。",
      nextAction:
        "Entry時のNet Edge、約定遅延、Exit理由を検証します。",
    };
  }
  return {
    kind: "neutral",
    title: "決済済み（損益0）レビュー",
    conclusion:
      "決済済みですが手数料控除後の損益はほぼ0でした。",
    nextAction:
      "Spread、commission、taker fallbackの影響を確認します。",
  };
}

export async function GET() {
  try {
    const client = new AsterV3Client({
      baseUrl: process.env.ASTER_FUTURES_BASE_URL,
      userAddress: process.env.ASTER_USER_ADDRESS,
      privateKey: process.env.ASTER_API_PRIVATE_KEY as
        | `0x${string}`
        | undefined,
      userAgent: "DisDex-Research-Trade-Review/2.0",
    });
    const [rows, positions] = client.hasTradingCredentials()
      ? await Promise.all([
          Promise.all(
            SYMBOLS.map(async (symbol) => {
              try {
                return await client.getUserTrades(symbol, 100);
              } catch {
                return [];
              }
            }),
          ).then((items) => items.flat()),
          client.getPositions().catch(() => []),
        ])
      : [[], []];

    const uniqueTrades = rows
      .map(normalize)
      .filter((trade) => trade.symbol && trade.quantity > 0)
      .filter(
        (trade, index, all) =>
          all.findIndex((candidate) => candidate.id === trade.id) === index,
      )
      .sort(
        (a, b) =>
          Date.parse(b.executedAt) - Date.parse(a.executedAt),
      );
    const paired = pairTrades(uniqueTrades);
    const pairByExit = new Map(
      paired.pairs.map((pair) => [pair.exitTradeId, pair]),
    );
    const accountFlat = positions.every(
      (position) => Math.abs(n(position.positionAmt)) < 1e-12,
    );

    return NextResponse.json(
      {
        ok: true,
        source:
          "Aster authenticated userTrades with direction-aware FIFO pairing",
        fetchedAt: new Date().toISOString(),
        symbols: SYMBOLS,
        accountFlat,
        trades: uniqueTrades.map((trade) => ({
          ...trade,
          settled: paired.settledTradeIds.has(trade.id),
        })),
        pairs: paired.pairs,
        openLots: paired.openLots,
        reviews: uniqueTrades.map((trade) => {
          const pair = pairByExit.get(trade.id);
          const settled = paired.settledTradeIds.has(trade.id);
          return {
            tradeId: trade.id,
            strategy: trade.strategy,
            direction: trade.direction,
            ...review(trade, settled, pair),
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({
      ok: false,
      trades: [],
      pairs: [],
      reviews: [],
      error:
        error instanceof Error
          ? error.message
          : "Aster trade history unavailable",
    });
  }
}
