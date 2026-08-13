import AdmZip from 'adm-zip';

const REPO = process.env.DISDEX_REPO ?? 'dunamishajime-bit/-ai-dex-manager';
const BRANCH = process.env.DISDEX_RESEARCH_BRANCH ?? 'research/win80-profit-optimization-v1';
const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.DISDEX_GITHUB_TOKEN ?? '';
const WORKFLOW_RE = new RegExp(process.env.DISDEX_RESEARCH_WORKFLOW_REGEX ?? '(Active[0-9]|SOL LINK V109 Autonomous Structural Research|Research)', 'i');

function assertToken() {
  if (!TOKEN) throw new Error('GITHUB_TOKEN or DISDEX_GITHUB_TOKEN is required');
}

export function config() { return { repo: REPO, branch: BRANCH, workflowRegex: WORKFLOW_RE.source }; }

export async function gh(path, init = {}) {
  assertToken();
  const res = await fetch(`${API}/repos/${REPO}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status} ${path}: ${text.slice(0, 1200)}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json();
  return res.arrayBuffer();
}

export async function listRecentRuns({ perPage = 50 } = {}) {
  const data = await gh(`/actions/runs?branch=${encodeURIComponent(BRANCH)}&per_page=${Math.min(perPage, 100)}`);
  return (data.workflow_runs ?? []).filter((r) => WORKFLOW_RE.test(r.name ?? ''));
}

export async function listJobs(runId) {
  const data = await gh(`/actions/runs/${runId}/jobs?per_page=100`);
  return data.jobs ?? [];
}

export async function getShardCapacity(maxShards = 5) {
  const runs = await listRecentRuns({ perPage: 30 });
  const activeRuns = runs.filter((r) => ['queued', 'in_progress', 'pending', 'waiting'].includes(r.status));
  let queued = 0;
  let inProgress = 0;
  const jobs = [];
  for (const run of activeRuns) {
    const js = await listJobs(run.id);
    for (const job of js) {
      if (['queued', 'pending', 'waiting'].includes(job.status)) queued += 1;
      if (job.status === 'in_progress') inProgress += 1;
      jobs.push({ runId: run.id, workflow: run.name, jobId: job.id, name: job.name, status: job.status });
    }
  }
  return { maxShards, queued, inProgress, occupied: queued + inProgress, available: Math.max(0, maxShards - queued - inProgress), jobs };
}

export async function listArtifacts(runId) {
  const data = await gh(`/actions/runs/${runId}/artifacts?per_page=100`);
  return data.artifacts ?? [];
}

export async function downloadArtifactEntries(artifactId) {
  const bytes = await gh(`/actions/artifacts/${artifactId}/zip`);
  const zip = new AdmZip(Buffer.from(bytes));
  return zip.getEntries().filter((e) => !e.isDirectory).map((e) => ({ name: e.entryName, text: e.getData().toString('utf8') }));
}

export async function extractEvidenceFromRun(runId) {
  const artifacts = await listArtifacts(runId);
  const evidence = [];
  for (const artifact of artifacts) {
    const entries = await downloadArtifactEntries(artifact.id);
    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(entry.text);
        evidence.push({ artifactId: artifact.id, artifactName: artifact.name, file: entry.name, data: parsed });
      } catch {}
    }
  }
  return evidence;
}

export async function getCompletedEvidence({ limitRuns = 10 } = {}) {
  const runs = (await listRecentRuns({ perPage: 50 })).filter((r) => r.status === 'completed').slice(0, limitRuns);
  const out = [];
  for (const run of runs) {
    const evidence = await extractEvidenceFromRun(run.id);
    out.push({ run: { id: run.id, name: run.name, conclusion: run.conclusion, headSha: run.head_sha, createdAt: run.created_at, updatedAt: run.updated_at }, evidence });
  }
  return out;
}

export async function dispatchWorkflow({ workflowFile, expectedShards = 1, inputs = {}, acknowledgement }) {
  if (acknowledgement !== 'RESEARCH_ONLY_EXECUTION') throw new Error('acknowledgement must equal RESEARCH_ONLY_EXECUTION');
  if (!/^[A-Za-z0-9._-]+\.ya?ml$/.test(workflowFile)) throw new Error('workflowFile must be a workflow filename only');
  if (!/(active|research|sol[-_ ]?link)/i.test(workflowFile)) throw new Error('Only research workflow filenames are allowed');
  const capacity = await getShardCapacity(5);
  if (expectedShards < 1 || expectedShards > 5) throw new Error('expectedShards must be 1..5');
  if (capacity.occupied + expectedShards > 5) throw new Error(`Shard capacity exceeded: occupied=${capacity.occupied}, requested=${expectedShards}`);
  await gh(`/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: BRANCH, inputs }),
  });
  return { dispatched: true, workflowFile, branch: BRANCH, expectedShards, capacityBefore: capacity };
}

function encodeContent(text) { return Buffer.from(text, 'utf8').toString('base64'); }

export async function getContent(path) {
  return gh(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(BRANCH)}`);
}

export async function putResearchFile({ path, content, message, sha }) {
  if (!path.startsWith('research/commander/')) throw new Error('Writes are restricted to research/commander/');
  if (/\.env|credential|secret|live|order|position|account/i.test(path)) throw new Error('Forbidden research registry path');
  return gh(`/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, content: encodeContent(content), branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
}

export async function listRegistry() {
  try {
    const data = await getContent('research/commander/candidates');
    return Array.isArray(data) ? data.filter((x) => x.type === 'file' && x.name.endsWith('.json')) : [];
  } catch (e) {
    if (String(e).includes('GitHub 404')) return [];
    throw e;
  }
}

export async function readRegistryCandidate(id) {
  try {
    const data = await getContent(`research/commander/candidates/${encodeURIComponent(id)}.json`);
    const text = Buffer.from(data.content ?? '', 'base64').toString('utf8');
    return { ...JSON.parse(text), _sha: data.sha };
  } catch (e) {
    if (String(e).includes('GitHub 404')) return null;
    throw e;
  }
}
