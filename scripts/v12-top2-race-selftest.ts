import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAccountOrderLock } from "@/lib/disdex-account-order-lock";
import { planUnifiedPortfolio, type ActivePortfolioPosition, type PortfolioIntent } from "@/lib/disdex-unified-portfolio-routing";

/**
 * Offline race test for the shared account lock and residual planner.
 * Each contender re-reads the in-memory portfolio snapshot only while holding
 * the same durable lock, then records its accepted exposure. No exchange
 * adapter, credentials, or live order surface is used.
 */
const contenders: Array<{ owner: string; intent: PortfolioIntent }> = [
    { owner: "V52:P2:stock-a", intent: { sleeve: "V11_EQ", symbol: "METAUSDT", side: "LONG", gross: 1, notionalUsd: 1000, signalTs: 1 } },
    { owner: "V52:P2:stock-b", intent: { sleeve: "V11_EQ", symbol: "TSLAUSDT", side: "LONG", gross: 1, notionalUsd: 1000, signalTs: 1 } },
    { owner: "PENGU_DUAL_LS_V2:P3:pengu", intent: { sleeve: "PENGU_DUAL_LS_V2", symbol: "PENGUUSDT", side: "LONG", gross: 0.75, notionalUsd: 750, signalTs: 1 } },
    { owner: "V12_X1.00_ALL:P4:rank1", intent: { sleeve: "V12", symbol: "ETHUSDT", side: "LONG", gross: 1, notionalUsd: 1000, signalTs: 1 } },
    { owner: "V12_X1.00_ALL:P4:rank2", intent: { sleeve: "V12", symbol: "SOLUSDT", side: "LONG", gross: 1, notionalUsd: 1000, signalTs: 1 } },
    { owner: "V12_X1.00_ALL:P4:rank3", intent: { sleeve: "V12", symbol: "LINKUSDT", side: "LONG", gross: 1, notionalUsd: 1000, signalTs: 1 } },
];

async function acquireWithRetry(lock: FileAccountOrderLock, owner: string) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const handle = await lock.acquire(owner);
        if (handle) return handle;
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error(`RACE_LOCK_ACQUIRE_TIMEOUT:${owner}`);
}

async function runContender(row: (typeof contenders)[number], lockPath: string, accepted: ActivePortfolioPosition[]) {
    const lock = new FileAccountOrderLock(lockPath, 5_000);
    const handle = await acquireWithRetry(lock, row.owner);
    try {
        const plan = planUnifiedPortfolio([row.intent], accepted);
        const planned = plan.accepted[0];
        if (!planned) return;
        await handle.reserve({
            strategyId: row.intent.sleeve,
            symbol: planned.symbol,
            side: planned.side,
            gross: planned.gross,
            notionalUsd: planned.notionalUsd,
        });
        // This mutation is protected by the durable lock in every contender.
        accepted.push({ sleeve: planned.sleeve, symbol: planned.symbol, gross: planned.gross });
    } finally {
        await handle.release();
    }
}

async function main() {
    const root = await mkdtemp(join(tmpdir(), "disdex-v12-top2-race-"));
    const lockPath = join(root, "account-order.lock");
    const accepted: ActivePortfolioPosition[] = [];
    try {
        await Promise.all(contenders.map((row) => runContender(row, lockPath, accepted)));
        const cryptoGross = accepted.filter((row) => row.sleeve === "V12" || row.sleeve === "PENGU_DUAL_LS_V2").reduce((sum, row) => sum + row.gross, 0);
        const stockGross = accepted.filter((row) => row.sleeve === "V11_EQ" || row.sleeve === "V50_POST_OPEN_BASIS").reduce((sum, row) => sum + row.gross, 0);
        const v12 = accepted.filter((row) => row.sleeve === "V12");
        assert.ok(stockGross <= 1.5 + 1e-9, `stock cap exceeded: ${stockGross}`);
        assert.ok(cryptoGross <= 1.5 + 1e-9, `crypto cap exceeded: ${cryptoGross}`);
        assert.ok(cryptoGross + stockGross <= 2.5 + 1e-9, `portfolio cap exceeded: ${cryptoGross + stockGross}`);
        assert.ok(v12.length <= 2, `V12 position count exceeded: ${v12.length}`);
        assert.equal(accepted.length, 4);
        console.log("V12_TOP2_RACE_SELFTEST_PASS", JSON.stringify({ accepted, cryptoGross, stockGross }));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

void main();
