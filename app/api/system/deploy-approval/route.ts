import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createPendingDeploymentApproval,
  sanitizeDeploymentApproval,
  mutateDeploymentApprovalAtomic,
} from "@/lib/server/deploy-approval-store";
import {
  DEPLOY_APPROVAL_OPERATION_POLICY,
  type DeploymentApprovalOperation,
  issueDeploymentApprovalToken,
  loadDeploymentApprovalPrivateKey,
} from "@/lib/deploy-approval-token";

import {
  ALL_RUNNERS_LIVE_TASK,
  ALL_RUNNERS_LIVE_PLAN_SHA256,
  ALL_RUNNER_TASK_STEPS,
  allRunnerStepPlanSha256,
  isAllRunnerTaskStep,
  validateAllRunnerTaskClaim,
} from "@/lib/deploy-all-runners-task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHA_RE = /^[0-9a-f]{40}$/;
const PLAN_RE = /^[0-9a-f]{64}$/;
const RUN_ID_RE = /^[0-9]{1,20}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorize(request: NextRequest) {
  const expected = process.env.DISDEX_HP_APPROVAL_BRIDGE_SECRET?.trim() || "";
  if (!expected) return { ok: false as const, status: 503, error: "approval bridge is not configured" };
  const auth = request.headers.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false as const, status: 401, error: "unauthorized" };
  }
  return { ok: true as const };
}

function resolveOperation(value: unknown, legacyScope?: unknown): DeploymentApprovalOperation | null {
  const operation = String(value || "").trim();
  if (operation in DEPLOY_APPROVAL_OPERATION_POLICY) {
    return operation as DeploymentApprovalOperation;
  }
  if (!operation && String(legacyScope || "").trim() === "V12_V4") return "V12_V4_LIVE";
  return null;
}

