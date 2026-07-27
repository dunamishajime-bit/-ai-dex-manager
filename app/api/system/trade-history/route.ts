import { NextResponse } from "next/server";

import { AsterV3Client, type AsterUserTrade } from "@/lib/aster-v3-client";
import {
  loadTradeHistoryEntries,
  type TradeHistoryEntry,
} from "@/lib/server/trade-history-db";

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

const n = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

function metadata(row: AsterUserTrade) {
  const symbol = String(row.symbol || "").toUpperCase();
  const clientOrderId = String(
    row.clientOrderId || row.origClientOrderId || "",
  );
  const client = clientOrderId.toLowerCase();
  const side =
    row.side === "SELL" || row.buyer === false ? "SELL" : "BUY";
  const strategy = client.includes("v50")
    ? "V50"
    : client.includes("v11")
      ? "V11"
      : CRYPTO_SYMBOLS.has(symbol)
        ? "V96"
        : "UNKNOWN";
  const lifecycle =
    Boolean(row.reduceOnly) ||
    client.includes("close") ||
    client.includes("flat") ||
    client.includes("taker") ||
    client.includes("reduce")
      ? "EXIT"
      : client.includes("open") || client.includes("entry")
        ? "ENTRY"
        : "UNKNOWN";
  const direction =
    lifecycle === "ENTRY"
      ? side === "BUY"
        ? "LONG"
        : "SHORT"
      : lifecycle === "EXIT"
        ? side === "SELL"
          ? "LONG"
          : "SHORT"
        : row.positionSide === "LONG" || row.positionSide === "SHORT"
          ? row.positionSide
          : "UNKNOWN";
  return {
    symbol,
    clientOrderId,
    side,
    strategy,
    lifecycle,
    direction,
  } as const;
}

async function loadAsterEntries(): Promise<TradeHistoryEntry[]> {
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as
      | `0x${string}`
      | undefined,
    userAgent: "DisDex-Trade-History/2.0",
  });
  if (!client.hasTradingCredentials()) return [];

  const rows = (
    await Promise.all(
      SYMBOLS.map(async (symbol) => {
        try {
          return await client.getUserTrades(symbol, 100);
        } catch {
          return [];
        }
      }),
    )
  ).flat();

  return rows
    .map((row) => {
      const meta = metadata(row);
      const baseSymbol = meta.symbol.endsWith("USDT")
        ? meta.symbol.slice(0, -4)
        : meta.symbol;
      const quantity = n(row.qty);
      const price = n(row.price);
      const quote = n(row.quoteQty) || quantity * price;
      const executedAt = new Date(n(row.time) || Date.now()).toISOString();
      const isEntry = meta.lifecycle === "ENTRY";
      const isExit = meta.lifecycle === "EXIT";
      return {
        id: `aster-${meta.symbol}-${row.id ?? row.orderId ?? `${row.time}-${meta.side}-${quantity}`}`,
        executedAt,
        walletId: "aster-perpetual",
        walletAddress: process.env.ASTER_USER_ADDRESS || "Aster account",
        chainId: 0,
        txHash: `aster-order-${row.orderId ?? row.id ?? row.time}`,
        provider: "AsterDex",
        action: meta.side,
        sourceSymbol: meta.side === "BUY" ? "USDT" : baseSymbol,
        destSymbol: meta.side === "BUY" ? baseSymbol : "USDT",
        sourceAmount: meta.side === "BUY" ? quote : quantity,
        destAmount: meta.side === "BUY" ? quantity : quote,
        sourceUsdValue: quote,
        destUsdValue: quote,
        entryPriceUsd: isEntry && quantity > 0 ? price : undefined,
        exitPriceUsd: isExit && quantity > 0 ? price : undefined,
        realizedPnlUsd: n(row.realizedPnl),
        reason: [
          "Aster authenticated userTrades",
          `strategy=${meta.strategy}`,
          `direction=${meta.direction}`,
          `lifecycle=${meta.lifecycle}`,
          `positionSide=${row.positionSide || "BOTH"}`,
          `reduceOnly=${Boolean(row.reduceOnly)}`,
          `clientOrderId=${meta.clientOrderId || "missing"}`,
        ].join(" "),
        openedAt: isEntry ? executedAt : undefined,
        closedAt: isExit ? executedAt : undefined,
      } satisfies TradeHistoryEntry;
    })
    .filter((entry) => entry.sourceAmount > 0 || entry.destAmount > 0);
}

export async function GET() {
  const [ledger, aster] = await Promise.all([
    loadTradeHistoryEntries(),
    loadAsterEntries().catch(() => []),
  ]);
  const entries = [...aster, ...ledger]
    .filter(
      (entry, index, all) =>
        all.findIndex((candidate) => candidate.id === entry.id) === index,
    )
    .sort(
      (a, b) =>
        Date.parse(b.executedAt) - Date.parse(a.executedAt),
    );
  return NextResponse.json(
    {
      ok: true,
      entries,
      sources: { aster: aster.length, ledger: ledger.length },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
