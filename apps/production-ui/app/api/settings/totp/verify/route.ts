import { NextRequest, NextResponse } from "next/server";
import { verifyTOTPToken } from "@/lib/security-service";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { token, secret } = await req.json();

        if (!token || !secret) {
            return NextResponse.json({ success: false, error: "Token and secret are required" }, { status: 400 });
        }

        const isValid = await verifyTOTPToken(token, secret);

        return NextResponse.json({
            success: true,
            isValid
        });
    } catch (error: any) {
        console.error("TOTP Verify API Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
