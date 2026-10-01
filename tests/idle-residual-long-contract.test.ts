import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { IDLE_RESIDUAL_LONG_POLICY } from "../config/idleResidualLongPolicy";
import { chooseIdleResidualLong, evaluateIdleResidualLongFeatures } from "../lib/idle-residual-long-signal";
import { assertIdleResidualLongParityCert, IDLE_RESIDUAL_LONG_CERT_SCHEMA } from "../lib/idle-residual-long-parity-cert";
import type { IdleFeatures } from "../lib/idle-priority-short-signal";

function features(overrides: Partial<IdleFeatures> = {}): IdleFeatures {
  return {
    decisionTs: 1_800_000_000_000,
    signalTs: 1_799_996_400_000,
    ret12: 0.02,
    ret24: 0.01,
    btc24: -0.03,
    rel24: 0.04,
    atrRatio: 0.01,
    volumeRatio: 1.3,
    breakoutLong24: false,
    breakoutShort24: false,
    breakdown24: false,
    ...overrides,
  };
}

test("DOGE and AVAX residual gates are frozen and DOGE has priority", () => {
  assert.equal(IDLE_RESIDUAL_LONG_POLICY.gross, 1);
  assert.equal(IDLE_RESIDUAL_LONG_POLICY.leverage, 5);
  assert.equal(IDLE_RESIDUAL_LONG_POLICY.holdHours, 12);
  assert.equal(IDLE_RESIDUAL_LONG_POLICY.emergencyStopPct, 10);
  assert.equal(IDLE_RESIDUAL_LONG_POLICY.emergencyTakeProfitPct, 25);

  const doge = evaluateIdleResidualLongFeatures("DOGEUSDT", features({ volumeRatio: 1.2, rel24: 0.03, atrRatio: 0.007 }));
  const avax = evaluateIdleResidualLongFeatures("AVAXUSDT", features({ volumeRatio: 0.8, rel24: 0.03, atrRatio: 0.007 }));
  assert.equal(doge.accepted, true);
  assert.equal(avax.accepted, true);
  assert.equal(chooseIdleResidualLong([avax, doge])?.symbol, "DOGEUSDT");

  assert.equal(evaluateIdleResidualLongFeatures("DOGEUSDT", features({ volumeRatio: 1.1999 })).reason, "VOLUME_RATIO_NOT_MET");
  assert.equal(evaluateIdleResidualLongFeatures("AVAXUSDT", features({ volumeRatio: 0.7999 })).reason, "VOLUME_RATIO_NOT_MET");
  assert.equal(evaluateIdleResidualLongFeatures("DOGEUSDT", features({ rel24: 0.0299 })).reason, "REL24_NOT_MET");
  assert.equal(evaluateIdleResidualLongFeatures("AVAXUSDT", features({ atrRatio: 0.00699 })).reason, "ATR_RATIO_NOT_MET");
});

test("V12 Trail0.20 production contract is frozen and live code uses completed 2H extreme", async () => {
  assert.equal(V12_X1_ALL.trailingAtr, 0.20);
  assert.equal(V12_X1_ALL.stopAtr, 2.477);
  assert.equal(V12_X1_ALL.takeProfitAtr, 3.1995);
  const source = await readFile("lib/v12-live-execution-engine.ts", "utf8");
  assert.match(source, /completedBlockExtreme = active\.side === "LONG" \? activeBar\.high : activeBar\.low/);
  assert.match(source, /planV12TrailingStop\(this\.d\.adapter, active\.protection, completedBlockExtreme\)/);
});

test("all formal runners preserve priority over residual LONG", async () => {
  const [v12, pengu, q102, fet, v52, helper] = await Promise.all([
    readFile("lib/v12-live-execution-engine.ts","utf8"),
    readFile("lib/pengu-dual-ls-v2-portfolio-runner.ts","utf8"),
    readFile("lib/disdex-quality102-causal-v1-runner.ts","utf8"),
    readFile("lib/fet-brk48-live-runner.ts","utf8"),
    readFile("scripts/disdex_v52_aster_only_live_engine.py","utf8"),
    readFile("scripts/disdex-idle-residual-long-core-preempt.ts","utf8"),
  ]);
  for (const source of [v12,pengu,q102,fet]) {
    assert.match(source,/releaseIdleResidualLongForFormalEntry/);
  }
  assert.match(v52,/_prepare_idle_residual_for_stock_entry/);
  assert.match(v52,/target_gross = self\._prepare_idle_residual_for_stock_entry\(slot, target_gross\)/);
  assert.match(helper,/caller!==\"V52_CORE\"/);
  assert.match(helper,/releaseIdleResidualLongForFormalEntry/);
});

test("combined exact-SHA residual certificate rejects drift", () => {
  const sha = "a".repeat(40);
  const cert = {
    schema: IDLE_RESIDUAL_LONG_CERT_SCHEMA,
    runtimeSha: sha,
    generatedAt: new Date(0).toISOString(),
    priority: ["FORMAL_EXISTING","IDLE_PRIORITY_SHORT","DOGE_REL_VOL","AVAX_REL_LONG"],
    trailAtr: 0.20,
    stopAtr: 2.477,
    takeProfitAtr: 3.1995,
    roundtripBps: 10,
    finalJpy: 1319918378.8124561,
    integratedTradeCount: 1390,
    idleTrades: 61,
    dogeTrades: 11,
    avaxTrades: 16,
    profitFactor: 2.332297694545306,
    maxMtmDrawdown: -0.21359613575534397,
    contractSha256: "b".repeat(64),
  } as const;
  assert.equal(assertIdleResidualLongParityCert(cert, sha).runtimeSha, sha);
  assert.throws(() => assertIdleResidualLongParityCert({ ...cert, dogeTrades: 12 }, sha), /TRADE_CONTRACT_MISMATCH/);
  assert.throws(() => assertIdleResidualLongParityCert({ ...cert, finalJpy: 1 }, sha), /FINAL_JPY_MISMATCH/);
});
