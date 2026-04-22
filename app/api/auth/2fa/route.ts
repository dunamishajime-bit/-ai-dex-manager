import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail-service";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { email, code, type } = await req.json();

        if (!email || !code) {
            console.error("[2FA API] Missing email or code");
            return NextResponse.json({ success: false, error: "Email and code are required" }, { status: 400 });
        }

        console.log("[2FA API] Processing request for:", email, "Type:", type);

        let subject = "【DisDEXMANAGER】認証コード";
        let text = `あなたの認証コードは ${code} です。`;
        let html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #333;">認証コードのお知らせ</h2>
                <p>DisDEXMANAGERをご利用いただきありがとうございます。</p>
                <div style="margin: 30px 0; text-align: center;">
                    <span style="background-color: #f5f5f5; color: #333; padding: 12px 24px; font-size: 24px; letter-spacing: 4px; font-weight: bold; border-radius: 4px; border: 1px solid #ddd;">${code}</span>
                </div>
                <p style="color: #666; font-size: 14px;">このコードを認証画面で入力してください。</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                <p style="color: #999; font-size: 12px;">※このメールにお心当たりがない場合は、破棄してください。</p>
            </div>
        `;

        if (type === "register") {
            subject = "【DisDEXMANAGER】会員登録認証コード";
            text = `DisDEXMANAGERへのご登録ありがとうございます。\n\nあなたの認証コードは ${code} です。\n\nこのコードを入力して登録を完了してください。`;
            // HTML structure is reusable, just title change maybe? sticking to generic for simplicity or custom
        }

        console.log("[2FA API] Sending email via service...");
        const result = await sendEmail(email, subject, text, html);
        console.log("[2FA API] Send result:", result);

        if (result.success) {
            return NextResponse.json({ success: true, simulated: result.simulated });
        } else {
            console.error("[2FA API] Send failed:", result.error);
            return NextResponse.json({ success: false, error: result.error?.message || "Failed to send email" }, { status: 500 });
        }
    } catch (error: any) {
        console.error("2FA API Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
