import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { buildV12V4HpPresentation } from "../lib/v12-v4-hp-ui";
import { HISTORICAL_FILL_LINEAGE_BY_ORDER_ID } from "../lib/server/historical-fill-lineage";
import {
  deriveTradeHistoryAttribution,
  formatTradeHistoryAttributionLabel,
  getTradeHistoryAttributionTone,
} from "../lib/trade-history-attribution";
import type { V12V4HpSnapshot } from "../lib/v12-v4-hp-contract";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const now = Date.UTC(2026, 9, 12, 6);

function snapshot(overrides: Partial<V12V4HpSnapshot> = {}): V12V4HpSnapshot {
  return {
    schema: "v12-v4-hp-status/v1",
    target: { policyId: "V2_M150_D05_CORE_NATIVE", expectedRouteCount: 41 },
    displayStatus: "STAGED_NOT_LIVE",
    actual: {
      currentReleaseSha: shaA,
      activeRunnerId: `disdex-v12-v4-canary@${shaA}.service`,
      activeRunnerState: "active/running",
      activeRunnerSha: shaA,
      v4RunnerMode: "CANARY",
      v12PrimaryMode: "LEGACY",
      legacyV12RunnerActive: true,
      v4ReleaseSha: shaA,
      heartbeatSha: shaA,
      orderEnabled: false,
    },
    timestamps: { checkedAt: now, heartbeatUpdatedAt: now, decisionTs: now, capturedAtMs: now },
    freshness: { heartbeat: true, decision: true },
    candidates: [],
    filtered: [],
    routeCoverage: {
      expected: 41, observed: 0, candidateCount: 0, filteredCount: 0,
      unobserved: [], completeness: false,
      semantics: "EMITTED_ROUTE_PRESENCE_ONLY_NOT_EVALUATION_COVERAGE",
    },
    errors: [],
    readOnly: true,
    tradingMutation: 0,
    ...overrides,
  };
}

test("target V4 contract is separated from actual staged legacy runtime", () => {
  const presentation = buildV12V4HpPresentation(snapshot());
  assert.equal(presentation.target.policyId, "V2_M150_D05_CORE_NATIVE");
  assert.equal(presentation.target.expectedRouteCount, 41);
  assert.equal(presentation.runtimeStatus, "STAGED_NOT_LIVE");
  assert.equal(presentation.runtimeLabel, "V4仕様 / 本番未切替");
  assert.equal(presentation.isLiveVerified, false);
  assert.match(presentation.actualSummary, /CANARY/);
  assert.match(presentation.actualSummary, /LEGACY/);
});

test("claimed LIVE is downgraded if any actual release/heartbeat/primary-mode evidence disagrees", () => {
  const inconsistent = snapshot({
    displayStatus: "LIVE_VERIFIED",
    actual: {
      currentReleaseSha: shaA,
      activeRunnerId: `disdex-v12-v4@${shaB}.service`,
      activeRunnerState: "active/running",
      activeRunnerSha: shaB,
      v4RunnerMode: "CERTIFIED",
      v12PrimaryMode: "V4",
      legacyV12RunnerActive: false,
      v4ReleaseSha: shaB,
      heartbeatSha: shaB,
      orderEnabled: true,
    },
  });
  const presentation = buildV12V4HpPresentation(inconsistent);
  assert.equal(presentation.runtimeStatus, "SHA_MISMATCH");
  assert.equal(presentation.isLiveVerified, false);
  assert.match(presentation.runtimeLabel, /SHA不一致/);
});

test("runtime freshness, source errors and unavailable evidence remain distinct", () => {
  assert.equal(buildV12V4HpPresentation(snapshot({ displayStatus: "STALE" })).runtimeLabel, "STALE / 発注不可");
  assert.equal(buildV12V4HpPresentation(snapshot({ displayStatus: "SOURCE_ERROR" })).runtimeLabel, "取得エラー / 発注不可");
  assert.equal(buildV12V4HpPresentation(snapshot({ displayStatus: "UNAVAILABLE" })).runtimeLabel, "runtime未取得 / LIVE未確認");
  const noData = buildV12V4HpPresentation(null, { loading: false, error: "unavailable" });
  assert.equal(noData.runtimeStatus, "SOURCE_ERROR");
  assert.equal(noData.isLiveVerified, false);
});

test("current HP surfaces use the V4 status panel and do not label legacy V12 snapshot as V4", async () => {
  const [home, positions, overview, v12Page, banner, badge, sidebar, decisionPanel] = await Promise.all([
    readFile("app/page.tsx", "utf8"),
    readFile("app/positions/page.tsx", "utf8"),
    readFile("app/decision-status/page.tsx", "utf8"),
    readFile("app/decision-status/v12/page.tsx", "utf8"),
    readFile("components/layout/LiveProductionBanner.tsx", "utf8"),
    readFile("components/layout/LiveRuntimeBadge.tsx", "utf8"),
    readFile("components/layout/Sidebar.tsx", "utf8"),
    readFile("components/features/DecisionStatusPanel.tsx", "utf8"),
  ]);
  for (const source of [home, positions, overview, v12Page]) assert.match(source, /V12V4RuntimePanel/);
  assert.match(v12Page, /V12 V4/);
  assert.doesNotMatch(v12Page, /DecisionStatusPanel logic="v12"/);
  assert.doesNotMatch(home, /v12RuntimeStatus|V12 LIVE確認済み|productionRuntime\?\.v12/);
  assert.doesNotMatch(positions, /productionRuntime\?\.v12|V12 Base|Dynamic Residual/);
  assert.match(banner, /V12V4RuntimePanel|useV12V4HpStatus/);
  assert.match(badge, /Legacy V12/);
  assert.match(sidebar, /V12 V4/);
  assert.match(decisionPanel, /Legacy V12/);
});

test("historical V12 fills keep their original ID/label; only actual V12_V4 strategy identity gets V4 label", () => {
  assert.equal(HISTORICAL_FILL_LINEAGE_BY_ORDER_ID["1045562381"].strategyId, "V12_X1.00_ALL");
  const historical = deriveTradeHistoryAttribution({ source: "local-ledger", strategyId: "V12_X1.00_ALL", reason: "V12 historical Aster order read-back" });
  assert.equal(historical.logicLabel, "V12");
  assert.equal(formatTradeHistoryAttributionLabel({ strategyId: "V12_X1.00_ALL", attribution: historical }), "ロジック発火: V12");
  assert.equal(getTradeHistoryAttributionTone(historical), "v12");

  const actualV4 = deriveTradeHistoryAttribution({ source: "local-ledger", strategyId: "V12_V4", reason: "V12_V4 / route=REC_X01_TIME_24H" });
  assert.equal(actualV4.logicLabel, "V12 V4");
  assert.match(formatTradeHistoryAttributionLabel({ strategyId: "V12_V4", attribution: actualV4 }), /V12 V4/);
  assert.equal(getTradeHistoryAttributionTone(actualV4), "v12-v4");
});
