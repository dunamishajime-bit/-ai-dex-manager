import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, findUserById, loadUsers, upsertUser } from "@/lib/server/user-db";
import { normalizeSecuritySettings } from "@/lib/security-utils";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      email?: string;
      nextEmail?: string;
      displayName?: string;
      isTotpEnabled?: boolean;
      totpSecret?: string;
      securitySettings?: {
        enabled?: boolean;
        minMethods?: number;
        methods?: { email?: boolean; totp?: boolean; passkey?: boolean };
      };
      webAuthnCredentials?: any[];
      lastLogin?: number;
      ownerWalletAddress?: string;
      ownerWalletConnectedAt?: number;
      vaultAccountId?: string;
      vaultStatus?: "draft" | "pending_deployment" | "active" | "paused" | "migration_ready";
    };

    const userId = body.userId?.trim();
    const email = body.email?.trim().toLowerCase();
    const nextEmail = body.nextEmail?.trim().toLowerCase();

    const user = userId ? await findUserById(userId) : email ? await findUserByEmail(email) : null;
    if (!user) {
    return NextResponse.json({ success: false, error: "対象アカウントが見つかりません。" }, { status: 404 });
    }

    if (nextEmail && nextEmail !== user.email.toLowerCase()) {
      const all = await loadUsers();
      const duplicate = all.find((entry) => entry.email.toLowerCase() === nextEmail && entry.id !== user.id);
      if (duplicate) {
        return NextResponse.json({ success: false, error: "変更先メールアドレスは既に使用されています。" }, { status: 409 });
      }
      user.email = nextEmail;
    }

    if (typeof body.displayName === "string") {
      user.displayName = body.displayName.trim() || user.displayName;
    }
    if (typeof body.isTotpEnabled === "boolean") {
      user.isTotpEnabled = body.isTotpEnabled;
    }
    if (typeof body.totpSecret === "string") {
      user.totpSecret = body.totpSecret.trim() || undefined;
    }
    if (Array.isArray(body.webAuthnCredentials)) {
      user.webAuthnCredentials = body.webAuthnCredentials;
    }
    if (body.securitySettings) {
      user.securitySettings = normalizeSecuritySettings(body.securitySettings);
    }
    if (typeof body.lastLogin === "number" && Number.isFinite(body.lastLogin)) {
      user.lastLogin = body.lastLogin;
    }
    if (typeof body.ownerWalletAddress === "string") {
      user.ownerWalletAddress = body.ownerWalletAddress.trim() || undefined;
    }
    if (typeof body.ownerWalletConnectedAt === "number" && Number.isFinite(body.ownerWalletConnectedAt)) {
      user.ownerWalletConnectedAt = body.ownerWalletConnectedAt;
    }
    if (typeof body.vaultAccountId === "string") {
      user.vaultAccountId = body.vaultAccountId.trim() || undefined;
    }
    if (typeof body.vaultStatus === "string") {
      user.vaultStatus = body.vaultStatus;
    }

    await upsertUser(user);

    const { passwordHash, resetToken, resetTokenExpires, ...safe } = user as any;
    void passwordHash;
    void resetToken;
    void resetTokenExpires;
    return NextResponse.json({ success: true, user: safe });
  } catch (error) {
    console.error("Profile patch error:", error);
    return NextResponse.json({ success: false, error: "プロフィール更新に失敗しました。" }, { status: 500 });
  }
}
