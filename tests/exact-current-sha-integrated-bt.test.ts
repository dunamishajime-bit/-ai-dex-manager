import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { validateExactBtManifest, type ExactBtManifest } from "../scripts/research/exact-current-sha-bt-contract.ts";
import { runExactIntegratedBt } from "../scripts/research/exact-current-sha-integrated-bt.ts";

const TARGET = "e8cc2e73f8d3981d708ee52f013241597c038b10";
const H = 60 * 60 * 1000;
const START = Date.parse("2025-08-10T00:00:00.000Z");
const STRATEGIES = ["V12", "PENGU", "Q102", "V52", "FET", "HYPE", "IDLE", "RESIDUAL"] as const;

function lineHash(body: string) { return createHash("sha256").update(body).digest("hex"); }

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "disdex-exact-bt-replay-"));
  const candidates = [
    { kind: "ENTRY", runtimeSha: TARGET, timestamp: START + H, priority: 20, sequence: 1, strategyId: "V12", candidateId: "A", symbol: "BTCUSDT", assetClass: "CRYPTO", side: "LONG", requestedGross: 1, entryPrice: 100, exitTimestamp: START + 3 * H, exitPrice: 110, exitReason: "TAKE_PROFIT", fundingPnlJpy: 0 },
    { kind: "ENTRY", runtimeSha: TARGET, timestamp: START + H, priority: 30, sequence: 2, strategyId: "PENGU", candidateId: "B", symbol: "ETHUSDT", assetClass: "CRYPTO", side: "LONG", requestedGross: 2.5, entryPrice: 100, exitTimestamp: START + 4 * H, exitPrice: 100, exitReason: "TIME_EXIT", fundingPnlJpy: 0 },
    { kind: "ENTRY", runtimeSha: TARGET, timestamp: START + H, priority: 40, sequence: 3, strategyId: "Q102", candidateId: "C", symbol: "ETHUSDT", assetClass: "CRYPTO", side: "LONG", requestedGross: 2, entryPrice: 100, exitTimestamp: START + 4 * H, exitPrice: 105, exitReason: "TIME_EXIT", fundingPnlJpy: 0 },
    { kind: "ENTRY", runtimeSha: TARGET, timestamp: START + 2 * H, priority: 20, sequence: 4, strategyId: "V12", candidateId: "D", symbol: "BTCUSDT", assetClass: "CRYPTO", side: "LONG", requestedGross: 1, entryPrice: 100, exitTimestamp: START + 5 * H, exitPrice: 100, exitReason: "TIME_EXIT", fundingPnlJpy: 0 },
    { kind: "ENTRY", runtimeSha: TARGET, timestamp: START + 4 * H, priority: 20, sequence: 5, strategyId: "V12", candidateId: "E", symbol: "BTCUSDT", assetClass: "CRYPTO", side: "LONG", requestedGross: 1, entryPrice: 100, exitTimestamp: START + 6 * H, exitPrice: 100, exitReason: "TIME_EXIT", fundingPnlJpy: 0 },
    { kind: "ENTRY", runtimeSha: TARGET, timestamp: START + 5 * H, priority: 20, sequence: 6, strategyId: "V12", candidateId: "F", symbol: "BTCUSDT", assetClass: "CRYPTO", side: "LONG", requestedGross: 1, entryPrice: 100, exitTimestamp: START + 7 * H, exitPrice: 102, exitReason: "TAKE_PROFIT", fundingPnlJpy: 0 },
  ];
  const candidateBody = candidates.map((x) => JSON.stringify(x)).join("\n") + "\n";
  await writeFile(path.join(root, "candidate-events.jsonl"), candidateBody, "utf8");
  const marketRows = Array.from({ length: 13 }, (_, index) => ({ kind: "MARK", runtimeSha: TARGET, timestamp: Date.UTC(2025 + Math.floor((7 + index) / 12), (7 + index) % 12, index === 0 ? 10 : index === 12 ? 9 : 1, 0, 0, 0), priority: 90, sequence: index + 1, markPrices: {} }));
  const marketBody = marketRows.map((x) => JSON.stringify(x)).join("\n") + "\n";
  await writeFile(path.join(root, "market-events.jsonl"), marketBody, "utf8");
  const manifest: ExactBtManifest = {
    schema: "disdex/exact-current-sha-bt-manifest/v1",
    runtimeSha: TARGET,
    period: { startInclusive: "2025-08-10T00:00:00.000Z", endExclusive: "2026-08-10T00:00:00.000Z" },
    capital: { initialJpy: 10_000, monthlyContributionJpy: 0, compounding: true },
    execution: { feeBpsPerSide: 0, slippageBpsPerSide: 0, fundingIncluded: true, eventOrdering: "timestamp|priority|sequence" },
    risk: { cryptoGrossCap: 3, totalGrossCap: 4.25, crossLeverage: 5, sameSymbolCooldownHours: 2 },
    strategies: STRATEGIES.map((strategyId) => ({ strategyId, sourceRuntimeSha: TARGET, sourcePath: "candidate-events.jsonl", sourceSha256: lineHash(candidateBody), coverage: "full-period" })),
    marketSources: [{ sourceRuntimeSha: TARGET, sourcePath: "market-events.jsonl", sourceSha256: lineHash(marketBody), coverage: "full-period" }],
  };
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return { root, manifestPath };
}

test("replays entries chronologically with gross, ownership, and actual-exit cooldown gates", async () => {
  const f = await fixture();
  try {
    const result = runExactIntegratedBt(validateExactBtManifest(f.manifestPath, TARGET));
    assert.deepEqual(result.trades.map((trade) => trade.candidateId), ["A", "C", "F"]);
    assert.equal(result.decisions.filter((x) => x.decision === "REJECTED").length, 3);
    assert.deepEqual(result.decisions.filter((x) => x.decision === "REJECTED").map((x) => x.reason), ["CRYPTO_GROSS_CAP", "SAME_SYMBOL_ACTIVE", "SYMBOL_COOLDOWN"]);
    assert.ok(result.maxCryptoGross <= 3 + 1e-12);
    assert.equal(result.mutation.ordersSent, 0);
    assert.equal(result.reconciliation.status, "PASS");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects duplicate candidate IDs before replay", async () => {
  const f = await fixture();
  try {
    const candidatePath = path.join(f.root, "candidate-events.jsonl");
    const existing = await readFile(candidatePath, "utf8");
    const nextBody = existing + existing.split("\n")[0] + "\n";
    await writeFile(candidatePath, nextBody, "utf8");
    const manifestPath = path.join(f.root, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    for (const source of manifest.strategies) source.sourceSha256 = lineHash(nextBody);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    await assert.rejects(async () => runExactIntegratedBt(validateExactBtManifest(f.manifestPath, TARGET)), /EXACT_BT_DUPLICATE_CANDIDATE_ID/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
