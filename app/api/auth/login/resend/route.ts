import { NextRequest, NextResponse } from "next/server";
import { findUserById } from "@/lib/server/user-db";
import { getActiveOtpChallenge } from "@/lib/server/otp-challenge-store";
import { loginFactorFor, setLoginChallengeCookie, startUserLoginChallenge, USER_LOGIN_OTP_COOKIE } from "@/lib/server/user-login-otp";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    requireSameOriginMutation(req);
    const challengeId = req.cookies.get(USER_LOGIN_OTP_COOKIE)?.value || "";
    const challenge = getActiveOtpChallenge(challengeId, "USER_LOGIN");
    if (!challenge) return NextResponse.json({ success: false, error: "最初からログインしてください。" }, { status: 401, headers });
    if (Date.now() - challenge.createdAt < 60_000) {
      return NextResponse.json({ success: false, error: "60秒経過後に再送できます。" }, { status: 429, headers });
    }
    const user = await findUserById(challenge.subject);
    if (!user?.isApproved || loginFactorFor(user) !== "email") {
      return NextResponse.json({ success: false, error: "再送できません。" }, { status: 403, headers });
    }
    const next = await startUserLoginChallenge(user);
    const response = NextResponse.json({ success: true }, { headers });
    setLoginChallengeCookie(response, next.challengeId);
    return response;
  } catch {
    return NextResponse.json({ success: false, error: "認証コードを再送できませんでした。" }, { status: 503, headers });
  }
}
