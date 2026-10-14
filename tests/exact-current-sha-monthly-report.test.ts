import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { writeExactBtReport } from "../scripts/research/run-exact-current-sha-monthly-bt";

const TARGET = "e8cc2e73f8d3981d708ee52f013241597c038b10";
const STRATEGIES = ["V12", "PENGU", "Q102", "V52", "FET", "HYPE", "IDLE", "RESIDUAL"];
const H = 60 * 60 * 1000;
const start = Date.parse("2025-08-10T00:00:00.000Z");
const hash = (body: string) => createHash("sha256").update(body).digest("hex");

test("writes reproducible monthly report and output hashes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "disdex-exact-bt-report-"));
  try {
    const candidate = JSON.stringify({ kind: "ENTRY", runtimeSha: TARGET, timestamp: start + H, priority: 1, sequence: 1, strategyId: "V12", candidateId: "REPORT-1", symbol: "BTCUSDT", assetClass: "CRYPTO", side: "LONG", requestedGross: 1, entryPrice: 100, exitTimestamp: start + 2 * H, exitPrice: 101, exitReason: "TIME_EXIT", fundingPnlJpy: 0 }) + "\n";
    const markets = Array.from({ length: 13 }, (_, index) => JSON.stringify({ kind: "MARK", runtimeSha: TARGET, timestamp: Date.UTC(2025 + Math.floor((7 + index) / 12), (7 + index) % 12, index === 0 ? 10 : index === 12 ? 9 : 1), priority: 90, sequence: index + 1, markPrices: {} })).join("\n") + "\n";
    await writeFile(path.join(root, "candidates.jsonl"), candidate, "utf8");
    await writeFile(path.join(root, "markets.jsonl"), markets, "utf8");
    const manifest = {
      schema: "disdex/exact-current-sha-bt-manifest/v1", runtimeSha: TARGET,
      period: { startInclusive: "2025-08-10T00:00:00.000Z", endExclusive: "2026-08-10T00:00:00.000Z" },
      capital: { initialJpy: 10_000, monthlyContributionJpy: 0, compounding: true },
      execution: { feeBpsPerSide: 0, slippageBpsPerSide: 0, fundingIncluded: true, eventOrdering: "timestamp|priority|sequence" },
      risk: { cryptoGrossCap: 3, totalGrossCap: 4.25, crossLeverage: 5, sameSymbolCooldownHours: 2 },
      strategies: STRATEGIES.map((strategyId) => ({ strategyId, sourceRuntimeSha: TARGET, sourcePath: "candidates.jsonl", sourceSha256: hash(candidate), coverage: "full-period" })),
      marketSources: [{ sourceRuntimeSha: TARGET, sourcePath: "markets.jsonl", sourceSha256: hash(markets), coverage: "full-period" }],
    };
    const manifestPath = path.join(root, "manifest.json");
    const outputDir = path.join(root, "out");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    const first = await writeExactBtReport(manifestPath, outputDir);
    const firstManifest = JSON.parse(await readFile(path.join(outputDir, "manifest.json"), "utf8"));
    const firstResult = JSON.parse(await readFile(path.join(outputDir, "result.json"), "utf8"));
    assert.equal(firstResult.runtimeSha, TARGET);
    assert.equal(firstResult.reconciliation.status, "PASS");
    assert.equal(firstResult.reconciliation.initialJpy, 10_000);
    assert.equal(firstResult.reconciliation.depositsJpy, 0);
    assert.equal(firstManifest.resultHash, firstResult.resultHash);
    assert.ok(first.outputHashes["portfolio-trades.jsonl"]);
    const firstHash = firstResult.resultHash;
    const second = await writeExactBtReport(manifestPath, outputDir);
    assert.equal(second.resultHash, firstHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
