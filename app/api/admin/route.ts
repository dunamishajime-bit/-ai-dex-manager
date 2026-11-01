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

const ADMIN_2FA_CHALLENGE_COOKIE = "disdex_admin_2fa_challenge";
const ADMIN_2FA_EMAIL_COOKIE = "disdex_admin_2fa_email";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "";
const ADMIN_2FA_RECEIVER = process.env.ADMIN_CONTACT_EMAIL || process.env.GMAIL_USER || "";
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function safePasswordEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function audience(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
}

function adminUrl(request: NextRequest, params: Record<string, string>) {
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
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url;
}

function redirectWithCookies(request: NextRequest, params: Record<string, string>) {
  return NextResponse.redirect(adminUrl(request, params));
}

function issueAdminSession(response: NextResponse, request: NextRequest) {
  const token = issueOwnerSession({
    key: loadOwnerSessionKey(),
    subject: "admin",
    purpose: "ADMIN",
    audience: audience(request),
    ttlMs: ADMIN_SESSION_TTL_MS,
  });
  response.cookies.set(OWNER_SESSION_COOKIE, token, ownerSessionCookieOptions(ADMIN_SESSION_TTL_MS / 1000));
}

function clearAdminCookies(response: NextResponse) {
  response.cookies.delete(OWNER_SESSION_COOKIE);
  response.cookies.delete(ADMIN_2FA_CHALLENGE_COOKIE);
  response.cookies.delete(ADMIN_2FA_EMAIL_COOKIE);
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

    const password = String(formData.get("admin_password") || "").trim();
    if (!safePasswordEqual(password, ADMIN_PASSWORD)) {
      return redirectWithCookies(request, { error: "管理者パスワードが正しくありません" });
    }

    const settings = await loadSystemSettings();
    if (!settings.adminTwoFactorEnabled) {
      try {
        const response = redirectWithCookies(request, { message: "ログインしました" });
        issueAdminSession(response, request);
        return response;
      } catch {
        return redirectWithCookies(request, { error: "管理者セッション鍵が未設定です" });
      }
    }

    if (!ADMIN_2FA_RECEIVER) {
      return redirectWithCookies(request, { error: "管理者2FAの送信先メールが未設定です" });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const sent = await sendEmail(
      ADMIN_2FA_RECEIVER,
      "DisDexDeployer 管理者ログイン認証コード",
      `管理者ログイン認証コード: ${code}\n有効期限: 10分`,
    );

    if (!sent.success || sent.simulated) {
      return redirectWithCookies(request, { error: "認証コードの実送信に失敗しました" });
    }

    const challenge = await createOtpChallenge({
      purpose: "ADMIN_LOGIN",
      subject: ADMIN_2FA_RECEIVER,
      codeHash: hashCode(code),
      expiresAt,
      maxAttempts: 5,
    });

    const response = redirectWithCookies(request, { step: "code", message: "認証コードを送信しました" });
    response.cookies.set(ADMIN_2FA_CHALLENGE_COOKIE, challenge.id, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 10,
    });
    response.cookies.set(ADMIN_2FA_EMAIL_COOKIE, ADMIN_2FA_RECEIVER, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 10,
    });
    return response;
  }

  if (intent === "verify") {
    const code = String(formData.get("admin_code") || "").trim();
    const challengeId = request.cookies.get(ADMIN_2FA_CHALLENGE_COOKIE)?.value || "";
    if (!/^\d{6}$/.test(code) || !challengeId || !ADMIN_2FA_RECEIVER) {
      const response = redirectWithCookies(request, { error: "認証コードの有効期限が切れています" });
      response.cookies.delete(ADMIN_2FA_CHALLENGE_COOKIE);
      response.cookies.delete(ADMIN_2FA_EMAIL_COOKIE);
      return response;
    }

    const result = await consumeOtpChallenge({
      id: challengeId,
      codeHash: hashCode(code),
      purpose: "ADMIN_LOGIN",
      subject: ADMIN_2FA_RECEIVER,
    });
    if (!result.ok) {
      const response = redirectWithCookies(request, {
        step: result.reason === "INVALID_CODE" ? "code" : "",
        error: result.reason === "INVALID_CODE"
          ? `認証コードが正しくありません。残り${result.remainingAttempts ?? 0}回`
          : "認証コードが失効しています。再度ログインしてください",
      });
      if (result.reason !== "INVALID_CODE") {
        response.cookies.delete(ADMIN_2FA_CHALLENGE_COOKIE);
        response.cookies.delete(ADMIN_2FA_EMAIL_COOKIE);
      }
      return response;
    }

    try {
      const response = redirectWithCookies(request, { message: "管理者ログインを確認しました" });
      response.cookies.delete(ADMIN_2FA_CHALLENGE_COOKIE);
      response.cookies.delete(ADMIN_2FA_EMAIL_COOKIE);
      issueAdminSession(response, request);
      return response;
    } catch {
      return redirectWithCookies(request, { error: "管理者セッション鍵が未設定です" });
    }
  }

  if (intent === "logout") {
    const response = redirectWithCookies(request, { message: "ログアウトしました" });
    clearAdminCookies(response);
    return response;
  }

  try {
    verifyRequestSession(request, ["ADMIN"]);
  } catch {
    return redirectWithCookies(request, { error: "管理者ログインが必要です" });
  }

  if (intent === "registration-setting") {
    const enabled = String(formData.get("registrationEnabled") || "off") === "on";
    await saveSystemSettings({ registrationEnabled: enabled });
    return redirectWithCookies(request, { message: "新規登録設定を保存しました" });
  }

  if (intent === "admin-2fa-setting") {
    const enabled = String(formData.get("adminTwoFactorEnabled") || "off") === "on";
    await saveSystemSettings({ adminTwoFactorEnabled: enabled });
    return redirectWithCookies(request, { message: "管理者2FA設定を保存しました" });
  }

  if (intent === "update-user-email") {
    const target = String(formData.get("targetEmail") || "").trim().toLowerCase();
    const nextEmail = String(formData.get("nextEmail") || "").trim().toLowerCase();
    if (!target || !nextEmail) {
      return redirectWithCookies(request, { error: "変更前メールと変更後メールを入力してください" });
    }

    const user = (await findUserByEmail(target)) || (await findUserById(target));
    if (!user) {
      return redirectWithCookies(request, { error: "対象アカウントが見つかりません" });
    }

    const duplicate = await findUserByEmail(nextEmail);
    if (duplicate && duplicate.id !== user.id) {
      return redirectWithCookies(request, { error: "変更後メールはすでに使用されています" });
    }

    user.email = nextEmail;
    await upsertUser(user);
    return redirectWithCookies(request, { message: "アカウントのメールアドレスを更新しました" });
  }

  if (intent === "remove-user") {
    const userId = String(formData.get("userId") || "");
    if (!userId) {
      return redirectWithCookies(request, { error: "削除対象アカウントが指定されていません" });
    }
    await deleteUser(userId);
    return redirectWithCookies(request, { message: "アカウントを削除しました" });
  }

  return redirectWithCookies(request, { error: "未対応の操作です" });
}
