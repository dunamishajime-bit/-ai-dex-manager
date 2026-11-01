import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, upsertUser } from "@/lib/server/user-db";
import { hashPassword, verifyPassword } from "@/lib/server/password-hash";
import {
  issueOwnerSession,
  loadOwnerSessionKey,
  OWNER_SESSION_COOKIE,
  ownerSessionCookieOptions,
} from "@/lib/server/owner-session";
import { requireSameOriginMutation } from "@/lib/server/request-security";

function audience(req: NextRequest) {
  return req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
}

export async function POST(req: NextRequest) {
  try {
    requireSameOriginMutation(req);
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ success: false, error: "Email and password are required" }, { status: 400 });
    }
    const user = await findUserByEmail(String(email));
    if (!user) {
      return NextResponse.json({ success: false, error: "メールアドレスまたはパスワードが正しくありません" }, { status: 401 });
    }
    const verified = await verifyPassword(String(password), user.passwordHash);
    if (!verified.ok) {
      return NextResponse.json({ success: false, error: "メールアドレスまたはパスワードが正しくありません" }, { status: 401 });
    }
    if (!user.isApproved) {
      return NextResponse.json({ success: false, error: "承認待ちのアカウントです。" }, { status: 403 });
    }
    if (verified.needsRehash) user.passwordHash = await hashPassword(String(password));
    user.lastLogin = Date.now();
    await upsertUser(user);

    const token = issueOwnerSession({
      key: loadOwnerSessionKey(),
      subject: user.id,
      purpose: "USER",
      audience: audience(req),
      ttlMs: 10 * 60 * 1000,
    });
    const { passwordHash, resetToken, resetTokenExpires, totpSecret, ...safe } = user;
    void passwordHash; void resetToken; void resetTokenExpires; void totpSecret;
    const response = NextResponse.json({ success: true, user: safe });
    response.cookies.set(OWNER_SESSION_COOKIE, token, ownerSessionCookieOptions(10 * 60));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = /MUTATION_|OWNER_SESSION_HMAC_KEY/.test(message) ? 403 : 500;
    return NextResponse.json({ success: false, error: status === 403 ? "Authentication boundary unavailable." : "Internal server error" }, { status });
  }
}
