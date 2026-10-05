import { NextRequest, NextResponse } from 'next/server';
import { findUserById, upsertUser } from '@/lib/server/user-db';

export async function POST(req: NextRequest) {
    try {
        const { userId } = await req.json();

        if (!userId) {
            return NextResponse.json({ success: false, error: "User ID is required" }, { status: 400 });
        }

        const user = await findUserById(userId);
        if (!user) {
            return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
        }

        user.isApproved = true;
        await upsertUser(user);

        return NextResponse.json({ success: true, user: { id: user.id, isApproved: user.isApproved } });
    } catch (e) {
        console.error("Approve API error:", e);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
