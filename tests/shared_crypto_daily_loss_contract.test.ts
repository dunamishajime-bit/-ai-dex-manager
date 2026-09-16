import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { resolvePenguDualLsV2Runtime } from "@/config/penguDualLsV2Runtime";

const FORMAL_SHARED_DAILY_LOSS_PCT = 7.5;

test("PENGU resolves the formal 7.5% shared daily-loss contract", () => {
    assert.equal(resolvePenguDualLsV2Runtime({}).maximumDailyLossPct, FORMAL_SHARED_DAILY_LOSS_PCT);
    assert.equal(
        resolvePenguDualLsV2Runtime({ PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT: "7.5" }).maximumDailyLossPct,
        FORMAL_SHARED_DAILY_LOSS_PCT,
    );
});

test("shared-risk writer and Q102 consume the canonical formal contract", async () => {
    const writer = await readFile("scripts/disdex-shared-crypto-risk-writer.ts", "utf8");
    const q102 = await readFile("scripts/disdex-quality102-causal-v1-live-runner.ts", "utf8");
    assert.match(writer, /resolveSharedCryptoDailyLossPct/);
    assert.match(q102, /resolveSharedCryptoDailyLossPct/);
});

test("current-runtime wiring injects one 7.5% contract into every crypto sleeve", async () => {
    const wiring = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
    assert.match(wiring, /DISDEX_SHARED_CRYPTO_MAX_DAILY_LOSS_PCT=7\.5/);
    assert.match(wiring, /PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT=7\.5/);
    assert.match(wiring, /QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT=7\.5/);
});

test("tracked environment examples expose 7.5% rather than stale 5%", async () => {
    const q102Env = await readFile("ops/env/disdex-quality102-causal-v1.env.example", "utf8");
    assert.match(q102Env, /QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT=7\.5/);
    assert.doesNotMatch(q102Env, /QUALITY102_CAUSAL_V1_MAX_DAILY_LOSS_PCT=5(?:\.0)?\b/);
});

test("stale per-runner 5% overrides fail closed instead of silently changing the formal contract", () => {
    assert.throws(
        () => resolvePenguDualLsV2Runtime({ PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT: "5" }),
        /SHARED_CRYPTO_DAILY_LOSS_CONTRACT_MISMATCH/,
    );
});

test("TS runtime surfaces consume the canonical shared-risk resolver", async () => {
    for (const file of [
        "config/penguDualLsV2Runtime.ts",
        "scripts/disdex-quality102-causal-v1-live-runner.ts",
        "scripts/disdex-shared-crypto-risk-writer.ts",
        "lib/disdex-shared-crypto-risk-writer.ts",
    ]) {
        const source = await readFile(file, "utf8");
        assert.match(source, /resolveSharedCryptoDailyLossPct|SHARED_CRYPTO_DAILY_LOSS_PCT/, file);
    }
});

test("legacy production launch surfaces cannot re-inject a stale 5% PENGU cap", async () => {
    for (const file of [
        "ops/systemd/disdex-v96-v52-approval@.service",
        "ops/systemd/disdex-v96-v52-live.service",
        "ops/systemd/disdex-v96-v52-preflight@.service",
        "scripts/disdex-v13d-v11eq-v96-live-runner.ts",
        "scripts/ops/disdex-v96-v52-live-policy.sh",
    ]) {
        const source = await readFile(file, "utf8");
        assert.doesNotMatch(source, /PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT(?:=|:\s*)["']?5(?:\.0)?\b/, file);
        assert.match(source, /PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT(?:=|:\s*)["']?7\.5\b/, file);
    }
});
