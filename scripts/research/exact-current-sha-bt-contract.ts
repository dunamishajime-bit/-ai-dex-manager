import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const EXACT_BT_STRATEGIES = ["V12", "PENGU", "Q102", "V52", "FET", "HYPE", "IDLE", "RESIDUAL"] as const;
export type ExactBtStrategyId = (typeof EXACT_BT_STRATEGIES)[number];

export type ExactBtSource = {
  strategyId: ExactBtStrategyId;
  sourceRuntimeSha: string;
  sourcePath: string;
  sourceSha256: string;
  coverage: "full-period";
};

export type ExactBtMarketSource = {
  sourceRuntimeSha: string;
  sourcePath: string;
  sourceSha256: string;
  coverage: "full-period";
};

export type ExactBtManifest = {
  schema: "disdex/exact-current-sha-bt-manifest/v1";
  runtimeSha: string;
  period: { startInclusive: string; endExclusive: string };
  capital: { initialJpy: number; monthlyContributionJpy: number; compounding: boolean };
  execution: { feeBpsPerSide: number; slippageBpsPerSide: number; fundingIncluded: boolean; eventOrdering: "timestamp|priority|sequence" };
  risk: { cryptoGrossCap: number; totalGrossCap: number; crossLeverage: number; sameSymbolCooldownHours: number };
  strategies: ExactBtSource[];
  marketSources: ExactBtMarketSource[];
};

export type ValidatedBtManifest = ExactBtManifest & {
  manifestPath: string;
  strategyIds: ExactBtStrategyId[];
  sourceFiles: string[];
  marketFiles: string[];
};

const SHA256 = /^[0-9a-f]{64}$/i;
const SHA1 = /^[0-9a-f]{40}$/i;
const EXPECTED_START = "2025-08-10T00:00:00.000Z";
const EXPECTED_END = "2026-08-10T00:00:00.000Z";

