import { NextResponse } from "next/server";
import { sendPasswordResetEmail } from "@/lib/mail-service";
import crypto from "crypto";

export async function POST(req: Request) {
    try {
        const { email } = await req.json();

        if (!email || !/^\S+@\S+\.\S+$/.test(email.trim())) {
            return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
        }

        const { findUserByEmail, upsertUser } = await import("@/lib/server/user-db");
        const user = await findUserByEmail(email.trim());

        if (!user) {
            return NextResponse.json({ error: "登録されていないメールアドレスです" }, { status: 404 });
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString("hex");
        user.resetToken = resetToken;
        user.resetTokenExpires = Date.now() + 3600000; // 1 hour
        await upsertUser(user);

        // Send email
        const sent = await sendPasswordResetEmail(email, resetToken);

        if (sent) {
            return NextResponse.json({ success: true, message: "Password reset email sent" });
        } else {
            return NextResponse.json({ success: false, error: "Failed to send email" }, { status: 500 });
        }

    } catch (error) {
        console.error("Reset Password API Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
