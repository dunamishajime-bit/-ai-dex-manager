import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail } from "@/lib/server/user-db";
import { verifyPassword } from "@/lib/server/password-hash";
import { loadOwnerSessionKey } from "@/lib/server/owner-session";
import { setLoginChallengeCookie, startUserLoginChallenge } from "@/lib/server/user-login-otp";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    requireSameOriginMutation(req);
    const { email, password } = await req.json();
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return NextResponse.json({ success: false, error: "メールとパスワードが必要です。" }, { status: 400, headers });
    }
    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash)).ok) {
      return NextResponse.json({ success: false, error: "メールアドレスまたはパスワードが正しくありません。" }, { status: 401, headers });
    }
    if (!user.isApproved) {
      return NextResponse.json({ success: false, error: "承認待ちのアカウントです。" }, { status: 403, headers });
    }
    // Fail closed if signing credentials or second-factor dependencies are unavailable.
    if (!loadOwnerSessionKey()) throw new Error("OWNER_SESSION_HMAC_KEY_UNAVAILABLE");
    const challenge = await startUserLoginChallenge(user);
    const response = NextResponse.json({
      success: true,
      requiresSecondFactor: true,
      method: challenge.factor,
    }, { headers });
    setLoginChallengeCookie(response, challenge.challengeId);
    // Full USER owner session is issued ONLY in /api/auth/login/verify.
    return response;
  } catch {
    return NextResponse.json({ success: false, error: "ログイン認証を開始できませんでした。" }, { status: 503, headers });
  }
}
