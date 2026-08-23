import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveV12DecisionSnapshotPath, sanitizeV12DecisionSnapshot, writeV12DecisionSnapshot } from "@/lib/v12-decision-snapshot-writer";

async function main() {
    const root = await mkdtemp(join(tmpdir(), "v12-decision-snapshot-"));
    try {
        const path = join(root, "decision-snapshot.json");
        const input = {
            strategyId: "spoofed",
            selected: { symbol: "linkusdt", side: "LONG", rank: 1, score: 2.5, momentum: 0.03, volumeRatio: 1.4, requestedGross: 0.5 },
            regime: "SHORT",
            btcRegime: "SHORT",
            candidates: [
                { symbol: "LINKUSDT", side: "LONG", rank: 1, score: 2.5, momentum: 0.03, volumeRatio: 1.4, privateKey: "must-not-survive" },
                { symbol: "ETHUSDT", side: "SHORT", rank: 2, score: -1.2, momentum: -0.02, volumeRatio: 0.8 },
            ],
        };
        const sanitized = sanitizeV12DecisionSnapshot(input, () => Date.parse("2026-08-23T00:00:00Z"));
        assert.equal(sanitized.strategyId, "V12_X1.00_ALL");
        assert.equal(sanitized.symbol, "LINKUSDT");
        assert.equal(sanitized.btcRegime, "SHORT");
        assert.equal((sanitized.candidates[0] as Record<string, unknown>).privateKey, undefined);
        assert.equal(resolveV12DecisionSnapshotPath({ V12_DECISION_SNAPSHOT_PATH: path }), path);
        assert.throws(() => resolveV12DecisionSnapshotPath({ V12_DECISION_SNAPSHOT_PATH: "relative.json" }), /MUST_BE_ABSOLUTE/);
        await writeV12DecisionSnapshot(input, { env: { V12_DECISION_SNAPSHOT_PATH: path }, now: () => Date.parse("2026-08-23T00:00:00Z") });
        const persisted = JSON.parse(await readFile(path, "utf8"));
        assert.equal(persisted.strategyId, "V12_X1.00_ALL");
        assert.equal(persisted.candidates.length, 2);
        console.log("V12_DECISION_SNAPSHOT_SELFTEST_PASS", JSON.stringify({ exchangeCalls: 0, ordersSent: 0 }));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
