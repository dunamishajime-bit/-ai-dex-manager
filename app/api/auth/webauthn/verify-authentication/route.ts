import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { cookies } from "next/headers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const RP_ID = new URL(APP_URL).hostname;
const ORIGIN = APP_URL.endsWith('/') ? APP_URL.slice(0, -1) : APP_URL;

export async function POST(req: NextRequest) {
    try {
        const { authenticationResponse, credential } = await req.json();

        if (!authenticationResponse || !credential) {
            return NextResponse.json({ error: "authenticationResponse and credential are required" }, { status: 400 });
        }

        const cookieStore = cookies();
        const expectedChallenge = cookieStore.get("authentication-challenge")?.value;

        if (!expectedChallenge) {
            return NextResponse.json({ error: "Session expired or no challenge found" }, { status: 400 });
        }

        const verification = await verifyAuthenticationResponse({
            response: authenticationResponse,
            expectedChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: credential.id,
                publicKey: Buffer.from(credential.publicKey, "base64"),
                counter: credential.counter,
            },
        });

        if (verification.verified) {
            // Clear the challenge cookie
            cookieStore.delete("authentication-challenge");

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
