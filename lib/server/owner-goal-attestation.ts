import crypto from "node:crypto";
import {
  GOAL_CI_WORKFLOW,
  GOAL_CI_WORKFLOW_NAME,
  type GoalApproval,
  assertOwnerGoalCandidate,
} from "@/lib/owner-goal-approval";
import { DEPLOY_APPROVAL_REPOSITORY } from "@/lib/deploy-approval-token";

type GitHubFetch = typeof fetch;
const RUN_RE = /^[0-9]{1,20}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_PLAN_BYTES = 128 * 1024;

async function githubJson(url: string, fetcher: GitHubFetch): Promise<Record<string, any>> {
  const token = process.env.DISDEX_GITHUB_READ_TOKEN?.trim();
  const result = await fetcher(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "DisDex-Goal-Candidate-Attestation/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!result.ok) throw new Error("GOAL_GITHUB_ATTESTATION_UNAVAILABLE");
  const parsed: unknown = await result.json();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GOAL_GITHUB_ATTESTATION_INVALID");
  }
  return parsed as Record<string, any>;
}

/**
 * Verifies GitHub-run evidence *before* an atomic grant. A successful job on
 * an arbitrary branch/workflow is NOT enough: the run's workflow must be
 * byte-for-byte the same as the protected master workflow and HEAD must be
 * the exact candidate being signed. The candidate plan must bind the goal.
 */
export async function verifyOwnerGoalRelease(input: {
  approvalId: string;
  goal: GoalApproval;
  candidateSha: string;
  planSha256: string;
  executionPlanSha256?: string;
  ordersEnabled: boolean;
  ciRunId: string;
  fetcher?: GitHubFetch;
}): Promise<void> {
  const { approvalId, candidateSha, planSha256, ciRunId, goal } = input;
  if (!UUID_RE.test(approvalId) || !SHA_RE.test(candidateSha) ||
      !HASH_RE.test(planSha256) || !RUN_RE.test(ciRunId)) {
    throw new Error("GOAL_ATTESTATION_INPUT_INVALID");
  }
  const fetcher = input.fetcher ?? fetch;
  const root = `https://api.github.com/repos/${DEPLOY_APPROVAL_REPOSITORY}`;
  const ci = await githubJson(`${root}/actions/runs/${ciRunId}`, fetcher);
  if (
    ci.repository?.full_name !== DEPLOY_APPROVAL_REPOSITORY ||
    ci.head_sha !== candidateSha ||
    ci.status !== "completed" ||
    ci.conclusion !== "success" ||
    ci.event !== "workflow_dispatch" ||
    !Number.isSafeInteger(ci.workflow_id)
  ) {
    throw new Error("GOAL_CI_RUN_NOT_ELIGIBLE");
  }
  // After the successful exact-SHA CI gate, these four independent reads
  // can be performed together. Sequential requests previously amplified GitHub
  // latency and exhausted the caller's 15-second bridge deadline.
  // Every attestation check below remains mandatory and fail-closed.
  const path = `docs/implementation/goal-campaigns/${approvalId}.json`;
  const [workflow, trusted, candidateWorkflow, file] = await Promise.all([
    githubJson(`${root}/actions/workflows/${ci.workflow_id}`, fetcher),
    githubJson(`${root}/contents/${GOAL_CI_WORKFLOW}?ref=master`, fetcher),
    githubJson(`${root}/contents/${GOAL_CI_WORKFLOW}?ref=${candidateSha}`, fetcher),
    githubJson(`${root}/contents/${path}?ref=${candidateSha}`, fetcher),
  ]);
  if (workflow.path !== GOAL_CI_WORKFLOW || workflow.name !== GOAL_CI_WORKFLOW_NAME ||
      workflow.state !== "active") {
    throw new Error("GOAL_CI_WORKFLOW_NOT_TRUSTED");
  }
  if (!trusted.sha || trusted.sha !== candidateWorkflow.sha || trusted.type !== "file") {
    throw new Error("GOAL_CI_WORKFLOW_MODIFIED");
  }
  if (file.type !== "file" || file.encoding !== "base64" ||
      typeof file.content !== "string" || file.size > MAX_PLAN_BYTES ||
      file.size <= 0) {
    throw new Error("GOAL_PLAN_NOT_TRUSTED");
  }
  const raw = Buffer.from(file.content.replace(/\s/g, ""), "base64");
  if (raw.length !== file.size ||
      crypto.createHash("sha256").update(raw).digest("hex") !== planSha256) {
    throw new Error("GOAL_PLAN_SHA_MISMATCH");
  }
  let plan: unknown;
  try { plan = JSON.parse(raw.toString("utf8")); }
  catch { throw new Error("GOAL_PLAN_INVALID_JSON"); }
  assertOwnerGoalCandidate({
    goal, sha: candidateSha, planSha256,
    executionPlanSha256: input.executionPlanSha256,
    ordersEnabled: input.ordersEnabled, plan,
  });
}
