import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmail, upsertUser } from '@/lib/server/user-db';

export async function POST(req: NextRequest) {
    try {
        const { email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json({ success: false, error: "Email and password are required" }, { status: 400 });
        }

        const user = await findUserByEmail(email);
        if (!user) {
            return NextResponse.json({ success: false, error: "メールアドレスまたはパスワードが正しくありません" }, { status: 401 });
        }

        const passwordHash = Buffer.from(password).toString('base64');
        if (user.passwordHash !== passwordHash) {
            return NextResponse.json({ success: false, error: "メールアドレスまたはパスワードが正しくありません" }, { status: 401 });
        }

        // Update last login
        user.lastLogin = Date.now();
        await upsertUser(user);

        return NextResponse.json({ success: true, user });
    } catch (e) {
        console.error("Login API error:", e);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
