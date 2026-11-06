import { NextRequest, NextResponse } from "next/server";
import { getActiveOtpChallenge } from "@/lib/server/otp-challenge-store";
import { findUserById } from "@/lib/server/user-db";
import { availableLoginFactors, type LoginFactor, setLoginChallengeCookie, startUserLoginChallenge, USER_LOGIN_OTP_COOKIE } from "@/lib/server/user-login-otp";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    requireSameOriginMutation(request);
    const body = await request.json() as { method?: LoginFactor };
    const method = body.method;
    if (method !== "passkey" && method !== "totp" && method !== "email") {
      return NextResponse.json({ success: false, error: "認証方法が不正です。" }, { status: 400, headers });
    }
    const challengeId = request.cookies.get(USER_LOGIN_OTP_COOKIE)?.value || "";
    const pending = getActiveOtpChallenge(challengeId, "USER_LOGIN");
    if (!pending) return NextResponse.json({ success: false, error: "認証期限が切れました。" }, { status: 401, headers });
    const user = await findUserById(pending.subject);
    if (!user || !user.isApproved) return NextResponse.json({ success: false, error: "ログインできません。" }, { status: 401, headers });
    const availableMethods = availableLoginFactors(user);
    if (!availableMethods.includes(method)) {
      return NextResponse.json({ success: false, error: "この認証方法は現在利用できません。" }, { status: 409, headers });
    }
    const next = await startUserLoginChallenge(user, method);
    const response = NextResponse.json({ success: true, method: next.factor, availableMethods: next.availableMethods }, { headers });
    setLoginChallengeCookie(response, next.challengeId);
    return response;
  } catch {
    return NextResponse.json({ success: false, error: "認証方法を切り替えできませんでした。" }, { status: 503, headers });
  }
}
