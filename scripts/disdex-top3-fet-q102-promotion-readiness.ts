import assert from "node:assert/strict";
import { readFile, readlink } from "node:fs/promises";

import { TOP3_FET_Q102_CANDIDATE } from "../config/top3FetQ102Candidate";

type Snapshot = Record<string, any>;

export interface PromotionReadinessResult {
  status: "PROMOTION_READINESS_PASS" | "PROMOTION_READINESS_BLOCKED";
  reasons: string[];
  generatedAt?: string;
  productionSha?: string;
  rank3Eligible: boolean;
  fetEligible: boolean;
  q102BoostArmed: boolean;
  tradingMutation: number;
}

function sameNumber(a: unknown, b: number, eps = 1e-9): boolean {
  const n = Number(a);
  return Number.isFinite(n) && Math.abs(n - b) <= eps;
}

function productionShaFromPath(path: string): string {
  return String(path || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
}

export function evaluatePromotionReadiness(
  snapshot: Snapshot,
  productionPath: string,
  expectedProductionSha: string,
  now = Date.now(),
  maximumAgeMs = 180_000,
): PromotionReadinessResult {
  const reasons: string[] = [];
  const generatedAtMs = Date.parse(String(snapshot?.generatedAt || ""));
  const productionSha = productionShaFromPath(productionPath);
  const c = snapshot?.contract || {};
  const v12 = snapshot?.v12 || {};
  const fet = snapshot?.fet || {};
  const q102 = snapshot?.q102Governor || {};

  if (snapshot?.schema !== "top3-fet-q102-shadow-snapshot/v2") reasons.push("SNAPSHOT_SCHEMA_MISMATCH");
  if (snapshot?.mode !== "SHADOW") reasons.push("SNAPSHOT_NOT_SHADOW");
  if (c?.mode !== "SHADOW" || c?.ordersEnabled !== false) reasons.push("CONTRACT_NOT_SHADOW_ONLY");
  if (productionSha !== expectedProductionSha) reasons.push("PRODUCTION_SHA_MISMATCH");
  if (!Number.isFinite(generatedAtMs) || generatedAtMs <= 0 || generatedAtMs > now || now - generatedAtMs > maximumAgeMs) {
    reasons.push("SNAPSHOT_STALE_OR_INVALID");
  }

  for (const [key, value] of [
    ["tradingMutation", snapshot?.tradingMutation],
    ["ordersSent", snapshot?.ordersSent],
    ["cancelsSent", snapshot?.cancelsSent],
    ["positionChangesSent", snapshot?.positionChangesSent],
    ["networkRequests", snapshot?.dataSources?.networkRequests],
  ] as const) {
    if (!sameNumber(value, 0)) reasons.push(`NONZERO_${key.toUpperCase()}`);
  }

  const expected = TOP3_FET_Q102_CANDIDATE;
  if (!sameNumber(c?.v12?.maximumPositions, expected.v12.maximumPositions)
    || !sameNumber(c?.v12?.rank3GrossCap, expected.v12.rank3GrossCap)
    || !sameNumber(c?.v12?.rank3MinimumScore, expected.v12.rank3MinimumScore)) {
    reasons.push("V12_CANDIDATE_CONTRACT_MISMATCH");
  }
  if (!sameNumber(c?.fet?.maximumGross, expected.fet.maximumGross)
    || !sameNumber(c?.fet?.holdHours, expected.fet.holdHours)
    || !sameNumber(c?.fet?.hardStopPct, expected.fet.hardStopPct)) {
    reasons.push("FET_CANDIDATE_CONTRACT_MISMATCH");
  }
  if (!sameNumber(c?.q102Governor?.maximumGross, expected.q102Governor.maximumGross)
    || !sameNumber(c?.q102Governor?.maximumEntryDrawdownPct, expected.q102Governor.maximumEntryDrawdownPct)
    || !sameNumber(c?.portfolio?.cryptoGrossCap, expected.portfolio.cryptoGrossCap)
    || !sameNumber(c?.portfolio?.totalGrossCap, expected.portfolio.totalGrossCap)) {
    reasons.push("Q102_OR_PORTFOLIO_CONTRACT_MISMATCH");
  }

  const rank3 = v12?.rank3;
  if (Array.isArray(v12?.base) && v12.base.length > expected.v12.baseMaximumPositions) reasons.push("V12_BASE_EXCEEDS_TWO");
  if (rank3 && (!sameNumber(rank3?.requestedGross, expected.v12.rank3GrossCap)
    || Number(rank3?.score) < expected.v12.rank3MinimumScore)) {
    reasons.push("V12_RANK3_INVALID");
  }

  if (fet?.eligible === true && (!sameNumber(fet?.requestedGross, expected.fet.maximumGross)
    || !sameNumber(fet?.holdHours, expected.fet.holdHours)
    || !sameNumber(fet?.hardStopPct, expected.fet.hardStopPct))) {
    reasons.push("FET_ELIGIBLE_SHAPE_INVALID");
  }

  const dd = Number(q102?.currentDrawdownPct);
  const shouldBoost = Number.isFinite(dd) && dd >= 0 && dd <= expected.q102Governor.maximumEntryDrawdownPct + 1e-12;
  if (!Number.isFinite(dd) || dd < 0) reasons.push("Q102_DD_INVALID");
  if (Boolean(q102?.boostArmed) !== shouldBoost) reasons.push("Q102_BOOST_ARM_STATE_MISMATCH");

  for (const [family, baseRaw] of Object.entries(expected.q102Governor.baseFamilyGross)) {
    const row = q102?.byFamily?.[family];
    const base = Number(baseRaw);
    if (!row || !sameNumber(row.baseRequestedGross, base)) {
      reasons.push(`Q102_${family}_BASE_MISMATCH`);
      continue;
    }
    const wanted = shouldBoost ? expected.q102Governor.maximumGross : base;
    if (!sameNumber(row.requestedGross, wanted) || Boolean(row.boostEnabled) !== shouldBoost) {
      reasons.push(`Q102_${family}_GOVERNOR_MISMATCH`);
    }
  }

  return {
    status: reasons.length === 0 ? "PROMOTION_READINESS_PASS" : "PROMOTION_READINESS_BLOCKED",
    reasons,
    generatedAt: snapshot?.generatedAt,
    productionSha,
    rank3Eligible: Boolean(rank3),
    fetEligible: fet?.eligible === true,
    q102BoostArmed: q102?.boostArmed === true,
    tradingMutation: Number(snapshot?.tradingMutation || 0),
  };
}

function sampleSnapshot(now: number): Snapshot {
  const families = Object.fromEntries(Object.entries(TOP3_FET_Q102_CANDIDATE.q102Governor.baseFamilyGross).map(([family, base]) => [
    family,
    { family, baseRequestedGross: base, requestedGross: 3, currentDrawdownPct: 0, boostEnabled: true, reason: "DD_WITHIN_0P30_BOOST_TO_3P0" },
  ]));
  return {
    schema: "top3-fet-q102-shadow-snapshot/v2",
    generatedAt: new Date(now - 1_000).toISOString(),
    mode: "SHADOW",
    tradingMutation: 0,
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
    dataSources: { networkRequests: 0 },
    contract: TOP3_FET_Q102_CANDIDATE,
    v12: { base: [], rank3: null, rank3Reason: "NO_ELIGIBLE_RANK3_SCORE_070" },
    fet: { eligible: false, reason: "NO_48H_CLOSE_BREAKOUT", requestedGross: 1.25, holdHours: 24, hardStopPct: 0.05 },
    q102Governor: { currentDrawdownPct: 0, boostArmed: true, byFamily: families },
  };
}

async function selfTest() {
  const now = 1_800_000_000_000;
  const sha = "b6b62bbadf1abe25d8ef31f5f133515b52a0df1c";
  const base = sampleSnapshot(now);
  assert.equal(evaluatePromotionReadiness(base, `/home/deploy/disdex-trading/releases/${sha}`, sha, now).status, "PROMOTION_READINESS_PASS");

  const mutation = structuredClone(base); mutation.ordersSent = 1;
  assert.ok(evaluatePromotionReadiness(mutation, `/home/deploy/disdex-trading/releases/${sha}`, sha, now).reasons.includes("NONZERO_ORDERSSENT"));

  const stale = structuredClone(base); stale.generatedAt = new Date(now - 600_000).toISOString();
  assert.ok(evaluatePromotionReadiness(stale, `/home/deploy/disdex-trading/releases/${sha}`, sha, now).reasons.includes("SNAPSHOT_STALE_OR_INVALID"));

  const badGovernor = structuredClone(base); badGovernor.q102Governor.byFamily.REV.requestedGross = 2.5;
  assert.ok(evaluatePromotionReadiness(badGovernor, `/home/deploy/disdex-trading/releases/${sha}`, sha, now).reasons.includes("Q102_REV_GOVERNOR_MISMATCH"));

  const badRank3 = structuredClone(base); badRank3.v12.rank3 = { score: 0.69, requestedGross: 0.10 };
  assert.ok(evaluatePromotionReadiness(badRank3, `/home/deploy/disdex-trading/releases/${sha}`, sha, now).reasons.includes("V12_RANK3_INVALID"));

  assert.ok(evaluatePromotionReadiness(base, "/home/deploy/disdex-trading/releases/other", sha, now).reasons.includes("PRODUCTION_SHA_MISMATCH"));
  console.log("TOP3_FET_Q102_PROMOTION_READINESS_SELFTEST_PASS");
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const snapshotPath = process.env.TOP3_FET_Q102_SHADOW_SNAPSHOT_PATH || "/var/lib/disdex/top3-fet-q102-shadow/snapshot.json";
  const currentLink = process.env.DISDEX_CURRENT_RELEASE_LINK || "/home/deploy/disdex-trading/current";
  const expectedProductionSha = process.env.TOP3_FET_Q102_EXPECTED_PRODUCTION_SHA || "b6b62bbadf1abe25d8ef31f5f133515b52a0df1c";
  const maximumAgeMs = Number(process.env.TOP3_FET_Q102_READINESS_MAX_AGE_MS || "180000");
  const [snapshotRaw, currentPath] = await Promise.all([readFile(snapshotPath, "utf8"), readlink(currentLink)]);
  const result = evaluatePromotionReadiness(JSON.parse(snapshotRaw), currentPath, expectedProductionSha, Date.now(), maximumAgeMs);
  console.log(JSON.stringify(result));
  if (result.status !== "PROMOTION_READINESS_PASS") process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "PROMOTION_READINESS_ERROR", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