function fail(code: string, detail?: string): never {
  throw new Error(detail ? `${code}:${detail}` : code);
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function isStrategy(value: string): value is ExactBtStrategyId {
  return (EXACT_BT_STRATEGIES as readonly string[]).includes(value);
}

export function validateExactBtManifest(manifestPath: string, expectedSha: string): ValidatedBtManifest {
  if (!SHA1.test(expectedSha)) fail("EXACT_BT_EXPECTED_RUNTIME_SHA_INVALID");
  const absoluteManifestPath = path.resolve(manifestPath);
  if (!existsSync(absoluteManifestPath)) fail("EXACT_BT_MANIFEST_NOT_FOUND", absoluteManifestPath);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absoluteManifestPath, "utf8"));
  } catch (error) {
    fail("EXACT_BT_MANIFEST_INVALID_JSON", error instanceof Error ? error.message : String(error));
  }
  if (!raw || typeof raw !== "object") fail("EXACT_BT_MANIFEST_NOT_OBJECT");
  const manifest = raw as Partial<ExactBtManifest>;
  if (manifest.schema !== "disdex/exact-current-sha-bt-manifest/v1") fail("EXACT_BT_MANIFEST_SCHEMA_MISMATCH");
  if (manifest.runtimeSha !== expectedSha) fail("EXACT_BT_RUNTIME_SHA_MISMATCH", String(manifest.runtimeSha));
  if (manifest.period?.startInclusive !== EXPECTED_START || manifest.period?.endExclusive !== EXPECTED_END) {
    fail("EXACT_BT_PERIOD_MISMATCH");
  }

  const capital = manifest.capital;
  if (!capital || capital.initialJpy !== 10_000 || capital.monthlyContributionJpy !== 0 || capital.compounding !== true) {
    if (capital?.monthlyContributionJpy !== 0) fail("EXACT_BT_MONTHLY_CONTRIBUTION_MUST_BE_ZERO");
    fail("EXACT_BT_CAPITAL_CONTRACT_MISMATCH");
  }

  const execution = manifest.execution;
  if (!execution || !Number.isFinite(execution.feeBpsPerSide) || execution.feeBpsPerSide < 0 ||
      !Number.isFinite(execution.slippageBpsPerSide) || execution.slippageBpsPerSide < 0 ||
      execution.fundingIncluded !== true || execution.eventOrdering !== "timestamp|priority|sequence") {
    fail("EXACT_BT_EXECUTION_CONTRACT_MISMATCH");
  }

  const risk = manifest.risk;
  if (!risk || risk.cryptoGrossCap !== 3 || risk.totalGrossCap !== 4.25 || risk.crossLeverage !== 5 || risk.sameSymbolCooldownHours !== 2) {
    fail("EXACT_BT_RISK_CONTRACT_MISMATCH");
  }

  const strategies = manifest.strategies;
  if (!Array.isArray(strategies)) fail("EXACT_BT_STRATEGY_COVERAGE_MISSING");
  const strategyIds = strategies.map((source) => source?.strategyId);
  const unique = new Set(strategyIds);
  if (unique.size !== EXACT_BT_STRATEGIES.length || unique.size !== strategies.length ||
      !EXACT_BT_STRATEGIES.every((strategyId) => unique.has(strategyId))) {
    fail("EXACT_BT_STRATEGY_COVERAGE_INCOMPLETE", strategyIds.join(","));
  }

  const sourceFiles = new Set<string>();
  for (const source of strategies) {
    if (!source || !isStrategy(String(source.strategyId))) fail("EXACT_BT_STRATEGY_ID_INVALID");
    if (source.sourceRuntimeSha !== expectedSha) fail("EXACT_BT_SOURCE_RUNTIME_SHA_MISMATCH", `${source.strategyId}:${source.sourceRuntimeSha}`);
    if (source.coverage !== "full-period") fail("EXACT_BT_SOURCE_COVERAGE_INCOMPLETE", String(source.strategyId));
    if (!source.sourcePath || path.isAbsolute(source.sourcePath) || source.sourcePath.includes("..")) {
      fail("EXACT_BT_SOURCE_PATH_INVALID", String(source.sourcePath));
    }
    if (!SHA256.test(source.sourceSha256)) fail("EXACT_BT_SOURCE_SHA_INVALID", String(source.strategyId));
    const absoluteSourcePath = path.resolve(path.dirname(absoluteManifestPath), source.sourcePath);
    if (!existsSync(absoluteSourcePath)) fail("EXACT_BT_SOURCE_NOT_FOUND", `${source.strategyId}:${absoluteSourcePath}`);
    const actual = sha256(readFileSync(absoluteSourcePath));
    if (actual.toLowerCase() !== source.sourceSha256.toLowerCase()) {
      fail("EXACT_BT_SOURCE_SHA256_MISMATCH", `${source.strategyId}:${source.sourcePath}`);
    }
    sourceFiles.add(absoluteSourcePath);
  }

  if (!Array.isArray(manifest.marketSources) || manifest.marketSources.length === 0) fail("EXACT_BT_MARKET_COVERAGE_MISSING");
  const marketFiles = new Set<string>();
  for (const source of manifest.marketSources) {
    if (!source || source.sourceRuntimeSha !== expectedSha) fail("EXACT_BT_MARKET_RUNTIME_SHA_MISMATCH", String(source?.sourceRuntimeSha));
    if (source.coverage !== "full-period") fail("EXACT_BT_MARKET_COVERAGE_INCOMPLETE");
    if (!source.sourcePath || path.isAbsolute(source.sourcePath) || source.sourcePath.includes("..")) fail("EXACT_BT_MARKET_PATH_INVALID");
    if (!SHA256.test(source.sourceSha256)) fail("EXACT_BT_MARKET_SHA_INVALID");
    const absoluteSourcePath = path.resolve(path.dirname(absoluteManifestPath), source.sourcePath);
    if (!existsSync(absoluteSourcePath)) fail("EXACT_BT_MARKET_NOT_FOUND", absoluteSourcePath);
    const actual = sha256(readFileSync(absoluteSourcePath));
    if (actual.toLowerCase() !== source.sourceSha256.toLowerCase()) fail("EXACT_BT_MARKET_SHA256_MISMATCH", source.sourcePath);
    marketFiles.add(absoluteSourcePath);
  }

  return {
    ...(manifest as ExactBtManifest),
    manifestPath: absoluteManifestPath,
    strategyIds: [...EXACT_BT_STRATEGIES],
    sourceFiles: [...sourceFiles].sort(),
    marketFiles: [...marketFiles].sort(),
  };
}
