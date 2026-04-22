import { NextRequest, NextResponse } from 'next/server';
import { loadUsers } from '@/lib/server/user-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const users = await loadUsers();
        // Return without sensitive/heavy fields for safety and performance
        const safeUsers = users.map(
            ({
                passwordHash,
                resetToken,
                resetTokenExpires,
                avatarUrl,
                currentWebAuthnChallenge,
                ...u
            }: any) => {
                void passwordHash;
                void resetToken;
                void resetTokenExpires;
                void avatarUrl;
                void currentWebAuthnChallenge;
                return u;
            },
        );
        return NextResponse.json({ success: true, users: safeUsers });
    } catch (e) {
        console.error("Get users API error:", e);
        return NextResponse.json({ success: true, users: [], message: "Running in serverless/read-only mode" });
    }
}

// Disabled: server users are the source of truth to avoid deleted users reappearing.
export async function POST(req: NextRequest) {
    void req;
    return NextResponse.json(
        { success: false, error: "Bulk sync is disabled. Use dedicated auth/profile endpoints." },
        { status: 405 }
    );
}
