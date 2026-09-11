import { AsterV3Client } from "../lib/aster-v3-client";

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function arg(name: string) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
        readOnlyRateLimitMaxRetries: 0,
        userAgent: "DisDex-ReadOnly-Account-Diagnostic/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("ASTER_READONLY_DIAGNOSTIC_CREDENTIALS_MISSING");
    const [clock, balances, positionRows, openOrders] = await Promise.all([
        client.getServerTime(),
        client.getBalances(),
        client.getPositions(),
        client.getOpenOrders(),
    ]);
    const pendingSymbol = String(arg("--pending-symbol") || "").toUpperCase();
    const pendingClientOrderId = String(arg("--pending-client-order-id") || "");
    let pendingOrder: unknown;
    if (pendingSymbol && pendingClientOrderId) {
        try {
            const row = await client.getOrder(pendingSymbol, pendingClientOrderId);
            pendingOrder = {
                symbol: row.symbol,
                clientOrderId: row.clientOrderId,
                status: row.status,
                side: row.side,
                origQty: row.origQty,
                executedQty: row.executedQty,
                avgPrice: row.avgPrice,
            };
        } catch (error) {
            pendingOrder = { notFoundOrUnavailable: true, message: error instanceof Error ? error.message : String(error) };
        }
    }
    console.log(JSON.stringify({
        status: "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
        observedAt: Date.now(),
        venueTime: clock.serverTime,
        usdtBalance: balances.filter((row) => String(row.asset).toUpperCase() === "USDT").map((row) => ({
            balance: Number(row.balance ?? row.crossWalletBalance),
            availableBalance: Number(row.availableBalance),
        })),
        positions: positionRows.filter((row) => Math.abs(Number(row.positionAmt)) > 1e-12).map((row) => ({
            symbol: row.symbol,
            positionAmt: Number(row.positionAmt),
            positionSide: row.positionSide,
            entryPrice: Number(row.entryPrice),
            markPrice: Number(row.markPrice),
        })),
        openOrders: openOrders.map((row) => ({
            symbol: row.symbol,
            clientOrderId: row.clientOrderId,
            status: row.status,
            side: row.side,
            type: row.type,
            reduceOnly: row.reduceOnly,
            origQty: row.origQty,
            executedQty: row.executedQty,
        })),
        pendingOrder,
        ordersSent: 0,
        cancelsSent: 0,
        positionChangesSent: 0,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_FAIL_CLOSED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: 0,
        cancelsSent: 0,
        positionChangesSent: 0,
    }));
    process.exitCode = 1;
});
