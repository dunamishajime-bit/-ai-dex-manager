import { NextRequest, NextResponse } from 'next/server';
import { loadUsers, upsertUser } from '@/lib/server/user-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const users = await loadUsers();
        // Return without password hashes for safety
        const safeUsers = users.map(({ passwordHash, ...u }: any) => u);
        return NextResponse.json({ success: true, users: safeUsers });
    } catch (e) {
        console.error("Get users API error:", e);
        return NextResponse.json({ success: true, users: [], message: "Running in serverless/read-only mode" });
    }
}

// Bulk sync for client-side data to server
export async function POST(req: NextRequest) {
    try {
        const { users } = await req.json();
        if (users && Array.isArray(users)) {
            for (const u of users) {
                if (u.id && u.email) {
                    await upsertUser(u as any);
                }
            }
            return NextResponse.json({ success: true, count: users.length });
        }
        return NextResponse.json({ success: false, error: "Invalid users data" }, { status: 400 });
    } catch (e) {
        console.error("Bulk sync API error:", e);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
