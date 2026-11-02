import { NextRequest, NextResponse } from "next/server";
import { loadUsers, saveUsers } from "@/lib/server/user-db";
import { hashPassword } from "@/lib/server/password-hash";
import { requireSameOriginMutation } from "@/lib/server/request-security";

export async function POST(req: NextRequest) {
  try {
    requireSameOriginMutation(req);
    const { token, newPassword } = await req.json();
    if (!token || !newPassword) return NextResponse.json({ success: false, error: "Missing token or password" }, { status: 400 });
    const users = await loadUsers();
    const user = users.find((u) => u.resetToken === token && u.resetTokenExpires && u.resetTokenExpires > Date.now());
    if (!user) return NextResponse.json({ success: false, error: "トークンが無効または期限切れです" }, { status: 400 });
    user.passwordHash = await hashPassword(String(newPassword));
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await saveUsers(users);
    return NextResponse.json({ success: true, message: "パスワードが更新されました", email: user.email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "reset failed";
    return NextResponse.json({ success: false, error: /MUTATION_/.test(message) ? "Origin rejected." : "パスワード更新に失敗しました。" }, { status: /MUTATION_/.test(message) ? 403 : 500 });
  }
}
