import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildAiViewDocument } from "../lib/server/ai-view";
import { toPublicPortfolioSummary } from "../lib/server/live-portfolio";

const surface = {
  ok: true,
  readOnly: true as const,
  tradingMutation: 0 as const,
  checkedAt: "2026-08-28T00:00:00.000Z",
  source: "VPS runner state / sanitized decision snapshot",
  refreshIntervalMinutes: 180,
  runtime: {
    checkedAt: "2026-08-28T00:00:00.000Z",
    units: [
      { id: "V12_X1.00_ALL", label: "V12", status: "LIVE" as const, releaseSha: "sha", venue: "Aster", timeframe: "2h", entryPolicy: "Top2", protection: "risk", note: "read-only" },
      { id: "PENGU_DUAL_LS_V2_FINAL", label: "PENGU", status: "STALE" as const, releaseSha: "sha", venue: "Aster", timeframe: "1h", entryPolicy: "dual", protection: "risk", note: "read-only", reason: "PENGU runner stateが更新されていません。" },
      { id: "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96", label: "V52", status: "UNAVAILABLE" as const, releaseSha: "sha", venue: "Aster", timeframe: "window", entryPolicy: "Top2", protection: "risk", note: "read-only", reason: "参照データ未取得" },
    ],
  },
  v12Observability: {
    decision: { symbol: "SOLUSDT", side: "LONG", rank: 1, score: 0.42, btcRegime: "NEUTRAL", momentum: 0.01, volumeRatio: 0.8, selectionConfirmed: false, candidates: [{ symbol: "SOLUSDT", side: "LONG", rank: 1, score: 0.42, momentum: 0.01, volumeRatio: 0.8, signalGate: { status: "blocked" as const, detail: "BTC regime=NEUTRALの必要score未達" } }] },
    executionTrace: { currentStage: "signal-gate-blocked", currentStageLabel: "候補順位のみ", summary: "発注Signal未成立", nextAction: "次の確定足で再評価", steps: [{ key: "gate", label: "Signal Gate", state: "blocked" as const, detail: "BTC regime=NEUTRALの必要score未達" }] },
  },
  penguRuntime: {
    status: "STALE" as const,
    reason: "runner stateが古いためLIVE確認しません。",
    latestSignal: { side: 1, reason: "Long/Short条件未成立", features: { btcReturn24h: 0.1 }, decision: { longEligible: false, shortEligible: false, active: false }, diagnostics: { latestCompletedPenguTs: 1, latestCompletedBtcTs: 1 } },
    executionTrace: { currentStage: "signal-blocked", currentStageLabel: "条件不足", summary: "未成立", nextAction: "次の確定足", steps: [{ key: "direction", label: "Long / Short", state: "blocked" as const, detail: "条件未成立" }] },
    failures: [{ message: "PENGU/BTC H1 timestamps are not fully aligned: PENGU=1000, BTC=999, aligned=999" }],
    resolvedFailures: [],
  },
  v52Top2Observability: {
    status: "UNAVAILABLE" as const,
    referenceStatus: "UNKNOWN",
    referenceOrdersAllowed: false,
    referenceHealth: { ready: false, reason: "REFERENCE_SERVICE_UNAVAILABLE" },
    killSwitchActive: false,
    activeV50Slots: 0,
    v50DailyEntries: 0,
    positions: [],
    windows: [{ window: "11:30", decisionWindowEntered: true, signalCaptureSucceeded: false, transientRetryCount: 0, candidates: [{ candidateRank: 1, symbol: "NVDAUSDT", basisBps: 40 }], entries: [], rejections: [{ candidateRank: 1, symbol: "NVDAUSDT", orderBlockedReason: "BASIS_BELOW_65" }] }],
    errors: ["reference data unavailable"],
  },
} as const;

const document = buildAiViewDocument(surface, {
  status: "AVAILABLE",
  capturedAt: "2026-08-28T00:00:00.000Z",
  positionCount: 1,
  positions: [{ symbol: "SOLUSDT", side: "LONG", protected: true }],
  openOrderCount: 1,
  protectedOrderCount: 1,
});

assert.equal(document.readOnly, true);
assert.equal(document.tradingMutation, 0);
assert.equal(document.strategies.length, 3);
assert.match(document.system.status, /FAIL CLOSED|DEGRADED|LIVE \/ HEALTHY/);
assert.equal(document.v12.candidates[0]?.gate, "BLOCKED");
assert.equal(document.v52.windows[0]?.candidates[0]?.symbol, "NVDAUSDT");
assert.equal(document.v52.runtimeStatus, "UNAVAILABLE");
assert.equal(document.pengu.runtimeStatus, "STALE");
assert.equal(document.portfolio.positionCount, 1);
const serialized = JSON.stringify(document);
for (const forbidden of ["api_key", "private_key", "process.env", "DisDex.pem", "orderId", "tradeId", "balanceUsd", "entryPrice", "markPrice", "quantity", "C:\\Users\\dis", "/home/deploy/"]) {
  assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, `secret field leaked: ${forbidden}`);
}
assert.match(JSON.stringify(document.statusVocabulary), /PASS/);
assert.match(JSON.stringify(document.statusVocabulary), /FAIL/);
assert.match(JSON.stringify(document.statusVocabulary), /WAIT/);
assert.match(JSON.stringify(document.statusVocabulary), /BLOCKED/);
assert.match(JSON.stringify(document.statusVocabulary), /UNKNOWN/);

