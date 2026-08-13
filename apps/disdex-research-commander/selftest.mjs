import assert from "node:assert/strict";
import { createApp } from "./server.mjs";
import {
  assertRequestId,
  assertResearchPath,
  assertWorkflowAllowed,
  assertShardCount,
  guardrailSummary,
} from "./lib/policy.mjs";

const TEST_TOKEN = "test-research-token";

const fakeGithub = {
  async getResearchStatus() {
    return {
      branch: { branch: "research/win80-profit-optimization-v1", headSha: "a".repeat(40) },
      activeRuns: [],
      completedRuns: [{ id: 1 }],
      artifacts: [{ id: 2 }],
    };
  },
  async getCompletedBt() { return [{ id: 1, sha: "a".repeat(40) }]; },
  async getSafeTree() { return [{ path: "research/commander/ledger/example.json" }]; },
  async readSafeFile(path) { return { path, sha: "b".repeat(40), content: "{}" }; },
  async registerCandidate() { throw new Error("RESEARCH_GITHUB_WRITE_DISABLED"); },
  async launchBtShards({ count = 1, dryRun = true, requestId = null } = {}) {
    if (count > 5) throw new Error("RESEARCH_SHARD_LIMIT_EXCEEDED");
    assertRequestId(requestId);
    if (!dryRun) throw new Error("RESEARCH_GITHUB_WRITE_DISABLED");
    return { dryRun, requested: count, active: 0, freeSlots: 5 };
  },
};

const app = createApp({ token: TEST_TOKEN, github: fakeGithub });
const auth = { authorization: `Bearer ${TEST_TOKEN}` };

async function rpc(method, id, params = {}, headers = auth) {
  return app.handle({ method: "POST", path: "/mcp", headers, body: { jsonrpc: "2.0", id, method, params } });
}

function resultText(response) {
  return JSON.stringify(response.body);
}

const unauth = await rpc("initialize", 1, {}, {});
assert.equal(unauth.status, 401, "unauthenticated request must reject");

const initialize = await rpc("initialize", 2, { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "selftest", version: "1" } });
assert.equal(initialize.status, 200);
assert.equal(initialize.body.result.serverInfo.name, "disdex-research-commander");

const listed = await rpc("tools/list", 3);
assert.equal(listed.body.result.tools.length, 8, "all eight tools must be exposed");
assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), [
  "get_research_status",
  "get_completed_bt",
  "get_trade_ledger",
  "diagnose_candidate",
  "compare_lineage",
  "register_candidate",
  "launch_bt_shards",
  "get_guardrails",
]);

const guardrails = await rpc("tools/call", 4, { name: "get_guardrails", arguments: {} });
assert.equal(JSON.parse(guardrails.body.result.content[0].text).productionAccess, false);

const status = await rpc("tools/call", 5, { name: "get_research_status", arguments: {} });
assert.equal(JSON.parse(status.body.result.content[0].text).branch, "research/win80-profit-optimization-v1");

const devDiagnosis = await rpc("tools/call", 6, { name: "diagnose_candidate", arguments: { stage: "Development", candidate: { candidateId: "c1", diagnostics: { Development: { sampleSufficiency: 12 } } } } });
assert.equal(JSON.parse(devDiagnosis.body.result.content[0].text).status, "AVAILABLE");

const holdoutDiagnosis = await rpc("tools/call", 7, { name: "diagnose_candidate", arguments: { stage: "Holdout", candidate: {} } });
assert.equal(holdoutDiagnosis.body.result.isError, true, "Holdout diagnostics must reject");

const dryRun = await rpc("tools/call", 8, { name: "launch_bt_shards", arguments: { count: 1, dryRun: true, requestId: "selftest" } });
assert.equal(JSON.parse(dryRun.body.result.content[0].text).dryRun, true);

const sixShard = await rpc("tools/call", 9, { name: "launch_bt_shards", arguments: { count: 6, dryRun: true } });
assert.equal(sixShard.body.result.isError, true, "six shards must reject");

const unsafeRequestId = await rpc("tools/call", 10, { name: "launch_bt_shards", arguments: { count: 1, dryRun: true, requestId: "../../production" } });
assert.equal(unsafeRequestId.body.result.isError, true, "unsafe request ids must reject");

const duplicate = await rpc("tools/call", 11, { name: "launch_bt_shards", arguments: { count: 1, dryRun: false, requestId: "duplicate" } });
assert.equal(duplicate.body.result.isError, true, "write-disabled launch must reject");

assert.throws(() => assertResearchPath("research/commander/../production.json", { write: true }), /TRAVERSAL/);
assert.throws(() => assertResearchPath("ops/systemd/live.service", { write: true }), /NOT_ALLOWED|PRODUCTION/);
assert.throws(() => assertWorkflowAllowed("disdex-v96-v52-live.service"), /WORKFLOW_NOT_ALLOWED/);
assert.throws(() => assertShardCount(6), /SHARD_LIMIT/);
assert.throws(() => assertRequestId("../../production"), /REQUEST_ID_INVALID/);

const secretAttempt = await rpc("tools/call", 12, { name: "diagnose_candidate", arguments: { stage: "Development", candidate: { candidateId: "bad", apiKey: "DO_NOT_RETURN" } } });
assert.equal(secretAttempt.body.result.isError, true);
assert.equal(resultText(secretAttempt).includes("DO_NOT_RETURN"), false, "secret-like data must not appear in response");

assert.equal(guardrailSummary().liveAccess, false);
console.log("DISDEX_RESEARCH_COMMANDER_SELFTEST_PASS");
console.log("authReject=PASS");
console.log("mcpInitialize=PASS");
console.log("toolsList=PASS");
console.log("readOnlySmoke=PASS");
console.log("pathTraversalReject=PASS");
console.log("productionPathWriteReject=PASS");
console.log("workflowAllowlistReject=PASS");
console.log("sixShardReject=PASS");
console.log("unsafeRequestIdReject=PASS");
console.log("duplicateLaunchReject=PASS");
console.log("confirmationHoldoutIsolation=PASS");
console.log("credentialLeakage=PASS");

