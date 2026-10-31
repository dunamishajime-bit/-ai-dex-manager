import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createPendingDeploymentApproval,
  getDeploymentApproval,
  saveDeploymentApproval,
  sanitizeDeploymentApproval,
} from "@/lib/server/deploy-approval-store";

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

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (body?.action === "publish") {
    const targetSha = String(body.target_sha || "").trim();
    const planSha256 = String(body.plan_sha256 || "").trim();
    const scope = String(body.scope || "").trim();
    const actor = String(body.actor || "").trim();
    const commentId = body.comment_id == null ? undefined : String(body.comment_id);

    if (
      scope !== "V12_V4" ||
      !SHA_RE.test(targetSha) ||
      !PLAN_RE.test(planSha256) ||
      !/^[A-Za-z0-9-]{1,39}$/.test(actor)
    ) {
      return NextResponse.json({ ok: false, error: "invalid deployment request" }, { status: 400 });
    }

    const record = await createPendingDeploymentApproval({
      targetSha,
      planSha256,
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

    if (
      !UUID_RE.test(approvalId) ||
      !SHA_RE.test(targetSha) ||
      !PLAN_RE.test(planSha256) ||
      !RUN_ID_RE.test(runId)
    ) {
      return NextResponse.json({ ok: false, error: "invalid redemption request" }, { status: 400 });
    }

    const record = await getDeploymentApproval(approvalId);
    if (!record) return NextResponse.json({ ok: false, error: "approval not found" }, { status: 404 });

    if (record.targetSha !== targetSha || record.planSha256 !== planSha256 || record.scope !== "V12_V4") {
      return NextResponse.json({ ok: false, error: "approval identity mismatch" }, { status: 409 });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!record.approvalToken || !record.approvalTokenExpiresAt || record.approvalTokenExpiresAt < nowSeconds) {
      return NextResponse.json({ ok: false, error: "approval token expired" }, { status: 410 });
    }

    if (record.status === "REDEEMED") {
      if (record.redeemedByRunId !== runId) {
        return NextResponse.json({ ok: false, error: "approval already redeemed" }, { status: 409 });
      }
      return NextResponse.json({
        ok: true,
        token: record.approvalToken,
        approval: sanitizeDeploymentApproval(record),
        replay: true,
      });
    }

    if (record.status !== "DISPATCHED") {
      return NextResponse.json({ ok: false, error: "approval is not dispatch-ready" }, { status: 409 });
    }

    const redeemed = await saveDeploymentApproval({
      ...record,
      status: "REDEEMED",
      redeemedAt: Date.now(),
      redeemedByRunId: runId,
    });
    return NextResponse.json({
      ok: true,
      token: redeemed.approvalToken,
      approval: sanitizeDeploymentApproval(redeemed),
      replay: false,
    });
  }

  return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
}
