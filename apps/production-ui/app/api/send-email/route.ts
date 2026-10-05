import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";

export async function POST(req: NextRequest) {
    try {
        const { email, subject, text, html } = await req.json();

        // Use the unified mail service which handles Gmail, SendGrid, and Mocking
        const result = await sendEmail(email, subject, text, html);

        if (result.success) {
            return NextResponse.json({ success: true, simulated: result.simulated });
        } else {
            return NextResponse.json({ success: false, error: result.error?.message || "Unknown error" }, { status: 500 });
        }
    } catch (error: any) {
        console.error("Email send error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
