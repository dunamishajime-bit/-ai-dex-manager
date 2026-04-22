import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { getWebAuthnRequestContext } from "@/lib/server/webauthn-origin";

export async function POST(req: NextRequest) {
    try {
        const { authenticationResponse, credential, userId, purpose } = await req.json();

        if (!authenticationResponse || !credential) {
            return NextResponse.json({ error: "authenticationResponse and credential are required" }, { status: 400 });
        }

        const cookieStore = cookies();
        const expectedChallenge = cookieStore.get("authentication-challenge")?.value;

        if (!expectedChallenge) {
            return NextResponse.json({ error: "Session expired or no challenge found" }, { status: 400 });
        }

        const { origin, rpID } = getWebAuthnRequestContext(req);
        const verification = await verifyAuthenticationResponse({
            response: authenticationResponse,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
                id: credential.id,
                publicKey: Buffer.from(credential.publicKey, "base64"),
                counter: credential.counter,
            },
        });

        if (verification.verified) {
            // Clear the challenge cookie
            cookieStore.delete("authentication-challenge");

            if (userId && (purpose === "login-2fa" || purpose === "wallet-recovery")) {
                cookieStore.set("passkey-verified-user", String(userId), {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "lax",
                    maxAge: 300,
                    path: "/",
                });
            }

            return NextResponse.json({
                verified: true,
                newCounter: verification.authenticationInfo.newCounter
            });
        } else {
            return NextResponse.json({ verified: false }, { status: 400 });
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
