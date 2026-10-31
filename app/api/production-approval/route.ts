import crypto from "crypto";
import { ALL_RUNNERS_LIVE_TASK } from "@/lib/deploy-all-runners-task";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";
import {
  getDeploymentApproval,
  saveDeploymentApproval,
} from "@/lib/server/deploy-approval-store";
import {
  DEPLOY_APPROVAL_OPERATION_POLICY,
  issueDeploymentApprovalToken,
  loadDeploymentApprovalPrivateKey,
  type DeploymentApprovalOperation,
} from "@/lib/deploy-approval-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE = "disdex_auth";
const APPROVAL_RECEIVER = process.env.ADMIN_CONTACT_EMAIL || process.env.GMAIL_USER || "";
const OTP_PEPPER = process.env.DISDEX_DEPLOY_OTP_PEPPER?.trim() || "";
const OPERATOR = "dunamishajime-bit";
const UUID_RE = /^[0-9a-f-]{36}$/i;

function resolveRecordOperation(record: { operation?: DeploymentApprovalOperation; scope: string }) {
  const operation = record.operation ?? (record.scope === "V12_V4" ? "V12_V4_LIVE" : null);
  if (!operation || !(operation in DEPLOY_APPROVAL_OPERATION_POLICY)) {
    throw new Error("unsupported approval operation");
  }
  return operation as DeploymentApprovalOperation;
}

function redirectUrl(request: NextRequest, params: Record<string, string>) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const envBase = process.env.NEXT_PUBLIC_APP_URL;
  const base =
    forwardedHost && forwardedProto
      ? `${forwardedProto}://${forwardedHost}`
      : envBase && !/localhost|127\.0\.0\.1/.test(envBase)
        ? envBase
        : request.nextUrl.origin;
  const url = new URL("/production-approval", base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

function redirect(request: NextRequest, params: Record<string, string>) {
  return NextResponse.redirect(redirectUrl(request, params));
}

async function requireAuthenticatedSession() {
  const store = await cookies();
  return store.get(AUTH_COOKIE)?.value === "1";
}

function sameOrigin(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";

  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host");
    const expectedHost = forwardedHost || request.headers.get("host") || request.nextUrl.host;
    return originUrl.host === expectedHost && originUrl.protocol === "https:";
  } catch {
    return false;
  }
}

function otpHash(requestId: string, code: string) {
  if (!OTP_PEPPER) throw new Error("DISDEX_DEPLOY_OTP_PEPPER is not configured");
  return crypto.createHmac("sha256", OTP_PEPPER).update(`${requestId}:${code}`).digest("hex");
}

