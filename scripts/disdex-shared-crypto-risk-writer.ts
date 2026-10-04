import "dotenv/config";
import { AsterV3Client } from "../lib/aster-v3-client";
import { refreshSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-risk-writer";
import { createInterruptibleDelay } from "../lib/interruptible-delay";

function numberEnv(name: string, fallback: number) { const parsed = Number(process.env[name]); return Number.isFinite(parsed) ? parsed : fallback; }

async function main() {
    const path = process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || ".runtime-state/shared/crypto-daily-risk.json";
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-Shared-Crypto-Risk/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("SHARED_CRYPTO_RISK requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY");
    const daemon = process.argv.includes("--daemon"); const intervalMs = Math.max(15_000, numberEnv("DISDEX_SHARED_CRYPTO_RISK_REFRESH_MS", 30_000));
    const delay = createInterruptibleDelay(); let stopping = false; const stop = () => { stopping = true; delay.interrupt(); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    do {
        const state = await refreshSharedCryptoDailyRisk({ client, path, maximumLossPct: numberEnv("DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT", 7.5) });
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), component: "shared-crypto-risk", lossPct: state.lossPct, maximumLossPct: state.maximumLossPct, tripped: state.tripped, realizedPnl: state.realizedPnl, unrealizedPnl: state.unrealizedPnl, fees: state.fees, funding: state.funding }));
        if (!daemon || stopping) break; await delay.wait(intervalMs);
    } while (!stopping);
}

main().catch((error) => { console.error(JSON.stringify({ level: "fatal", component: "shared-crypto-risk", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
