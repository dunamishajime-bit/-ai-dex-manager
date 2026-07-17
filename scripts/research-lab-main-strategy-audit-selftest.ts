import assert from "node:assert/strict";

import { STRATEGY_CONFIG } from "../config/strategyConfig";
import { WIN80_ULTRA90_MAIN_STRATEGY } from "../lib/win80-ultra90-main-strategy";
import { buildCurrentMainStrategyAuditDiscussion } from "../lib/research-lab/perp/main-strategy-audit-discussion";

// Updating this audited path intentionally triggers one immediate current-main audit after deployment.
const log = buildCurrentMainStrategyAuditDiscussion({
  cycle: 9,
  profile: "attack",
  startedAt: "2026-07-17T00:00:00.000Z",
});

assert.equal(log.version, 1);
assert.equal(log.cycle, 9);
assert.equal(log.topStrategyIds.length, 1);
assert.equal(log.topStrategyIds[0], WIN80_ULTRA90_MAIN_STRATEGY.id);
assert.ok(log.title.includes(WIN80_ULTRA90_MAIN_STRATEGY.id));
assert.ok(log.summary.includes("研究Proxyではなく"));
assert.equal(log.bestOosMonthlyPct, null);
assert.equal(log.finalCandidates, 0);
assert.ok(log.messages.length >= 7);

const transcript = log.messages.map((item) => `${item.content}\n${item.evidence.map((entry) => `${entry.label}:${entry.value}`).join("\n")}`).join("\n");
assert.ok(transcript.includes("Score 80"));
assert.ok(transcript.includes("Score 90"));
assert.ok(transcript.includes("50%"));
assert.ok(transcript.includes("70%"));
assert.ok(transcript.includes("100%"));
assert.ok(transcript.includes("16.81%"));
assert.ok(transcript.includes("完全未使用OOS"));
assert.ok(transcript.includes("SPLIT_50"));
assert.ok(transcript.includes("SWITCH_70"));
assert.ok(transcript.includes("REJECT"));
assert.ok(!transcript.includes("deep-c9-baseline"));
assert.equal(STRATEGY_CONFIG.MAIN_STRATEGY_REAL_TRADING_ENABLED, false);
assert.equal(STRATEGY_CONFIG.MAIN_STRATEGY_ID, WIN80_ULTRA90_MAIN_STRATEGY.id);

const roles = log.messages.map((item) => item.role);
assert.ok(roles.includes("moderator"));
assert.ok(roles.includes("researcher"));
assert.ok(roles.includes("overfit_critic"));
assert.ok(roles.includes("tail_risk_critic"));
assert.ok(roles.includes("execution_critic"));
assert.ok(roles.includes("cio"));

console.log("MAIN_STRATEGY_AUDIT_DISCUSSION_SELFTEST_OK");
