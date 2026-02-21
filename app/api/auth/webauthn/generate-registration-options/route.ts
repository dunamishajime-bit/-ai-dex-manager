import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { cookies } from "next/headers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const RP_ID = new URL(APP_URL).hostname;
const RP_NAME = "DIS-DEX Manager";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userId, userName } = body;

        if (!userId || !userName) {
            return NextResponse.json({ error: "userId and userName are required" }, { status: 400 });
        }

        const options = await generateRegistrationOptions({
            rpName: RP_NAME,
            rpID: RP_ID,
            userID: new TextEncoder().encode(userId),
            userName: userName,
            attestationType: "none",
            authenticatorSelection: {
                residentKey: "preferred",
                userVerification: "preferred",
            },
        });

        // Store challenge in a cookie for 5 minutes
        const cookieStore = cookies();
        cookieStore.set("registration-challenge", options.challenge, {
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
