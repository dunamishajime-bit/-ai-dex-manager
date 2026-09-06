import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeRunnerHeartbeat } from "../lib/disdex-runner-heartbeat";

test("runner heartbeat is atomically replaced with only non-secret runtime state", async () => {
    const root = await mkdtemp(join(tmpdir(), "disdex-heartbeat-"));
    try {
        const path = join(root, "heartbeat.json");
        await writeRunnerHeartbeat(path, {
            runnerId: "PENGU_DUAL_LS_V2_FINAL",
            serviceUnit: "disdex-pengu-dual-ls-v2-v20.service",
            runtimeSha: "a".repeat(40),
            expectedSha: "a".repeat(40),
            workingDirectory: "/home/deploy/disdex-trading/releases/" + "a".repeat(40),
            mode: "LIVE",
            liveEnabled: true,
            safetyState: "HEALTHY",
            heartbeatAt: 1000,
            lastTickAt: 1000,
            status: "no-change",
            reason: "natural signal absent",
            symbols: ["PENGUUSDT"],
            grossCaps: { strategy: 0.75, crypto: 2, total: 2.5 },
        });
        const document = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        assert.equal(document.schema, "disdex-runner-heartbeat/v1");
        assert.equal(document.runtimeSha, "a".repeat(40));
        assert.equal(document.status, "no-change");
        assert.deepEqual(document.grossCaps, { strategy: 0.75, crypto: 2, total: 2.5 });
        assert.equal("privateKey" in document, false);
        assert.equal((await readdir(root)).some((name) => name.includes(".tmp")), false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
