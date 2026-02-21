import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { cookies } from "next/headers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const RP_ID = new URL(APP_URL).hostname;
const ORIGIN = APP_URL.endsWith('/') ? APP_URL.slice(0, -1) : APP_URL;

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { registrationResponse } = body;

    const cookieStore = cookies();
    const expectedChallenge = cookieStore.get("registration-challenge")?.value;

    if (!expectedChallenge) {
        return NextResponse.json({ error: "Session expired or no challenge found" }, { status: 400 });
    }

    try {
        const verification = await verifyRegistrationResponse({
            response: registrationResponse,
            expectedChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
        });

        if (verification.verified && verification.registrationInfo) {
            const { credential } = verification.registrationInfo;
            const { id, publicKey, counter } = credential;

            // Clear the challenge cookie
            cookieStore.delete("registration-challenge");

            // Return the credential data so the client can save it in localStorage
            return NextResponse.json({
                verified: true,
                credential: {
                    id: Buffer.from(id).toString("base64"),
                    publicKey: Buffer.from(publicKey).toString("base64"),
                    counter,
                    transports: registrationResponse.response.transports,
                }
            });
        } else {
            return NextResponse.json({ verified: false }, { status: 400 });
        }
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
