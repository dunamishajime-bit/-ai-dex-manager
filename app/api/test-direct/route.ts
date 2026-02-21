import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";

export async function GET() {
    try {
        // Hardcoded test target
        const targetEmail = "dunamis.hajime@gmail.com";
        const subject = "Direct API Test Email";
        const text = "If you receive this, the API and Mail Service are working. The issue is likely in the frontend or AuthContext.";

        console.log("--- Direct API Test Triggered ---");

        const result = await sendEmail(targetEmail, subject, text);

        if (result.success) {
            return NextResponse.json({
                message: "Email sent successfully!",
                simulated: result.simulated,
                details: "Check your inbox now."
            });
        } else {
            return NextResponse.json({
                error: "Failed to send email",
                details: result.error
            }, { status: 500 });
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
