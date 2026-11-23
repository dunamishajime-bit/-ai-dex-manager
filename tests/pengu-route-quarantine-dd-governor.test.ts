import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
    PENGU_REALIZED_DD_HOLD_HOURS,
    PENGU_REALIZED_DD_THRESHOLD,
    PENGU_ROUTE_QUARANTINE_HOURS,
    createPenguRiskOverlayState,
    evaluatePenguNewEntryGate,
    recordPenguClosedTrade,
    recordPenguHardStop,
    type PenguRiskOverlayState,
} from "../lib/pengu-route-quarantine-dd-governor";

const HOUR = 3_600_000;

test("hard stop quarantines only the same route for 60 hours", () => {
    const state = createPenguRiskOverlayState();
    const exitTs = Date.parse("2026-09-25T00:00:00Z");

    const next = recordPenguHardStop(state, "RECOVERY_V8", exitTs);

    assert.equal(next.routeQuarantineUntilTs.RECOVERY_V8, exitTs + PENGU_ROUTE_QUARANTINE_HOURS * HOUR);
    assert.equal(evaluatePenguNewEntryGate(next, "RECOVERY_V8", exitTs + 1).allowed, false);
    assert.equal(evaluatePenguNewEntryGate(next, "SHORT_V20", exitTs + 1).allowed, true);
    assert.equal(evaluatePenguNewEntryGate(next, "RECOVERY_V8", exitTs + PENGU_ROUTE_QUARANTINE_HOURS * HOUR).allowed, true);
});

test("realized DD governor uses only closed filled trades and holds new entries for 72 hours", () => {
    let state = createPenguRiskOverlayState();
    const start = Date.parse("2026-09-25T00:00:00Z");

    state = recordPenguClosedTrade(state, "SHORT_V20", 0.10, start);
    state = recordPenguClosedTrade(state, "SHORT_V20", -0.18, start + HOUR);

    assert.ok(Math.abs(state.realizedEquity - 1.1 * 0.82) < 1e-12);
    assert.equal(state.realizedPeak, 1.1);
    assert.ok(Math.abs(state.realizedDrawdown - ((1.1 * 0.82) / 1.1 - 1)) < 1e-12);
    assert.equal(state.globalEntryHoldUntilTs, start + HOUR + PENGU_REALIZED_DD_HOLD_HOURS * HOUR);
    assert.equal(evaluatePenguNewEntryGate(state, "BASE_V64_LONG", start + 2 * HOUR).allowed, false);
    assert.equal(evaluatePenguNewEntryGate(state, "SHORT_V20", start + 2 * HOUR).allowed, false);
    assert.equal(evaluatePenguNewEntryGate(state, "SHORT_V20", state.globalEntryHoldUntilTs).allowed, true);
    assert.equal(PENGU_REALIZED_DD_THRESHOLD, 0.17);
});

test("unfilled or rejected intents do not change realized equity", () => {
    const state = createPenguRiskOverlayState();
    const next = recordPenguClosedTrade(state, "SHORT_V20", Number.NaN, Date.now());
    assert.deepEqual(next, state);
});

test("malformed persisted overlay fails closed instead of allowing a new entry", () => {
    const malformed = {
        ...createPenguRiskOverlayState(),
        realizedEquity: Number.NaN,
    } as unknown as PenguRiskOverlayState;

    const decision = evaluatePenguNewEntryGate(malformed, "SHORT_V20", Date.now());
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "PENGU_RISK_OVERLAY_INVALID");
});

test("live runner consults the durable overlay before planning a new entry", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = await readFile(resolve(here, "../lib/pengu-dual-ls-v2-portfolio-runner.ts"), "utf8");
    assert.match(source, /evaluatePenguNewEntryGate/);
    assert.match(source, /recordPenguClosedTrade/);
    assert.match(source, /recordPenguHardStop/);
    assert.match(source, /routeForPenguEntryVersion/);
});
