import crypto from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";
import {
  getDeploymentApproval,
  saveDeploymentApproval,
} from "@/lib/server/deploy-approval-store";
import {
  issueDeploymentApprovalToken,
  loadDeploymentApprovalPrivateKey,
} from "@/lib/deploy-approval-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_COOKIE = "disdex_admin_session";
const ADMIN_2FA_RECEIVER = process.env.ADMIN_CONTACT_EMAIL || process.env.GMAIL_USER || "";
const OTP_PEPPER = process.env.DISDEX_DEPLOY_OTP_PEPPER?.trim() || "";
const OPERATOR = "dunamishajime-bit";
const UUID_RE = /^[0-9a-f-]{36}$/i;

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
  const url = new URL("/admin", base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

function redirect(request: NextRequest, params: Record<string, string>) {
  return NextResponse.redirect(redirectUrl(request, params));
}

async function requireAdminSession() {
  const store = await cookies();
  return store.get(ADMIN_COOKIE)?.value === "active";
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host");
    const expectedHost = forwardedHost || request.headers.get("host") || request.nextUrl.host;
    return originUrl.host === expectedHost;
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
  if (!(await requireAdminSession())) {
    return redirect(request, { error: "管理者ログインが必要です" });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const requestId = String(formData.get("requestId") || "").trim();
  if (!UUID_RE.test(requestId)) {
    return redirect(request, { error: "承認リクエストIDが不正です" });
  }

  const record = await getDeploymentApproval(requestId);
  if (!record) return redirect(request, { error: "承認リクエストが見つかりません" });
  if (record.requestExpiresAt < Date.now() && !["DISPATCHED", "REDEEMED"].includes(record.status)) {
    await saveDeploymentApproval({ ...record, status: "EXPIRED", lastError: "request expired" });
    return redirect(request, { error: "承認リクエストの有効期限が切れています" });
  }

  if (intent === "request-otp") {
    if (!ADMIN_2FA_RECEIVER) {
      return redirect(request, { error: "承認コードの送信先メールが未設定です" });
    }
    if (!OTP_PEPPER) {
      return redirect(request, { error: "デプロイ承認OTP秘密値が未設定です" });
    }
    if (!["PENDING", "OTP_SENT"].includes(record.status)) {
      return redirect(request, { error: "このリクエストはOTP送信対象ではありません" });
    }
    if (record.otpSentAt && Date.now() - record.otpSentAt < 30_000) {
      return redirect(request, { deployStep: "code", error: "30秒後に再送できます" });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = Date.now();
    const sent = await sendEmail(
      ADMIN_2FA_RECEIVER,
      "DisDex Production LIVE 承認コード",
      [
        `承認コード: ${code}`,
        "有効期限: 5分",
        "",
        "対象: V12_V4 Production LIVE",
        `SHA: ${record.targetSha}`,
        `Plan SHA-256: ${record.planSha256}`,
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
    return redirect(request, { deployStep: "code", message: "LIVE承認コードをメール送信しました" });
  }

  if (intent === "verify-otp") {
    if (!OTP_PEPPER) {
      return redirect(request, { error: "デプロイ承認OTP秘密値が未設定です" });
    }
    const code = String(formData.get("approvalCode") || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return redirect(request, { deployStep: "code", error: "6桁の承認コードを入力してください" });
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
        deployStep: remaining > 0 ? "code" : "",
        error: remaining > 0 ? `承認コードが違います。残り${remaining}回` : "試行回数上限に達しました",
      });
    }

    try {
      const { token, payload } = issueDeploymentApprovalToken({
        targetSha: record.targetSha,
        planSha256: record.planSha256,
        operator: OPERATOR,
        privateKey: loadDeploymentApprovalPrivateKey(),
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
        lastError: undefined,
      });

      return redirect(request, {
        message: "本人認証が完了しました。署名済み承認証明を発行しました",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "approval signing failed";
      await saveDeploymentApproval({ ...record, status: "FAILED", lastError: message });
      return redirect(request, { error: "本人認証後の署名済み承認証明の発行に失敗しました" });
    }
  }

  return redirect(request, { error: "未対応の承認操作です" });
}
