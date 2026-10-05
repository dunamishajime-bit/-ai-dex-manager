import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
    try {
        if (process.env.NEXT_PHASE === "phase-production-build") {
            return NextResponse.json({
                skipped: true,
                reason: "Skipped during production build",
            });
        }

        // Hardcoded test target
        const targetEmail = "dunamis.hajime@gmail.com";
        const subject = "【DisDex】メール送信機能の動作確認";
        const text = "このメールを受信できていれば、DisDexのメール送信機能は正常に動作しています。これは動作確認メールです。";

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
