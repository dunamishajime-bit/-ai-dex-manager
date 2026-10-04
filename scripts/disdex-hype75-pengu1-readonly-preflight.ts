import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";

async function main() {
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: 15000,
    userAgent: "DisDex-HYPE75-PENGU1-readonly-preflight",
  });
  if (!client.hasTradingCredentials()) throw new Error("READONLY_CREDENTIALS_MISSING");
  const account = await new AsterDirectTradeExecutor(client).getAccountSnapshot();
  const positions = (await client.getPositions()).filter(p => Math.abs(Number(p.positionAmt)) > 1e-12)
    .map(p => ({symbol: p.symbol, quantity: Number(p.positionAmt), entryPrice: Number(p.entryPrice), markPrice: Number(p.markPrice), leverage: Number(p.leverage), marginType: p.marginType}));
  const orders = (await client.getOpenOrders()).map(o => ({symbol: o.symbol, orderId: o.orderId, clientOrderId: o.clientOrderId, type: o.type, side: o.side, reduceOnly: o.reduceOnly, closePosition: o.closePosition, quantity: o.origQty}));
  console.log(JSON.stringify({status: "PASS", observedAt: Date.now(), account, positions, orders, hypeFlat: !positions.some(p => p.symbol === "HYPEUSDT") && !orders.some(o => o.symbol === "HYPEUSDT"), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0}));
}
main().catch(error => { console.error(JSON.stringify({status: "FAIL", reason: error instanceof Error ? error.message : "READONLY_PREFLIGHT_FAILED"})); process.exitCode = 1; });
