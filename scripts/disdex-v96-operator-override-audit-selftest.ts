import assert from "node:assert/strict";

import type { DisDexV96OperatorOverrideApproval } from "../lib/disdex-v96-live-risk-controls";
import {
    disDexV96OperatorOverrideAuditFromApproval,
    disDexV96OperatorOverrideAuditMatches,
    disDexV96OperatorOverrideAuditMismatches,
} from "../lib/disdex-v96-operator-override-audit";

const approval: DisDexV96OperatorOverrideApproval = {
    status: "APPROVED",
    strategyId: "V35_WEIGHT_BAND_PLUS_FIXED_STRONG_V96",
    configFingerprint: "a".repeat(64),
    approvedCommitSha: "b".repeat(40),
    operator: "operator-selftest",
    reason: "audit matching self-test",
    approvedAt: "2026-07-29T00:00:00.000Z",
    expiresAt: "2026-07-30T00:00:00.000Z",
    forwardEvidenceBypassAccepted: true,
    initialPenguGrossCap: 0.15,
    maximumPortfolioGross: 1,
    maximumDailyLossPct: 5,
    maximumDailyLossUsd: 50,
    acknowledgement: "I_APPROVE_DISDEX_V96_OPERATOR_CONTROLLED_LIVE",
    artifactSha256: "c".repeat(64),
};

const audit = disDexV96OperatorOverrideAuditFromApproval(approval);
assert.equal(disDexV96OperatorOverrideAuditMatches(audit, approval), true);
assert.deepEqual(disDexV96OperatorOverrideAuditMismatches(audit, approval), []);

const renewed = { ...approval, approvedAt: "2026-07-29T01:00:00.000Z", artifactSha256: "d".repeat(64) };
assert.equal(disDexV96OperatorOverrideAuditMatches(audit, renewed), false);
assert.deepEqual(disDexV96OperatorOverrideAuditMismatches(audit, renewed).sort(), ["approvedAt", "artifactSha256"]);

const wrongCommit = { ...approval, approvedCommitSha: "e".repeat(40) };
assert.deepEqual(disDexV96OperatorOverrideAuditMismatches(audit, wrongCommit), ["approvedCommitSha"]);

console.log("V96 Operator Override audit self-test: PASS");
