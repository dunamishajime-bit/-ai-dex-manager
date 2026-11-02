import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";
import { deleteUser, findUserByEmail, findUserById, upsertUser } from "@/lib/server/user-db";
import { loadSystemSettings, saveSystemSettings } from "@/lib/server/system-settings-db";
import {
  issueOwnerSession,
  loadOwnerSessionKey,
  OWNER_SESSION_COOKIE,
  ownerSessionCookieOptions,
  verifyRequestSession,
} from "@/lib/server/owner-session";
import { createOtpChallenge, consumeOtpChallenge } from "@/lib/server/otp-challenge-store";
import { requireSameOriginMutation } from "@/lib/server/request-security";

const ADMIN_OTP_COOKIE = "disdex_admin_otp_challenge";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "";
const ADMIN_2FA_RECEIVER = process.env.ADMIN_CONTACT_EMAIL || process.env.GMAIL_USER || "";
const OTP_PEPPER = process.env.DISDEX_DEPLOY_OTP_PEPPER?.trim() || "";

function audience(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
}

function adminUrl(request: NextRequest, params: Record<string, string>) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const envBase = process.env.NEXT_PUBLIC_APP_URL;
  const base =
    forwardedHost && forwardedProto
      ? forwardedProto + "://" + forwardedHost
      : envBase && !/localhost|127\.0\.0\.1/.test(envBase)
        ? envBase
        : request.nextUrl.origin;
  const url = new URL("/admin", base);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url;
}

function redirectToAdmin(request: NextRequest, params: Record<string, string>) {
  return NextResponse.redirect(adminUrl(request, params));
}

function safeTextEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function otpHash(subject: string, code: string) {
  if (!OTP_PEPPER) throw new Error("DISDEX_DEPLOY_OTP_PEPPER is not configured");
  return crypto.createHmac("sha256", OTP_PEPPER).update(subject + ":" + code).digest("hex");
}

function setAdminSession(response: NextResponse, request: NextRequest) {
  const token = issueOwnerSession({
    key: loadOwnerSessionKey(),
    subject: "admin",
    purpose: "ADMIN",
    audience: audience(request),
    ttlMs: 10 * 60 * 1000,
  });
  response.cookies.set(OWNER_SESSION_COOKIE, token, ownerSessionCookieOptions(10 * 60));
}

function setChallengeCookie(response: NextResponse, challengeId: string) {
  response.cookies.set(ADMIN_OTP_COOKIE, challengeId, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 10 * 60,
  });
}

