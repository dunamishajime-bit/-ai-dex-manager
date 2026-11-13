import crypto from "node:crypto";
import { ALL_RUNNERS_LIVE_TASK } from "@/lib/deploy-all-runners-task";
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";
import {
  getDeploymentApproval,
  mutateDeploymentApprovalAtomic,
} from "@/lib/server/deploy-approval-store";
import {
  DEPLOY_APPROVAL_OPERATION_POLICY,
  issueDeploymentApprovalToken,
  loadDeploymentApprovalPrivateKey,
  type DeploymentApprovalOperation,
} from "@/lib/deploy-approval-token";
import { verifyRequestSession } from "@/lib/server/owner-session";
import { createOtpChallenge, consumeOtpChallenge } from "@/lib/server/otp-challenge-store";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVAL_OTP_COOKIE = "disdex_production_otp_challenge";
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
      ? forwardedProto + "://" + forwardedHost
      : envBase && !/localhost|127\.0\.0\.1/.test(envBase)
        ? envBase
        : request.nextUrl.origin;
  const url = new URL("/production-approval", base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

function redirectToApproval(request: NextRequest, params: Record<string, string>) {
  return NextResponse.redirect(redirectUrl(request, params));
}

function otpHash(subject: string, code: string) {
  if (!OTP_PEPPER) throw new Error("DISDEX_DEPLOY_OTP_PEPPER is not configured");
  return crypto.createHmac("sha256", OTP_PEPPER).update(subject + ":" + code).digest("hex");
}

function ipFingerprint(request: NextRequest) {
  if (!OTP_PEPPER) return "";
  const raw = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "")
    .split(",")[0]
    .trim();
  if (!raw) return "";
  return crypto.createHmac("sha256", OTP_PEPPER).update(raw).digest("hex");
}

function setChallengeCookie(response: NextResponse, challengeId: string) {
  response.cookies.set(APPROVAL_OTP_COOKIE, challengeId, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 5 * 60,
  });
}

