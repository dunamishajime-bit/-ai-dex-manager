import { NextRequest, NextResponse } from "next/server";
import { getActiveOtpChallenge } from "@/lib/server/otp-challenge-store";
import { findUserById } from "@/lib/server/user-db";
import { loginFactorFor, USER_LOGIN_OTP_COOKIE } from "@/lib/server/user-login-otp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    const challengeId = request.cookies.get(USER_LOGIN_OTP_COOKIE)?.value || "";
    const pending = getActiveOtpChallenge(challengeId, "USER_LOGIN");
    if (!pending) {
      return NextResponse.json({ pending: false }, { headers });
    }
    const user = await findUserById(pending.subject);
    if (!user || !user.isApproved) {
      return NextResponse.json({ pending: false }, { headers });
    }
    // Do not reveal user identity, email, challenge ID or authentication secret.
    return NextResponse.json({ pending: true, method: loginFactorFor(user) }, { headers });
  } catch {
    return NextResponse.json({ pending: false }, { status: 503, headers });
  }
}
