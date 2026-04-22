import { NextRequest, NextResponse } from "next/server";
import { loadUsers, saveUsers } from "@/lib/server/user-db";

export async function POST(req: NextRequest) {
    try {
        const { token, newPassword } = await req.json();

        if (!token || !newPassword) {
            return NextResponse.json({ success: false, error: "Missing token or password" }, { status: 400 });
        }

        const users = await loadUsers();
        const user = users.find(u => u.resetToken === token && u.resetTokenExpires && u.resetTokenExpires > Date.now());

        if (!user) {
            return NextResponse.json({ success: false, error: "トークンが無効または期限切れです" }, { status: 400 });
        }

        const passwordHash = Buffer.from(newPassword).toString('base64');
        user.passwordHash = passwordHash;

        // Clear token
        user.resetToken = undefined;
        user.resetTokenExpires = undefined;

        await saveUsers(users);

        return NextResponse.json({ success: true, message: "パスワードが更新されました", email: user.email });

    } catch (error: any) {
        console.error("Reset Password Confirm Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
