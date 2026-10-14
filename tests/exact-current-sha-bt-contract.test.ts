import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { validateExactBtManifest } from "../scripts/research/exact-current-sha-bt-contract.ts";

const TARGET = "e8cc2e73f8d3981d708ee52f013241597c038b10";
const STRATEGIES = ["V12", "PENGU", "Q102", "V52", "FET", "HYPE", "IDLE", "RESIDUAL"];

async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "disdex-exact-bt-contract-"));
  const sourcePath = path.join(root, "candidate-events.jsonl");
  const sourceBody = "{\"timestamp\":1754784000000,\"strategyId\":\"V12\"}\n";
  await writeFile(sourcePath, sourceBody, "utf8");
  const sha256 = createHash("sha256").update(sourceBody).digest("hex");
  const marketPath = path.join(root, "market.jsonl");
  const marketBody = "{\"kind\":\"MARK\",\"timestamp\":1754784000000}\n";
  await writeFile(marketPath, marketBody, "utf8");
  const marketSha256 = createHash("sha256").update(marketBody).digest("hex");
  const manifest = {
    schema: "disdex/exact-current-sha-bt-manifest/v1",
    runtimeSha: TARGET,
    period: { startInclusive: "2025-08-10T00:00:00.000Z", endExclusive: "2026-08-10T00:00:00.000Z" },
    capital: { initialJpy: 10_000, monthlyContributionJpy: 0, compounding: true },
    execution: { feeBpsPerSide: 5, slippageBpsPerSide: 0, fundingIncluded: true, eventOrdering: "timestamp|priority|sequence" },
    risk: { cryptoGrossCap: 3, totalGrossCap: 4.25, crossLeverage: 5, sameSymbolCooldownHours: 2 },
    strategies: STRATEGIES.map((strategyId) => ({ strategyId, sourceRuntimeSha: TARGET, sourcePath: "candidate-events.jsonl", sourceSha256: sha256, coverage: "full-period" })),
    marketSources: [{ sourceRuntimeSha: TARGET, sourcePath: "market.jsonl", sourceSha256: marketSha256, coverage: "full-period" }],
    ...overrides,
  };
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return { root, manifestPath, manifest };
}

test("accepts exact runtime SHA and no-DCA capital contract", async () => {
  const f = await fixture();
  try {
    const result = validateExactBtManifest(f.manifestPath, TARGET);
    assert.equal(result.runtimeSha, TARGET);
    assert.equal(result.capital.monthlyContributionJpy, 0);
    assert.deepEqual(result.strategyIds, STRATEGIES);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects a legacy source runtime even when the manifest target is current", async () => {
  const f = await fixture({ strategies: STRATEGIES.map((strategyId) => ({ strategyId, sourceRuntimeSha: "eabfeb1750666fac11f894a34cdcf68501ab923f", sourcePath: "candidate-events.jsonl", sourceSha256: "x", coverage: "full-period" })) });
  try {
    assert.throws(() => validateExactBtManifest(f.manifestPath, TARGET), /EXACT_BT_SOURCE_RUNTIME_SHA_MISMATCH/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects monthly contributions for the no-DCA request", async () => {
  const f = await fixture({ capital: { initialJpy: 10_000, monthlyContributionJpy: 10_000, compounding: true } });
  try {
    assert.throws(() => validateExactBtManifest(f.manifestPath, TARGET), /EXACT_BT_MONTHLY_CONTRIBUTION_MUST_BE_ZERO/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects incomplete strategy coverage", async () => {
  const f = await fixture({ strategies: STRATEGIES.slice(0, -1).map((strategyId) => ({ strategyId, sourceRuntimeSha: TARGET, sourcePath: "candidate-events.jsonl", sourceSha256: "x", coverage: "full-period" })) });
  try {
    assert.throws(() => validateExactBtManifest(f.manifestPath, TARGET), /EXACT_BT_STRATEGY_COVERAGE_INCOMPLETE/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
