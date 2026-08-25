import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AsterV3Client } from "@/lib/aster-v3-client";
import { refreshSharedCryptoDailyRisk } from "@/lib/disdex-shared-crypto-risk-writer";

function client(input: { unrealized?: number; income?: Array<{ symbol?: string; incomeType: string; income: string; asset: string; time: number }> }) {
    return {
        getBalances: async () => [{ asset: "USDT", balance: "1000" }],
        getPositions: async () => [
            { symbol: "BTCUSDT", positionAmt: "1", entryPrice: "100", markPrice: "100", unRealizedProfit: String(input.unrealized || 0), positionSide: "BOTH" },
            { symbol: "METAUSDT", positionAmt: "1", entryPrice: "100", markPrice: "100", unRealizedProfit: "-900", positionSide: "BOTH" },
        ],
        getIncomeHistory: async () => input.income || [],
    } as unknown as AsterV3Client;
}

async function main() {
    const root = await mkdtemp(join(tmpdir(), "disdex-shared-risk-"));
    try {
        const path = join(root, "risk.json");
        const day1 = Date.parse("2026-08-17T12:00:00Z");
        const tripped = await refreshSharedCryptoDailyRisk({ client: client({ unrealized: -60 }), path, now: day1, maximumLossPct: 5 });
        assert.equal(tripped.tripped, true);
        assert.equal(tripped.lossPct, 6);
        assert.equal(tripped.unrealizedPnl, -60, "stock unrealized PnL must not enter the crypto gate");

        const recovered = await refreshSharedCryptoDailyRisk({ client: client({ unrealized: 25 }), path, now: day1 + 60_000, maximumLossPct: 5 });
        assert.equal(recovered.lossPct, 0);
        assert.equal(recovered.tripped, true, "same-day recovery must never auto-clear a tripped daily-loss gate");

        const day2 = Date.parse("2026-08-18T00:01:00Z");
        const reset = await refreshSharedCryptoDailyRisk({ client: client({ unrealized: 0 }), path, now: day2, maximumLossPct: 5 });
        assert.equal(reset.tripped, false, "UTC-day rollover may create a fresh daily-loss gate");

        const filterPath = join(root, "filter.json");
        const filtered = await refreshSharedCryptoDailyRisk({
            client: client({
                unrealized: 0,
                income: [
                    { symbol: "METAUSDT", incomeType: "REALIZED_PNL", income: "-500", asset: "USDT", time: day1 },
                    { symbol: "LINKUSDT", incomeType: "REALIZED_PNL", income: "-10", asset: "USDT", time: day1 },
                    { symbol: "PENGUUSDT", incomeType: "COMMISSION", income: "-1", asset: "USDT", time: day1 },
                    { symbol: "NEARUSDT", incomeType: "FUNDING_FEE", income: "2", asset: "USDT", time: day1 },
                ],
            }),
            path: filterPath,
            now: day1,
            maximumLossPct: 5,
        });
        assert.equal(filtered.realizedPnl, -10);
        assert.equal(filtered.fees, -1);
        assert.equal(filtered.funding, 2);
        assert.equal(filtered.netDailyPnl, -9);

        const malformedPath = join(root, "malformed.json");
        await writeFile(malformedPath, "{not-json\n", "utf8");
        await assert.rejects(
            refreshSharedCryptoDailyRisk({ client: client({ unrealized: 0 }), path: malformedPath, now: day1, maximumLossPct: 5 }),
            /SHARED_CRYPTO_RISK_PRIOR_STATE_MALFORMED/,
        );
        assert.equal(await readFile(malformedPath, "utf8"), "{not-json\n", "malformed sticky state must not be overwritten automatically");

        console.log("DISDEX_SHARED_CRYPTO_RISK_SELFTEST_PASS");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