export async function POST(request: NextRequest) {
  try {
    requireSameOriginMutation(request);
  } catch {
    return NextResponse.json({ ok: false, error: "origin mismatch" }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "login") {
    if (!ADMIN_PASSWORD) {
      return NextResponse.json(
        { ok: false, error: "ADMIN_PASSWORD is not configured." },
        { status: 503 },
      );
    }
    if (!loadOwnerSessionKey()) {
      return NextResponse.json(
        { ok: false, error: "Owner session signing is not configured." },
        { status: 503 },
      );
    }

    const password = String(formData.get("admin_password") || "");
    if (!safeTextEqual(password, ADMIN_PASSWORD)) {
      return redirectToAdmin(request, { error: "管理者パスワードが正しくありません" });
    }

    const settings = await loadSystemSettings();
    if (!settings.adminTwoFactorEnabled) {
      const response = redirectToAdmin(request, { message: "ログインしました" });
      setAdminSession(response, request);
      response.cookies.delete(ADMIN_OTP_COOKIE);
      return response;
    }

    if (!ADMIN_2FA_RECEIVER || !OTP_PEPPER) {
      return redirectToAdmin(request, { error: "管理者2FAのserver-side設定が未完了です" });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = Date.now();
    const sent = await sendEmail(
      ADMIN_2FA_RECEIVER,
      "DisDexDeployer 管理者ログイン認証コード",
      "管理者ログイン認証コード: " + code + "\n有効期限: 10分",
    );
    if (!sent.success || sent.simulated) {
      return redirectToAdmin(request, { error: "実メールによる認証コード送信を確認できませんでした" });
    }

    const challenge = await createOtpChallenge({
      purpose: "ADMIN_LOGIN",
      subject: "admin",
      codeHash: otpHash("admin", code),
      now,
      expiresAt: now + 10 * 60 * 1000,
      maxAttempts: 5,
    });
    const response = redirectToAdmin(request, { step: "code", message: "認証コードを送信しました" });
    setChallengeCookie(response, challenge.id);
    return response;
  }

  if (intent === "verify") {
    if (!OTP_PEPPER) return redirectToAdmin(request, { error: "管理者2FA秘密値が未設定です" });
    const challengeId = request.cookies.get(ADMIN_OTP_COOKIE)?.value || "";
    const code = String(formData.get("admin_code") || "").trim();
    if (!challengeId || !/^\d{6}$/.test(code)) {
      const response = redirectToAdmin(request, { error: "認証challengeが無効です。再ログインしてください" });
      response.cookies.delete(ADMIN_OTP_COOKIE);
      return response;
    }
    const consumed = await consumeOtpChallenge({
      id: challengeId,
      codeHash: otpHash("admin", code),
      purpose: "ADMIN_LOGIN",
      subject: "admin",
    });
    if (!consumed.ok) {
      const response = redirectToAdmin(request, {
        step: consumed.reason === "INVALID_CODE" ? "code" : "",
        error: consumed.reason === "INVALID_CODE"
          ? "認証コードが正しくありません。残り" + String(consumed.remainingAttempts ?? 0) + "回"
          : "認証challengeが失効または使用済みです",
      });
      if (consumed.reason !== "INVALID_CODE") response.cookies.delete(ADMIN_OTP_COOKIE);
      return response;
    }

    const response = redirectToAdmin(request, { message: "管理者ログインを確認しました" });
    response.cookies.delete(ADMIN_OTP_COOKIE);
    setAdminSession(response, request);
    return response;
  }

  if (intent === "logout") {
    const response = redirectToAdmin(request, { message: "ログアウトしました" });
    response.cookies.delete(OWNER_SESSION_COOKIE);
    response.cookies.delete(ADMIN_OTP_COOKIE);
    return response;
  }

  try {
    verifyRequestSession(request, ["ADMIN"]);
  } catch {
    return redirectToAdmin(request, { error: "管理者ログインが必要です" });
  }

  if (intent === "registration-setting") {
    const enabled = String(formData.get("registrationEnabled") || "off") === "on";
    await saveSystemSettings({ registrationEnabled: enabled });
    return redirectToAdmin(request, { message: "新規登録設定を保存しました" });
  }

  if (intent === "admin-2fa-setting") {
    const enabled = String(formData.get("adminTwoFactorEnabled") || "off") === "on";
    await saveSystemSettings({ adminTwoFactorEnabled: enabled });
    return redirectToAdmin(request, { message: "管理者2FA設定を保存しました" });
  }

  if (intent === "update-user-email") {
    const target = String(formData.get("targetEmail") || "").trim().toLowerCase();
    const nextEmail = String(formData.get("nextEmail") || "").trim().toLowerCase();
    if (!target || !nextEmail) {
      return redirectToAdmin(request, { error: "変更前メールと変更後メールを入力してください" });
    }
    const user = (await findUserByEmail(target)) || (await findUserById(target));
    if (!user) return redirectToAdmin(request, { error: "対象アカウントが見つかりません" });
    const duplicate = await findUserByEmail(nextEmail);
    if (duplicate && duplicate.id !== user.id) {
      return redirectToAdmin(request, { error: "変更後メールはすでに使用されています" });
    }
    user.email = nextEmail;
    await upsertUser(user);
    return redirectToAdmin(request, { message: "アカウントのメールアドレスを更新しました" });
  }

  if (intent === "remove-user") {
    const userId = String(formData.get("userId") || "");
    if (!userId) return redirectToAdmin(request, { error: "削除対象アカウントが指定されていません" });
    await deleteUser(userId);
    return redirectToAdmin(request, { message: "アカウントを削除しました" });
  }

  return redirectToAdmin(request, { error: "未対応の操作です" });
}