export async function POST(request: NextRequest) {
  let session;
  try {
    requireSameOriginMutation(request);
    session = verifyRequestSession(request, ["USER", "ADMIN"]);
  } catch {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const requestId = String(formData.get("requestId") || "").trim();
  if (!UUID_RE.test(requestId)) {
    return redirectToApproval(request, { error: "承認リクエストIDが不正です" });
  }

  const record = await getDeploymentApproval(requestId);
  if (!record) return redirectToApproval(request, { error: "承認リクエストが見つかりません" });
  if (record.requestExpiresAt < Date.now() && ["PENDING", "OTP_SENT"].includes(record.status)) {
    await mutateDeploymentApprovalAtomic(record.id, (current) => {
      if (!current) throw new Error("APPROVAL_NOT_FOUND");
      return { next: { ...current, status: "EXPIRED", lastError: "request expired" }, result: null };
    });
    return redirectToApproval(request, { error: "承認リクエストの有効期限が切れています" });
  }

  if (intent === "request-otp") {
    if (!APPROVAL_RECEIVER || !OTP_PEPPER) {
      return redirectToApproval(request, { error: "承認OTPのserver-side設定が未完了です" });
    }
    if (!["PENDING", "OTP_SENT"].includes(record.status)) {
      return redirectToApproval(request, { error: "このリクエストはOTP送信対象ではありません" });
    }
    if (record.otpSentAt && Date.now() - record.otpSentAt < 30_000) {
      return redirectToApproval(request, { error: "30秒後に再送できます" });
    }

    const operation = resolveRecordOperation(record);
    const policy = DEPLOY_APPROVAL_OPERATION_POLICY[operation];
    if (record.scope !== policy.scope || (record.ordersEnabled ?? true) !== policy.ordersEnabled) {
      return redirectToApproval(request, { error: "承認対象の操作ポリシーが一致しません" });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = Date.now();
    const sent = await sendEmail(
      APPROVAL_RECEIVER,
      "DisDex Production 操作承認コード",
      "承認コード: " + code
        + "\n有効期限: 5分"
        + "\n\n対象: " + policy.label
        + "\nScope: " + policy.scope
        + "\n注文権限: " + (policy.ordersEnabled ? "有効" : "無効")
        + "\nSHA: " + record.targetSha
        + "\nPlan/Context SHA-256: " + record.planSha256,
    );
    if (!sent.success || sent.simulated) {
      return redirectToApproval(request, { error: "実メールによる承認コード送信を確認できませんでした" });
    }

    const subject = "production:" + session.subject + ":" + record.id;
    const challenge = await createOtpChallenge({
      purpose: "DEPLOY_APPROVAL",
      subject,
      codeHash: otpHash(subject, code),
      now,
      expiresAt: now + 5 * 60 * 1000,
      maxAttempts: 5,
    });
    await mutateDeploymentApprovalAtomic(record.id, (current) => {
      if (!current || !["PENDING", "OTP_SENT"].includes(current.status)) {
        throw new Error("APPROVAL_NOT_OTP_ELIGIBLE");
      }
      return {
        next: {
          ...current,
          status: "OTP_SENT",
          otpSentAt: now,
          otpHash: undefined,
          otpExpiresAt: undefined,
          otpAttemptsRemaining: undefined,
          lastError: undefined,
        },
        result: null,
      };
    });
    const response = redirectToApproval(request, { message: "LIVE承認コードをメール送信しました" });
    setChallengeCookie(response, challenge.id);
    return response;
  }

  if (intent === "verify-otp") {
    if (!OTP_PEPPER) return redirectToApproval(request, { error: "承認OTP秘密値が未設定です" });
    const challengeId = request.cookies.get(APPROVAL_OTP_COOKIE)?.value || "";
    const code = String(formData.get("approvalCode") || "").trim();
    if (!challengeId || !/^\d{6}$/.test(code)) {
      const response = redirectToApproval(request, { error: "承認challengeが無効です。再送してください" });
      response.cookies.delete(APPROVAL_OTP_COOKIE);
      return response;
    }

    const subject = "production:" + session.subject + ":" + record.id;
    const consumed = await consumeOtpChallenge({
      id: challengeId,
      codeHash: otpHash(subject, code),
      purpose: "DEPLOY_APPROVAL",
      subject,
    });
    if (!consumed.ok) {
      const response = redirectToApproval(request, {
        error: consumed.reason === "INVALID_CODE"
          ? "承認コードが違います。残り" + String(consumed.remainingAttempts ?? 0) + "回"
          : "承認challengeが失効または使用済みです",
      });
      if (consumed.reason !== "INVALID_CODE") response.cookies.delete(APPROVAL_OTP_COOKIE);
      return response;
    }

    try {
      await mutateDeploymentApprovalAtomic(record.id, (current) => {
        if (!current || current.status !== "OTP_SENT") throw new Error("APPROVAL_NOT_OTP_SENT");
        if (current.requestExpiresAt < Date.now()) throw new Error("APPROVAL_EXPIRED");
        const operation = resolveRecordOperation(current);
        const policy = DEPLOY_APPROVAL_OPERATION_POLICY[operation];
        if (current.scope !== policy.scope || (current.ordersEnabled ?? true) !== policy.ordersEnabled) {
          throw new Error("APPROVAL_OPERATION_POLICY_MISMATCH");
        }

        const issued = issueDeploymentApprovalToken({
          targetSha: current.targetSha,
          planSha256: current.planSha256,
          operator: OPERATOR,
          privateKey: loadDeploymentApprovalPrivateKey(),
          scope: policy.scope,
          ordersEnabled: policy.ordersEnabled,
          ttlSeconds: 300,
        });
        const approvedAt = Date.now();
        return {
          next: {
            ...current,
            status: "APPROVED",
            approvedAt,
            approvalToken: issued.token,
            approvalTokenExpiresAt: issued.payload.expiresAt,
            approverIpHash: ipFingerprint(request),
            otpHash: undefined,
            otpExpiresAt: undefined,
            otpAttemptsRemaining: undefined,
            ...(operation === "ALL_RUNNERS_LIVE_RESTORE" ? {
              taskApprovedExpiresAt: approvedAt + ALL_RUNNERS_LIVE_TASK.maxAgeMs,
              taskMaxClaims: ALL_RUNNERS_LIVE_TASK.maxClaims,
              taskClaimCount: 0,
              taskClaimHistory: [],
            } : {}),
            lastError: undefined,
          },
          result: null,
        };
      });
      const response = redirectToApproval(request, {
        message: resolveRecordOperation(record) === "ALL_RUNNERS_LIVE_RESTORE"
          ? "全Runner LIVE復旧作業を承認しました。登録済み工程のみ有効期間内で継続できます。"
          : "本人認証が完了しました。署名済み承認証明を発行しました",
      });
      response.cookies.delete(APPROVAL_OTP_COOKIE);
      return response;
    } catch {
      return redirectToApproval(request, { error: "署名済み承認証明の発行に失敗しました" });
    }
  }

  return redirectToApproval(request, { error: "未対応の承認操作です" });
}
