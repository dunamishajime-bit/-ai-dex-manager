import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { getWebAuthnRequestContext } from "@/lib/server/webauthn-origin";

const RP_NAME = "Professional DisManager";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userId, userName } = body;

        if (!userId || !userName) {
            return NextResponse.json({ error: "userId and userName are required" }, { status: 400 });
        }

        const { rpID } = getWebAuthnRequestContext(req);
        const options = await generateRegistrationOptions({
            rpName: RP_NAME,
            rpID,
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
            path: "/",
        });

        return NextResponse.json(options);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
