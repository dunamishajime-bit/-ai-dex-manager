export const RESEARCH_OWNER = "dunamishajime-bit";
export const RESEARCH_REPO = "-ai-dex-manager";
export const RESEARCH_BRANCH = "research/win80-profit-optimization-v1";
export const RESEARCH_WRITE_ROOT = "research/commander/candidates/";
export const RESEARCH_CACHE_ROOT = "research/commander/cache/";
export const MAX_RESEARCH_SHARDS = 5;

export const ALLOWED_RESEARCH_WORKFLOWS = Object.freeze([
  Object.freeze({
    file: "disdex-research-commander-bt.yml",
    name: "DisDex Research Commander BT",
  }),
]);

const DENIED_WORKFLOW_RE = /(?:production|prod|live|deploy|promote|release|approval|kill[-_ ]?switch|account|vps)/i;
const SECRET_RE = /(?:private[_-]?key|api[_-]?key|secret|password|cookie|bearer|github[_-]?token|exchange[_-]?credential)/i;

export function assertResearchRepository(owner, repo) {
  if (owner !== RESEARCH_OWNER || repo !== RESEARCH_REPO) {
    throw new Error("RESEARCH_REPOSITORY_NOT_ALLOWED");
  }
}

export function assertResearchBranch(branch) {
  if (branch !== RESEARCH_BRANCH) {
    throw new Error("RESEARCH_BRANCH_NOT_ALLOWED");
  }
}

export function assertResearchPath(path, { write = false } = {}) {
  if (typeof path !== "string" || path.length === 0 || path.length > 240) {
    throw new Error("RESEARCH_PATH_INVALID");
  }
  if (path.startsWith("/") || path.includes("\\") || path.includes("..") || path.includes("//")) {
    throw new Error("RESEARCH_PATH_TRAVERSAL_REJECTED");
  }
  const allowed = write ? [RESEARCH_WRITE_ROOT] : [RESEARCH_WRITE_ROOT, RESEARCH_CACHE_ROOT, "research/"];
  if (!allowed.some((prefix) => path.startsWith(prefix))) {
    throw new Error("RESEARCH_PATH_NOT_ALLOWED");
  }
  if (DENIED_WORKFLOW_RE.test(path)) {
    throw new Error("PRODUCTION_PATH_REJECTED");
  }
  return path;
}

export function assertWorkflowAllowed(workflow) {
  if (typeof workflow !== "string" || DENIED_WORKFLOW_RE.test(workflow)) {
    throw new Error("WORKFLOW_NOT_ALLOWED");
  }
  const match = ALLOWED_RESEARCH_WORKFLOWS.find((item) => item.file === workflow || item.name === workflow);
  if (!match) throw new Error("WORKFLOW_NOT_ALLOWLISTED");
  return match;
}

export function assertStage(stage) {
  if (stage !== "Development" && stage !== "Validation") {
    throw new Error("CONFIRMATION_HOLDOUT_INACCESSIBLE");
  }
  return stage;
}

export function assertShardCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_RESEARCH_SHARDS) {
    throw new Error("RESEARCH_SHARD_LIMIT_EXCEEDED");
  }
  return count;
}

export function assertRequestId(requestId) {
  if (requestId === null || requestId === undefined || requestId === "") return "anonymous-research-request";
  if (typeof requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(requestId)) {
    throw new Error("RESEARCH_REQUEST_ID_INVALID");
  }
  return requestId;
}

export function assertNoCredentialLikeText(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (SECRET_RE.test(text) && !/^(?:candidate|research|trade|ledger|strategy|run|artifact|config|metrics)/i.test(text)) {
    throw new Error("CREDENTIAL_LIKE_DATA_REJECTED");
  }
  return true;
}

export function guardrailSummary() {
  return {
    mode: "research-only",
    repository: `${RESEARCH_OWNER}/${RESEARCH_REPO}`,
    branch: RESEARCH_BRANCH,
    writeRoot: RESEARCH_WRITE_ROOT,
    cacheRoot: RESEARCH_CACHE_ROOT,
    allowedWorkflows: ALLOWED_RESEARCH_WORKFLOWS.map(({ file, name }) => ({ file, name })),
    maxResearchShards: MAX_RESEARCH_SHARDS,
    stagesDiagnosable: ["Development", "Validation"],
    stagesInaccessibleToDiagnostics: ["Confirmation", "Holdout"],
    productionAccess: false,
    liveAccess: false,
    ordersAccess: false,
    positionsAccess: false,
    accountAccess: false,
    walletAccess: false,
    realTradingEnabled: false,
  };
}