function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function ipFingerprint(request: NextRequest) {
  if (!OTP_PEPPER) return "";
  const raw = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "")
    .split(",")[0]
    .trim();
  if (!raw) return "";
  return crypto.createHmac("sha256", OTP_PEPPER).update(raw).digest("hex");
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "origin mismatch" }, { status: 403 });
  }
  if (!(await requireAuthenticatedSession())) {
    return NextResponse.redirect(new URL("/login?next=/production-approval", request.nextUrl.origin));
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const requestId = String(formData.get("requestId") || "").trim();
  if (!UUID_RE.test(requestId)) {
    return redirect(request, { error: "承認リクエストIDが不正です" });
  }

  const record = await getDeploymentApproval(requestId);
  if (!record) return redirect(request, { error: "承認リクエストが見つかりません" });
  if (record.requestExpiresAt < Date.now() && ["PENDING", "OTP_SENT"].includes(record.status)) {
    await saveDeploymentApproval({ ...record, status: "EXPIRED", lastError: "request expired" });
    return redirect(request, { error: "承認リクエストの有効期限が切れています" });
  }

  if (intent === "request-otp") {
    if (!APPROVAL_RECEIVER) {
      return redirect(request, { error: "承認コードの送信先メールが未設定です" });
    }
    if (!OTP_PEPPER) {
      return redirect(request, { error: "デプロイ承認OTP秘密値が未設定です" });
    }
    if (!["PENDING", "OTP_SENT"].includes(record.status)) {
      return redirect(request, { error: "このリクエストはOTP送信対象ではありません" });
    }
    if (record.otpSentAt && Date.now() - record.otpSentAt < 30_000) {
      return redirect(request, { error: "30秒後に再送できます" });
    }

    const operation = resolveRecordOperation(record);
    const policy = DEPLOY_APPROVAL_OPERATION_POLICY[operation];
    if (record.scope !== policy.scope || (record.ordersEnabled ?? true) !== policy.ordersEnabled) {
      return redirect(request, { error: "承認対象の操作ポリシーが一致しません" });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = Date.now();
    const sent = await sendEmail(
      APPROVAL_RECEIVER,
      "DisDex Production 操作承認コード",
      [
        `承認コード: ${code}`,
        "有効期限: 5分",
        "",
        `対象: ${policy.label}`,
        `Scope: ${policy.scope}`,
        `注文権限: ${policy.ordersEnabled ? "有効" : "無効"}`,
        `SHA: ${record.targetSha}`,
        `Plan/Context SHA-256: ${record.planSha256}`,
        "",
        "心当たりがない場合は承認しないでください。",
      ].join("\n"),
    );
    if (!sent.success) {
      return redirect(request, { error: "承認コードの送信に失敗しました" });
    }

    await saveDeploymentApproval({
      ...record,
      status: "OTP_SENT",
      otpHash: otpHash(record.id, code),
      otpSentAt: now,
      otpExpiresAt: now + 5 * 60 * 1000,
      otpAttemptsRemaining: 5,
      lastError: undefined,
    });
    return redirect(request, { message: "LIVE承認コードをメール送信しました" });
  }

  if (intent === "verify-otp") {
    if (!OTP_PEPPER) {
      return redirect(request, { error: "デプロイ承認OTP秘密値が未設定です" });
    }
    const code = String(formData.get("approvalCode") || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return redirect(request, { error: "6桁の承認コードを入力してください" });
    }
    if (
      record.status !== "OTP_SENT" ||
      !record.otpHash ||
      !record.otpExpiresAt ||
      Date.now() > record.otpExpiresAt ||
      (record.otpAttemptsRemaining ?? 0) <= 0
    ) {
      return redirect(request, { error: "承認コードが失効しています。再送してください" });
    }

    const matched = safeEqualHex(otpHash(record.id, code), record.otpHash);
    if (!matched) {
      const remaining = Math.max(0, (record.otpAttemptsRemaining ?? 1) - 1);
      await saveDeploymentApproval({
        ...record,
        otpAttemptsRemaining: remaining,
        status: remaining === 0 ? "FAILED" : "OTP_SENT",
        lastError: "invalid OTP",
      });
      return redirect(request, {
        error: remaining > 0 ? `承認コードが違います。残り${remaining}回` : "試行回数上限に達しました",
      });
    }

    try {
      const operation = resolveRecordOperation(record);
      const policy = DEPLOY_APPROVAL_OPERATION_POLICY[operation];
      if (record.scope !== policy.scope || (record.ordersEnabled ?? true) !== policy.ordersEnabled) {
        throw new Error("approval operation policy mismatch");
      }

      const { token, payload } = issueDeploymentApprovalToken({
        targetSha: record.targetSha,
        planSha256: record.planSha256,
        operator: OPERATOR,
        privateKey: loadDeploymentApprovalPrivateKey(),
        scope: policy.scope,
        ordersEnabled: policy.ordersEnabled,
        ttlSeconds: 300,
      });

      await saveDeploymentApproval({
        ...record,
        status: "APPROVED",
        otpHash: undefined,
        otpExpiresAt: undefined,
        otpAttemptsRemaining: undefined,
        approvedAt: Date.now(),
        approvalToken: token,
        approvalTokenExpiresAt: payload.expiresAt,
        approverIpHash: ipFingerprint(request),
        ...(operation === "ALL_RUNNERS_LIVE_RESTORE" ? {
          taskApprovedExpiresAt: Date.now() + ALL_RUNNERS_LIVE_TASK.maxAgeMs,
          taskMaxClaims: ALL_RUNNERS_LIVE_TASK.maxClaims,
          taskClaimCount: 0,
          taskClaimHistory: [],
        } : {}),
        lastError: undefined,
      });

      return redirect(request, {
        message: operation === "ALL_RUNNERS_LIVE_RESTORE"
          ? "全Runner LIVE復旧作業を承認しました。登録済みの復旧工程と再試行は有効期間内なら追加のメール認証なしで進みます。"
          : "本人認証が完了しました。署名済み承認証明を発行しました",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "approval signing failed";
      await saveDeploymentApproval({ ...record, status: "FAILED", lastError: message });
      return redirect(request, { error: "署名済み承認証明の発行に失敗しました" });
    }
  }

  return redirect(request, { error: "未対応の承認操作です" });
}
