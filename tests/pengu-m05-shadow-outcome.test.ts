import assert from "node:assert/strict";
import test from "node:test";

import {
  createPenguDualLsV2RunnerState,
  recordPenguM05ShadowExitOutcome,
  recordPenguM05ShadowTickOutcome,
} from "../lib/pengu-dual-ls-v2-runner-state";
import { PenguDualLsV2PortfolioRunner } from "../lib/pengu-dual-ls-v2-portfolio-runner";

const REF = 1_800_000_000_000;
const ENTRY = REF + 3_600_000;

function candidateState() {
  const state = createPenguDualLsV2RunnerState("LIVE");
  state.latestSignal = {
    strategyId: "PENGU_DUAL_LS_V2_FINAL",
    referenceTs: REF,
    entryTs: ENTRY,
    side: -1,
    targetGross: 1,
    reason: "SHORT candidate",
    diagnostics: {
      m05ShadowCandidateObserved: true,
      m05ShadowThreshold: -0.005,
      m05ShadowPass: false,
      m05ShadowWouldBlock: true,
      m05ShadowRoute: "SHORT_V20",
      m05ShadowPenguReturn72h: -0.004075,
    },
  } as any;
  return state;
}

test("M05 candidate records downstream Production block without changing shadow verdict", () => {
  const state = candidateState();
  assert.equal(recordPenguM05ShadowTickOutcome(state, {
    status: "held",
    message: "PENGU_FIXED1_NO_LOT_SHRINK: full1.0 allocation is unavailable.",
    signal: state.latestSignal,
  }, REF + 10_000), true);
  assert.equal(state.m05ShadowHistory?.length, 1);
  const row = state.m05ShadowHistory![0]!;
  assert.equal(row.pass, false);
  assert.equal(row.wouldBlock, true);
  assert.equal(row.productionOutcome, "BLOCKED");
  assert.match(row.downstreamBlockReason || "", /NO_LOT_SHRINK/);
});

test("M05 candidate follows actual SHORT_V20 fill and exit lifecycle", () => {
  const state = candidateState();
  state.position = {
    side: -1,
    entryTs: ENTRY,
    entryPrice: 0.0123,
    quantity: 12345,
    gross: 1,
    highWaterMark: 0.0123,
    lowWaterMark: 0.0123,
    entryVersion: "SHORT_V20",
  } as any;
  assert.equal(recordPenguM05ShadowTickOutcome(state, {
    status: "completed",
    message: "PENGU Dual LS SELL entry completed.",
    signal: state.latestSignal,
    idempotencyKey: "entry-key",
  }, ENTRY + 5000), true);
  let row = state.m05ShadowHistory![0]!;
  assert.equal(row.productionOutcome, "ENTRY_FILLED");
  assert.equal(row.entryFillPrice, 0.0123);
  assert.equal(row.entryFillQuantity, 12345);
  assert.equal(row.entryTargetGross, 1);
  assert.equal(row.entryIdempotencyKey, "entry-key");

  assert.equal(recordPenguM05ShadowExitOutcome(state, {
    entryTs: ENTRY,
    exitIdempotencyKey: "exit-key",
    exitFillObservedAt: ENTRY + 72 * 3_600_000,
    exitFillPrice: 0.011,
    exitReason: "SHORT_TRAILING_EXIT",
    realizedDirectionalReturn: 0.1056910569,
    realizedNetAccountReturn: 0.1044910569,
  }), true);
  row = state.m05ShadowHistory![0]!;
  assert.equal(row.productionOutcome, "EXITED");
  assert.equal(row.exitReason, "SHORT_TRAILING_EXIT");
  assert.equal(row.exitIdempotencyKey, "exit-key");
  assert.ok(Math.abs((row.realizedNetAccountReturn ?? 0) - 0.1044910569) < 1e-12);

  // A later no-change tick for the same candle must not downgrade a terminal trade outcome.
  assert.equal(recordPenguM05ShadowTickOutcome(state, {
    status: "no-change",
    message: "already holding",
    signal: state.latestSignal,
  }, ENTRY + 73 * 3_600_000), false);
  assert.equal(state.m05ShadowHistory![0]!.productionOutcome, "EXITED");
});

test("non-M05 signals never create shadow outcome records", () => {
  const state = createPenguDualLsV2RunnerState("LIVE");
  state.latestSignal = { strategyId: "PENGU_DUAL_LS_V2_FINAL", referenceTs: REF, side: 0, diagnostics: { m05ShadowCandidateObserved: false } } as any;
  assert.equal(recordPenguM05ShadowTickOutcome(state, { status: "no-change", message: "none", signal: state.latestSignal }, REF), false);
  assert.equal(state.m05ShadowHistory?.length, 0);
});

test("shadow outcome persistence failure cannot change the Production tick result", async () => {
  const state = candidateState();
  const expected = {
    status: "held",
    message: "Production gate result",
    signal: state.latestSignal,
    idempotencyKey: "production-key",
  } as const;
  let warnings = 0;
  let saves = 0;
  const runner = Object.create(PenguDualLsV2PortfolioRunner.prototype) as any;
  runner.dependencies = {
    stateStore: {
      load: async () => structuredClone(state),
      save: async () => {
        saves += 1;
        throw new Error("synthetic shadow persistence failure");
      },
    },
  };
  runner.now = () => REF + 20_000;
  runner.log = { warn: () => { warnings += 1; } };
  runner.tickCore = async () => expected;

  const actual = await runner.tick();
  assert.deepEqual(actual, expected);
  assert.equal(saves, 1);
  assert.equal(warnings, 1);
});