const publicPortfolio = toPublicPortfolioSummary({
  ok: true,
  capturedAt: "2026-08-28T00:00:00.000Z",
  account: { balanceUsd: 999, availableUsd: 888, unrealizedPnlUsd: 1 },
  positions: [{ symbol: "SOLUSDT", side: "LONG", positionSide: "BOTH", quantity: 123, entryPrice: 10, markPrice: 11, notionalUsd: 12, unrealizedPnlUsd: 1 }],
  orders: { count: 1, protectionCount: 1, items: [{ symbol: "SOLUSDT", side: "SELL", type: "STOP_MARKET", status: "NEW", quantity: 123, protection: true }] },
});
assert.deepEqual(publicPortfolio, {
  status: "AVAILABLE",
  capturedAt: "2026-08-28T00:00:00.000Z",
  positionCount: 1,
  positions: [{ symbol: "SOLUSDT", side: "LONG", protected: true }],
  openOrderCount: 1,
  protectedOrderCount: 1,
});
assert.equal("balanceUsd" in publicPortfolio, false);
assert.equal("quantity" in publicPortfolio.positions[0], false);

const liveReferenceBlocked = buildAiViewDocument({
  ...surface,
  runtime: {
    ...surface.runtime,
    units: surface.runtime.units.map((unit) => unit.label === "V52" ? { ...unit, status: "LIVE" as const } : unit),
  },
  v52Top2Observability: {
    ...surface.v52Top2Observability,
    status: "LIVE" as const,
    referenceOrdersAllowed: false,
    referenceHealth: { ready: false, reason: "REFERENCE_QUOTE_STALE:MSFT(2058ms)" },
  },
});
assert.equal(liveReferenceBlocked.v52.runtimeStatus, "LIVE");
assert.equal(liveReferenceBlocked.v52.state, "BLOCKED");
assert.equal(liveReferenceBlocked.v52.referenceGate, "BLOCKED");
assert.equal(liveReferenceBlocked.strategies.find((strategy) => strategy.id === "V52")?.state, "BLOCKED");

const decisionRoute = fs.readFileSync(path.join(process.cwd(), "app/api/system/decision-status/route.ts"), "utf8");
assert.match(decisionRoute, /loadDecisionStatusSurface/);
const aiViewPage = fs.readFileSync(path.join(process.cwd(), "app/ai-view/page.tsx"), "utf8");
assert.match(aiViewPage, /force-dynamic/);
assert.match(aiViewPage, /tradingMutation/);
assert.match(aiViewPage, /loadDecisionStatusSurface/);
assert.equal(aiViewPage.includes('"use client"'), false);
assert.equal(aiViewPage.includes("/api/system/decision-status"), false);
assert.match(aiViewPage, /ai-view-side-long/);
assert.match(aiViewPage, /ai-view-side-short/);
assert.match(aiViewPage, /ai-view-runtime-live/);
const globalCss = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
assert.match(globalCss, /\.ai-view-shell\s*\{[\s\S]*background:\s*transparent;/);
assert.match(globalCss, /\.ai-view-shell\s*\{[\s\S]*color:\s*var\(--foreground\);/);
assert.match(globalCss, /\.ai-view-header,[\s\S]*background:\s*linear-gradient\(180deg, rgba\(8, 10, 15, 0\.34\), rgba\(3, 5, 9, 0\.78\)\)/);
assert.doesNotMatch(globalCss, /\.ai-view-header,[\s\S]*background:\s*#ffffff/);
assert.match(globalCss, /\.status-pass\s*\{[\s\S]*color:\s*#d1fae5;/);
assert.match(globalCss, /\.status-fail\s*\{[\s\S]*color:\s*#ffe4e6;/);
assert.match(globalCss, /\.ai-view-side-long\s*\{[\s\S]*color:\s*#d1fae5;/);
assert.match(globalCss, /\.ai-view-side-short\s*\{[\s\S]*color:\s*#ffe4e6;/);
const layout = fs.readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8");
assert.match(layout, /"\/ai-view"/);
console.log("AI_VIEW_DOCUMENT_SELFTEST_PASS");
