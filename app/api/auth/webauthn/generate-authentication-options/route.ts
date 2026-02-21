import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { cookies } from "next/headers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const RP_ID = new URL(APP_URL).hostname;

export async function POST(req: NextRequest) {
    try {
        const { credentials } = await req.json();

        if (!credentials || !Array.isArray(credentials)) {
            return NextResponse.json({ error: "Credentials are required" }, { status: 400 });
        }

        const options = await generateAuthenticationOptions({
            rpID: RP_ID,
            allowCredentials: credentials.map((cred: any) => ({
                id: cred.id,
                type: "public-key",
                transports: cred.transports,
            })),
            userVerification: "preferred",
        });

        // Store challenge in cookie
        const cookieStore = cookies();
        cookieStore.set("authentication-challenge", options.challenge, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 300,
        });

        return NextResponse.json(options);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
