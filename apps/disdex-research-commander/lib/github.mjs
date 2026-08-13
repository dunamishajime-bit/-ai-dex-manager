import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import {
  MAX_RESEARCH_SHARDS,
  RESEARCH_BRANCH,
  RESEARCH_BT_WORKFLOW,
  RESEARCH_REPO,
  assertNoHoldoutStage,
  assertRequestId,
  assertResearchPath,
  assertResearchWorkflow,
  assertSafeOutput,
} from './policy.mjs';

const API = 'https://api.github.com';
const TOKEN = process.env.DISDEX_RESEARCH_GITHUB_TOKEN ?? '';
const BRANCH = process.env.GITHUB_RESEARCH_BRANCH ?? RESEARCH_BRANCH;
const REPO = process.env.GITHUB_REPO ?? RESEARCH_REPO;
const WRITE_ENABLED = process.env.GITHUB_WRITE_ENABLED === 'true';
const CACHE_ROOT = process.env.DISDEX_RESEARCH_CACHE_DIR ?? '/var/cache/disdex-research-commander';
const READ_WORKFLOWS = Object.freeze([
  RESEARCH_BT_WORKFLOW,
  'win80-profit-optimization.yml',
  'research-lab-ci.yml',
  'research-lab-autonomous.yml',
  'research-lab-phase2-pilot.yml',
  'research-lab-perp-pilot.yml',
  'research-lab-perp-futures-attack.yml',
  'active4-v119.yml',
]);

if (BRANCH !== RESEARCH_BRANCH || REPO !== RESEARCH_REPO) throw new Error('RESEARCH_REPOSITORY_OR_BRANCH_NOT_ALLOWED');

export function config() {
  return {
    repo: REPO,
    branch: BRANCH,
    workflow: RESEARCH_BT_WORKFLOW,
    readWorkflows: READ_WORKFLOWS,
    maxResearchShards: MAX_RESEARCH_SHARDS,
    writeEnabled: WRITE_ENABLED,
    mode: 'research-only',
  };
}

function assertToken() {
  if (!TOKEN) throw new Error('DISDEX_RESEARCH_GITHUB_TOKEN_REQUIRED');
}

export async function gh(apiPath, init = {}) {
  assertToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${API}/repos/${REPO}${apiPath}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${TOKEN}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'DisDex-Research-Commander',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GITHUB_API_${res.status}:${text.slice(0, 180)}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return res.json();
    return res.arrayBuffer();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('GITHUB_API_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function encoded(value) { return value.split('/').map(encodeURIComponent).join('/'); }

export async function listRecentRuns({ perPage = 50, workflowFiles = READ_WORKFLOWS } = {}) {
  const runs = [];
  for (const workflowFile of workflowFiles) {
    if (!READ_WORKFLOWS.includes(workflowFile)) throw new Error('WORKFLOW_READ_NOT_ALLOWLISTED');
    const data = await gh(`/actions/workflows/${encodeURIComponent(workflowFile)}/runs?branch=${encodeURIComponent(BRANCH)}&per_page=${Math.min(perPage, 100)}`);
    for (const run of data.workflow_runs ?? []) runs.push({ ...run, researchWorkflowFile: workflowFile });
  }
  const deduped = [...new Map(runs.map((run) => [run.id, run])).values()];
  return deduped.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 100);
}

export async function listJobs(runId) {
  if (!Number.isInteger(Number(runId)) || Number(runId) <= 0) throw new Error('RESEARCH_RUN_ID_INVALID');
  const data = await gh(`/actions/runs/${runId}/jobs?per_page=100`);
  return data.jobs ?? [];
}

export async function getShardCapacity(maxShards = MAX_RESEARCH_SHARDS) {
  if (!Number.isInteger(maxShards) || maxShards < 1 || maxShards > MAX_RESEARCH_SHARDS) throw new Error('RESEARCH_SHARD_LIMIT_EXCEEDED');
  const runs = await listRecentRuns({ perPage: 30, workflowFiles: [RESEARCH_BT_WORKFLOW] });
  const activeRuns = runs.filter((run) => ['queued', 'in_progress', 'pending', 'waiting'].includes(run.status));
  let queued = 0;
  let inProgress = 0;
  const jobs = [];
  for (const run of activeRuns) {
    const runJobs = await listJobs(run.id);
    for (const job of runJobs) {
      if (['queued', 'pending', 'waiting'].includes(job.status)) queued += 1;
      if (job.status === 'in_progress') inProgress += 1;
      jobs.push({ runId: run.id, workflow: RESEARCH_BT_WORKFLOW, jobId: job.id, name: job.name, status: job.status });
    }
  }
  return { maxShards, queued, inProgress, occupied: queued + inProgress, available: Math.max(0, maxShards - queued - inProgress), jobs };
}

export async function listArtifacts(runId) {
  if (!Number.isInteger(Number(runId)) || Number(runId) <= 0) throw new Error('RESEARCH_RUN_ID_INVALID');
  const data = await gh(`/actions/runs/${runId}/artifacts?per_page=100`);
  return data.artifacts ?? [];
}

function cachePath(runId, artifactId, sha) {
  const key = crypto.createHash('sha256').update(`${runId}:${artifactId}:${sha}`).digest('hex');
  return path.join(CACHE_ROOT, `${key}.zip`);
}

export async function downloadArtifactEntries(artifactId, { runId = 0, sha = 'unknown' } = {}) {
  const target = cachePath(runId, artifactId, sha);
  let bytes;
  try {
    bytes = await fs.readFile(target);
  } catch {
    const remote = await gh(`/actions/artifacts/${artifactId}/zip`);
    bytes = Buffer.from(remote);
    await fs.mkdir(CACHE_ROOT, { recursive: true, mode: 0o750 });
    try { await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o640 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const zip = new AdmZip(bytes);
  return zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => ({ name: entry.entryName, text: entry.getData().toString('utf8') }));
}

export async function extractEvidenceFromRun(runId) {
  const runs = await listRecentRuns({ perPage: 100 });
  const run = runs.find((item) => item.id === Number(runId));
  if (!run) throw new Error('RESEARCH_RUN_NOT_FOUND');
  const artifacts = await listArtifacts(runId);
  const evidence = [];
  for (const artifact of artifacts) {
    const entries = await downloadArtifactEntries(artifact.id, { runId, sha: run.head_sha });
    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith('.json')) continue;
      if (/confirmation|holdout|final2026|final_holdout/i.test(entry.name)) throw new Error('CONFIRMATION_HOLDOUT_INACCESSIBLE');
      try {
        const parsed = JSON.parse(entry.text);
        assertNoHoldoutStage(parsed);
        evidence.push({ artifactId: artifact.id, artifactName: artifact.name, file: entry.name, data: parsed });
      } catch (error) {
        if (String(error.message).includes('HOLDOUT')) throw error;
      }
    }
  }
  return evidence;
}

