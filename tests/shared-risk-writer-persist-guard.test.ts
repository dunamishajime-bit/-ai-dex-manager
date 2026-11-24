import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { refreshSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-risk-writer";
import type { AsterV3Client } from "../lib/aster-v3-client";

test("revoked SHA pin before persistence cannot publish risk state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shared-risk-persist-"));
    const target = path.join(dir, "crypto-daily-risk.json");
    const client = {
        getBalances: async () => [{ asset: "USDT", balance: "1000" }],
        getPositions: async () => [],
        getIncomeHistory: async () => [],
    } as unknown as AsterV3Client;
    let checks = 0;
    try {
        await assert.rejects(
            refreshSharedCryptoDailyRisk({
                client,
                path: target,
                now: Date.UTC(2026, 10, 24, 0),
                maximumLossPct: 7.5,
                assertWriterPinned: async () => {
                    checks += 1;
                    throw new Error("SHARED_RISK_WRITER_NOT_PINNED");
                },
            }),
            /SHARED_RISK_WRITER_NOT_PINNED/,
        );
        assert.equal(checks, 1, "guard must execute directly before risk write");
        await assert.rejects(stat(target), { code: "ENOENT" });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
