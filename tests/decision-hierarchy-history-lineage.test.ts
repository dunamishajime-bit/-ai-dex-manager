import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  forcedExitCauseFromEvidence,
  parseFillLineageEvidenceLine,
  routeFromFillEvidence,
} from "../lib/server/fill-lineage-evidence";

test("fill evidence extracts strategy route and kill-switch cause without trading mutation", () => {
  const evidence = parseFillLineageEvidenceLine(JSON.stringify({
    strategyId: "PENGU_DUAL_LS_V2_FINAL",
    eventType: "EXIT_FILL",
    symbol: "PENGUUSDT",
    orderId: "123",
    reduceOnly: true,
    entryVersion: "RECOVERY_V8",
    reason: "SHARED_KILL_SWITCH:FLATTEN_MANAGED",
  }));
  assert.ok(evidence);
  assert.equal(routeFromFillEvidence(evidence), "Recovery V8");
  assert.equal(forcedExitCauseFromEvidence(evidence), "KILL_SWITCH");
});

test("fill evidence recognizes shared-risk forced exits separately", () => {
  const evidence = parseFillLineageEvidenceLine(JSON.stringify({
    strategyId: "PENGU_DUAL_LS_V2_FINAL",
    eventType: "EXIT_FILL",
    orderId: "456",
    reduceOnly: true,
    reason: "Shared crypto daily-risk state blocked PENGU entry: DAY_MISMATCH.",
  }));
  assert.equal(forcedExitCauseFromEvidence(evidence || undefined), "RISK_FORCED_EXIT");
});

test("decision status is split into four logic pages and Q102 has per-symbol observer", async () => {
  const files = await Promise.all([
    readFile("app/decision-status/page.tsx", "utf8"),
    readFile("app/decision-status/v12/page.tsx", "utf8"),
    readFile("app/decision-status/pengu/page.tsx", "utf8"),
    readFile("app/decision-status/q102/page.tsx", "utf8"),
    readFile("app/decision-status/v52/page.tsx", "utf8"),
    readFile("components/features/DecisionStatusPanel.tsx", "utf8"),
    readFile("lib/server/quality102-symbol-observability.ts", "utf8"),
  ]);
  assert.match(files[0], /logic="overview"/);
  assert.match(files[1], /logic="v12"/);
  assert.match(files[2], /logic="pengu"/);
  assert.match(files[3], /logic="q102"/);
  assert.match(files[4], /logic="v52"/);
  assert.match(files[5], /Q102 通貨別 Causal V4 判定/);
  assert.match(files[5], /\/decision-status\/v12/);
  assert.match(files[5], /\/decision-status\/pengu/);
  assert.match(files[5], /\/decision-status\/q102/);
  assert.match(files[5], /\/decision-status\/v52/);
  assert.match(files[6], /buildQuality102CausalV4Signal/);
  assert.match(files[6], /tradingMutation: 0/);
});

test("history UI exposes granular route colors and forced-exit cause", async () => {
  const [page, server] = await Promise.all([
    readFile("app/history/page.tsx", "utf8"),
    readFile("lib/server/aster-trade-history.ts", "utf8"),
  ]);
  assert.match(page, /PENGU Recovery V8/);
  assert.match(page, /Q102 HIGH_VOL/);
  assert.match(page, /Kill Switch 強制決済/);
  assert.match(page, /決済原因/);
  assert.match(server, /matched\.attribution/);
  assert.match(server, /forcedExitCauseFromEvidence/);
  assert.doesNotMatch(server, /negative-pnl-no-logic/);
});
