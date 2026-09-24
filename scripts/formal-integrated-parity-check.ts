import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;

const EXPECTED = {
  period: {
    startInclusive: "2025-08-10T00:00:00.000Z",
    endExclusive: "2026-08-10T00:00:00.000Z",
  },
  baseline: {
    NORMAL: { endingAssetJpy: 18_442_769.03585051, pf: 3.57064393, dd: -14.33740242, trades: 1181 },
    SEVERE: { endingAssetJpy: 2_827_282.1410372, pf: 2.41551514, dd: -17.68170098, trades: 1048 },
  },
  integrated: {
    NORMAL: { asset: 69_373_656.13931108, pf: 3.70258068, dd: -17.59935397, trades: 1165, v52Events: 143 },
    SEVERE: { asset: 8_729_157.74295382, pf: 2.62470185, dd: -19.24473938, trades: 1023, v52Events: 0 },
  },
} as const;

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  assert.ok(value && !value.startsWith("--"), `missing ${name}`);
  return value;
}

function readJson(path: string): JsonObject {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `invalid JSON object: ${path}`);
  return value as JsonObject;
}

function numberAt(object: JsonObject, ...keys: string[]): number {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  throw new Error(`missing numeric field (${keys.join(" or ")})`);
}

function objectAt(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `missing object field: ${key}`);
  return value as JsonObject;
}

function close(actual: number, expected: number, label: string, tolerance = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

function verifyBaseline(canonical: JsonObject): JsonObject {
  const results = objectAt(canonical, "results");
  for (const scenario of ["NORMAL", "SEVERE"] as const) {
    const row = objectAt(results, scenario);
    const expected = EXPECTED.baseline[scenario];
    close(numberAt(row, "endingAssetJpy"), expected.endingAssetJpy, `${scenario} ending asset`, 1e-5);
    close(numberAt(row, "profitFactor", "PF"), expected.pf, `${scenario} PF`, 1e-8);
    close(numberAt(row, "maxDrawdownPctClosedEventTwr", "DDPct", "dd"), expected.dd, `${scenario} DD`, 1e-8);
    assert.equal(numberAt(row, "trades", "executions"), expected.trades, `${scenario} trades`);
  }

  const checks = objectAt(canonical, "checks");
  assert.equal(checks.BASELINE_NORMAL_ENDING_ASSET, false, "canonical historical NORMAL assert must remain identified as stale");
  assert.equal(checks.BASELINE_SEVERE_ENDING_ASSET, false, "canonical historical SEVERE assert must remain identified as stale");
  assert.equal(objectAt(canonical, "safety").ordersSent, false, "canonical BT must not send orders");
  return { status: "PASS", staleHistoricalChecks: ["BASELINE_NORMAL_ENDING_ASSET", "BASELINE_SEVERE_ENDING_ASSET"] };
}

function verifyIntegrated(research: JsonObject): JsonObject {
  const finalCombined = objectAt(research, "finalCombined");
  for (const scenario of ["NORMAL", "SEVERE"] as const) {
    const row = objectAt(finalCombined, scenario);
    const expected = EXPECTED.integrated[scenario];
    close(numberAt(row, "asset", "endingAssetJpy"), expected.asset, `${scenario} integrated asset`, 1e-5);
    close(numberAt(row, "pf", "profitFactor", "PF"), expected.pf, `${scenario} integrated PF`, 1e-8);
    close(numberAt(row, "dd", "DDPct", "maxDrawdownPct"), expected.dd, `${scenario} integrated DD`, 1e-8);
    assert.equal(numberAt(row, "trades", "executions"), expected.trades, `${scenario} integrated trades`);
    assert.equal(numberAt(row, "v52Events"), expected.v52Events, `${scenario} V52 events`);
  }

  const architecture = objectAt(research, "finalArchitecture");
  const v12 = objectAt(architecture, "v12");
  assert.equal(numberAt(v12, "slots"), 2);
  close(numberAt(v12, "perPositionGrossCap"), 1.0, "V12 per-position gross");
  close(numberAt(v12, "aggregateGrossCap"), 1.5, "V12 aggregate gross");
  const pengu = objectAt(architecture, "pengu");
  close(numberAt(pengu, "allocationGrossCap"), 1.0, "PENGU gross");
  assert.equal(numberAt(pengu, "hardStopCooldownHours"), 24);
  const quality102 = objectAt(architecture, "quality102");
  close(numberAt(quality102, "maximumGross"), 1.5, "Q102 gross");
  assert.equal(numberAt(quality102, "maximumPositions"), 1);
  const v52 = objectAt(architecture, "v52");
  assert.equal(v52.v11, "UNCHANGED");
  close(numberAt(v52, "v50MinimumEntryBasisBps"), 60, "V50 basis");
  close(numberAt(v52, "v50ConvergenceBps"), 20, "V50 convergence");
  close(numberAt(v52, "v50BasisStopMultiple"), 1.75, "V50 stop");
  close(numberAt(v52, "v50MinimumNetEdgeBps"), 7.5, "V50 net edge");
  close(numberAt(v52, "maximumRoundTripCostBps"), 60, "V50 max cost");
  close(numberAt(v52, "maximumSpreadBps"), 20, "V50 max spread");
  const portfolio = objectAt(architecture, "portfolio");
  close(numberAt(portfolio, "cryptoGrossCap"), 3, "crypto gross");
  close(numberAt(portfolio, "stockGrossCap"), 1.5, "stock gross");
  close(numberAt(portfolio, "totalGrossCap"), 3.5, "total gross");
  close(numberAt(portfolio, "sharedCryptoDailyLossPct"), 7.5, "crypto daily loss");
  assert.equal(portfolio.venueMargin, "5x Cross");
  const safety = objectAt(research, "safety");
  assert.equal(safety.ordersSent, false);
  assert.equal(safety.liveChanged, false);
  assert.ok(Math.abs(EXPECTED.integrated.SEVERE.dd) <= 20, "SEVERE DD must remain <= 20%");
  return { status: "PASS", severeV52Events: 0, severeDdPct: EXPECTED.integrated.SEVERE.dd };
}

const baseline = verifyBaseline(readJson(arg("--baseline-json")));
const integrated = verifyIntegrated(readJson(arg("--integrated-json")));
console.log(JSON.stringify({ status: "PASS_FORMAL_INTEGRATED_PARITY", baseline, integrated }, null, 2));
