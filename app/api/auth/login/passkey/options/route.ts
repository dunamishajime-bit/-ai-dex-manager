import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getActiveOtpChallenge } from "@/lib/server/otp-challenge-store";
import { findUserById } from "@/lib/server/user-db";
import { USER_LOGIN_OTP_COOKIE } from "@/lib/server/user-login-otp";
import { requireSameOriginMutation } from "@/lib/server/request-security";
import { getWebAuthnRequestContext } from "@/lib/server/webauthn-origin";

const CHALLENGE_COOKIE = "disdex_login_webauthn_challenge";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    requireSameOriginMutation(request);
    const loginChallengeId = request.cookies.get(USER_LOGIN_OTP_COOKIE)?.value || "";
    const pending = getActiveOtpChallenge(loginChallengeId, "USER_LOGIN");
    if (!pending || pending.factor !== "passkey") {
      return NextResponse.json({ error: "指紋・端末認証の待機状態がありません。" }, { status: 409, headers });
    }
    const user = await findUserById(pending.subject);
    const credentials = user?.webAuthnCredentials || [];
    if (!user?.isApproved || !credentials.length) {
      return NextResponse.json({ error: "指紋・端末認証を利用できません。" }, { status: 409, headers });
    }
    const { rpID } = getWebAuthnRequestContext(request);
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials.map((credential: any) => ({
        id: credential.id,
        type: "public-key",
        transports: credential.transports,
      })),
      userVerification: "required",
    });
    const response = NextResponse.json(options, { headers });
    response.cookies.set(CHALLENGE_COOKIE, options.challenge, {
      httpOnly: true, secure: true, sameSite: "strict", maxAge: 300, path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ error: "指紋・端末認証を開始できませんでした。" }, { status: 503, headers });
  }
}
