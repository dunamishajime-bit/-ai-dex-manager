import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get("target");

    if (!target) {
        return NextResponse.json({ error: "Missing target parameter" }, { status: 400 });
    }

    try {
        // Build the target URL with all incoming search params except 'target'
        const targetUrl = new URL(target);
        searchParams.forEach((value, key) => {
            if (key !== "target") {
                targetUrl.searchParams.set(key, value);
            }
        });

        const response = await fetch(targetUrl.toString(), {
            headers: {
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[RPC Proxy GET] Error from ${target}:`, errorText);
            return NextResponse.json(
                { error: `Target API error: ${response.status}`, details: errorText },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("[RPC Proxy GET] Unexpected Error:", error);
        return NextResponse.json(
            { error: "Failed to proxy request", details: error.message },
            { status: 502 }
        );
    }
}

export async function POST(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get("target");

    if (!target) {
        return NextResponse.json({ error: "Missing target parameter" }, { status: 400 });
    }

    try {
        const body = await req.json();

        const response = await fetch(target, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[RPC Proxy POST] Error from ${target}:`, errorText);
            return NextResponse.json(
                { error: `Target RPC error: ${response.status}`, details: errorText },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("[RPC Proxy POST] Unexpected Error:", error);
        return NextResponse.json(
            { error: "Failed to proxy RPC request", details: error.message },
            { status: 502 }
        );
    }
}
