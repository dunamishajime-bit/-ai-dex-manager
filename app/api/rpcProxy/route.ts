import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const RPC_PROXY_TIMEOUT_MS = 10_000;

function upstreamLabel(target: string) {
    try {
        return new URL(target).host;
    } catch {
        return "unknown-upstream";
    }
}

function logUpstreamUnavailable(method: "GET" | "POST", target: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.info(`[RPC Proxy ${method}] Upstream unavailable host=${upstreamLabel(target)} reason=${message}`);
}

export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
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
            signal: AbortSignal.timeout(RPC_PROXY_TIMEOUT_MS),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.info(`[RPC Proxy GET] Upstream returned status=${response.status} host=${upstreamLabel(target)}`);
            return NextResponse.json(
                { error: `Target API error: ${response.status}`, details: errorText },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        logUpstreamUnavailable("GET", target, error);
        return NextResponse.json(
            { error: "Failed to proxy request", details: error.message },
            { status: 502 }
        );
    }
}

export async function POST(req: NextRequest) {
    const { searchParams } = req.nextUrl;
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
            signal: AbortSignal.timeout(RPC_PROXY_TIMEOUT_MS),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.info(`[RPC Proxy POST] Upstream returned status=${response.status} host=${upstreamLabel(target)}`);
            return NextResponse.json(
                { error: `Target RPC error: ${response.status}`, details: errorText },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        logUpstreamUnavailable("POST", target, error);
        return NextResponse.json(
            { error: "Failed to proxy RPC request", details: error.message },
            { status: 502 }
        );
    }
}