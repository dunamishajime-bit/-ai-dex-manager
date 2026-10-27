import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveV4RunnerStateBlockReason } from "../lib/disdex-v4-runner-state-gate.mjs";

test("V4 blocked runner state denies new orders even when certified/live", () => {
    assert.equal(
        resolveV4RunnerStateBlockReason(
            { key: "V12_V4" },
            {
                operationMode: "CERTIFIED",
                mode: "LIVE",
                status: "blocked",
                safetyState: "BLOCKED",
                orderEnabled: false,
                reason: "V4_STALE_EXIT_REVIEW_REQUIRED:leg",
            },
        ),
        "V12_V4 runner state blocks new orders: V4_STALE_EXIT_REVIEW_REQUIRED:leg",
    );
});

test("a V4 safety block is fail-closed even when status is absent", () => {
    assert.equal(
        resolveV4RunnerStateBlockReason(
            { key: "V12_V4" },
            { safetyState: "BLOCKED" },
        ),
        "V12_V4 runner state blocks new orders: V12_V4 runner state reports blocked",
    );
});

test("observing V4 and non-V4 peers are not blocked by this scoped gate", () => {
    assert.equal(
        resolveV4RunnerStateBlockReason(
            { key: "V12_V4" },
            { status: "observing", safetyState: "HEALTHY", orderEnabled: false },
        ),
        "",
    );
    assert.equal(
        resolveV4RunnerStateBlockReason(
            { key: "V52" },
            { status: "blocked", safetyState: "BLOCKED", reason: "scoped" },
        ),
        "",
    );
});
