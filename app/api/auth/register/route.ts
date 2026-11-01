import { NextRequest, NextResponse } from "next/server";
import { upsertUser, findUserByEmail, type ServerUser } from "@/lib/server/user-db";
import { loadSystemSettings } from "@/lib/server/system-settings-db";
import { hashPassword } from "@/lib/server/password-hash";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export async function POST(req: NextRequest) {
  try {
    requireSameOriginMutation(req);
    const { email, nickname, password } = await req.json();
    const systemSettings = await loadSystemSettings();
    if (!systemSettings.registrationEnabled) {
      return NextResponse.json({ success: false, error: "現在、新規登録は停止中です。" }, { status: 403 });
    }
    if (!email || !password) {
      return NextResponse.json({ success: false, error: "Email and password are required" }, { status: 400 });
    }
    const existing = await findUserByEmail(String(email));
    if (existing) return NextResponse.json({ success: false, error: "このメールアドレスは既に登録されています" }, { status: 400 });

    const newUser: ServerUser = {
      id: `user_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      email: String(email).trim().toLowerCase(),
      displayName: String(nickname || "").trim(),
      passwordHash: await hashPassword(String(password)),
      role: "user",
      createdAt: Date.now(),
      lastLogin: Date.now(),
      isApproved: false,
      isTotpEnabled: false,
      securitySettings: { enabled: false, minMethods: 2, methods: { email: true, totp: true, passkey: false }, updatedAt: Date.now() },
    };
    await upsertUser(newUser);
    const { passwordHash, ...safe } = newUser; void passwordHash;
    return NextResponse.json({ success: true, user: safe });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json({ success: false, error: /MUTATION_/.test(message) ? "Origin rejected." : "Internal server error" }, { status: /MUTATION_/.test(message) ? 403 : 500 });
  }
}
