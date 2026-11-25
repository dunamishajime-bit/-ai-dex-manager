import assert from "node:assert/strict";
import test from "node:test";
import {
  STABLE4_RUNNER_BUNDLE_ENTRIES,
  STABLE4_RUNNER_BUNDLE_OPERATION,
  STABLE4_RUNNER_BUNDLE_PLAN_SHA256,
  STABLE4_RUNNER_BUNDLE_SCOPE,
  stable4RunnerBundleManifest,
} from "@/lib/stable4-runner-bundle";

test("STABLE4 bundle contains exactly the six non-HYPE runners", () => {
  assert.deepEqual(
    STABLE4_RUNNER_BUNDLE_ENTRIES.map((entry) => entry.runner),
    ["FET_BRK48_RESIDUAL", "IDLE_PRIORITY_SHORT", "PENGU_V8", "QUALITY102_CAUSAL_V1", "V12_V4", "V52"],
  );
  assert.equal(STABLE4_RUNNER_BUNDLE_ENTRIES.length, 6);
  assert.ok(!STABLE4_RUNNER_BUNDLE_ENTRIES
    .some((entry) => (entry.runner as string) === "HYPE_TREND_LONG"));
  for (const entry of STABLE4_RUNNER_BUNDLE_ENTRIES) {
    assert.equal(entry.scope, entry.runner);
    assert.equal(entry.operation, `${entry.runner}_SCOPED_ORDER_ENABLE`);
    assert.match(entry.sourceSha, /^[0-9a-f]{40}$/);
    assert.match(entry.planSha256, /^[0-9a-f]{64}$/);
    assert.match(entry.unitTemplate, /\{sha\}\.service$/);
  }
});

test("bundle identity is fixed and hashes its canonical manifest", () => {
  const manifest = stable4RunnerBundleManifest();
  assert.equal(manifest.schema, "STABLE4_RUNNER_BUNDLE_MANIFEST_V1");
  assert.equal(manifest.operation, STABLE4_RUNNER_BUNDLE_OPERATION);
  assert.equal(manifest.scope, STABLE4_RUNNER_BUNDLE_SCOPE);
  assert.equal(manifest.ordersEnabled, true);
  assert.equal(manifest.sourceSha, "4786f600ae7bf86ffca948f1412956a9113cb20d");
  assert.deepEqual(manifest.economics, {
    cryptoGrossCap: 3,
    hypeTrendGrossCap: 1.5,
    penguDdProtectionPct: 17,
    penguGrossCap: 1,
    sharedRiskDailyLossPct: 7.5,
    stockGrossCap: 4,
    totalGrossCap: 4.25,
    v4AggregateGrossCap: 2,
    v4NewOrderDdStopPct: 30,
    v52V11GrossCap: 2,
    v52V50GrossCap: 2,
  });
  assert.deepEqual(manifest.safety, {
    funding: "preserve",
    globalHold: "must_remain_active",
    h48: "separate_exact_scope",
    residentStop: "preserve",
  });
  assert.equal(manifest.runners.length, 6);
  assert.match(STABLE4_RUNNER_BUNDLE_PLAN_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.manifestSha256, STABLE4_RUNNER_BUNDLE_PLAN_SHA256);
  assert.equal(STABLE4_RUNNER_BUNDLE_PLAN_SHA256,
    "678428fdd874ce0bfe1f10f31dfec3f6fde0a027931082a195404c9c462dfbf1");
});