export async function getCompletedEvidence({ limitRuns = 10 } = {}) {
  if (!Number.isInteger(limitRuns) || limitRuns < 1 || limitRuns > 20) throw new Error('RESEARCH_LIMIT_INVALID');
  const runs = (await listRecentRuns({ perPage: 100 })).filter((run) => run.status === 'completed' && run.conclusion === 'success').slice(0, limitRuns);
  const out = [];
  for (const run of runs) {
    const evidence = await extractEvidenceFromRun(run.id);
    out.push({ run: { id: run.id, name: run.name, conclusion: run.conclusion, headSha: run.head_sha, createdAt: run.created_at, updatedAt: run.updated_at }, evidence });
  }
  return out;
}

export async function dispatchWorkflow({ workflowFile, expectedShards = 1, inputs = {}, acknowledgement, requestId = null }) {
  assertResearchWorkflow(workflowFile);
  if (acknowledgement !== 'RESEARCH_ONLY_EXECUTION') throw new Error('RESEARCH_ONLY_ACK_REQUIRED');
  if (!WRITE_ENABLED) throw new Error('RESEARCH_GITHUB_WRITE_DISABLED');
  if (!Number.isInteger(expectedShards) || expectedShards < 1 || expectedShards > MAX_RESEARCH_SHARDS) throw new Error('RESEARCH_SHARD_LIMIT_EXCEEDED');
  const safeRequestId = assertRequestId(requestId ?? inputs.request_id);
  const inputKeys = Object.keys(inputs ?? {});
  if (inputKeys.some((key) => !['request_id'].includes(key))) throw new Error('RESEARCH_WORKFLOW_INPUT_NOT_ALLOWED');
  const capacity = await getShardCapacity(MAX_RESEARCH_SHARDS);
  if (capacity.occupied + expectedShards > MAX_RESEARCH_SHARDS) throw new Error(`RESEARCH_SHARD_CAPACITY_EXCEEDED:${capacity.occupied}`);
  const active = (await listRecentRuns({ perPage: 100, workflowFiles: [RESEARCH_BT_WORKFLOW] })).filter((run) => ['queued', 'in_progress', 'pending', 'waiting'].includes(run.status));
  if (active.some((run) => String(run.display_title ?? '').includes(safeRequestId))) throw new Error('DUPLICATE_RESEARCH_RUN_REJECTED');
  for (let shard = 1; shard <= expectedShards; shard += 1) {
    await gh(`/actions/workflows/${encodeURIComponent(RESEARCH_BT_WORKFLOW)}/dispatches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: BRANCH, inputs: { shard: String(shard), request_id: safeRequestId } }),
    });
  }
  return { dispatched: true, workflowFile: RESEARCH_BT_WORKFLOW, branch: BRANCH, expectedShards, requestId: safeRequestId, capacityBefore: capacity };
}

export async function getContent(filePath) {
  assertResearchPath(filePath);
  return gh(`/contents/${encoded(filePath)}?ref=${encodeURIComponent(BRANCH)}`);
}

function encodeContent(text) { return Buffer.from(text, 'utf8').toString('base64'); }

export async function putResearchFile({ path: filePath, content, message }) {
  if (!WRITE_ENABLED) throw new Error('RESEARCH_GITHUB_WRITE_DISABLED');
  assertResearchPath(filePath, { write: true });
  if (!filePath.startsWith('research/commander/candidates/') || !filePath.endsWith('.json')) throw new Error('RESEARCH_REGISTRY_PATH_REQUIRED');
  assertNoHoldoutStage(content);
  assertSafeOutput(JSON.parse(content));
  return gh(`/contents/${encoded(filePath)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, content: encodeContent(content), branch: BRANCH }),
  });
}

