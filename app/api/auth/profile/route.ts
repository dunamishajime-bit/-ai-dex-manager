import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, findUserById, loadUsers, upsertUser } from "@/lib/server/user-db";
import { normalizeSecuritySettings } from "@/lib/security-utils";
import { verifyRequestSession } from "@/lib/server/owner-session";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  try {
    requireSameOriginMutation(req);
    const session = verifyRequestSession(req, ["ADMIN", "USER"]);
    const body = await req.json() as any;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const nextEmail = typeof body.nextEmail === "string" ? body.nextEmail.trim().toLowerCase() : "";
    const user = userId ? await findUserById(userId) : email ? await findUserByEmail(email) : null;
    if (!user) return NextResponse.json({ success: false, error: "対象アカウントが見つかりません。" }, { status: 404 });
    if (session.purpose !== "ADMIN" && session.subject !== user.id) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    if (nextEmail && nextEmail !== user.email.toLowerCase()) {
      const all = await loadUsers();
      if (all.some((entry) => entry.email.toLowerCase() === nextEmail && entry.id !== user.id)) {
        return NextResponse.json({ success: false, error: "変更先メールアドレスは既に使用されています。" }, { status: 409 });
      }
      user.email = nextEmail;
    }
    if (typeof body.displayName === "string") user.displayName = body.displayName.trim() || user.displayName;
    if (typeof body.isTotpEnabled === "boolean") user.isTotpEnabled = body.isTotpEnabled;
    if (typeof body.totpSecret === "string") user.totpSecret = body.totpSecret.trim() || undefined;
    if (Array.isArray(body.webAuthnCredentials)) user.webAuthnCredentials = body.webAuthnCredentials;
    if (body.securitySettings) user.securitySettings = normalizeSecuritySettings(body.securitySettings);
    if (typeof body.lastLogin === "number" && Number.isFinite(body.lastLogin)) user.lastLogin = body.lastLogin;
    if (typeof body.ownerWalletAddress === "string") user.ownerWalletAddress = body.ownerWalletAddress.trim() || undefined;
    if (typeof body.ownerWalletConnectedAt === "number" && Number.isFinite(body.ownerWalletConnectedAt)) user.ownerWalletConnectedAt = body.ownerWalletConnectedAt;
    if (typeof body.vaultAccountId === "string") user.vaultAccountId = body.vaultAccountId.trim() || undefined;
    if (typeof body.vaultStatus === "string") user.vaultStatus = body.vaultStatus;
    await upsertUser(user);

    const { passwordHash, resetToken, resetTokenExpires, totpSecret, ...safe } = user as any;
    void passwordHash; void resetToken; void resetTokenExpires; void totpSecret;
    return NextResponse.json({ success: true, user: safe });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const forbidden = /MUTATION_|OWNER_SESSION_/.test(message);
    return NextResponse.json({ success: false, error: forbidden ? "Authentication required." : "プロフィール更新に失敗しました。" }, { status: forbidden ? 403 : 500 });
  }
}
