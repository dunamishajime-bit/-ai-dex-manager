import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";
import { createOtpChallenge } from "@/lib/server/otp-challenge-store";
import type { ServerUser } from "@/lib/server/user-db";

export const USER_LOGIN_OTP_COOKIE = "disdex_user_login_otp_challenge";
export type LoginFactor = "passkey" | "totp" | "email";
export const LOGIN_FACTOR_PRIORITY: LoginFactor[] = ["passkey", "totp", "email"];
const TTL_MS = 10 * 60 * 1000;

export function otpHashForUser(userId: string, code: string) {
  const pepper = process.env.DISDEX_DEPLOY_OTP_PEPPER?.trim() || "";
  if (pepper.length < 32) throw new Error("USER_LOGIN_OTP_PEPPER_UNAVAILABLE");
  return crypto.createHmac("sha256", pepper).update("USER_LOGIN:" + userId + ":" + code).digest("hex");
}

export function availableLoginFactors(user: ServerUser): LoginFactor[] {
  const available: LoginFactor[] = [];
  if (Array.isArray(user.webAuthnCredentials) && user.webAuthnCredentials.length > 0) available.push("passkey");
  if (user.isTotpEnabled && Boolean(user.totpSecret)) available.push("totp");
  if (Boolean(user.email)) available.push("email");
  return LOGIN_FACTOR_PRIORITY.filter((factor) => available.includes(factor));
}

export function loginFactorFor(user: ServerUser): LoginFactor {
  const factor = availableLoginFactors(user)[0];
  if (!factor) throw new Error("USER_LOGIN_NO_SECOND_FACTOR_AVAILABLE");
  return factor;
}

export function setLoginChallengeCookie(response: NextResponse, challengeId: string) {
  response.cookies.set(USER_LOGIN_OTP_COOKIE, challengeId, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function startUserLoginChallenge(user: ServerUser, requestedFactor?: LoginFactor) {
  const available = availableLoginFactors(user);
  const factor = requestedFactor || available[0];
  if (!factor || !available.includes(factor)) throw new Error("USER_LOGIN_FACTOR_UNAVAILABLE");
  const now = Date.now();

  if (factor === "email") {
    const code = String(crypto.randomInt(100000, 1000000));
    const result = await sendEmail(
      user.email,
      "DisDex Manager ログイン認証コード",
      "ログイン認証コード: " + code + "\n有効期限: 10分。心当たりがない場合は無視してください。",
    );
    if (!result.success || result.simulated) throw new Error("USER_LOGIN_REAL_MAIL_NOT_CONFIRMED");
    const challenge = await createOtpChallenge({
      purpose: "USER_LOGIN",
      subject: user.id,
      factor,
      codeHash: otpHashForUser(user.id, code),
      now,
      expiresAt: now + TTL_MS,
      maxAttempts: 5,
    });
    return { challengeId: challenge.id, factor, availableMethods: available };
  }

  const challenge = await createOtpChallenge({
    purpose: "USER_LOGIN",
    subject: user.id,
    factor,
    codeHash: crypto.randomBytes(32).toString("hex"),
    now,
    expiresAt: now + TTL_MS,
    maxAttempts: 5,
  });
  return { challengeId: challenge.id, factor, availableMethods: available };
}
