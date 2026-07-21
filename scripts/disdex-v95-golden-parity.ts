import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    runDisDexV95CoreController,
    type DisDexV95CoreFrame,
} from "../lib/disdex-v95-core-controller";

interface GoldenPayload {
    schemaVersion: number;
    strategyId: string;
    source: string;
    frames: DisDexV95CoreFrame[];
    expected: ReturnType<typeof runDisDexV95CoreController>;
    artifactSha256: string;
}

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function assertDeepClose(actual: unknown, expected: unknown, path = "root") {
    if (typeof actual === "number" && typeof expected === "number") {
        assert.ok(Number.isFinite(actual) && Number.isFinite(expected), `${path} must be finite`);
        assert.ok(Math.abs(actual - expected) <= 1e-11, `${path}: ${actual} != ${expected}`);
        return;
    }
    if (Array.isArray(actual) || Array.isArray(expected)) {
        assert.ok(Array.isArray(actual) && Array.isArray(expected), `${path} array mismatch`);
        assert.equal(actual.length, expected.length, `${path} length mismatch`);
        for (let index = 0; index < actual.length; index += 1) assertDeepClose(actual[index], expected[index], `${path}[${index}]`);
        return;
    }
    if (actual && expected && typeof actual === "object" && typeof expected === "object") {
        const actualObject = actual as Record<string, unknown>;
        const expectedObject = expected as Record<string, unknown>;
        assert.deepEqual(Object.keys(actualObject).sort(), Object.keys(expectedObject).sort(), `${path} keys mismatch`);
        for (const key of Object.keys(expectedObject)) assertDeepClose(actualObject[key], expectedObject[key], `${path}.${key}`);
        return;
    }
    assert.equal(actual, expected, `${path} mismatch`);
}

async function main() {
    const path = resolve(process.argv[2] || ".runtime-state/disdex-v95-golden.json");
    const payload = JSON.parse(await readFile(path, "utf8")) as GoldenPayload;
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.strategyId, "V35_WEIGHT_BAND_PLUS_FIXED_STRONG_V95");
    const canonical = stable({ frames: payload.frames, expected: payload.expected });
    const artifactSha256 = createHash("sha256").update(canonical).digest("hex");
    assert.equal(artifactSha256, payload.artifactSha256, "Golden artifact SHA-256 mismatch");

    const actual = runDisDexV95CoreController(payload.frames);
    assertDeepClose(actual, payload.expected);
    assert.ok(actual.rows.some((row) => row.weightBandAction === "REBALANCE"), "Forced/threshold Weight Band rebalance was not exercised");
    assert.ok(actual.rows.some((row) => row.boost === 0.30), "Strong Boost was not exercised");
    assert.ok(actual.rows.some((row) => row.whipsawActive), "Whipsaw guard was not exercised");
    assert.ok(actual.rows.some((row) => row.drawdownStage === 2), "Drawdown stage 2 was not exercised");
    assert.ok(actual.rows.every((row) => row.finalGross <= 2 + 1e-12), "Core Gross cap was exceeded");

    console.log(JSON.stringify({
        status: "V95_TYPESCRIPT_GOLDEN_VECTOR_PARITY_PASS",
        strategyId: payload.strategyId,
        frames: payload.frames.length,
        artifactSha256,
        ignoredWeightChanges: actual.diagnostics.ignoredWeightChanges,
        acceptedWeightRebalances: actual.diagnostics.acceptedWeightRebalances,
        growthBuckets: actual.diagnostics.growthBuckets,
        whipsawBuckets: actual.diagnostics.whipsawBuckets,
        drawdownStageBuckets: actual.diagnostics.drawdownStageBuckets,
    }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
