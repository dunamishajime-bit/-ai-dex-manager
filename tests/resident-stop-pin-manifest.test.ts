import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  q102ProofsFromIndependentEvidence,
  resolveResidentStopOwnerPins,
  v4ProofsFromIndependentEvidence,
} from "../lib/resident-stop-observation";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const NOW = 1_800_000_000_000;

function pinManifest() {
  const rows: Record<string, unknown> = {};
  const values: Array<[string, string, string]> = [
    ["V12_V4", SHA, "V4_PRIMARY"],
    ["PENGU_V8", OTHER_SHA, "PENGU_V8"],
    ["QUALITY102_CAUSAL_V1", SHA, "Q102_PRIMARY"],
    ["V52", OTHER_SHA, "V52"],
    ["FET_BRK48_RESIDUAL", OTHER_SHA, "FET_BRK48_RESIDUAL"],
    ["HYPE_TREND_LONG", OTHER_SHA, "HYPE_TREND_LONG"],
    ["IDLE_PRIORITY_SHORT", OTHER_SHA, "IDLE_PRIORITY_SHORT"],
    ["SHARED_CRYPTO_RISK", SHA, "SHARED_RISK"],
    ["MARGIN_GUARD", OTHER_SHA, "MARGIN_GUARD"],
  ];
  const prefixes: Record<string, string> = {
    V12_V4: "disdex-v12-v4",
    PENGU_V8: "disdex-pengu-dual-ls-v2",
    QUALITY102_CAUSAL_V1: "disdex-quality102-causal-v1",
    V52: "disdex-v52-aster-only",
    FET_BRK48_RESIDUAL: "disdex-fet-brk48",
    HYPE_TREND_LONG: "disdex-hype-long",
    IDLE_PRIORITY_SHORT: "disdex-idle-priority-short",
    SHARED_CRYPTO_RISK: "disdex-shared-crypto-risk",
    MARGIN_GUARD: "disdex-v12-v52-margin-guard",
  };
  for (const [runnerId, sha, stopOwner] of values) {
    rows[runnerId] = {
      sha,
      releaseRoot: `/home/deploy/disdex-trading/releases/${sha}`,
      serviceUnit: `${prefixes[runnerId]}@${sha}.service`,
      evidenceMode: "legacy",
      stopOwner,
    };
  }
  return { schema: "disdex-runner-pin-manifest/v1", target: "fixture", runners: rows };
}

test("resident STOP owner pins are projected only from a validated runner manifest", () => {
  const owners = resolveResidentStopOwnerPins(pinManifest());
  assert.deepEqual(owners, {
    V12: SHA,
    Q102: SHA,
    PENGU: OTHER_SHA,
    V52: OTHER_SHA,
    FET: OTHER_SHA,
    HYPE: OTHER_SHA,
    IDLE: OTHER_SHA,
    RESIDUAL: OTHER_SHA,
  });
  assert.throws(() => resolveResidentStopOwnerPins({ ...pinManifest(), runners: { ...pinManifest().runners, FET_BRK48_RESIDUAL: { ...(pinManifest().runners as any).FET_BRK48_RESIDUAL, stopOwner: "V4_PRIMARY" } } }), /STOP_OWNER/);
});

test("V4 owner proof follows the exact supplied SHA rather than a fixed historical SHA", () => {
  const stopId = "v12-v4-" + "a".repeat(24);
  const order = { symbol: "DOGEUSDT", type: "STOP_MARKET", side: "BUY", reduceOnly: true, status: "NEW", origQty: "2", executedQty: "0", stopPrice: "0.09", clientOrderId: stopId };
  const key = "DOGEUSDT:fixture:SHORT:1";
  const ledger = { releaseSha: OTHER_SHA, state: { legs: { [key]: { status: "OPEN", qty: 2, entryNotional: 0.2 } } }, protections: { [key]: { phase: "STOP_CONFIRMED", protectedQty: 2, stopClientOrderId: stopId } } };
  const heartbeat = { runtimeSha: OTHER_SHA, expectedSha: OTHER_SHA, serviceUnit: `disdex-v12-v4@${OTHER_SHA}.service`, mode: "LIVE", safetyState: "HEALTHY", lastTickAt: NOW };
  assert.equal(v4ProofsFromIndependentEvidence([order], ledger, heartbeat, OTHER_SHA, NOW, OTHER_SHA).length, 1);
  assert.equal(v4ProofsFromIndependentEvidence([order], ledger, heartbeat, OTHER_SHA, NOW, SHA).length, 0);
});

test("Q102 owner proof follows the exact supplied SHA rather than a fixed historical SHA", () => {
  const stopId = "q102-stop-" + "a".repeat(22);
  const state = {
    strategyId: "QUALITY102_CAUSAL_V1", mode: "LIVE", runtimeCommitSha: OTHER_SHA, updatedAt: NOW,
    position: { symbol: "RENDERUSDT", side: -1, quantity: 2, entryPrice: 100, hardStop: 0.08, stopLedger: { plans: [{ clientOrderId: stopId }] }, residentStop: { protected: true, readBackStatus: "VERIFIED", symbol: "RENDERUSDT", side: "BUY", clientOrderId: stopId, quantity: 2, stopPrice: 106, lastReconciledAt: NOW },
    },
  };
  const order = { symbol: "RENDERUSDT", side: "BUY", type: "STOP_MARKET", clientOrderId: stopId, reduceOnly: true, status: "NEW", origQty: "2", executedQty: "0", stopPrice: "106" };
  const heartbeat = { runtimeSha: OTHER_SHA, expectedSha: OTHER_SHA, serviceUnit: `disdex-quality102-causal-v1@${OTHER_SHA}.service`, safetyState: "HEALTHY", mode: "LIVE", lastTickAt: NOW };
  assert.equal(q102ProofsFromIndependentEvidence([order], state, heartbeat, OTHER_SHA, NOW, OTHER_SHA).length, 1);
  assert.equal(q102ProofsFromIndependentEvidence([order], state, heartbeat, OTHER_SHA, NOW, SHA).length, 0);
});

test("root runtime wiring exports STOP owner SHAs from the validated pin fields", async () => {
  const source = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  for (const [strategy, runner] of [
    ["PENGU", "PENGU_V8"],
    ["V52", "V52"],
    ["FET", "FET_BRK48_RESIDUAL"],
    ["HYPE", "HYPE_TREND_LONG"],
    ["IDLE", "IDLE_PRIORITY_SHORT"],
  ]) {
    assert.match(source, new RegExp(`DISDEX_SHARED_STOP_${strategy}_OWNER_SHA`));
    assert.match(source, new RegExp(`runner_pin_field ${runner} sha`));
  }
  assert.doesNotMatch(source, /DISDEX_SHARED_STOP_(?:PENGU|FET|HYPE|IDLE)_OWNER_SHA=7688ed7c/);
});

test("multi-SHA cleanup preserves every manifest-pinned unit and retires only stale duplicates", async () => {
  const source = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  assert.match(source, /is_expected_runtime_unit\s*\(\)/);
  assert.match(source, /is_expected_runtime_unit "\$unit"/);
  assert.doesNotMatch(source, /\[\[ "\$sha" == "\$DEPLOYED_SHA" \]\] && continue/);
});
