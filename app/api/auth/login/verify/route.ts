import { NextRequest, NextResponse } from "next/server";
import { verifyTOTPToken } from "@/lib/security-service";
import { consumeOtpChallenge, getActiveOtpChallenge } from "@/lib/server/otp-challenge-store";
import { findUserById, upsertUser } from "@/lib/server/user-db";
import { issueOwnerSession, loadOwnerSessionKey, OWNER_SESSION_COOKIE, ownerSessionCookieOptions } from "@/lib/server/owner-session";
import { loginFactorFor, otpHashForUser, USER_LOGIN_OTP_COOKIE } from "@/lib/server/user-login-otp";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}

export async function POST(req: NextRequest) {
  try {
    requireSameOriginMutation(req);
    const { code } = (await req.json()) as { code?: string };
    const challengeId = req.cookies.get(USER_LOGIN_OTP_COOKIE)?.value || "";
    if (!/^\d{6}$/.test(String(code || ""))) {
      return NextResponse.json({ success: false, error: "6桁の認証コードを入力してください。" }, { status: 400, headers: noStore() });
    }
    const challenge = getActiveOtpChallenge(challengeId, "USER_LOGIN");
    if (!challenge) {
      return NextResponse.json({ success: false, error: "認証期限が切れました。最初からログインしてください。" }, { status: 401, headers: noStore() });
    }
    const user = await findUserById(challenge.subject);
    if (!user || !user.isApproved) {
      return NextResponse.json({ success: false, error: "ログインできません。" }, { status: 401, headers: noStore() });
    }
    const method = challenge.factor || loginFactorFor(user);
    if (method === "passkey") {
      return NextResponse.json({ success: false, error: "指紋・端末認証を実行してください。" }, { status: 409, headers: noStore() });
    }
    const valid = method === "totp"
      ? Boolean(user.totpSecret) && await verifyTOTPToken(String(code), user.totpSecret!)
      : otpHashForUser(user.id, String(code)) === challenge.codeHash;

    // TOTP challenge is a random one-use server nonce; wrong attempts are
    // atomically counted by the shared challenge store as invalid hashes.
    const candidateHash = method === "totp" && valid
      ? challenge.codeHash
      : method === "totp"
        ? "0".repeat(64)
        : otpHashForUser(user.id, String(code));
    const consumed = await consumeOtpChallenge({
      id: challengeId,
      purpose: "USER_LOGIN",
      subject: user.id,
      codeHash: candidateHash,
    });
    if (!consumed.ok || !valid) {
      return NextResponse.json({ success: false, error: "認証コードが無効です。再確認してください。" }, { status: 401, headers: noStore() });
    }
    const token = issueOwnerSession({
      key: loadOwnerSessionKey(),
      subject: user.id,
      purpose: "USER",
      audience: req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host,
      ttlMs: 10 * 60 * 1000,
    });
    user.lastLogin = Date.now();
    await upsertUser(user);
    const { passwordHash, resetToken, resetTokenExpires, totpSecret, ...safe } = user;
    void passwordHash; void resetToken; void resetTokenExpires; void totpSecret;
    const response = NextResponse.json({ success: true, user: safe }, { headers: noStore() });
    response.cookies.delete(USER_LOGIN_OTP_COOKIE);
    response.cookies.set(OWNER_SESSION_COOKIE, token, ownerSessionCookieOptions(10 * 60));
    return response;
  } catch {
    return NextResponse.json({ success: false, error: "認証処理を完了できませんでした。" }, { status: 503, headers: noStore() });
  }
}
