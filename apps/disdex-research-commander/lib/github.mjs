import {
  RESEARCH_BRANCH,
  RESEARCH_OWNER,
  RESEARCH_REPO,
  RESEARCH_WRITE_ROOT,
  assertNoCredentialLikeText,
  assertResearchBranch,
  assertResearchPath,
  assertResearchRepository,
  assertRequestId,
  assertShardCount,
  assertWorkflowAllowed,
} from "./policy.mjs";

const API_ROOT = "https://api.github.com";

function encodePath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export class GitHubClient {
  constructor({ token, owner = RESEARCH_OWNER, repo = RESEARCH_REPO, branch = RESEARCH_BRANCH, writeEnabled = false, fetchImpl = fetch } = {}) {
    if (!token || typeof token !== "string") throw new Error("GITHUB_RESEARCH_TOKEN_MISSING");
    assertResearchRepository(owner, repo);
    assertResearchBranch(branch);
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.writeEnabled = writeEnabled === true;
    this.fetchImpl = fetchImpl;
  }

  async request(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl(`${API_ROOT}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "DisDex-Research-Commander",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: "GITHUB_NON_JSON_RESPONSE" }; }
      if (!response.ok) throw new Error(`GITHUB_API_${response.status}:${payload?.message ?? "unknown"}`);
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("GITHUB_API_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getBranchStatus() {
    const branch = await this.request(`/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(this.branch)}`);
    return { branch: this.branch, headSha: branch?.commit?.sha ?? null, protected: branch?.protected === true };
  }

  async listWorkflowRuns(workflow = "disdex-research-commander-bt.yml") {
    const allowed = assertWorkflowAllowed(workflow).file;
    const result = await this.request(`/repos/${this.owner}/${this.repo}/actions/workflows/${encodePath(allowed)}/runs?branch=${encodeURIComponent(this.branch)}&per_page=100`);
    return Array.isArray(result?.workflow_runs) ? result.workflow_runs : [];
  }

  async listArtifacts() {
    const result = await this.request(`/repos/${this.owner}/${this.repo}/actions/artifacts?per_page=100`);
    return Array.isArray(result?.artifacts) ? result.artifacts : [];
  }

  async getResearchStatus() {
    const [branch, runs, artifacts] = await Promise.all([this.getBranchStatus(), this.listWorkflowRuns(), this.listArtifacts()]);
    const activeRuns = runs.filter((run) => run.status === "queued" || run.status === "in_progress");
    const completedRuns = runs.filter((run) => run.status === "completed");
    return { branch, activeRuns, completedRuns, artifacts };
  }

  async getCompletedBt() {
    const runs = await this.listWorkflowRuns();
    return runs
      .filter((run) => run.status === "completed" && run.conclusion === "success")
      .slice(0, 20)
      .map((run) => ({ id: run.id, name: run.name, sha: run.head_sha, createdAt: run.created_at, updatedAt: run.updated_at, htmlUrl: run.html_url }));
  }

  async getSafeTree(prefix = "research/") {
    assertResearchPath(prefix.endsWith("/") ? prefix : `${prefix}/`);
    const ref = await this.getBranchStatus();
    const commit = await this.request(`/repos/${this.owner}/${this.repo}/git/commits/${ref.headSha}`);
    const tree = await this.request(`/repos/${this.owner}/${this.repo}/git/trees/${commit.tree.sha}?recursive=1`);
    return (tree?.tree ?? [])
      .filter((item) => item.type === "blob" && item.path.startsWith(prefix))
      .filter((item) => !/(?:production|prod|live|deploy|promote|secret|credential|private[_-]?key)/i.test(item.path))
      .map((item) => ({ path: item.path, sha: item.sha, size: item.size ?? null }));
  }

  async readSafeFile(path) {
    assertResearchPath(path);
    const result = await this.request(`/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (result?.type !== "file" || typeof result?.content !== "string") throw new Error("RESEARCH_FILE_NOT_READABLE");
    const content = Buffer.from(result.content.replace(/\s+/g, ""), "base64").toString("utf8");
    assertNoCredentialLikeText(content);
    return { path, sha: result.sha, content };
  }

  async registerCandidate(candidate) {
    if (!this.writeEnabled) throw new Error("RESEARCH_GITHUB_WRITE_DISABLED");
    const id = String(candidate?.candidateId ?? candidate?.id ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(id)) throw new Error("CANDIDATE_ID_INVALID");
    const path = assertResearchPath(`${RESEARCH_WRITE_ROOT}${id}.json`, { write: true });
    assertNoCredentialLikeText(candidate);
    const body = Buffer.from(JSON.stringify({ ...candidate, candidateId: id }, null, 2), "utf8").toString("base64");
    try {
      await this.request(`/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`);
      throw new Error("CANDIDATE_ALREADY_EXISTS");
    } catch (error) {
      if (!String(error?.message).startsWith("GITHUB_API_404")) throw error;
    }
    const result = await this.request(`/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`, {
      method: "PUT",
      body: { message: `research: register candidate ${id}`, content: body, branch: this.branch },
    });
    return { candidateId: id, path, commitSha: result?.commit?.sha ?? null };
  }

  async launchBtShards({ count = 1, dryRun = true, requestId = null } = {}) {
    const shardCount = assertShardCount(count);
    const safeRequestId = assertRequestId(requestId);
    const workflow = assertWorkflowAllowed("disdex-research-commander-bt.yml").file;
    const runs = await this.listWorkflowRuns(workflow);
    const active = runs.filter((run) => run.status === "queued" || run.status === "in_progress");
    if (active.length >= 5 || active.length + shardCount > 5) throw new Error("RESEARCH_ACTIVE_SHARD_LIMIT");
    if (runs.some((run) => String(run.display_title ?? "").includes(safeRequestId))) throw new Error("DUPLICATE_RESEARCH_RUN_REJECTED");
    if (dryRun) return { dryRun: true, workflow, requested: shardCount, active: active.length, freeSlots: 5 - active.length };
    if (!this.writeEnabled) throw new Error("RESEARCH_GITHUB_WRITE_DISABLED");
    const launched = [];
    for (let shard = 1; shard <= shardCount; shard += 1) {
      await this.request(`/repos/${this.owner}/${this.repo}/actions/workflows/${encodePath(workflow)}/dispatches`, {
        method: "POST",
        body: { ref: this.branch, inputs: { shard: String(shard), request_id: safeRequestId } },
      });
      launched.push(shard);
    }
    return { dryRun: false, workflow, requestId: safeRequestId, launched, activeBefore: active.length };
  }
}