export async function listRegistry() {
  try {
    const data = await getContent('research/commander/candidates');
    return Array.isArray(data) ? data.filter((item) => item.type === 'file' && /^[A-Za-z0-9_.-]+\.json$/.test(item.name)) : [];
  } catch (error) {
    if (String(error).includes('GITHUB_API_404')) return [];
    throw error;
  }
}

export async function readRegistryCandidate(id) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error('CANDIDATE_ID_INVALID');
  try {
    const data = await getContent(`research/commander/candidates/${id}.json`);
    const parsed = JSON.parse(Buffer.from(data.content ?? '', 'base64').toString('utf8'));
    assertNoHoldoutStage(parsed);
    assertSafeOutput(parsed);
    return { ...parsed, _sha: data.sha };
  } catch (error) {
    if (String(error).includes('GITHUB_API_404')) return null;
    throw error;
  }
}

const num = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export function normalizeEvidence(raw) {
  const dev = raw.development ?? raw.dev ?? {};
  const val = raw.validation ?? raw.val ?? {};
  const stress = raw.validationStress ?? raw.stress ?? {};
  const waves = raw.waveDiagnostics?.validation ?? raw.waveDiagnostics ?? {};
  return {
    id: raw.strategyId ?? raw.candidateId ?? raw.candidate ?? 'UNKNOWN',
    pair: raw.pair ?? raw.symbol ?? 'UNKNOWN',
    status: raw.status ?? 'UNKNOWN',
    dev: { returnPct: num(dev.returnPct), pf: num(dev.pf), dd: num(dev.maxDDPct), trades: num(dev.trades), pfWithoutBest: num(dev.pfWithoutBest), falseStartRatePct: num(dev.falseStartRatePct), bestSharePct: num(dev.bestSharePct), avgHoldingHours: num(dev.avgHoldingHours) },
    val: { returnPct: num(val.returnPct), pf: num(val.pf), dd: num(val.maxDDPct), trades: num(val.trades), pfWithoutBest: num(val.pfWithoutBest), falseStartRatePct: num(val.falseStartRatePct), bestSharePct: num(val.bestSharePct), avgHoldingHours: num(val.avgHoldingHours) },
    stressPf: num(stress.pf), captureRatePct: num(waves.captureRatePct), mfeCapturePct: num(waves.medianWaveMfeCapturedPct), entryDelayHours: num(waves.medianEntryDelayHours), givebackPct: num(waves.exitGivebackPct), failureTaxonomy: val.failureTaxonomy ?? waves.failureTaxonomy ?? {}, folds: raw.walkForward ?? {},
  };
}

const pairRole = {
  BTC: 'MAJOR_WAVE_OWNERSHIP',
  ETH: 'RELATIVE_LEADERSHIP_ACCELERATION',
  BNB: 'RELATIVE_IMPULSE_SCOUT',
  AVAX: 'VOLATILITY_EVENT_TRADER',
  SOL: 'V109_WRONG_WAVE_LOSS_CONTROLLER',
  LINK: 'V109_QUALITY_CASH_HORIZON_CONTROL',
};