function recordOperation(record: { operation?: DeploymentApprovalOperation; scope: string }) {
  return record.operation ?? (record.scope === "V12_V4" ? "V12_V4_LIVE" : null);
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (body?.action === "publish_task") {
    const targetSha = String(body.target_sha || "").trim();
    const actor = String(body.actor || "").trim();
    if (targetSha !== ALL_RUNNERS_LIVE_TASK.baselineSha || actor !== "dunamishajime-bit") {
      return NextResponse.json({ ok: false, error: "task baseline or owner mismatch" }, { status: 409 });
    }
    const record = await createPendingDeploymentApproval({
      targetSha,
      planSha256: ALL_RUNNERS_LIVE_PLAN_SHA256,
      scope: "FULL_PROJECT",
      operation: "ALL_RUNNERS_LIVE_RESTORE",
      ordersEnabled: false,
      requestActor: actor,
      requestCommentId: String(body.comment_id || "").slice(0, 32),
    });
    return NextResponse.json(
      { ok: true, approval: sanitizeDeploymentApproval(record) },
      { status: 201 },
    );
  }

  if (body?.action === "claim_task_step") {
    const id = String(body.task_id || "").trim();
    const stepName = String(body.step || "").trim();
    const targetSha = String(body.target_sha || "").trim();
    const planSha256 = isAllRunnerTaskStep(stepName)
      ? (body.plan_sha256 == null ? allRunnerStepPlanSha256(stepName) : String(body.plan_sha256).trim())
      : "";
    const runId = String(body.run_id || "").trim();
    if (!UUID_RE.test(id) || !RUN_ID_RE.test(runId) || !isAllRunnerTaskStep(stepName) ||
        !SHA_RE.test(targetSha) || !PLAN_RE.test(planSha256)) {
      return NextResponse.json({ ok: false, error: "invalid task claim" }, { status: 400 });
    }
    try {
      const response = await mutateDeploymentApprovalAtomic(id, (record) => {
        const now = Date.now();
        const step = ALL_RUNNER_TASK_STEPS[stepName];
        if (!record || !validateAllRunnerTaskClaim({
          taskOperation: record.operation,
          taskScope: record.scope,
          taskTargetSha: record.targetSha,
          taskPlanSha256: record.planSha256,
          taskOrdersEnabled: record.ordersEnabled,
          step: stepName,
          stepTargetSha: targetSha,
          stepPlanSha256: planSha256,
          stepOrdersEnabled: step.ordersEnabled,
        })) throw new Error("TASK_OR_STAGE_IDENTITY_MISMATCH");
        if (!record.approvedAt || !record.taskApprovedExpiresAt ||
            record.taskApprovedExpiresAt !== record.approvedAt + ALL_RUNNERS_LIVE_TASK.maxAgeMs ||
            now >= record.taskApprovedExpiresAt)
          throw new Error("TASK_APPROVAL_WINDOW_EXPIRED");
        if (record.status !== "APPROVED") throw new Error("TASK_NOT_AVAILABLE_FOR_NEW_STAGE");
        if (record.taskActiveClaim) throw new Error("TASK_STAGE_ALREADY_IN_PROGRESS");
        if (!Number.isSafeInteger(record.taskClaimCount) ||
            (record.taskClaimCount ?? 0) >= ALL_RUNNERS_LIVE_TASK.maxClaims ||
            record.taskMaxClaims !== ALL_RUNNERS_LIVE_TASK.maxClaims)
          throw new Error("TASK_STAGE_ATTEMPT_LIMIT_REACHED");
        const { token, payload } = issueDeploymentApprovalToken({
          targetSha: step.targetSha,
          planSha256,
          scope: step.scope,
          ordersEnabled: step.ordersEnabled,
          operator: "dunamishajime-bit",
          privateKey: loadDeploymentApprovalPrivateKey(),
          ttlSeconds: 300,
        });
        const claim = { step: stepName, runId, claimedAt: now };
        return {
          next: {
            ...record,
            status: "DISPATCHED",
            taskClaimCount: (record.taskClaimCount ?? 0) + 1,
            taskActiveClaim: claim,
            taskClaimHistory: [...(record.taskClaimHistory ?? []), claim].slice(-40),
          },
          result: { ok: true, token, tokenExpiresAt: payload.expiresAt,
                    taskId: id, step: stepName, scope: step.scope,
                    ordersEnabled: step.ordersEnabled, planSha256, runId,
                    taskExpiresAt: record.taskApprovedExpiresAt },
        };
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({
        ok: false, error: error instanceof Error ? error.message : "task claim rejected",
      }, { status: 409 });
    }
  }

  if (body?.action === "finish_task_step") {
    const id = String(body.task_id || "").trim();
    const step = String(body.step || "").trim();
    const runId = String(body.run_id || "").trim();
    const outcome = String(body.outcome || "").trim();
    if (!UUID_RE.test(id) || !RUN_ID_RE.test(runId) || !isAllRunnerTaskStep(step) ||
        !["success", "failure"].includes(outcome)) {
      return NextResponse.json({ ok: false, error: "invalid task completion" }, { status: 400 });
    }
    try {
      const response = await mutateDeploymentApprovalAtomic(id, (record) => {
        if (!record || record.operation !== "ALL_RUNNERS_LIVE_RESTORE" ||
            record.status !== "DISPATCHED" || record.taskActiveClaim?.runId !== runId ||
            record.taskActiveClaim.step !== step) throw new Error("TASK_STAGE_NOT_OWNED_BY_RUN");
        const now = Date.now();
        const claims = (record.taskClaimHistory ?? []).map((claim) =>
          claim.runId === runId && claim.step === step && !claim.finishedAt
            ? { ...claim, finishedAt: now, outcome: outcome as "success" | "failure" }
            : claim);
        const completedSteps = new Set(
          claims.filter((claim) => claim.outcome === "success").map((claim) => claim.step));
        const isFinal = outcome === "success" && step === "FINAL_ALL_RUNNERS_AUDIT";
        if (isFinal && Object.keys(ALL_RUNNER_TASK_STEPS).some((name) => !completedSteps.has(name))) {
          throw new Error("TASK_CANNOT_COMPLETE_WITH_UNVERIFIED_RUNNERS");
        }
        return {
          next: {
            ...record,
            status: isFinal ? "COMPLETED" : "APPROVED",
            completedAt: isFinal ? now : undefined,
            taskActiveClaim: undefined,
            taskClaimHistory: claims,
            lastError: outcome === "failure" ? "stage failed; task remains bounded and retryable" : undefined,
          },
          result: { ok: true, status: isFinal ? "COMPLETED" : "APPROVED",
                    taskExpiresAt: record.taskApprovedExpiresAt, remainingClaims:
                    ALL_RUNNERS_LIVE_TASK.maxClaims - (record.taskClaimCount ?? 0) },
        };
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({
        ok: false, error: error instanceof Error ? error.message : "task completion rejected",
      }, { status: 409 });
    }
  }

  if (body?.action === "publish") {
    const targetSha = String(body.target_sha || "").trim();
    const planSha256 = String(body.plan_sha256 || "").trim();
    const actor = String(body.actor || "").trim();
    const commentId = body.comment_id == null ? undefined : String(body.comment_id);
    const operation = resolveOperation(body.operation, body.scope);

    if (
      !operation ||
      !SHA_RE.test(targetSha) ||
      !PLAN_RE.test(planSha256) ||
      !/^[A-Za-z0-9-]{1,39}$/.test(actor)
    ) {
      return NextResponse.json({ ok: false, error: "invalid production approval request" }, { status: 400 });
    }

    const policy = DEPLOY_APPROVAL_OPERATION_POLICY[operation];
    const requestedScope = body.scope == null ? policy.scope : String(body.scope).trim();
    if (body.orders_enabled != null && typeof body.orders_enabled !== "boolean") {
      return NextResponse.json({ ok: false, error: "orders_enabled must be boolean" }, { status: 400 });
    }
    const requestedOrdersEnabled =
      body.orders_enabled == null ? policy.ordersEnabled : body.orders_enabled;
    if (requestedScope !== policy.scope || requestedOrdersEnabled !== policy.ordersEnabled) {
      return NextResponse.json({ ok: false, error: "operation policy mismatch" }, { status: 409 });
    }

    const record = await createPendingDeploymentApproval({
      targetSha,
      planSha256,
      scope: policy.scope,
      operation,
      ordersEnabled: policy.ordersEnabled,
      requestActor: actor,
      requestCommentId: commentId,
    });
    return NextResponse.json(
      { ok: true, approval: sanitizeDeploymentApproval(record) },
      { status: 201 },
    );
  }

  if (body?.action === "redeem") {
    const approvalId = String(body.approval_id || "").trim();
    const targetSha = String(body.target_sha || "").trim();
    const planSha256 = String(body.plan_sha256 || "").trim();
    const runId = String(body.run_id || "").trim();
    const requestedOperation = resolveOperation(body.operation, body.scope);

    if (
      !UUID_RE.test(approvalId) ||
      !SHA_RE.test(targetSha) ||
      !PLAN_RE.test(planSha256) ||
      !RUN_ID_RE.test(runId) ||
      !requestedOperation
    ) {
      return NextResponse.json({ ok: false, error: "invalid redemption request" }, { status: 400 });
    }

    try {
      const response = await mutateDeploymentApprovalAtomic(approvalId, (record) => {
        if (!record) throw new Error("APPROVAL_NOT_FOUND");
        if (record.operation === "ALL_RUNNERS_LIVE_RESTORE") {
          throw new Error("TASK_APPROVAL_MUST_USE_SCOPED_STAGE_CLAIMS");
        }

        const operation = recordOperation(record);
        const policy = DEPLOY_APPROVAL_OPERATION_POLICY[requestedOperation];
        if (
          operation !== requestedOperation ||
          record.targetSha !== targetSha ||
          record.planSha256 !== planSha256 ||
          record.scope !== policy.scope ||
          (record.ordersEnabled ?? true) !== policy.ordersEnabled
        ) {
          throw new Error("APPROVAL_IDENTITY_MISMATCH");
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        if (!record.approvalToken || !record.approvalTokenExpiresAt ||
            record.approvalTokenExpiresAt < nowSeconds) {
          throw new Error("APPROVAL_TOKEN_EXPIRED");
        }

        if (record.status === "REDEEMED") {
          if (record.redeemedByRunId !== runId) throw new Error("APPROVAL_ALREADY_REDEEMED");
          return {
            result: {
              ok: true,
              token: record.approvalToken,
              approval: sanitizeDeploymentApproval(record),
              replay: true,
            },
          };
        }

        if (!["APPROVED", "DISPATCHED"].includes(record.status)) {
          throw new Error("APPROVAL_NOT_REDEEMABLE");
        }

        const next = {
          ...record,
          status: "REDEEMED" as const,
          redeemedAt: Date.now(),
          redeemedByRunId: runId,
        };
        return {
          next,
          result: {
            ok: true,
            token: next.approvalToken!,
            approval: sanitizeDeploymentApproval(next),
            replay: false,
          },
        };
      });
      return NextResponse.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "approval redemption rejected";
      const status = message === "APPROVAL_NOT_FOUND" ? 404
        : message === "APPROVAL_TOKEN_EXPIRED" ? 410
          : 409;
      return NextResponse.json({ ok: false, error: message }, { status });
    }
  }

  return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
}
