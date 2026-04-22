import sgMail from "@sendgrid/mail";
import nodemailer from "nodemailer";

const API_KEY = process.env.SENDGRID_API_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

if (API_KEY) {
    sgMail.setApiKey(API_KEY);
}

interface SendEmailResult {
    success: boolean;
    simulated: boolean;
    error?: any;
}

function buildUtf8HtmlDocument(bodyHtml?: string, fallbackText?: string) {
    const content = bodyHtml || (fallbackText || "").replace(/\n/g, "<br>");
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DisTERMINAL</title>
</head>
<body style="margin:0; padding:0; font-family: Arial, 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, sans-serif; color:#111;">
    ${content}
</body>
</html>`;
}

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<SendEmailResult> {
    console.log(`[MailService] Attempting to send email to: ${to}`);
    console.log(`[MailService] Env Vars Status - User: ${!!GMAIL_USER}, Pass: ${!!GMAIL_APP_PASSWORD}`);
    if (GMAIL_USER) console.log(`[MailService] User: ${GMAIL_USER}`);

    // Priority 1: Gmail (if configured)
    if (GMAIL_USER && GMAIL_APP_PASSWORD) {
        console.log("[MailService] Using Gmail configuration");
        try {
            const transporter = nodemailer.createTransport({
                service: "gmail",
                auth: {
                    user: GMAIL_USER,
                    pass: GMAIL_APP_PASSWORD.replace(/\s+/g, ''), // Remove spaces from app password logic
                },
            });

            const mailOptions = {
                from: {
                    name: "DisTERMINAL",
                    address: GMAIL_USER,
                },
                to: to,
                subject: subject,
                ...(html
                    ? { html: buildUtf8HtmlDocument(html, text) }
                    : { text }),
                encoding: "utf-8",
            };

            await transporter.sendMail(mailOptions);
            return { success: true, simulated: false };
        } catch (error) {
            console.error("Gmail Send Error:", error);
            return { success: false, simulated: false, error };
        }
    }

    // Priority 2: SendGrid
    if (API_KEY) {
        const msg = {
            to: to,
      from: "noreply@professional-dismanager.net",
            subject: subject,
            ...(html
                ? { html: buildUtf8HtmlDocument(html, text) }
                : { text }),
        };

        try {
            await sgMail.send(msg);
            return { success: true, simulated: false };
        } catch (error) {
            console.error("SendGrid Error:", error);
            return { success: false, simulated: false, error };
        }
    }

    // Priority 3: Mock (Development only)
    if (process.env.NODE_ENV === "production") {
        const error = new Error("メール送信設定が未完了です。Gmail または SendGrid を設定してください。");
        console.error("[MailService] Production mail config missing");
        return { success: false, simulated: false, error };
    }

    console.warn(`[Mock Email] To: ${to}, Subject: ${subject}`);
    // console.warn(`[Mock Body] ${text}`); // Too verbose?
    return { success: true, simulated: true };
}

export async function sendPasswordResetEmail(email: string, resetToken: string): Promise<boolean> {
    // Determine base URL dynamically
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

    // Construct email content
    const subject = "AI DEX Manager: Password Reset Request";
    const text = `You requested a password reset. Please click the link below to reset your password:\n\n${resetUrl}\n\nIf you did not request this, please ignore this email.`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>You requested a password reset for your AI DEX Manager account.</p>
            <div style="margin: 30px 0; text-align: center;">
                <a href="${resetUrl}" style="background-color: #ffd700; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">Reset Password</a>
            </div>
            <p style="color: #666; font-size: 14px;">If the button above doesn't work, copy and paste this link into your browser:</p>
            <p style="color: #666; font-size: 12px; word-break: break-all;">${resetUrl}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
            <p style="color: #999; font-size: 12px;">If you did not request this, please ignore this email.</p>
        </div>
    `;

    if (!API_KEY && !GMAIL_USER) {
        // Extra mock logging for the link specifically if mocking, as sendEmail generic mock might not show the link clearly
        console.warn(`[Mock Link] ${resetUrl}`);
    }

    const Result = await sendEmail(email, subject, text, html);
    return Result.success;
}
