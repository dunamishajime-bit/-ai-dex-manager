import { NextRequest, NextResponse } from "next/server";
import { findUserById, loadUsers } from "@/lib/server/user-db";
import { verifyRequestSession } from "@/lib/server/owner-session";

export const dynamic = "force-dynamic";

function safe(user: any) {
  const { passwordHash, resetToken, resetTokenExpires, avatarUrl, currentWebAuthnChallenge, totpSecret, emailVerificationCode, ...rest } = user;
  void passwordHash; void resetToken; void resetTokenExpires; void avatarUrl; void currentWebAuthnChallenge; void totpSecret; void emailVerificationCode;
  return rest;
}

export async function GET(req: NextRequest) {
  try {
    const session = verifyRequestSession(req, ["ADMIN", "USER"]);
    if (session.purpose === "ADMIN") {
      return NextResponse.json({ success: true, users: (await loadUsers()).map(safe) });
    }
    const own = await findUserById(session.subject);
    return NextResponse.json({ success: true, users: own ? [safe(own)] : [] });
  } catch {
    return NextResponse.json({ success: false, users: [], error: "Authentication required." }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  void req;
  return NextResponse.json({ success: false, error: "Bulk sync is disabled." }, { status: 405 });
}
