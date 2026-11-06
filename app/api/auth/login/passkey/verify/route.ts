import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { consumeOtpChallenge, getActiveOtpChallenge } from "@/lib/server/otp-challenge-store";
import { findUserById, upsertUser } from "@/lib/server/user-db";
import { issueOwnerSession, loadOwnerSessionKey, OWNER_SESSION_COOKIE, ownerSessionCookieOptions } from "@/lib/server/owner-session";
import { USER_LOGIN_OTP_COOKIE } from "@/lib/server/user-login-otp";
import { requireSameOriginMutation } from "@/lib/server/request-security";
import { getWebAuthnRequestContext } from "@/lib/server/webauthn-origin";

const CHALLENGE_COOKIE = "disdex_login_webauthn_challenge";
const noStore = () => ({ "Cache-Control": "private, no-store, max-age=0" });

export async function POST(request: NextRequest) {
  try {
    requireSameOriginMutation(request);
    const { authenticationResponse } = await request.json();
    if (!authenticationResponse?.id) {
      return NextResponse.json({ success: false, error: "端末認証応答がありません。" }, { status: 400, headers: noStore() });
    }
    const loginChallengeId = request.cookies.get(USER_LOGIN_OTP_COOKIE)?.value || "";
    const pending = getActiveOtpChallenge(loginChallengeId, "USER_LOGIN");
    if (!pending || pending.factor !== "passkey") {
      return NextResponse.json({ success: false, error: "認証期限が切れました。" }, { status: 401, headers: noStore() });
    }
    const user = await findUserById(pending.subject);
    if (!user?.isApproved) {
      return NextResponse.json({ success: false, error: "ログインできません。" }, { status: 401, headers: noStore() });
    }
    const credentials = user.webAuthnCredentials || [];
    const credential = credentials.find((item: any) => item.id === authenticationResponse.id);
    const expectedChallenge = request.cookies.get(CHALLENGE_COOKIE)?.value;
    if (!credential || !expectedChallenge) {
      return NextResponse.json({ success: false, error: "端末認証セッションが無効です。" }, { status: 401, headers: noStore() });
    }
    const { origin, rpID } = getWebAuthnRequestContext(request);
    const verification = await verifyAuthenticationResponse({
      response: authenticationResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey, "base64"),
        counter: credential.counter,
      },
      requireUserVerification: true,
    });
    if (!verification.verified) {
      return NextResponse.json({ success: false, error: "指紋・端末認証に失敗しました。" }, { status: 401, headers: noStore() });
    }
    const consumed = await consumeOtpChallenge({
      id: loginChallengeId,
      purpose: "USER_LOGIN",
      subject: user.id,
      codeHash: pending.codeHash,
    });
    if (!consumed.ok) {
      return NextResponse.json({ success: false, error: "認証済みチャレンジを確定できませんでした。" }, { status: 401, headers: noStore() });
    }
    credential.counter = verification.authenticationInfo.newCounter;
    user.lastLogin = Date.now();
    await upsertUser(user);
    const token = issueOwnerSession({
      key: loadOwnerSessionKey(),
      subject: user.id,
      purpose: "USER",
      audience: request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host,
      ttlMs: 10 * 60 * 1000,
    });
    const { passwordHash, resetToken, resetTokenExpires, totpSecret, webAuthnCredentials, ...safe } = user;
    void passwordHash; void resetToken; void resetTokenExpires; void totpSecret; void webAuthnCredentials;
    const response = NextResponse.json({ success: true, user: safe }, { headers: noStore() });
    response.cookies.delete(USER_LOGIN_OTP_COOKIE);
    response.cookies.delete(CHALLENGE_COOKIE);
    response.cookies.set(OWNER_SESSION_COOKIE, token, ownerSessionCookieOptions(10 * 60));
    return response;
  } catch {
    return NextResponse.json({ success: false, error: "指紋・端末認証を完了できませんでした。" }, { status: 503, headers: noStore() });
  }
}