export function diagnoseEvidence(raw) {
  const x = normalizeEvidence(raw);
  const causes = [];
  const add = (code, severity, evidence, action) => causes.push({ code, severity, evidence, action });
  const ft = x.failureTaxonomy ?? {};
  const valTrades = x.val.trades ?? 0;
  const devTrades = x.dev.trades ?? 0;
  const valPf = x.val.pf ?? 0;

  if (valTrades < 5) add('TRADE_STARVATION', 100, `Validation trades=${valTrades}`, 'Remove pre-entry AND/confirmation layers; use scout/early-loss-control without numeric threshold loosening.');
  if (devTrades >= 8 && valTrades > 0 && (x.dev.pf ?? 0) >= 1.2 && valPf < 1) add('DEV_VAL_COLLAPSE', 95, `Dev PF=${x.dev.pf?.toFixed(2)} -> Val PF=${valPf.toFixed(2)}`, 'Change economic role/state transition rather than tuning the same signal family.');
  if ((x.val.falseStartRatePct ?? 0) >= 50) add('FALSE_START_DOMINANT', 90, `False-start=${x.val.falseStartRatePct.toFixed(1)}%`, 'Enter smaller/earlier as scout and reject quickly on contradiction; do not add another confirmation gate.');
  if ((num(ft.wrongCoreOwnership) ?? 0) >= Math.max(3, valTrades * 0.35)) add('WRONG_CORE_OWNERSHIP', 88, `wrongCoreOwnership=${num(ft.wrongCoreOwnership) ?? 0}`, 'Redefine Core acceptance from independent evidence; separate scout from ownership.');
  if (valTrades >= 5 && (x.val.pfWithoutBest ?? 0) > 0 && (x.val.pfWithoutBest ?? 0) < 1) add('BEST_TRADE_DEPENDENCE', 82, `PF without best=${x.val.pfWithoutBest.toFixed(2)}`, 'Require broad contribution; avoid promoting tiny-sample PF spikes.');
  if ((x.stressPf ?? 0) > 0 && x.stressPf < 1) add('STRESS_EDGE_WEAK', 80, `Stress PF=${x.stressPf.toFixed(2)}`, 'Reduce turnover/cost exposure structurally; keep only higher-quality ownership periods.');
  if (x.pair === 'BTC' && (x.captureRatePct ?? 0) < 25) add('BTC_WAVE_MISS', 78, `Major-wave capture=${x.captureRatePct ?? 0}%`, 'Prioritize early scout/probe and accepted expansion; stop adding entry filters.');
  if (x.pair === 'BTC' && (x.captureRatePct ?? 0) >= 25 && (x.mfeCapturePct ?? 0) < 20) add('BTC_OWNERSHIP_LEAK', 86, `Capture=${x.captureRatePct.toFixed(1)}%, MFE captured=${x.mfeCapturePct?.toFixed(1) ?? 0}%`, 'Shift research from entry detection to staged Core/add and structural hold/exit.');
  if (x.pair === 'ETH' && valPf < 1.2) add('ETH_STATIC_LEADERSHIP_LAG', 84, `Validation PF=${valPf.toFixed(2)}`, 'Use ETH-vs-BTC leadership acceleration/transition derivative, not static relative-strength levels.');
  if (x.pair === 'BNB' && valTrades <= 5) add('BNB_CONSENSUS_STARVATION', 96, `Validation trades=${valTrades}`, 'Consensus must move from entry prerequisite to continuation evidence after a fresh relative-impulse scout.');
  if (x.pair === 'AVAX' && valPf < 1) add('AVAX_ROLE_MISMATCH', 92, `Validation PF=${valPf.toFixed(2)}`, 'Use short volatility-event ownership with expiry-to-cash; stop forcing multi-day wave Core behavior.');
  causes.sort((a, b) => b.severity - a.severity);
  return {
    candidateId: x.id,
    pair: x.pair,
    role: pairRole[x.pair] ?? 'PAIR_SPECIFIC',
    dominantCause: causes[0] ?? { code: 'NO_DOMINANT_CAUSE', severity: 0, evidence: 'No deterministic failure rule fired.', action: 'Inspect ledger before redesign.' },
    causes,
    metrics: x,
    antiOverfit: { redesignSource: 'Development/Validation only', confirmationHoldout: 'DO_NOT_USE_FOR_REDESIGN', denseSweepAllowed: false, minorThresholdVariantAllowed: false },
  };
}

export function tokenSimilarity(a = '', b = '') {
  const A = new Set(a.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  const B = new Set(b.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const value of A) if (B.has(value)) inter += 1;
  return inter / (A.size + B.size - inter);
}

