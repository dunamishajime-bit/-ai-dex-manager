import crypto from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";
import { deleteUser, findUserByEmail, findUserById, upsertUser } from "@/lib/server/user-db";
import { loadSystemSettings, saveSystemSettings } from "@/lib/server/system-settings-db";

const ADMIN_COOKIE = "disdex_admin_session";
const ADMIN_2FA_HASH_COOKIE = "disdex_admin_2fa_hash";
const ADMIN_2FA_EXPIRES_COOKIE = "disdex_admin_2fa_expires";
const ADMIN_2FA_EMAIL_COOKIE = "disdex_admin_2fa_email";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || "";
const ADMIN_2FA_RECEIVER = process.env.ADMIN_CONTACT_EMAIL || process.env.GMAIL_USER || "";

function hashCode(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
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

async function requireAdminSession() {
  const store = await cookies();
  return store.get(ADMIN_COOKIE)?.value === "active";
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const store = await cookies();

  if (intent === "login") {
    if (!ADMIN_PASSWORD) {
      return NextResponse.json(
        { ok: false, error: "ADMIN_PASSWORD is not configured." },
        { status: 503 },
      );
    }

    const password = String(formData.get("admin_password") || "").trim();
    if (password !== ADMIN_PASSWORD) {
      return redirectWithCookies(request, { error: "管理者パスワードが正しくありません" });
    }

    const settings = await loadSystemSettings();
    if (!settings.adminTwoFactorEnabled) {
      const response = redirectWithCookies(request, { message: "ログインしました" });
      response.cookies.set(ADMIN_COOKIE, "active", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12,
      });
      return response;
    }

    if (!ADMIN_2FA_RECEIVER) {
      return redirectWithCookies(request, { error: "管理者2FAの送信先メールが未設定です" });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const sent = await sendEmail(
      ADMIN_2FA_RECEIVER,
      "DisDexDeployer 管理者ログイン認証コード",
      `管理者ログイン認証コード: ${code}\n有効期限: 10分`,
    );

    if (!sent.success) {
      return redirectWithCookies(request, { error: "認証コードの送信に失敗しました" });
    }

    const response = redirectWithCookies(request, { step: "code", message: "認証コードを送信しました" });
    response.cookies.set(ADMIN_2FA_HASH_COOKIE, hashCode(code), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    response.cookies.set(ADMIN_2FA_EXPIRES_COOKIE, String(expiresAt), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    response.cookies.set(ADMIN_2FA_EMAIL_COOKIE, ADMIN_2FA_RECEIVER, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 10,
    });
    return response;
  }

  if (intent === "verify") {
    const code = String(formData.get("admin_code") || "").trim();
    const hash = store.get(ADMIN_2FA_HASH_COOKIE)?.value;
    const expiresAt = Number(store.get(ADMIN_2FA_EXPIRES_COOKIE)?.value || "0");

    if (!code || !hash || !expiresAt || Date.now() > expiresAt) {
      const response = redirectWithCookies(request, { error: "認証コードの有効期限が切れています" });
      response.cookies.delete(ADMIN_2FA_HASH_COOKIE);
      response.cookies.delete(ADMIN_2FA_EXPIRES_COOKIE);
      response.cookies.delete(ADMIN_2FA_EMAIL_COOKIE);
      return response;
    }

    if (hashCode(code) !== hash) {
      return redirectWithCookies(request, { step: "code", error: "認証コードが正しくありません" });
    }

    const response = redirectWithCookies(request, { message: "管理者ログインを確認しました" });
    response.cookies.delete(ADMIN_2FA_HASH_COOKIE);
    response.cookies.delete(ADMIN_2FA_EXPIRES_COOKIE);
    response.cookies.delete(ADMIN_2FA_EMAIL_COOKIE);
    response.cookies.set(ADMIN_COOKIE, "active", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  }

  if (intent === "logout") {
    const response = redirectWithCookies(request, { message: "ログアウトしました" });
    response.cookies.delete(ADMIN_COOKIE);
    response.cookies.delete(ADMIN_2FA_HASH_COOKIE);
    response.cookies.delete(ADMIN_2FA_EXPIRES_COOKIE);
    response.cookies.delete(ADMIN_2FA_EMAIL_COOKIE);
    return response;
  }

  if (!(await requireAdminSession())) {
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
