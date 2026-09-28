import test from "node:test";
import assert from "node:assert/strict";

import { assertRecoverableHypeMarketDataState, buildRecoveredHypeMarketDataState } from "../scripts/disdex-hype-market-data-recovery";
import type { HypeZecLongRunnerState } from "../lib/hype-zec-long-runner-state";

test("HYPE benign market-data recovery clears only the exact recoverable state", () => {
  const sha = "a".repeat(40);
  const targetSha = "b".repeat(40);
  const state: HypeZecLongRunnerState = {
    schema: "disdex-hype-zec-long/v1",
    runtimeCommitSha: sha,
    mode: "LIVE",
    updatedAt: 1,
    manualReview: "HYPE_ZEC_RUNNER_FAIL_CLOSED:HYPE_ZEC_MARKET_DATA_ROW_INVALID",
    failures: [],
  };
  assert.equal(buildRecoveredHypeMarketDataState(state, targetSha, 2, sha).manualReview, undefined);
  assert.equal(buildRecoveredHypeMarketDataState(state, targetSha, 2, sha).runtimeCommitSha, targetSha);
  assert.throws(() => assertRecoverableHypeMarketDataState({ ...state, pending: { action: "ENTRY" } }, sha), /LOCAL_EXPOSURE_PRESENT/);
  assert.throws(() => assertRecoverableHypeMarketDataState({ ...state, manualReview: "HYPE_ZEC_RUNNER_FAIL_CLOSED:ASTER_AUTH_FAILURE" }, sha), /REASON_NOT_EXACT/);
});
