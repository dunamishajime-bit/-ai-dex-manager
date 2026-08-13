import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { diagnoseEvidence, tokenSimilarity } from './lib/diagnostics.mjs';
import {
  assertNoHoldoutStage,
  assertRequestId,
  assertResearchPath,
  assertResearchWorkflow,
  assertSafeOutput,
} from './lib/policy.mjs';

const bnb = diagnoseEvidence({
  strategyId: 'TEST_BNB', pair: 'BNB',
  development: { trades: 8, returnPct: 1, pf: 1.3, maxDDPct: -2 },
  validation: { trades: 0, returnPct: 0, pf: 0, maxDDPct: 0 },
  validationStress: { pf: 0 },
});
assert.equal(bnb.dominantCause.code, 'TRADE_STARVATION');
assert.ok(bnb.causes.some((x) => x.code === 'BNB_CONSENSUS_STARVATION'));

const btc = diagnoseEvidence({
  strategyId: 'TEST_BTC', pair: 'BTC',
  development: { trades: 20, returnPct: 2, pf: 1.4, maxDDPct: -3 },
  validation: { trades: 10, returnPct: 0.5, pf: 1.25, maxDDPct: -2, falseStartRatePct: 20, pfWithoutBest: 1.1 },
  validationStress: { pf: 1.05 },
  waveDiagnostics: { validation: { captureRatePct: 40, medianWaveMfeCapturedPct: 8 } },
});
assert.ok(btc.causes.some((x) => x.code === 'BTC_OWNERSHIP_LEAK'));
assert.ok(tokenSimilarity('relative impulse scout breadth extension', 'relative impulse scout then breadth extension') > 0.6);
assert.ok(tokenSimilarity('relative impulse scout', 'volatility shock event expiry') < 0.35);
assert.equal(btc.metrics.raw, undefined, 'raw evidence must not be returned');

assert.equal(assertResearchPath('research/commander/candidates/demo.json', { write: true }), 'research/commander/candidates/demo.json');
assert.throws(() => assertResearchPath('../production.env', { write: true }), /RESEARCH_PATH/);
assert.throws(() => assertResearchPath('research/production/runner.json'), /PRODUCTION_PATH/);
assert.equal(assertResearchWorkflow('disdex-research-commander-bt.yml'), 'disdex-research-commander-bt.yml');
assert.throws(() => assertResearchWorkflow('disdex-v96-v52-live.yml'), /WORKFLOW_NOT_ALLOWLISTED/);
assert.equal(assertRequestId('research-smoke-1'), 'research-smoke-1');
assert.throws(() => assertRequestId('../../live'), /RESEARCH_REQUEST_ID_INVALID/);
assert.throws(() => assertNoHoldoutStage({ holdout: { trades: 1 } }), /CONFIRMATION_HOLDOUT_INACCESSIBLE/);
assert.doesNotThrow(() => assertNoHoldoutStage({ confirmationHoldoutUntouched: true }));
assert.throws(() => assertSafeOutput({ apiKey: 'redacted' }), /CREDENTIAL_LIKE_OUTPUT_REJECTED/);

const port = 18979;
const bearer = 'research-selftest-bearer-token-32-characters-min';
const appDir = fileURLToPath(new URL('.', import.meta.url));
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: appDir,
  env: {
    ...process.env,
    PORT: String(port),
    MCP_AUTH_TOKEN: bearer,
    DISDEX_RESEARCH_GITHUB_TOKEN: 'selftest-token',
    GITHUB_REPO: 'dunamishajime-bit/-ai-dex-manager',
    GITHUB_RESEARCH_BRANCH: 'research/win80-profit-optimization-v1',
    GITHUB_WRITE_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });
try {
  for (let i = 0; i < 50 && !output.includes('listening on'); i++) {
    await delay(100);
    if (child.exitCode !== null) throw new Error(`server exited: ${output}`);
  }
  assert.match(output, /listening on/);

  const request = async (body, auth = bearer, path = '/mcp') => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (auth !== null) headers.authorization = `Bearer ${auth}`;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    return { response, text, parsed };
  };

  const unauth = await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } } }, null);
  assert.equal(unauth.response.status, 401);

  const initialized = await request({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } } });
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.parsed?.result?.serverInfo?.name, 'disdex-research-commander');

  const listed = await request({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
  assert.equal(listed.response.status, 200);
  const names = listed.parsed?.result?.tools?.map((tool) => tool.name) ?? [];
  assert.deepEqual(names.sort(), ['compare_lineage','diagnose_candidate','get_completed_bt','get_guardrails','get_research_status','get_trade_ledger','launch_bt_shards','register_candidate'].sort());

  const guardrails = await request({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_guardrails', arguments: {} } });
  assert.equal(guardrails.response.status, 200);
  assert.equal(guardrails.parsed?.result?.structuredContent?.mode, 'research-only');

  const healthNoAuth = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(healthNoAuth.status, 401);
  const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${bearer}` } });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  console.log('MCP initialize: PASS');
  console.log('MCP tools/list: PASS');
  console.log('MCP authenticated read-only smoke: PASS');
  console.log('authentication reject: PASS');
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exited, delay(500)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

console.log('DISDEX_RESEARCH_COMMANDER_SELFTEST_PASS');

