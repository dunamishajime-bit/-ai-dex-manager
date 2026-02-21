import { NextRequest, NextResponse } from "next/server";
import { generateTOTPSecret } from "@/lib/security-service";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { email } = await req.json();

        if (!email) {
            return NextResponse.json({ success: false, error: "Email is required" }, { status: 400 });
        }

        const { secret, qrCodeUrl } = await generateTOTPSecret(email);

        return NextResponse.json({
            success: true,
            secret,
            qrCodeUrl
        });
    } catch (error: any) {
        console.error("TOTP Generate API Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
