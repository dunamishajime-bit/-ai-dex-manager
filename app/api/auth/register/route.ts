import { NextRequest, NextResponse } from 'next/server';
import { upsertUser, findUserByEmail, ServerUser } from '@/lib/server/user-db';

export async function POST(req: NextRequest) {
    try {
        const { email, nickname, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json({ success: false, error: "Email and password are required" }, { status: 400 });
        }

        const existing = await findUserByEmail(email);
        if (existing) {
            return NextResponse.json({ success: false, error: "このメールアドレスは既に登録されています" }, { status: 400 });
        }

        const newUser: ServerUser = {
            id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            email,
            displayName: nickname,
            passwordHash: Buffer.from(password).toString('base64'), // Simple demo encoding
            role: "user",
            createdAt: Date.now(),
            lastLogin: Date.now(),
            isApproved: false,
            isTotpEnabled: false
        };

        await upsertUser(newUser);

        return NextResponse.json({ success: true, user: newUser });
    } catch (e) {
        console.error("Registration API error:", e);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
